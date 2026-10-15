// O que o instalador faz no banco depois de provisionar: configuração da troca, canal de alerta, o comando de prova e o
// registro do que está no ar (versões e dados do painel na Vercel, para qualquer computador conseguir publicar).
// `consultar(sql)` é a Management API do Supabase (ou, nos testes, um Postgres local com as mesmas migrações).
import { comoAdmin, jsonb, texto, textos, uuid, valor } from "./sql.mjs";
import { idiomaGravado, t } from "./texto.mjs";

export const MODOS = ["limite", "limiar", "rodizio"];
export const EVENTOS_PADRAO = ["sem_livre", "precisa_login", "computador_parado", "login_vence"];

async function chamar(consultar, adminId, expressao, parametros) {
  const r = valor(await consultar(comoAdmin(adminId, expressao), parametros));
  if (r && r.ok === false) throw new Error(r.erro || t("o banco recusou", "the database refused"));
  return r;
}

/** Troca automática e modo, pelas mesmas regras do painel (painel_config). */
export async function salvarTroca(consultar, adminId, { auto, modo, aviso, troca, fuso }) {
  if (!MODOS.includes(modo)) throw new Error(t("modo desconhecido", "unknown mode"));
  const pares = [["modo", modo]];
  if (modo === "limiar") {
    if (!(aviso >= 1 && troca <= 100 && aviso < troca)) throw new Error(t("o aviso precisa ser menor que a troca (1 a 100)", "the warning must be lower than the switch (1 to 100)"));
    // o banco exige aviso < troca a cada gravação: a troca vai a 100 antes, e nenhum passo fica invertido
    pares.push(["troca", 100], ["aviso", aviso], ["troca", troca]);
  }
  if (fuso) pares.push(["fuso", fuso]);
  pares.push(["auto", !!auto]);
  for (const [k, v] of pares) await chamar(consultar, adminId, `public.painel_config(${texto(k)}, ${jsonb(v)})`);
}

/**
 * O idioma da instalação (o da escolha no instalador) na configuração da nuvem: é a língua dos alertas que saem pelos
 * canais. Direto na tabela, como o resto do que o instalador registra (o painel não grava `idioma`); o valor vai como
 * parâmetro. Vale o idioma do último computador que atualizou a nuvem.
 */
export async function gravarIdioma(consultar, idioma = idiomaGravado()) {
  await consultar(`insert into public.config (chave, valor, mudado_em) values ('idioma', to_jsonb($1::text), now())
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now()`, [idioma === "en" ? "en" : "pt-BR"]);
}

/** Canal de alerta: o destino vai na tabela e o segredo (token, tópico, chave) no Vault. Devolve o id. */
export async function salvarAlerta(consultar, adminId, { canal, destino, eventos = EVENTOS_PADRAO, segredo }) {
  const r = await chamar(consultar, adminId, `public.painel_alerta(${texto(canal)}, ${jsonb(destino)}, ${textos(eventos)})`);
  if (!r || !r.id) throw new Error(t("o alerta não foi salvo", "the alert was not saved"));
  // o segredo vai como parâmetro, fora do texto do SQL (que pode ficar no histórico de consultas do banco)
  if (segredo) await chamar(consultar, adminId, `public.painel_alerta_segredo(${uuid(r.id)}, $1::text)`, [String(segredo)]);
  return r.id;
}

/** O computador que entrou com esta identidade (depois da primeira busca do agente). */
export async function computadorDoEmail(consultar, email) {
  const r = await consultar(
    `select c.id from public.computadores c join auth.users u on u.id = c.user_id where u.email = ${texto(String(email).toLowerCase())} and not c.revogado`,
  );
  return Array.isArray(r) && r[0] ? r[0].id : null;
}

export async function pedirComando(consultar, adminId, computadorId, acao, corpo = {}) {
  const r = await chamar(consultar, adminId, `public.painel_comando(${uuid(computadorId)}, ${texto(acao)}, ${jsonb(corpo)})`);
  return r.id;
}

export async function estadoComando(consultar, id) {
  if (!Number.isInteger(Number(id))) throw new Error(t("comando inválido", "invalid command"));
  const r = await consultar(`select estado::text as estado, http from public.comandos where id = ${Number(id)}`);
  return Array.isArray(r) && r[0] ? r[0] : null;
}

