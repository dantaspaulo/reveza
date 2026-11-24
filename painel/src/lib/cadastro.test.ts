import { describe, expect, it } from "vitest"

import type { Empresa } from "@/dados/tipos"

import {
  alteradas,
  alternarComputador,
  computadoresAtivos,
  contasDe,
  ligada,
  modoAlternado,
  ondeEsta,
  pastasEm,
  planoDeGravar,
  rascunhoDe,
  rodaEm,
  rodaNoComputador,
  saemDaConta,
  validar,
  type UnidadeRascunho,
} from "./cadastro"

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
  ...campos,
})
const pasta = (padrao: string, computador: string | null = null) => ({ padrao, computador })

describe("a chave de ligar", () => {
  it("empresa em teste conta como desligada", () => {
    const e = u("e", { modo: "sombra" })
    expect(ligada(e, [e])).toBe(false)
    expect(modoAlternado(e, [e])).toBe("ligado")
  })

  it("projeto segue a empresa; virar a chave para o mesmo estado volta a seguir", () => {
    const e = u("e", { modo: "ligado", contas: ["a"] })
    const p = u("p", { pai: "e", modo: null })
    expect(ligada(p, [e, p])).toBe(true)
    expect(modoAlternado(p, [e, p])).toBe("desligado")
    const fora = { ...p, modo: "desligado" as const }
    expect(modoAlternado(fora, [e, fora])).toBeNull()
  })

  it("projeto em teste segue o estado real da empresa", () => {
    const e = u("e", { modo: "ligado" })
    const p = u("p", { pai: "e", modo: "sombra" })
    expect(ligada(p, [e, p])).toBe(true)
  })
})

describe("contas e pastas", () => {
  it("projeto sem conta usa a da empresa; com conta, só a dele", () => {
    const e = u("e", { contas: ["a"] })
    const p = u("p", { pai: "e" })
    const q = u("q", { pai: "e", contas: ["b"] })
    expect(contasDe(p, [e, p, q])).toEqual(["a"])
    expect(contasDe(q, [e, p, q])).toEqual(["b"])
  })

  it("a pasta vale no computador dela ou em todos", () => {
    const e = u("e", { pastas: [pasta("~/todos"), pasta("~/um", "pc1"), pasta("~/dois", "pc2")] })
    expect(pastasEm(e, "pc1").map((x) => x.pasta.padrao)).toEqual(["~/todos", "~/um"])
  })

  it("a empresa roda onde ela ou um projeto dela tem pasta", () => {
    const e = u("e")
    const p = u("p", { pai: "e", pastas: [pasta("~/p", "pc1")] })
    expect(rodaEm(e, [e, p], "pc1")).toBe(true)
    expect(rodaEm(e, [e, p], "pc2")).toBe(false)
  })
})

describe("conferir antes de salvar", () => {
  it("pede nome e conta", () => {
    expect(validar([u("e", { nome: " " })])?.chave).toBe("erroNomeEmpresa")
    expect(validar([u("e", { modo: "ligado" })])?.chave).toBe("erroConta")
  })

  it("projeto ligado sem conta passa se a empresa tem conta", () => {
    const e = u("e", { contas: ["a"] })
    expect(validar([e, u("p", { pai: "e", modo: "ligado" })])).toBeNull()
    expect(validar([u("e"), u("p", { pai: "e", modo: "ligado" })])?.chave).toBe("erroConta")
  })

  it("regra por título de agente conta como rodar no computador, e removê-la é uma mudança", () => {
    const regra = { tipo: "titulo" as const, padrao: "Agente X", computador: "pc1" }
    const e = u("e", { titulos: [regra] })
    expect(rodaEm(e, [e], "pc1")).toBe(true)
    expect(rodaEm(e, [e], "pc2")).toBe(false)
    const sem = { ...e, titulos: [] }
    expect(alteradas([e], [sem]).map((x) => x.id)).toEqual(["e"])
    expect(planoDeGravar([e], [sem])[0].campos.pastas).toEqual([])
  })

  it("o que outra pessoa salvou enquanto eu editava não volta ao valor antigo", () => {
    const foto = [u("a", { nome: "A" }), u("b", { nome: "B" })]
    const meu = [u("a", { nome: "A editada" }), u("b", { nome: "B" })]
    expect(planoDeGravar(foto, meu).map((p) => p.id)).toEqual(["a"])
  })

  it("cadastro antigo com problema não impede de salvar outra empresa", () => {
    const antiga = u("antiga", { modo: "ligado" })
    const editada = u("editada", { nome: "Nova" })
    expect(validar([antiga, editada], [editada])).toBeNull()
  })

  it("a empresa que muda confere também os projetos dela", () => {
    const e = u("e", { contas: [] })
    const p = u("p", { pai: "e", modo: "ligado" })
    expect(validar([e, p], [e])).toMatchObject({ id: "p", chave: "erroConta" })
  })

  it("mesmo nome só conflita dentro da mesma empresa", () => {
    expect(validar([u("e", { nome: "A" }), u("f", { nome: "a" })])?.chave).toBe("erroDuplicado")
    const lista = [u("e"), u("f"), u("p", { nome: "Site", pai: "e" }), u("q", { nome: "Site", pai: "f" })]
    expect(validar(lista)).toBeNull()
  })

  it("a mesma pasta em dois donos conflita, menos em computadores diferentes", () => {
    const um = [u("e", { pastas: [pasta("~/x/")] }), u("f", { pastas: [pasta("~/X", "pc1")] })]
    expect(validar(um)).toMatchObject({ chave: "erroPasta", pasta: "~/x/", dono: "f" })
    const dois = [u("e", { pastas: [pasta("~/x", "pc1")] }), u("f", { pastas: [pasta("~/x", "pc2")] })]
    expect(validar(dois)).toBeNull()
  })
})

