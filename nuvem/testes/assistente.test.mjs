// 0027: a escolha da instalação para o assistente de código (o jeito dele, sempre a mais nova ou só pelo painel) e o
// pedido do painel para um computador atualizar o assistente. No banco de verdade (PGlite com as migrações).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0027_assistente_atualizar.sql", import.meta.url), "utf8");

async function preparar() {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const pc = await b.computador("pc1");
  return { b, admin, pc };
}
const escolher = (b, quem, valor) => b.rpc(quem, "painel_config", { p_chave: "assistente_atualizar", p_valor: valor });

test("0027 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const b = await banco();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("o painel grava padrao, sozinho e manual, e o computador recebe a escolha no agente_ola", async () => {
  const { b, admin, pc } = await preparar();
  assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "1.0.0" })).config.assistente_atualizar, undefined, "sem a linha: o padrão");
  for (const v of ["sozinho", "manual", "padrao"]) {
    assert.equal((await escolher(b, admin, v)).ok, true);
    assert.equal((await b.rpc(pc, "agente_ola", { p_versao: "1.0.0" })).config.assistente_atualizar, v);
  }
});

test("valor estranho é recusado; quem só lê não escolhe; as outras chaves seguem como antes", async () => {
  const { b, admin } = await preparar();
  for (const estranho of ["sempre", true, 3, null]) {
    await assert.rejects(escolher(b, admin, estranho), /assistente: padrao, sozinho ou manual/, String(estranho));
  }
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal1" };
  await assert.rejects(escolher(b, leitor, "manual"));
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "atualizar_sozinho", p_valor: "madrugada" })).ok, true);
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "idioma", p_valor: "en" }), /configuração desconhecida/);
  await assert.rejects(b.config("inventada", "x"), /config_chave_check/);
  // as chaves de antes seguem aceitas (a lista da restrição é a completa)
  for (const chave of ["auto", "idioma", "publicacao_vez", "atualizacao_completa"]) await b.config(chave, chave === "auto");
});

test("o pedido do painel para atualizar o assistente usa a ação atualizar, que já existe: chega ao computador como veio", async () => {
  const { b, admin, pc } = await preparar();
  const r = await b.rpc(admin, "painel_comando", { p_computador: pc.pc, p_acao: "atualizar", p_corpo: { assistente: true } });
  assert.equal(r.ok, true);
  const [cmd] = (await b.rpc(pc, "agente_ola", { p_versao: "1.0.0" })).comandos;
  assert.equal(cmd.id, r.id);
  assert.equal(cmd.acao, "atualizar");
  assert.deepEqual(cmd.corpo, { assistente: true });
});
