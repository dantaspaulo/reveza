import { describe, expect, it, vi } from "vitest"

import { buscarCotacao, lerPtax, urlPtax } from "./cotacao"
import { ALTURA, LARGURA, MARCA, marco } from "./cartao"
import { fmtBrl, fmtCompacto } from "./formato"

describe("cartão para os stories", () => {
  it("tamanho dos stories e a marca d'água", () => {
    expect([LARGURA, ALTURA]).toEqual([1080, 1920])
    expect(MARCA).toBe("reveza.ia.br")
  })

  it("o marco é o maior número redondo (1, 2 ou 5 vezes uma potência de 10) que o valor passou", () => {
    expect(marco(110_300_000_000)).toBe(100_000_000_000)
    expect(marco(299_592)).toBe(200_000)
    expect(marco(39_380)).toBe(20_000)
    expect(marco(1_615)).toBe(1_000)
    expect(marco(5_000)).toBe(5_000)
    expect(marco(9)).toBe(null)
    expect(marco(Number.NaN)).toBe(null)
  })

  it("o marco em forma curta, com e sem moeda", () => {
    // o Intl separa com espaço que não quebra: a conferência troca por espaço comum
    const plano = (x: string) => x.replace(/\s/g, " ")
    expect(plano(fmtCompacto(100_000_000_000, "pt-BR"))).toBe("100 bi")
    expect(plano(fmtCompacto(20_000, "pt-BR", "USD"))).toBe("US$ 20 mil")
    expect(plano(fmtCompacto(200_000, "en", "BRL"))).toBe("R$200K")
    expect(plano(fmtBrl(213_946.6, "pt-BR"))).toBe("R$ 213.947")
  })
})

describe("cotação do dólar (PTAX do Banco Central)", () => {
  it("pede os últimos 10 dias, no formato da API", () => {
    const url = urlPtax(new Date("2026-11-03T12:00:00-03:00"))
    expect(url).toMatch(/^https:\/\/olinda\.bcb\.gov\.br\/olinda\/servico\/PTAX\//)
    expect(url).toContain("@dataInicial='10-24-2026'")
    expect(url).toContain("@dataFinalCotacao='11-03-2026'")
  })

  it("fica com a cotação mais recente e recusa o que não presta", () => {
    expect(
      lerPtax({
        value: [
          { cotacaoVenda: 5.3346, dataHoraCotacao: "2026-10-27 13:05:26.521898" },
          { cotacaoVenda: 5.4212, dataHoraCotacao: "2026-10-30 13:04:11.1" },
          { cotacaoVenda: 5.37, dataHoraCotacao: "2026-10-29 13:11:53" },
        ],
      })
    ).toEqual({ valor: 5.4212, dia: "2026-10-30" })
    expect(lerPtax({ value: [{ cotacaoVenda: "x", dataHoraCotacao: "2026-10-30" }, { cotacaoVenda: 900, dataHoraCotacao: "2026-10-31 13:00" }] })).toBe(null)
    expect(lerPtax(null)).toBe(null)
    expect(lerPtax({ value: [] })).toBe(null)
  })

  it("sem rede ou com erro, segue sem cotação (o painel só não mostra o real)", async () => {
    expect(await buscarCotacao(vi.fn().mockRejectedValue(new Error("rede")))).toBe(null)
    expect(await buscarCotacao(vi.fn().mockResolvedValue(new Response("nada", { status: 503 })))).toBe(null)
    const ok = vi.fn().mockResolvedValue(Response.json({ value: [{ cotacaoVenda: 5.43, dataHoraCotacao: "2026-10-31 13:00:00" }] }))
    expect(await buscarCotacao(ok)).toEqual({ valor: 5.43, dia: "2026-10-31" })
  })
})
