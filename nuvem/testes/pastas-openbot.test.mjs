// 0049 e 0050 (0.22.0): projetos pelas pastas da barra lateral do OpenBot. O agente manda, de cada agente do OpenBot, a
// cadeia de pastas da raiz até a dele (`secoes`, ids) e a lista das pastas (id, nome, pai). A regra nova é do tipo
// "secao" (o padrão é o id da pasta), sempre num computador só. Precedência: caminho exato ou mais fundo > nome de pasta
// > pasta do OpenBot (a mais funda ganha) > título > caminho de uma pasta acima. Computador antes da 0.22.0 não recebe a
// regra e a nuvem não a aplica a ele.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ miniVersao = "0.22.0", airVersao = "0.22.0" } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  const mini = await b.computador("mini");
  const air = await b.computador("air");
  await b.rpc(mini, "agente_ola", { p_versao: miniVersao });
  await b.rpc(air, "agente_ola", { p_versao: airVersao });
  return { b, admin, leitor, mini, air };
}

const salvar = (b, admin, id, campos) => b.rpc(admin, "painel_unidade", { p_id: id, p_campos: campos });

async function criar(b, admin, campos) {
  const r = await salvar(b, admin, null, { modo: "desligado", ...campos });
  assert.equal(r.ok, true, r.erro);
  return r.id;
}

const secao = (padrao, computador) => ({ tipo: "secao", padrao, computador });
const pasta = (padrao, computador = null) => ({ tipo: "pasta", padrao, computador });
const titulo = (padrao, computador = null) => ({ tipo: "titulo", padrao, computador });
const classificar = async (b, pc, p) => (await b.sql("select public.rvz_classificar($1, $2) as e", [pc.pc, p]))[0].e;
const relatar = (b, pc, lista) => b.rpc(pc, "agente_relatar_agentes", { p_lista: lista });
const relatarSecoes = (b, pc, lista) => b.rpc(pc, "agente_relatar_secoes", { p_lista: lista });
const secoesDe = async (b, pc, p) =>
  (await b.sql("select secoes from public.agentes_openbot where computador_id = $1 and pasta = $2", [pc.pc, p]))[0]?.secoes;

const AG1 = "~/OpenBot/Agents/agent-1";

// ------------------------------------------------------------------------------------------------- segurança

test("as migrações fecham as funções novas antes das permissões finais", async () => {
  const b = await banco({ ate: "0050" });
  await assert.rejects(b.rpc("anon", "agente_relatar_secoes", { p_lista: [] }), /permission denied/);
  await assert.rejects(b.como("anon", "select public.rvz_secoes_validas('[]'::jsonb)"), /permission denied/);
  await assert.rejects(b.como("anon", "select public.rvz_secoes_comuns('[]'::jsonb)"), /permission denied/);
});

test("só o computador relata as pastas; membro lê; anon não lê nem escreve", async () => {
  const { b, leitor, mini } = await cenario();
  await relatarSecoes(b, mini, [{ id: "s1", nome: "Clientes", pai: null }]);
  await assert.rejects(relatarSecoes(b, leitor, []));
  await assert.rejects(b.rpc("anon", "agente_relatar_secoes", { p_lista: [] }), /permission denied/);
  await assert.rejects(b.como("anon", "select * from public.secoes_openbot"), /permission denied/);
  await assert.rejects(b.como(leitor, "insert into public.secoes_openbot (computador_id, id) values ($1, 'x')", [mini.pc]),
    /permission denied/);
  assert.deepEqual(await b.como(leitor, "select id, nome, pai from public.secoes_openbot"), [{ id: "s1", nome: "Clientes", pai: null }]);
});

// ------------------------------------------------------------------------------------------- relatar os agentes

test("o agente novo manda a cadeia de pastas; o antigo, sem o campo, deixa vazio (não guarda a de antes)", async () => {
  const { b, mini } = await cenario();
  await relatar(b, mini, [{ pasta: AG1, nome: "Um", titulo: "", secoes: ["raiz", "sub"] }]);
  assert.deepEqual(await secoesDe(b, mini, AG1), ["raiz", "sub"]);
  await relatar(b, mini, [{ pasta: AG1, nome: "Um", titulo: "" }]);
  assert.deepEqual(await secoesDe(b, mini, AG1), []);
});

