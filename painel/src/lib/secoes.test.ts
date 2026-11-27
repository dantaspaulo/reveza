import { describe, expect, it } from "vitest"

import type { AgenteOpenBot, SecaoOpenBot } from "@/dados/tipos"

import type { UnidadeRascunho } from "./cadastro"
import { validar } from "./cadastro"
import { adicionarSecao, donoDaSecao, escolheSecoes, opcoesDeSecoes, rotuloDaSecao } from "./secoes"

// 0.22.0 (parte D2): escolher pastas da barra do OpenBot no editor do projeto

const PC = "pc"
const PC2 = "pc2"
const VISTO = "2026-11-26T12:00:00.000Z"
const SEM_NOME = "pasta sem nome"

const secao = (id: string, nome: string, pai: string | null = null, computadorId = PC): SecaoOpenBot => ({ computadorId, id, nome, pai, vistoEm: VISTO })
const agente = (pasta: string, secoes: string[], computadorId = PC): AgenteOpenBot => ({ computadorId, pasta, nome: pasta, titulo: "", secoes, vistoEm: VISTO })
const u = (id: string, campos: Partial<UnidadeRascunho> = {}): UnidadeRascunho => ({
  id,
  novo: false,
  nome: id,
  pai: null,
  cor: 0,
  modo: "desligado",
  contas: [],
  pastas: [],
  titulos: [],
  computadores: null,
  ...campos,
})

describe("as pastas do OpenBot de um computador", () => {
  it("em árvore (a pasta antes das subpastas, por nome), com o caminho e os agentes dela e das subpastas", () => {
    const secoes = [secao("b", "Beta"), secao("a", "Alfa"), secao("a2", "Zeta", "a"), secao("a1", "Gama", "a"), secao("x", "Outro", null, PC2)]
    const agentes = [agente("~/1", ["a", "a1"]), agente("~/2", ["a"]), agente("~/3", ["b"]), agente("~/4", ["a", "a1"], PC2)]
    expect(opcoesDeSecoes(secoes, agentes, PC, SEM_NOME)).toEqual([
      { id: "a", caminho: "Alfa", fundo: 1, agentes: 2, semNome: false },
      { id: "a1", caminho: "Alfa / Gama", fundo: 2, agentes: 1, semNome: false },
      { id: "a2", caminho: "Alfa / Zeta", fundo: 2, agentes: 0, semNome: false },
      { id: "b", caminho: "Beta", fundo: 1, agentes: 1, semNome: false },
    ])
  })

  it("pasta sem nome vale e aparece como pasta sem nome; pai que não existe vira raiz", () => {
    const opcoes = opcoesDeSecoes([secao("s", "", "nao-existe")], [], PC, SEM_NOME)
    expect(opcoes).toEqual([{ id: "s", caminho: SEM_NOME, fundo: 1, agentes: 0, semNome: true }])
  })

  it("ciclo de pais e mais de 10 níveis ficam de fora (o agente também não as usa)", () => {
    const ciclo = [secao("c1", "C1", "c2"), secao("c2", "C2", "c1")]
    expect(opcoesDeSecoes(ciclo, [], PC, SEM_NOME)).toEqual([])
    const funda = Array.from({ length: 12 }, (_, i) => secao(`n${i}`, `N${i}`, i ? `n${i - 1}` : null))
    expect(opcoesDeSecoes(funda, [], PC, SEM_NOME).map((o) => o.id)).toEqual(Array.from({ length: 10 }, (_, i) => `n${i}`))
  })

  it("agentes na mesma pasta de trabalho contam uma vez (o visto por último)", () => {
    const agentes = [agente("~/1", ["a"]), { ...agente("~/1", ["b"]), vistoEm: "2026-11-26T13:00:00.000Z" }]
    const opcoes = opcoesDeSecoes([secao("a", "A"), secao("b", "B")], agentes, PC, SEM_NOME)
    expect(opcoes.map((o) => [o.id, o.agentes])).toEqual([["a", 0], ["b", 1]])
  })
})

describe("o rótulo da regra escolhida", () => {
  const opcoes = opcoesDeSecoes([secao("a", "Alfa"), secao("s", "", "a")], [], PC, SEM_NOME)

  it("o caminho da pasta; sem nome, pasta sem nome; a que sumiu, marcada como sumida", () => {
    expect(rotuloDaSecao("a", opcoes)).toEqual({ texto: "Alfa", estado: "ok" })
    expect(rotuloDaSecao("s", opcoes)).toEqual({ texto: `Alfa / ${SEM_NOME}`, estado: "sem_nome" })
    expect(rotuloDaSecao("velha", opcoes)).toEqual({ texto: "velha", estado: "sumiu" })
  })

  it("o id é exato: maiúscula diferente é outra pasta (que sumiu)", () => {
    expect(rotuloDaSecao("A", opcoes).estado).toBe("sumiu")
  })
})

describe("escolher a pasta no editor", () => {
  it("só com a nuvem que guarda as pastas, o computador na 0.22.0 ou mais e o projeto rodando nele", () => {
    const lista = [u("P", { computadores: [PC] }), u("S", { pai: "P" }), u("T")]
    const ativos = [PC, PC2]
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.22.0", lista, unidade: "P", computador: PC, ativos })).toBe("sim")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.22.3", lista, unidade: "S", computador: PC, ativos })).toBe("sim")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.21.2", lista, unidade: "P", computador: PC, ativos })).toBe("versao")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "", lista, unidade: "P", computador: PC, ativos })).toBe("versao")
    expect(escolheSecoes({ secoesNaNuvem: false, versao: "0.22.0", lista, unidade: "P", computador: PC, ativos })).toBe("nao")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.22.0", lista, unidade: "P", computador: PC2, ativos })).toBe("nao")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.22.0", lista, unidade: "S", computador: PC2, ativos })).toBe("nao")
    expect(escolheSecoes({ secoesNaNuvem: true, versao: "0.22.0", lista, unidade: "T", computador: PC2, ativos })).toBe("sim")
  })

  it("adicionar põe a regra só neste computador, sem repetir; a mesma pasta noutro computador é outra regra", () => {
    let lista = [u("P"), u("Q")]
    lista = adicionarSecao(lista, "P", "a", PC)
    lista = adicionarSecao(lista, "P", "a", PC)
    lista = adicionarSecao(lista, "P", "a", PC2)
    expect(lista[0].titulos).toEqual([
      { tipo: "secao", padrao: "a", computador: PC },
      { tipo: "secao", padrao: "a", computador: PC2 },
    ])
    expect(lista[1].titulos).toEqual([])
  })

  it("a pasta já usada por outro projeto neste computador mostra o dono; a validação recusa com o erro da pasta", () => {
    const lista = adicionarSecao(adicionarSecao([u("P"), u("Q")], "Q", "a", PC), "P", "a", PC)
    expect(donoDaSecao(lista, "P", "a", PC)).toBe("Q")
    expect(donoDaSecao(lista, "P", "a", PC2)).toBeNull()
    expect(validar(lista)).toMatchObject({ chave: "erroSecao", pasta: "a" })
  })
})
