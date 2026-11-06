// 0031: a troca que não fica presa numa conta cheia, a conta pausada que sai de uso e o remover conta (relato do Paulo,
// 06/11/2026: a conta em uso ficou 47 minutos em 100% porque todas as outras estavam acima do aviso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ auto = true, aviso = 85, troca = 90 } = {}) {
  const b = await banco();
  await b.config("auto", auto);
  await b.config("modo", "limiar");
  await b.config("aviso", aviso);
  await b.config("troca", troca);
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

async function usar(b, pc, conta, motivo = "teste") {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, $3, now() - interval '1 hour')
               on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                                         decidido_em = excluded.decidido_em`, [pc.pc, conta, motivo]);
}

// a semana da conta (a janela de 5 h fica como a b.conta deixou)
async function semana(b, conta, pct) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
               values ($1, 'seven_day', $2, now() + interval '2 days', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, lido_em = now()`, [conta, pct]);
}

async function motivo(b, pc) {
  const [l] = await b.sql("select motivo from public.atribuicao where computador_id = $1", [pc.pc]);
  return l?.motivo ?? null;
}

test("em uso cheia e todas as outras acima do aviso: vai para a com mais folga (o caso das 11h43)", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const arthur = await b.conta(pc, "arthur@exemplo.com", 100, { prioridade: 110 });
  const contato = await b.conta(pc, "contato@exemplo.com", 0, { prioridade: 40 });
  await semana(b, contato, 85);
  const suelen = await b.conta(pc, "suelen@exemplo.com", 0, { prioridade: 50 });
  await semana(b, suelen, 87);
  const paulo = await b.conta(pc, "paulo@exemplo.com", 91, { prioridade: 80 });
  await usar(b, pc, arthur, "chegou a 90%");
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), contato, "a de 85% (só pela semana) é melhor que ficar em 100%");
  assert.equal(await motivo(b, pc), "chegou a 100%");
  void paulo;
});

test("no gatilho, sem livre abaixo do aviso: vai para a com mais folga abaixo do gatilho (não espera bater 100%)", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 90);
  const quase = await b.conta(pc, "quase@exemplo.com", 0);
  await semana(b, quase, 87);
  const menos = await b.conta(pc, "menos@exemplo.com", 0);
  await semana(b, menos, 86);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), menos);
  assert.equal(await motivo(b, pc), "chegou a 90%");
});

test("no gatilho, as outras acima do gatilho (e abaixo de 100%): fica, até a em uso encher", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 91);
  const outra = await b.conta(pc, "outra@exemplo.com", 93);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), atual, "93% não é melhor que 91%: não troca à toa");
  await b.sql("update public.uso_janelas set pct = 100, lido_em = now() where conta_id = $1 and tipo = 'five_hour'", [atual]);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), outra, "cheia: vai para a que ainda tem 7%");
});

