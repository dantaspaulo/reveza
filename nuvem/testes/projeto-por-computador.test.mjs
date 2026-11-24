// 0045 e 0046: cada projeto roda só nos computadores escolhidos. Em outro computador ele não aparece, não recebe regra e
// não abre trilha. A conta continua em um login só: a marcada para um projeto sai de onde estiver, e só ela sai.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ miniVersao = "0.20.0", airVersao = "0.20.0" } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  await b.rpc(mini, "agente_ola", { p_versao: miniVersao });
  await b.rpc(air, "agente_ola", { p_versao: airVersao });
  await b.config("auto", true);
  await b.config("modo", "limiar");
  return { b, admin, mini, air };
}

const salvar = (b, admin, id, campos) => b.rpc(admin, "painel_unidade", { p_id: id, p_campos: campos });

async function criar(b, admin, campos) {
  const r = await salvar(b, admin, null, campos);
  assert.equal(r.ok, true, r.erro);
  return r.id;
}

const pasta = (padrao, computador = null) => ({ tipo: "pasta", padrao, computador });
const pedir = (b, pc, ids) => b.rpc(pc, "agente_trilhas", { p_empresas: `{${ids.join(",")}}` });
const classificar = async (b, pc, p) => (await b.sql("select public.rvz_classificar($1, $2) as e", [pc.pc, p]))[0].e;
const atribuir = (b, pc, conta) => b.sql("select public.rvz_atribuir($1, $2, 'teste')", [pc.pc, conta]);
const soltarTrilha = (b, pc, emp) => b.sql("select public.rvz_atribuir_trilha($1, $2, null, 'trilha sem sessão')", [pc.pc, emp]);
const decidir = (b) => b.sql("select public.decidir()");
const contar = async (b, sql, params = []) => (await b.sql(`select count(*)::int n from ${sql}`, params))[0].n;

async function trilha(b, pc, emp) {
  const [l] = await b.sql("select conta_id from public.atribuicao_trilhas where computador_id = $1 and empresa_id = $2", [pc.pc, emp]);
  return l?.conta_id ?? null;
}

const pcsDe = async (b, id) =>
  (await b.sql("select computador_id from public.empresa_computadores where empresa_id = $1", [id])).map((l) => l.computador_id).sort();

async function ondeRoda(b, id) {
  const [{ t }] = await b.sql("select em_todos_computadores t from public.empresas where id = $1", [id]);
  return { todos: t, pcs: await pcsDe(b, id) };
}

// --------------------------------------------------------------------------------------- quem recebe o projeto

test("projeto só no mini: o air não recebe o projeto nem as regras dele", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc], pastas: [pasta("~/Code/alfa")] });
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc] });
  const noMini = await b.rpc(mini, "agente_empresas");
  assert.deepEqual(noMini.empresas.map((u) => u.id), [x]);
  assert.deepEqual(noMini.regras.map((r) => r.padrao), ["~/Code/alfa"]);
  const noAir = await b.rpc(air, "agente_empresas");
  assert.deepEqual(noAir.empresas, []);
  assert.deepEqual(noAir.regras, []);
});

test("a regra que vale em todos, de um projeto só do mini, não classifica pasta nem título no air", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, {
    nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc],
    pastas: [pasta("~/Code/alfa"), { tipo: "titulo", padrao: "Atendimento", computador: null }],
  });
  assert.equal(await classificar(b, mini, "~/Code/alfa/src"), x);
  assert.equal(await classificar(b, air, "~/Code/alfa/src"), null);
  for (const pc of [mini, air]) {
    await b.sql("insert into public.agentes_openbot (computador_id, pasta, nome, titulo) values ($1, '~/OpenBot/Agents/agent-1', 'Um', 'Atendimento')", [pc.pc]);
  }
  assert.equal(await classificar(b, mini, "~/OpenBot/Agents/agent-1"), x);
  assert.equal(await classificar(b, air, "~/OpenBot/Agents/agent-1"), null);
});

test("projeto sem escolha vale em todos os computadores, como antes", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  assert.deepEqual(await ondeRoda(b, x), { todos: true, pcs: [] });
  for (const pc of [mini, air]) {
    const r = await b.rpc(pc, "agente_empresas");
    assert.deepEqual(r.empresas.map((u) => u.id), [x]);
    assert.equal(r.regras.length, 1);
  }
  assert.equal(await classificar(b, air, "~/Code/alfa/x"), x);
});

