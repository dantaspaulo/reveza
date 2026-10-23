// 0029: o nome de cada computador, dado no painel (pedido de um usuário, 22/10/2026), e o registro do agente que não
// o sobrescreve mais com o nome do sistema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0029_nome_do_computador.sql", import.meta.url), "utf8");

async function preparar() {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const pc = await b.computador("BOOK-124183127");
  return { b, admin, pc };
}
const renomear = (b, quem, pc, nome) => b.rpc(quem, "painel_computador_nome", { p_computador: pc, p_nome: nome });
const linha = async (b, pc) => (await b.sql("select nome, nome_do_painel from public.computadores where id = $1", [pc]))[0];
const registrar = (b, pc, nome) => b.rpc(pc, "agente_registrar", { p_nome: nome, p_sistema: "macos", p_versao: "0.10.0" });

test("0029 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const b = await banco();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("o nome dado no painel fica, mesmo quando o agente se registra de novo com o nome do sistema", async () => {
  const { b, admin, pc } = await preparar();
  assert.deepEqual(await linha(b, pc.pc), { nome: "BOOK-124183127", nome_do_painel: false });
  assert.equal((await renomear(b, admin, pc.pc, "  Notebook   da Ana ")).nome, "Notebook da Ana");
  assert.deepEqual(await linha(b, pc.pc), { nome: "Notebook da Ana", nome_do_painel: true });
  await registrar(b, pc, "BOOK-124183127");
  assert.equal((await linha(b, pc.pc)).nome, "Notebook da Ana");
  const [aud] = await b.sql("select acao, detalhes from public.auditoria where acao = 'computador_nome'");
  assert.equal(aud.detalhes.nome, "Notebook da Ana");
});

test("nome vazio volta ao nome do sistema no próximo registro do agente", async () => {
  const { b, admin, pc } = await preparar();
  await renomear(b, admin, pc.pc, "Servidor do escritório");
  const r = await renomear(b, admin, pc.pc, "   ");
  assert.equal(r.nome_do_sistema, true);
  assert.equal((await linha(b, pc.pc)).nome_do_painel, false);
  await registrar(b, pc, "srv-01");
  assert.equal((await linha(b, pc.pc)).nome, "srv-01");
});

test("dois computadores ativos não ficam com o mesmo nome (maiúscula e minúscula contam igual); revogado não conta", async () => {
  const { b, admin, pc } = await preparar();
  const outro = await b.computador("outro");
  await renomear(b, admin, pc.pc, "Mac mini");
  await assert.rejects(renomear(b, admin, outro.pc, "MAC MINI"), /já existe um computador com este nome/);
  await b.sql("update public.computadores set revogado = true where id = $1", [pc.pc]);
  assert.equal((await renomear(b, admin, outro.pc, "Mac mini")).ok, true);
  await assert.rejects(renomear(b, admin, pc.pc, "Outro nome"), /computador desconhecido ou revogado/);
});

test("nome longo ou com caractere de controle é recusado; quem só lê e o próprio computador não renomeiam", async () => {
  const { b, admin, pc } = await preparar();
  await assert.rejects(renomear(b, admin, pc.pc, "x".repeat(61)), /nome inválido/);
  await assert.rejects(renomear(b, admin, pc.pc, "a\u0001b"), /nome inválido/);
  assert.equal((await renomear(b, admin, pc.pc, "Notebook\tda Ana")).nome, "Notebook da Ana", "tab vira espaço");
  const leitor = { id: await b.usuario("leitura", "leitor@exemplo.com"), aal: "aal1" };
  await assert.rejects(renomear(b, leitor, pc.pc, "Meu"));
  await assert.rejects(renomear(b, pc, pc.pc, "Meu"));
  assert.equal((await linha(b, pc.pc)).nome, "Notebook da Ana");
});

test("o computador novo, ainda esperando o primeiro contato, já pode ter nome, e o primeiro registro não o troca", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  const id = await b.usuario("computador");
  await b.sql("insert into public.computadores (user_id, nome, sistema, versao) values ($1, 'Computador novo', 'pendente', '')", [id]);
  const [{ id: pc }] = await b.sql("select id from public.computadores where user_id = $1", [id]);
  await renomear(b, admin, pc, "Notebook do Kaio");
  await b.rpc({ id }, "agente_registrar", { p_nome: "BOOK-124183127", p_sistema: "windows", p_versao: "0.10.0" });
  assert.deepEqual(await linha(b, pc), { nome: "Notebook do Kaio", nome_do_painel: true });
});
