// O idioma do que o agente mostra: o da instalação (instalacao.json), o REVEZA_IDIOMA do instalador ou o --idioma.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { idiomaAtual, idiomaDaInstalacao, normalizarIdioma, resolverIdioma, t, usarIdioma } from "../src/i18n.js";
import { executarCli, linhaConta, textoDoTerminal, textoJanela, type Ambiente } from "../src/cli.js";
import { doctor, textoDoctor } from "../src/doctor.js";
import { avisoCompleta } from "../src/completa.js";
import { resumoConserto } from "../src/conserto.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import { ApiFalsa, blob, CliFalsa, ExecutorFalso, pastaTemporaria, RelogioFalso, T0 } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria>;
afterEach(() => {
  tmp?.limpar();
  usarIdioma("pt-BR");
});

test("en e en-US viram inglês; o resto (e nada) fica no português", () => {
  for (const [pedido, idioma] of [["en", "en"], ["en-US", "en"], ["pt", "pt-BR"], ["pt-BR", "pt-BR"], ["es", "pt-BR"], [undefined, "pt-BR"], [1, "pt-BR"]] as const) {
    assert.equal(normalizarIdioma(pedido), idioma, String(pedido));
  }
  assert.equal(t("oi", "hi"), "oi");
  usarIdioma("en");
  assert.equal(idiomaAtual(), "en");
  assert.equal(t("oi", "hi"), "hi");
});

test("o idioma da instalação: o campo do instalacao.json; sem ele (versão antiga) ou sem arquivo, português", () => {
  tmp = pastaTemporaria();
  fs.mkdirSync(tmp.c.base, { recursive: true });
  const arq = path.join(tmp.c.base, "instalacao.json");
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "sem arquivo");
  fs.writeFileSync(arq, JSON.stringify({ versao: "0.4.6" }));
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "sem o campo");
  fs.writeFileSync(arq, JSON.stringify({ idioma: "en" }));
  assert.equal(idiomaDaInstalacao(tmp.c), "en");
  fs.writeFileSync(arq, "{ quebrado");
  assert.equal(idiomaDaInstalacao(tmp.c), "pt-BR", "arquivo ilegível não derruba");
});

test("--idioma vence o REVEZA_IDIOMA, que vence a instalação; o LANG não decide", () => {
  tmp = pastaTemporaria();
  fs.mkdirSync(tmp.c.base, { recursive: true });
  fs.writeFileSync(path.join(tmp.c.base, "instalacao.json"), JSON.stringify({ idioma: "en" }));
  assert.equal(resolverIdioma(undefined, {}, tmp.c), "en");
  assert.equal(resolverIdioma(undefined, { REVEZA_IDIOMA: "pt-BR" }, tmp.c), "pt-BR");
  assert.equal(resolverIdioma("pt", { REVEZA_IDIOMA: "en" }, tmp.c), "pt-BR");
  assert.equal(resolverIdioma(true, { REVEZA_IDIOMA: "en" }, tmp.c), "en", "--idioma sem valor não conta");
  fs.rmSync(path.join(tmp.c.base, "instalacao.json"));
  assert.equal(resolverIdioma(undefined, { LANG: "en_US.UTF-8" }, tmp.c), "pt-BR");
});


function ambiente(env: NodeJS.ProcessEnv = { REVEZA_PORTA: "1" }): Ambiente & { saidas: string[]; erros: string[] } {
  const saidas: string[] = [];
  const erros: string[] = [];
  const cred = new CredenciaisFalsas();
  cred.d.set("principal", blob("A1"));
  return {
    c: tmp.c,
    sistema: "macos",
    exec: new ExecutorFalso(),
    relogio: new RelogioFalso(),
    saida: (x) => saidas.push(x),
    erro: (x) => erros.push(x),
    perguntar: async () => "",
    env,
    script: "/app/cli.js",
    fabricas: { cred: () => cred, guarda: async () => new GuardaFalsa(), api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => null },
    saidas,
    erros,
  };
}

