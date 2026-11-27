import { describe, expect, it } from "vitest"

import type { AgenteOpenBot, RegraPasta } from "@/dados/tipos"

import casosTexto from "../../../nuvem/testes/casos-pasta-openbot.json?raw"
import { classificadorDoRascunho, linhasDeAgentes } from "./agentes"
import { alteradas, planoDeGravar, rascunhoDe, temRegraEm, validar, type UnidadeRascunho } from "./cadastro"
import { criarClassificador } from "./empresas"

// 0.22.0 (parte D): a regra de projeto pela pasta da barra do OpenBot (tipo "secao") no painel. A tabela de casos é a
// mesma da nuvem (rvz_classificar) e do agente (criarClassificador de trilhas.ts).

type Casos = {
  agentes: { pasta: string; nome: string; titulo: string; secoes: string[] }[]
  casos: { nome: string; regras: [string, string, string][]; perguntas: [string, string | null][] }[]
}
const CASOS = JSON.parse(casosTexto) as Casos
const PC = "pc"
const PC2 = "pc2"
const VISTO = "2026-11-26T12:00:00.000Z"

const agente = (a: Casos["agentes"][number], computadorId = PC): AgenteOpenBot => ({ ...a, computadorId, vistoEm: VISTO })

function classificador(
  regras: [string, string, string][],
  agentes: AgenteOpenBot[] = CASOS.agentes.map((a) => agente(a)),
  computadorDaSecao: string | null = PC
) {
  return criarClassificador({
    empresas: [...new Set(regras.map((r) => r[2]))].map((id) => ({ id, pai: null })),
    regras: regras.map(([tipo, padrao, empresaId], i) => ({
      id: `r${i}`,
      tipo: tipo as RegraPasta["tipo"],
      padrao,
      empresaId,
      computadorId: tipo === "secao" ? computadorDaSecao : null,
    })),
    agentes,
  })
}

describe("pasta do OpenBot no classificador do painel (a tabela comum com a nuvem e o agente)", () => {
  for (const caso of CASOS.casos) {
    it(caso.nome, () => {
      const c = classificador(caso.regras)
      for (const [pasta, esperado] of caso.perguntas) expect(c(pasta, pasta.split("/").pop() ?? "", PC), pasta).toBe(esperado)
    })
  }

  it("a regra vale só no computador dela; a linha sem computador conhecido não pega a regra", () => {
    const agentes = [...CASOS.agentes.map((a) => agente(a)), ...CASOS.agentes.map((a) => agente(a, PC2))]
    const c = classificador([["secao", "clientes", "A"]], agentes)
    expect(c("~/OpenBot/Agents/agent-1", "agent-1", PC)).toBe("A")
    expect(c("~/OpenBot/Agents/agent-1", "agent-1", PC2)).toBeNull()
    expect(c("~/OpenBot/Agents/agent-1", "agent-1")).toBeNull()
  })

  it("regra de pasta do OpenBot sem computador não vale (o id é do OpenBot de um computador)", () => {
    const c = classificador([["secao", "clientes", "A"]], undefined, null)
    expect(c("~/OpenBot/Agents/agent-1", "agent-1", PC)).toBeNull()
  })

  it("a parte comum das pastas de agentes na mesma pasta de trabalho é por computador", () => {
    const agentes = [
      agente({ pasta: "~/OpenBot/Agents/comum", nome: "C1", titulo: "", secoes: ["clientes", "loja"] }),
      agente({ pasta: "~/OpenBot/Agents/comum", nome: "C2", titulo: "", secoes: ["outra"] }, PC2),
    ]
    const c = classificador([["secao", "loja", "B"]], agentes)
    expect(c("~/OpenBot/Agents/comum", "comum", PC)).toBe("B")
  })

  it("a parte comum não depende da ordem em que os agentes vêm", () => {
    const [, c1, c2] = CASOS.agentes
    for (const ordem of [[c1, c2], [c2, c1]]) {
      const c = classificador([["secao", "loja", "B"]], ordem.map((a) => agente(a)))
      expect(c("~/OpenBot/Agents/comum", "comum", PC)).toBeNull()
    }
  })

  it("agente sem a lista de pastas (agente antigo): a regra não vale e o título segue valendo", () => {
    const antigo: AgenteOpenBot = { computadorId: PC, pasta: "~/OpenBot/Agents/agent-1", nome: "Um", titulo: "Atendimento", vistoEm: VISTO }
    const c = classificador([["secao", "clientes", "A"], ["titulo", "Atendimento", "T"]], [antigo])
    expect(c("~/OpenBot/Agents/agent-1", "agent-1", PC)).toBe("T")
  })
})