describe("a ordem de gravar", () => {
  it("só grava o que mudou, ignorando pasta vazia", () => {
    const base = [u("e", { pastas: [pasta("~/x")] })]
    expect(alteradas(base, [u("e", { pastas: [pasta("~/x"), pasta("  ", "pc1")] })])).toEqual([])
    expect(planoDeGravar(base, base)).toEqual([])
  })

  it("empresa nova vem antes do projeto; empresa que perde a conta vem depois dele", () => {
    const base = [u("e", { contas: ["a"] }), u("p", { pai: "e", modo: "ligado" })]
    const lista = [
      u("e", { contas: [] }),
      u("p", { pai: "e", modo: "ligado", contas: ["b"] }),
      u("n", { novo: true, contas: ["c"] }),
    ]
    expect(planoDeGravar(base, lista).map((x) => x.id)).toEqual(["n", "p", "e"])
  })

  it("a pasta que muda de dono é solta antes, sem perder a regra por título", () => {
    const titulos = [{ tipo: "titulo" as const, padrao: "Agente", computador: null }]
    const base = [u("e", { pastas: [pasta("~/x"), pasta("~/fica")], titulos }), u("f")]
    const lista = [u("e", { pastas: [pasta("~/fica")], titulos }), u("f", { pastas: [pasta("~/x")] })]
    const plano = planoDeGravar(base, lista)
    expect(plano.map((x) => x.id)).toEqual(["e", "e", "f"])
    expect(plano[0].campos).toEqual({
      pastas: [{ tipo: "pasta", padrao: "~/fica", computador: null }, ...titulos],
    })
  })

  it("só o cadastro novo leva cor e empresa", () => {
    const [passo] = planoDeGravar([], [u("n", { novo: true, pai: "e", cor: 3 })])
    expect(passo.campos).toMatchObject({ cor: 3, pai: "e" })
    const [editado] = planoDeGravar([u("x")], [u("x", { nome: "Novo" })])
    expect(editado.campos).not.toHaveProperty("cor")
    expect(editado.campos).not.toHaveProperty("pai")
  })
})