test("cadeia null (a barra não foi lida) mantém a cadeia que estava; agente novo com null nasce sem pasta", async () => {
  const { b, mini } = await cenario();
  await relatar(b, mini, [{ pasta: AG1, nome: "Um", secoes: ["raiz"] }]);
  await relatar(b, mini, [{ pasta: AG1, nome: "Um novo", secoes: null }, { pasta: "~/OpenBot/Agents/agent-2", secoes: null }]);
  assert.deepEqual(await secoesDe(b, mini, AG1), ["raiz"]);
  assert.equal((await b.sql("select nome from public.agentes_openbot where pasta = $1", [AG1]))[0].nome, "Um novo");
  assert.deepEqual(await secoesDe(b, mini, "~/OpenBot/Agents/agent-2"), []);
});

test("cadeia inválida (id estranho, repetido, não texto, mais de 10 níveis) vira sem pasta", async () => {
  const { b, mini } = await cenario();
  const casos = [["a b"], ["a", "a"], [1], ["x".repeat(101)], Array.from({ length: 11 }, (_, i) => `n${i}`), "raiz", {}];
  for (const secoes of casos) {
    await relatar(b, mini, [{ pasta: AG1, secoes: ["boa"] }]);
    await relatar(b, mini, [{ pasta: AG1, secoes }]);
    assert.deepEqual(await secoesDe(b, mini, AG1), [], JSON.stringify(secoes));
  }
  await relatar(b, mini, [{ pasta: AG1, secoes: Array.from({ length: 10 }, (_, i) => `n${i}`) }]);
  assert.equal((await secoesDe(b, mini, AG1)).length, 10);
});

test("agentes na mesma pasta de trabalho ficam com a parte comum das cadeias", async () => {
  const { b, mini } = await cenario();
  await relatar(b, mini, [
    { pasta: "~/Code/repo", nome: "A", secoes: ["raiz", "sub1"] },
    { pasta: "~/Code/repo", nome: "B", secoes: ["raiz", "sub2"] },
  ]);
  assert.deepEqual(await secoesDe(b, mini, "~/Code/repo"), ["raiz"]);
  assert.equal((await b.sql("select nome from public.agentes_openbot where pasta = '~/Code/repo'"))[0].nome, "A");
  await relatar(b, mini, [{ pasta: "~/Code/repo", secoes: ["x"] }, { pasta: "~/Code/repo", secoes: ["y"] }]);
  assert.deepEqual(await secoesDe(b, mini, "~/Code/repo"), []);
  // um sem leitura no grupo: a pasta fica como estava
  await relatar(b, mini, [{ pasta: "~/Code/repo", secoes: ["x"] }]);
  await relatar(b, mini, [{ pasta: "~/Code/repo", secoes: ["x", "z"] }, { pasta: "~/Code/repo", secoes: null }]);
  assert.deepEqual(await secoesDe(b, mini, "~/Code/repo"), ["x"]);
});

test("a lista dos agentes continua aceitando o formato antigo e recusando o que não é lista", async () => {
  const { b, mini } = await cenario();
  const r = await relatar(b, mini, [{ pasta: AG1, nome: "Um", titulo: "T" }, { pasta: "relativa" }, "lixo"]);
  assert.equal(r.ok, true);
  assert.equal(r.gravados, 1);
  await assert.rejects(relatar(b, mini, { pasta: AG1 }), /lista inválida/);
  await assert.rejects(relatar(b, mini, Array.from({ length: 501 }, (_, i) => ({ pasta: `~/a${i}` }))), /lista inválida/);
});

// ------------------------------------------------------------------------------------------- relatar as pastas

test("as pastas do computador: grava, troca o nome, tira a que sumiu; outro computador não é tocado", async () => {
  const { b, mini, air } = await cenario();
  await relatarSecoes(b, mini, [{ id: "s1", nome: "Clientes", pai: null }, { id: "s2", nome: "Loja\u0007", pai: "s1" }]);
  await relatarSecoes(b, air, [{ id: "s1", nome: "Outro", pai: null }]);
  await relatarSecoes(b, mini, [{ id: "s2", nome: "Loja nova", pai: "s1" }, { id: "s3", nome: "", pai: "inexistente" }]);
  const lidas = await b.sql("select id, nome, pai from public.secoes_openbot where computador_id = $1 order by id", [mini.pc]);
  assert.deepEqual(lidas, [{ id: "s2", nome: "Loja nova", pai: "s1" }, { id: "s3", nome: "", pai: "inexistente" }]);
  assert.equal((await b.sql("select count(*)::int n from public.secoes_openbot where computador_id = $1", [air.pc]))[0].n, 1);
});

