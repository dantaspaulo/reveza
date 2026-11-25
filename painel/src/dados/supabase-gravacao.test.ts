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
