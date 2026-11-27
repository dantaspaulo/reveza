import { describe, expect, it } from "vitest"

import type { EstadoConta } from "@/dados/derivados"
import type { Computador, Conta } from "@/dados/tipos"

import type { UnidadeRascunho } from "./cadastro"
import { checarLigar } from "./checagem"

// 0.22.1 (item 5): a checagem automática antes de ligar um projeto, no lugar do ensaio manual.

const MAC = "pc-mac"
const VPS = "pc-vps"
const agora = new Date("2026-11-27T12:00:00Z")
const umaHora = "2026-11-27T11:00:00Z"
const tresDias = "2026-11-24T12:00:00Z"

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
const c = (id: string): Conta => ({ id, email: `${id}@exemplo.com` }) as Conta
type Pc = Pick<Computador, "id" | "nome" | "versao" | "vistoEm" | "revogado" | "atribuicao">
const pc = (id: string, extra: Partial<Pc> = {}): Pc => ({
  id,
  nome: id === MAC ? "Mac" : id === VPS ? "VPS" : id,
  versao: "0.22.0",
  vistoEm: umaHora,
  revogado: false,
  atribuicao: null,
  ...extra,
})
const usa = (contaId: string) => ({ contaId, motivo: "decidir", decididoEm: umaHora })

const checar = (
  antes: UnidadeRascunho[],
  lista: UnidadeRascunho[],
  contas: Conta[],
  estados: Record<string, EstadoConta> = {},
  computadores: Pc[] = [pc(MAC)]
) => checarLigar(antes, lista, { contas, estadoDe: (x) => estados[x.id] ?? "livre", computadores, agora })

