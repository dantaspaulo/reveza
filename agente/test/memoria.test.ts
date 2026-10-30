// A troca automática espera sobrar memória para a leva de processos que ela abre nos editores (memoria.ts, 0.10.6).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aadConta, cifrarLogin, decifrarLogin } from "../src/cofre/cifra.js";
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

  test("a leva tem teto de 20% da memória: com 16 sessões em 16 GB, espera abaixo de 30% livres", () => {
    const r = esperarMemoria(mem(28), p());
    assert.equal(r.esperar, true);
    assert.ok(Math.abs(r.levaMb! - 3276.8) < 0.1, String(r.levaMb));
    assert.ok(Math.abs(r.sobraPct! - 8) < 0.01, String(r.sobraPct));
    // sem o teto, 16 x 250 MB seriam 24,4% e a troca esperaria também com 32% livres
    assert.equal(esperarMemoria(mem(32), p()).esperar, false);
  });

  test("poucas sessões: a leva é a conta delas", () => {
    assert.equal(esperarMemoria(mem(14, 4), p()).esperar, true);
    assert.equal(esperarMemoria(mem(20, 4), p()).esperar, false);
  });

  test("sem contar os processos, vale só a folga mínima", () => {
    assert.equal(esperarMemoria(mem(9, null), p()).esperar, true);
    assert.equal(esperarMemoria(mem(12, null), p()).esperar, false);
  });

  test("conta em 98% ou mais, espera longa, sem leitura da memória ou motivo que não espera: troca", () => {
    assert.equal(esperarMemoria(mem(10), p({ pctConta: 97.9 })).esperar, true);
    assert.equal(esperarMemoria(mem(10), p({ pctConta: 98 })).esperar, false);
    assert.equal(esperarMemoria(mem(10), p({ desde: 1000 - ESPERA_MAXIMA_S + 1 })).esperar, true);
    assert.equal(esperarMemoria(mem(10), p({ desde: 1000 - ESPERA_MAXIMA_S })).esperar, false);
    assert.equal(esperarMemoria(null, p()).esperar, false);
    assert.equal(esperarMemoria({ livrePct: 10, totalBytes: 0, processos: 3 }, p()).esperar, false);
    assert.equal(esperarMemoria(mem(10), p({ motivo: "a sessão bateu o limite" })).esperar, false);
  });
});

describe("leitura da memória", () => {
  test("macOS: sysctl e pgrep pelo caminho inteiro (o serviço roda sem /usr/sbin no PATH), só do usuário", async () => {
    const ex = new ExecutorFalso();
    ex.responder = (argv) =>
      argv[0] === "/usr/sbin/sysctl" ? { codigo: 0, saida: "37\n17179869184\n", erro: "" } : { codigo: 0, saida: "101\n202\n303\n", erro: "" };
    assert.deepEqual(await lerMemoria(ex, "macos", { uid: 501 }), { livrePct: 37, totalBytes: 17179869184, processos: 3 });
    assert.deepEqual(ex.chamadas[0]!.argv, ["/usr/sbin/sysctl", "-n", "kern.memorystatus_level", "hw.memsize"]);
    assert.deepEqual(ex.chamadas[1]!.argv, ["/usr/bin/pgrep", "-x", "-U", "501", "claude"]);
  });

  test("pgrep sem nenhum processo conta zero; sysctl que falha não lê (a troca não espera)", async () => {
    const ex = new ExecutorFalso();
    ex.responder = (argv) => (argv[0] === "/usr/sbin/sysctl" ? { codigo: 0, saida: "50\n1000\n", erro: "" } : { codigo: 1, saida: "", erro: "" });
    assert.equal((await lerMemoria(ex, "macos", { uid: null }))!.processos, 0);
    assert.deepEqual(ex.chamadas[1]!.argv, ["/usr/bin/pgrep", "-x", "claude"]);
    ex.responder = () => ({ codigo: 127, saida: "", erro: "não achei" });
    assert.equal(await lerMemoria(ex, "macos"), null);
  });

  test("Linux: MemAvailable sobre MemTotal", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-mem-"));
    const arq = path.join(dir, "meminfo");
    fs.writeFileSync(arq, "MemTotal:       8000000 kB\nMemFree:         100000 kB\nMemAvailable:    2000000 kB\n");
    const ex = new ExecutorFalso();
    ex.responder = () => ({ codigo: 0, saida: "7\n", erro: "" });
    const r = await lerMemoria(ex, "linux", { meminfo: arq, uid: 1000 });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(r, { livrePct: 25, totalBytes: 8000000 * 1024, processos: 1 });
    assert.deepEqual(ex.chamadas[0]!.argv, ["/usr/bin/pgrep", "-x", "-U", "1000", "claude"]);
  });

  test("Windows: memória do sistema e tasklist", async () => {
    const ex = new ExecutorFalso();
    ex.responder = () => ({ codigo: 0, saida: '"claude.exe","4321","Console","1","150.000 K"\r\n"claude.exe","4400","Console","1","90.000 K"\r\n', erro: "" });
    const r = await lerMemoria(ex, "windows", { so: { freemem: () => 4 * GB, totalmem: () => 16 * GB } });
    assert.deepEqual(r, { livrePct: 25, totalBytes: 16 * GB, processos: 2 });
  });
});

