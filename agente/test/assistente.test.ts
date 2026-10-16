// A versão do assistente de código em cada computador (0.8.0). Pedido do Paulo, 15/10/2026: "temos dois pcs, e eles
// estão com versões diferentes". A escolha da instalação: o jeito do assistente, sempre a mais nova (o agente roda o
// `claude update` de 6 em 6 horas) ou só pelo painel (o agente desliga a atualização automática do assistente).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aplicarAutoUpdater, ASSISTENTE_CONFERIR_S, autoDesligado, erroDoUpdate, modoAssistente } from "../src/assistente.js";
import { lerPedido } from "../src/atualizar.js";
import { executarCli, type Ambiente } from "../src/cli.js";
import { carregarEstado, salvarEstado } from "../src/estado.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import {
  ApiFalsa,
  BancoFalso,
  CliFalsa,
  ExecutorFalso,
  montar,
  NuvemFalsa,
  pastaTemporaria,
  RelogioFalso,
  type Montado,
} from "./falsos.js";

const temporarias: string[] = [];
let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
  for (const d of temporarias.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const arquivoTemp = (conteudo?: unknown) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-assistente-"));
  temporarias.push(d);
  const f = path.join(d, "settings.json");
  if (conteudo !== undefined) fs.writeFileSync(f, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo, null, 2));
  return f;
};
const ler = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>;

