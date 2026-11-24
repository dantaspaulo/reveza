// O registro de uso grava no ritmo (0.21.0): ele tem megabytes e era regravado inteiro a cada varredura com novidade
// (cerca de 22 dos 28 GB que o agente escrevia no disco por dia, medido em 23/11/2026). Agora vai ao disco no máximo a
// cada 10 min, e sempre ao desligar. Uma queda no intervalo não perde nem conta em dobro: as conversas são relidas de
// onde o arquivo parou.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsPadrao from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { Contador, REGISTRO_GRAVAR_S } from "../src/registro/contador.js";
import { montar, type Montado } from "./falsos.js";

const T = 1_800_000_000;

function resposta(id: string, ts: number) {
  return {
    type: "assistant",
    sessionId: "s1",
    cwd: "/Users/x/Code/projeto",
    timestamp: new Date(ts * 1000).toISOString(),
    message: { id, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 100 } },
  };
}

describe("registro no ritmo", () => {
  let tmp: string;
  let dir: string;
  let conversa: string;
  let agora: number;
  const novo = () => new Contador(dir, path.join(tmp, "projects"), () => "conta-a", () => agora);
  const escrever = (...ids: string[]) => fs.appendFileSync(conversa, ids.map((i) => JSON.stringify(resposta(i, T))).join("\n") + "\n");
  /** Até onde a conversa foi lida, segundo o que está no disco (o que uma queda deixaria). */
  const lidoNoDisco = () => (JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")) as { arquivos: Record<string, number> }).arquivos[conversa];
  const tamanho = () => fs.statSync(conversa).size;

  beforeEach(() => {
    agora = T;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-ritmo-"));
    dir = path.join(tmp, "registro");
    const proj = path.join(tmp, "projects", "-Users-x-Code-projeto");
    fs.mkdirSync(proj, { recursive: true });
    conversa = path.join(proj, "s1.jsonl");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("a primeira varredura depois de ligar grava na hora", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    assert.equal(lidoNoDisco(), tamanho());
  });

  test("novidade antes do prazo fica na memória e não regrava o arquivo", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    const antes = lidoNoDisco();
    agora += REGISTRO_GRAVAR_S - 1;
    escrever("m2");
    await c.varrer();
    assert.equal(c.e.arquivos[conversa], tamanho(), "a memória já leu");
    assert.equal(lidoNoDisco(), antes, "o disco ainda não");
    assert.equal(c.salvarNoRitmo(), false);
  });

  test("passado o prazo, grava", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    agora += REGISTRO_GRAVAR_S;
    escrever("m2");
    await c.varrer();
    assert.equal(lidoNoDisco(), tamanho());
  });

  test("salvar() não espera o ritmo (importação e desligamento)", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    escrever("m2");
    await c.varrer();
    assert.notEqual(lidoNoDisco(), tamanho());
    c.salvar();
    assert.equal(lidoNoDisco(), tamanho());
  });

  test("gravar direto recomeça a contagem do prazo", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    agora += REGISTRO_GRAVAR_S - 1;
    c.salvar();
    agora += 2;
    assert.equal(c.salvarNoRitmo(), false, "faz 2 s da última gravação");
  });

  test("disco cheio: não conta como gravado e tenta de novo na volta seguinte", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    agora += REGISTRO_GRAVAR_S;
    escrever("m2");
    const original = fsPadrao.openSync;
    fsPadrao.openSync = ((alvo: fs.PathLike, ...resto: unknown[]) => {
      if (String(alvo).includes(`${path.sep}registro${path.sep}estado.json.tmp`)) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return (original as (...a: unknown[]) => number)(alvo, ...resto);
    }) as typeof fsPadrao.openSync;
    syncBuiltinESMExports();
    try {
      await assert.rejects(c.varrer(), /ENOSPC/);
    } finally {
      fsPadrao.openSync = original;
      syncBuiltinESMExports();
    }
    assert.notEqual(lidoNoDisco(), tamanho());
    assert.equal(c.salvarNoRitmo(), true, "a volta seguinte grava, sem esperar outro prazo");
    assert.equal(lidoNoDisco(), tamanho());
  });

  test("relógio que voltou atrás não segura a gravação até ele alcançar a hora antiga", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    agora -= 3600;
    escrever("m2");
    await c.varrer();
    assert.equal(lidoNoDisco(), tamanho());
  });

  test("falha ao gravar na hora de esvaziar a lista de vistas: a resposta não se perde", async () => {
    const c = novo();
    escrever("m1");
    await c.varrer();
    agora += REGISTRO_GRAVAR_S;
    escrever("m2");
    for (let i = 0; i <= 20_000; i++) c.e.vistosRecentes.push(`x${i}`);
    const original = fsPadrao.openSync;
    fsPadrao.openSync = ((alvo: fs.PathLike, ...resto: unknown[]) => {
      if (String(alvo).includes(`${path.sep}registro${path.sep}estado.json.tmp`)) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return (original as (...a: unknown[]) => number)(alvo, ...resto);
    }) as typeof fsPadrao.openSync;
    syncBuiltinESMExports();
    try {
      await assert.rejects(c.varrer(), /ENOSPC/);
    } finally {
      fsPadrao.openSync = original;
      syncBuiltinESMExports();
    }
    const depois = novo();
    await depois.varrer();
    assert.equal(depois.totais(0, T + 9999).respostas, 2, "a m2 não pode ficar marcada como vista sem ter sido contada");
  });

  test("queda entre duas gravações: relê a conversa, com o mesmo total e sem contar em dobro", async () => {
    const c = novo();
    escrever("m1", "m2");
    await c.varrer();
    escrever("m3");
    await c.varrer();
    assert.equal(c.totais(0, T + 9999).respostas, 3);
    // a queda: nada do que estava só na memória chega ao disco
    const depois = novo();
    assert.equal(depois.totais(0, T + 9999).respostas, 2, "o disco ficou na gravação anterior");
    await depois.varrer();
    assert.equal(depois.totais(0, T + 9999).respostas, 3);
    assert.equal(depois.totais(0, T + 9999).saida, 300);
  });
});