/** Espera o computador buscar o comando e responder (a busca roda a cada 5 s). */
export async function esperarComando(consultar, id, { tentativas = 15, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const e = await estadoComando(consultar, id);
    if (e && e.estado !== "pendente" && e.estado !== "reservado") return e;
    await esperar(2000);
  }
  return null;
}

const VERSAO = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

/**
 * Os dados do painel na Vercel que só o computador que criou a instalação sabia (projeto, equipe, domínio, endereços e
 * a chave pública do push): vão para a configuração da nuvem (`painel_publicacao`), para qualquer computador da
 * instalação publicar o painel. Nada disso é segredo; o token da Vercel não vai.
 */
export function dadosDaPublicacao({ projeto, equipe = null, dominio = null, url, urlVercel = null, vapid = null }) {
  const https = (u) => typeof u === "string" && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u);
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(String(projeto || ""))) throw new Error(t("projeto da Vercel inválido", "invalid Vercel project"));
  if (equipe !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(String(equipe))) throw new Error(t("equipe da Vercel inválida", "invalid Vercel team"));
  if (dominio !== null && !/^[a-z0-9.-]{4,253}$/.test(String(dominio))) throw new Error(t("domínio inválido", "invalid domain"));
  if (!https(url) || (urlVercel !== null && !https(urlVercel))) throw new Error(t("endereço do painel inválido", "invalid panel address"));
  if (vapid !== null && !/^[A-Za-z0-9_-]{20,200}$/.test(String(vapid))) throw new Error(t("chave pública do push inválida", "invalid push public key"));
  return { projeto, equipe, dominio, url, url_vercel: urlVercel, vapid };
}

/**
 * O que ficou no ar depois de publicar (o instalador no computador que criou a instalação, ou o computador que publica
 * sozinho): a versão da nuvem (a deste instalador, se for maior: as migrações dele entraram), a versão das funções e do
 * painel e os dados do painel. Valores como parâmetro, nunca no texto do SQL.
 */
export async function registrarPublicacao(consultar, { versao, funcoes = true, painel = true, publicacao = null }) {
  if (!VERSAO.test(String(versao))) throw new Error(t("versão inválida", "invalid version"));
  await consultar(`insert into public.config (chave, valor, mudado_em) values ('nuvem_versao', to_jsonb($1::text), now())
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now()
    where public.rvz_versao_num(public.config.valor #>> '{}') is null
       or public.rvz_versao_num($1::text) >= public.rvz_versao_num(public.config.valor #>> '{}')`, [versao]);
  const publicado = { ...(funcoes ? { funcoes: versao } : {}), ...(painel ? { painel: versao } : {}), em: new Date().toISOString() };
  await consultar(`insert into public.config (chave, valor, mudado_em) values ('publicado', $1::jsonb, now())
    on conflict (chave) do update set valor = (case when jsonb_typeof(public.config.valor) = 'object' then public.config.valor else '{}'::jsonb end) || excluded.valor,
                                      mudado_em = now()`, [JSON.stringify(publicado)]);
  if (publicacao) {
    await consultar(`insert into public.config (chave, valor, mudado_em) values ('painel_publicacao', $1::jsonb, now())
      on conflict (chave) do update set valor = excluded.valor, mudado_em = now()`, [JSON.stringify(dadosDaPublicacao(publicacao))]);
  }
}

/** A configuração da nuvem que a publicação precisa (a versão da nuvem e os dados do painel). */
export async function lerPublicacao(consultar) {
  const linhas = await consultar("select chave, valor from public.config where chave in ('nuvem_versao', 'painel_publicacao', 'publicado')");
  const m = new Map((Array.isArray(linhas) ? linhas : []).map((l) => [l.chave, typeof l.valor === "string" && /^[[{"]/.test(l.valor) ? JSON.parse(l.valor) : l.valor]));
  const p = m.get("painel_publicacao");
  return {
    versao: typeof m.get("nuvem_versao") === "string" ? m.get("nuvem_versao") : null,
    publicado: m.get("publicado") ?? null,
    painel: p && typeof p === "object" ? { projeto: p.projeto, equipe: p.equipe ?? null, dominio: p.dominio ?? null, url: p.url, urlVercel: p.url_vercel ?? null, vapid: p.vapid ?? null } : null,
  };
}

/** A versão `a` é mais nova que `b`? (X.Y.Z; fora do formato, não.) */
export function maisNova(a, b) {
  const p = (v) => (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(v || "")) ? String(v).split(".").map(Number) : null);
  const x = p(a);
  const y = p(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
