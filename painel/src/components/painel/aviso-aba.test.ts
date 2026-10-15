import { describe, expect, it } from "vitest"

import { precisaAvisarAba } from "./aviso-aba"

const guardado = (valor: string | null) => ({ getItem: () => valor })

describe("precisaAvisarAba", () => {
  it("só avisa quando o navegador descartou a aba", () => {
    expect(precisaAvisarAba({}, guardado(null))).toBe(false)
    expect(precisaAvisarAba({ wasDiscarded: false }, guardado(null))).toBe(false)
    expect(precisaAvisarAba({ wasDiscarded: true }, guardado(null))).toBe(true)
  })

  it("depois do Entendi, não avisa mais neste navegador", () => {
    expect(precisaAvisarAba({ wasDiscarded: true }, guardado("1"))).toBe(false)
  })

  it("sem armazenamento (navegação privada, bloqueio), avisa mesmo assim", () => {
    expect(precisaAvisarAba({ wasDiscarded: true }, null)).toBe(true)
    const quebrado = {
      getItem: () => {
        throw new Error("bloqueado")
      },
    }
    expect(precisaAvisarAba({ wasDiscarded: true }, quebrado)).toBe(true)
  })
})
