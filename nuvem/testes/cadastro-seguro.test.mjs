// Contrato do cadastro com uma operação identificada e a revisão do cadastro conferida no banco (0048, 0.21.2).
// Base: o rascunho de 25/11 (cbaa8be), renumerado depois da 0047 da conta parada cede, sem a fotografia dos dados.
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  const outro = { id: await b.usuario("admin"), aal: "aal2" };
  return { b, admin, leitor, outro };
}

const versao = async (b, quem) => (await b.rpc(quem, "painel_cadastro_revisao")).revisao;
const gravar = (b, quem, operacao, revisao, passos) =>
  b.rpc(quem, "painel_unidades_seguro", { p_operacao: operacao, p_revisao: revisao, p_passos: passos });
const novo = (nome) => [{ ref: "novo-1", id: null, campos: { nome, modo: "desligado" } }];
const pasta = (padrao) => ({ tipo: "pasta", padrao, computador: null });
const nomes = async (b) => (await b.sql("select nome from public.empresas order by nome")).map((r) => r.nome);

test("a migração fecha as funções antes da aplicação das permissões finais", async () => {
  const b = await banco({ ate: "0048" });
  await assert.rejects(b.como("anon", "select public.rvz_cadastro_revisao()"), /permission denied/);
  await assert.rejects(b.rpc("anon", "painel_cadastro_revisao"), /permission denied/);
  await assert.rejects(b.rpc("anon", "painel_unidades_seguro", {
    p_operacao: randomUUID(), p_revisao: "a".repeat(64), p_passos: novo("Alfa"),
  }), /permission denied/);
});

test("sequência do BigBoss: a gravação que sai de uma leitura velha é recusada e a pasta fica onde foi posta", async () => {
  const { b, admin } = await cenario();
  const alfa = (await b.rpc(admin, "painel_unidade", {
    p_id: null, p_campos: { nome: "Alfa", modo: "desligado", pastas: [pasta("~/Code/suporte")] },
  })).id;
  const beta = (await b.rpc(admin, "painel_unidade", { p_id: null, p_campos: { nome: "Beta", modo: "desligado" } })).id;
  const r0 = await versao(b, admin);
  // a aba move o Suporte de Alfa para Beta e a resposta se perde; a recarga lê antes de a gravação terminar
  const recarga = await versao(b, admin);
  assert.equal(recarga, r0);
  const primeira = await gravar(b, admin, randomUUID(), r0, [
    { ref: alfa, id: alfa, campos: { pastas: [] } },
    { ref: beta, id: beta, campos: { pastas: [pasta("~/Code/suporte")] } },
  ]);
  assert.equal(primeira.ok, true, primeira.erro);
  // a pessoa, ainda vendo o Suporte em Alfa, acrescenta outra pasta em Alfa a partir da leitura da recarga
  const segunda = await gravar(b, admin, randomUUID(), recarga, [
    { ref: alfa, id: alfa, campos: { pastas: [pasta("~/Code/suporte"), pasta("~/Code/vendas")] } },
  ]);
  assert.equal(segunda.ok, false);
  assert.equal(segunda.erro, "o cadastro mudou; atualize antes de salvar");
  const regras = await b.sql("select padrao, empresa_id from public.pastas_empresa order by padrao");
  assert.deepEqual(regras.map((r) => [r.padrao, r.empresa_id]), [["~/Code/suporte", beta]]);
});

test("mesma operação devolve os mesmos IDs sem criar nem auditar duas vezes", async () => {
  const { b, admin } = await cenario();
  const anterior = await versao(b, admin);
  const id = randomUUID();
  const primeira = await gravar(b, admin, id, anterior, novo("Alfa"));
  assert.equal(primeira.ok, true);
  assert.ok(primeira.ids["novo-1"]);
  const mudou = await b.rpc(admin, "painel_unidade", { p_id: null, p_campos: { nome: "Beta", modo: "desligado" } });
  assert.equal(mudou.ok, true);
  const repetida = await gravar(b, admin, id, anterior, novo("Alfa"));
  assert.deepEqual(repetida, primeira);
  assert.equal((await b.sql("select count(*)::int n from public.empresas where nome = 'Alfa'"))[0].n, 1);
  assert.equal((await b.sql("select count(*)::int n from public.auditoria where acao = 'unidade' and alvo = $1", [primeira.ids["novo-1"]]))[0].n, 1);
});

