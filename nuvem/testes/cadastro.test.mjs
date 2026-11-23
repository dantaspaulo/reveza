// 0043/0044: o cadastro operacional. A empresa ou o projeto salvo pela tela roda só nas contas marcadas; uma conta pode
// servir a várias empresas; a pasta vale por computador; e quem não salvou pela tela segue como antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

async function cenario() {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("mini");
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  await b.config("auto", true);
  await b.config("modo", "limiar");
  return { b, admin, pc };
}

const salvar = (b, admin, id, campos) => b.rpc(admin, "painel_unidade", { p_id: id, p_campos: campos });

async function criar(b, admin, campos) {
  const r = await salvar(b, admin, null, campos);
  assert.equal(r.ok, true, r.erro);
  return r.id;
}

const pasta = (padrao, computador = null) => ({ tipo: "pasta", padrao, computador });
const pedir = (b, pc, ids) => b.rpc(pc, "agente_trilhas", { p_empresas: `{${ids.join(",")}}` });

async function trilha(b, pc, emp) {
  const [l] = await b.sql("select conta_id from public.atribuicao_trilhas where computador_id = $1 and empresa_id = $2", [pc.pc, emp]);
  return l?.conta_id ?? null;
}

async function pct(b, conta, valor) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte) values ($1, 'five_hour', $2, now() + interval '2 hours', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em, lido_em = now()`, [conta, valor]);
}

const classificar = async (b, pc, p) => (await b.sql("select public.rvz_classificar($1, $2) as e", [pc.pc, p]))[0].e;

test("salvar grava nome, conta, pasta e modo juntos; a empresa passa a rodar só nas contas dela", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.conta(pc, "c@exemplo.com", 30);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  const [e] = await b.sql("select so_contas_dela, separar from public.empresas where id = $1", [x]);
  assert.equal(e.so_contas_dela, true);
  assert.equal(e.separar, true);
  const r = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(r.empresas.map((u) => [u.id, u.estrita]), [[x, true]]);
  assert.deepEqual(r.regras.map((l) => [l.padrao, l.empresa]), [["~/Code/alfa", x]]);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
});

test("ligar sem conta é recusado e nada fica gravado pela metade", async () => {
  const { b, admin } = await cenario();
  const r = await salvar(b, admin, null, { nome: "Sem conta", modo: "ligado", contas: [], pastas: [pasta("~/Code/sem")] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /escolha uma conta/);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 0);
  assert.equal((await b.sql("select count(*)::int n from public.pastas_empresa"))[0].n, 0);
});

test("a empresa não fica sem conta se um projeto ligado usa a dela", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  await criar(b, admin, { nome: "Site", pai: x, modo: "ligado", contas: [] });
  const ligada = await salvar(b, admin, x, { contas: [] });
  assert.equal(ligada.ok, false);
  assert.match(ligada.erro, /escolha uma conta/);
  const r = await salvar(b, admin, x, { modo: "desligado", contas: [] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /projeto ligado/);
  assert.equal((await b.sql("select count(*)::int n from public.conta_empresas where empresa_id = $1", [x]))[0].n, 1);
});

test("a mesma conta em duas empresas no mesmo computador divide uma trilha só", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a], pastas: [pasta("~/Code/beta")] });
  const r = await b.rpc(pc, "agente_empresas");
  assert.equal(r.empresas.length, 1, "uma trilha para as duas");
  assert.equal(r.empresas[0].id, x, "a mais antiga representa");
  assert.match(r.empresas[0].nome, /Alfa \+ Beta/);
  assert.deepEqual(new Set(r.regras.map((l) => l.empresa)), new Set([x]));
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  assert.equal(await trilha(b, pc, y), null);
});

test("a trilha dividida não troca de representante quando entra uma empresa mais antiga na mesma conta", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const velha = await criar(b, admin, { nome: "Velha", modo: "desligado", contas: [a] });
  const nova = await criar(b, admin, { nome: "Nova", modo: "ligado", contas: [a] });
  await pedir(b, pc, [nova]);
  assert.equal(await trilha(b, pc, nova), a);
  await salvar(b, admin, velha, { modo: "ligado" });
  const r = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(r.empresas.map((u) => u.id), [nova], "quem já tem o login segue com ele");
});

test("só as contas dela: conta cheia não transborda para outra", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Antiga" } });
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  await pct(b, a, 99);
  await pedir(b, pc, [x]);
  assert.notEqual(await trilha(b, pc, x), c);
});

test("a conta marcada para uma empresa ligada sai da principal do computador", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 30);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
  await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  assert.equal(await b.atribuida(pc), c);
});

test("com todas as contas marcadas, a principal fica e o agente recebe a lista para abrir a sessão nela", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.sql("select public.decidir()");
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  assert.equal(await b.atribuida(pc), a, "sem outra conta, a principal fica nela");
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), null, "o login não vai para duas pastas");
  const r = await b.rpc(pc, "agente_empresas");
  assert.deepEqual(r.empresas.map((u) => [u.id, u.estrita, u.contas]), [[x, true, [a]]]);
});

// A sessão da empresa abriu no login da principal, porque a conta dela estava lá e não havia outra.
async function sessaoNaPrincipal() {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  await b.sql("select public.decidir()");
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  const r = await b.rpc(pc, "agente_segurar_principal", { p_empresas: `{${x}}` });
  assert.deepEqual(r, { ok: true, segura: true, unidades: [x], conta: a });
  return { b, admin, pc, a, x };
}

test("sessão da empresa aberta na conta do computador: aparece outra conta livre e a conta dela não sai", async () => {
  const { b, pc, a } = await sessaoNaPrincipal();
  await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a);
});

test("a conta dela encheu: a sessão espera nela, não vai para outra, e o painel recebe um alerta só", async () => {
  const { b, pc, a } = await sessaoNaPrincipal();
  await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  await b.rpc(pc, "agente_limite", { p_conta: a, p_sessao: null });
  await b.rpc(pc, "agente_limite", { p_conta: a, p_sessao: null });
  assert.equal(await b.atribuida(pc), a);
  const [{ n }] = await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_segura'");
  assert.equal(n, 1);
});

test("a troca à mão não tira a conta da sessão, pelo painel nem pela API", async () => {
  const { b, admin, pc, a } = await sessaoNaPrincipal();
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.sql("insert into public.cofre (conta_id, cifrado, nonce, versao) values ($1, decode(repeat('00', 17), 'hex'), decode(repeat('00', 12), 'hex'), 1) on conflict do nothing", [c]);
  const r = await b.rpc(admin, "painel_trocar_agora", { p_computador: pc.pc, p_conta: c });
  assert.equal(r.ok, false);
  assert.match(r.erro, /sessão de empresa ou projeto/);
  const j = await b.rpc("servico", "api_trocar", { p_user: admin.id, p_computador: pc.pc, p_conta: c });
  assert.equal(j.ok, false);
  assert.match(j.erro, /sessão de empresa ou projeto/);
  assert.equal(await b.atribuida(pc), a);
});

test("a sessão fechou: a trava vence e a conta vai para a empresa", async () => {
  const { b, pc, a, x } = await sessaoNaPrincipal();
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  await b.sql("update public.atribuicao set segura_ate = now() - interval '1 second' where computador_id = $1", [pc.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), c);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
});

test("conta pausada fica enquanto a sessão estiver nela, com alerta, e sai quando ela fechar", async () => {
  const { b, pc, a } = await sessaoNaPrincipal();
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  await b.sql("update public.contas set pausada = true where id = $1", [a]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), a, "a sessão não vai junto para uma conta que não é dela");
  const [{ n }] = await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_segura'");
  assert.equal(n, 1);
  await b.sql("update public.atribuicao set segura_ate = now() - interval '1 second' where computador_id = $1", [pc.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), c);
});

test("a conta preferida não entra por cima da sessão, mas fica guardada", async () => {
  const { b, admin, pc, a } = await sessaoNaPrincipal();
  const c = await b.conta(pc, "c@exemplo.com", 5);
  await b.sql("insert into public.cofre (conta_id, cifrado, nonce, versao) values ($1, decode(repeat('00', 17), 'hex'), decode(repeat('00', 12), 'hex'), 1) on conflict do nothing", [c]);
  const r = await b.rpc(admin, "painel_computador_preferida", { p_computador: pc.pc, p_conta: c });
  assert.equal(r.ok, true, r.erro);
  assert.equal(await b.atribuida(pc), a);
  const [q] = await b.sql("select conta_preferida from public.computadores where id = $1", [pc.pc]);
  assert.equal(q.conta_preferida, c);
});

test("a conta com sessão não é removida, nem à mão nem pela saída agendada", async () => {
  const { b, admin, pc, a } = await sessaoNaPrincipal();
  await b.conta(pc, "c@exemplo.com", 5);
  await b.rpc(pc, "agente_ola", { p_versao: "0.20.0" });
  const r = await b.rpc(admin, "painel_remover_conta", { p_conta: a });
  assert.equal(r.ok, false);
  assert.match(r.erro, /feche essa sessão/);
  await b.sql("update public.contas set sai_em = now() - interval '1 minute' where id = $1", [a]);
  await b.sql("select public.rvz_purgar_contas_saindo()");
  assert.equal((await b.sql("select count(*)::int n from public.contas where id = $1", [a]))[0].n, 1);
  assert.equal(await b.atribuida(pc), a);
});

test("ligar com computador atrasado é recusado e diz qual; desligada salva; computador parado há dias não conta", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const velho = await b.computador("air");
  await b.rpc(velho, "agente_ola", { p_versao: "0.19.0" });
  const r = await salvar(b, admin, null, { nome: "Alfa", modo: "ligado", contas: [a] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /atualize o computador air/);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 0);
  const x = await criar(b, admin, { nome: "Alfa", modo: "desligado", contas: [a] });
  await b.sql("update public.computadores set visto_em = now() - interval '25 hours' where id = $1", [velho.pc]);
  const ligou = await salvar(b, admin, x, { modo: "ligado" });
  assert.equal(ligou.ok, true, ligou.erro);
});

test("projeto sem conta própria: a empresa dele também passa a rodar só nas contas dela", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const antiga = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Antiga", separar: true } });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: a, p_lista: [antiga.id] });
  await criar(b, admin, { nome: "Site", pai: antiga.id, contas: [], pastas: [pasta("~/Code/antiga/site")] });
  const [e] = await b.sql("select so_contas_dela from public.empresas where id = $1", [antiga.id]);
  assert.equal(e.so_contas_dela, true);
});

test("a conta saiu da lista e não há outra: a sessão aberta segue nela até fechar", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  await b.sql("update public.contas set pausada = true where id = $1", [c]);
  const r = await salvar(b, admin, x, { contas: [c] });
  assert.equal(r.ok, true, r.erro);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
});

test("listas em parte iguais: a empresa de duas contas deixa livre a única conta da outra", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 30);
  const u = await b.conta(pc, "u@exemplo.com", 5);
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [u] });
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a, u] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a, "mesmo mais usada, porque a outra só tem aquela");
  await pedir(b, pc, [y]);
  assert.equal(await trilha(b, pc, y), u);
});

test("só segura conta de unidade ligada e estrita: conta de outra, ou empresa desligada, não trava nada", async () => {
  const { b, admin, pc, a, x } = await sessaoNaPrincipal();
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c] });
  assert.deepEqual(await b.rpc(pc, "agente_segurar_principal", { p_empresas: `{${y}}` }), { ok: true, segura: false, unidades: [], conta: a });
  assert.equal((await b.sql("select public.rvz_principal_segura($1) as s", [pc.pc]))[0].s, false);
  await b.rpc(pc, "agente_segurar_principal", { p_empresas: `{${x}}` });
  assert.equal((await b.sql("select public.rvz_principal_segura($1) as s", [pc.pc]))[0].s, true);
  const r = await salvar(b, admin, x, { modo: "desligado" });
  assert.equal(r.ok, true, r.erro);
  assert.equal((await b.sql("select public.rvz_principal_segura($1) as s", [pc.pc]))[0].s, false);
  assert.equal(await b.atribuida(pc), a);
});

test("a mesma pasta em dois computadores pode ser de empresas diferentes", async () => {
  const { b, admin, pc } = await cenario();
  const outro = await b.computador("air");
  await b.rpc(outro, "agente_ola", { p_versao: "0.20.0" });
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/site", pc.pc)] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [c], pastas: [pasta("~/Code/site", outro.pc)] });
  assert.deepEqual((await b.rpc(pc, "agente_empresas")).regras.map((l) => l.empresa), [x]);
  assert.deepEqual((await b.rpc(outro, "agente_empresas")).regras.map((l) => l.empresa), [y]);
  assert.equal(await classificar(b, pc, "~/Code/site"), x);
  assert.equal(await classificar(b, outro, "~/Code/site"), y);
});

test("a pasta de outra empresa é recusada, no mesmo computador ou quando um dos lados vale para todos", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/site", pc.pc)] });
  for (const p of [pasta("~/Code/site", pc.pc), pasta("~/Code/site/"), pasta("~/Code/site")]) {
    const r = await salvar(b, admin, null, { nome: "Beta", contas: [a], pastas: [p] });
    assert.equal(r.ok, false);
    assert.match(r.erro, /já é de Alfa/);
  }
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 1);
  assert.equal((await b.sql("select empresa_id from public.pastas_empresa"))[0].empresa_id, x);
});

test("pasta larga demais, campo estranho e computador desconhecido são recusados", async () => {
  const { b, admin } = await cenario();
  for (const padrao of ["~", "/", "C:", "  "]) {
    await assert.rejects(salvar(b, admin, null, { nome: "Alfa", pastas: [pasta(padrao)] }), /padrão inválido/);
  }
  await assert.rejects(salvar(b, admin, null, { nome: "Alfa", so_contas_dela: false }), /campo não permitido/);
  await assert.rejects(salvar(b, admin, null, { nome: "Alfa", pastas: [pasta("~/x", "00000000-0000-0000-0000-000000000001")] }), /computador desconhecido/);
});

test("a pasta que já existia num computador removido não impede de salvar; pasta nova nele é recusada", async () => {
  const { b, admin } = await cenario();
  const outro = await b.computador("air");
  const x = await criar(b, admin, { nome: "Alfa", pastas: [pasta("~/Code/alfa", outro.pc)] });
  await b.sql("update public.computadores set revogado = true where id = $1", [outro.pc]);
  const r = await salvar(b, admin, x, { nome: "Alfa 2", pastas: [pasta("~/Code/alfa", outro.pc)] });
  assert.equal(r.ok, true, r.erro);
  await assert.rejects(salvar(b, admin, x, { pastas: [pasta("~/Code/novo", outro.pc)] }), /computador desconhecido/);
});

test("projeto sem conta usa a da empresa; projeto com conta usa só a dele", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a], pastas: [pasta("~/Code/alfa")] });
  const p = await criar(b, admin, { nome: "Site", pai: x, contas: [c], pastas: [pasta("~/Code/alfa/site")] });
  await criar(b, admin, { nome: "Blog", pai: x, contas: [], pastas: [pasta("~/Code/alfa/blog")] });
  await pedir(b, pc, [x, p]);
  assert.equal(await trilha(b, pc, x), a);
  assert.equal(await trilha(b, pc, p), c);
  const regras = (await b.rpc(pc, "agente_empresas")).regras;
  assert.equal(regras.find((l) => l.padrao === "~/Code/alfa/blog").empresa, x);
  assert.equal(regras.find((l) => l.padrao === "~/Code/alfa/site").empresa, p);
});

test("quem não salvou pela tela nova segue como antes", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const r = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Antiga", separar: true } });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: a, p_lista: [r.id] });
  const [e] = await b.sql("select so_contas_dela from public.empresas where id = $1", [r.id]);
  assert.equal(e.so_contas_dela, false);
  assert.equal((await b.rpc(pc, "agente_empresas")).empresas[0].estrita, false);
});

test("só quem administra pode salvar", async () => {
  const { b, pc } = await cenario();
  await assert.rejects(b.rpc(pc, "painel_unidade", { p_id: null, p_campos: { nome: "Alfa" } }));
  await assert.rejects(b.rpc(pc, "painel_unidades", { p_passos: [{ ref: "n", id: null, campos: { nome: "Alfa" } }] }));
});

test("salvar em lote: o projeto novo acha a empresa nova, e uma recusa desfaz tudo", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const r = await b.rpc(admin, "painel_unidades", { p_passos: [
    { ref: "novo-1", id: null, campos: { nome: "Alfa", modo: "ligado", contas: [a] } },
    { ref: "novo-2", id: null, campos: { nome: "Site", pai: "novo-1", contas: [] } },
  ] });
  assert.equal(r.ok, true, r.erro);
  const [p] = await b.sql("select pai from public.empresas where id = $1", [r.ids["novo-2"]]);
  assert.equal(p.pai, r.ids["novo-1"]);
  const recusa = await b.rpc(admin, "painel_unidades", { p_passos: [
    { ref: "novo-3", id: null, campos: { nome: "Beta", modo: "ligado", contas: [a] } },
    { ref: "novo-4", id: null, campos: { nome: "Sem conta", modo: "ligado", contas: [] } },
  ] });
  assert.equal(recusa.ok, false);
  assert.match(recusa.erro, /escolha uma conta/);
  assert.equal((await b.sql("select count(*)::int n from public.empresas"))[0].n, 2, "o primeiro passo foi desfeito");
});

test("a conta saiu da lista mas ainda é de outra unidade ligada: a trilha fica nela até soltar", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  assert.equal((await salvar(b, admin, x, { contas: [c] })).ok, true);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
});

test("trilha dividida: a conta tirada de uma unidade não recebe a sessão dela numa troca", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const w = await b.conta(pc, "w@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a, w] });
  const y = await criar(b, admin, { nome: "Beta", modo: "ligado", contas: [a, w] });
  await pedir(b, pc, [x]);
  const atual = await trilha(b, pc, x);
  assert.equal((await salvar(b, admin, y, { contas: [atual] })).ok, true);
  await pct(b, atual, 100);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), atual, "a outra conta não serve à sessão de Beta aberta neste login");
});

test("outra empresa que só tem a mesma conta, sem dividir a trilha, não impede a troca", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const z = await b.conta(pc, "z@exemplo.com", 5);
  const y = await b.conta(pc, "y@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  await criar(b, admin, { nome: "Delta", modo: "ligado", contas: [a, z] });
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), a);
  assert.equal((await salvar(b, admin, x, { contas: [y] })).ok, true);
  await pedir(b, pc, [x]);
  assert.equal(await trilha(b, pc, x), y);
});

test("ligar a empresa liga junto o projeto dela que tem conta própria", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const empresa = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Antiga" } });
  const projeto = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Site", pai: empresa.id } });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: a, p_lista: [empresa.id] });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: c, p_lista: [projeto.id] });
  const marcado = async () => (await b.sql("select so_contas_dela s from public.empresas where id = $1", [projeto.id]))[0].s;
  assert.equal(await marcado(), false);
  assert.equal((await salvar(b, admin, empresa.id, { modo: "ligado" })).ok, true);
  assert.equal(await marcado(), true);
});

test("projeto em teste dentro de empresa ligada também espera o computador atualizar", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const c = await b.conta(pc, "c@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  const p = await criar(b, admin, { nome: "Site", pai: x, modo: "sombra", contas: [] });
  const antigo = await b.computador("air");
  await b.rpc(antigo, "agente_ola", { p_versao: "0.19.0" });
  const r = await salvar(b, admin, p, { contas: [c] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /atualize o computador air/);
});

test("projeto em teste não marca a empresa; projeto ligado sem conta marca", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const antiga = await b.rpc(admin, "painel_empresa", { p_id: null, p_campos: { nome: "Antiga", separar: true } });
  await b.rpc(admin, "painel_conta_empresas", { p_conta: a, p_lista: [antiga.id] });
  const marcada = async () => (await b.sql("select so_contas_dela s from public.empresas where id = $1", [antiga.id]))[0].s;
  await criar(b, admin, { nome: "Teste", pai: antiga.id, modo: "sombra", contas: [] });
  assert.equal(await marcada(), false);
  await criar(b, admin, { nome: "Site", pai: antiga.id, modo: "ligado", contas: [] });
  assert.equal(await marcada(), true);
});

test("desligar e tirar a conta no mesmo salvamento é aceito", async () => {
  const { b, admin, pc } = await cenario();
  const a = await b.conta(pc, "a@exemplo.com", 5);
  const x = await criar(b, admin, { nome: "Alfa", modo: "ligado", contas: [a] });
  const r = await salvar(b, admin, x, { modo: "desligado", contas: [] });
  assert.equal(r.ok, true, r.erro);
  assert.equal((await b.sql("select count(*)::int n from public.conta_empresas where empresa_id = $1", [x]))[0].n, 0);
});