describe("a atualização automática do assistente no settings.json", () => {
  test("só pelo painel: grava DISABLE_AUTOUPDATER=1 no env sem mexer no resto; de novo, nada muda", () => {
    const f = arquivoTemp({ model: "opus", env: { HTTPS_PROXY: "http://p:8080" } });
    const r = aplicarAutoUpdater(f, true, false);
    assert.deepEqual(r, { escrito: true, mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { model: "opus", env: { HTTPS_PROXY: "http://p:8080", DISABLE_AUTOUPDATER: "1" } });
    assert.deepEqual(aplicarAutoUpdater(f, true, true), { escrito: true, mudou: false, daPessoa: false });
  });

  test("de volta ao jeito do assistente: tira só o que o agente escreveu, e o env vazio sai junto", () => {
    const f = arquivoTemp({ outra: 1 });
    aplicarAutoUpdater(f, true, false);
    assert.deepEqual(aplicarAutoUpdater(f, false, true), { escrito: false, mudou: true, daPessoa: false });
    assert.deepEqual(ler(f), { outra: 1 });
    const g = arquivoTemp({ env: { HTTPS_PROXY: "x" } });
    aplicarAutoUpdater(g, true, false);
    aplicarAutoUpdater(g, false, true);
    assert.deepEqual(ler(g), { env: { HTTPS_PROXY: "x" } }, "as outras variáveis ficam");
    assert.deepEqual(aplicarAutoUpdater(g, false, false), { escrito: false, mudou: false, daPessoa: false }, "nada para tirar");
  });

  test("o valor que a pessoa escreveu (ou mudou) é dela: o agente não liga nem desliga por cima", () => {
    const daPessoa = { env: { DISABLE_AUTOUPDATER: "1" } };
    const f = arquivoTemp(daPessoa);
    assert.deepEqual(aplicarAutoUpdater(f, false, false), { escrito: false, mudou: false, daPessoa: true });
    assert.deepEqual(aplicarAutoUpdater(f, true, false), { escrito: false, mudou: false, daPessoa: true });
    assert.deepEqual(ler(f), daPessoa);
    // o agente escreveu "1" e a pessoa trocou para "0": dela também
    const g = arquivoTemp({ env: { DISABLE_AUTOUPDATER: "0" } });
    assert.deepEqual(aplicarAutoUpdater(g, false, true), { escrito: false, mudou: false, daPessoa: true });
    assert.deepEqual(ler(g), { env: { DISABLE_AUTOUPDATER: "0" } });
  });

  test("arquivo ilegível, ou com env que não é objeto, fica como está; sem arquivo, cria", () => {
    for (const conteudo of ["{ quebrado", "[]", JSON.stringify({ env: "x" }), JSON.stringify({ env: [1] })]) {
      const f = arquivoTemp(conteudo);
      assert.deepEqual(aplicarAutoUpdater(f, true, false), { escrito: false, mudou: false, daPessoa: false }, conteudo);
      assert.equal(fs.readFileSync(f, "utf8"), conteudo);
    }
    const novo = path.join(path.dirname(arquivoTemp()), "sub", "settings.json");
    assert.equal(aplicarAutoUpdater(novo, true, false).mudou, true);
    assert.deepEqual(ler(novo), { env: { DISABLE_AUTOUPDATER: "1" } });
  });

  test("quem desligou: o agente, a pessoa (também DISABLE_UPDATES) ou ninguém; 0/false/off não desligam", () => {
    assert.equal(autoDesligado(arquivoTemp({ env: { DISABLE_AUTOUPDATER: "1" } }), true), "reveza");
    assert.equal(autoDesligado(arquivoTemp({ env: { DISABLE_AUTOUPDATER: "1" } }), false), "pessoa");
    assert.equal(autoDesligado(arquivoTemp({ env: { DISABLE_AUTOUPDATER: "true" } }), true), "pessoa");
    assert.equal(autoDesligado(arquivoTemp({ env: { DISABLE_UPDATES: "1" } }), false), "pessoa");
    for (const v of ["0", "false", "off", "no", ""]) assert.equal(autoDesligado(arquivoTemp({ env: { DISABLE_AUTOUPDATER: v } }), false), null, v);
    assert.equal(autoDesligado(arquivoTemp({}), false), null);
    assert.equal(autoDesligado(path.join(os.tmpdir(), "nao-existe-reveza", "settings.json"), true), null);
  });

  test("a escolha: só sozinho e manual valem; o resto é o jeito do assistente", () => {
    assert.equal(modoAssistente("sozinho"), "sozinho");
    assert.equal(modoAssistente("manual"), "manual");
    for (const v of ["padrao", undefined, null, true, "outra"]) assert.equal(modoAssistente(v), "padrao");
  });

  test("o erro do claude update que vai ao painel: a linha que diz o problema, sem cor e curta", () => {
    assert.equal(erroDoUpdate("Checking for updates", "\u001b[31mError: Failed to install native update\u001b[0m\nnetwork down", 1), "Error: Failed to install native update");
    assert.equal(erroDoUpdate("", "", 3), "o claude update terminou com o código 3");
    assert.equal(erroDoUpdate("x".repeat(500), "", 1).length, 200);
  });

  test("o pedido do painel: só { assistente: true }; com outra chave junto, recusado (não vira atualizar o Reveza)", () => {
    assert.deepEqual(lerPedido({ assistente: true }), { ok: true, assistente: true });
    assert.equal(lerPedido({ assistente: false }).ok, false);
    assert.equal(lerPedido({ assistente: true, versao: "mais_nova" }).ok, false);
  });
});

describe("o agente e o assistente de código", () => {
  let banco: BancoFalso;
  async function preparar(config: Record<string, unknown> = {}, opcoes: { sombra?: boolean } = {}) {
    banco = new BancoFalso();
    banco.config = { ...banco.config, ...config };
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), exec: new ExecutorFalso(), sombra: opcoes.sombra });
    banco.agora = () => m!.relogio.agora();
    await m.agente.busca();
    await m.agente.esperar();
  }
  const settings = () => path.join(m!.c.principalDir, "settings.json");
  async function pedir(id: number, corpo: Record<string, unknown>) {
    banco.comandos.push({ id, acao: "atualizar", corpo, pc: "pc-1", estado: "pendente" });
    await m!.agente.busca();
    return banco.comandos.find((c) => c.id === id)! as { estado: string; http?: number; resposta?: Record<string, unknown> };
  }

  test("só pelo painel: o agente desliga a atualização automática; voltando ao jeito do assistente, devolve na hora", async () => {
    await preparar({ assistente_atualizar: "manual" });
    assert.deepEqual(ler(settings()).env, { DISABLE_AUTOUPDATER: "1" });
    assert.equal(m!.agente.estado.assistenteDesligouAuto, true);
    assert.equal(m!.agente.infoAssistente().autoDesligado, "reveza");
    banco.config = { ...banco.config, assistente_atualizar: "padrao" };
    await m!.agente.busca();
    assert.equal(ler(settings()).env, undefined);
    assert.equal(m!.agente.estado.assistenteDesligouAuto, false);
    assert.equal(m!.cli.atualizacoes, 0, "sem 'sempre a mais nova', o agente não roda o claude update sozinho");
  });

  test("em modo sombra, nada no settings.json e nenhum claude update (nem comando ele responde)", async () => {
    await preparar({ assistente_atualizar: "manual" }, { sombra: true });
    assert.equal(fs.existsSync(settings()) && "env" in ler(settings()), false);
    const cmd = await pedir(1, { assistente: true });
    assert.notEqual(cmd.estado, "feito");
    banco.config = { ...banco.config, assistente_atualizar: "sozinho" };
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.equal(m!.cli.atualizacoes, 0);
  });

  test("o Atualizar do painel: responde na hora com a versão de antes; o fim vai ao diagnóstico", async () => {
    await preparar();
    let soltar!: () => void;
    m!.cli.segurarAtualizacao = new Promise((r) => (soltar = r));
    const cmd = await pedir(1, { assistente: true });
    assert.equal(cmd.estado, "feito", JSON.stringify(cmd.resposta));
    assert.deepEqual(cmd.resposta, { ok: true, assistente: true, atualizando: true, de: "2.1.293" });
    assert.equal(m!.agente.infoAssistente().atualizando, true);
    // outro pedido enquanto o primeiro roda: recusado, um claude update só
    const outro = await pedir(2, { assistente: true });
    assert.equal(outro.estado, "recusado");
    assert.match(String(outro.resposta?.erro), /já está atualizando/);
    soltar();
    await m!.agente.esperar();
    assert.equal(m!.cli.atualizacoes, 1);
    const info = m!.agente.infoAssistente();
    assert.equal(info.atualizando, false);
    assert.deepEqual({ ...(info.ultima as object), em: "x" }, { em: "x", ok: true, de: "2.1.293", para: "2.1.301", sozinho: false });
    assert.match(m!.log.linhas.join("\n"), /assistente de código: de 2\.1\.293 para 2\.1\.301 \(pedido do painel\)/);
  });

  test("o claude update que falha: o erro curto fica guardado para o painel, e a versão não muda", async () => {
    await preparar();
    m!.cli.aoAtualizar = () => ({ codigo: 1, saida: "Checking for updates", erro: "Error: Failed to install native update" });
    await pedir(1, { assistente: true });
    await m!.agente.esperar();
    const u = m!.agente.estado.assistenteUltima!;
    assert.equal(u.ok, false);
    assert.equal(u.para, "2.1.293");
    assert.equal(u.erro, "Error: Failed to install native update");
  });

  test("sempre a mais nova: o claude update roda na primeira busca calma e depois de 6 em 6 horas", async () => {
    await preparar({ assistente_atualizar: "sozinho" });
    assert.equal(m!.cli.atualizacoes, 1, "a primeira busca já alinha a versão");
    assert.equal(m!.agente.estado.assistenteUltima?.sozinho, true);
    assert.equal(fs.existsSync(settings()) ? ler(settings()).env : undefined, undefined, "nada de desligar a atualização automática");
    await m!.relogio.avancar((ASSISTENTE_CONFERIR_S - 60) * 1000);
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.equal(m!.cli.atualizacoes, 1, "antes das 6 horas, não");
    await m!.relogio.avancar(120 * 1000);
    await m!.agente.busca();
    await m!.agente.esperar();
    assert.equal(m!.cli.atualizacoes, 2);
  });

  test("o que vai ao painel: a escolha, quem desligou, se está atualizando e a última atualização", async () => {
    await preparar({ assistente_atualizar: "manual" });
    const info = m!.agente.infoAssistente();
    assert.deepEqual(info, { modo: "manual", autoDesligado: "reveza", atualizando: false, ultima: null });
  });
});

