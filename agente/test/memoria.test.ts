// A troca automática espera sobrar memória para a leva de processos que ela abre nos editores (memoria.ts, 0.10.6).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import { ESPERA_MAXIMA_S, esperarMemoria, lerMemoria, trocaPodeEsperar, type Memoria } from "../src/memoria.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, ExecutorFalso, montar, NuvemFalsa, type Montado } from "./falsos.js";

const GB = 1024 ** 3;
const mem = (livrePct: number, processos: number | null = 16, totalGb = 16): Memoria => ({ livrePct, totalBytes: totalGb * GB, processos });

describe("quando a troca pode esperar", () => {
  test("o gatilho abaixo de 100% e o rodízio esperam; limite, painel, API, 100% e motivo vazio, não", () => {
    for (const m of ["chegou a 95%", "chegou a 90.5%", "rodízio", "rodízio do dia"]) assert.equal(trocaPodeEsperar(m), true, m);
    for (const m of ["chegou a 100%", "a sessão bateu o limite", "pedido pelo painel", "pedido pela API", "", "decisão da nuvem"]) {
      assert.equal(trocaPodeEsperar(m), false, m);
    }
  });
});

describe("a conta da espera", () => {
  const p = (o: Partial<{ motivo: string; pctConta: number | null; desde: number | null; t: number }> = {}) => ({
    motivo: "chegou a 95%",
    pctConta: 96,
    desde: null,
    t: 1000,
    ...o,
  });

  test("sobra pouco depois da leva: espera (16 sessões de 250 MB tiram 24 pontos de 16 GB)", () => {
    const r = esperarMemoria(mem(36), p());
    assert.equal(r.esperar, true);
    assert.equal(r.levaMb, 4000);
    assert.ok(Math.abs(r.sobraPct! - 11.6) < 0.1, String(r.sobraPct));
  });

  test("sobra bastante: não espera", () => {
    assert.equal(esperarMemoria(mem(50), p()).esperar, false);
  });

  test("sem contar os processos, vale só a folga mínima", () => {
    assert.equal(esperarMemoria(mem(14, null), p()).esperar, true);
    assert.equal(esperarMemoria(mem(20, null), p()).esperar, false);
  });

  test("conta em 99% ou mais, espera longa, sem leitura da memória ou motivo que não espera: troca", () => {
    assert.equal(esperarMemoria(mem(10), p({ pctConta: 98.9 })).esperar, true);
    assert.equal(esperarMemoria(mem(10), p({ pctConta: 99 })).esperar, false);
    assert.equal(esperarMemoria(mem(10), p({ desde: 1000 - ESPERA_MAXIMA_S + 1 })).esperar, true);
    assert.equal(esperarMemoria(mem(10), p({ desde: 1000 - ESPERA_MAXIMA_S })).esperar, false);
    assert.equal(esperarMemoria(null, p()).esperar, false);
    assert.equal(esperarMemoria({ livrePct: 10, totalBytes: 0, processos: 3 }, p()).esperar, false);
    assert.equal(esperarMemoria(mem(10), p({ motivo: "a sessão bateu o limite" })).esperar, false);
  });
});

