import { describe, expect, it } from "vitest"

import type { Computador } from "@/dados/tipos"
import { ESPERA_PEDIDO_MS, linhasDoAssistente, versaoDoAssistente } from "./assistente"

const pc = (id: string, diagnostico: Partial<NonNullable<Computador["diagnostico"]>> | null): Computador =>
  ({
    id,
    nome: id,
    sistema: "macos",
    versao: "0.8.0",
    vistoEm: null,
    revogado: false,
    criadoEm: "2026-10-15T00:00:00.000Z",
    diagnostico: diagnostico ? { em: "2026-10-15T00:00:00.000Z", versao: "0.8.0", atrasoBuscaMs: null, itens: [], ...diagnostico } : null,
    atribuicao: null,
    contaPreferidaId: null,
    enxugar: false,
  }) as Computador
const novo = (versao: string | null, extra: Record<string, unknown> = {}) =>
  pc(`pc-${versao}`, { assistente: { versao, autoDesligado: null, atualizando: false, ultima: null, ...extra } })

describe("a versão do assistente de cada computador", () => {
  it("do campo do agente 0.8.0; dos de antes, do texto do diagnóstico; com falha ou sem diagnóstico, nenhuma", () => {
    expect(versaoDoAssistente(novo("2.1.301"))).toBe("2.1.301")
    expect(versaoDoAssistente(pc("a", { itens: [{ id: "assistente", ok: true, detalhe: "versão 2.1.290" }] }))).toBe("2.1.290")
    expect(versaoDoAssistente(pc("b", { itens: [{ id: "assistente", ok: null, detalhe: "version 2.0.1 (the agent was tested from 2.1.0 on)" }] }))).toBe("2.0.1")
    expect(versaoDoAssistente(pc("c", { itens: [{ id: "assistente", ok: false, detalhe: "não achei o programa em /x/2.1.0/claude" }] }))).toBe(null)
    expect(versaoDoAssistente(pc("d", null))).toBe(null)
  })

  it("quem está atrás da mais nova entre eles; todos iguais só com a versão de todos", () => {
    const r = linhasDoAssistente([novo("2.1.301"), novo("2.1.293"), novo("2.1.10")])
    expect(r.maisNova).toBe("2.1.301")
    expect(r.linhas.map((l) => l.estado)).toEqual(["mais_nova", "atras", "atras"])
    expect(r.atras).toBe(2)
    expect(r.iguais).toBe(false)
    expect(linhasDoAssistente([novo("2.1.301"), novo("2.1.301")]).iguais).toBe(true)
    expect(linhasDoAssistente([novo("2.1.301"), pc("x", null)]).iguais).toBe(false)
  })

  it("o pedido daqui conta como atualizando até o computador contar a atualização de depois dele, ou até a espera acabar", () => {
    const agora = Date.parse("2026-10-15T12:00:00.000Z")
    const atras = novo("2.1.293")
    expect(linhasDoAssistente([atras], { [atras.id]: agora - 1000 }, agora).linhas[0]!.estado).toBe("atualizando")
    expect(linhasDoAssistente([atras], { [atras.id]: agora - 1000 }, agora).linhas[0]!.podeAtualizar).toBe(false)
    expect(linhasDoAssistente([atras], { [atras.id]: agora - ESPERA_PEDIDO_MS - 1 }, agora).linhas[0]!.estado).toBe("mais_nova")
    const contou = novo("2.1.301", { ultima: { em: new Date(agora).toISOString(), ok: true, de: "2.1.293", para: "2.1.301", sozinho: false } })
    expect(linhasDoAssistente([contou], { [contou.id]: agora - 5000 }, agora).linhas[0]!.estado).toBe("mais_nova")
    expect(linhasDoAssistente([novo("2.1.293", { atualizando: true })]).linhas[0]!.estado).toBe("atualizando")
  })

  it("agente de antes da 0.8.0 não recebe o pedido", () => {
    const antigo = pc("a", { itens: [{ id: "assistente", ok: true, detalhe: "versão 2.1.290" }] })
    expect(linhasDoAssistente([novo("2.1.301"), antigo]).linhas[1]).toMatchObject({ estado: "atras", podeAtualizar: false })
  })
})