describe("projeto por computador", () => {
  const ativos = ["pc1", "pc2"]
  const daNuvem = (id: string, o: Partial<Empresa> = {}): Empresa => ({
    id,
    nome: id,
    cor: 0,
    transbordo: "nenhum",
    transbordoContas: [],
    separar: false,
    criadaEm: "2026-11-01T00:00:00Z",
    pai: null,
    modo: null,
    herdarTransbordo: true,
    ...o,
  })

  it("com a escolha, aparece só nos computadores escolhidos; em todos, aparece em todos", () => {
    const so = u("e", { computadores: ["pc1"] })
    expect(rodaNoComputador(so, "pc1", ativos)).toBe(true)
    expect(rodaNoComputador(so, "pc2", ativos)).toBe(false)
    const todos = u("t", { computadores: null })
    expect(ativos.every((pc) => rodaNoComputador(todos, pc, ativos))).toBe(true)
  })

  it("nuvem antiga, sem a escolha: aparece em todos, como antes", () => {
    const antigo = u("e")
    expect(ativos.every((pc) => rodaNoComputador(antigo, pc, ativos))).toBe(true)
  })

  it("o único computador foi removido: o projeto não some, aparece em todas as abas para escolher outro", () => {
    const orfao = u("e", { computadores: ["removido"] })
    expect(ativos.every((pc) => rodaNoComputador(orfao, pc, ativos))).toBe(true)
    const misto = u("m", { computadores: ["removido", "pc2"] })
    expect(rodaNoComputador(misto, "pc1", ativos)).toBe(false)
    expect(rodaNoComputador(misto, "pc2", ativos)).toBe(true)
  })

  it("desmarcar o último computador deixa o projeto na tela até escolher outro", () => {
    expect(rodaNoComputador(u("e", { computadores: [] }), "pc1", ativos)).toBe(true)
  })

  it("computador removido não conta como lugar onde o projeto roda de verdade", () => {
    expect(computadoresAtivos(u("t", { computadores: null }), ativos)).toBeNull()
    expect(computadoresAtivos(u("a"), ativos)).toBeNull()
    expect(computadoresAtivos(u("m", { computadores: ["removido", "pc2"] }), ativos)).toEqual(["pc2"])
    expect(computadoresAtivos(u("o", { computadores: ["removido"] }), ativos)).toEqual([])
  })

  it("lê da nuvem a escolha do projeto; o subprojeto e a nuvem antiga ficam sem", () => {
    const d = {
      empresas: [
        daNuvem("e", { emTodosComputadores: false }),
        daNuvem("f", { emTodosComputadores: true }),
        daNuvem("p", { pai: "e" }),
      ],
      marcas: [],
      regras: [],
      computadoresNaNuvem: true,
      computadores: [
        { empresaId: "e", computadorId: "pc2" },
        { empresaId: "e", computadorId: "pc1" },
      ],
    }
    const de = (l: UnidadeRascunho[], id: string) => l.find((x) => x.id === id)?.computadores
    const r = rascunhoDe(d)
    expect(de(r, "e")).toEqual(["pc1", "pc2"])
    expect(de(r, "f")).toBeNull()
    expect(de(r, "p")).toBeUndefined()
    const antiga = rascunhoDe({ ...d, computadoresNaNuvem: false, computadores: [] })
    for (const id of ["e", "f", "p"]) expect(de(antiga, id)).toBeUndefined()
  })

  it("mudar os computadores é uma mudança; a ordem não conta", () => {
    const base = [u("e", { computadores: ["pc1", "pc2"] })]
    expect(alteradas(base, [u("e", { computadores: ["pc2", "pc1"] })])).toEqual([])
    expect(alteradas(base, [u("e", { computadores: ["pc1"] })]).map((x) => x.id)).toEqual(["e"])
    expect(alteradas(base, [u("e", { computadores: null })]).map((x) => x.id)).toEqual(["e"])
  })

  it("só manda os computadores quando mudaram: o que outra pessoa escolheu não volta ao valor antigo", () => {
    const base = [u("e", { computadores: ["pc1"] })]
    const [passo] = planoDeGravar(base, [u("e", { nome: "Novo", computadores: ["pc1"] })])
    expect(passo.campos).not.toHaveProperty("computadores")
    const [mudou] = planoDeGravar(base, [u("e", { computadores: ["pc2"] })])
    expect(mudou.campos.computadores).toEqual(["pc2"])
    const [todos] = planoDeGravar(base, [u("e", { computadores: null })])
    expect(todos.campos.computadores).toBeNull()
  })

  it("projeto novo leva os computadores; subprojeto e nuvem antiga nunca mandam o campo", () => {
    const [novo] = planoDeGravar([], [u("n", { novo: true, computadores: ["pc1"] })])
    expect(novo.campos.computadores).toEqual(["pc1"])
    const [sub] = planoDeGravar([], [u("s", { novo: true, pai: "e", computadores: ["pc1"] })])
    expect(sub.campos).not.toHaveProperty("computadores")
    const [antiga] = planoDeGravar([u("x")], [u("x", { nome: "Y" })])
    expect(antiga.campos).not.toHaveProperty("computadores")
  })

  it("projeto sem computador escolhido pede um antes de salvar", () => {
    expect(validar([u("e", { computadores: [] })])).toMatchObject({ id: "e", chave: "erroComputador" })
    expect(validar([u("e", { computadores: ["pc1"] })])).toBeNull()
    expect(validar([u("e", { computadores: null })])).toBeNull()
  })

  it("com Todos, clicar num computador deixa só ele", () => {
    expect(alternarComputador(null, "pc2", ativos)).toEqual(["pc2"])
  })

  it("clicar põe ou tira o computador; o último pode sair, e aí a tela pede um", () => {
    expect(alternarComputador(["pc1"], "pc2", ativos)).toEqual(["pc1", "pc2"])
    expect(alternarComputador(["pc1", "pc2"], "pc1", ativos)).toEqual(["pc2"])
    expect(alternarComputador(["pc1"], "pc1", ativos)).toEqual([])
  })

  it("computador removido sai da lista quando a pessoa mexe nela", () => {
    expect(alternarComputador(["removido", "pc1"], "pc2", ativos)).toEqual(["pc1", "pc2"])
    expect(alternarComputador(["removido", "pc1"], "pc1", ativos)).toEqual([])
  })
})

