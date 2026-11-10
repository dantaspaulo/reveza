import { describe, expect, it } from "vitest"

import type { Computador, Conta } from "@/dados/tipos"
import { bloqueioDaConta, bloqueioUsar, computadoresParaUsar, podeUsarEmAlgum } from "./usar-agora"

const conta = (id: string, extra: Partial<Conta> = {}): Conta =>
  ({ id, email: `${id}@exemplo.com`, pausada: false, precisaLogin: false, janelas: [], ...extra }) as Conta
const pc = (id: string, contaId: string | null, extra: Partial<Computador> = {}): Computador =>
  ({
    id,
    nome: `PC ${id}`,
    sistema: "macos",
    revogado: false,
    atribuicao: contaId ? { contaId, motivo: "pedido pelo painel", decididoEm: "2026-11-06T12:00:00.000Z" } : null,
    ...extra,
  }) as Computador

describe("usar agora", () => {
  it("só os computadores ligados ao painel: sem os revogados e os que ainda não entraram", () => {
    const estado = { computadores: [pc("a", null), pc("b", null, { revogado: true }), pc("c", null, { sistema: "pendente" })] }
    expect(computadoresParaUsar(estado).map((q) => q.id)).toEqual(["a"])
  })

  it("pausada ou sem login não vai para computador nenhum; a pausa vem antes", () => {
    const estado = { computadores: [pc("a", null)] }
    expect(bloqueioDaConta(conta("x", { pausada: true, precisaLogin: true }))).toEqual({ motivo: "pausada" })
    expect(bloqueioDaConta(conta("x", { precisaLogin: true }))).toEqual({ motivo: "semLogin" })
    expect(bloqueioDaConta(conta("x"))).toBe(null)
    expect(bloqueioUsar(conta("x", { precisaLogin: true }), estado.computadores[0]!, estado)).toEqual({ motivo: "semLogin" })
  })

  it("a conta que o computador já usa, e a que está em outro computador, com o nome dele (a regra da nuvem)", () => {
    const a = pc("a", "x")
    const b = pc("b", null)
    const estado = { computadores: [a, b] }
    expect(bloqueioUsar(conta("x"), a, estado)).toEqual({ motivo: "jaUsa" })
    expect(bloqueioUsar(conta("x"), b, estado)).toEqual({ motivo: "ocupada", computador: "PC a" })
    expect(bloqueioUsar(conta("y"), b, estado)).toBe(null)
  })

  it("esgotada (100% numa janela da conta que ainda não renovou) não vai para computador nenhum; renovada, volta", () => {
    const agora = new Date("2026-11-09T17:00:00.000Z")
    const depois = "2026-11-11T03:00:00.000Z"
    const antes = "2026-11-09T16:00:00.000Z"
    const so = { computadores: [pc("a", null)] }
    const semana = conta("x", { janelas: [{ tipo: "seven_day", pct: 100, resetEm: depois }] as Conta["janelas"] })
    const cinco = conta("y", { janelas: [{ tipo: "five_hour", pct: 100, resetEm: depois }] as Conta["janelas"] })
    const renovada = conta("z", { janelas: [{ tipo: "five_hour", pct: 100, resetEm: antes }] as Conta["janelas"] })
    const fable = conta("w", { janelas: [{ tipo: "seven_day_fable", pct: 100, resetEm: depois }] as Conta["janelas"] })
    expect(bloqueioDaConta(semana, agora)).toEqual({ motivo: "esgotada" })
    expect(bloqueioDaConta(cinco, agora)).toEqual({ motivo: "esgotada" })
    expect(podeUsarEmAlgum(semana, so, agora), "o botão fica desativado").toBe(false)
    expect(bloqueioDaConta(renovada, agora), "a janela já renovou").toBe(null)
    expect(bloqueioDaConta(fable, agora), "a semana de um modelo não esgota a conta toda").toBe(null)
    expect(bloqueioDaConta(conta("v", { pausada: true, janelas: semana.janelas }), agora)).toEqual({ motivo: "pausada" })
  })

  it("o botão aparece quando há algum computador em que a conta entra agora", () => {
    const so = { computadores: [pc("a", "x")] }
    expect(podeUsarEmAlgum(conta("x"), so), "o único computador já usa a conta").toBe(false)
    expect(podeUsarEmAlgum(conta("y"), so)).toBe(true)
    expect(podeUsarEmAlgum(conta("y", { pausada: true }), so)).toBe(false)
    expect(podeUsarEmAlgum(conta("y"), { computadores: [pc("a", null, { revogado: true })] })).toBe(false)
    expect(podeUsarEmAlgum(conta("y"), { computadores: [] })).toBe(false)
  })
})
