import { beforeEach, describe, expect, it, vi } from "vitest"

// 0.22.0 (parte D): o painel lê as regras de pasta do OpenBot (tipo "secao"), a cadeia de pastas de cada agente e a
// lista das pastas (secoes_openbot) para mostrar o nome
const chamada = vi.hoisted(() => vi.fn())
const tabela = vi.hoisted(() => vi.fn())
vi.mock("./cliente", () => ({
  supabase: () => ({ rpc: chamada, from: tabela }),
  urlSupabase: () => "https://exemplo.invalid",
}))

import { FonteSupabase } from "./supabase"

type Resposta = { data: unknown[] | null; error: { message: string; code?: string } | null }

/** Uma consulta do supabase-js de mentira, com a resposta de cada tabela. */
function tabelas(respostas: Record<string, Resposta>) {
  tabela.mockImplementation((nome: string) => {
    const r = respostas[nome] ?? { data: [], error: null }
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      limit: () => q,
      then: (ok: (v: Resposta) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, falha),
    }
    return q
  })
}

const VISTO = "2026-11-26T12:00:00+00:00"

describe("leitura das pastas do OpenBot (0.22.0)", () => {
  beforeEach(() => {
    chamada.mockReset()
    tabela.mockReset()
    chamada.mockResolvedValue({ data: { revisao: "a".repeat(64) }, error: null })
  })

  it("a regra de tipo secao continua secao (antes virava regra de nome de pasta)", async () => {
    tabelas({
      pastas_empresa: {
        data: [
          { id: "r1", tipo: "secao", padrao: "Clientes_1", empresa_id: "e1", computador_id: "pc" },
          { id: "r2", tipo: "titulo", padrao: "loja", empresa_id: "e1", computador_id: null },
          { id: "r3", tipo: "pasta", padrao: "~/Code", empresa_id: "e1", computador_id: null },
        ],
        error: null,
      },
    })
    const d = await new FonteSupabase().empresas()
    expect(d.regras.map((r) => [r.tipo, r.padrao])).toEqual([
      ["secao", "Clientes_1"],
      ["titulo", "loja"],
      ["pasta", "~/Code"],
    ])
  })

  it("a cadeia de pastas de cada agente vem junto; sem a coluna (nuvem antiga) ou vazia, fica vazia", async () => {
    tabelas({
      agentes_openbot: {
        data: [
          { computador_id: "pc", pasta: "~/a", nome: "A", titulo: "", visto_em: VISTO, secoes: ["clientes", "loja"] },
          { computador_id: "pc", pasta: "~/b", nome: "B", titulo: "", visto_em: VISTO, secoes: null },
          { computador_id: "pc", pasta: "~/c", nome: "C", titulo: "", visto_em: VISTO },
        ],
        error: null,
      },
    })
    const d = await new FonteSupabase().empresas()
    expect(d.agentes.map((a) => a.secoes)).toEqual([["clientes", "loja"], [], []])
  })

  it("lê a lista das pastas de cada computador; nuvem sem a tabela: lista vazia e a escolha some", async () => {
    tabelas({
      secoes_openbot: {
        data: [
          { computador_id: "pc", id: "clientes", nome: "Clientes", pai: null, visto_em: VISTO },
          { computador_id: "pc", id: "loja", nome: "", pai: "clientes", visto_em: VISTO },
        ],
        error: null,
      },
    })
    const d = await new FonteSupabase().empresas()
    expect(d.secoesNaNuvem).toBe(true)
    expect(d.secoes).toEqual([
      { computadorId: "pc", id: "clientes", nome: "Clientes", pai: null, vistoEm: VISTO },
      { computadorId: "pc", id: "loja", nome: "", pai: "clientes", vistoEm: VISTO },
    ])
    tabelas({ secoes_openbot: { data: null, error: { message: "Could not find the table 'public.secoes_openbot'", code: "PGRST205" } } })
    const antiga = await new FonteSupabase().empresas()
    expect(antiga.secoesNaNuvem).toBe(false)
    expect(antiga.secoes).toEqual([])
  })

  it("falha passageira na lista das pastas derruba a leitura (não vira 'pasta que sumiu' em todas)", async () => {
    tabelas({ secoes_openbot: { data: null, error: { message: "Failed to fetch", code: "" } } })
    await expect(new FonteSupabase().empresas()).rejects.toBeTruthy()
  })
})
