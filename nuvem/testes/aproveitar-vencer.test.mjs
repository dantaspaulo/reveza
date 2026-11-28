// 0051: usar primeiro a conta cuja semana vai renovar com sobra (desligado de fábrica). Com `aproveitar_vencer`
// ligado, entre as candidatas livres, a que renova a semana em até `aproveitar_horas` e tem 20 pontos de folga até o
// gatilho de troca vem antes; a preferida, a reserva e a preferida de outro computador seguem na frente, e o socorro
// (todas acima do aviso) não muda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ ligar = true, horas = null } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("mini");
  await b.config("auto", true);
  await b.config("modo", "limiar");
  if (ligar) await b.config("aproveitar_vencer", true);
  if (horas !== null) await b.config("aproveitar_horas", horas);
  return { b, admin, leitor, pc };
}

// A janela da semana: uso e em quantas horas renova (negativo: já renovou; null: sem reset).
async function semana(b, conta, pct, horas) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
               values ($1, 'seven_day', $2, case when $3::numeric is null then null else now() + make_interval(secs => ($3::numeric * 3600)::int) end,
                       case when $3::numeric is not null and $3::numeric < 0 then now() + make_interval(secs => ($3::numeric * 3600)::int) - interval '1 hour' else now() end, 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em, lido_em = excluded.lido_em`,
  [conta, pct, horas]);
}

const primeira = async (b, pc, ordem = "preferencia") =>
  (await b.sql("select conta_id from public.rvz_candidatas($1, $2) limit 1", [pc.pc, ordem]))[0]?.conta_id ?? null;

// A renova em 10 h com 60 de sobra; B em 5 dias, quase sem uso. Hoje a menos usada (B) vem primeiro.
async function duas(b, pc, { pct5A = 5 } = {}) {
  const a = await b.conta(pc, "a@exemplo.com", pct5A);
  const bb = await b.conta(pc, "b@exemplo.com", 5);
  await semana(b, a, 40, 10);
  await semana(b, bb, 10, 120);
  return { a, bb };
}

test("desligado (de fábrica): a ordem é a de antes, a menos usada primeiro", async () => {
  const { b, pc } = await cenario({ ligar: false });
  const { bb } = await duas(b, pc);
  assert.equal(await primeira(b, pc), bb);
});

test("ligado: a conta que renova a semana logo, com sobra, vem antes da menos usada, também no decidir", async () => {
  const { b, pc } = await cenario();
  const x = await b.conta(pc, "x@exemplo.com", 96);
  const { a } = await duas(b, pc);
  assert.equal(await primeira(b, pc), a);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now() - interval '1 hour')", [pc.pc, x]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
});

test("ligado: fora da janela de horas a ordem é a de antes; a janela vem da configuração", async () => {
  const { b, pc } = await cenario({ horas: 12 });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const bb = await b.conta(pc, "b@exemplo.com", 5);
  await semana(b, a, 40, 20);
  await semana(b, bb, 10, 120);
  assert.equal(await primeira(b, pc), bb, "renova em 20 h, janela de 12 h");
  await b.config("aproveitar_horas", 24);
  assert.equal(await primeira(b, pc), a, "renova em 20 h, janela de 24 h");
  await semana(b, a, 40, 60);
  await b.config("aproveitar_horas", 48);
  assert.equal(await primeira(b, pc), bb, "renova em 60 h, janela de 48 h (a de fábrica)");
});

test("ligado: entre duas que vencem, a que renova antes", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await semana(b, a, 20, 30);
  await semana(b, c, 50, 6);
  assert.equal(await primeira(b, pc), c);
});

test("ligado: a que vence sem 20 pontos de folga até o gatilho não passa na frente (daria outra troca logo)", async () => {
  const { b, pc } = await cenario();
  const { a, bb } = await duas(b, pc, { pct5A: 80 });
  assert.equal(await primeira(b, pc), bb, "5 h em 80 e gatilho 95: só 15 pontos");
  await b.sql(`update public.uso_janelas set pct = 75 where conta_id = $1 and tipo = 'five_hour'`, [a]);
  assert.equal(await primeira(b, pc), a, "5 h em 75: 20 pontos");
  await b.config("modo", "limite");
  await b.sql(`update public.uso_janelas set pct = 80 where conta_id = $1 and tipo = 'five_hour'`, [a]);
  assert.equal(await primeira(b, pc), a, "no modo limite o gatilho é 100");
});

test("ligado: semana já renovada, sem reset ou sem número não conta como a vencer", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 20);
  const bb = await b.conta(pc, "b@exemplo.com", 5);
  await semana(b, bb, 10, 120);
  await semana(b, a, 40, -1);
  assert.equal(await primeira(b, pc), bb, "renovou há 1 h");
  await semana(b, a, 40, null);
  assert.equal(await primeira(b, pc), bb, "sem reset");
  await b.sql("update public.uso_janelas set pct = null, reset_em = now() + interval '10 hours' where conta_id = $1 and tipo = 'seven_day'", [a]);
  assert.equal(await primeira(b, pc), bb, "sem número da semana");
});

test("ligado: a preferida, a reserva e a preferida de outro computador seguem como antes", async () => {
  const { b, pc } = await cenario();
  const { a, bb } = await duas(b, pc);
  await b.sql("update public.computadores set conta_preferida = $2 where id = $1", [pc.pc, bb]);
  assert.equal(await primeira(b, pc), bb, "a preferida deste computador vem antes");
  await b.sql("update public.computadores set conta_preferida = null where id = $1", [pc.pc]);
  await b.sql("update public.contas set reserva = true where id = $1", [a]);
  assert.equal(await primeira(b, pc), bb, "a reserva só sem outra");
  await b.sql("update public.contas set reserva = false where id = $1", [a]);
  const outro = await b.computador("air");
  await b.sql("update public.computadores set conta_preferida = $2, visto_em = now() where id = $1", [outro.pc, a]);
  assert.equal(await primeira(b, pc), bb, "a preferida de outro computador ligado vai por último");
});

test("ligado: a que vence vem antes da mesma organização com folga", async () => {
  const { b, pc } = await cenario();
  const x = await b.conta(pc, "x@exemplo.com", 50);
  const { a, bb } = await duas(b, pc);
  await b.sql("update public.contas set organizacao = 'Outra' where id = $1", [a]);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now())", [pc.pc, x]);
  assert.equal((await b.sql("select public.rvz_mesma_org($1, $2) m", [bb, pc.pc]))[0].m, true);
  assert.equal(await primeira(b, pc), a);
});

test("ligado: no rodízio a que vence vem antes do sorteio e do menor uso", async () => {
  const { b, pc } = await cenario();
  const { a } = await duas(b, pc);
  assert.equal(await primeira(b, pc, "menor_uso"), a);
  for (let i = 0; i < 5; i++) assert.equal(await primeira(b, pc, "aleatoria"), a);
});

test("ligado: com todas acima do aviso, o socorro segue pela de mais folga", async () => {
  const { b, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 93);
  const bb = await b.conta(pc, "b@exemplo.com", 91);
  await semana(b, a, 40, 10);
  await semana(b, bb, 10, 120);
  const [s] = await b.sql("select conta_id from public.rvz_socorro($1, 95) limit 1", [pc.pc]);
  assert.equal(s.conta_id, bb);
});

test("ligado: conta com teto da semana só passa na frente com 20 pontos de folga até o teto", async () => {
  const { b, pc } = await cenario();
  const { a, bb } = await duas(b, pc);
  await b.sql("update public.contas set teto_semana = 50 where id = $1", [a]);
  assert.equal(await primeira(b, pc), bb, "40 de 50: sem os 20 pontos até o teto");
  await b.sql("update public.contas set teto_semana = 60 where id = $1", [a]);
  assert.equal(await primeira(b, pc), a, "40 de 60: tem os 20 pontos");
});

test("prazo gravado com decimal zero (72.0) não derruba a escolha; o painel grava o número inteiro", async () => {
  const { b, admin, pc } = await cenario();
  const { a } = await duas(b, pc);
  await b.sql(`insert into public.config (chave, valor) values ('aproveitar_horas', '72.0'::jsonb)
               on conflict (chave) do update set valor = excluded.valor`);
  assert.equal(await primeira(b, pc), a);
  await b.sql("select public.decidir()");
  await b.como(admin, "select public.painel_config('aproveitar_horas', '96.0'::jsonb)");
  const [l] = await b.sql("select valor::text as v from public.config where chave = 'aproveitar_horas'");
  assert.equal(l.v, "96");
});

async function projeto(b, admin, pc) {
  // a principal já tem conta, para o decidir de quem salva o projeto não pegar uma das duas
  const x = await b.conta(pc, "x@exemplo.com", 50);
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now() - interval '1 hour')", [pc.pc, x]);
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Alfa" } });
  assert.equal(r.ok, true);
  const { a, bb } = await duas(b, pc);
  for (const conta of [a, bb]) {
    await b.rpc(admin, "painel_conta_empresas", { p_conta: conta, p_lista: [r.id] });
  }
  await b.rpc(admin, "painel_empresa", { p_id: r.id, p_campos: { separar: true } });
  return { emp: r.id, a, bb };
}

test("trilha e sombra de um projeto: a que vence vem antes entre as contas dele", async () => {
  const { b, admin, pc } = await cenario();
  const { emp, a } = await projeto(b, admin, pc);
  const [t] = await b.sql("select conta_id from public.rvz_candidatas_trilha($1, $2, 90, false) limit 1", [pc.pc, emp]);
  assert.equal(t.conta_id, a, "trilha");
  const [s] = await b.sql("select conta_id from public.rvz_candidatas_sombra($1, $2, 90, false) limit 1", [pc.pc, emp]);
  assert.equal(s.conta_id, a, "sombra");
});

test("trilha e sombra no socorro (teto acima do aviso ou sem teto): a de mais folga, como antes", async () => {
  const { b, admin, pc } = await cenario();
  const { emp, bb } = await projeto(b, admin, pc);
  for (const teto of [95, 100]) {
    const [t] = await b.sql("select conta_id from public.rvz_candidatas_trilha($1, $2, $3, false) limit 1", [pc.pc, emp, teto]);
    assert.equal(t.conta_id, bb, `trilha ${teto}`);
    const [s] = await b.sql("select conta_id from public.rvz_candidatas_sombra($1, $2, $3, false) limit 1", [pc.pc, emp, teto]);
    assert.equal(s.conta_id, bb, `sombra ${teto}`);
  }
  const [s] = await b.sql("select conta_id from public.rvz_candidatas_sombra($1, $2, null, false) limit 1", [pc.pc, emp]);
  assert.equal(s.conta_id, bb, "sombra sem teto");
});

test("trilha e sombra, desligado: a ordem é a de antes", async () => {
  const { b, admin, pc } = await cenario({ ligar: false });
  const { emp, bb } = await projeto(b, admin, pc);
  const [t] = await b.sql("select conta_id from public.rvz_candidatas_trilha($1, $2, 90, false) limit 1", [pc.pc, emp]);
  assert.equal(t.conta_id, bb, "trilha");
  const [s] = await b.sql("select conta_id from public.rvz_candidatas_sombra($1, $2, 90, false) limit 1", [pc.pc, emp]);
  assert.equal(s.conta_id, bb, "sombra");
});

test("painel: o administrador liga e ajusta as horas; valor errado e quem só lê são recusados", async () => {
  const { b, admin, leitor } = await cenario({ ligar: false });
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "aproveitar_vencer", p_valor: true })).ok, true);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "aproveitar_horas", p_valor: 72 })).ok, true);
  const cfg = await b.sql("select chave, valor from public.config where chave like 'aproveitar%' order by chave");
  assert.deepEqual(cfg.map((l) => [l.chave, l.valor]), [["aproveitar_horas", 72], ["aproveitar_vencer", true]]);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aproveitar_vencer", p_valor: "sim" }), /verdadeiro ou falso/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aproveitar_horas", p_valor: 6 }), /12 a 168 horas/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aproveitar_horas", p_valor: 200 }), /12 a 168 horas/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aproveitar_horas", p_valor: "48" }), /12 a 168 horas/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aproveitar_horas", p_valor: 48.5 }), /12 a 168 horas/);
  await assert.rejects(b.rpc(leitor, "painel_config", { p_chave: "aproveitar_vencer", p_valor: false }));
});

test("a função interna não é chamada de fora", async () => {
  const { b, pc } = await cenario();
  const { a } = await duas(b, pc);
  await assert.rejects(b.como(pc, "select public.rvz_vence_logo($1)", [a]), /permission denied/);
  await assert.rejects(b.como("anon", "select public.rvz_vence_logo($1)", [a]), /permission denied/);
});