test("voltar para todos limpa a lista; salvar sem o campo, como o painel antigo, não mexe nos computadores", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", contas: [a], computadores: [mini.pc, air.pc] });
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc, air.pc].sort() });
  const nome = await salvar(b, admin, x, { nome: "Alfa 2" });
  assert.equal(nome.ok, true, nome.erro);
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc, air.pc].sort() });
  const so = await salvar(b, admin, x, { computadores: [air.pc] });
  assert.equal(so.ok, true, so.erro);
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [air.pc] });
  const todos = await salvar(b, admin, x, { computadores: null });
  assert.equal(todos.ok, true, todos.erro);
  assert.deepEqual(await ondeRoda(b, x), { todos: true, pcs: [] });
});

test("o subprojeto roda onde o projeto roda", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc], pastas: [pasta("~/Code/alfa")] });
  const p = await criar(b, admin, { nome: "Site", pai: x, modo: "ligado", contas: [c], pastas: [pasta("~/Code/alfa/site")] });
  assert.deepEqual(new Set((await b.rpc(mini, "agente_empresas")).empresas.map((u) => u.id)), new Set([x, p]));
  assert.deepEqual((await b.rpc(air, "agente_empresas")).empresas, []);
  assert.equal(await classificar(b, mini, "~/Code/alfa/site/a"), p);
  assert.equal(await classificar(b, air, "~/Code/alfa/site/a"), null);
  await pedir(b, air, [p]);
  assert.equal(await trilha(b, air, p), null);
});

test("agente antigo recebe só o que é dele, na 0.19 e antes dela", async () => {
  for (const airVersao of ["0.19.0", "0.18.0"]) {
    const { b, admin, mini, air } = await cenario({ airVersao });
    const a = await b.conta(mini, "a@exemplo.com", 5);
    await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc], pastas: [pasta("~/Code/alfa")] });
    const r = await b.rpc(air, "agente_empresas");
    assert.deepEqual(r.empresas, [], airVersao);
    assert.deepEqual(r.regras, [], airVersao);
  }
});

// -------------------------------------------------------------------------------------------------------- trilhas

test("o agente pede trilha de um projeto que não roda nele: não ganha conta nem gera alerta", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc] });
  await pedir(b, air, [x]);
  assert.equal(await trilha(b, air, x), null);
  assert.equal(await contar(b, "public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'trilha_sem_conta'"), 0);
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), a);
});

test("o projeto saiu do computador: a sessão aberta segue na trilha, e trilha nova não nasce lá", async () => {
  const { b, admin, mini, air } = await cenario();
  const p1 = await b.conta(mini, "p1@exemplo.com", 40);
  const p2 = await b.conta(mini, "p2@exemplo.com", 41);
  const a = await b.conta(mini, "a@exemplo.com", 5);
  await atribuir(b, mini, p1);
  await atribuir(b, air, p2);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc, air.pc] });
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), a);
  const r = await salvar(b, admin, x, { computadores: [air.pc] });
  assert.equal(r.ok, true, r.erro);
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), a, "a sessão aberta não muda de conta");
  assert.deepEqual((await b.rpc(mini, "agente_empresas")).empresas, [], "sessão nova não entra");
  await soltarTrilha(b, mini, x);
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), null, "trilha nova não nasce");
  await pedir(b, air, [x]);
  assert.equal(await trilha(b, air, x), a, "agora no computador certo");
});

test("a mesma conta em projetos de computadores diferentes: cada um vê só o seu, e a conta fica em um login", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc], pastas: [pasta("~/Code/alfa")] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a], computadores: [air.pc], pastas: [pasta("~/Code/beta")] });
  const noMini = await b.rpc(mini, "agente_empresas");
  assert.deepEqual(noMini.empresas.map((u) => [u.id, u.nome]), [[x, "Alfa"]]);
  assert.deepEqual(noMini.regras.map((l) => l.empresa), [x]);
  const noAir = await b.rpc(air, "agente_empresas");
  assert.deepEqual(noAir.empresas.map((u) => [u.id, u.nome]), [[y, "Beta"]]);
  assert.deepEqual(noAir.regras.map((l) => l.empresa), [y]);
  await pedir(b, mini, [x]);
  await pedir(b, air, [y]);
  assert.equal(await trilha(b, mini, x), a);
  assert.equal(await trilha(b, air, y), null, "a conta está no outro computador");
});

