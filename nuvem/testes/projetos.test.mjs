// 0040/0041: projetos dentro da empresa e o modo de teste (sombra). O projeto é uma linha de empresas com "pai"; o
// projeto sem nada próprio é parte da empresa; com contas ou modo próprio, é uma unidade com trilha própria. A sombra
// decide como a trilha decidiria e só registra. Com tudo desligado, nada muda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario({ auto = true } = {}) {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("mini");
  await b.config("auto", auto);
  await b.config("modo", "limiar");
  return { b, admin, pc };
}

async function criar(b, admin, nome, campos = {}) {
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome, ...campos } });
  assert.equal(r.ok, true, r.erro);
  return r.id;
}

const mudar = (b, admin, id, campos) => b.rpc(admin, "painel_empresa", { p_id: id, p_campos: campos });
const marcar = (b, admin, conta, lista) => b.rpc(admin, "painel_conta_empresas", { p_conta: conta, p_lista: lista });
const regra = (b, admin, padrao, emp, tipo = "pasta") =>
  b.rpc(admin, "painel_pasta_empresa", { p_tipo: tipo, p_padrao: padrao, p_empresa: emp });
const pedir = (b, pc, ids) => b.rpc(pc, "agente_trilhas", { p_empresas: `{${ids.join(",")}}` });

async function trilha(b, pc, emp) {
  const [l] = await b.sql("select conta_id from public.atribuicao_trilhas where computador_id = $1 and empresa_id = $2", [pc.pc, emp]);
  return l?.conta_id ?? null;
}

async function sombra(b, pc, emp) {
  const [l] = await b.sql("select conta_id, em_uso, sessoes, trocas, motivo from public.trilhas_sombra where computador_id = $1 and empresa_id = $2", [pc.pc, emp]);
  return l ?? null;
}

async function sessao(b, pc, id, pasta) {
  const agora = new Date().toISOString();
  await b.rpc(pc, "agente_relatar_tokens", {
    p_linhas: [],
    p_sessoes: [{ id, projeto: "p", inicio: agora, fim: agora, respostas: 1, tokens: 1, usd: 0, agentes: 0, contas: [], modelos: [], pasta }],
  });
}

