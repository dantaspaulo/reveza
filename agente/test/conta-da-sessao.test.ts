// A conta da sessão (relato de um usuário, 22/10/2026): o app de desktop, com login próprio numa conta A, carregava o
// mod, e o uso dele era gravado na conta B, a em uso. O mod manda a conta que leu com a credencial da sessão; o agente só
// usa medida e limite da sessão que está na conta em uso.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ativaEm, contaEstacionada, montar, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const e = () => m.agente.estado;
const tr = () => m.agente.trocador;
const conta = (letra: string) => ({ accountUuid: `acc-${letra}`, orgUuid: `org-${letra}` });
const cinco = (id: string) => e().contas[id]!.janelas.find((j) => j.tipo === "five_hour")!.pct;

describe("a conta da sessão", () => {
  test("a medida da sessão na conta em uso entra; a de outra conta não mexe na conta em uso", async () => {
    m = await montar();
    const b = await ativaEm(m, "B", 1);
    contaEstacionada(m, "A", 49);
    assert.equal(tr().medidaDaSessao({ versao: e().versao, conta: conta("A"), janelas: [{ tipo: "five_hour", pct: 48, resetEm: null }] }), false);
    assert.equal(cinco(b), 1, "o uso da conta A não vai para a B");
    assert.equal(tr().medidaDaSessao({ versao: e().versao, conta: conta("B"), janelas: [{ tipo: "five_hour", pct: 2, resetEm: null }] }), true);
    assert.equal(cinco(b), 2);
  });

  test("sessão fora do login trocado (token no ambiente, chave de API) também não mede a conta em uso", async () => {
    m = await montar();
    const b = await ativaEm(m, "B", 1);
    assert.equal(tr().medidaDaSessao({ versao: e().versao, conta: { fora: true }, janelas: [{ tipo: "five_hour", pct: 70, resetEm: null }] }), false);
    assert.equal(cinco(b), 1);
  });

  test("sem a conta (mod antigo, perfil fora do ar): segue como antes", async () => {
    m = await montar();
    const b = await ativaEm(m, "B", 1);
    assert.equal(tr().medidaDaSessao({ versao: e().versao, janelas: [{ tipo: "five_hour", pct: 30, resetEm: null }] }), true);
    assert.equal(cinco(b), 30);
    // conta pela metade não decide nada
    assert.equal(tr().medidaDaSessao({ versao: e().versao, conta: { accountUuid: "acc-A" }, janelas: [{ tipo: "five_hour", pct: 31, resetEm: null }] }), true);
    assert.equal(cinco(b), 31);
  });

  test("a ponte diz ao mod que a sessão está noutra conta", async () => {
    m = await montar();
    await ativaEm(m, "B", 1);
    const outra = await m.agente.alvoPonte().medida({ sessao: "app", versao: e().versao, conta: conta("A"), janelas: [{ tipo: "five_hour", pct: 48 }] });
    assert.deepEqual(outra.corpo, { ok: true, outraConta: true });
    const mesma = await m.agente.alvoPonte().medida({ sessao: "cli", versao: e().versao, conta: conta("B"), janelas: [{ tipo: "five_hour", pct: 2 }] });
    assert.deepEqual(mesma.corpo, { ok: true, outraConta: false });
    assert.equal(m.log.linhas.filter((l) => l.includes("usa outra conta")).length, 1, "uma linha no log por sessão");
    await m.agente.alvoPonte().medida({ sessao: "app", versao: e().versao, conta: conta("A"), janelas: [{ tipo: "five_hour", pct: 49 }] });
    assert.equal(m.log.linhas.filter((l) => l.includes("usa outra conta")).length, 1);
  });

  test("o limite de outra conta não enche a conta em uso, não troca e não põe a sessão na fila", async () => {
    m = await montar();
    const b = await ativaEm(m, "B", 10);
    contaEstacionada(m, "C", 3);
    const v = e().versao;
    const r = await m.agente.alvoPonte().limite({ sessao: "app", cwd: "/tmp", tipo: "interativa", versao: v, conta: conta("A") });
    assert.deepEqual(r.corpo, { ok: true, versao: v, outraConta: true });
    await m.agente.esperar();
    assert.equal(e().ativa, b, "não trocou");
    assert.equal(cinco(b), 10, "a conta em uso não ficou cheia");
    assert.equal(e().fila.length, 0);
  });

  test("conta sem o modelo noutra sessão: a conta em uso não fica marcada sem o modelo", async () => {
    m = await montar();
    const b = await ativaEm(m, "B", 10);
    const r = await m.agente.alvoPonte().limite({ sessao: "app", cwd: "/tmp", tipo: "interativa", erro: "modelo", modelo: "Fable 5.1", versao: e().versao, conta: conta("A") });
    assert.equal((r.corpo as Record<string, unknown>).outraConta, true);
    assert.equal(e().semModelo?.[b], undefined);
    assert.equal(e().fila.length, 0);
  });

  test("o limite da sessão na conta em uso segue como sempre (enche, troca e entra na fila)", async () => {
    m = await montar();
    await ativaEm(m, "B", 80);
    const c = contaEstacionada(m, "C", 3);
    e().trocadaEm = m.relogio.agora();
    const r = await m.agente.alvoPonte().limite({ sessao: "cli", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal((r.corpo as Record<string, unknown>).outraConta, undefined);
    await m.agente.esperar();
    assert.equal(e().ativa, c);
    assert.equal(e().fila[0]!.sessao, "cli");
  });

  test("sessão ainda na conta que acabou de sair: a troca já aconteceu, ela entra na fila e a conta nova não enche", async () => {
    m = await montar();
    await ativaEm(m, "B", 99);
    const c = contaEstacionada(m, "C", 3);
    const r0 = await tr().trocar(c, "teste");
    assert.ok(r0.ok);
    // o mod já leu a versão nova, mas a sessão ainda não releu o login: a conta dela é a B
    const r = tr().limiteDaSessao({ sessao: "cli", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal(r.trocou, true);
    assert.equal(r.outraConta, undefined);
    assert.equal(e().ativa, c);
    assert.equal(cinco(c), 3, "a conta nova não ficou cheia");
    assert.equal(e().fila[0]!.sessao, "cli");
    // passados 2 minutos, a mesma conta já não é "a que acabou de sair": é outra conta
    m.relogio.t += 121;
    const depois = tr().limiteDaSessao({ sessao: "cli2", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal(depois.outraConta, true);
  });
});
