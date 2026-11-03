import { describe, expect, it } from "vitest"

import type { LinhaUso } from "@/dados/tipos"
import { COR_OUTRAS, corConta, indiceCor, proximaCorLivre, seriesPorConta } from "./cores"
import { campoCsv, paraCsv } from "./csv"
import { diasEntre, mapaCalor, porDia, ranking, sessoesPorDia, totais } from "./uso"

const linha = (hora: string, contaId: string | null, usd: number, extra: Partial<LinhaUso> = {}): LinhaUso => ({
  hora,
  contaId,
  computadorId: "pc",
  projeto: "loja",
  modelo: "m",
  respostas: 2,
  entrada: 10,
  saida: 20,
  cacheEscrita: 30,
  cacheLeitura: 40,
  usd,
  agentes: 0,
  ...extra,
})

const linhas = [
  linha("2026-10-05T13:00:00-03:00", "a", 1),
  linha("2026-10-05T14:00:00-03:00", "b", 2, { projeto: "" }),
  linha("2026-10-06T09:00:00-03:00", "a", 4, { modelo: "n", agentes: 2 }),
]

describe("agregações do uso", () => {
  it("totais", () => {
    expect(totais(linhas)).toEqual({
      usd: 7,
      tokens: 300,
      entrada: 30,
      saida: 60,
      cacheEscrita: 90,
      cacheLeitura: 120,
      respostas: 6,
      agentes: 2,
    })
  })

  it("dias entre duas datas, inclusive", () => {
    expect(diasEntre(new Date("2026-10-05T10:00:00-03:00"), new Date("2026-10-07T01:00:00-03:00"))).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ])
  })

  it("por dia, com zero onde não houve uso", () => {
    const { dados, grupos } = porDia(linhas, "conta", "usd", ["2026-10-05", "2026-10-06"])
    expect(grupos.sort()).toEqual(["a", "b"])
    expect(dados).toEqual([
      { dia: "2026-10-05", a: 1, b: 2 },
      { dia: "2026-10-06", a: 4, b: 0 },
    ])
  })

  it("ranking com fatia, e projeto vazio vira sem_projeto", () => {
    expect(ranking(linhas, "conta", "usd")).toEqual([
      { grupo: "a", valor: 5, fatia: 5 / 7 },
      { grupo: "b", valor: 2, fatia: 2 / 7 },
    ])
    expect(ranking(linhas, "projeto", "respostas").map((r) => r.grupo)).toEqual(["loja", "sem_projeto"])
  })

  it("mapa de calor 7 x 24 com segunda na linha 0", () => {
    const m = mapaCalor(linhas, "usd")
    expect(m).toHaveLength(7)
    expect(m[0][13]).toBe(1) // segunda, 5 de outubro de 2026, 13h
    expect(m[0][14]).toBe(2)
    expect(m[1][9]).toBe(4) // terça 9h
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(7)
  })

  it("sessões pelo dia em que começaram; agentes pela hora em que cada um começou (das linhas de uso)", () => {
    const s = sessoesPorDia(
      [
        {
          id: "1",
          computadorId: "pc",
          projeto: "",
          inicio: "2026-10-05T10:00:00-03:00",
          fim: null,
          respostas: 1,
          tokens: 1,
          usd: 1,
          agentes: 3,
          contas: [],
          modelos: [],
          paradaNoLimite: false,
        },
        {
          id: "2",
          computadorId: "pc",
          projeto: "",
          inicio: "2026-10-05T18:00:00-03:00",
          fim: null,
          respostas: 1,
          tokens: 1,
          usd: 1,
          agentes: 1,
          contas: [],
          modelos: [],
          paradaNoLimite: false,
        },
      ],
      linhas,
      ["2026-10-05", "2026-10-06"]
    )
    // os agentes que as sessões somam (3 + 1) não contam: a sessão longa os juntava no dia em que começou
    expect(s).toEqual([
      { dia: "2026-10-05", sessoes: 2, agentes: 0 },
      { dia: "2026-10-06", sessoes: 0, agentes: 2 },
    ])
  })
})

describe("planilha CSV", () => {
  it("aspas quando precisa e proteção contra fórmula", () => {
    expect(campoCsv("simples")).toBe("simples")
    expect(campoCsv('tem "aspas", vírgula')).toBe('"tem ""aspas"", vírgula"')
    expect(campoCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)")
    expect(campoCsv("+1")).toBe("'+1")
    expect(campoCsv(-3.5)).toBe("-3.5")
    expect(campoCsv(null)).toBe("")
    expect(paraCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n")
  })
})

describe("cores das contas", () => {
  it("índice estável e sem repetir enquanto houver cor livre", () => {
    expect(indiceCor(9)).toBe(2)
    expect(indiceCor(-1)).toBe(6)
    expect(corConta(0)).toBe("var(--conta-1)")
    expect(proximaCorLivre([0, 1, 2])).toBe(3)
    expect(proximaCorLivre([0, 1, 2, 3, 4, 5, 6, 0])).toBe(1)
  })

  it("da 8ª conta em diante (por volume) o resto vira Outras", () => {
    const contas = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, volume: 100 - i }))
    const m = seriesPorConta(contas)
    expect(m.get("c0")).toBe("c0")
    expect(m.get("c6")).toBe("c6")
    expect(m.get("c7")).toBe("outras")
    expect(COR_OUTRAS).toBe("var(--conta-outras)")
  })
})
