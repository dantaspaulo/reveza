// Decisão local (sem nuvem) e modos de troca: a mesma bateria do roteador que já roda.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { decidir, estadoDaConta } from "../src/decisao.js";
import { LEITURA_VALIDA_S } from "../src/config.js";
import { ativaEm, contaEstacionada, montar, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const agora = () => m.relogio.agora();
const e = () => m.agente.estado;

describe("decisão", () => {
  test("abaixo do aviso: nada", async () => {
    m = await montar();
    await ativaEm(m, "A", 50);
    contaEstacionada(m, "B");
    assert.equal(decidir(e(), agora())[0], "nada");
  });

  test("no aviso escolhe a mais livre", async () => {
    m = await montar();
    await ativaEm(m, "A", 91);
    contaEstacionada(m, "B", 40);
    const c = contaEstacionada(m, "C", 5);
    assert.deepEqual(decidir(e(), agora()), ["aviso", c]);
  });

  test("na troca, troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 40);
    assert.deepEqual(decidir(e(), agora()), ["trocar", b]);
  });

  test("sem livre", async () => {
    m = await montar();
    await ativaEm(m, "A", 97);
    contaEstacionada(m, "B", 96);
    assert.equal(decidir(e(), agora())[0], "sem_livre");
  });

  test("espera entre trocas, e o limite fura a espera", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 1);
    e().trocadaEm = agora();
    assert.deepEqual(decidir(e(), agora()), ["aviso", b]);
    assert.deepEqual(decidir(e(), agora(), true), ["trocar", b]);
  });

  test("troca automática desligada não troca nem no limite", async () => {
    m = await montar();
    await ativaEm(m, "A", 100);
    contaEstacionada(m, "B", 1);
    e().config.auto = false;
    assert.equal(decidir(e(), agora(), true)[0], "nada");
  });

  test("pausada, precisa de login e leitura velha ficam fora", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 1);
    const c = contaEstacionada(m, "C", 1);
    const d = contaEstacionada(m, "D", 1);
    e().contas[b]!.pausada = true;
    e().contas[c]!.precisaLogin = true;
    e().contas[d]!.lidoEm = agora() - LEITURA_VALIDA_S - 10;
    assert.equal(decidir(e(), agora())[0], "sem_livre");
  });

  test("semana do modelo maior esgotada tira a conta da fila", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    e().contas[b]!.janelas.push({ tipo: "seven_day_opus", pct: 100, resetEm: agora() + 9999 });
    assert.equal(decidir(e(), agora())[0], "sem_livre");
  });

  // relato do Paulo (06/11/2026): com as outras acima do aviso, a conta em uso ficou 47 minutos em 100%
  test("no gatilho, sem livre abaixo do aviso: vai para a com mais folga abaixo do gatilho", async () => {
    m = await montar();
    await ativaEm(m, "A", 95);
    contaEstacionada(m, "B", 93);
    const c = contaEstacionada(m, "C", 91);
    contaEstacionada(m, "D", 96);
    assert.deepEqual(decidir(e(), agora()), ["trocar", c]);
  });

  test("em uso cheia: vai para a com mais folga abaixo de 100%, sem esperar a espera entre trocas", async () => {
    m = await montar();
    await ativaEm(m, "A", 100);
    const b = contaEstacionada(m, "B", 97);
    contaEstacionada(m, "C", 98);
    contaEstacionada(m, "D", 100);
    e().trocadaEm = agora();
    assert.deepEqual(decidir(e(), agora()), ["trocar", b]);
  });

  test("abaixo de 100% e as outras com mais uso: fica (não troca à toa)", async () => {
    m = await montar();
    await ativaEm(m, "A", 96);
    contaEstacionada(m, "B", 98);
    assert.equal(decidir(e(), agora())[0], "sem_livre");
  });

  test("conta em uso pausada sai na hora, mesmo com a troca automática desligada", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 30);
    const b = contaEstacionada(m, "B", 92);
    e().config.auto = false;
    e().contas[a]!.pausada = true;
    assert.deepEqual(decidir(e(), agora()), ["trocar", b]);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.match(e().eventos[0]!.texto, /a conta em uso foi pausada/);
  });

  test("conta em uso pausada e nenhuma outra: avisa que não há livre", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 30);
    contaEstacionada(m, "B", 100);
    e().contas[a]!.pausada = true;
    assert.equal(decidir(e(), agora())[0], "sem_livre");
  });

  test("reset que passou conta como zerada (mesmo com leitura velha)", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 100);
    e().contas[b]!.janelas[0]!.resetEm = agora() - 5;
    e().contas[b]!.lidoEm = agora() - 99999;
    assert.deepEqual(decidir(e(), agora()), ["trocar", b]);
  });
});

