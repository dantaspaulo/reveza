import { describe, expect, it } from "vitest"

import {
  alteradas,
  contasDe,
  ligada,
  modoAlternado,
  pastasEm,
  planoDeGravar,
  rodaEm,
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
