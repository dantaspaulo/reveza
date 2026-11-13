// A mesma pessoa em dois planos do Claude: o e-mail é igual, a organização não. Cada uma é uma conta do Reveza, com
// o seu cofre; uma não pode substituir a outra (0035).
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const B64 = (n, v) => Buffer.alloc(n, v).toString("base64");
const CONTA = {
  email: "pessoa@exemplo.com",
  team: { p_organizacao: "Empresa Exemplo - Team", p_organizacao_id: "00000000-0000-4000-8000-0000000000a1", p_plano: "team", p_nivel: "5x" },
  pro: { p_organizacao: "Conta individual", p_organizacao_id: "00000000-0000-4000-8000-0000000000b2", p_plano: "max", p_nivel: "20x" },
};

async function registrar(b, pc, identidade, bytes) {
  return b.rpc(pc, "agente_registrar_conta", {
    p_email: CONTA.email, ...identidade,
    p_cifrado: B64(40, bytes), p_nonce: B64(12, bytes), p_account_uuid: "00000000-0000-4000-8000-0000000000c3",
  });
}

test("mesmo e-mail em duas organizações: duas contas, dois cofres, nenhuma substitui a outra", async () => {
  const b = await banco();
  const pc = await b.computador();

  const team = await registrar(b, pc, CONTA.team, 1);
  const pro = await registrar(b, pc, CONTA.pro, 9);
  assert.equal(team.ok, true);
  assert.equal(pro.ok, true);
  assert.notEqual(team.conta_id, pro.conta_id, "a conta do Team e a do Pro individual são linhas diferentes");

  const contas = await b.sql("select id, organizacao, organizacao_id, plano, nivel from public.contas where email = $1 order by organizacao_id", [CONTA.email]);
  assert.equal(contas.length, 2);
  assert.deepEqual(contas.map((c) => [c.organizacao_id, c.plano]), [
    [CONTA.pro.p_organizacao_id, "max"],
    [CONTA.team.p_organizacao_id, "team"],
  ]);

  const cofres = await b.sql(
    "select conta_id, encode(cifrado, 'base64') as cifrado from public.cofre where conta_id in ($1, $2) order by conta_id",
    [team.conta_id, pro.conta_id],
  );
  assert.equal(cofres.length, 2);
  assert.deepEqual(new Set(cofres.map((c) => c.cifrado)), new Set([B64(40, 1), B64(40, 9)]), "cada conta tem o seu login");
});

test("registrar de novo a mesma organização atualiza a mesma conta, sem criar uma terceira", async () => {
  const b = await banco();
  const pc = await b.computador();
  const team = await registrar(b, pc, CONTA.team, 1);
  const pro = await registrar(b, pc, CONTA.pro, 9);

  const deNovo = await registrar(b, pc, CONTA.pro, 7);
  assert.equal(deNovo.ok, true);
  assert.equal(deNovo.conta_id, pro.conta_id);
  const [{ n }] = await b.sql("select count(*)::int as n from public.contas where email = $1", [CONTA.email]);
  assert.equal(n, 2, "as duas continuam, e a segunda gravação não criou outra");

  const [{ cifrado }] = await b.sql("select encode(cifrado, 'base64') as cifrado from public.cofre where conta_id = $1", [pro.conta_id]);
  assert.equal(cifrado, B64(40, 7), "o cofre da conta do Pro recebeu a leitura mais nova");
  const [{ cifrado: doTeam }] = await b.sql("select encode(cifrado, 'base64') as cifrado from public.cofre where conta_id = $1", [team.conta_id]);
  assert.equal(doTeam, B64(40, 1), "o cofre do Team não foi tocado");
});

test("conta de antes da 0035, sem organizacao_id, é adotada pelo registro da mesma organização textual", async () => {
  const b = await banco();
  const pc = await b.computador();
  const [{ id }] = await b.sql(
    "insert into public.contas (email, organizacao, plano, nivel) values ($1, $2, 'team', '5x') returning id",
    [CONTA.email, CONTA.team.p_organizacao],
  );

  const r = await registrar(b, pc, CONTA.team, 1);
  assert.equal(r.ok, true);
  assert.equal(r.conta_id, id, "a linha antiga vira a conta do Team, com o cofre que já estava nela");
  const [c] = await b.sql("select organizacao_id from public.contas where id = $1", [id]);
  assert.equal(c.organizacao_id, CONTA.team.p_organizacao_id);
  const [{ n }] = await b.sql("select count(*)::int as n from public.contas where email = $1", [CONTA.email]);
  assert.equal(n, 1);
});

test("agente de antes da 0035, sem a organização, não sobrescreve quando há duas contas do mesmo e-mail", async () => {
  const b = await banco();
  const pc = await b.computador();
  await registrar(b, pc, CONTA.team, 1);
  await registrar(b, pc, CONTA.pro, 9);

  const antigo = await b.rpc(pc, "agente_registrar_conta", {
    p_email: CONTA.email, p_organizacao: "Outra", p_plano: "pro", p_nivel: "1x",
    p_cifrado: B64(40, 5), p_nonce: B64(12, 5),
  });
  assert.equal(antigo.ok, false);
  assert.match(antigo.erro, /atualize o agente/);
  const [{ n }] = await b.sql("select count(*)::int as n from public.contas where email = $1", [CONTA.email]);
  assert.equal(n, 2);
});

test("a busca do computador novo escolhe a conta pela organização que ele já tem", async () => {
  const b = await banco();
  const pc = await b.computador();
  const team = await registrar(b, pc, CONTA.team, 1);
  const pro = await registrar(b, pc, CONTA.pro, 9);
  const novo = await b.computador("pc2");

  const r = await b.rpc(novo, "agente_ola", {
    p_versao: "1.0.0", p_conta_local: CONTA.email, p_organizacao_id: CONTA.pro.p_organizacao_id,
  });
  assert.equal(r.atribuicao.conta_id, pro.conta_id, "o PC que estava no Pro recebe a conta do Pro, não a do Team");
  assert.notEqual(r.atribuicao.conta_id, team.conta_id);
});