test("trilha dividida cujo dono saiu do computador: quem ficou segue nela até ela soltar", async () => {
  const { b, admin, mini, air } = await cenario();
  const p1 = await b.conta(mini, "p1@exemplo.com", 40);
  const p2 = await b.conta(mini, "p2@exemplo.com", 41);
  const a = await b.conta(mini, "a@exemplo.com", 5);
  await atribuir(b, mini, p1);
  await atribuir(b, air, p2);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc, air.pc], pastas: [pasta("~/Code/alfa", air.pc)] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a], computadores: [mini.pc], pastas: [pasta("~/Code/beta", mini.pc)] });
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), a);
  const r = await salvar(b, admin, x, { computadores: [air.pc] });
  assert.equal(r.ok, true, r.erro);
  const antes = await b.rpc(mini, "agente_empresas");
  assert.deepEqual(antes.empresas.map((u) => u.id), [x], "Beta não abre um segundo login na mesma conta");
  assert.deepEqual(antes.regras.map((l) => l.empresa), [x]);
  await soltarTrilha(b, mini, x);
  const depois = await b.rpc(mini, "agente_empresas");
  assert.deepEqual(depois.empresas.map((u) => [u.id, u.nome]), [[y, "Beta"]]);
});

// --------------------------------------------------------------------------------------------- a conta em uso

test("cadastrar projeto de um computador com conta livre não mexe na conta de nenhum computador", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  const l = await b.conta(mini, "l@exemplo.com", 7);
  await atribuir(b, mini, a);
  await atribuir(b, air, c);
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [l], computadores: [mini.pc] });
  await decidir(b);
  assert.equal(await b.atribuida(mini), a);
  assert.equal(await b.atribuida(air), c);
});

test("a conta marcada para o projeto do mini sai do air, e só o air troca", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  const l = await b.conta(mini, "l@exemplo.com", 7);
  await atribuir(b, mini, a);
  await atribuir(b, air, c);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [c], computadores: [mini.pc] });
  assert.equal(await b.atribuida(mini), a);
  assert.equal(await b.atribuida(air), l);
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), c);
});

test("a principal parada em conta de projeto de outro computador vai para uma conta do projeto daqui", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const z = await b.conta(mini, "z@exemplo.com", 6);
  const c = await b.conta(mini, "c@exemplo.com", 7);
  await atribuir(b, mini, z);
  await atribuir(b, air, a);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a, z], computadores: [mini.pc] });
  await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c], computadores: [air.pc] });
  await decidir(b);
  assert.equal(await b.atribuida(mini), z);
  assert.equal(await b.atribuida(air), c, "o air foi para a conta do projeto dele");
  await pedir(b, mini, [x]);
  assert.equal(await trilha(b, mini, x), a, "a conta do Alfa ficou livre para a trilha dele");
});

test("a principal na conta do próprio projeto, sem outra para ir, fica nela", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  await atribuir(b, mini, a);
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc] });
  await decidir(b);
  assert.equal(await b.atribuida(mini), a);
  assert.equal(await contar(b, "public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_de_outro'"), 0);
  assert.equal(await b.atribuida(air), null);
});

test("dois computadores na conta um do outro, sem conta livre: ninguém troca, e cada um gera um aviso só", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  await atribuir(b, mini, c);
  await atribuir(b, air, a);
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc] });
  await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c], computadores: [air.pc] });
  await decidir(b);
  await decidir(b);
  assert.equal(await b.atribuida(mini), c, "não troca direto: a posse de cada um seguraria a outra");
  assert.equal(await b.atribuida(air), a);
  for (const pc of [mini, air]) {
    assert.equal(await contar(b, "public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_de_outro' and dados ->> 'computador' = $1", [pc.pc]), 1);
  }
});

