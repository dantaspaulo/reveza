// A conta que não roda o modelo da sessão (relato do Paulo, 22/10/2026: o Fable 5.1 numa conta Team sem créditos de
// uso parou as sessões) e o formato novo da API de uso (a lista `limits`, com a semana de cada modelo).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { janelaDaConta, janelasDaResposta, tipoDoLimite } from "../src/anthropic.js";
import { candidata, pctEfetivo } from "../src/decisao.js";
import type { ContaLocal } from "../src/estado.js";
import { SEM_MODELO_S } from "../src/troca.js";
import { ativaEm, BancoFalso, contaEstacionada, montar, NuvemFalsa, type Montado } from "./falsos.js";

let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
});
const e = () => m!.agente.estado;

// a resposta de 22/10/2026 de uma conta Max 5x (contato@): semana nula nos campos antigos, só a lista nova
const MAX_SEM_SEMANA = {
  five_hour: { utilization: 95.0, resets_at: "2026-10-23T00:39:59.859513+00:00" },
  seven_day: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: "session", group: "session", percent: 95, severity: "critical", resets_at: "2026-10-23T00:39:59.859513+00:00", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 5, resets_at: "2026-10-25T13:59:59.859700+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
};
// a de uma Max 20x: semana nos dois formatos
const MAX_COM_SEMANA = {
  five_hour: { utilization: 0.0, resets_at: null },
  seven_day: { utilization: 95.0, resets_at: "2026-10-27T09:00:00.319123+00:00" },
  limits: [
    { kind: "session", percent: 0, resets_at: null, scope: null },
    { kind: "weekly_all", percent: 90, resets_at: "2026-10-27T09:00:00.319123+00:00", scope: null },
    { kind: "weekly_scoped", percent: 0, resets_at: "2026-10-27T09:00:00+00:00", scope: { model: { id: null, display_name: "Fable" } } },
  ],
};

describe("o formato novo da API de uso", () => {
  test("a semana do Fable vem da lista nova; a 5 horas dos campos antigos não se repete", () => {
    const j = janelasDaResposta(MAX_SEM_SEMANA);
    assert.deepEqual(j.map((x) => [x.tipo, x.pct]), [["five_hour", 95], ["seven_day_fable", 5]]);
    assert.equal(j[1]!.resetEm, Math.floor(Date.parse("2026-10-25T13:59:59.859Z") / 1000));
  });

  test("com o campo antigo da semana, ele vale (o weekly_all não sobrepõe); sem ele, a semana vem do weekly_all", () => {
    assert.deepEqual(janelasDaResposta(MAX_COM_SEMANA).map((x) => [x.tipo, x.pct]), [["five_hour", 0], ["seven_day", 95], ["seven_day_fable", 0]]);
    const soNova = { limits: MAX_COM_SEMANA.limits };
    assert.deepEqual(janelasDaResposta(soNova).map((x) => [x.tipo, x.pct]), [["five_hour", 0], ["seven_day", 90], ["seven_day_fable", 0]]);
  });

  test("modelo que o agente não conhece e item estranho ficam de fora; resposta antiga segue como antes", () => {
    assert.equal(tipoDoLimite({ kind: "weekly_scoped", scope: { model: { display_name: "Outro" } } }), null);
    assert.equal(tipoDoLimite({ kind: "monthly" }), null);
    assert.deepEqual(janelasDaResposta({ limits: [null, 7, [], { kind: "session", percent: "x" }] }).map((x) => [x.tipo, x.pct]), [["five_hour", null]]);
    assert.deepEqual(janelasDaResposta({ five_hour: { utilization: 12, resets_at: null } }).map((x) => x.tipo), ["five_hour"]);
  });

  test("a semana do Fable não entra no percentual que decide a troca", () => {
    const conta = { janelas: [{ tipo: "five_hour", pct: 12, resetEm: null }, { tipo: "seven_day_fable", pct: 99, resetEm: null }] } as unknown as ContaLocal;
    assert.equal(pctEfetivo(conta, 1_760_000_000), 12);
    assert.equal(janelaDaConta("seven_day_fable"), false);
    assert.equal(janelaDaConta("seven_day"), true);
  });
});

