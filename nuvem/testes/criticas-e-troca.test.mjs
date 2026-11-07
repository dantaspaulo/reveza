// 0033: sessões críticas na config, a leitura velha que escondia a semana cheia e a troca que prefere a mesma
// organização (pedidos do Paulo, 07/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  await b.config("auto", true);
  await b.config("modo", "limiar");
  await b.config("aviso", 90);
  await b.config("troca", 95);
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

async function usar(b, pc, conta) {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, 'teste', now() - interval '1 hour')
               on conflict (computador_id) do update set conta_id = excluded.conta_id, decidido_em = excluded.decidido_em`,
  [pc.pc, conta]);
}

async function janela(b, conta, tipo, pct, { lidoHaMin = 0, resetEmMin = 120 } = {}) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
               values ($1, $2, $3, now() + make_interval(mins => $5), now() - make_interval(mins => $4), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em,
                                                         lido_em = excluded.lido_em`,
  [conta, tipo, pct, lidoHaMin, resetEmMin]);
}

const efetivo = async (b, conta) => (await b.sql("select public.rvz_pct_efetivo($1) as p", [conta]))[0].p;
const org = (b, conta, nome) => b.sql("update public.contas set organizacao = $2 where id = $1", [conta, nome]);

test("sessões críticas: o painel liga e ajusta o gatilho, e o computador recebe pelo agente_ola", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "criticas", p_valor: true })).ok, true);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "criticas_gatilho", p_valor: 80 })).ok, true);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "criticas_gatilho", p_valor: 40 }), /50 a 95/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "criticas", p_valor: "sim" }), /verdadeiro ou falso/);
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  await assert.rejects(b.rpc(leitor, "painel_config", { p_chave: "criticas", p_valor: false }));
  const r = await b.rpc(pc, "agente_ola", { p_versao: "0.15.0" });
  assert.equal(r.config.criticas, true);
  assert.equal(r.config.criticas_gatilho, 80);
});

test("leitura velha: a semana cheia que não renovou continua valendo, mesmo com a de 5 horas já renovada", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const cheia = await b.conta(pc, "contato@exemplo.com", 0);
  // a de 5 horas renovou há pouco; a da semana foi lida há 2 horas em 100% e só renova em 2 dias
  await janela(b, cheia, "five_hour", 80, { lidoHaMin: 120, resetEmMin: -10 });
  await janela(b, cheia, "seven_day", 100, { lidoHaMin: 120, resetEmMin: 2 * 24 * 60 });
  assert.equal(Number(await efetivo(b, cheia)), 100, "antes da 0033 dava 0 e a conta era escolhida");

  const atual = await b.conta(pc, "atual@exemplo.com", 96);
  const livre = await b.conta(pc, "livre@exemplo.com", 30);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), livre);
});

test("leitura velha sem nenhuma recente: a conta continua sem número (não é candidata)", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const velha = await b.conta(pc, "velha@exemplo.com", 0);
  await janela(b, velha, "five_hour", 10, { lidoHaMin: 120, resetEmMin: 60 });
  assert.equal(await efetivo(b, velha), null);
});

test("leitura recente acima do piso: vale a recente", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const c = await b.conta(pc, "c@exemplo.com", 70);
  await janela(b, c, "seven_day", 40, { lidoHaMin: 60, resetEmMin: 3 * 24 * 60 });
  assert.equal(Number(await efetivo(b, c)), 70);
});

test("troca: a da mesma organização vem antes, se tiver folga de verdade", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@alfa.exemplo", 96, { prioridade: 10 });
  const outraOrg = await b.conta(pc, "zero@beta.exemplo", 0, { prioridade: 20 });
  const mesmaOrg = await b.conta(pc, "colega@alfa.exemplo", 40, { prioridade: 30 });
  await org(b, atual, "Alfa");
  await org(b, outraOrg, "Beta");
  await org(b, mesmaOrg, "Alfa");
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), mesmaOrg, "a conversa guardada da organização continua valendo");
});

test("troca: a da mesma organização quase cheia perde para a outra (daria outra troca logo)", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@alfa.exemplo", 96, { prioridade: 10 });
  const outraOrg = await b.conta(pc, "zero@beta.exemplo", 0, { prioridade: 20 });
  const quase = await b.conta(pc, "quase@alfa.exemplo", 70, { prioridade: 30 });
  await org(b, atual, "Alfa");
  await org(b, outraOrg, "Beta");
  await org(b, quase, "Alfa");
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), outraOrg);
});

test("troca: a preferida do computador ainda vem antes da mesma organização", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@alfa.exemplo", 96);
  const preferida = await b.conta(pc, "pref@beta.exemplo", 50);
  const mesmaOrg = await b.conta(pc, "colega@alfa.exemplo", 10);
  await org(b, atual, "Alfa");
  await org(b, preferida, "Beta");
  await org(b, mesmaOrg, "Alfa");
  await b.sql("update public.computadores set conta_preferida = $2 where id = $1", [pc.pc, preferida]);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), preferida);
});