test("conta do projeto daqui que também é de um projeto de outro computador não serve de saída: fica e avisa", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  await atribuir(b, mini, a);
  // O Alfa por último: salvar um projeto já roda o decidir dos computadores cuja conta deixou de ser geral. Com o Alfa
  // antes, a c ainda era geral nessa hora e o mini ia para ela, sem chegar ao caso que este teste prova.
  await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c], computadores: [mini.pc] });
  await criar(b, admin, { nome: "Gama", modo: "ligado", contas: [c], computadores: [air.pc] });
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [air.pc] });
  await decidir(b);
  assert.equal(await b.atribuida(mini), a, "ir para a conta que o Gama também usa só mudaria o problema de lugar");
  assert.equal(await contar(b, "public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_de_outro' and dados ->> 'computador' = $1", [mini.pc]), 1);
});

test("com uma conta livre, os dois presos se resolvem sozinhos", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  await atribuir(b, mini, c);
  await atribuir(b, air, a);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c], computadores: [air.pc] });
  await b.conta(mini, "l@exemplo.com", 7);
  await decidir(b);
  await decidir(b);
  // quem pega a livre depende da ordem; o que importa é ninguém ficar na conta do projeto do outro
  const [m, r] = [await b.atribuida(mini), await b.atribuida(air)];
  assert.notEqual(m, c, "o mini saiu da conta do Beta");
  assert.notEqual(r, a, "o air saiu da conta do Alfa");
  await pedir(b, mini, [x]);
  await pedir(b, air, [y]);
  assert.equal((await trilha(b, mini, x)) ?? m, a, "o Alfa roda na conta dele");
  assert.equal((await trilha(b, air, y)) ?? r, c, "o Beta roda na conta dele");
});

test("sessão do projeto segurando a conta em uso: nada troca, mesmo sendo conta de projeto de outro computador", async () => {
  const { b, admin, mini, air } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  await atribuir(b, mini, a);
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a], computadores: [mini.pc] });
  const r = await b.rpc(mini, "agente_segurar_principal", { p_empresas: `{${y}}` });
  assert.equal(r.segura, true);
  await b.conta(mini, "l@exemplo.com", 7);
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [air.pc] });
  await decidir(b);
  assert.equal(await b.atribuida(mini), a);
});

// ------------------------------------------------------------------------------------------- portão e recusas

test("computador atrasado fora do projeto não impede ligar; dentro do projeto, impede", async () => {
  const { b, admin, mini, air } = await cenario({ airVersao: "0.19.0" });
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], computadores: [mini.pc] });
  await criar(b, admin, { nome: "Site", pai: x, modo: "ligado", contas: [c] });
  for (const computadores of [[mini.pc, air.pc], null]) {
    const r = await salvar(b, admin, x, { computadores });
    assert.equal(r.ok, false);
    assert.match(r.erro, /atualize o computador air/);
  }
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc] });
  const semLista = await salvar(b, admin, null, { nome: "Beta", modo: "ligado", contas: [c] });
  assert.equal(semLista.ok, false, "projeto novo sem escolha vale em todos, e o air está atrasado");
  assert.match(semLista.erro, /atualize o computador air/);
});

test("projeto em teste com subprojeto ligado: trazer computador atrasado é recusado; com o subprojeto desligado, não", async () => {
  const { b, admin, mini, air } = await cenario({ airVersao: "0.19.0" });
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const c = await b.conta(mini, "c@exemplo.com", 6);
  // "em teste" na tela é o modo "sombra" no banco
  const x = await criar(b, admin, { nome: "Alfa", modo: "sombra", contas: [a], computadores: [mini.pc] });
  const p = await criar(b, admin, { nome: "Site", pai: x, modo: "ligado", contas: [c] });
  for (const computadores of [[mini.pc, air.pc], null]) {
    const r = await salvar(b, admin, x, { computadores });
    assert.equal(r.ok, false, "o subprojeto ligado iria para o air, que ainda não segue a conta do projeto");
    assert.match(r.erro, /atualize o computador air/);
  }
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc] });
  assert.deepEqual((await b.rpc(air, "agente_empresas")).empresas, []);
  const desliga = await salvar(b, admin, p, { modo: "desligado" });
  assert.equal(desliga.ok, true, desliga.erro);
  const traz = await salvar(b, admin, x, { computadores: [mini.pc, air.pc] });
  assert.equal(traz.ok, true, traz.erro);
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc, air.pc].sort() });
});

