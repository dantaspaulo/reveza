// 0028: a conta que não roda o modelo da sessão (o Fable 5.1 numa conta Team sem créditos, relato de 22/10/2026) sai
// das candidatas daquele computador por 6 horas, e a semana de um modelo não entra no percentual efetivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0028_conta_sem_modelo.sql", import.meta.url), "utf8");
const FABLE = "claude-fable-5-1";

async function cenario() {
  const b = await banco();
  await b.config("auto", true);
  await b.config("modo", "limiar");
  return b;
}

async function usar(b, pc, conta) {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, 'teste', now() - interval '1 hour')
               on conflict (computador_id) do update set conta_id = excluded.conta_id, decidido_em = excluded.decidido_em`,
    [pc.pc, conta]);
}

const semModelo = (b, pc, conta, modelo = FABLE, sessao = null) =>
  b.rpc(pc, "agente_sem_modelo", { p_conta: conta, p_modelo: modelo, p_sessao: sessao });
const marcas = (b) => b.sql("select conta_id, computador_id, modelo, ate > now() + interval '5 hours 50 minutes' as seis_horas from public.contas_sem_modelo");

test("0028 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const b = await banco();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("a conta em uso não roda o modelo: marca por 6 horas para este computador e troca na hora para outra livre", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const team = await b.conta(pc, "team@exemplo.com", 10, { prioridade: 1 });
  const max = await b.conta(pc, "max@exemplo.com", 20, { prioridade: 5 });
  await usar(b, pc, team);
  const r = await semModelo(b, pc, team);
  assert.equal(r.ok, true);
  assert.equal(r.trocou, true);
  assert.equal(await b.atribuida(pc), max);
  assert.deepEqual(await marcas(b), [{ conta_id: team, computador_id: pc.pc, modelo: FABLE, seis_horas: true }]);
  const [ev] = await b.sql("select tipo, dados from public.eventos where dados ->> 'motivo' = 'sem_modelo'");
  assert.equal(ev.tipo, "limite");
  assert.equal(ev.dados.modelo, FABLE);
});

test("enquanto a marca vale, a conta não volta para este computador; para outro computador, segue candidata", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const outro = await b.computador("air");
  const team = await b.conta(pc, "team@exemplo.com", 5, { prioridade: 1 });
  const max = await b.conta(pc, "max@exemplo.com", 20, { prioridade: 5 });
  await usar(b, pc, team);
  await semModelo(b, pc, team);
  assert.equal(await b.atribuida(pc), max);
  // a de agora enche: sem a marca, a team (prioridade 1) seria a escolhida
  await b.sql("update public.uso_janelas set pct = 99, lido_em = now() where conta_id = $1", [max]);
  await b.sql("select public.decidir($1, true)", [pc.pc]);
  assert.equal(await b.atribuida(pc), max, "a marcada não volta enquanto vale");
  const candidatasOutro = (await b.sql("select conta_id from public.rvz_candidatas($1)", [outro.pc])).map((l) => l.conta_id);
  assert.ok(candidatasOutro.includes(team), "para o outro computador a conta segue candidata");
  // a marca venceu: volta a ser candidata
  await b.sql("update public.contas_sem_modelo set ate = now() - interval '1 minute'");
  const candidatas = (await b.sql("select conta_id from public.rvz_candidatas($1)", [pc.pc])).map((l) => l.conta_id);
  assert.ok(candidatas.includes(team));
});

test("sem outra conta livre, fica onde está (trocou false) e a marca fica gravada", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const team = await b.conta(pc, "team@exemplo.com", 10);
  await b.conta(pc, "cheia@exemplo.com", 99);
  await usar(b, pc, team);
  const r = await semModelo(b, pc, team);
  assert.equal(r.trocou, false);
  assert.equal(await b.atribuida(pc), team);
  assert.equal((await marcas(b)).length, 1);
});

test("aviso atrasado (a troca já aconteceu) não marca nada; modelo vazio ou com quebra de linha é recusado", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const outra = await b.conta(pc, "b@exemplo.com", 10);
  await usar(b, pc, outra);
  const r = await semModelo(b, pc, a);
  assert.equal(r.trocou, true);
  assert.equal((await marcas(b)).length, 0);
  await usar(b, pc, a);
  for (const ruim of ["", "   ", "fable\nmau"]) await assert.rejects(semModelo(b, pc, a, ruim), /modelo inválido/, JSON.stringify(ruim));
});

test("a semana de um modelo (seven_day_fable) aparece na tabela, mas não entra no percentual efetivo", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const c = await b.conta(pc, "max@exemplo.com", 12);
  await b.sql("insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values ($1, 'seven_day_fable', 99, now(), 'api')", [c]);
  const [{ efetivo }] = await b.sql("select public.rvz_pct_efetivo($1) as efetivo", [c]);
  assert.equal(Number(efetivo), 12);
  await assert.rejects(
    b.sql("insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values ($1, 'seven_day_outro', 1, now(), 'api')", [c]),
    /uso_janelas_tipo_check/,
  );
});

test("só quem é membro lê as marcas; o computador grava só pela função", async () => {
  const b = await cenario();
  const pc = await b.computador("mini");
  const team = await b.conta(pc, "team@exemplo.com", 10);
  await b.conta(pc, "max@exemplo.com", 10);
  await usar(b, pc, team);
  await semModelo(b, pc, team);
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal1" };
  assert.equal((await b.como(leitor, "select modelo from public.contas_sem_modelo")).length, 1);
  await assert.rejects(b.como(pc, "insert into public.contas_sem_modelo (conta_id, computador_id, modelo, ate) values ($1, $2, 'x', now())", [team, pc.pc]));
});