describe("modos", () => {
  test("modo limite não troca no limiar, só no 100", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 97);
    const b = contaEstacionada(m, "B", 3);
    e().config.modo = "limite";
    assert.equal(decidir(e(), agora())[0], "aviso");
    e().contas[a]!.janelas[0]!.pct = 100;
    assert.deepEqual(decidir(e(), agora()), ["trocar", b]);
  });

  test("modo limite troca quando a sessão é barrada", async () => {
    m = await montar();
    await ativaEm(m, "A", 60);
    const b = contaEstacionada(m, "B", 3);
    e().config.modo = "limite";
    assert.deepEqual(decidir(e(), agora(), true), ["trocar", b]);
  });

  test("modo limite: conta em 97% não aparece esgotada", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B", 97);
    e().config.modo = "limite";
    assert.equal(estadoDaConta(e(), b, agora()), "livre");
  });

  test("rodízio na hora troca para uma livre", async () => {
    m = await montar();
    await ativaEm(m, "A", 20);
    const b = contaEstacionada(m, "B", 3);
    contaEstacionada(m, "C", 95);
    e().config.modo = "rodizio";
    e().proximoRodizioEm = agora() - 1;
    assert.deepEqual(decidir(e(), agora(), false, (xs) => xs[xs.length - 1]!), ["rodizio", b]);
  });

  test("rodízio antes da hora não troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 20);
    contaEstacionada(m, "B", 3);
    e().config.modo = "rodizio";
    e().proximoRodizioEm = agora() + 600;
    assert.equal(decidir(e(), agora())[0], "nada");
  });

  test("rodízio pela menos usada", async () => {
    m = await montar();
    await ativaEm(m, "A", 20);
    contaEstacionada(m, "B", 40);
    const c = contaEstacionada(m, "C", 5);
    e().config.modo = "rodizio";
    e().config.rodizio = { minutos: 60, ordem: "menor_uso" };
    e().proximoRodizioEm = agora() - 1;
    assert.deepEqual(decidir(e(), agora(), false, (xs) => xs[0]!), ["rodizio", c]);
  });

  test("rodízio sem livre reagenda", async () => {
    m = await montar();
    await ativaEm(m, "A", 20);
    contaEstacionada(m, "B", 93);
    e().config.modo = "rodizio";
    e().proximoRodizioEm = agora() - 1;
    assert.equal(decidir(e(), agora())[0], "reagendar");
    await m.agente.agir();
    assert.ok(e().proximoRodizioEm! > agora());
  });

  test("rodízio: agir troca e agenda o próximo entre 75% e 125%", async () => {
    m = await montar();
    await ativaEm(m, "A", 20);
    const b = contaEstacionada(m, "B", 3);
    e().config.modo = "rodizio";
    e().config.rodizio = { minutos: 60, ordem: "menor_uso" };
    e().proximoRodizioEm = agora() - 1;
    await m.agente.agir();
    assert.equal(e().ativa, b);
    const falta = e().proximoRodizioEm! - agora();
    assert.ok(falta >= 45 * 60 && falta <= 75 * 60, String(falta));
  });

  test("agir troca sozinho aos 95% e registra o evento", async () => {
    m = await montar();
    await ativaEm(m, "A", 95);
    const b = contaEstacionada(m, "B", 3);
    await m.agente.agir();
    assert.equal(e().ativa, b);
    assert.equal(e().eventos[0]!.tipo, "troca");
  });

  test("com nuvem, a decisão local não roda (quem decide é a nuvem)", async () => {
    const { BancoFalso, NuvemFalsa } = await import("./falsos.js");
    m = await montar({ nuvem: new NuvemFalsa(new BancoFalso()) });
    const a = await ativaEm(m, "A", 99);
    contaEstacionada(m, "B", 3);
    await m.agente.esperar();
    await m.agente.agir();
    assert.equal(e().ativa, a);
  });
});