describe("checarLigar: só o que passa a ficar ligado", () => {
  it("empresa já ligada que só muda o nome: nada a checar", () => {
    const antes = [u("alfa", { modo: "ligado", contas: ["c1"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"], nome: "Alfa nova" })]
    expect(checar(antes, lista, [c("c1")], { c1: "precisa_login" })).toEqual({ recusas: [], avisos: [] })
  })

  it("empresa que desliga: nada a checar", () => {
    const antes = [u("alfa", { modo: "ligado", contas: ["c1"] })]
    const lista = [u("alfa", { modo: "desligado", contas: ["c1"] })]
    expect(checar(antes, lista, [c("c1")], { c1: "saindo" })).toEqual({ recusas: [], avisos: [] })
  })

  it("liga com uma conta livre e o computador na 0.21 ou mais: sem recusa nem aviso", () => {
    const antes = [u("alfa", { contas: ["c1"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"] })]
    expect(checar(antes, lista, [c("c1")])).toEqual({ recusas: [], avisos: [] })
  })

  it("sair do modo teste para ligado também é ligar", () => {
    const antes = [u("alfa", { modo: "sombra", contas: ["c1"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"] })]
    expect(checar(antes, lista, [c("c1")], { c1: "pausada" }).recusas).toHaveLength(1)
  })

  it("projeto novo que já nasce ligado é checado", () => {
    const lista = [u("novo-1", { novo: true, modo: "ligado", contas: ["c1"] })]
    expect(checar([], lista, [c("c1")], { c1: "precisa_login" }).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "novo-1", contas: [{ id: "c1", motivo: "precisa_login" }] },
    ])
  })
})

describe("checarLigar: nenhuma conta que rode recusa", () => {
  it("todas sem login, saindo ou pausadas: recusa com o motivo de cada uma", () => {
    const antes = [u("alfa", { contas: ["c1", "c2", "c3"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1", "c2", "c3"] })]
    const r = checar(antes, lista, [c("c1"), c("c2"), c("c3")], { c1: "precisa_login", c2: "saindo", c3: "pausada" })
    expect(r.recusas).toEqual([
      {
        tipo: "semContaQueRode",
        unidade: "alfa",
        contas: [
          { id: "c1", motivo: "precisa_login" },
          { id: "c2", motivo: "saindo" },
          { id: "c3", motivo: "pausada" },
        ],
      },
    ])
  })

  it("uma conta boa e uma sem login: não recusa", () => {
    const antes = [u("alfa", { contas: ["c1", "c2"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1", "c2"] })]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c1: "precisa_login" }).recusas).toEqual([])
  })

  it("conta marcada que não existe mais conta como não roda", () => {
    const antes = [u("alfa", { contas: ["c9"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c9"] })]
    expect(checar(antes, lista, [c("c1")]).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "alfa", contas: [{ id: "c9", motivo: "sumiu" }] },
    ])
  })

  it("todas esgotadas ou perto do limite: não recusa, avisa que as conversas esperam", () => {
    const antes = [u("alfa", { contas: ["c1", "c2"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1", "c2"] })]
    const r = checar(antes, lista, [c("c1"), c("c2")], { c1: "esgotada", c2: "aviso" })
    expect(r.recusas).toEqual([])
    expect(r.avisos).toEqual([{ tipo: "esperam", unidade: "alfa" }])
  })

  it("só esgotadas: não recusa (voltam sozinhas), avisa que as conversas esperam", () => {
    const antes = [u("alfa", { contas: ["c1", "c2"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1", "c2"] })]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c1: "esgotada", c2: "esgotada" })).toEqual({
      recusas: [],
      avisos: [{ tipo: "esperam", unidade: "alfa" }],
    })
  })

  it("uma esgotada e uma livre: sem aviso de espera", () => {
    const antes = [u("alfa", { contas: ["c1", "c2"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1", "c2"] })]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c1: "esgotada" }).avisos).toEqual([])
  })

  it("sem conta nenhuma fica com o erro de sempre (validar), não com esta recusa", () => {
    const antes = [u("alfa")]
    const lista = [u("alfa", { modo: "ligado" })]
    expect(checar(antes, lista, [c("c1")])).toEqual({ recusas: [], avisos: [] })
  })
})

describe("checarLigar: projetos dentro da empresa", () => {
  it("projeto sem conta própria liga junto: a empresa responde por ele, sem recusa repetida", () => {
    const antes = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: null })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"] }), u("p1", { pai: "alfa", modo: null })]
    expect(checar(antes, lista, [c("c1")], { c1: "saindo" }).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "alfa", contas: [{ id: "c1", motivo: "saindo" }] },
    ])
  })

  it("projeto com conta própria liga junto: checado com as contas dele", () => {
    const antes = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: null, contas: ["c2"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"] }), u("p1", { pai: "alfa", modo: null, contas: ["c2"] })]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c2: "precisa_login" }).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "p1", contas: [{ id: "c2", motivo: "precisa_login" }] },
    ])
  })

  it("projeto com modo próprio desligado não liga junto com a empresa", () => {
    const antes = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: "desligado", contas: ["c2"] })]
    const lista = [
      u("alfa", { modo: "ligado", contas: ["c1"] }),
      u("p1", { pai: "alfa", modo: "desligado", contas: ["c2"] }),
    ]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c2: "precisa_login" }).recusas).toEqual([])
  })

  it("projeto novo numa empresa já ligada, sem conta própria: checado com as contas dela (não passa calado)", () => {
    const antes = [u("alfa", { modo: "ligado", contas: ["c1"] })]
    const lista = [u("alfa", { modo: "ligado", contas: ["c1"] }), u("novo-2", { novo: true, pai: "alfa", modo: null })]
    expect(checar(antes, lista, [c("c1")], { c1: "precisa_login" }).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "novo-2", contas: [{ id: "c1", motivo: "precisa_login" }] },
    ])
    expect(checar(antes, lista, [c("c1")]).recusas).toEqual([])
  })

  it("projeto que liga sozinho, empresa desligada, sem conta própria: usa as contas da empresa", () => {
    const antes = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: null })]
    const lista = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: "ligado" })]
    expect(checar(antes, lista, [c("c1")], { c1: "pausada" }).recusas).toEqual([
      { tipo: "semContaQueRode", unidade: "p1", contas: [{ id: "c1", motivo: "pausada" }] },
    ])
  })
})

describe("checarLigar: computador sem a espera da 0.21.0 recusa", () => {
  const antes = [u("alfa", { contas: ["c1"] })]
  const lista = [u("alfa", { modo: "ligado", contas: ["c1"] })]

  it("computador visto há 1 h na 0.20.2: recusa com o nome e a versão", () => {
    expect(checar(antes, lista, [c("c1")], {}, [pc(MAC), pc(VPS, { versao: "0.20.2" })]).recusas).toEqual([
      { tipo: "computadorSemEspera", unidade: "alfa", computador: "VPS", versao: "0.20.2" },
    ])
  })

  it("visto há 3 dias, ou removido: não recusa (como a nuvem)", () => {
    const pcs = [pc(MAC, { versao: "0.20.2", vistoEm: tresDias }), pc(VPS, { versao: "0.20.2", revogado: true })]
    expect(checar(antes, lista, [c("c1")], {}, pcs).recusas).toEqual([])
  })

  it("nunca visto: não recusa", () => {
    expect(checar(antes, lista, [c("c1")], {}, [pc(MAC, { versao: "", vistoEm: null })]).recusas).toEqual([])
  })

  it("fora do Roda em da empresa: não recusa", () => {
    const so = [u("alfa", { modo: "ligado", contas: ["c1"], computadores: [MAC] })]
    const pcs = [pc(MAC), pc(VPS, { versao: "0.20.2" })]
    expect(checar([u("alfa", { contas: ["c1"], computadores: [MAC] })], so, [c("c1")], {}, pcs).recusas).toEqual([])
  })

  it("versão que não se lê num computador visto: recusa (não se sabe se ele espera)", () => {
    expect(checar(antes, lista, [c("c1")], {}, [pc(MAC, { versao: "?" })]).recusas).toEqual([
      { tipo: "computadorSemEspera", unidade: "alfa", computador: "Mac", versao: "?" },
    ])
  })

  it("0.21.0 exata passa", () => {
    expect(checar(antes, lista, [c("c1")], {}, [pc(MAC, { versao: "0.21.0" })]).recusas).toEqual([])
  })

  it("projeto que liga sozinho usa os computadores da empresa", () => {
    const a = [u("alfa", { contas: ["c1"], computadores: [VPS] }), u("p1", { pai: "alfa", modo: null })]
    const l = [u("alfa", { contas: ["c1"], computadores: [VPS] }), u("p1", { pai: "alfa", modo: "ligado" })]
    const pcs = [pc(MAC, { versao: "0.20.2" }), pc(VPS, { versao: "0.20.2" })]
    expect(checar(a, l, [c("c1")], {}, pcs).recusas).toEqual([
      { tipo: "computadorSemEspera", unidade: "p1", computador: "VPS", versao: "0.20.2" },
    ])
  })

  it("projeto com conta própria que liga junto com a empresa: o computador atrasado sai uma vez só, na empresa", () => {
    const a = [u("alfa", { contas: ["c1"] }), u("p1", { pai: "alfa", modo: null, contas: ["c2"] })]
    const l = [u("alfa", { modo: "ligado", contas: ["c1"] }), u("p1", { pai: "alfa", modo: null, contas: ["c2"] })]
    expect(checar(a, l, [c("c1"), c("c2")], {}, [pc(MAC, { versao: "0.20.2" })]).recusas).toEqual([
      { tipo: "computadorSemEspera", unidade: "alfa", computador: "Mac", versao: "0.20.2" },
    ])
  })

  it("duas recusas na mesma unidade saem as duas, conta antes de computador", () => {
    const r = checar(antes, lista, [c("c1")], { c1: "saindo" }, [pc(VPS, { versao: "0.20.0" }), pc(MAC, { versao: "0.19.0" })])
    expect(r.recusas.map((x) => x.tipo === "computadorSemEspera" ? x.computador : x.tipo)).toEqual([
      "semContaQueRode",
      "Mac",
      "VPS",
    ])
  })
})

describe("checarLigar: o relatório de quem troca de conta", () => {
  const antes = [u("alfa", { contas: ["c1"] })]
  const lista = [u("alfa", { modo: "ligado", contas: ["c1"] })]

  it("computador que usa uma conta fora do projeto: as conversas do projeto ali passam para uma conta dele", () => {
    const pcs = [pc(MAC, { atribuicao: usa("c2") }), pc(VPS, { atribuicao: usa("c1") })]
    expect(checar(antes, lista, [c("c1"), c("c2")], {}, pcs).avisos).toEqual([
      { tipo: "trocam", unidade: "alfa", computador: "Mac", contaId: "c2" },
    ])
  })

  it("computador sem conta atribuída, removido ou fora do Roda em: fora do relatório", () => {
    const pcs = [pc(MAC), pc(VPS, { atribuicao: usa("c2"), revogado: true }), pc("pc-air", { atribuicao: { contaId: null, motivo: "x", decididoEm: umaHora } })]
    expect(checar(antes, lista, [c("c1"), c("c2")], {}, pcs).avisos).toEqual([])
    const so = [u("alfa", { modo: "ligado", contas: ["c1"], computadores: [MAC] })]
    expect(checar([u("alfa", { contas: ["c1"], computadores: [MAC] })], so, [c("c1"), c("c2")], {}, [pc(MAC), pc(VPS, { atribuicao: usa("c2") })]).avisos).toEqual([])
  })

  it("com recusa de conta, não promete troca nem espera", () => {
    const pcs = [pc(MAC, { atribuicao: usa("c2") })]
    expect(checar(antes, lista, [c("c1"), c("c2")], { c1: "saindo" }, pcs).avisos).toEqual([])
  })
})
