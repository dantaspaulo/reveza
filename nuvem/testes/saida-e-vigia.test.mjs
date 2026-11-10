// 0034: a conta marcada para sair saía nunca (o uso de tokens dela batia na chave única com o de outra conta removida,
// e a vigiar() inteira falhava de 2 em 2 minutos desde 07/11/2026); um passo da vigia que falha não segura os outros; e
// conta esgotada não entra à mão pelo painel (pedidos do Paulo, 09/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  await b.config("fuso", "UTC");
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

/** Uma hora de uso de tokens de uma conta (ou de conta removida, com null). */
async function uso(b, pc, conta, n) {
  await b.sql(`insert into public.uso_tokens (hora, conta_id, computador_id, projeto, modelo, respostas, entrada, saida,
                                              cache_escrita, cache_leitura, usd, agentes)
               values ('2026-10-22 18:00:00+00', $1, $2, 'memoria', 'opus', $3::int, $3::int, $3::int, $3::int, $3::int, $3::int, $3::int)`,
              [conta, pc.pc, n]);
}

async function removerJa(b, admin, conta) {
  assert.equal((await b.rpc(admin, "painel_remover_conta", { p_conta: conta })).ok, true);
  await b.sql("update public.contas set sai_em = now() - interval '1 second' where id = $1", [conta]);
}

test("conta removida com uso na mesma hora de outra já removida: sai, e o uso das duas soma na linha sem conta", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const primeira = await b.conta(pc, "primeira@exemplo.com", 20);
  const segunda = await b.conta(pc, "segunda@exemplo.com", 20);
  await b.conta(pc, "fica@exemplo.com", 20);
  await uso(b, pc, primeira, 2);
  await uso(b, pc, segunda, 3);
  await removerJa(b, admin, primeira);
  await b.sql("select public.vigiar()");
  await removerJa(b, admin, segunda);
  await b.sql("select public.vigiar()");
  const contas = await b.sql("select email from public.contas order by email");
  assert.deepEqual(contas.map((c) => c.email), ["fica@exemplo.com"], "as duas saíram");
  const linhas = await b.sql(`select conta_id, respostas, entrada::int as entrada, saida::int as saida, cache_escrita::int as cache_escrita,
                                     cache_leitura::int as cache_leitura, usd::int as usd, agentes from public.uso_tokens`);
  assert.deepEqual(linhas, [{ conta_id: null, respostas: 5, entrada: 5, saida: 5, cache_escrita: 5, cache_leitura: 5, usd: 5, agentes: 5 }],
    "nada do uso se perde");
  const erros = await b.sql("select texto from public.eventos where tipo = 'erro'");
  assert.deepEqual(erros, []);
});

test("um passo da vigia que falha vira um erro por hora e não segura os outros (a remoção e os alertas seguem)", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const sai = await b.conta(pc, "sai@exemplo.com", 20);
  const semLogin = await b.conta(pc, "sem-login@exemplo.com", 20, { precisa_login: true });
  await b.conta(pc, "fica@exemplo.com", 20);
  await removerJa(b, admin, sai);
  await b.sql(`create or replace function public.rvz_vigiar_folga() returns integer language plpgsql as $$
               begin raise exception 'folga quebrada'; end $$`);
  await b.sql("select public.vigiar()");
  await b.sql("select public.vigiar()");
  const [n] = await b.sql("select count(*)::int as n from public.contas where id = $1", [sai]);
  assert.equal(n.n, 0, "a remoção não esperou a folga");
  const alertas = await b.sql("select dados ->> 'conta' as conta from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'precisa_login'");
  assert.deepEqual(alertas, [{ conta: semLogin }]);
  const erros = await b.sql("select texto, dados ->> 'vigia' as vigia from public.eventos where tipo = 'erro'");
  assert.deepEqual(erros, [{ texto: 'A vigia da nuvem falhou em "folga": folga quebrada', vigia: "folga" }], "um só, não um a cada volta");
});

test("Usar agora e Trocar conta agora recusam conta esgotada (5 horas ou semana em 100% sem renovar); renovada, aceitam", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const semana = await b.conta(pc, "semana@exemplo.com", 10);
  const cinco = await b.conta(pc, "cinco@exemplo.com", 100);
  const fable = await b.conta(pc, "fable@exemplo.com", 10);
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
               values ($1, 'seven_day', 100, now() + interval '2 days', now() - interval '3 hours', 'api'),
                      ($2, 'seven_day_fable', 100, now() + interval '2 days', now(), 'api')`, [semana, fable]);
  for (const conta of [semana, cinco]) {
    const r = await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: conta });
    assert.deepEqual(r, { ok: false, erro: "conta esgotada: espere a janela renovar" }, "a leitura velha da semana também vale");
  }
  assert.equal((await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: fable })).ok, true,
    "a semana de um modelo não esgota a conta");
  await b.sql("update public.uso_janelas set reset_em = now() - interval '1 minute' where conta_id = $1", [cinco]);
  assert.equal((await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: cinco })).ok, true);
  assert.equal(await b.atribuida(pc), cinco);
});
