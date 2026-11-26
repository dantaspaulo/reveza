import { describe, expect, it, vi } from "vitest"

import { ErroPainel } from "./fonte"
import { estadoGravacao, gravarCadastro, ouvirGravacao } from "./gravacao"

const passos = [{ ref: "u1", id: "u1", campos: { nome: "Alfa" } }]
const fonteCom = (salvar: () => Promise<Record<string, string>>) => ({ salvarUnidades: vi.fn(salvar) })

describe("gravação do cadastro nesta aba", () => {
  it("a gravação confirmada é contada e não deixa trava", async () => {
    const fonte = fonteCom(async () => ({ u1: "u1" }))
    await expect(gravarCadastro(fonte, passos)).resolves.toEqual({ u1: "u1" })
    expect(estadoGravacao(fonte)).toEqual({ emCurso: 0, incerto: false, confirmadas: 1 })
  })

  it("a recusa que o banco comprova passa adiante sem travar a aba", async () => {
    const recusa = new ErroPainel("cadastro", "projeto desconhecido", true)
    const fonte = fonteCom(async () => {
      throw recusa
    })
    await expect(gravarCadastro(fonte, passos)).rejects.toBe(recusa)
    expect(estadoGravacao(fonte)).toEqual({ emCurso: 0, incerto: false, confirmadas: 0 })
    await expect(gravarCadastro(fonte, passos)).rejects.toBe(recusa)
    expect(fonte.salvarUnidades).toHaveBeenCalledTimes(2)
  })

  it("resposta sem prova trava a aba: as próximas gravações são recusadas sem ir à nuvem", async () => {
    for (const falha of [
      new Error("Failed to fetch"),
      new ErroPainel("falha", "Gateway Timeout"),
      new ErroPainel("resultado_incerto"),
    ]) {
      const fonte = fonteCom(async () => {
        throw falha
      })
      // o aviso de erro diz o mesmo que o quadro da tela, e não "tente de novo"
      await expect(gravarCadastro(fonte, passos)).rejects.toMatchObject({ codigo: "resultado_incerto", recusaConfirmada: false })
      expect(estadoGravacao(fonte)).toEqual({ emCurso: 0, incerto: true, confirmadas: 0 })
      await expect(gravarCadastro(fonte, passos)).rejects.toMatchObject({ codigo: "resultado_incerto" })
      expect(fonte.salvarUnidades).toHaveBeenCalledTimes(1)
    }
  })

  it("a trava é da fonte desta página: recarregar a página (fonte nova) começa sem ela", async () => {
    const antiga = fonteCom(async () => {
      throw new Error("resposta perdida")
    })
    await gravarCadastro(antiga, passos).catch(() => undefined)
    expect(estadoGravacao(antiga).incerto).toBe(true)
    const nova = fonteCom(async () => ({}))
    expect(estadoGravacao(nova)).toEqual({ emCurso: 0, incerto: false, confirmadas: 0 })
    await expect(gravarCadastro(nova, passos)).resolves.toEqual({})
  })

  it("com uma gravação ainda sem resposta, outra não começa", async () => {
    let terminar!: (ids: Record<string, string>) => void
    const fonte = fonteCom(
      () =>
        new Promise<Record<string, string>>((r) => {
          terminar = r
        })
    )
    const primeira = gravarCadastro(fonte, passos)
    expect(estadoGravacao(fonte).emCurso).toBe(1)
    await expect(gravarCadastro(fonte, passos)).rejects.toMatchObject({ codigo: "gravacao_em_curso" })
    expect(fonte.salvarUnidades).toHaveBeenCalledTimes(1)
    terminar({})
    await primeira
    expect(estadoGravacao(fonte)).toEqual({ emCurso: 0, incerto: false, confirmadas: 1 })
  })

  it("um erro antes de a gravação começar também devolve a vez", async () => {
    const fonte = {
      salvarUnidades: vi.fn((): Promise<Record<string, string>> => {
        throw new ErroPainel("cadastro", "recusado", true)
      }),
    }
    await expect(gravarCadastro(fonte, passos)).rejects.toMatchObject({ codigo: "cadastro" })
    expect(estadoGravacao(fonte)).toEqual({ emCurso: 0, incerto: false, confirmadas: 0 })
  })

  it("avisa quem ouve a cada mudança e para de avisar quando sai", async () => {
    const fonte = fonteCom(async () => ({}))
    const ouvir = vi.fn()
    const sair = ouvirGravacao(fonte, ouvir)
    await gravarCadastro(fonte, passos)
    expect(ouvir).toHaveBeenCalledTimes(2)
    sair()
    await gravarCadastro(fonte, passos)
    expect(ouvir).toHaveBeenCalledTimes(2)
  })
})