test("a revisão muda com o cadastro e o comprovante sobrevive à reaplicação das migrações", async () => {
  const { b, admin, leitor } = await cenario();
  const antes = await versao(b, admin);
  assert.match(antes, /^[0-9a-f]{64}$/);
  assert.equal(await versao(b, leitor), antes, "quem só lê vê a mesma revisão");
  const id = randomUUID();
  const gravada = await gravar(b, admin, id, antes, novo("Alfa"));
  assert.notEqual(await versao(b, admin), antes);
  await b.migrarDe("0048");
  assert.deepEqual(await gravar(b, admin, id, antes, novo("Alfa")), gravada);
  assert.equal((await b.sql("select count(*)::int n from public.empresas where nome = 'Alfa'"))[0].n, 1);
});

test("uma operação tardia com revisão antiga recusa sem apagar a alteração nova", async () => {
  const { b, admin } = await cenario();
  const anterior = await versao(b, admin);
  const nova = await gravar(b, admin, randomUUID(), anterior, novo("Beta"));
  assert.equal(nova.ok, true);
  const idTardio = randomUUID();
  const tardia = await gravar(b, admin, idTardio, anterior, novo("Alfa"));
  assert.equal(tardia.ok, false);
  assert.match(tardia.erro, /cadastro.*mudou/i);
  assert.deepEqual(await gravar(b, admin, idTardio, anterior, novo("Alfa")), tardia);
  assert.deepEqual(await nomes(b), ["Beta"]);
});

test("alteração por função antiga também muda a revisão usada pela função segura", async () => {
  const { b, admin } = await cenario();
  const anterior = await versao(b, admin);
  const antiga = await b.rpc(admin, "painel_unidade", { p_id: null, p_campos: { nome: "Beta", modo: "desligado" } });
  assert.equal(antiga.ok, true);
  const tardia = await gravar(b, admin, randomUUID(), anterior, novo("Alfa"));
  assert.equal(tardia.ok, false);
  assert.deepEqual(await nomes(b), ["Beta"]);
});

test("identidade não aceita outro pedido ou outro usuário, e nenhum papel lê o comprovante diretamente", async () => {
  const { b, admin, outro, leitor } = await cenario();
  const anterior = await versao(b, admin);
  const id = randomUUID();
  assert.equal((await gravar(b, admin, id, anterior, novo("Alfa"))).ok, true);
  await assert.rejects(gravar(b, admin, id, anterior, novo("Beta")), /operação já usada/);
  await assert.rejects(gravar(b, outro, id, anterior, novo("Alfa")), /operação já usada/);
  await assert.rejects(gravar(b, leitor, randomUUID(), anterior, novo("Beta")));
  await assert.rejects(gravar(b, "anon", randomUUID(), anterior, novo("Beta")));
  await assert.rejects(b.rpc("anon", "painel_cadastro_revisao"));
  await b.config("exigir_duas_etapas", true);
  await assert.rejects(gravar(b, { ...admin, aal: "aal1" }, randomUUID(), anterior, novo("Beta")), /duas etapas/);
  await assert.rejects(b.como(admin, "select * from public.cadastro_operacoes"), /permission denied/);
});

test("pedido malformado é recusado sem guardar operação", async () => {
  const { b, admin } = await cenario();
  const anterior = await versao(b, admin);
  await assert.rejects(gravar(b, admin, randomUUID(), "x", novo("Alfa")), /pedido inválido/);
  await assert.rejects(gravar(b, admin, randomUUID(), anterior, []), /pedido inválido/);
  await assert.rejects(gravar(b, admin, null, anterior, novo("Alfa")), /pedido inválido/);
  assert.equal((await b.sql("select count(*)::int n from public.cadastro_operacoes"))[0].n, 0);
});

test("recusa explícita não deixa dados parciais e é a mesma em uma repetição", async () => {
  const { b, admin } = await cenario();
  const anterior = await versao(b, admin);
  const id = randomUUID();
  const passos = [
    { ref: "novo-1", id: null, campos: { nome: "Alfa", modo: "desligado" } },
    { ref: "novo-2", id: null, campos: { nome: "Beta", modo: "ligado", contas: [] } },
  ];
  const primeira = await gravar(b, admin, id, anterior, passos);
  assert.equal(primeira.ok, false);
  assert.deepEqual(await gravar(b, admin, id, anterior, passos), primeira);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 0);
});