test("as pastas: nome com caractere de controle é limpo; pai estranho ou igual à própria vira raiz", async () => {
  const { b, mini } = await cenario();
  await relatarSecoes(b, mini, [{ id: "s1", nome: " A\u0001B ", pai: "a b" }, { id: "s2", nome: "x".repeat(200), pai: "s2" }]);
  const lidas = await b.sql("select id, nome, pai from public.secoes_openbot order by id");
  assert.deepEqual(lidas.map((l) => [l.id, l.nome.length, l.pai]), [["s1", 3, null], ["s2", 120, null]]);
  assert.equal(lidas[0].nome, "A B");
});

test("as pastas: lista inválida ou enorme é recusada e nada muda", async () => {
  const { b, mini } = await cenario();
  await relatarSecoes(b, mini, [{ id: "s1", nome: "Clientes" }]);
  const ruins = [{}, "x", [{ id: "a b" }], [{ id: 1 }], ["s1"], [{ id: "s1" }, { id: "s1" }],
    Array.from({ length: 501 }, (_, i) => ({ id: `s${i}` }))];
  for (const lista of ruins) await assert.rejects(relatarSecoes(b, mini, lista), /lista inválida/, JSON.stringify(lista).slice(0, 40));
  assert.equal((await b.sql("select count(*)::int n from public.secoes_openbot"))[0].n, 1);
});

// ------------------------------------------------------------------------------------------------ classificar

async function comAgente(versao = "0.22.0") {
  const c = await cenario({ miniVersao: versao });
  await relatar(c.b, c.mini, [{ pasta: AG1, nome: "Um", titulo: "Atendimento", secoes: ["clientes", "loja"] }]);
  return c;
}

test("a pasta do OpenBot classifica a conversa do agente e o que está dentro da pasta dele", async () => {
  const { b, admin, mini, air } = await comAgente();
  const x = await criar(b, admin, { nome: "Clientes", pastas: [secao("clientes", mini.pc)] });
  assert.equal(await classificar(b, mini, AG1), x);
  assert.equal(await classificar(b, mini, `${AG1}/trabalho`), x);
  // sem agente que contenha a conversa, a regra não vale; no outro computador também não
  assert.equal(await classificar(b, mini, "~/Code/outro"), null);
  await relatar(b, air, [{ pasta: AG1, secoes: ["clientes"] }]);
  assert.equal(await classificar(b, air, AG1), null);
});

test("a subpasta ganha da pasta; o título perde para a pasta do OpenBot", async () => {
  const { b, admin, mini } = await comAgente();
  const a = await criar(b, admin, { nome: "A", pastas: [secao("clientes", mini.pc)] });
  const bb = await criar(b, admin, { nome: "B", pastas: [secao("loja", mini.pc)] });
  assert.equal(await classificar(b, mini, AG1), bb);
  await salvar(b, admin, bb, { pastas: [] });
  assert.equal(await classificar(b, mini, AG1), a);
  const t = await criar(b, admin, { nome: "T", pastas: [titulo("Atendimento", mini.pc)] });
  assert.equal(await classificar(b, mini, AG1), a);
  await salvar(b, admin, a, { pastas: [] });
  assert.equal(await classificar(b, mini, AG1), t);
});

test("o caminho exato e o nome da pasta do agente ganham da pasta do OpenBot; o caminho de cima perde", async () => {
  const { b, admin, mini } = await comAgente();
  const s = await criar(b, admin, { nome: "S", pastas: [secao("loja", mini.pc)] });
  const exato = await criar(b, admin, { nome: "Exato", pastas: [pasta(AG1)] });
  assert.equal(await classificar(b, mini, AG1), exato);
  await salvar(b, admin, exato, { pastas: [pasta("agent-1")] });
  assert.equal(await classificar(b, mini, AG1), exato);
  await salvar(b, admin, exato, { pastas: [pasta("~/OpenBot")] });
  assert.equal(await classificar(b, mini, AG1), s);
  await salvar(b, admin, exato, { pastas: [pasta("Agents")] });
  assert.equal(await classificar(b, mini, AG1), s);
  // a regra de caminho mais funda que a pasta do agente ganha dentro dela
  await salvar(b, admin, exato, { pastas: [pasta(`${AG1}/trabalho`)] });
  assert.equal(await classificar(b, mini, `${AG1}/trabalho/x`), exato);
  assert.equal(await classificar(b, mini, AG1), s);
});