test("a sessão bateu o limite: troca na hora mesmo sem livre abaixo do aviso e dentro da espera entre trocas", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 40);
  const outra = await b.conta(pc, "outra@exemplo.com", 88);
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now())`, [pc.pc, atual]);
  const r = await b.rpc(pc, "agente_limite", { p_conta: atual, p_sessao: null });
  assert.equal(r.ok, true);
  assert.equal(await b.atribuida(pc), outra);
  assert.equal(await motivo(b, pc), "a sessão bateu o limite");
});

test("sem nenhuma outra abaixo de 100%: fica e avisa que não há conta livre", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 100);
  const cheia = await b.conta(pc, "cheia@exemplo.com", 100);
  const pausada = await b.conta(pc, "pausada@exemplo.com", 0, { pausada: true });
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), atual);
  const [alerta] = await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'");
  assert.equal(alerta.n, 1);
  void cheia;
  void pausada;
});

test("a de reserva só entra depois das outras com folga abaixo do gatilho; e entra antes de ficar em 100%", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 90);
  const reserva = await b.conta(pc, "reserva@exemplo.com", 10, { reserva: true });
  const normal = await b.conta(pc, "normal@exemplo.com", 0);
  await semana(b, normal, 87);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), normal, "a normal com folga vem antes da reserva");

  await usar(b, pc, atual);
  await semana(b, normal, 95);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), reserva, "sem outra abaixo do gatilho, a reserva entra");
});

test("teto da semana, agenda e conta sem o modelo valem também no socorro", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 100);
  const comTeto = await b.conta(pc, "teto@exemplo.com", 0, { teto_semana: 80 });
  await semana(b, comTeto, 86);
  const semModelo = await b.conta(pc, "semmodelo@exemplo.com", 0);
  await semana(b, semModelo, 86);
  await b.sql(`insert into public.contas_sem_modelo (conta_id, computador_id, modelo, ate) values ($1, $2, 'fable', now() + interval '1 hour')`, [semModelo, pc.pc]);
  const fora = await b.conta(pc, "fora@exemplo.com", 0, { agenda: JSON.stringify([{ dias: [], de: "00:00", ate: "00:01" }]) });
  await semana(b, fora, 86);
  const boa = await b.conta(pc, "boa@exemplo.com", 0);
  await semana(b, boa, 88);
  await usar(b, pc, atual);
  await b.sql("select public.decidir($1)", [pc.pc]);
  assert.equal(await b.atribuida(pc), boa);
});

test("conta em uso pausada sai de uso na hora, mesmo com a troca automática desligada", async () => {
  const { b, admin } = await cenario({ auto: false });
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 88);
  await usar(b, pc, atual);
  const r = await b.rpc(admin, "painel_conta", { p_conta: atual, p_campos: { pausada: true } });
  assert.equal(r.ok, true);
  assert.equal(await b.atribuida(pc), outra, "o painel_conta decide na hora");
  assert.equal(await motivo(b, pc), "a conta em uso foi pausada");
});

test("pausar uma conta que não está em uso não mexe em ninguém", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 20);
  const parada = await b.conta(pc, "parada@exemplo.com", 5);
  await usar(b, pc, atual, "pedido pelo painel");
  await b.rpc(admin, "painel_conta", { p_conta: parada, p_campos: { pausada: true } });
  assert.equal(await b.atribuida(pc), atual);
  assert.equal(await motivo(b, pc), "pedido pelo painel");
});

test("remover conta: o computador vai antes para outra; depois do prazo a conta, o cofre e as janelas saem; o uso em tokens fica", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const atual = await b.conta(pc, "atual@exemplo.com", 30);
  const outra = await b.conta(pc, "outra@exemplo.com", 50);
  await usar(b, pc, atual);
  await b.sql(`insert into public.uso_tokens (hora, conta_id, computador_id, modelo, respostas, entrada, saida, usd)
               values (date_trunc('hour', now()), $1, $2, 'opus', 3, 100, 50, 1.5)`, [atual, pc.pc]);
  const r = await b.rpc(admin, "painel_remover_conta", { p_conta: atual });
  assert.equal(r.ok, true);
  assert.equal(await b.atribuida(pc), outra);
  assert.equal(await motivo(b, pc), "a conta em uso foi removida");
  // 0032: no prazo de desfazer a conta fica, pausada, com o cofre; nenhum computador apaga a cópia do login
  const [saindo] = await b.sql("select pausada, sai_em > now() as no_prazo from public.contas where id = $1", [atual]);
  assert.deepEqual(saindo, { pausada: true, no_prazo: true });
  assert.deepEqual(await b.rpc(pc, "agente_contas_removidas", {}), []);
  await b.sql("update public.contas set sai_em = now() - interval '1 second' where id = $1", [atual]);
  await b.sql("select public.vigiar()");
  const [contas] = await b.sql("select count(*)::int n from public.contas where id = $1", [atual]);
  assert.equal(contas.n, 0);
  const [cofre] = await b.sql("select count(*)::int n from public.cofre where conta_id = $1", [atual]);
  assert.equal(cofre.n, 0);
  const [tokens] = await b.sql("select count(*)::int n, count(conta_id)::int com_conta from public.uso_tokens");
  assert.deepEqual(tokens, { n: 1, com_conta: 0 }, "o uso fica, sem o nome da conta");
  const [aud] = await b.sql("select count(*)::int n from public.auditoria where acao = 'remover_conta' and alvo = $1", [atual]);
  assert.equal(aud.n, 1);

  // o computador lê a lista para apagar a cópia do login
  const removidas = await b.rpc(pc, "agente_contas_removidas", {});
  assert.deepEqual(removidas, [{ conta_id: atual, email: "atual@exemplo.com" }]);
});

test("remover a conta em uso sem outra para o computador: recusa e não mexe em nada", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const unica = await b.conta(pc, "unica@exemplo.com", 30);
  await usar(b, pc, unica);
  const r = await b.rpc(admin, "painel_remover_conta", { p_conta: unica });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não tem outra para ir/);
  assert.equal(await b.atribuida(pc), unica);
  const [contas] = await b.sql("select count(*)::int n, bool_and(not pausada and sai_em is null) as intacta from public.contas where id = $1", [unica]);
  assert.deepEqual(contas, { n: 1, intacta: true });
});

test("remover conta é só de administrador com duas etapas; a lista de removidas é só de computador", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "conta@exemplo.com", 30);
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal2" };
  await assert.rejects(b.rpc(leitor, "painel_remover_conta", { p_conta: conta }), /só administrador/);
  await assert.rejects(b.rpc(leitor, "painel_desfazer_remocao", { p_conta: conta }), /só administrador/);
  // administrador que ativou as duas etapas precisa do código na sessão (aal2)
  await b.sql("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [admin.id]);
  await assert.rejects(b.rpc({ id: admin.id, aal: "aal1" }, "painel_remover_conta", { p_conta: conta }), /duas etapas/);
  await assert.rejects(b.rpc(leitor, "agente_contas_removidas", {}));
  const [contas] = await b.sql("select count(*)::int n from public.contas where id = $1", [conta]);
  assert.equal(contas.n, 1);
});