test("lista de computadores inválida é recusada e nada fica gravado pela metade", async () => {
  const { b, admin, mini } = await cenario();
  const a = await b.conta(mini, "a@exemplo.com", 5);
  const vazia = await salvar(b, admin, null, { nome: "Alfa", contas: [a], computadores: [] });
  assert.equal(vazia.ok, false);
  assert.match(vazia.erro, /escolha um computador/);
  assert.equal(await contar(b, "public.empresas"), 0);
  await assert.rejects(salvar(b, admin, null, { nome: "Alfa", computadores: ["00000000-0000-0000-0000-000000000001"] }), /computador desconhecido/);
  await assert.rejects(salvar(b, admin, null, { nome: "Alfa", computadores: "todos" }), /computadores inválidos/);
  await assert.rejects(salvar(b, admin, null, { nome: "Alfa", computadores: Array(101).fill(mini.pc) }), /computadores inválidos/);
  assert.equal(await contar(b, "public.empresas"), 0);
  const x = await criar(b, admin, { nome: "Alfa", computadores: [mini.pc] });
  await assert.rejects(salvar(b, admin, null, { nome: "Site", pai: x, computadores: [mini.pc] }), /subprojeto roda nos computadores do projeto/);
  assert.equal(await contar(b, "public.empresas"), 1);
});

test("computador removido: o que já estava na lista não impede salvar, e não entra um novo", async () => {
  const { b, admin, mini, air } = await cenario();
  const x = await criar(b, admin, { nome: "Alfa", computadores: [mini.pc, air.pc] });
  await b.sql("update public.computadores set revogado = true where id = $1", [air.pc]);
  const r = await salvar(b, admin, x, { nome: "Alfa 2", computadores: [mini.pc, air.pc] });
  assert.equal(r.ok, true, r.erro);
  const y = await criar(b, admin, { nome: "Beta", computadores: [mini.pc] });
  await assert.rejects(salvar(b, admin, y, { computadores: [mini.pc, air.pc] }), /computador desconhecido/);
  assert.deepEqual(await ondeRoda(b, y), { todos: false, pcs: [mini.pc] });
});