test("o projeto que não roda neste computador não pega a pasta; a pasta de cima vale", async () => {
  const { b, admin, mini, air } = await comAgente();
  const a = await criar(b, admin, { nome: "A", pastas: [secao("clientes", mini.pc)] });
  await criar(b, admin, { nome: "B", computadores: [air.pc], pastas: [secao("loja", mini.pc)] });
  assert.equal(await classificar(b, mini, AG1), a);
});

test("computador antes da 0.22.0: a nuvem não aplica a pasta do OpenBot", async () => {
  const { b, admin, mini } = await comAgente("0.21.2");
  const t = await criar(b, admin, { nome: "T", pastas: [titulo("Atendimento")] });
  await criar(b, admin, { nome: "S", pastas: [secao("loja", mini.pc)] });
  assert.equal(await classificar(b, mini, AG1), t);
});

test("sem regra de pasta do OpenBot, a classificação é a de sempre (mesmo com a cadeia gravada)", async () => {
  const { b, admin, mini } = await comAgente();
  const p = await criar(b, admin, { nome: "P", pastas: [pasta("~/OpenBot")] });
  const t = await criar(b, admin, { nome: "T", pastas: [titulo("Atendimento")] });
  assert.equal(await classificar(b, mini, AG1), t);
  await salvar(b, admin, t, { pastas: [] });
  assert.equal(await classificar(b, mini, AG1), p);
});

test("a tabela de casos comum com o agente e o painel (casos-pasta-openbot.json)", async () => {
  const tabela = JSON.parse(fs.readFileSync(new URL("./casos-pasta-openbot.json", import.meta.url), "utf8"));
  const { b, admin, mini } = await cenario();
  await relatar(b, mini, tabela.agentes);
  for (const [i, caso] of tabela.casos.entries()) {
    const porProjeto = {};
    for (const [tipo, padrao, projeto] of caso.regras) {
      (porProjeto[projeto] ??= []).push({ tipo, padrao, computador: tipo === "secao" ? mini.pc : null });
    }
    const ids = {};
    for (const [projeto, pastas] of Object.entries(porProjeto)) ids[projeto] = await criar(b, admin, { nome: `${projeto} ${i}`, pastas });
    for (const [p, espera] of caso.perguntas) {
      assert.equal(await classificar(b, mini, p), espera ? ids[espera] : null, `${caso.nome}: ${p}`);
    }
    for (const id of Object.values(ids)) assert.equal((await salvar(b, admin, id, { pastas: [] })).ok, true);
  }
});

// ------------------------------------------------------------------------------------------- entregar as regras

test("a regra vai só ao computador dela e só na 0.22.0 ou mais", async () => {
  const { b, admin, mini, air } = await cenario({ airVersao: "0.21.2" });
  const a = await b.conta(mini, "a@exemplo.com", 5);
  await criar(b, admin, {
    nome: "Alfa", modo: "ligado", contas: [a],
    pastas: [secao("clientes", mini.pc), secao("loja", air.pc), pasta("~/Code/alfa")],
  });
  const noMini = await b.rpc(mini, "agente_empresas");
  assert.deepEqual(noMini.regras.map((r) => `${r.tipo}:${r.padrao}`).sort(), ["pasta:~/Code/alfa", "secao:clientes"]);
  const noAir = await b.rpc(air, "agente_empresas");
  assert.deepEqual(noAir.regras.map((r) => `${r.tipo}:${r.padrao}`), ["pasta:~/Code/alfa"]);
  await b.rpc(air, "agente_ola", { p_versao: "0.22.0" });
  const depois = await b.rpc(air, "agente_empresas");
  assert.deepEqual(depois.regras.map((r) => `${r.tipo}:${r.padrao}`).sort(), ["pasta:~/Code/alfa", "secao:loja"]);
});

// ------------------------------------------------------------------------------------------------------ salvar

