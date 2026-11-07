// Sessões críticas (0.15.0): sem conta com folga abaixo do gatilho, as comuns esperam e só as marcadas seguem.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { marcarCritica, podarCriticas, situacaoCriticas, temFolga } from "../src/criticas.js";
import { ativaEm, contaEstacionada, montar, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const agora = () => m.relogio.agora();
const e = () => m.agente.estado;
const ligar = (gatilho = 75) => Object.assign(e().config, { criticas: true, criticasGatilho: gatilho });

describe("sessões críticas: quando segurar", () => {
  test("desligada de fábrica: não segura, mesmo com tudo cheio", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    contaEstacionada(m, "B", 98);
    assert.equal(situacaoCriticas(e(), agora()), null);
  });

  test("uma conta abaixo do gatilho: as comuns seguem", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 96);
    contaEstacionada(m, "B", 74);
    assert.deepEqual(situacaoCriticas(e(), agora()), { segurar: false, gatilho: 75 });
  });

  test("todas no gatilho ou acima: segura (a em uso conta junto)", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 75);
    contaEstacionada(m, "B", 99);
    assert.deepEqual(situacaoCriticas(e(), agora()), { segurar: true, gatilho: 75 });
  });

  test("a em uso com folga basta", async () => {
    m = await montar();
    ligar(80);
    await ativaEm(m, "A", 60);
    contaEstacionada(m, "B", 100);
    assert.equal(situacaoCriticas(e(), agora())?.segurar, false);
  });

  test("pausada, sem login ou sem o modelo não contam como folga", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 90);
    const b = contaEstacionada(m, "B", 10);
    const c = contaEstacionada(m, "C", 10);
    const d = contaEstacionada(m, "D", 10);
    e().contas[b]!.pausada = true;
    e().contas[c]!.precisaLogin = true;
    e().semModelo = { [d]: { modelo: "fable", ate: agora() + 600 } };
    assert.equal(situacaoCriticas(e(), agora())?.segurar, true);
    // a marca do modelo venceu: a conta volta a contar
    e().semModelo = { [d]: { modelo: "fable", ate: agora() - 1 } };
    assert.equal(situacaoCriticas(e(), agora())?.segurar, false);
  });

  test("janela cheia cujo reset já passou conta como zerada", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 99);
    e().contas[b]!.janelas = [{ tipo: "five_hour", pct: 99, resetEm: agora() - 10 }];
    assert.equal(temFolga(e(), b, agora(), 75), true);
    assert.equal(situacaoCriticas(e(), agora())?.segurar, false);
  });

  test("conta sem nenhuma leitura não conta como folga", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 90);
    const b = contaEstacionada(m, "B", 10);
    e().contas[b]!.janelas = [];
    assert.equal(situacaoCriticas(e(), agora())?.segurar, true);
  });

  test("gatilho fora de 50 a 95 volta aos 75 de fábrica", async () => {
    m = await montar();
    ligar(20);
    await ativaEm(m, "A", 76);
    assert.deepEqual(situacaoCriticas(e(), agora()), { segurar: true, gatilho: 75 });
  });

  test("a nuvem liga e ajusta; valor inválido não muda o que estava", async () => {
    m = await montar();
    m.agente.aplicarConfig({ criticas: true, criticas_gatilho: 80 });
    assert.equal(e().config.criticas, true);
    assert.equal(e().config.criticasGatilho, 80);
    m.agente.aplicarConfig({ criticas: "sim", criticas_gatilho: 300 });
    assert.equal(e().config.criticas, true);
    assert.equal(e().config.criticasGatilho, 80);
    m.agente.aplicarConfig({ criticas: false });
    assert.equal(e().config.criticas, false);
  });
});

describe("sessões críticas: eventos e ponte", () => {
  test("começo e fim da espera viram evento, uma vez cada", async () => {
    m = await montar();
    ligar();
    await ativaEm(m, "A", 90);
    const b = contaEstacionada(m, "B", 50);
    m.agente.vigiarCriticas(agora());
    assert.equal(e().eventos.filter((x) => x.dados?.criticas).length, 0, "partida com folga: nada a dizer");
    e().contas[b]!.janelas = [{ tipo: "five_hour", pct: 80, resetEm: agora() + 3600 }];
    m.agente.vigiarCriticas(agora());
    m.agente.vigiarCriticas(agora());
    const segurando = e().eventos.filter((x) => x.dados?.criticas === "segurando");
    assert.equal(segurando.length, 1);
    assert.equal(segurando[0]!.tipo, "aviso");
    e().contas[b]!.janelas = [{ tipo: "five_hour", pct: 10, resetEm: agora() + 3600 }];
    m.agente.vigiarCriticas(agora());
    assert.equal(e().eventos.filter((x) => x.dados?.criticas === "liberadas").length, 1);
  });

  test("a ponte manda a situação às sessões só com a função ligada", async () => {
    m = await montar();
    await ativaEm(m, "A", 90);
    const p = m.agente.alvoPonte();
    assert.equal((p.ativa() as Record<string, unknown>).criticas, undefined);
    ligar();
    assert.deepEqual((p.ativa() as Record<string, unknown>).criticas, { segurar: true, gatilho: 75 });
  });

  test("marcar, ler e desmarcar pela ponte; sessão inválida é recusada", async () => {
    m = await montar();
    const p = m.agente.alvoPonte();
    assert.deepEqual((await p.critica({ sessao: "abc-123" })).corpo, { ok: true, critica: false });
    assert.deepEqual((await p.critica({ sessao: "abc-123", critica: true })).corpo, { ok: true, critica: true });
    assert.deepEqual((await p.critica({ sessao: "abc-123" })).corpo, { ok: true, critica: true });
    const lista = (await p.critica({})).corpo as { sessoes: { sessao: string }[] };
    assert.deepEqual(lista.sessoes.map((s) => s.sessao), ["abc-123"]);
    assert.deepEqual((await p.critica({ sessao: "abc-123", critica: false })).corpo, { ok: true, critica: false });
    assert.equal((await p.critica({ sessao: "../etc" })).status, 400);
  });

  test("sem nuvem, a linha de comando liga e muda o gatilho", async () => {
    m = await montar();
    const p = m.agente.alvoPonte();
    assert.equal((await p.critica({ ligada: true, gatilho: 80 })).status, 200);
    assert.equal(e().config.criticas, true);
    assert.equal(e().config.criticasGatilho, 80);
    assert.equal((await p.critica({ gatilho: 99 })).status, 400);
    assert.equal(e().config.criticasGatilho, 80);
  });

  test("marcas velhas saem; a lista tem teto", async () => {
    m = await montar();
    const t = agora();
    marcarCritica(e(), "velha", true, t - 31 * 24 * 3600);
    marcarCritica(e(), "nova", true, t);
    podarCriticas(e(), t);
    assert.deepEqual(Object.keys(e().sessoesCriticas!), ["nova"]);
    for (let i = 0; i < 520; i++) marcarCritica(e(), `s-${i}`, true, t + i);
    assert.equal(Object.keys(e().sessoesCriticas!).length, 500);
    assert.ok(e().sessoesCriticas!["s-519"]);
  });
});
