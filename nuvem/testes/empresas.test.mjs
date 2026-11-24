// 0036/0037: empresas, as contas que cada uma usa, o transbordo, as regras de pasta, a pasta inteira no uso e os
// agentes do OpenBot de cada computador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("mini");
  return { b, admin, leitor, pc };
}

const linha = (extra = {}) => ({
  hora: new Date().toISOString(), conta_id: "", projeto: "producao", modelo: "claude-opus", respostas: 1,
  entrada: 10, saida: 20, cache_escrita: 0, cache_leitura: 0, usd: 0.5, agentes: 0, ...extra,
});

test("duas pastas com o mesmo nome curto na mesma hora viram duas linhas; agente antigo segue com a pasta vazia", async () => {
  const { b, pc } = await cenario();
  await b.rpc(pc, "agente_relatar_tokens", {
    p_linhas: [linha({ pasta: "~/Code/a/producao" }), linha({ pasta: "~/Code/b/producao", usd: 2 })],
  });
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [linha({ usd: 7 })] });
  const linhas = await b.sql("select pasta, usd::float as usd from public.uso_tokens order by pasta");
  assert.deepEqual(linhas, [
    { pasta: "", usd: 7 },
    { pasta: "~/Code/a/producao", usd: 0.5 },
    { pasta: "~/Code/b/producao", usd: 2 },
  ]);
  // mandar de novo a mesma hora e pasta atualiza a linha, não duplica
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [linha({ pasta: "~/Code/a/producao", usd: 3 })] });
  const [{ n, usd }] = await b.sql("select count(*)::int n, sum(usd)::float usd from public.uso_tokens");
  assert.equal(n, 3);
  assert.equal(usd, 12);
});

test("pasta estranha (relativa, com caractere de controle, longa) não entra como pasta", async () => {
  const { b, pc } = await cenario();
  await b.rpc(pc, "agente_relatar_tokens", {
    p_linhas: [linha({ pasta: "relativa/x" }), linha({ pasta: "~/ok\u0007", modelo: "m2" }), linha({ pasta: "/" + "x".repeat(400), modelo: "m3" }),
      linha({ pasta: "D:/clienteA/api", modelo: "m4" })],
  });
  const linhas = await b.sql("select modelo, pasta, length(pasta) as n from public.uso_tokens order by modelo");
  assert.equal(linhas[0].pasta, "");
  assert.equal(linhas[1].pasta, "~/ok");
  assert.equal(linhas[2].n, 300);
  assert.equal(linhas[3].pasta, "D:/clienteA/api", "pasta do Windows com a letra do disco vale");
});

test("duas linhas do lote que viram a mesma aqui vão somadas, sem derrubar o lote", async () => {
  const { b, pc } = await cenario();
  await b.rpc(pc, "agente_relatar_tokens", {
    p_linhas: [linha({ pasta: "~/Code/a ", usd: 1 }), linha({ pasta: "~/Code/a", usd: 2 }), linha({ pasta: "relativa", usd: 4 }),
      linha({ pasta: "outra", usd: 8 })],
  });
  const linhas = await b.sql("select pasta, usd::float as usd, respostas from public.uso_tokens order by pasta");
  assert.deepEqual(linhas, [
    { pasta: "", usd: 12, respostas: 2 },
    { pasta: "~/Code/a", usd: 3, respostas: 2 },
  ]);
});

test("sessão leva a pasta e não perde a pasta quando o agente antigo manda de novo sem ela", async () => {
  const { b, pc } = await cenario();
  const agora = new Date().toISOString();
  const s = { id: "s1", projeto: "producao", inicio: agora, fim: agora, respostas: 1, tokens: 10, usd: 1, agentes: 0, contas: [], modelos: [] };
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [], p_sessoes: [{ ...s, pasta: "~/Code/a" }] });
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [], p_sessoes: [{ ...s, respostas: 2 }] });
  const [l] = await b.sql("select pasta, respostas from public.sessoes where id = 's1'");
  assert.deepEqual(l, { pasta: "~/Code/a", respostas: 2 });
});

test("empresa: só administrador cria; nome repetido é recusado; transbordo guarda só contas que existem", async () => {
  const { b, admin, leitor, pc } = await cenario();
  const c1 = await b.conta(pc, "um@exemplo.com");
  await assert.rejects(b.rpc(leitor, "painel_empresa", { p_id: null, p_campos: { nome: "Alfa" } }));
  await assert.rejects(b.rpc(pc, "painel_empresa", { p_id: null, p_campos: { nome: "Alfa" } }));
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: " Alfa ", transbordo: "escolhidas",
    transbordo_contas: [c1, "00000000-0000-0000-0000-000000000001"] } });
  assert.equal(r.ok, true);
  const [e] = await b.sql("select nome, transbordo, transbordo_contas from public.empresas where id = $1", [r.id]);
  assert.deepEqual(e, { nome: "Alfa", transbordo: "escolhidas", transbordo_contas: [c1] });
  const dup = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "alfa" } });
  assert.equal(dup.ok, false);
  await assert.rejects(b.rpc(admin, "painel_empresa", { p_id: r.id, p_campos: { transbordo: "tudo" } }), /transbordo/);
  await assert.rejects(b.rpc(admin, "painel_empresa", { p_id: r.id, p_campos: { email: "x" } }), /não permitido/);
  await assert.rejects(b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "a\nb" } }), /nome/);
  const [{ n }] = await b.sql("select count(*)::int n from public.auditoria where acao = 'empresa'");
  assert.equal(n, 1);
});

