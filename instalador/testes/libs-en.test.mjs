// As mesmas peças, em inglês: as mensagens que o instalador mostra e os erros que ele lança saem traduzidas.
// Roda num processo só seu (o idioma é estado do módulo), então usarIdioma("en") aqui não vaza para os outros testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { t as T, usarIdioma } from "../lib/texto.mjs";
import { dominioPedido } from "../lib/dominio.mjs";
import { conferirToken, criarProjeto } from "../lib/supabase.mjs";
import { texto, uuid } from "../lib/sql.mjs";
import { testar } from "../lib/alertas.mjs";
import { gravarInstalacao } from "../lib/programa.mjs";
import { Vercel } from "../lib/vercel.mjs";
import { Gerencia, provisionar, trocarSite } from "../../nuvem/provisionar.mjs";

usarIdioma("en");

test("os erros das libs do instalador saem em inglês", async () => {
  assert.throws(() => dominioPedido("sem ponto", {}), /invalid domain: sem ponto \(use a subdomain, like accounts\.mydomain\.com, or vercel\)/);

  const g = { pedir: async () => ({}) };
  await assert.rejects(criarProjeto(g, { org: "x y", regiao: "sa-east-1" }), /invalid organization/);
  await assert.rejects(criarProjeto(g, { org: "x", regiao: "marte-1" }), /unknown region/);
  const g403 = { pedir: async () => { const e = new Error("x"); e.status = 403; throw e; } };
  assert.match((await conferirToken(g403)).erro, /use a personal token/);

  assert.throws(() => uuid("não é uuid"), /invalid identifier/);
  assert.throws(() => texto("a\0b"), /null character/);

  assert.equal((await testar("ntfy", {}, "x", { fetch: async () => new Response("{}") })).erro, "unknown channel");
  assert.equal((await testar("webhook", { url: "http://x" }, "s")).erro, "the webhook address must be https");

  assert.throws(() => new Vercel(""), /the Vercel token is missing/);

  const d = mkdtempSync(path.join(os.tmpdir(), "reveza-en-"));
  try {
    assert.throws(() => gravarInstalacao(path.join(d, "x.json"), { nuvem: { token: "x" } }), /does not store secrets/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("a nuvem (provisionar) recebe o t do instalador: progresso e erros em inglês", async () => {
  const semProjeto = new Gerencia("t", { fetch: async () => new Response(JSON.stringify({ status: "COMING_UP" }), { status: 200 }), esperar: async () => {} });
  await assert.rejects(semProjeto.esperarAtivo("ref1", 1, T), /the project was not ready after 10 minutes/);
  await assert.rejects(trocarSite(new Gerencia("t", { fetch: async () => new Response("{}") }), "ref1", "http://x", T), /invalid panel address/);

  const log = [];
  const gerencia = {
    esperarAtivo: async () => ({ region: "sa-east-1" }),
    sql: async () => [],
    configAuth: async () => ({}),
    chaves: async () => ({ anon: "a", servico: "s" }),
    pedir: async () => [],
    segredos: async () => ({}),
    publicarFuncao: async () => ({}),
  };
  await provisionar({ gerencia, ref: "a".repeat(20), site: "https://p.exemplo.com", admin: null, computador: false, log: (m) => log.push(m), t: T });
  assert.ok(log.includes("Waiting for the project to be ready"), log.join(" | "));
  assert.ok(log.includes("Creating the database (tables, row-level security, functions)"), log.join(" | "));
  assert.ok(log.includes("Setting up login (strong password, two-step verification, no open sign-up)"), log.join(" | "));
  assert.ok(log.includes("Publishing the cloud functions"), log.join(" | "));
  assert.ok(log.some((l) => /^Database: 0\d{3}/.test(l)), log.join(" | "));
});

// E o padrão continua o português: sem idioma escolhido (é o caso das suítes de hoje), as mensagens não mudam.
test("sem idioma escolhido, as mesmas mensagens seguem em português", async () => {
  usarIdioma("pt");
  try {
    assert.throws(() => dominioPedido("sem ponto", {}), /domínio inválido: sem ponto/);
    assert.throws(() => uuid("x"), /identificador inválido/);
    assert.equal((await testar("ntfy", {}, "x", { fetch: async () => new Response("{}") })).erro, "canal desconhecido");
    const log = [];
    const gerencia = {
      esperarAtivo: async () => ({ region: "sa-east-1" }),
      sql: async () => [],
      configAuth: async () => ({}),
      chaves: async () => ({ anon: "a", servico: "s" }),
      pedir: async () => [],
      segredos: async () => ({}),
      publicarFuncao: async () => ({}),
    };
    await provisionar({ gerencia, ref: "a".repeat(20), site: "https://p.exemplo.com", admin: null, computador: false, log: (m) => log.push(m) });
    assert.ok(log.includes("Esperando o projeto ficar pronto"), log.join(" | "));
    assert.ok(log.includes("Criando o banco (tabelas, segurança de linha, funções)"), log.join(" | "));
  } finally {
    usarIdioma("pt");
  }
});
