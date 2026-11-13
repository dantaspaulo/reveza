// A conta da sessão (relato de um usuário, 22/10/2026): o app de desktop, com login próprio numa conta A, carregava o
// mod, e o uso dele era gravado na conta B, a em uso. O mod manda a conta que leu com a credencial da sessão; o agente só
// usa medida e limite da sessão que está na conta em uso.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ativaEm, contaEstacionada, montar, uuidDaOrg, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const e = () => m.agente.estado;
const tr = () => m.agente.trocador;
const conta = (letra: string) => ({ accountUuid: `acc-${letra}`, orgUuid: uuidDaOrg(letra) });
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
    assert.deepEqual(outra.corpo, { ok: true, outraConta: true, conta: "outra" });
    const mesma = await m.agente.alvoPonte().medida({ sessao: "cli", versao: e().versao, conta: conta("B"), janelas: [{ tipo: "five_hour", pct: 2 }] });
    assert.deepEqual(mesma.corpo, { ok: true, outraConta: false, conta: "ativa" });
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
    const b = await ativaEm(m, "B", 99);
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
    assert.equal(r.aguardarS, 35, "o mod espera a sessão reler o login antes de mandá-la continuar");
    assert.equal(cinco(b), 100, "a conta da sessão é que encheu");
  });
});

