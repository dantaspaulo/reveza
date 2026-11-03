import { describe, expect, it } from "vitest"

import type { LinhaUso, SessaoUso } from "@/dados/tipos"
import { leituras } from "./leituras"

const AGORA = new Date("2026-11-03T12:00:00-03:00")
const DE = new Date("2026-10-28T00:00:00-03:00")

const linha = (hora: string, extra: Partial<LinhaUso> = {}): LinhaUso => ({
  hora,
  contaId: "a",
  computadorId: "pc",
  projeto: "loja",
  modelo: "claude-opus-5-5",
  respostas: 10,
  entrada: 10,
  saida: 100,
  cacheEscrita: 100,
  cacheLeitura: 10_000,
  usd: 10,
  agentes: 0,
  ...extra,
})

const sessao = (inicio: string, extra: Partial<SessaoUso> = {}): SessaoUso => ({
  id: inicio,
  computadorId: "pc",
  projeto: "loja",
  inicio,
  fim: null,
  respostas: 50,
  tokens: 1,
  usd: 5,
  agentes: 0,
  contas: [],
  modelos: [],
  paradaNoLimite: false,
  ...extra,
})

const USO = [
  linha("2026-10-29T14:00:00-03:00"),
  linha("2026-10-29T15:00:00-03:00", { usd: 40, respostas: 30 }),
  linha("2026-10-30T09:00:00-03:00", { projeto: "site", modelo: "claude-fable-5-1", usd: 5 }),
]

const tipos = (l: { tipo: string }[]) => l.map((x) => x.tipo)

describe("leituras do período", () => {
  it("cache, modelo, projeto, dia mais intenso e horário de pico", () => {
    const l = leituras({ uso: USO, sessoes: [sessao("2026-10-29T13:00:00-03:00")], anterior: null, de: DE, agora: AGORA, diasPeriodo: 7 })
    expect(tipos(l)).toEqual(["cache", "modelo", "projeto", "pico", "horario"])
    expect(l.find((x) => x.tipo === "cache")).toMatchObject({ fatia: expect.closeTo(30_000 / 30_630, 5) })
    expect(l.find((x) => x.tipo === "modelo")).toMatchObject({ modelo: "claude-opus-5-5", fatia: expect.closeTo(50 / 55, 5) })
    expect(l.find((x) => x.tipo === "pico")).toMatchObject({ dia: "2026-10-29", usd: 50, respostas: 40 })
    expect(l.find((x) => x.tipo === "horario")).toMatchObject({ diaSemana: 3, hora: 15 }) // quinta, 15h
  })

  it("sem uso, nenhuma leitura", () => {
    expect(leituras({ uso: [], sessoes: [], anterior: null, de: DE, agora: AGORA, diasPeriodo: 7 })).toEqual([])
  })

  it("tendência só com o período anterior coberto, e pelo custo por dia", () => {
    const anterior = Array.from({ length: 7 }, (_, i) => linha(`2026-10-${String(21 + i).padStart(2, "0")}T10:00:00-03:00`, { usd: 2 }))
    const l = leituras({ uso: USO, sessoes: [], anterior, de: DE, agora: AGORA, diasPeriodo: 7 })
    // agora: 55 em 6,5 dias; antes: 14 em 7 dias
    expect(l[0]).toMatchObject({ tipo: "tendencia", dias: 7, variacao: expect.closeTo(55 / 6.5 / 2 - 1, 5) })
    // o registro novo não tem o mês de antes: com uso em só 2 dos 7, nada de tendência
    const pouco = anterior.slice(0, 2)
    expect(tipos(leituras({ uso: USO, sessoes: [], anterior: pouco, de: DE, agora: AGORA, diasPeriodo: 7 }))).not.toContain("tendencia")
  })

  it("sessões abertas há mais de uma semana e sessões curtas em quantidade", () => {
    const longas = [sessao("2026-08-06T10:00:00-03:00", { usd: 1000 }), sessao("2026-10-20T10:00:00-03:00", { usd: 200 })]
    const curtas = Array.from({ length: 30 }, (_, i) => sessao(`2026-10-30T10:${String(i).padStart(2, "0")}:00-03:00`, { respostas: 2 }))
    const l = leituras({ uso: USO, sessoes: [...longas, ...curtas, sessao("2026-11-01T10:00:00-03:00")], anterior: null, de: DE, agora: AGORA, diasPeriodo: 7, maximo: 10 })
    expect(l.find((x) => x.tipo === "longas")).toEqual({ tipo: "longas", n: 2, maisAntiga: 89, usd: 1200 })
    expect(l.find((x) => x.tipo === "curtas")).toMatchObject({ n: 30, fatia: 30 / 33 })
    // poucas sessões curtas não viram leitura
    expect(tipos(leituras({ uso: USO, sessoes: curtas.slice(0, 5), anterior: null, de: DE, agora: AGORA, diasPeriodo: 7, maximo: 10 }))).not.toContain("curtas")
  })

  it("no máximo seis leituras", () => {
    const anterior = Array.from({ length: 7 }, (_, i) => linha(`2026-10-${String(21 + i).padStart(2, "0")}T10:00:00-03:00`, { usd: 2 }))
    const sessoes = [sessao("2026-08-06T10:00:00-03:00"), ...Array.from({ length: 30 }, (_, i) => sessao(`2026-10-30T11:${String(i).padStart(2, "0")}:00-03:00`, { respostas: 1 }))]
    expect(leituras({ uso: USO, sessoes, anterior, de: DE, agora: AGORA, diasPeriodo: 7 })).toHaveLength(6)
  })
})