// Revisão de 26/11: o apagar de projeto também confere a revisão (antes ficava fora e a cascata levava a pasta movida)
const apagar = (b, quem, operacao, revisao, id) =>
  b.rpc(quem, "painel_empresa_apagar_seguro", { p_operacao: operacao, p_revisao: revisao, p_id: id });

test("apagar a partir de uma leitura velha é recusado e a pasta movida fica no projeto", async () => {
  const { b, admin } = await cenario();
  const alfa = (await b.rpc(admin, "painel_unidade", {
    p_id: null, p_campos: { nome: "Alfa", modo: "desligado", pastas: [pasta("~/Code/suporte")] },
  })).id;
  const beta = (await b.rpc(admin, "painel_unidade", { p_id: null, p_campos: { nome: "Beta", modo: "desligado" } })).id;
  const r0 = await versao(b, admin);
  // a aba 2 move o Suporte de Alfa para Beta; a aba 1, que leu R0 com Beta vazio, apaga Beta
  const movida = await gravar(b, admin, randomUUID(), r0, [
    { ref: alfa, id: alfa, campos: { pastas: [] } },
    { ref: beta, id: beta, campos: { pastas: [pasta("~/Code/suporte")] } },
  ]);
  assert.equal(movida.ok, true, movida.erro);
  const id = randomUUID();
  const recusa = await apagar(b, admin, id, r0, beta);
  assert.equal(recusa.ok, false);
  assert.equal(recusa.erro, "o cadastro mudou; atualize antes de salvar");
  assert.deepEqual(await apagar(b, admin, id, r0, beta), recusa, "a repetição devolve a mesma recusa");
  assert.deepEqual(await nomes(b), ["Alfa", "Beta"]);
  const regras = await b.sql("select padrao, empresa_id from public.pastas_empresa");
  assert.deepEqual(regras.map((r) => [r.padrao, r.empresa_id]), [["~/Code/suporte", beta]]);
});

test("apagar com a revisão atual apaga com a cascata, e a repetição não apaga de novo", async () => {
  const { b, admin } = await cenario();
  const beta = (await b.rpc(admin, "painel_unidade", {
    p_id: null, p_campos: { nome: "Beta", modo: "desligado", pastas: [pasta("~/Code/vendas")] },
  })).id;
  await b.rpc(admin, "painel_unidade", { p_id: null, p_campos: { nome: "Filho", pai: beta, modo: null } });
  const atual = await versao(b, admin);
  const id = randomUUID();
  const feito = await apagar(b, admin, id, atual, beta);
  assert.equal(feito.ok, true, feito.erro);
  assert.deepEqual(await nomes(b), []);
  assert.equal((await b.sql("select count(*)::int n from public.pastas_empresa"))[0].n, 0);
  assert.deepEqual(await apagar(b, admin, id, atual, beta), feito);
  assert.equal((await b.sql("select count(*)::int n from public.auditoria where acao = 'empresa_apagar'"))[0].n, 1);
});

test("apagar seguro: operação de outro tipo, quem não é admin e pedido malformado são recusados", async () => {
  const { b, admin, leitor } = await cenario();
  const atual = await versao(b, admin);
  const id = randomUUID();
  const criada = await gravar(b, admin, id, atual, novo("Alfa"));
  assert.equal(criada.ok, true);
  const alfa = criada.ids["novo-1"];
  const depois = await versao(b, admin);
  // a mesma operação não serve para outro tipo de pedido
  await assert.rejects(apagar(b, admin, id, atual, alfa), /operação já usada/);
  await assert.rejects(apagar(b, leitor, randomUUID(), depois, alfa));
  await assert.rejects(apagar(b, "anon", randomUUID(), depois, alfa));
  await assert.rejects(apagar(b, admin, randomUUID(), depois, null), /pedido inválido/);
  await assert.rejects(apagar(b, admin, randomUUID(), "x", alfa), /pedido inválido/);
  assert.deepEqual(await nomes(b), ["Alfa"]);
});

test("reaplicar a 0048 não tira do painel as funções que a 0099 liberou", async () => {
  const { b, admin } = await cenario();
  await b.migrarDe("0048", { ate: "0048" });
  const atual = await versao(b, admin);
  assert.match(atual, /^[0-9a-f]{64}$/);
  assert.equal((await gravar(b, admin, randomUUID(), atual, novo("Alfa"))).ok, true);
  await assert.rejects(b.rpc("anon", "painel_cadastro_revisao"), /permission denied/);
  await assert.rejects(b.como(admin, "select public.rvz_cadastro_revisao()"), /permission denied/);
});