describe("o agente sem nuvem", () => {
  let m: Montado;
  afterEach(() => m?.limpar());
  const e = () => m.agente.estado;
  const segurou = () => e().eventos.filter((x) => /Segurei a troca/.test(x.texto)).length;

  test("segura a troca dos 95% com pouca memória, avisa uma vez, não atualiza nada enquanto isso e troca quando sobra", async () => {
    let atual = mem(20);
    m = await montar({ memoria: async () => atual });
    const a = await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 3);
    assert.equal(m.agente.momentoCalmo(), true);
    await m.agente.agir();
    await m.agente.agir();
    assert.equal(e().ativa, a);
    assert.equal(segurou(), 1);
    assert.equal(m.agente.momentoCalmo(), false, "esperando memória não é momento calmo");
    atual = mem(60);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.ok(m.log.linhas.some((l) => l.includes("fim da espera por memória")), m.log.linhas.join("\n"));
  });

  test("com a conta em 98%, troca mesmo com pouca memória", async () => {
    m = await montar({ memoria: async () => mem(5) });
    await ativaEm(m, "A", 98);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.equal(segurou(), 0);
  });

  test("o limite da sessão troca na hora, com pouca memória", async () => {
    m = await montar({ memoria: async () => mem(5) });
    await ativaEm(m, "A", 60);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir(true);
    assert.equal(e().ativa, b);
  });

  test("depois da espera máxima, troca mesmo com pouca memória", async () => {
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

  test("rodízio: a espera é da conta em uso (o destino muda e o relógio não volta), sem reagendar enquanto espera", async () => {
    m = await montar({ memoria: async () => mem(5) });
    const a = await ativaEm(m, "A", 20);
    const b = contaEstacionada(m, "B", 3);
    const c = contaEstacionada(m, "C", 5);
    e().config.modo = "rodizio";
    e().config.rodizio = { minutos: 60, ordem: "menor_uso" };
    e().proximoRodizioEm = m.relogio.agora() - 1;
    const vez = e().proximoRodizioEm;
    await m.agente.agir();
    assert.equal(e().ativa, a);
    assert.equal(e().proximoRodizioEm, vez, "esperando, o rodízio não é reagendado");
    m.relogio.t += ESPERA_MAXIMA_S / 2;
    e().contas[b]!.janelas = [{ tipo: "five_hour", pct: 8, resetEm: m.relogio.agora() + 3600 }];
    for (const id of [b, c]) e().contas[id]!.lidoEm = m.relogio.agora();
    await m.agente.agir();
    assert.equal(e().ativa, a, "o destino mudou para C e a espera seguiu");
    assert.equal(segurou(), 1);
    m.relogio.t += ESPERA_MAXIMA_S / 2;
    for (const id of [b, c]) e().contas[id]!.lidoEm = m.relogio.agora();
    await m.agente.agir();
    assert.equal(e().ativa, c, "a espera contou desde o primeiro destino");
    assert.ok(e().proximoRodizioEm! > m.relogio.agora());
  });

  test("não segura com a conta em uso sem o modelo das sessões, nem com sessão parada esperando conta", async () => {
    m = await montar({ memoria: async () => mem(5) });
    const a = await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 3);
    (e().semModelo ??= {})[a] = { modelo: "opus", ate: m.relogio.agora() + 600 };
    await m.agente.agir();
    assert.equal(e().ativa, b);

    m.limpar();
    m = await montar({ memoria: async () => mem(5) });
    await ativaEm(m, "A", 95);
    const b2 = contaEstacionada(m, "B", 3);
    e().fila.push({ sessao: "s1", cwd: "/tmp", tipo: "interativa", em: m.relogio.agora(), estado: "aguardando", conta: null });
    await m.agente.agir();
    assert.equal(e().ativa, b2);
    assert.equal(segurou(), 0);
  });

  test("modo sombra não segura (e segue dizendo o que faria)", async () => {
    m = await montar({ sombra: true, memoria: async () => mem(5) });
    await ativaEm(m, "A", 97);
    contaEstacionada(m, "B", 3);
    await m.agente.agir();
    assert.equal(segurou(), 0);
    assert.ok(m.log.linhas.some((l) => l.includes("faria: trocar para b@exemplo.com")), m.log.linhas.join("\n"));
  });
});

