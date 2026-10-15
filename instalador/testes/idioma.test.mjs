// O idioma da instalação: escolhido no primeiro passo (ou por --idioma), gravado no instalacao.json e passado ao agente.
// Sem escolha, tudo segue em português, inclusive com o LANG em inglês das máquinas de CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { idiomaDoArgv, idiomaDoTerminal, idiomaGravado, t, usarIdioma } from "../lib/texto.mjs";
import { prepararCasa, SEM_SH } from "./apoio-instalador.mjs";

test("idioma: en, en-US e pt-BR; o resto fica no português", () => {
  try {
    for (const [pedido, gravado] of [["en", "en"], ["en-US", "en"], ["EN", "en"], ["pt", "pt-BR"], ["pt-BR", "pt-BR"], ["es", "pt-BR"], [undefined, "pt-BR"], ["english", "pt-BR"]]) {
      usarIdioma(pedido);
      assert.equal(idiomaGravado(), gravado, String(pedido));
    }
    usarIdioma("en");
    assert.equal(t("oi", "hi"), "hi");
  } finally {
    usarIdioma("pt");
  }
  assert.equal(t("oi", "hi"), "oi");
});

test("--idioma é lido antes das opções (os erros delas já saem no idioma)", () => {
  assert.equal(idiomaDoArgv(["--sim", "--idioma", "en"]), "en");
  assert.equal(idiomaDoArgv(["--idioma", "--sim"]), undefined, "sem valor");
  assert.equal(idiomaDoArgv(["--sim"]), undefined);
});

test("o LANG do terminal só sugere a resposta da pergunta", () => {
  assert.equal(idiomaDoTerminal({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(idiomaDoTerminal({ LANG: "pt_BR.UTF-8" }), "pt");
  assert.equal(idiomaDoTerminal({ LANG: "en_US.UTF-8", LC_ALL: "pt_BR.UTF-8" }), "pt", "LC_ALL vence");
  assert.equal(idiomaDoTerminal({ LANG: "C.UTF-8" }), "pt");
  assert.equal(idiomaDoTerminal({}), "pt");
});

test("sem terminal e sem --idioma: português, mesmo com o LANG em inglês; o idioma vai para o instalacao.json", { skip: SEM_SH }, () => {
  const c = prepararCasa();
  try {
    Object.assign(c.env, { LANG: "en_US.UTF-8" });
    const r = c.rodar(["--sim", "--sem-nuvem", "--sem-servico", "--sem-react-bits"]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.match(r.saida, /Pronto: Reveza AI/);
    assert.equal(c.json("instalacao.json").idioma, "pt-BR");
  } finally {
    c.limpar();
  }
});

test("--idioma en: instalação em inglês, gravada para o agente e o mod; a atualização segue o que foi escolhido", { skip: SEM_SH }, () => {
  const c = prepararCasa();
  try {
    const r = c.rodar(["--sim", "--sem-nuvem", "--sem-servico", "--sem-react-bits", "--idioma", "en"]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.match(r.saida, /Done: Reveza AI/);
    assert.match(r.saida, /^1\/5 Checking this computer$/m);
    assert.equal(c.json("instalacao.json").idioma, "en");
    const a = c.rodar(["--sim", "--atualizar", "--sem-servico", "--sem-react-bits"]);
    assert.equal(a.status, 0, a.saida.slice(-1500));
    assert.match(a.saida, /Done: Reveza AI/, "sem --idioma, a atualização fica no inglês da instalação");
    assert.equal(c.json("instalacao.json").idioma, "en");
  } finally {
    c.limpar();
  }
});