describe("o doctor leva a versão do assistente num campo próprio", () => {
  test("Conferencia.valor com X.Y.Z (o painel não lê o texto); sem programa, sem valor", async () => {
    const { doctor } = await import("../src/doctor.js");
    const tmp = pastaTemporaria();
    temporarias.push(tmp.dir);
    const cli = new CliFalsa();
    const d = {
      c: tmp.c,
      cred: new CredenciaisFalsas(),
      guarda: new GuardaFalsa(),
      cli,
      api: new ApiFalsa(),
      statusServico: async () => ({ instalado: true, rodando: true, detalhe: "rodando" }),
      ponte: async () => ({ nuvem: { online: true }, cofre: true }),
      nuvemConfigurada: async () => null,
      horaNuvem: async () => null,
      agora: () => 1_760_000_000,
      espacoLivre: () => 50 * 1024 ** 3,
    };
    const item = async () => (await doctor(d as Parameters<typeof doctor>[0])).find((c) => c.id === "assistente")!;
    assert.equal((await item()).valor, "2.1.293");
    cli.versaoAtual = null;
    assert.equal((await item()).valor, undefined);
  });
});

describe("reveza assistente liberar (a desinstalação)", () => {
  test("tira o DISABLE_AUTOUPDATER do agente e o estado esquece; valor da pessoa fica", async () => {
    const tmp = pastaTemporaria();
    temporarias.push(tmp.dir);
    const saidas: string[] = [];
    const erros: string[] = [];
    const guarda = new GuardaFalsa();
    const amb: Ambiente = {
      c: tmp.c,
      sistema: "macos",
      exec: new ExecutorFalso(),
      relogio: new RelogioFalso(),
      saida: (t) => saidas.push(t),
      erro: (t) => erros.push(t),
      perguntar: async () => "",
      env: { REVEZA_PORTA: "1" },
      script: "/app/cli.js",
      fabricas: { cred: () => new CredenciaisFalsas(), guarda: async () => guarda, api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => null },
    };
    const f = path.join(tmp.c.principalDir, "settings.json");
    fs.writeFileSync(f, JSON.stringify({ env: { DISABLE_AUTOUPDATER: "1", OUTRA: "x" } }));
    const e = carregarEstado(tmp.c.estado);
    e.assistenteDesligouAuto = true;
    salvarEstado(tmp.c.estado, e);
    assert.equal(await executarCli(["assistente", "liberar"], amb), 0);
    assert.deepEqual(ler(f), { env: { OUTRA: "x" } });
    assert.equal(carregarEstado(tmp.c.estado).assistenteDesligouAuto, false);
    assert.match(saidas.join("\n"), /voltou a ligar/);
    // de novo, ou com o valor da pessoa: nada muda
    fs.writeFileSync(f, JSON.stringify({ env: { DISABLE_AUTOUPDATER: "1" } }));
    assert.equal(await executarCli(["assistente", "liberar"], amb), 0);
    assert.deepEqual(ler(f), { env: { DISABLE_AUTOUPDATER: "1" } });
    assert.equal(await executarCli(["assistente"], amb), 1);
  });
});
