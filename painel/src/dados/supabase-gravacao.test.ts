import { beforeEach, describe, expect, it, vi } from "vitest"

const chamada = vi.hoisted(() => vi.fn())
vi.mock("./cliente", () => ({ supabase: () => ({ rpc: chamada }), urlSupabase: () => "https://exemplo.invalid" }))

import { ErroPainel } from "./fonte"
import { FonteSupabase } from "./supabase"

const passos = [{ ref: "novo-1", id: null, campos: { nome: "Alfa" } }]

describe("resposta da gravação de projetos", () => {
  beforeEach(() => chamada.mockReset())

  it("identifica recusa confirmada e distingue perda de conexão", async () => {
    chamada.mockResolvedValueOnce({ data: { ok: false, erro: "escolha uma conta para ligar" }, error: null })
    await expect(new FonteSupabase().salvarUnidades(passos)).rejects.toMatchObject({ recusaConfirmada: true })
    chamada.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch", code: "" } })
    await expect(new FonteSupabase().salvarUnidades(passos)).rejects.toMatchObject({ recusaConfirmada: false })
  })

  it("um erro do próprio banco é recusa confirmada; um erro sem resposta do banco não é", async () => {
    // uma função que levanta exceção desfaz a transação inteira, e o PostgREST devolve o código do Postgres: nada ficou
    // gravado, então a pessoa pode continuar editando o rascunho
    for (const code of ["P0001", "23505", "42501", "40P01", "57014", "PGRST202"]) {
      chamada.mockResolvedValueOnce({ data: null, error: { message: "projeto desconhecido", code } })
      await expect(new FonteSupabase().salvarUnidades(passos)).rejects.toMatchObject({ recusaConfirmada: true, codigo: expect.any(String) })
    }
    // sem código do banco não há prova de recusa: a gravação ainda pode estar em curso do outro lado. O PGRST001 também
    // não prova: é a conexão com o banco que caiu no meio do pedido, e a gravação pode ter terminado
    for (const error of [
      { message: "Failed to fetch", code: "" },
      { message: "NetworkError when attempting to fetch resource" },
      { message: "Gateway Timeout", code: "504" },
      { message: "Bad Gateway", code: "502" },
      { message: "Database client error. Retrying the connection.", code: "PGRST001" },
    ]) {
      chamada.mockResolvedValueOnce({ data: null, error })
      await expect(new FonteSupabase().salvarUnidades(passos)).rejects.toMatchObject({ recusaConfirmada: false })
    }
  })

  it("não confirma gravação sem resposta válida e sem os IDs das unidades novas", async () => {
    for (const data of [null, {}, { ok: true }, { ok: true, ids: {} }, { ok: true, ids: { "novo-1": "" } }]) {
      chamada.mockResolvedValueOnce({ data, error: null })
      const erro = await new FonteSupabase().salvarUnidades(passos).catch((e: unknown) => e)
      expect(erro).toBeInstanceOf(ErroPainel)
      expect((erro as ErroPainel).recusaConfirmada).toBe(false)
    }
    chamada.mockResolvedValueOnce({ data: { ok: true, ids: { "novo-1": "id-real" } }, error: null })
    await expect(new FonteSupabase().salvarUnidades(passos)).resolves.toEqual({ "novo-1": "id-real" })
  })
})