describe("agente e o registro", () => {
  let m: Montado | null = null;
  afterEach(() => {
    m?.limpar();
    m = null;
  });

  test("a volta do registro grava no ritmo e o desligamento grava o que ficou", async () => {
    m = await montar();
    const proj = path.join(m.c.projetos, "-Users-x-Code-projeto");
    fs.mkdirSync(proj, { recursive: true });
    const conversa = path.join(proj, "s1.jsonl");
    const lidoNoDisco = () => (JSON.parse(fs.readFileSync(path.join(m!.c.registro, "estado.json"), "utf8")) as { arquivos: Record<string, number> }).arquivos[conversa];
    fs.appendFileSync(conversa, JSON.stringify(resposta("m1", T)) + "\n");
    await m.agente.registro();
    const antes = lidoNoDisco();
    assert.equal(antes, fs.statSync(conversa).size);
    fs.appendFileSync(conversa, JSON.stringify(resposta("m2", T)) + "\n");
    await m.agente.registro();
    assert.equal(lidoNoDisco(), antes, "antes do prazo o arquivo não é regravado");
    await m.agente.desligar();
    assert.equal(lidoNoDisco(), fs.statSync(conversa).size, "ao desligar, grava o que estava só na memória");
  });

  test("desligar não trava se o registro não puder ser gravado", async () => {
    m = await montar();
    const proj = path.join(m.c.projetos, "-Users-x-Code-projeto");
    fs.mkdirSync(proj, { recursive: true });
    fs.appendFileSync(path.join(proj, "s1.jsonl"), JSON.stringify(resposta("m1", T)) + "\n");
    await m.agente.registro();
    const original = fsPadrao.openSync;
    fsPadrao.openSync = ((alvo: fs.PathLike, ...resto: unknown[]) => {
      if (String(alvo).includes(`${path.sep}registro${path.sep}estado.json.tmp`)) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      return (original as (...a: unknown[]) => number)(alvo, ...resto);
    }) as typeof fsPadrao.openSync;
    syncBuiltinESMExports();
    try {
      await m.agente.desligar();
    } finally {
      fsPadrao.openSync = original;
      syncBuiltinESMExports();
    }
    assert.ok(m.log.linhas.some((l) => l.includes("registro de uso")), "o erro aparece no registro do agente");
  });
});