// Relato do Paulo (29/10/2026): depois da troca de contato para suelen, sessões com turnos longos seguiram na conta que
// saiu por 7 a 11 minutos (processos que sobraram de um editor fechado não releem o login), até ela bater 100%. A 0.10.3
// só reconhecia a conta que saiu nos 2 primeiros minutos: o limite delas virou "outra conta", e elas pararam sem voltar.
describe("sessão atrasada na troca", () => {
  async function trocadaHa(minutos: number) {
    m = await montar();
    const b = await ativaEm(m, "B", 95);
    const c = contaEstacionada(m, "C", 3);
    assert.ok((await tr().trocar(c, "teste")).ok);
    m.relogio.t += minutos * 60;
    return { b, c };
  }

  test("10 minutos depois da troca, o limite na conta que saiu: ela enche, a em uso não; a sessão entra na fila e volta em 35 s", async () => {
    const { b, c } = await trocadaHa(10);
    const r = await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.deepEqual(r.corpo, { ok: true, versao: e().versao, trocou: true, aguardarS: 35 });
    await m.agente.esperar();
    assert.equal(e().ativa, c, "não troca de novo");
    assert.equal(cinco(c), 3, "a conta em uso não ficou cheia");
    assert.equal(cinco(b), 100, "a conta da sessão ficou cheia");
    assert.equal(e().fila[0]!.sessao, "s1");
    assert.equal(e().fila[0]!.estado, "aguardando");
    assert.ok(e().eventos.some((ev) => ev.tipo === "limite" && ev.texto.includes("b@exemplo.com") && ev.texto.includes("c@exemplo.com")));
  });

  test("voltou e bateu de novo na mesma conta: espera mais; na terceira, a sessão não pegou a troca e o mod diz isso", async () => {
    await trocadaHa(10);
    const limite = () => m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal(((await limite()).corpo as Record<string, unknown>).aguardarS, 35);
    await m.agente.alvoPonte().fila("s1", "retomada");
    assert.equal(((await limite()).corpo as Record<string, unknown>).aguardarS, 120);
    await m.agente.alvoPonte().fila("s1", "retomada");
    const terceira = await limite();
    assert.deepEqual(terceira.corpo, { ok: true, versao: e().versao, outraConta: true, naoPegou: "b@exemplo.com" });
    assert.equal(e().fila.filter((f) => f.estado === "aguardando").length, 0, "não entra na fila de novo");
    assert.ok(e().eventos.some((ev) => ev.tipo === "aviso" && ev.texto.includes("não pegou a troca")));
    // a pessoa escreveu de novo e a sessão bateu de novo na mesma conta: não volta a insistir, nem a avisar outra vez
    assert.deepEqual((await limite()).corpo, { ok: true, versao: e().versao, outraConta: true, naoPegou: "b@exemplo.com" });
    assert.equal(e().eventos.filter((ev) => ev.texto.includes("não pegou a troca")).length, 1);
    // outra sessão na mesma conta começa do zero
    const outra = await m.agente.alvoPonte().limite({ sessao: "s2", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal((outra.corpo as Record<string, unknown>).aguardarS, 35);
  });

  test("uma troca nova no meio: a contagem da sessão recomeça", async () => {
    const { b } = await trocadaHa(10);
    const limite = () => tr().limiteDaSessao({ sessao: "s1", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B") });
    assert.equal(limite().aguardarS, 35);
    assert.equal(limite().aguardarS, 120);
    const d = contaEstacionada(m, "D", 1);
    assert.ok((await tr().trocar(d, "teste")).ok);
    m.relogio.t += 600;
    assert.equal(limite().aguardarS, 35);
    assert.equal(cinco(b), 100);
  });

  test("modelo recusado numa sessão atrasada: a conta dela fica sem o modelo, a em uso não", async () => {
    const { b, c } = await trocadaHa(10);
    const r = await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa", erro: "modelo", modelo: "Fable 5.1", versao: e().versao, conta: conta("B") });
    assert.deepEqual(r.corpo, { ok: true, versao: e().versao, trocou: true, aguardarS: 35 });
    assert.equal(e().semModelo?.[b]?.modelo, "Fable 5.1");
    assert.equal(e().semModelo?.[c], undefined);
    assert.equal(cinco(b), 95, "modelo recusado não enche a janela");
  });

  test("sessão de terminal atrasada: volta logo, num processo novo (que lê o login da conta em uso)", async () => {
    await trocadaHa(10);
    e().config.retomarHeadless = true;
    const sessao = "77777777-0000-4000-8000-000000000007";
    const dir = path.join(m.c.projetos, "-projeto");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), JSON.stringify({ type: "user", sessionId: sessao, cwd: m.c.base }) + "\n");
    // outra sessão de terminal esperando uma conta livre não volta junto
    const esperando = "66666666-0000-4000-8000-000000000006";
    fs.writeFileSync(path.join(dir, `${esperando}.jsonl`), JSON.stringify({ type: "user", sessionId: esperando, cwd: m.c.base }) + "\n");
    e().fila.unshift({ sessao: esperando, cwd: m.c.base, tipo: "headless", em: m.relogio.agora(), estado: "aguardando", conta: null });
    await m.agente.alvoPonte().limite({ sessao, cwd: "/tmp", tipo: "headless", versao: e().versao, conta: conta("B") });
    await m.agente.esperar();
    assert.deepEqual(m.cli.retomadas, [{ sessao, cwd: m.c.base }]);
    assert.equal(e().fila.find((f) => f.sessao === sessao)!.estado, "retomada");
    assert.equal(e().fila.find((f) => f.sessao === esperando)!.estado, "aguardando");
  });

  test("a medida da sessão atrasada não entra na conta em uso; o mod relê a conta dela logo, e o log diz qual é", async () => {
    const { c } = await trocadaHa(1);
    const medida = (sessao: string) =>
      m.agente.alvoPonte().medida({ sessao, versao: e().versao, conta: conta("B"), janelas: [{ tipo: "five_hour", pct: 97 }] });
    // no primeiro minuto é só a sessão que ainda não releu o login: o mod não mostra "outra conta"
    assert.deepEqual((await medida("s1")).corpo, { ok: true, outraConta: false, conta: "atrasada" });
    assert.equal(cinco(c), 3);
    m.relogio.t += 120;
    assert.deepEqual((await medida("s1")).corpo, { ok: true, outraConta: true, conta: "atrasada" });
    assert.equal(cinco(c), 3);
    assert.ok(m.log.linhas.some((l) => l.includes("está em b@exemplo.com, não na em uso (c@exemplo.com)")));
  });

  test("o app de desktop (login próprio) numa conta deste computador: avisa na hora, sem esperar nem fila", async () => {
    const { b } = await trocadaHa(10);
    for (const entrada of ["claude-desktop", "claude-desktop-3p", "local-agent"]) {
      const r = await m.agente.alvoPonte().limite({ sessao: `app-${entrada}`, cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B"), entrada });
      assert.deepEqual(r.corpo, { ok: true, versao: e().versao, outraConta: true });
    }
    const modelo = await m.agente.alvoPonte().limite({ sessao: "app", cwd: "/tmp", tipo: "interativa", erro: "modelo", modelo: "Fable 5.1", versao: e().versao, conta: conta("B"), entrada: "claude-desktop" });
    assert.equal((modelo.corpo as Record<string, unknown>).outraConta, true);
    assert.equal(e().fila.length, 0);
    assert.equal(cinco(b), 95);
    // do terminal ou do editor, a mesma conta é sessão atrasada
    const cli = await m.agente.alvoPonte().limite({ sessao: "cli", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("B"), entrada: "claude-vscode" });
    assert.equal((cli.corpo as Record<string, unknown>).aguardarS, 35);
  });

  test("a medida do app de desktop numa conta deste computador já sai como outra conta, mesmo logo depois da troca", async () => {
    await trocadaHa(1);
    const r = await m.agente.alvoPonte().medida({ sessao: "app", versao: e().versao, conta: conta("B"), entrada: "claude-desktop", janelas: [{ tipo: "five_hour", pct: 97 }] });
    assert.deepEqual(r.corpo, { ok: true, outraConta: true, conta: "outra" });
  });

  test("login de fora (conta que não é deste computador) segue como outra conta, sem fila nem espera", async () => {
    await trocadaHa(10);
    const r = await m.agente.alvoPonte().limite({ sessao: "app", cwd: "/tmp", tipo: "interativa", versao: e().versao, conta: conta("Z") });
    assert.deepEqual(r.corpo, { ok: true, versao: e().versao, outraConta: true });
    assert.equal(e().fila.length, 0);
  });
});
