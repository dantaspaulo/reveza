// 0030: os agentes contados pela hora em que começaram (relato do Paulo, 03/11/2026: o painel só via os agentes das
// sessões que começaram no período, e as sessões de editor ficam abertas por semanas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0030_agentes_por_hora.sql", import.meta.url), "utf8");
const LINHA = { hora: "2026-10-11T03:12:00Z", projeto: "proj", modelo: "m1", respostas: 3, entrada: 10, saida: 20,
  cache_escrita: 30, cache_leitura: 40, usd: 1.5 };

test("0030 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const b = await banco();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("a linha de uso guarda os agentes que começaram na hora, e o reenvio troca o número (não soma)", async () => {
  const b = await banco();
  const pc = await b.computador();
  const a = await b.conta(pc, "a@exemplo.com");
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [{ ...LINHA, conta_id: a, agentes: 2 }] });
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [{ ...LINHA, conta_id: a, respostas: 5, agentes: 3 }] });
  const linhas = await b.sql("select respostas, agentes from public.uso_tokens");
  assert.deepEqual(linhas, [{ respostas: 5, agentes: 3 }]);
});

test("agente antigo, sem o número, grava 0; número inválido não passa", async () => {
  const b = await banco();
  const pc = await b.computador();
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [LINHA] });
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [{ ...LINHA, modelo: "m2", agentes: -4 }] });
  const linhas = await b.sql("select modelo, agentes from public.uso_tokens order by modelo");
  assert.deepEqual(linhas, [{ modelo: "m1", agentes: 0 }, { modelo: "m2", agentes: 0 }]);
});

test("quem lê o painel enxerga a coluna; quem não é membro, não", async () => {
  const b = await banco();
  const pc = await b.computador();
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [{ ...LINHA, agentes: 7 }] });
  const leitor = { id: await b.usuario("leitura", "l@exemplo.com"), aal: "aal2" };
  const [l] = await b.como(leitor, "select agentes from public.uso_tokens");
  assert.equal(l.agentes, 7);
});
