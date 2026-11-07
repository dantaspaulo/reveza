// A folga das contas e a faixa da visão geral (0.13.0, pedido do Paulo: "aviso de que já está chegando no limite"),
// a mesma conta do alerta da nuvem (rvz_folga_contas, 0032).
import { describe, expect, it } from "vitest"

import { faixasDeAlerta, folgaAcabando, folgaDasContas, soCriticas } from "./derivados"
import type { Conta, Instantaneo, Janela } from "./tipos"

const AGORA = new Date("2026-11-06T20:00:00.000Z")
const daqui = (h: number) => new Date(AGORA.getTime() + h * 3_600_000).toISOString()

function conta(id: string, pct5: number | null, extra: Partial<Conta> = {}, janelas: Janela[] = []): Conta {
  return {
    id, email: `${id}@exemplo.com`, organizacao: null, plano: "team", nivel: "5x", cor: 0, prioridade: 100, reserva: false,
    pausada: false, agenda: [], tetoSemana: null, modelo: null, precisaLogin: false, saiEm: null, criadaEm: daqui(-500),
    janelas: [...(pct5 === null ? [] : [{ tipo: "five_hour" as const, pct: pct5, resetEm: daqui(3) }]), ...janelas],
    lidoEm: daqui(0), fonte: "api", loginExpiraEm: null, posse: null, semModelo: [], ...extra,
  }
}

describe("folgaDasContas", () => {
  it("com uma só abaixo do aviso: acabando, e a próxima é a que renova primeiro tudo o que a segura", () => {
    const quase = conta("quase", 88, {}, [{ tipo: "seven_day", pct: 92, resetEm: daqui(30) }])
    const cheia = conta("cheia", 97)
    const f = folgaDasContas([conta("folga", 20), quase, cheia], 85, AGORA)
    expect(f.comFolga.map((c) => c.id)).toEqual(["folga"])
    expect(folgaAcabando(f)).toBe(true)
    // a "quase" só libera quando a semana também renova (30 h); a "cheia", em 3 h
    expect(f.proxima?.conta.id).toBe("cheia")
    expect(f.proxima?.em.toISOString()).toBe(daqui(3))
  })
  it("pausada, sem login e saindo não estão em atividade; sem leitura conta como com folga; o teto da semana segura", () => {
    const contas = [
      conta("pausada", 10, { pausada: true }),
      conta("semLogin", 10, { precisaLogin: true }),
      conta("saindo", 10, { saiEm: daqui(0.1) }),
      conta("semLeitura", null),
      conta("teto", 10, { tetoSemana: 80 }, [{ tipo: "seven_day", pct: 82, resetEm: daqui(40) }]),
    ]
    const f = folgaDasContas(contas, 85, AGORA)
    expect(f.ativas.map((c) => c.id)).toEqual(["semLeitura", "teto"])
    expect(f.comFolga.map((c) => c.id)).toEqual(["semLeitura"])
    expect(f.proxima?.conta.id).toBe("teto")
    expect(folgaAcabando(folgaDasContas([conta("um", 10), conta("dois", 30), conta("tres", 99)], 85, AGORA))).toBe(false)
    expect(folgaAcabando(folgaDasContas([conta("so", 99)], 85, AGORA)), "uma só em atividade não avisa").toBe(false)
  })
  it("a faixa da visão geral: uma conta com folga ou nenhuma, com a próxima que libera", () => {
    const e = (contas: Conta[]) =>
      ({ contas, computadores: [], config: { aviso: 85, troca: 90, auto: true, modo: "limiar" } }) as unknown as Instantaneo
    const uma = faixasDeAlerta(e([conta("folga", 20), conta("cheia", 97)]), AGORA).find((x) => x.tipo === "folga_acabando")
    expect(uma).toMatchObject({ nivel: "atencao", contaId: "folga", proximaId: "cheia", liberaEm: daqui(3) })
    const nenhuma = faixasDeAlerta(e([conta("a", 90), conta("b", 97)]), AGORA)
    expect(nenhuma.map((x) => x.tipo)).toContain("sem_folga")
    expect(faixasDeAlerta(e([conta("a", 10), conta("b", 20)]), AGORA).map((x) => x.tipo)).not.toContain("folga_acabando")
  })
})

// Sessões críticas (0.15.0): a mesma conta do agente (criticas.ts).
describe("soCriticas", () => {
  const cfg = (criticas: boolean, criticasGatilho = 75) =>
    ({ aviso: 85, troca: 90, auto: true, modo: "limiar", criticas, criticasGatilho }) as unknown as Instantaneo["config"]
  it("desligada não segura; ligada, segura quando nenhuma conta em atividade está abaixo do gatilho", () => {
    const contas = [conta("a", 80), conta("b", 99), conta("pausada", 10, { pausada: true })]
    expect(soCriticas(contas, cfg(false), AGORA)).toBe(false)
    expect(soCriticas(contas, cfg(true), AGORA)).toBe(true)
    expect(soCriticas([...contas, conta("folga", 74)], cfg(true), AGORA)).toBe(false)
    expect(soCriticas(contas, cfg(true, 85), AGORA), "com o gatilho em 85, a de 80% ainda tem folga").toBe(false)
  })
  it("conta sem leitura não conta como folga; sem conta nenhuma, não segura", () => {
    expect(soCriticas([conta("a", 90), conta("semLeitura", null)], cfg(true), AGORA)).toBe(true)
    expect(soCriticas([], cfg(true), AGORA)).toBe(false)
  })
  it("a faixa da visão geral troca a folga acabando pela de só as críticas", () => {
    const e = { contas: [conta("a", 90), conta("b", 97)], computadores: [], config: cfg(true) } as unknown as Instantaneo
    const tipos = faixasDeAlerta(e, AGORA).map((x) => x.tipo)
    expect(tipos).toContain("so_criticas")
    expect(tipos).not.toContain("sem_folga")
  })
})
