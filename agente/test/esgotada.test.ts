// Parte C da 0.21.0: a conta esgotada fica em espera. Esgotada é o que o painel já usa: uma janela que decide em 100%
// ou mais, que ainda não renovou. Nenhuma troca à mão e nenhuma sessão nova de projeto vão para ela; quem já está nela
// fica até a troca (a regra não derruba sessão aberta).

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { esgotada } from "../src/decisao.js";
import type { ContaLocal } from "../src/estado.js";
import { lerChave } from "../src/ligar.js";
import { EMPRESAS_LER_S } from "../src/trilhas.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, montar, NuvemFalsa, type Montado } from "./falsos.js";

const E1 = "11111111-2222-4333-8444-555555555555";
let m: Montado;
let banco: BancoFalso;
afterEach(() => m?.limpar());

describe("conta esgotada (parte C da 0.21.0)", () => {
  test("esgotada: uma janela que decide em 100% sem ter renovado; não a renovada, a abaixo de 100 nem a que não decide", () => {
    const t = 1_000_000;
    const conta = (janelas: ContaLocal["janelas"] | undefined) => ({ janelas }) as ContaLocal;
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: 100, resetEm: t + 60 }]), t), true);
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: 20, resetEm: t + 60 }, { tipo: "seven_day", pct: 100.4, resetEm: t + 60 }]), t), true);
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: 100, resetEm: null }]), t), true, "sem saber quando renova, segue esgotada (como o painel)");
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: 100, resetEm: t }]), t), false, "renovou agora");
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: 99.9, resetEm: t + 60 }]), t), false);
    assert.equal(esgotada(conta([{ tipo: "seven_day_fable", pct: 100, resetEm: t + 60 }]), t), false, "a semana de um modelo não decide");
    assert.equal(esgotada(conta([{ tipo: "five_hour", pct: null, resetEm: t + 60 }]), t), false);
    assert.equal(esgotada(conta([]), t), false);
    assert.equal(esgotada(conta(undefined), t), false, "sem leitura não é esgotada: a falta de leitura tem regra própria");
  });

  test("reveza trocar (sem nuvem) não leva a conta em uso para uma esgotada; renovada, troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    const b = contaEstacionada(m, "B", 100);
    const r = await m.agente.alvoPonte().trocar({ email: "b@exemplo.com" });
    assert.equal(r.status, 409);
    assert.match(String((r.corpo as { erro?: unknown }).erro), /conta esgotada: espere a janela renovar/);
    assert.equal(m.cred.token("principal"), "A1", "a troca não aconteceu");
    m.agente.estado.contas[b]!.janelas = [{ tipo: "five_hour", pct: 100, resetEm: m.relogio.agora() - 1 }];
    const ok = await m.agente.alvoPonte().trocar({ email: "b@exemplo.com" });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(m.cred.token("principal"), "B1");
  });

  test("reveza trocar --local com a nuvem também recusa a esgotada", async () => {
    banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    banco.agora = () => m.relogio.agora();
    await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    contaEstacionada(m, "B", 100);
    const r = await m.agente.alvoPonte().trocar({ email: "b@exemplo.com", local: true });
    assert.equal(r.status, 409);
    assert.match(String((r.corpo as { erro?: unknown }).erro), /conta esgotada/);
    assert.equal(m.cred.token("principal"), "A1");
  });
});

describe("sessão de projeto e a conta em uso esgotada (parte C da 0.21.0)", () => {
  async function semear(letra: string, versao = 2) {
    const c = banco.conta(`${letra.toLowerCase()}@exemplo.com`);
    const k = (await lerChave(m.guarda))!;
    const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, versao), blob(letra + "1", true, 3600, m.relogio.agora()));
    c.cofre = { cifrado, nonce, versao, expira_em: null };
    return c.id;
  }

  /** Projeto estrito E1 sem conta livre na trilha, com a conta A (a em uso aqui) entre as dele. */
  async function projetoNaPrincipal(): Promise<{ a: string; cwd: string }> {
    banco = new BancoFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
    banco.agora = () => m.relogio.agora();
    const a = await ativaEm(m, "A", 10);
    await m.agente.esperar();
    await m.agente.busca();
    const b = await semear("B");
    banco.empresas = [{ id: E1, nome: "Empresa Um" }];
    banco.regras = [{ tipo: "pasta", padrao: "~/proj-e1", empresa: E1 }];
    banco.trilhas.set("pc-1", new Map([[E1, { conta: b, versao: 1, motivo: "conta marcada para a empresa" }]]));
    await m.agente.busca();
    const cwd = path.join(m.c.home, "proj-e1", "sub");
    fs.mkdirSync(cwd, { recursive: true });
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [m.agente.estado.contas[a]!.contaId!] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    return { a, cwd };
  }

  const pedir = async (cwd: string, deNovo = false) =>
    (await m.agente.alvoPonte().trilha!({ cwd, pid: process.pid, ...(deNovo ? { deNovo: true } : {}) })).corpo as {
      ok: boolean;
      trilha: unknown;
      bloqueio?: string;
      certa?: boolean;
    };

  test("a conta em uso esgotada não recebe a sessão nova do projeto: ela espera; renovada, abre nela", async () => {
    const { a, cwd } = await projetoNaPrincipal();
    const conta = m.agente.estado.contas[a]!;
    conta.janelas = [{ tipo: "five_hour", pct: 100, resetEm: m.relogio.agora() + 3600 }];
    conta.lidoEm = m.relogio.agora();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "1ª pergunta: espera, em vez de abrir na conta esgotada");
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal ?? [], [], "nada anotado: a sessão não segura a conta em uso");
    const r = await pedir(cwd, true);
    assert.match(r.bloqueio ?? "", /Empresa Um/, "pergunta de novo: segue esperando");
    assert.equal(r.certa, undefined);
    conta.janelas = [{ tipo: "five_hour", pct: 100, resetEm: m.relogio.agora() - 1 }];
    assert.deepEqual(await pedir(cwd, true), { ok: true, trilha: null, certa: true }, "a janela renovou: abre na conta em uso");
  });

  test("quem já está na conta em uso segue segurando quando ela esgota (a sessão aberta não muda de conta)", async () => {
    const { a, cwd } = await projetoNaPrincipal();
    assert.deepEqual(await pedir(cwd), { ok: true, trilha: null });
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid]);
    const conta = m.agente.estado.contas[a]!;
    conta.janelas = [{ tipo: "five_hour", pct: 100, resetEm: m.relogio.agora() + 3600 }];
    assert.equal(m.agente.trilhas!.segurandoPrincipal(), true, "a trava da conta em uso continua");
    assert.deepEqual(await m.agente.trilhas!.segurarPrincipal(), [E1]);
  });
});