describe("o agente com nuvem", () => {
  let m: Montado;
  let banco: BancoFalso;
  afterEach(() => m?.limpar());
  const e = () => m.agente.estado;
  const segurou = () => e().eventos.filter((x) => /Segurei a troca/.test(x.texto)).length;

  async function comAeB(memoria: () => Promise<Memoria | null>) {
    banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), memoria });
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
    return { a, b, aId: e().contas[a]!.contaId!, bId: c.id };
  }

  async function abrir(contaId: string) {
    const c = banco.contas.get(contaId)!;
    const k = (await lerChave(m.guarda))!;
    return decifrarLogin(k, aadConta(contaId, c.cofre!.versao), c.cofre!.cifrado, c.cofre!.nonce);
  }

  test("a atribuição dos 95% espera memória mais de 2 min com a conta em uso presa a este computador, e depois a limpeza fecha", async () => {
    let atual = mem(20);
    const { a, b, aId, bId } = await comAeB(async () => atual);
    banco.atribuir("pc-1", bId, "chegou a 95%");
    for (let i = 0; i < 4; i++) {
      await m.agente.busca();
      m.relogio.t += 60;
    }
    assert.equal(e().ativa, a);
    assert.equal(segurou(), 1);
    assert.equal(banco.posse.get(bId), undefined, "não pega a posse da conta nova enquanto espera");
    assert.equal(banco.donoDaPosse(aId), "pc-1", "a conta em uso segue com este computador depois de 4 min");
    const outro = await new NuvemFalsa(banco, "pc-2").pegarPosse(aId, "renovacao", 60);
    assert.equal(outro.ok, false, "outro computador não pega a conta em uso");
    m.cred.d.set("principal", blob("A5"));
    atual = mem(60);
    await m.agente.busca();
    assert.equal(e().ativa, b);
    m.relogio.t += 25;
    await m.agente.busca();
    assert.equal(banco.posse.get(aId), undefined, "a conta que saiu foi devolvida e solta");
    assert.equal(m.agente.posse!.soltarDepois.size, 0);
    assert.equal((await abrir(aId)).claudeAiOauth?.accessToken, "A5", "o cofre ficou com o login mais novo de A");
  });

  test("sessão parada esperando conta destrava a espera na busca seguinte", async () => {
    const { a, b, bId } = await comAeB(async () => mem(20));
    banco.atribuir("pc-1", bId, "chegou a 95%");
    await m.agente.busca();
    assert.equal(e().ativa, a);
    e().fila.push({ sessao: "s1", cwd: "/tmp", tipo: "interativa", em: m.relogio.agora(), estado: "aguardando", conta: a });
    await m.agente.busca();
    assert.equal(e().ativa, b);
  });

  test("o conserto da credencial não espera", async () => {
    const { a, b, bId } = await comAeB(async () => mem(20));
    banco.atribuir("pc-1", bId, "chegou a 95%");
    await m.agente.busca();
    assert.equal(e().ativa, a);
    const r = await m.agente.aplicarAtribuicao(m.agente.ultimaAtribuicao!, true);
    assert.equal(r.ok, true, r.erro);
    assert.equal(e().ativa, b);
  });
});