describe("a conta não roda o modelo da sessão", () => {
  test("sem nuvem: marca a conta fora da escolha por 6 horas, troca na hora e põe a sessão na fila; a janela não vira 100%", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 20);
    const b = contaEstacionada(m, "B", 30);
    const r = await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", erro: "modelo", modelo: "claude-fable-5-1", versao: e().versao });
    assert.equal(r.status, 200);
    await m.agente.esperar();
    assert.equal(e().ativa, b, "trocou para a outra mesmo com a conta de antes abaixo do limite");
    assert.deepEqual(e().semModelo?.[a], { modelo: "claude-fable-5-1", ate: m.relogio.agora() + SEM_MODELO_S });
    assert.equal(e().contas[a]!.janelas.find((j) => j.tipo === "five_hour")!.pct, 20, "para quem usa outro modelo a conta segue boa");
    assert.equal(e().fila[0]!.sessao, "s1");
    assert.ok(e().eventos.some((x) => /não roda o claude-fable-5-1 sem créditos de uso/.test(x.texto)));
  });

  test("enquanto a marca vale, a conta não é escolhida; depois de 6 horas, volta", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 5);
    const b = contaEstacionada(m, "B", 30);
    await m.agente.alvoPonte().limite({ sessao: "s1", erro: "modelo", modelo: "Fable 5.1", versao: e().versao });
    await m.agente.esperar();
    assert.equal(e().ativa, b);
    // a conta A (5%) seria a melhor candidata, mas está marcada
    assert.equal(candidata(e(), m.relogio.agora()), null);
    e().semModelo![a]!.ate = m.relogio.agora() - 1;
    // leitura velha não conta: renova a de A
    e().contas[a]!.lidoEm = m.relogio.agora();
    assert.equal(candidata(e(), m.relogio.agora()), a);
  });

  test("aviso atrasado (a troca já aconteceu) não marca nada", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 20);
    const b = contaEstacionada(m, "B", 30);
    const v0 = e().versao;
    await m.agente.trocador.trocar(b, "teste");
    const r = m.agente.trocador.modeloDaSessao({ sessao: "s2", erro: "modelo", modelo: "Fable 5.1", versao: v0 });
    assert.equal(r.trocou, true);
    assert.equal(e().semModelo?.[a], undefined);
  });

  test("com nuvem: avisa a nuvem (agente_sem_modelo) com a conta, o modelo e a sessão, e busca em seguida", async () => {
    const banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    banco.agora = () => m!.relogio.agora();
    const a = await ativaEm(m, "A", 50);
    await m.agente.esperar();
    await m.agente.busca();
    const olas = banco.chamadas.filter((c) => c.fn === "ola").length;
    await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", erro: "modelo", modelo: "claude-fable-5-1\n" });
    await m.agente.esperar();
    const [chamada] = banco.chamadas.filter((c) => c.fn === "semModelo");
    assert.deepEqual(chamada!.args, [e().contas[a]!.contaId, "claude-fable-5-1", "s1"], "sem a quebra de linha");
    assert.equal(banco.chamadas.filter((c) => c.fn === "limite").length, 0, "não é o limite comum");
    assert.ok(banco.chamadas.filter((c) => c.fn === "ola").length > olas);
  });

  test("o limite comum segue igual (marca a 5 horas e chama agente_limite)", async () => {
    const banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    banco.agora = () => m!.relogio.agora();
    await ativaEm(m, "A", 50);
    await m.agente.esperar();
    await m.agente.busca();
    await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", erro: "rate_limit" });
    await m.agente.esperar();
    assert.equal(banco.chamadas.filter((c) => c.fn === "limite").length, 1);
    assert.equal(banco.chamadas.filter((c) => c.fn === "semModelo").length, 0);
  });
});
