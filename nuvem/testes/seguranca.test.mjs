import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const TABELAS = ["membros", "convites", "computadores", "contas", "cofre", "posse", "atribuicao", "uso_janelas",
  "uso_historico", "uso_tokens", "sessoes", "eventos", "comandos", "config", "alertas", "push_inscricoes",
  "chaves_api", "webhooks_saida", "ligacoes", "ligacao_pedidos", "auditoria", "empresas", "conta_empresas",
  "pastas_empresa", "agentes_openbot", "atribuicao_trilhas", "trilhas_sombra", "empresa_computadores"];

test("anon não lê nem escreve tabela nenhuma", async () => {
  const b = await banco();
  for (const t of TABELAS) {
    await assert.rejects(b.como("anon", `select * from public.${t} limit 1`), /permission denied/, t);
  }
  await assert.rejects(b.como("anon", "insert into public.config (chave, valor) values ('auto', 'true')"), /permission denied/);
});

test("anon não chama função nenhuma", async () => {
  const b = await banco();
  await assert.rejects(b.rpc("anon", "painel_config", { p_chave: "auto", p_valor: true }), /permission denied/);
  await assert.rejects(b.rpc("anon", "agente_ola", { p_versao: "1" }), /permission denied/);
  await assert.rejects(b.como("anon", "select public.decidir()"), /permission denied/);
});

test("usuário logado sem papel não vê nada", async () => {
  const b = await banco();
  const pc = await b.computador();
  await b.conta(pc, "a@exemplo.com");
  const estranho = { id: await b.usuario(null), aal: "aal2" };
  assert.equal((await b.como(estranho, "select * from public.contas")).length, 0);
  assert.equal((await b.como(estranho, "select * from public.eventos")).length, 0);
  await assert.rejects(b.rpc(estranho, "painel_config", { p_chave: "auto", p_valor: true }), /só administrador/);
});

test("ninguém lê o cofre direto, nem o administrador", async () => {
  const b = await banco();
  const pc = await b.computador();
  await b.conta(pc, "a@exemplo.com");
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(b.como(admin, "select * from public.cofre"), /permission denied/);
  await assert.rejects(b.como(pc, "select * from public.cofre"), /permission denied/);
  await assert.rejects(b.como(admin, "select * from public.ligacoes"), /permission denied/);
});

test("membro de leitura lê, mas não muda nada", async () => {
  const b = await banco();
  const pc = await b.computador();
  await b.conta(pc, "a@exemplo.com");
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  assert.equal((await b.como(leitor, "select email from public.contas"))[0].email, "a@exemplo.com");
  await assert.rejects(b.rpc(leitor, "painel_config", { p_chave: "auto", p_valor: true }), /só administrador/);
  await assert.rejects(b.como(leitor, "update public.contas set pausada = true"), /permission denied/);
});

test("administrador sem a segunda etapa não muda nada (quando a instalação exige)", async () => {
  const b = await banco();
  await b.sql("insert into public.config (chave, valor) values ('exigir_duas_etapas', 'true') on conflict (chave) do update set valor = 'true'");
  const admin = { id: await b.usuario("admin"), aal: "aal1" };
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "auto", p_valor: true }), /duas etapas/);
  const admin2 = { ...admin, aal: "aal2" };
  assert.equal((await b.rpc(admin2, "painel_config", { p_chave: "auto", p_valor: true })).ok, true);
});

test("função de computador recusa quem não é computador e computador revogado", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(b.rpc(admin, "agente_ola", { p_versao: "1" }), /só computador/);
  const pc = await b.computador();
  await b.rpc(admin, "painel_revogar_computador", { p_computador: pc.pc });
  await assert.rejects(b.rpc(pc, "agente_ola", { p_versao: "1" }), /só computador/);
});

test("configuração inválida é recusada e a válida fica na auditoria", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "modo", p_valor: "turbo" }), /modo desconhecido/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "aviso", p_valor: 99 }), /aviso precisa ser menor/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "auto", p_valor: "sim" }), /verdadeiro ou falso/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "rodizio_minutos", p_valor: 5 }), /15 a 480/);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "outra", p_valor: 1 }), /desconhecida/);
  await b.rpc(admin, "painel_config", { p_chave: "modo", p_valor: "rodizio" });
  const aud = await b.sql("select acao, alvo from public.auditoria");
  assert.deepEqual(aud.map((a) => a.acao), ["config"]);
});

test("chave de API: aparece uma vez, guarda só o resumo, confere e revoga", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const r = await b.rpc(admin, "painel_chave_api_criar", { p_nome: "n8n", p_escopos: ["ler"] });
  assert.match(r.chave, /^rvz_[a-z0-9]{6}_[0-9a-f]{64}$/);
  const guardado = await b.sql("select hash from public.chaves_api");
  assert.notEqual(guardado[0].hash, r.chave);
  assert.equal((await b.sql("select public.api_conferir_chave($1) as r", [r.chave]))[0].r.ok, true);
  assert.equal((await b.sql("select public.api_conferir_chave($1) as r", [r.chave + "x"]))[0].r.ok, false);
  await b.rpc(admin, "painel_chave_api_revogar", { p_id: r.id });
  assert.equal((await b.sql("select public.api_conferir_chave($1) as r", [r.chave]))[0].r.ok, false);
  const leitor = { id: await b.usuario("leitura"), aal: "aal2" };
  await assert.rejects(b.rpc(leitor, "painel_chave_api_criar", { p_nome: "x", p_escopos: ["trocar"] }), /escopo só para administrador/);
  // a coluna hash não é legível nem pelo dono
  await assert.rejects(b.como(admin, "select hash from public.chaves_api"), /permission denied/);
});

test("o último administrador não deixa de ser administrador", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(b.rpc(admin, "painel_mudar_papel", { p_user: admin.id, p_papel: "leitura" }), /último administrador/);
});