const nuvem = (regras: RegraPasta[]) => ({
  empresas: [
    { id: "A", nome: "A", cor: 0, transbordo: "nenhum" as const, transbordoContas: [], separar: false, criadaEm: VISTO, pai: null, modo: "ligado" as const, herdarTransbordo: true },
    { id: "B", nome: "B", cor: 1, transbordo: "nenhum" as const, transbordoContas: [], separar: false, criadaEm: VISTO, pai: null, modo: "ligado" as const, herdarTransbordo: true },
  ],
  marcas: [],
  regras,
})

describe("pasta do OpenBot no rascunho do cadastro", () => {
  const secaoA: RegraPasta = { id: "s1", tipo: "secao", padrao: "Clientes_1", empresaId: "A", computadorId: PC }
  const pastaA: RegraPasta = { id: "p1", tipo: "pasta", padrao: "~/Code/a", empresaId: "A", computadorId: null }

  it("a regra vem como regra de agente (com o tipo), não como pasta, e volta igual ao salvar outra coisa", () => {
    const base = rascunhoDe(nuvem([secaoA, pastaA]))
    const a = base.find((u) => u.id === "A")!
    expect(a.pastas).toEqual([{ computador: null, padrao: "~/Code/a" }])
    expect(a.titulos).toEqual([{ tipo: "secao", padrao: "Clientes_1", computador: PC }])
    expect(temRegraEm(a, PC)).toBe(true)
    const lista = base.map((u) => (u.id === "A" ? { ...u, pastas: [...u.pastas, { computador: PC, padrao: "~/Code/b" }] } : u))
    const [passo] = planoDeGravar(base, lista)
    expect(passo.campos.pastas).toEqual(
      expect.arrayContaining([{ tipo: "secao", padrao: "Clientes_1", computador: PC }])
    )
  })

  it("o id da pasta é exato: maiúsculas diferentes são pastas diferentes", () => {
    const base = rascunhoDe(nuvem([]))
    const lista = base.map((u) =>
      u.id === "A"
        ? {
            ...u,
            titulos: [
              { tipo: "secao" as const, padrao: "ab", computador: PC },
              { tipo: "secao" as const, padrao: "Ab", computador: PC },
            ],
          }
        : u
    )
    const [passo] = planoDeGravar(base, lista)
    expect(passo.campos.pastas).toHaveLength(2)
    const outro = lista.map((u) => (u.id === "B" ? { ...u, titulos: [{ tipo: "secao" as const, padrao: "AB", computador: PC }] } : u))
    expect(validar(outro)).toBeNull()
  })

  it("a mesma pasta do OpenBot em dois projetos do mesmo computador é recusada antes de salvar; noutro computador, não", () => {
    const base = rascunhoDe(nuvem([secaoA]))
    const mesmo = base.map((u) => (u.id === "B" ? { ...u, titulos: [{ tipo: "secao" as const, padrao: "Clientes_1", computador: PC }] } : u))
    expect(validar(mesmo)).toMatchObject({ chave: "erroTexto" })
    const outroPc = base.map((u) => (u.id === "B" ? { ...u, titulos: [{ tipo: "secao" as const, padrao: "Clientes_1", computador: PC2 }] } : u))
    expect(validar(outroPc)).toBeNull()
  })

  it("trocar uma regra de texto por uma pasta do OpenBot com o mesmo texto conta como mudança", () => {
    const base = rascunhoDe(nuvem([{ id: "t1", tipo: "titulo", padrao: "loja", empresaId: "A", computadorId: PC }]))
    const lista = base.map((u) => (u.id === "A" ? { ...u, titulos: [{ tipo: "secao" as const, padrao: "loja", computador: PC }] } : u))
    expect(alteradas(base, lista).map((u) => u.id)).toEqual(["A"])
  })
})

describe("pasta do OpenBot na lista de agentes do editor", () => {
  const u = (id: string, titulos: UnidadeRascunho["titulos"]): UnidadeRascunho => ({
    id,
    novo: false,
    nome: id,
    pai: null,
    cor: 0,
    modo: "ligado",
    contas: [],
    pastas: [],
    titulos,
    computadores: null,
  })

  it("o agente da pasta escolhida cai no projeto e mostra a regra; o nome igual ao id não conta como texto", () => {
    const um = agente(CASOS.agentes[0])
    const loja = { ...agente({ pasta: "~/OpenBot/Agents/loja", nome: "loja", titulo: "loja", secoes: [] }) }
    const lista = [u("A", [{ tipo: "secao", padrao: "loja", computador: PC }])]
    const c = classificadorDoRascunho(lista, [um, loja])
    const linhas = linhasDeAgentes(lista, "A", [um, loja], PC, c)
    const porNome = new Map(linhas.map((l) => [l.agente.nome, l]))
    expect(porNome.get("Um")).toMatchObject({ onde: "A", porRegra: "loja" })
    expect(porNome.get("loja")).toMatchObject({ onde: null, porRegra: null })
  })
})