describe("leitura da memória", () => {
  test("macOS: sysctl e pgrep", async () => {
    const ex = new ExecutorFalso();
    ex.responder = (argv) => (argv[0] === "sysctl" ? { codigo: 0, saida: "37\n17179869184\n", erro: "" } : { codigo: 0, saida: "101\n202\n303\n", erro: "" });
    assert.deepEqual(await lerMemoria(ex, "macos"), { livrePct: 37, totalBytes: 17179869184, processos: 3 });
    assert.deepEqual(ex.chamadas.map((c) => c.argv[0]), ["sysctl", "pgrep"]);
  });

  test("pgrep sem nenhum processo conta zero; sysctl que falha não lê (a troca não espera)", async () => {
    const ex = new ExecutorFalso();
    ex.responder = (argv) => (argv[0] === "sysctl" ? { codigo: 0, saida: "50\n1000\n", erro: "" } : { codigo: 1, saida: "", erro: "" });
    assert.equal((await lerMemoria(ex, "macos"))!.processos, 0);
    ex.responder = () => ({ codigo: 127, saida: "", erro: "não achei" });
    assert.equal(await lerMemoria(ex, "macos"), null);
  });

  test("Linux: MemAvailable sobre MemTotal", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-mem-"));
    const arq = path.join(dir, "meminfo");
    fs.writeFileSync(arq, "MemTotal:       8000000 kB\nMemFree:         100000 kB\nMemAvailable:    2000000 kB\n");
    const ex = new ExecutorFalso();
    ex.responder = () => ({ codigo: 0, saida: "7\n", erro: "" });
    const r = await lerMemoria(ex, "linux", { meminfo: arq });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(r, { livrePct: 25, totalBytes: 8000000 * 1024, processos: 1 });
  });

  test("Windows: memória do sistema e tasklist", async () => {
    const ex = new ExecutorFalso();
    ex.responder = () => ({ codigo: 0, saida: '"claude.exe","4321","Console","1","150.000 K"\r\n"claude.exe","4400","Console","1","90.000 K"\r\n', erro: "" });
    const r = await lerMemoria(ex, "windows", { so: { freemem: () => 4 * GB, totalmem: () => 16 * GB } });
    assert.deepEqual(r, { livrePct: 25, totalBytes: 16 * GB, processos: 2 });
  });
});

describe("o agente", () => {
  let m: Montado;
  afterEach(() => m?.limpar());
  const e = () => m.agente.estado;
  const segurou = () => e().eventos.filter((x) => /Segurei a troca/.test(x.texto)).length;

  test("sem nuvem: segura a troca dos 95% com pouca memória, avisa uma vez e troca quando sobra", async () => {
    let atual = mem(30);
    m = await montar({ memoria: async () => atual });
    const a = await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir();
    await m.agente.agir();
    assert.equal(e().ativa, a);
    assert.equal(segurou(), 1);
    atual = mem(60);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.ok(m.log.linhas.some((l) => l.includes("fim da espera por memória")), m.log.linhas.join("\n"));
  });

  test("sem nuvem: com a conta em 99%, troca mesmo com pouca memória", async () => {
    m = await montar({ memoria: async () => mem(5) });
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.equal(segurou(), 0);
  });

  test("sem nuvem: o limite da sessão troca na hora, com pouca memória", async () => {
    m = await montar({ memoria: async () => mem(5) });
    await ativaEm(m, "A", 60);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir(true);
    assert.equal(e().ativa, b);
  });

  test("sem nuvem: depois da espera máxima, troca mesmo com pouca memória", async () => {
    m = await montar({ memoria: async () => mem(5) });
    const a = await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir();
    assert.equal(e().ativa, a);
    m.relogio.t += ESPERA_MAXIMA_S;
    e().contas[b]!.lidoEm = m.relogio.agora();
    await m.agente.agir();
    assert.equal(e().ativa, b);
  });

  test("com nuvem: a atribuição dos 95% espera memória sem pegar a posse; a do limite entra na hora", async () => {
    const banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), memoria: async () => mem(30) });
    banco.agora = () => m.relogio.agora();
    const a = await ativaEm(m, "A", 96);
    await m.agente.esperar();
    await m.agente.busca();
    const c = banco.conta("b@exemplo.com");
    const k = (await lerChave(m.guarda))!;
    const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, 2), blob("B1", true, 3600, m.relogio.agora()));
    c.cofre = { cifrado, nonce, versao: 2, expira_em: null };
    const b = contaEstacionada(m, "B", 3, { contaId: c.id });
    e().contas[b]!.versaoCofre = 2;
    banco.atribuir("pc-1", c.id, "chegou a 95%");
    await m.agente.busca();
    await m.agente.busca();
    assert.equal(e().ativa, a);
    assert.equal(banco.posse.get(c.id), undefined, "não pega a posse da conta nova enquanto espera");
    assert.equal(segurou(), 1);
    banco.atribuir("pc-1", c.id, "a sessão bateu o limite");
    await m.agente.busca();
    assert.equal(e().ativa, b);
  });
});