describe("histórico e ritmo", () => {
  test("um ponto a cada 5 min e só 24 h", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 20);
    const t0 = agora();
    const tr = m.agente.trocador;
    tr.registrarHistorico(t0);
    tr.registrarHistorico(t0 + 60);
    assert.equal(e().historico[a]!.length, 1);
    e().contas[a]!.lidoEm = t0 + 400;
    tr.registrarHistorico(t0 + 400);
    assert.equal(e().historico[a]!.length, 2);
    e().contas[a]!.lidoEm = t0 + 90000;
    e().contas[a]!.janelas[0]!.resetEm = t0 + 99999;
    tr.registrarHistorico(t0 + 90000);
    assert.deepEqual(e().historico[a]!.map((p) => p.t), [t0 + 90000]);
  });

  test("ritmo e previsão", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 50);
    const t = agora();
    e().historico[a] = [{ t: t - 1800, p5: 40, p7: null }];
    e().contas[a]!.lidoEm = t;
    const r = m.agente.trocador.ritmo(t);
    assert.equal(r.pctPorHora, 20);
    assert.equal(r.estimativaTrocaEm, t + Math.floor((45 / 20) * 3600));
  });

  test("ritmo ignora o que veio antes do reset", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    const t = agora();
    e().historico[a] = [
      { t: t - 3000, p5: 90, p7: null },
      { t: t - 1800, p5: 4, p7: null },
    ];
    e().contas[a]!.lidoEm = t;
    assert.equal(m.agente.trocador.ritmo(t).pctPorHora, 12);
  });
});

describe("empate", () => {
  test("contas com o mesmo uso: a próxima é a do e-mail em ordem alfabética, não a do id local", async () => {
    m = await montar();
    await ativaEm(m, "A", 50);
    const z = contaEstacionada(m, "Z", 0);
    const c = contaEstacionada(m, "C", 0);
    // ids locais sorteados: força o de Z a vir antes na ordem do id
    const ez = e().contas[z]!;
    const ec = e().contas[c]!;
    delete e().contas[z];
    delete e().contas[c];
    e().contas["0000"] = { ...ez, id: "0000" };
    e().contas["ffff"] = { ...ec, id: "ffff" };
    const { candidata } = await import("../src/decisao.js");
    assert.equal(candidata(e(), agora()), "ffff", "c@exemplo.com vem antes de z@exemplo.com");
  });

  test("na troca, a da mesma organização com folga vem antes; quase cheia, não", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 96);
    const outra = contaEstacionada(m, "B", 0);
    const colega = contaEstacionada(m, "C", 40);
    e().contas[a]!.org = "Alfa";
    e().contas[outra]!.org = "Beta";
    e().contas[colega]!.org = "Alfa";
    assert.deepEqual(decidir(e(), agora()), ["trocar", colega]);
    e().contas[colega]!.janelas = [{ tipo: "five_hour", pct: 70, resetEm: agora() + 3600 }];
    assert.deepEqual(decidir(e(), agora()), ["trocar", outra], "70% fica a menos de 30 pontos do gatilho de 95%");
  });
});