test("salvar: a pasta do OpenBot exige computador e id válido", async () => {
  const { b, admin, mini } = await cenario();
  const sem = await salvar(b, admin, null, { nome: "A", modo: "desligado", pastas: [secao("clientes", null)] });
  assert.equal(sem.ok, false);
  assert.match(sem.erro, /computador/);
  for (const ruim of ["a b", "x".repeat(101), "../x", "ação"]) {
    await assert.rejects(salvar(b, admin, null, { nome: "A", modo: "desligado", pastas: [secao(ruim, mini.pc)] }),
      /padrão inválido/, ruim);
  }
  await assert.rejects(salvar(b, admin, null, { nome: "A", modo: "desligado", pastas: [secao("s1", randomUUID())] }),
    /computador desconhecido/);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 0);
});

test("salvar: a mesma pasta em dois projetos do mesmo computador é recusada com o nome dela; em outro computador, pode", async () => {
  const { b, admin, mini, air } = await cenario();
  await relatarSecoes(b, mini, [{ id: "Clientes1", nome: "Clientes" }]);
  await criar(b, admin, { nome: "A", pastas: [secao("Clientes1", mini.pc)] });
  const dup = await salvar(b, admin, null, { nome: "B", modo: "desligado", pastas: [secao("Clientes1", mini.pc)] });
  assert.equal(dup.ok, false);
  assert.equal(dup.erro, "a pasta do OpenBot Clientes já é de A");
  // o id é exato: outra caixa é outra pasta
  await criar(b, admin, { nome: "C", pastas: [secao("clientes1", mini.pc)] });
  await criar(b, admin, { nome: "D", pastas: [secao("Clientes1", air.pc)] });
  await assert.rejects(
    b.sql("insert into public.pastas_empresa (tipo, padrao, empresa_id, computador_id) select 'secao', 'Clientes1', id, $1 from public.empresas where nome = 'C'", [mini.pc]),
    /duplicate key|pastas_empresa_chave/);
});

test("salvar: o banco recusa pasta do OpenBot sem computador mesmo fora das funções; o caminho antigo recusa o tipo", async () => {
  const { b, admin } = await cenario();
  const a = await criar(b, admin, { nome: "A" });
  await assert.rejects(b.sql("insert into public.pastas_empresa (tipo, padrao, empresa_id) values ('secao', 's1', $1)", [a]),
    /check/);
  await assert.rejects(b.sql("insert into public.pastas_empresa (tipo, padrao, empresa_id) values ('outro', 's1', $1)", [a]),
    /check/);
  await assert.rejects(b.rpc(admin, "painel_pasta_empresa", { p_tipo: "secao", p_padrao: "s1", p_empresa: a }), /tipo inválido/);
});

test("salvar pelo cadastro seguro aceita a pasta do OpenBot e mantém o resto", async () => {
  const { b, admin, mini } = await cenario();
  const a = await criar(b, admin, { nome: "A", pastas: [pasta("~/Code/a")] });
  const { revisao } = await b.rpc(admin, "painel_cadastro_revisao");
  const r = await b.rpc(admin, "painel_unidades_seguro", {
    p_operacao: randomUUID(), p_revisao: revisao,
    p_passos: [{ ref: a, id: a, campos: { pastas: [pasta("~/Code/a"), secao("clientes", mini.pc)] } }],
  });
  assert.equal(r.ok, true, r.erro);
  const regras = await b.sql("select tipo, padrao, computador_id from public.pastas_empresa order by tipo");
  assert.deepEqual(regras.map((x) => [x.tipo, x.padrao, x.computador_id]), [["pasta", "~/Code/a", null], ["secao", "clientes", mini.pc]]);
});

// --------------------------------------------------------------------------------------------- rodar de novo

test("rodar as migrações de novo não perde a cadeia, as pastas nem as regras", async () => {
  const { b, admin, mini } = await comAgente();
  await relatarSecoes(b, mini, [{ id: "clientes", nome: "Clientes" }]);
  const x = await criar(b, admin, { nome: "X", pastas: [secao("clientes", mini.pc)] });
  await b.migrarDe("0049");
  assert.deepEqual(await secoesDe(b, mini, AG1), ["clientes", "loja"]);
  assert.equal((await b.sql("select count(*)::int n from public.secoes_openbot"))[0].n, 1);
  assert.equal(await classificar(b, mini, AG1), x);
  const defs = await b.sql(`select count(*)::int n from pg_constraint
                             where conrelid = 'public.pastas_empresa'::regclass and contype = 'c'
                               and pg_get_constraintdef(oid) like '%titulo%'`);
  assert.equal(defs[0].n, 1);
});
