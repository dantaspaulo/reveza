// SQL que o instalador manda ao banco da pessoa (pela Management API do Supabase): literais escapados e as funções do
// painel chamadas como o administrador, para valerem as mesmas regras e a mesma auditoria do painel.

import { t } from "./texto.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(v) {
  if (!UUID.test(String(v))) throw new Error(t("identificador inválido", "invalid identifier"));
  return `'${v}'::uuid`;
}

export function texto(v) {
  const s = String(v);
  if (s.includes("\0")) throw new Error(t("texto com caractere nulo", "text contains a null character"));
  return `'${s.replaceAll("'", "''")}'`;
}

export const jsonb = (v) => `${texto(JSON.stringify(v))}::jsonb`;
export const textos = (lista) => `array[${lista.map(texto).join(", ")}]::text[]`;

/**
 * Uma chamada de função como o administrador com as duas etapas confirmadas (o instalador fala pela pessoa que
 * instala), numa declaração só: a Management API devolve as linhas dela, e o set_config local morre com ela.
 * O `from _rvz` garante que o set_config roda antes da função.
 */
export function comoAdmin(adminId, expressao) {
  uuid(adminId);
  const claims = JSON.stringify({ sub: String(adminId), role: "authenticated", aal: "aal2" });
  return `with _rvz as (select set_config('request.jwt.claims', ${texto(claims)}, true) as c) select ${expressao} as r from _rvz`;
}

/** O valor `r` da primeira linha que a Management API devolveu. */
export function valor(linhas) {
  return Array.isArray(linhas) && linhas[0] ? linhas[0].r : undefined;
}
