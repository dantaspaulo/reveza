import { test } from "node:test";
import assert from "node:assert/strict";
import { conferir, maior, paraAtualizar, partesDaVersao, precisaVersao, primeiraDoChangelog, secaoDoChangelog, soArquivosDaVersao, versoes, workflowsVermelhos } from "./versao.mjs";

const CHANGELOG = `# Versões

texto

## 0.2.0 · 12/10/2026

Recurso novo.

- item

## 0.1.1 · 11/10/2026

Correção.
`;

test("todas as versões do repositório batem (package.json, travas, agente, badges; CHANGELOG igual ou à frente)", () => {
  assert.doesNotThrow(() => conferir(versoes()));
});

test("o manifesto do mod entra na conferência e no commit de versão", () => {
  const v = versoes();
  assert.equal(v["mod/.claude-plugin/plugin.json"], v["package.json"]);
  assert.equal(soArquivosDaVersao(["mod/.claude-plugin/plugin.json", "package.json"]), true);
});

test("conferir recusa pacote fora da versão e aceita a CHANGELOG uma versão à frente", () => {
  const base = { "package.json": "0.1.1", "agente/src/config.ts": "0.1.1", "README.md (badge)": "0.1.1" };
  assert.equal(conferir({ ...base, "CHANGELOG.md": "0.1.1" }), "0.1.1");
  assert.equal(conferir({ ...base, "CHANGELOG.md": "0.1.2" }), "0.1.1");
  assert.throws(() => conferir({ ...base, "agente/src/config.ts": "0.1.0", "CHANGELOG.md": "0.1.1" }));
  assert.throws(() => conferir({ ...base, "CHANGELOG.md": "0.1.0" }), "CHANGELOG atrás");
});

test("CHANGELOG: a primeira entrada e o texto de uma versão", () => {
  assert.equal(primeiraDoChangelog(CHANGELOG), "0.2.0");
  assert.equal(secaoDoChangelog(CHANGELOG, "0.2.0"), "Recurso novo.\n\n- item");
  assert.equal(secaoDoChangelog(CHANGELOG, "0.1.1"), "Correção.");
  assert.equal(secaoDoChangelog(CHANGELOG, "9.9.9"), null);
});

test("versão nova só quando o que se instala mudou e a versão ficou a mesma", () => {
  assert.equal(precisaVersao(["agente/src/troca.ts"], "0.1.1", "0.1.1"), true);
  assert.equal(precisaVersao(["instalador/instalar.mjs", "README.md"], "0.1.1", "0.1.1"), true);
  assert.equal(precisaVersao(["agente/src/troca.ts"], "0.1.2", "0.1.1"), false, "já subiu");
  assert.equal(precisaVersao(["README.md", "docs/ARQUITETURA.md", "CHANGELOG.md"], "0.1.1", "0.1.1"), false, "só documentação");
  assert.equal(precisaVersao(["package.json"], "0.1.1", "0.1.1"), true);
});

test("comparação de versões", () => {
  assert.equal(maior("0.1.2", "0.1.1"), true);
  assert.equal(maior("0.2.0", "0.1.9"), true);
  assert.equal(maior("0.1.1", "0.1.1"), false);
  assert.equal(maior("0.1.0", "0.1.1"), false);
});

test("lançar recusa quando o run mais recente de algum workflow na main está vermelho", () => {
  const runs = [
    { workflowName: "Instalar nos três sistemas", conclusion: "success", status: "completed" },
    { workflowName: "Windows de verdade", conclusion: "failure", status: "completed" },
    { workflowName: "Instalar nos três sistemas", conclusion: "failure", status: "completed" },
  ];
  assert.deepEqual(workflowsVermelhos(runs), ["Windows de verdade"], "o vermelho antigo de um workflow que já ficou verde não conta");
  assert.deepEqual(workflowsVermelhos([{ workflowName: "Windows de verdade", conclusion: "", status: "in_progress" }, ...runs]), [], "rodando agora: espera o resultado");
  assert.deepEqual(workflowsVermelhos([]), []);
});

test("o ensaio da árvore de antes só vale para o commit de versão (só os arquivos da versão)", () => {
  assert.equal(soArquivosDaVersao(["package.json", "agente/package.json", "agente/src/config.ts", "README.md", "package-lock.json"]), true);
  assert.equal(soArquivosDaVersao(["package.json", "scripts/ensaio.mjs"]), false, "commit a mais depois do ensaio");
  assert.equal(soArquivosDaVersao(["agente/src/agente.ts"]), false);
  assert.equal(soArquivosDaVersao([]), false);
});

test("as partes de uma versão: migração é nuvem, funções e painel pelo resumo da nuvem, agente/mod/instalador são os computadores", () => {
  assert.deepEqual(partesDaVersao(["nuvem/migracoes/0029_x.sql", "nuvem/testes/x.test.mjs"]), { nuvem: true, funcoes: false, painel: false, computadores: false });
  assert.deepEqual(partesDaVersao(["painel/src/lib/atualizar.test.ts", "agente/test/troca.test.ts"]), { nuvem: false, funcoes: false, painel: false, computadores: false });
  assert.deepEqual(partesDaVersao(["instalador/lib/painel.mjs"]), { nuvem: false, funcoes: false, painel: true, computadores: true });
  assert.deepEqual(partesDaVersao(["nuvem/provisionar.mjs", "mod/hooks/register.ts"]), { nuvem: false, funcoes: true, painel: false, computadores: true });
  assert.deepEqual(partesDaVersao(["README.md", "docs/ARQUITETURA.md"]), { nuvem: false, funcoes: false, painel: false, computadores: false });
});

test("o Para atualizar nunca diz que o painel vai junto com a nuvem sem a atualização completa", () => {
  const tudo = paraAtualizar({ nuvem: true, funcoes: true, painel: true, computadores: true });
  assert.match(tudo, /Nuvem:\* se atualiza sozinha/);
  assert.match(tudo, /Funções e painel:\* vão ao ar sozinhos só com a atualização completa ligada/);
  assert.match(tudo, /no computador que criou a instalação/);
  // a ordem: nuvem, funções e painel, computadores
  assert.ok(tudo.indexOf("Nuvem:") < tudo.indexOf("Funções e painel:") && tudo.indexOf("Funções e painel:") < tudo.indexOf("Computadores:"));
  // só o painel mudou: a nuvem ainda entra, porque a publicação só sai na versão em que ela está
  const soPainel = paraAtualizar({ nuvem: false, funcoes: false, painel: true, computadores: false });
  assert.match(soPainel, /Painel:\* vai ao ar sozinho/);
  assert.ok(soPainel.indexOf("Nuvem:") > -1 && soPainel.indexOf("Nuvem:") < soPainel.indexOf("Painel:"));
  assert.doesNotMatch(paraAtualizar({ nuvem: false, funcoes: false, painel: false, computadores: true }), /Painel|Nuvem/);
  assert.match(paraAtualizar({ nuvem: false, funcoes: false, painel: false, computadores: false }), /nada a fazer/);
});
