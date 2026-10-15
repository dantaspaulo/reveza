// O relógio dos dados e a situação do cabeçalho: a aba que o navegador pausou (economia de memória) volta com a leitura
// velha, e o painel não pode transformar a cegueira dele em computador "parado".
import { describe, expect, it } from "vitest"

import { FonteDemo } from "./demo"
import {
  FOLGA_DO_RELOGIO_MS,
  LEITURA_VELHA_MS,
  estadoComputador,
  faixasDeAlerta,
  relogioDosDados,
  situacaoDoPainel,
} from "./derivados"
import type { Computador } from "./tipos"

const LIDO = new Date("2026-10-15T10:00:00Z")
const depois = (ms: number) => new Date(LIDO.getTime() + ms)

function pc(vistoHaMs: number | null, extra: Partial<Computador> = {}): Computador {
  return {
    id: "pc-1",
    nome: "Computador",
    sistema: "linux",
    versao: "0.6.2",
    vistoEm: vistoHaMs === null ? null : new Date(LIDO.getTime() - vistoHaMs).toISOString(),
    revogado: false,
    criadoEm: "2026-10-01T00:00:00Z",
    diagnostico: null,
    atribuicao: null,
    contaPreferidaId: null,
    enxugar: false,
    ...extra,
  }
}

describe("relogioDosDados", () => {
  it("sem leitura, é a hora de agora", () => {
    expect(relogioDosDados(depois(600_000), null)).toEqual(depois(600_000))
    expect(relogioDosDados(depois(600_000), undefined)).toEqual(depois(600_000))
  })

  it("dentro da folga, é a hora de agora; além dela, para na leitura mais a folga", () => {
    expect(relogioDosDados(depois(5_000), LIDO)).toEqual(depois(5_000))
    expect(relogioDosDados(depois(FOLGA_DO_RELOGIO_MS), LIDO)).toEqual(depois(FOLGA_DO_RELOGIO_MS))
    expect(relogioDosDados(depois(10 * 60_000), LIDO)).toEqual(depois(FOLGA_DO_RELOGIO_MS))
  })

  it("a folga cabe no 'online' de quem busca a cada 5 s, e a leitura velha passa da releitura de 30 s", () => {
    expect(FOLGA_DO_RELOGIO_MS + 5_000).toBeLessThanOrEqual(30_000)
    expect(LEITURA_VELHA_MS).toBeGreaterThan(30_000)
  })
})

describe("estadoComputador com a hora da leitura", () => {
  it("a aba volta 10 min depois com a leitura velha: quem estava em dia segue online, não vira parado", () => {
    const agora = depois(10 * 60_000)
    expect(estadoComputador(pc(3_000), agora)).toBe("parado")
    expect(estadoComputador(pc(3_000), agora, LIDO)).toBe("online")
  })

  it("quem já estava parado na leitura continua parado, e o atrasado continua atrasado", () => {
    const agora = depois(10 * 60_000)
    expect(estadoComputador(pc(5 * 60_000), agora, LIDO)).toBe("parado")
    expect(estadoComputador(pc(60_000), agora, LIDO)).toBe("atrasado")
    expect(estadoComputador(pc(null), agora, LIDO)).toBe("parado")
    expect(estadoComputador(pc(3_000, { revogado: true }), agora, LIDO)).toBe("revogado")
  })

  it("com a leitura em dia, nada muda: o computador que parou de responder passa a parado", () => {
    // a leitura nova traz o mesmo visto_em; o relógio anda junto com a leitura
    const lido = depois(3 * 60_000)
    expect(estadoComputador(pc(3_000), depois(3 * 60_000 + 5_000), lido)).toBe("parado")
    expect(estadoComputador(pc(3_000), depois(10_000), depois(5_000))).toBe("online")
  })
})

describe("faixasDeAlerta com a hora da leitura", () => {
  it("a aba pausada não acende 'computador parado' para quem estava em dia na última leitura", async () => {
    const f = new FonteDemo({ agora: () => LIDO, atrasoMs: 0, relogio: false })
    const e = await f.carregar()
    const tarde = depois(15 * 60_000)
    const parados = (lido?: Date) => faixasDeAlerta(e, tarde, lido).filter((x) => x.tipo === "computador_parado")
    expect(parados().length).toBeGreaterThan(0)
    expect(parados(LIDO)).toEqual([])
  })
})

describe("situacaoDoPainel", () => {
  const base = { online: true, erro: null, atualizadoEm: LIDO }

  it("leitura recente e sem erro: ao vivo", () => {
    expect(situacaoDoPainel({ ...base, agora: depois(5_000) })).toBe("ao_vivo")
    expect(situacaoDoPainel({ ...base, agora: depois(LEITURA_VELHA_MS) })).toBe("ao_vivo")
  })

  it("leitura velha (aba pausada) ou erro na última leitura: reconectando", () => {
    expect(situacaoDoPainel({ ...base, agora: depois(LEITURA_VELHA_MS + 1) })).toBe("reconectando")
    expect(situacaoDoPainel({ ...base, erro: new Error("falhou"), agora: depois(1_000) })).toBe("reconectando")
  })

  it("sem rede vem antes de tudo", () => {
    expect(situacaoDoPainel({ ...base, online: false, agora: depois(1_000) })).toBe("sem_rede")
    expect(situacaoDoPainel({ ...base, online: false, erro: new Error("x"), agora: depois(10 * 60_000) })).toBe("sem_rede")
  })
})