test("marcas da conta: a lista inteira vale; vazia volta a atender todas; empresa apagada leva as marcas e as regras", async () => {
  const { b, admin, pc } = await cenario();
  const c1 = await b.conta(pc, "um@exemplo.com");
  const { id: a } = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Alfa" } });
  const { id: z } = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Zeta" } });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: c1, p_lista: [a, z] });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: c1, p_lista: [z] });
  assert.deepEqual((await b.sql("select empresa_id from public.conta_empresas")).map((l) => l.empresa_id), [z]);
  await assert.rejects(b.rpc(admin, "painel_conta_empresas", { p_conta: c1, p_lista: ["00000000-0000-0000-0000-000000000009"] }),
    /projeto desconhecido/);
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: "~/Code/zeta/", p_empresa: z });
  const [{ padrao }] = await b.sql("select padrao from public.pastas_empresa");
  assert.equal(padrao, "~/Code/zeta", "a barra do fim sai");
  await b.rpc(admin, "painel_empresa_apagar", { p_id: z });
  const [{ m }] = await b.sql("select (select count(*) from public.conta_empresas) + (select count(*) from public.pastas_empresa) as m");
  assert.equal(Number(m), 0);
  await b.rpc(admin, "painel_conta_empresas", { p_conta: c1, p_lista: [] });
  // o uso não muda com nada disso
  const [{ contas }] = await b.sql("select count(*)::int as contas from public.contas");
  assert.equal(contas, 1);
});

test("regra de pasta: mesmo tipo e padrão troca a empresa; tipo e padrão inválidos são recusados", async () => {
  const { b, admin } = await cenario();
  const { id: a } = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Alfa" } });
  const { id: z } = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Zeta" } });
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "titulo", p_padrao: "Zeta", p_empresa: a });
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "titulo", p_padrao: "Zeta", p_empresa: z });
  const regras = await b.sql("select tipo, padrao, empresa_id from public.pastas_empresa");
  assert.deepEqual(regras, [{ tipo: "titulo", padrao: "Zeta", empresa_id: z }]);
  await assert.rejects(b.rpc(admin, "painel_pasta_empresa", { p_tipo: "regex", p_padrao: "x", p_empresa: z }), /tipo/);
  await assert.rejects(b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: "  ", p_empresa: z }), /padrão/);
  // a pasta pessoal ou a raiz do disco inteira pegaria o uso de todas as empresas
  for (const amplo of ["~", "~/", "/", "//", "C:", "c:/"]) {
    await assert.rejects(b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: amplo, p_empresa: z }), /padrão/, amplo);
  }
  await b.rpc(admin, "painel_pasta_empresa", { p_tipo: "pasta", p_padrao: "D:/clienteA/", p_empresa: z });
  const [{ padrao }] = await b.sql("select padrao from public.pastas_empresa where tipo = 'pasta'");
  assert.equal(padrao, "D:/clienteA");
});

test("agentes do OpenBot: o computador grava e atualiza; membro lê; ninguém de fora escreve", async () => {
  const { b, leitor, pc } = await cenario();
  await b.rpc(pc, "agente_relatar_agentes", { p_lista: [
    { pasta: "~/OpenBot/Agents/agent-1", nome: "Um", titulo: "Empresa A" },
    { pasta: "relativa", nome: "x" },
    "lixo",
  ] });
  await b.rpc(pc, "agente_relatar_agentes", { p_lista: [{ pasta: "~/OpenBot/Agents/agent-1", nome: "Um", titulo: "Empresa B" }] });
  const lidos = await b.como(leitor, "select pasta, nome, titulo from public.agentes_openbot");
  assert.deepEqual(lidos, [{ pasta: "~/OpenBot/Agents/agent-1", nome: "Um", titulo: "Empresa B" }]);
  await assert.rejects(b.rpc(leitor, "agente_relatar_agentes", { p_lista: [] }));
  await assert.rejects(b.como(leitor, "insert into public.empresas (nome) values ('x')"), /permission denied/);
});

test("conta removida: o uso dela soma na linha sem conta da mesma pasta, sem juntar pastas diferentes", async () => {
  const { b, admin, pc } = await cenario();
  const c1 = await b.conta(pc, "um@exemplo.com");
  const hora = new Date(Date.now() - 2 * 3600e3).toISOString();
  await b.rpc(pc, "agente_relatar_tokens", { p_linhas: [
    linha({ hora, pasta: "~/Code/a/producao", usd: 1 }),
    linha({ hora, conta_id: c1, pasta: "~/Code/a/producao", usd: 2 }),
    linha({ hora, conta_id: c1, pasta: "~/Code/b/producao", usd: 4 }),
  ] });
  await b.sql("update public.contas set sai_em = now() - interval '1 minute', saida_por = $1 where id = $2", [admin.id, c1]);
  await b.sql("select public.rvz_purgar_contas_saindo()");
  const linhas = await b.sql("select pasta, conta_id, usd::float as usd from public.uso_tokens order by pasta");
  assert.deepEqual(linhas, [
    { pasta: "~/Code/a/producao", conta_id: null, usd: 3 },
    { pasta: "~/Code/b/producao", conta_id: null, usd: 4 },
  ]);
});
