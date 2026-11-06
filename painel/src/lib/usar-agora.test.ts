import { describe, expect, it } from "vitest"

import type { Computador, Conta } from "@/dados/tipos"
import { bloqueioDaConta, bloqueioUsar, computadoresParaUsar, podeUsarEmAlgum } from "./usar-agora"

const conta = (id: string, extra: Partial<Conta> = {}): Conta =>
  ({ id, email: `${id}@exemplo.com`, pausada: false, precisaLogin: false, ...extra }) as Conta
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

  it("o botão aparece quando há algum computador em que a conta entra agora", () => {
    const so = { computadores: [pc("a", "x")] }
    expect(podeUsarEmAlgum(conta("x"), so), "o único computador já usa a conta").toBe(false)
    expect(podeUsarEmAlgum(conta("y"), so)).toBe(true)
    expect(podeUsarEmAlgum(conta("y", { pausada: true }), so)).toBe(false)
    expect(podeUsarEmAlgum(conta("y"), { computadores: [pc("a", null, { revogado: true })] })).toBe(false)
    expect(podeUsarEmAlgum(conta("y"), { computadores: [] })).toBe(false)
  })
})