describe("onde a conta está e quem perde a conta", () => {
  const pc = (id: string, nome: string, contaId: string | null, revogado = false) => ({
    id,
    nome,
    revogado,
    atribuicao: contaId ? { contaId, motivo: "", decididoEm: "" } : null,
  })
  const pcs = [pc("pc1", "Mac", "a"), pc("pc2", "VPS", "b"), pc("pc3", "Velho", "a", true), pc("pc4", "Novo", null)]
  const trilha = (computadorId: string, empresaId: string, contaId: string) => ({ computadorId, empresaId, contaId })

  it("mostra a conta em uso de cada computador e a trilha de cada projeto; computador removido não conta", () => {
    const lista = [u("e", { nome: "Alfa" }), u("p", { nome: "Site", pai: "e" })]
    expect(ondeEsta("a", pcs, [trilha("pc2", "p", "a"), trilha("pc3", "e", "a")], lista)).toEqual([
      { computadorId: "pc1", computador: "Mac", unidade: null },
      { computadorId: "pc2", computador: "VPS", unidade: "Alfa / Site" },
    ])
  })

  it("conta parada não está em lugar nenhum", () => {
    expect(ondeEsta("z", pcs, [], [])).toEqual([])
  })

  it("marcar a conta num projeto ligado tira ela da conta em uso do computador", () => {
    const antes = [u("e", { modo: "ligado", contas: ["c"] })]
    const agora = [u("e", { modo: "ligado", contas: ["c", "a"] })]
    expect(saemDaConta(agora[0]!, agora, antes, "a", pcs)).toEqual(["Mac"])
  })

  it("ligar um projeto que já tinha a conta também tira", () => {
    const antes = [u("e", { modo: "desligado", contas: ["a"] })]
    const agora = [u("e", { modo: "ligado", contas: ["a"] })]
    expect(saemDaConta(agora[0]!, agora, antes, "a", pcs)).toEqual(["Mac"])
  })

  it("projeto novo ligado com a conta tira", () => {
    const novo = u("n", { novo: true, modo: "ligado", contas: ["b"] })
    expect(saemDaConta(novo, [novo], [], "b", pcs)).toEqual(["VPS"])
  })

  it("não avisa quando nada muda: já era dele, desligado, conta sem marca ou computador removido", () => {
    const ja = [u("e", { modo: "ligado", contas: ["a"] })]
    expect(saemDaConta(ja[0]!, ja, ja, "a", pcs)).toEqual([])
    const off = [u("e", { modo: "desligado", contas: ["a"] })]
    expect(saemDaConta(off[0]!, off, [], "a", pcs)).toEqual([])
    const semMarca = [u("e", { modo: "ligado", contas: ["c"] })]
    expect(saemDaConta(semMarca[0]!, semMarca, [], "a", pcs)).toEqual([])
    const so = [pc("pc3", "Velho", "a", true)]
    const novo = [u("e", { modo: "ligado", contas: ["a"] })]
    expect(saemDaConta(novo[0]!, novo, [], "a", so)).toEqual([])
  })
})