test("a ajuda em inglês (REVEZA_IDIOMA ou --idioma) traz a linha do --idioma e mantém comandos e flags em português", async () => {
  tmp = pastaTemporaria();
  const a = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  assert.equal(await executarCli([], a), 0);
  const texto = a.saidas.join("\n");
  assert.match(texto, /the Reveza AI agent on this computer/);
  assert.match(texto, /^Usage: reveza <command> \[options\]/m);
  assert.match(texto, /--idioma pt\|en/);
  for (const cmd of ["contas conectar <email>", "servico instalar|remover|status [--sombra]", "atualizacao-completa ligar|desligar|status [--stdin]", "--sem-nuvem"]) {
    assert.ok(texto.includes(cmd), cmd);
  }
  assert.ok(!/claude/i.test(texto));
  const b = ambiente();
  assert.equal(await executarCli(["--idioma", "en", "--help"], b), 0);
  assert.match(b.saidas.join("\n"), /Usage: reveza/);
  const pt = ambiente();
  assert.equal(await executarCli([], pt), 0);
  assert.match(pt.saidas.join("\n"), /^Uso: reveza <comando> \[opções\]/m);
  assert.match(pt.saidas.join("\n"), /--idioma pt\|en/);
  const desconhecido = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  assert.equal(await executarCli(["xyz"], desconhecido), 2);
  assert.match(desconhecido.erros.join("\n"), /^unknown command: xyz/);
});

test("o idioma da instalação (instalacao.json) vale para a linha de comando; --idioma pt volta ao português", async () => {
  tmp = pastaTemporaria();
  fs.mkdirSync(tmp.c.base, { recursive: true });
  fs.writeFileSync(path.join(tmp.c.base, "instalacao.json"), JSON.stringify({ idioma: "en" }));
  const a = ambiente();
  assert.equal(await executarCli(["trocar", "b@exemplo.com"], a), 1);
  assert.match(a.erros.join("\n"), /the agent is not running/);
  const b = ambiente();
  assert.equal(await executarCli(["trocar", "b@exemplo.com", "--idioma", "pt"], b), 1);
  assert.match(b.erros.join("\n"), /não está rodando/);
});

test("status em inglês: agente parado, troca automática, contas e estado traduzidos", async () => {
  tmp = pastaTemporaria();
  const a = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  assert.equal(await executarCli(["status"], a), 0);
  const texto = a.saidas.join("\n");
  assert.match(texto, /^Agent: stopped \(showing the last saved state\)/);
  assert.match(texto, /Auto switch (on|off) · mode threshold \(warning \d+%, switch \d+%\)/);
  assert.match(texto, /No account connected\. Run: reveza contas conectar <email>/);
  assert.ok(!/parado|Troca automática|Nenhuma conta/.test(texto));
  const json = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  await executarCli(["status", "--json"], json);
  assert.ok("parado" in JSON.parse(json.saidas.join("")), "as chaves do JSON seguem em português");
});

test("linha da conta e janelas em inglês: rótulos por tipo, dia da semana e renovação", () => {
  usarIdioma("en");
  const conta = { email: "a@exemplo.com", org: "Org", estado: "ativa", erro: null, janelas: [{ tipo: "five_hour" as const, pct: 42, resetEm: null }] };
  assert.equal(linhaConta(conta), "* a@exemplo.com (Org): in use. 5 hours 42%");
  assert.equal(linhaConta({ ...conta, estado: "precisa_login", janelas: [] }), "- a@exemplo.com (Org): needs to sign in again. no reading yet");
  const agora = Math.floor(new Date(2026, 9, 11, 6, 33).getTime() / 1000);
  const semana = Math.floor(new Date(2026, 9, 14, 5, 59).getTime() / 1000);
  assert.equal(textoJanela({ tipo: "seven_day", pct: 100, resetEm: semana }, agora), "Week 100% (resets Wed 05:59)");
  assert.match(textoJanela({ tipo: "five_hour", pct: 98, resetEm: agora - 180 }, agora), /^5 hours 0% \(reset \d\d:\d\d\)$/);
  assert.match(textoJanela({ tipo: "seven_day_opus", pct: 5, resetEm: agora + 3600 }, agora), /^Week, larger model 5% \(resets \d\d:\d\d\)$/);
  usarIdioma("pt-BR");
  assert.equal(linhaConta(conta), "* a@exemplo.com (Org): em uso. 5 horas 42%");
});

