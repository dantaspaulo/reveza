// Migração lançada não muda. O plano da atualização da nuvem (e do instalador) roda de novo, depois da primeira
// migração que entra ou muda, todas as reaplicáveis seguintes, cada uma na sua transação: editar uma antiga faz a nuvem
// em uso reinstalar dezenas de corpos antigos de função, um por um, com o decidir rodando no meio, e uma falha no meio
// deixa a nuvem parada neles. A mudança vai sempre numa migração nova, no fim (chave nova da configuração: a lista
// completa só na migração nova). A 0099 (permissões) fica de fora: ela roda de novo em toda atualização, de propósito.
// O registro `migracoes-lancadas.json` guarda o resumo de cada migração já lançada; ao começar a versão seguinte,
// acrescente a ele as migrações da versão que saiu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { migracoes } from "../provisionar.mjs";

const lancadas = JSON.parse(readFileSync(new URL("./migracoes-lancadas.json", import.meta.url), "utf8")).migracoes;
const resumo = (sql) => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

test("migração já lançada não muda: a mudança vai numa migração nova", () => {
  const agora = new Map(migracoes().map((m) => [m.nome, m.sql]));
  for (const [nome, hash] of Object.entries(lancadas)) {
    assert.ok(agora.has(nome), `${nome} foi lançada e sumiu: migração lançada não sai nem muda de nome`);
    assert.equal(resumo(agora.get(nome)), hash,
      `${nome} foi lançada e mudou: a atualização da nuvem rodaria de novo todas as reaplicáveis depois dela; ponha a mudança numa migração nova`);
  }
});

test("migração nova vem depois de todas as lançadas (a 0099 fica por último)", () => {
  const ultima = Object.keys(lancadas).sort().at(-1);
  for (const m of migracoes()) {
    if (lancadas[m.nome] || m.nome.startsWith("0099")) continue;
    assert.ok(m.nome > ultima, `${m.nome} é nova e vem antes da ${ultima}, já lançada: a atualização rodaria de novo as seguintes`);
  }
});
