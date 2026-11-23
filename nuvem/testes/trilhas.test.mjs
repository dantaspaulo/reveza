// 0038/0039: as trilhas. A empresa separada usa só as contas dela (e o transbordo), numa trilha por computador; a
// conta do computador (a principal) deixa de usar as contas que são só de empresas separadas. Sem empresa separada,
// nada muda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ auto = true } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("mini");
  await b.config("auto", auto);
  await b.config("modo", "limiar");
  return { b, admin, leitor, pc };
}

async function empresa(b, admin, nome, campos = {}) {
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome, ...campos } });
  assert.equal(r.ok, true);
  return r.id;
}

const mudar = (b, admin, id, campos) => b.rpc(admin, "painel_empresa", { p_id: id, p_campos: campos });
const marcar = (b, admin, conta, lista) => b.rpc(admin, "painel_conta_empresas", { p_conta: conta, p_lista: lista });
const lista = (ids) => `{${ids.join(",")}}`;
const pedir = (b, pc, ids) => b.rpc(pc, "agente_trilhas", { p_empresas: lista(ids) });

async function usar(b, pc, conta) {
  await b.sql("insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em) values ($1, $2, 'teste', now() - interval '1 hour')", [pc.pc, conta]);
}

async function pct(b, conta, valor) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte) values ($1, 'five_hour', $2, now() + interval '2 hours', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em, lido_em = now()`, [conta, valor]);
}

async function trilha(b, pc, emp) {
  const [l] = await b.sql("select conta_id from public.atribuicao_trilhas where computador_id = $1 and empresa_id = $2", [pc.pc, emp]);
  return l?.conta_id ?? null;
}

// a última decisão da trilha fica para trás, como se a espera entre trocas tivesse passado
const esperar = (b) => b.sql("update public.atribuicao_trilhas set decidido_em = now() - interval '1 hour'");

test("sem empresa separada nada muda: a principal usa a conta marcada e nenhuma trilha nasce", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa");
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [x]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  const r = await pedir(b, pc, [x]);
  assert.deepEqual(r, { ok: true, trilhas: [] });
  assert.equal((await b.sql("select count(*)::int n from public.atribuicao_trilhas"))[0].n, 0);
  const ola = await b.rpc(pc, "agente_ola", { p_versao: "0.17.0" });
  assert.equal(ola.trilhas, false);
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas, []);
  assert.deepEqual(emp.regras, []);
});

test("separar: a principal sai da conta que ficou só da empresa e não a pega de novo; conta de duas empresas segue livre", async () => {
  const { b, admin, pc } = await cenario({ auto: false });
  const x = await empresa(b, admin, "Alfa");
  const y = await empresa(b, admin, "Beta");
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  const d = await b.conta(pc, "d@exemplo.com", 40);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, d, [x, y]);
  await usar(b, pc, a);
  // ligar "separar" decide na hora, mesmo com a troca automática desligada
  await mudar(b, admin, x, { separar: true });
  assert.equal(await b.atribuida(pc), c);
  const [ev] = await b.sql("select dados from public.eventos where tipo = 'troca' order by id desc limit 1");
  assert.equal(ev.dados.motivo, "a conta em uso agora é só de empresas separadas");
  const cand = (await b.sql("select conta_id from public.rvz_candidatas($1)", [pc.pc])).map((l) => l.conta_id);
  assert.ok(!cand.includes(a), "a principal não escolhe a conta só da empresa separada");
  assert.ok(cand.includes(d), "a conta marcada também para uma empresa não separada segue na principal");
  // o computador novo não pega como dele a conta só da empresa
  const pc2 = await b.computador("novo");
  await b.rpc(pc2, "agente_ola", { p_versao: "0.18.0", p_conta_local: "a@exemplo.com" });
  assert.equal(await b.atribuida(pc2), null);
  const ola = await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  assert.equal(ola.trilhas, true);
});

test("a trilha pega a conta da empresa, troca no gatilho, vai ao transbordo e volta quando uma da empresa fica livre", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true, transbordo: "qualquer" });
  const y = await empresa(b, admin, "Beta", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const a2 = await b.conta(pc, "a2@exemplo.com", 20);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const d = await b.conta(pc, "d@exemplo.com", 1);
  const e = await b.conta(pc, "e@exemplo.com", 40);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, a2, [x]);
  await marcar(b, admin, d, [y]);
  await usar(b, pc, c);

  let r = await pedir(b, pc, [x]);
  assert.equal(r.trilhas.length, 1);
  assert.equal(r.trilhas[0].empresa, x);
  assert.equal(r.trilhas[0].conta_id, a, "a da empresa menos usada");
  assert.equal(r.trilhas[0].motivo, "trilha nova");
  assert.equal(await b.atribuida(pc), c, "a principal não muda");

  // no gatilho, só depois da espera entre trocas
  await pct(b, a, 96);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a, "dentro da espera entre trocas fica");
  await esperar(b);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a2);

  // cheia: as da empresa não servem; o transbordo "qualquer" pega a livre que a principal poderia usar (não a d, que é
  // só da Beta, nem a c, que está na principal)
  await pct(b, a2, 100);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), e);

  // a da empresa ficou livre: volta, depois da espera
  await pct(b, a, 10);
  await esperar(b);
  r = await pedir(b, pc, [x]);
  assert.equal(r.trilhas[0].conta_id, a);
  // a 0041 redefine a função com o texto que serve também a projeto
  assert.equal(r.trilhas[0].motivo, "voltou para uma conta da empresa ou do projeto");
  const [ev] = await b.sql("select dados from public.eventos where tipo = 'troca' and dados ->> 'empresa' is not null order by id desc limit 1");
  assert.equal(ev.dados.empresa, x);
  assert.equal(ev.dados.de, e);
  assert.equal(ev.dados.para, a);
});

test("transbordo nenhum fica na da empresa mesmo cheia; escolhidas usa só a lista", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true, transbordo: "nenhum" });
  const a = await b.conta(pc, "a@exemplo.com", 100);
  const e = await b.conta(pc, "e@exemplo.com", 30);
  await b.conta(pc, "f@exemplo.com", 1);
  await marcar(b, admin, a, [x]);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a, "trilha nova sem conta livre fica com a da empresa, mesmo cheia");
  await mudar(b, admin, x, { transbordo: "escolhidas", transbordo_contas: [e] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), e, "a da lista, não a menos usada de fora dela");
});

test("a mesma conta nunca fica numa trilha e numa principal, nem em duas trilhas; sem conta, um alerta por hora", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [x]);
  await usar(b, pc, c);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  // à mão, pelo painel e pela API: recusado com o motivo
  const p = await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: a });
  assert.equal(p.ok, false);
  assert.match(p.erro, /empresas separadas|trilha/);
  const api = await b.rpc("servico", "api_trocar", { p_user: admin.id, p_computador: pc.pc, p_conta: a });
  assert.equal(api.ok, false);
  await b.sql("select public.rvz_atribuir($1, $2, 'teste')", [pc.pc, a]);
  assert.equal(await b.atribuida(pc), c, "o rvz_atribuir não põe na principal a conta da trilha");
  // outro computador: a conta da trilha do primeiro não serve; sem outra, a trilha não nasce e sai um alerta só
  const pc2 = await b.computador("outro");
  let r = await pedir(b, pc2, [x]);
  assert.deepEqual(r.trilhas, []);
  r = await pedir(b, pc2, [x]);
  assert.deepEqual(r.trilhas, []);
  const [{ n }] = await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'trilha_sem_conta'");
  assert.equal(n, 1);
  await b.sql("select public.rvz_atribuir_trilha($1, $2, $3, 'teste')", [pc2.pc, x, a]);
  assert.equal(await trilha(b, pc2, x), null, "o rvz_atribuir_trilha não põe a mesma conta em duas trilhas");
});

test("limite numa conta de trilha troca a trilha, não a principal; a posse de uso vale para ela", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const a2 = await b.conta(pc, "a2@exemplo.com", 20);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, a2, [x]);
  await usar(b, pc, c);
  await pedir(b, pc, [x]);
  const posse = await b.rpc(pc, "agente_pegar_posse", { p_conta: a, p_motivo: "uso" });
  assert.equal(posse.ok, true);
  assert.ok(posse.cofre, "a conta da trilha vem com o login");
  const pc2 = await b.computador("outro");
  const alheia = await b.rpc(pc2, "agente_pegar_posse", { p_conta: a, p_motivo: "leitura" });
  assert.equal(alheia.ok, false, "a conta da trilha de outro computador não se lê aqui");
  const fora = await b.rpc(pc, "agente_pegar_posse", { p_conta: a2, p_motivo: "uso" });
  assert.equal(fora.ok, false, "posse de uso só para a conta atribuída");

  const r = await b.rpc(pc, "agente_limite", { p_conta: a });
  assert.equal(r.ok, true);
  assert.equal(r.empresa, x);
  assert.equal(r.versao, 2);
  assert.equal(await trilha(b, pc, x), a2);
  assert.equal(await b.atribuida(pc), c);
  const [j] = await b.sql("select pct::float pct from public.uso_janelas where conta_id = $1 and tipo = 'five_hour'", [a]);
  assert.equal(j.pct, 100);
  // o limite da conta da principal segue como antes
  const p = await b.rpc(pc, "agente_limite", { p_conta: c });
  assert.equal(p.ok, true);
  assert.equal(p.empresa, undefined);
});

test("a trilha que o computador ligado não pede há 10 minutos sai; com ele desligado, fica", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  await marcar(b, admin, a, [x]);
  await pedir(b, pc, [x]);
  await b.sql("update public.atribuicao_trilhas set pedida_em = now() - interval '11 minutes'");
  await b.sql("update public.computadores set visto_em = now() - interval '10 minutes'");
  await b.sql("select public.decidir()");
  assert.equal(await trilha(b, pc, x), a, "computador desligado: a trilha fica");
  await b.sql("update public.computadores set visto_em = now()");
  // pedida de novo, não sai
  await pedir(b, pc, [x]);
  await b.sql("select public.decidir()");
  assert.equal(await trilha(b, pc, x), a);
  await b.sql("update public.atribuicao_trilhas set pedida_em = now() - interval '11 minutes'");
  await b.sql("select public.decidir()");
  assert.equal(await trilha(b, pc, x), null);
  const [ev] = await b.sql("select dados from public.eventos where tipo = 'troca' order by id desc limit 1");
  assert.equal(ev.dados.motivo, "trilha sem sessão");
  assert.equal(ev.dados.para, null);
});

test("desligar separar deixa a trilha como está até a última sessão; a empresa com trilha não se apaga", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const a2 = await b.conta(pc, "a2@exemplo.com", 20);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, a2, [x]);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  await mudar(b, admin, x, { separar: false });
  await pct(b, a, 100);
  await esperar(b);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a, "sem troca: as sessões abertas seguem no mesmo login");
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, []);
  const cand = (await b.sql("select conta_id from public.rvz_candidatas($1)", [pc.pc])).map((l) => l.conta_id);
  assert.ok(!cand.includes(a), "enquanto está na trilha, a principal não a pega");
  const apagar = await b.rpc(admin, "painel_empresa_apagar", { p_id: x });
  assert.equal(apagar.ok, false);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 1);
  await b.sql("update public.atribuicao_trilhas set pedida_em = now() - interval '11 minutes'");
  await b.sql("select public.decidir()");
  assert.equal(await trilha(b, pc, x), null);
  assert.equal((await b.rpc(admin, "painel_empresa_apagar", { p_id: x })).ok, true);
});

test("painel: separar só verdadeiro ou falso e só pelo administrador; revogar o computador tira as trilhas dele", async () => {
  const { b, admin, leitor, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa");
  await assert.rejects(mudar(b, leitor, x, { separar: true }));
  await assert.rejects(mudar(b, admin, x, { separar: "sim" }), /separar/);
  assert.equal((await b.sql("select separar from public.empresas"))[0].separar, false);
  await mudar(b, admin, x, { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  await marcar(b, admin, a, [x]);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  await b.rpc(admin, "painel_revogar_computador", { p_computador: pc.pc });
  assert.equal((await b.sql("select count(*)::int n from public.atribuicao_trilhas"))[0].n, 0);
});

test("o agente: só computador pede trilha, lista com no máximo 50; recebe só as empresas separadas e as regras delas", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const y = await empresa(b, admin, "Beta");
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: "~/Code/alfa", p_empresa: x });
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: "~/Code/beta", p_empresa: y });
  await assert.rejects(b.rpc(admin, "agente_trilhas", { p_empresas: lista([x]) }));
  await assert.rejects(b.rpc(admin, "agente_empresas"));
  await assert.rejects(pedir(b, pc, Array.from({ length: 51 }, () => x)), /lista/);
  const r = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(r.empresas.map(({ id, nome }) => ({ id, nome })), [{ id: x, nome: "Alfa" }]);
  assert.deepEqual(r.regras, [{ tipo: "pasta", padrao: "~/Code/alfa", empresa: x }]);
  assert.equal(r.computador_id, pc.pc);
  // ninguém de fora lê a tabela das trilhas
  await assert.rejects(b.como("anon", "select * from public.atribuicao_trilhas"));
});

test("a conta que sai do Reveza passa a trilha para outra antes", async () => {
  const { b, admin, pc } = await cenario();
  const x = await empresa(b, admin, "Alfa", { separar: true });
  const a = await b.conta(pc, "a@exemplo.com", 10);
  const a2 = await b.conta(pc, "a2@exemplo.com", 20);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, a2, [x]);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  await b.sql("update public.contas set sai_em = now() - interval '1 second' where id = $1", [a]);
  await b.sql("select public.rvz_purgar_contas_saindo()");
  assert.equal(await trilha(b, pc, x), a2);
  assert.equal((await b.sql("select count(*)::int n from public.contas where id = $1", [a]))[0].n, 0);
});