test("o texto do terminal no login, em inglês", () => {
  usarIdioma("en");
  const url = "https://login.exemplo.com/x";
  const anonima = textoDoTerminal({ aberto: true, navegador: "Microsoft Edge", privado: true }, url, "b@exemplo.com").join("\n");
  assert.match(anonima, /private window of Microsoft Edge: sign in to the account b@exemplo\.com and that's it/);
  assert.match(anonima, /On another device/);
  assert.ok(anonima.includes(`  ${url}`));
  assert.match(textoDoTerminal({ aberto: false, navegador: null, privado: false }, url, null).join("\n"), /I could not open the browser/);
  assert.match(textoDoTerminal(null, url, null).join("\n"), /^\nIf the browser opened/);
});

describe("doctor em inglês", () => {
  function deps() {
    const cred = new CredenciaisFalsas();
    cred.d.set("principal", blob("A1"));
    return {
      c: tmp.c,
      cred,
      guarda: new GuardaFalsa(),
      cli: new CliFalsa(),
      api: new ApiFalsa(),
      statusServico: async () => ({ instalado: false, rodando: false, detalhe: "" }),
      ponte: async () => null,
      nuvemConfigurada: async () => null,
      horaNuvem: async () => null,
      agora: () => T0,
      espacoLivre: () => 3.9 * 1024 ** 3,
    };
  }

  test("rótulos, detalhes, marcas e resumo em inglês; o código da situação segue igual", async () => {
    tmp = pastaTemporaria();
    usarIdioma("en");
    const r = await doctor(deps());
    assert.deepEqual(r.map((x) => x.nome), ["Agent", "Disk", "Service", "Local bridge", "Session mod", "Credential in use", "Accounts", "Keychain and vault", "Cloud", "Clock", "Coding assistant"]);
    assert.equal(r.find((x) => x.id === "disco")!.detalhe, "3.9 GB free", "ponto decimal no inglês");
    assert.deepEqual([...new Set(r.map((x) => x.situacao))].sort(), ["aviso", "falha", "ok"]);
    const texto = textoDoctor(r);
    assert.match(texto, /^ok {5}Agent +version /m);
    assert.match(texto, /^warn {3}Disk +3\.9 GB free/m);
    assert.match(texto, /^FAIL {3}Service +not installed \(reveza servico instalar\) → has a fix: run reveza doctor \(without --so-ver\)/m);
    assert.match(texto, /→ what to do: /);
    assert.match(texto, /\d+ failure\(s\), \d+ warning\(s\)\.$/);
    assert.ok(!/livres|aviso\(s\)|FALHA/.test(texto));
    assert.equal(resumoConserto([]), "nothing to fix automatically");
    usarIdioma("pt-BR");
    assert.equal((await doctor(deps())).find((x) => x.id === "disco")!.detalhe, "3,9 GB livres");
  });

  test("reveza doctor --so-ver --json: as chaves e os códigos não mudam; o texto sai em inglês", async () => {
    tmp = pastaTemporaria();
    const a = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
    assert.equal(await executarCli(["doctor", "--so-ver"], a), 1);
    assert.match(a.saidas.join("\n"), /Agent .*version /);
    const j = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
    await executarCli(["doctor", "--so-ver", "--json"], j);
    const itens = JSON.parse(j.saidas.join("")) as { id: string; situacao: string; nome: string }[];
    assert.deepEqual(itens.map((x) => x.id), ["agente", "disco", "servico", "ponte", "mod", "credenciais", "contas", "chaveiro", "nuvem", "relogio", "assistente"]);
    assert.ok(itens.every((x) => ["ok", "aviso", "falha"].includes(x.situacao)));
    assert.equal(itens[0]!.nome, "Agent");
  });
});

test("uso em inglês: só o modo legível muda; CSV e JSON seguem iguais", async () => {
  tmp = pastaTemporaria();
  const csv = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  await executarCli(["uso", "--csv"], csv);
  assert.equal(csv.saidas[0], "hora,conta,modelo,projeto,respostas,entrada,saida,cache_escrita,cache_leitura,usd");
  const a = ambiente({ REVEZA_PORTA: "1", REVEZA_IDIOMA: "en" });
  await executarCli(["uso", "--dias", "7"], a);
  assert.match(a.saidas[0]!, /^Last 7 day\(s\): US\$ 0\.00 equivalent at API prices/);
  assert.match(a.saidas[1]!, /^Estimate: on a subscription you do not pay per token\./);
});

test("o aviso da atualização completa sai no idioma do processo, sem avaliar nada ao carregar o módulo", () => {
  assert.match(avisoCompleta()[0]!, /^Atualização completa:/);
  usarIdioma("en");
  assert.match(avisoCompleta()[0]!, /^Full update:/);
  assert.ok(avisoCompleta().some((l) => l.includes("atualizacao-completa desligar")), "o comando segue em português");
  assert.ok(avisoCompleta().every((l) => !/claude|anthropic|opus|sonnet|haiku/i.test(l)));
});