test("salvar vários: a falha no segundo passo desfaz os computadores gravados no primeiro", async () => {
  const { b, admin, mini, air } = await cenario();
  const x = await criar(b, admin, { nome: "Alfa", computadores: [mini.pc] });
  const r = await b.rpc(admin, "painel_unidades", {
    p_passos: [{ id: x, campos: { computadores: [air.pc] } }, { id: null, campos: { nome: "Beta", computadores: [] } }],
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /escolha um computador/);
  assert.deepEqual(await ondeRoda(b, x), { todos: false, pcs: [mini.pc] });
  assert.equal(await contar(b, "public.empresas"), 1);
});

test("só o administrador grava; membro lê; quem é de fora não vê nada; escrita direta é recusada", async () => {
  const { b, admin, mini, air } = await cenario();
  const x = await criar(b, admin, { nome: "Alfa", computadores: [mini.pc] });
  const leitor = { id: await b.usuario("leitura"), aal: "aal1" };
  const estranho = { id: await b.usuario(null), aal: "aal1" };
  await assert.rejects(b.rpc(leitor, "painel_unidade", { p_id: x, p_campos: { computadores: null } }));
  await assert.rejects(b.rpc(air, "painel_unidade", { p_id: x, p_campos: { computadores: [air.pc] } }));
  await assert.rejects(b.como("anon", "select * from public.empresa_computadores"));
  assert.equal((await b.como(leitor, "select * from public.empresa_computadores")).length, 1);
  assert.equal((await b.como(estranho, "select * from public.empresa_computadores")).length, 0);
  await assert.rejects(b.como(admin, "insert into public.empresa_computadores (empresa_id, computador_id) values ($1, $2)", [x, air.pc]));
  await assert.rejects(b.como(admin, "delete from public.empresa_computadores"));
  for (const fn of ["rvz_roda_em", "rvz_de_outro_computador"]) {
    const [{ pode }] = await b.sql(`select has_function_privilege('authenticated', p.oid, 'execute') pode from pg_proc p where p.proname = $1`, [fn]);
    assert.equal(pode, false, fn);
  }
});

// ----------------------------------------------------------------------------------- dados que já existiam

test("a migração prende ao computador só quem já vivia só nele, e rodar de novo não desfaz a escolha", async () => {
  const b = await banco({ ate: "0044" });
  const pc = async (nome, revogado = false) => {
    const user = await b.usuario("computador");
    const [{ id }] = await b.sql("insert into public.computadores (user_id, nome, sistema, versao, revogado) values ($1, $2, 'macos', '0.20.0', $3) returning id", [user, nome, revogado]);
    return id;
  };
  const empresa = async (nome, pai = null) => (await b.sql("insert into public.empresas (nome, pai) values ($1, $2) returning id", [nome, pai]))[0].id;
  const regra = (emp, padrao, computador = null) =>
    b.sql("insert into public.pastas_empresa (tipo, padrao, empresa_id, computador_id) values ('pasta', $1, $2, $3)", [padrao, emp, computador]);
  const mini = await pc("mini");
  const air = await pc("air");
  const velho = await pc("velho", true);
  const soMini = await empresa("Só no mini");
  await regra(soMini, "~/a", mini);
  const dois = await empresa("Nos dois");
  await regra(dois, "~/b", mini);
  await regra(dois, "~/b2", air);
  const emTodos = await empresa("Em todos");
  await regra(emTodos, "~/c");
  const semRegra = await empresa("Sem regra");
  const mista = await empresa("Mista");
  await regra(mista, "~/d", mini);
  await regra(mista, "~/d2");
  const peloFilho = await empresa("Pelo filho");
  const filho = await empresa("Filho", peloFilho);
  await regra(filho, "~/e", air);
  const paiSolto = await empresa("Pai com regra geral");
  const filhoPreso = await empresa("Filho preso", paiSolto);
  await regra(paiSolto, "~/f");
  await regra(filhoPreso, "~/f/g", mini);
  const soRemovido = await empresa("Só em removido");
  await regra(soRemovido, "~/h", velho);
  const parteRemovido = await empresa("Parte em removido");
  await regra(parteRemovido, "~/i", mini);
  await regra(parteRemovido, "~/j", velho);

  await b.migrarDe("0045");

  assert.deepEqual(await ondeRoda(b, soMini), { todos: false, pcs: [mini] });
  assert.deepEqual(await ondeRoda(b, dois), { todos: false, pcs: [mini, air].sort() });
  assert.deepEqual(await ondeRoda(b, emTodos), { todos: true, pcs: [] });
  assert.deepEqual(await ondeRoda(b, semRegra), { todos: true, pcs: [] });
  assert.deepEqual(await ondeRoda(b, mista), { todos: true, pcs: [] });
  assert.deepEqual(await ondeRoda(b, peloFilho), { todos: false, pcs: [air] });
  assert.deepEqual(await ondeRoda(b, paiSolto), { todos: true, pcs: [] }, "a regra geral do pai vale em todos");
  assert.deepEqual(await ondeRoda(b, soRemovido), { todos: true, pcs: [] }, "nada some por causa de um computador removido");
  assert.deepEqual(await ondeRoda(b, parteRemovido), { todos: false, pcs: [mini] });

  // a pessoa muda; a migração roda de novo (como toda reaplicável) e respeita
  await b.sql("update public.empresas set em_todos_computadores = true where id = $1", [soMini]);
  await b.sql("delete from public.empresa_computadores where empresa_id = $1", [soMini]);
  await b.sql("update public.empresas set em_todos_computadores = false where id = $1", [emTodos]);
  await b.sql("insert into public.empresa_computadores (empresa_id, computador_id) values ($1, $2)", [emTodos, air]);
  await b.migrarDe("0045");
  assert.deepEqual(await ondeRoda(b, soMini), { todos: true, pcs: [] });
  assert.deepEqual(await ondeRoda(b, emTodos), { todos: false, pcs: [air] });
});

// -------------------------------------------------------------------------------------------------------- nomes

test("nenhum texto que a pessoa vê, vindo da nuvem, fala em empresa", async () => {
  const b = await banco();
  const fontes = await b.sql("select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace");
  const achados = [];
  for (const { proname, prosrc } of fontes) {
    const sem = prosrc.replace(/--.*$/gm, "");
    for (const [frase] of sem.matchAll(/'(?:[^']|'')*'/g)) {
      if (/empresa/i.test(frase) && /\s/.test(frase)) achados.push(`${proname}: ${frase}`);
    }
  }
  assert.deepEqual(achados, []);
});