async function pct(b, conta, valor) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte) values ($1, 'five_hour', $2, now() + interval '2 hours', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em, lido_em = now()`, [conta, valor]);
}

const classificar = async (b, pc, pasta) =>
  (await b.sql("select public.rvz_classificar($1, $2) as e", [pc.pc, pasta]))[0].e;

test("com projetos e tudo desligado nada muda: sem trilha, sem sombra, a principal segue", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const p = await criar(b, admin, "Site", { pai: x });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [p]);
  await regra(b, admin, "~/Code/alfa/site", p);
  await sessao(b, pc, "s1", "~/Code/alfa/site");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a, "a principal usa a conta marcada no projeto, como hoje");
  assert.equal((await b.sql("select public.rvz_rodar_sombra() as n"))[0].n, 0);
  assert.equal((await b.sql("select count(*)::int n from public.trilhas_sombra"))[0].n, 0);
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas, []);
  assert.deepEqual(emp.regras, []);
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" })).trilhas, false);
});

test("nome do projeto é único dentro da empresa; projeto não tem projeto e não muda de empresa", async () => {
  const { b, admin } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const y = await criar(b, admin, "Beta");
  const p = await criar(b, admin, "Site", { pai: x });
  await criar(b, admin, "Site", { pai: y });
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "site", pai: x } });
  assert.equal(r.ok, false);
  assert.match(r.erro, /projeto com esse nome/);
  await assert.rejects(b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Sub", pai: p } }), /empresa do projeto desconhecida/);
  await assert.rejects(mudar(b, admin, p, { pai: y }), /não muda de empresa/);
  // uma empresa pode ter o nome de um projeto de outra
  await criar(b, admin, "Site");
});

test("projeto sem nada próprio é parte da empresa: a regra dele aponta para a empresa, a mesma trilha", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const p = await criar(b, admin, "Site", { pai: x });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code/alfa", x);
  await regra(b, admin, "~/Code/alfa/site", p);
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas.map(({ id, nome }) => ({ id, nome })), [{ id: x, nome: "Alfa" }]);
  assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]), [["~/Code/alfa", x], ["~/Code/alfa/site", x]]);
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" })).trilhas, true);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
});

test("projeto com contas próprias tem trilha própria; a principal não usa as contas dele", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const p = await criar(b, admin, "Site", { pai: x });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const s = await b.conta(pc, "s@exemplo.com", 6);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, s, [p]);
  await regra(b, admin, "~/Code/alfa", x);
  await regra(b, admin, "~/Code/alfa/site", p);
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas.map(({ id, nome }) => ({ id, nome })), [{ id: x, nome: "Alfa" }, { id: p, nome: "Alfa / Site" }]);
  assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]), [["~/Code/alfa", x], ["~/Code/alfa/site", p]]);
  await pedir(b, pc, [x, p]);
  assert.equal(await trilha(b, pc, x), a);
  assert.equal(await trilha(b, pc, p), s);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), c, "a principal fica com a conta que não é de unidade ligada");
  const [ev] = await b.sql("select texto from public.eventos where tipo = 'troca' and dados ->> 'empresa' = $1", [p]);
  assert.match(ev.texto, /Troca na trilha Alfa \/ Site/);
});

test("projeto herda o transbordo: cheias as dele, usa as da empresa", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const p = await criar(b, admin, "Site", { pai: x });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const s = await b.conta(pc, "s@exemplo.com", 100);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, s, [p]);
  await pedir(b, pc, [p]);
  assert.equal(await trilha(b, pc, p), a, "a do projeto está cheia: vai a da empresa");
  // sem herdar, o transbordo é o do projeto ("nenhum" de fábrica): fica na cheia
  await b.sql("delete from public.atribuicao_trilhas");
  await mudar(b, admin, p, { herdar_transbordo: false });
  await pedir(b, pc, [p]);
  assert.equal(await trilha(b, pc, p), s);
});

test("projeto desligado dentro de empresa ligada: a regra dele vence e aponta para fora da lista", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const p = await criar(b, admin, "Site", { pai: x, modo: "desligado" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code/alfa", x);
  await regra(b, admin, "~/Code/alfa/site", p);
  await b.rpc(pc, "agente_ola", { p_versao: "0.19.0" });
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas.map((e) => e.id), [x]);
  assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]), [["~/Code/alfa", x], ["~/Code/alfa/site", p]]);
  assert.equal(await classificar(b, pc, "~/Code/Alfa/site/x"), p);
});

test("agente 0.18 não encaminha projeto desligado para a trilha da empresa", async () => {
  const { b, admin, pc } = await cenario();
  const empresa = await criar(b, admin, "Alfa", { modo: "ligado" });
  const projeto = await criar(b, admin, "Site", { pai: empresa, modo: "desligado" });
  await regra(b, admin, "~/Code/alfa", empresa);
  await regra(b, admin, "~/Code/alfa/site", projeto);
  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  const resposta = await b.rpc(pc, "agente_empresas");
  // A 0.18 filtra primeiro as regras cuja empresa não consta na lista de trilhas.
  const ligadas = new Set(resposta.empresas.map((e) => e.id));
  const correspondentes = resposta.regras.filter((r) => ligadas.has(r.empresa) &&
    ("~/code/alfa/site/web" === r.padrao.toLowerCase() || "~/code/alfa/site/web".startsWith(r.padrao.toLowerCase() + "/")));
  assert.deepEqual(correspondentes, [], "o agente antigo não pode usar a trilha da empresa para um projeto desligado");
});

test("retorno de agente 0.18 preserva trilha existente e não encaminha projeto desligado", async () => {
  const { b, admin, pc } = await cenario();
  const empresa = await criar(b, admin, "Alfa", { modo: "ligado" });
  const conta = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, conta, [empresa]);
  await regra(b, admin, "~/Code/alfa", empresa);
  await pedir(b, pc, [empresa]);
  assert.equal(await trilha(b, pc, empresa), conta);

  const projeto = await criar(b, admin, "Site", { pai: empresa, modo: "desligado" });
  await regra(b, admin, "~/Code/alfa/site", projeto);
  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  const resposta = await b.rpc(pc, "agente_empresas");
  const trilhas = await pedir(b, pc, [empresa]);
  assert.equal(await trilha(b, pc, empresa), conta, "a sessão existente mantém a conta");
  assert.equal(trilhas.trilhas.find((t) => t.empresa === empresa)?.conta_id, conta);

  // Na 0.18, só as regras que apontam para empresas retornadas entram na classificação.
  const ligadas = new Set(resposta.empresas.map((e) => e.id));
  const regras = resposta.regras.filter((r) => ligadas.has(r.empresa) &&
    ("~/code/alfa/site/web" === r.padrao.toLowerCase() || "~/code/alfa/site/web".startsWith(r.padrao.toLowerCase() + "/")));
  assert.deepEqual(regras, [], "a nova sessão do projeto desligado deve usar a principal");
});

test("o computador que atualiza para a 0.19 volta a receber a empresa com o projeto desligado", async () => {
  const { b, admin, pc } = await cenario();
  const empresa = await criar(b, admin, "Alfa", { modo: "ligado" });
  const projeto = await criar(b, admin, "Site", { pai: empresa, modo: "desligado" });
  const conta = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, conta, [empresa]);
  await regra(b, admin, "~/Code/alfa", empresa);
  await regra(b, admin, "~/Code/alfa/site", projeto);

  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, [], "o agente antigo fica no rodízio de sempre");
  await b.rpc(pc, "agente_ola", { p_versao: "0.19.0" });
  const depois = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(depois.empresas.map((e) => e.id), [empresa], "o agente novo recebe a empresa");
  assert.equal(depois.regras.length, 2, "e as duas regras, para decidir a mais específica sozinho");
});

test("a versão do agente vira número e o que não casa conta como anterior a tudo", async () => {
  const b = await banco();
  const [l] = await b.sql(`select public.rvz_versao_agente('0.19.0') as nova, public.rvz_versao_agente('0.18.4') as velha,
                                  public.rvz_versao_agente('1.0.0') as um, public.rvz_versao_agente(null) as nulo,
                                  public.rvz_versao_agente('0.9') as curta, public.rvz_versao_agente('0.19.0-rc1') as rc,
                                  public.rvz_versao_agente('99999999999.0.0') as enorme,
                                  public.rvz_versao_num('0.19.0') as da_0021`);
  assert.equal(l.nova, 19000);
  assert.ok(l.velha < l.nova && l.velha > 18000 - 1);
  assert.ok(l.um > l.nova);
  assert.equal(l.nulo, 0);
  assert.equal(l.curta, 0, "sem remendo não dá para comparar: conta como anterior");
  assert.equal(l.rc, 19000);
  assert.equal(l.enorme, 0, "número grande demais não estoura: conta como anterior");
  assert.deepEqual(l.da_0021, [0, 19, 0], "a função da atualização da nuvem (0021) continua como era");
});

test("projeto ligado numa empresa desligada liga as trilhas do computador", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const p = await criar(b, admin, "Site", { pai: x, modo: "ligado" });
  const s = await b.conta(pc, "s@exemplo.com", 5);
  await marcar(b, admin, s, [p]);
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" })).trilhas, true);
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas.map(({ id, nome }) => ({ id, nome })), [{ id: p, nome: "Alfa / Site" }]);
  await pedir(b, pc, [p]);
  assert.equal(await trilha(b, pc, p), s);
  // desligar o projeto: a trilha fica até a última sessão sair (como na 0.18.0), sem troca nova
  await mudar(b, admin, p, { modo: null });
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" })).trilhas, false);
});

test("a empresa com projeto em trilha não sai; sem trilha, sai com os projetos", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const p = await criar(b, admin, "Site", { pai: x, modo: "ligado" });
  const s = await b.conta(pc, "s@exemplo.com", 5);
  await marcar(b, admin, s, [p]);
  await pedir(b, pc, [p]);
  const r = await b.rpc(admin, "painel_empresa_apagar", { p_id: x });
  assert.equal(r.ok, false);
  await b.sql("delete from public.atribuicao_trilhas");
  assert.equal((await b.rpc(admin, "painel_empresa_apagar", { p_id: x })).ok, true);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 0);
});

test("classificar a pasta: o caminho mais longo vence, depois o nome de pasta e o título do agente", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const p = await criar(b, admin, "Site", { pai: x });
  const y = await criar(b, admin, "Beta");
  await regra(b, admin, "~/Code/alfa", x);
  await regra(b, admin, "~/Code/alfa/site/", p);
  await regra(b, admin, "beta-app", y);
  await regra(b, admin, "Exemplo", y, "titulo");
  await b.sql("insert into public.agentes_openbot (computador_id, pasta, nome, titulo) values ($1, '~/OpenBot/Agents/agent-1', 'Um', 'Projeto Exemplo')", [pc.pc]);
  assert.equal(await classificar(b, pc, "~/Code/alfa"), x);
  assert.equal(await classificar(b, pc, "~/Code/alfa/site/web"), p);
  assert.equal(await classificar(b, pc, "~/Code/alfabeto"), null, "prefixo só pega a pasta inteira");
  assert.equal(await classificar(b, pc, "~/x/Beta-App/src"), y);
  assert.equal(await classificar(b, pc, "~/OpenBot/Agents/agent-1/trabalho"), y);
  assert.equal(await classificar(b, pc, "~/OpenBot/Agents/agent-2"), null);
  assert.equal(await classificar(b, pc, ""), null);
});

test("sombra: decide e registra a conta que usaria, sem trocar nada; no limite registraria a troca", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "sombra" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const d = await b.conta(pc, "d@exemplo.com", 20);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  await marcar(b, admin, a, [x]);
  await marcar(b, admin, d, [x]);
  await regra(b, admin, "~/Code/alfa", x);
  await b.sql("select public.decidir()");
  const principal = await b.atribuida(pc);
  assert.equal(principal, a, "em teste a principal segue usando qualquer conta, como hoje");
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" })).trilhas, false);
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, []);

  await sessao(b, pc, "s1", "~/Code/alfa/web");
  await sessao(b, pc, "s2", "~/Code/fora");
  assert.equal((await b.sql("select public.rvz_rodar_sombra() as n"))[0].n, 1);
  let l = await sombra(b, pc, x);
  assert.equal(l.conta_id, a);
  assert.equal(l.em_uso, principal);
  assert.equal(l.sessoes, 1);
  assert.equal(l.trocas, 0);
  assert.equal((await b.sql("select count(*)::int n from public.atribuicao_trilhas"))[0].n, 0, "nenhuma trilha de verdade");
  const [ev] = await b.sql("select tipo, texto, dados from public.eventos where dados ->> 'motivo' = 'sombra'");
  assert.equal(ev.tipo, "info");
  assert.match(ev.texto, /Em teste, Alfa começaria/);

  // de novo, sem mudança: nenhum evento novo
  await b.sql("select public.rvz_rodar_sombra()");
  assert.equal((await b.sql("select count(*)::int n from public.eventos where dados ->> 'motivo' = 'sombra'"))[0].n, 1);

  // a conta chega a 100%: trocaria para a outra da empresa, e só registra
  await pct(b, a, 100);
  await b.sql("select public.rvz_rodar_sombra()");
  l = await sombra(b, pc, x);
  assert.equal(l.conta_id, d);
  assert.equal(l.trocas, 1);
  assert.equal(l.motivo, "chegou a 100%");
  assert.equal(await b.atribuida(pc), principal, "a principal não foi tocada pela sombra");
  assert.equal((await b.sql("select count(*)::int n from public.eventos where tipo = 'troca' and dados ? 'empresa'"))[0].n, 0);
  assert.ok(c);
});

test("sombra: unidade sem sessão há 10 minutos sai; sem unidade em teste, só limpa", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "sombra" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code/alfa", x);
  await sessao(b, pc, "s1", "~/Code/alfa");
  await b.sql("select public.rvz_rodar_sombra()");
  assert.ok(await sombra(b, pc, x));
  await b.sql("update public.sessoes set fim = now() - interval '20 minutes'");
  await b.sql("update public.trilhas_sombra set visto_em = now() - interval '20 minutes'");
  await b.sql("select public.rvz_rodar_sombra()");
  assert.equal(await sombra(b, pc, x), null);
  await mudar(b, admin, x, { modo: "desligado" });
  assert.equal((await b.sql("select public.rvz_rodar_sombra() as n"))[0].n, 0);
});

test("o painel guarda o modo e o separar juntos (o agente 0.18.0 lê o separar)", async () => {
  const { b, admin } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const ler = async (id) => (await b.sql("select separar, modo, public.rvz_modo_de(id) efetivo from public.empresas where id = $1", [id]))[0];
  assert.deepEqual(await ler(x), { separar: false, modo: null, efetivo: "desligado" });
  await mudar(b, admin, x, { modo: "ligado" });
  assert.deepEqual(await ler(x), { separar: true, modo: "ligado", efetivo: "ligado" });
  await mudar(b, admin, x, { modo: "sombra" });
  assert.deepEqual(await ler(x), { separar: false, modo: "sombra", efetivo: "sombra" });
  await mudar(b, admin, x, { separar: true });
  assert.deepEqual(await ler(x), { separar: true, modo: "ligado", efetivo: "ligado" });
  await mudar(b, admin, x, { separar: false });
  assert.deepEqual(await ler(x), { separar: false, modo: "desligado", efetivo: "desligado" });
  const p = await criar(b, admin, "Site", { pai: x });
  assert.deepEqual(await ler(p), { separar: false, modo: null, efetivo: "desligado" });
  await mudar(b, admin, x, { modo: "sombra" });
  assert.equal((await ler(p)).efetivo, "sombra", "o projeto sem modo segue a empresa");
  await assert.rejects(mudar(b, admin, x, { modo: null }), /a empresa precisa de um modo/);
  await assert.rejects(mudar(b, admin, x, { modo: "talvez" }), /modo inválido/);
});

test("projeto em teste dentro de empresa ligada não muda as sessões: segue a empresa, aqui e no agente 0.18", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const p = await criar(b, admin, "Site", { pai: x, modo: "sombra" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code/alfa", x);
  await regra(b, admin, "~/Code/alfa/site", p);
  for (const versao of ["0.19.0", "0.18.0"]) {
    await b.rpc(pc, "agente_ola", { p_versao: versao });
    const emp = await b.rpc(pc, "agente_empresas");
    assert.deepEqual(emp.empresas.map((e) => e.id), [x], `${versao}: a empresa continua indo`);
    assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]), [["~/Code/alfa", x], ["~/Code/alfa/site", x]],
      `${versao}: a regra do projeto em teste aponta para a empresa`);
  }
  // com a empresa ligada, a trilha do projeto em teste seria a da empresa: nada a testar
  await sessao(b, pc, "s1", "~/Code/alfa/site/web");
  assert.equal((await b.sql("select public.rvz_rodar_sombra() as n"))[0].n, 0);
});

test("projeto em teste numa empresa desligada: a sombra mostra o que ele faria, e nada vai ao agente", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const p = await criar(b, admin, "Site", { pai: x, modo: "sombra" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code/alfa/site", p);
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas, []);
  assert.deepEqual(emp.regras, []);
  await sessao(b, pc, "s1", "~/Code/alfa/site/web");
  assert.equal((await b.sql("select public.rvz_rodar_sombra() as n"))[0].n, 1);
  assert.equal((await sombra(b, pc, p)).conta_id, a, "usaria a conta da empresa (o projeto não tem conta própria)");
});

test("empresa de cima desligada não manda regra ao agente, como na 0.18: a regra dela só conta nos números", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const y = await criar(b, admin, "Beta");
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await marcar(b, admin, a, [x]);
  await regra(b, admin, "~/Code", x);
  await regra(b, admin, "~/Code/cliente", y);
  for (const versao of ["0.19.0", "0.18.0"]) {
    await b.rpc(pc, "agente_ola", { p_versao: versao });
    const emp = await b.rpc(pc, "agente_empresas");
    assert.deepEqual(emp.empresas.map((e) => e.id), [x], versao);
    assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]), [["~/Code", x]], versao);
  }
  assert.equal(await classificar(b, pc, "~/Code/cliente/web"), y, "nos números a pasta é da Beta");
});

test("projeto de outra empresa com regra de nome ou título: o agente 0.18 não recebe a empresa ligada que erraria", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const y = await criar(b, admin, "Beta", { modo: "ligado" });
  const q = await criar(b, admin, "Ferramenta", { pai: y, modo: "desligado" });
  await regra(b, admin, "~/Code", x);
  await regra(b, admin, "~/Beta", y);
  await regra(b, admin, "ferramenta", q);
  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, [],
    "a Alfa sai (uma pasta ~/Code/x/ferramenta seria do projeto) e a Beta sai (o projeto é dela)");
  await b.rpc(pc, "agente_ola", { p_versao: "0.19.0" });
  const emp = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(emp.empresas.map((e) => e.id).sort(), [x, y].sort());
  assert.deepEqual(emp.regras.map((r) => [r.padrao, r.empresa]).sort(), [["~/Beta", y], ["~/Code", x], ["ferramenta", q]].sort());
  // título conta igual a nome
  await b.sql("delete from public.pastas_empresa where padrao = 'ferramenta'");
  await regra(b, admin, "Ferramenta", q, "titulo");
  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, []);
});

test("caminhos de empresas diferentes só cruzam com a barra: ~/Code/site2 não está dentro de ~/Code/site", async () => {
  const { b, admin, pc } = await cenario();
  const x = await criar(b, admin, "Alfa", { modo: "ligado" });
  const y = await criar(b, admin, "Beta", { modo: "ligado" });
  const q = await criar(b, admin, "Outro", { pai: y, modo: "desligado" });
  await regra(b, admin, "~/Code/site", x);
  await regra(b, admin, "~/Beta", y);
  await regra(b, admin, "~/Code/site2", q);
  await b.rpc(pc, "agente_ola", { p_versao: "0.18.0" });
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas.map((e) => e.id), [x], "só a Beta sai (o projeto é dela)");
  await regra(b, admin, "~/Code/site/sub", q);
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).empresas, [], "agora o projeto pega uma pasta de dentro da Alfa");
});

test("a 0036 pode rodar de novo com dois projetos de mesmo nome: o índice novo tem o nome do velho", async () => {
  const { b, admin } = await cenario();
  const x = await criar(b, admin, "Alfa");
  const y = await criar(b, admin, "Beta");
  await criar(b, admin, "Site", { pai: x });
  await criar(b, admin, "Site", { pai: y });
  const { readFileSync } = await import("node:fs");
  await b.db.exec(readFileSync(new URL("../migracoes/0036_empresas.sql", import.meta.url), "utf8"));
  const [i] = await b.sql("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'empresas_nome'");
  assert.match(i.indexdef, /COALESCE\(pai/i);
  await criar(b, admin, "Site", { pai: await criar(b, admin, "Gama") });
});
