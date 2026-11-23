// Empresas (0.20.0): o rascunho da tela de cadastro, a conferência antes de salvar e a ordem de gravar. Sem React, para
// testar sozinho. A nuvem confere tudo de novo em painel_unidade: aqui é para dizer o problema antes de gravar a metade.

import type { CamposUnidade } from "@/dados/fonte"
import type { DadosEmpresas, ModoUnidade, RegraPasta } from "@/dados/tipos"

import { modoDe, normalizarPasta, ordenarUnidades } from "./empresas"

export interface PastaRascunho {
  /** null: vale em todos os computadores. */
  computador: string | null
  padrao: string
}

export interface UnidadeRascunho {
  id: string
  /** Ainda não existe na nuvem: o id é provisório. */
  novo: boolean
  nome: string
  pai: string | null
  cor: number
  /** Na empresa, sempre o modo que vale; no projeto, null é "igual à empresa". */
  modo: ModoUnidade | null
  contas: string[]
  pastas: PastaRascunho[]
  /** As regras por título de agente: aparecem como etiqueta junto da pasta e podem ser removidas. */
  titulos: { tipo: RegraPasta["tipo"]; padrao: string; computador: string | null }[]
}

export interface ErroCadastro {
  id: string
  chave: "erroNomeEmpresa" | "erroNomeProjeto" | "erroConta" | "erroDuplicado" | "erroPasta"
  nome?: string
  pasta?: string
  dono?: string
}

export interface PassoGravar {
  id: string
  novo: boolean
  campos: CamposUnidade
}

export function rascunhoDe(d: Pick<DadosEmpresas, "empresas" | "marcas" | "regras">): UnidadeRascunho[] {
  return ordenarUnidades(d.empresas).map((e) => {
    const regras = d.regras.filter((r) => r.empresaId === e.id)
    return {
      id: e.id,
      novo: false,
      nome: e.nome,
      pai: e.pai,
      cor: e.cor,
      modo: e.pai ? e.modo : modoDe(e, d.empresas),
      contas: d.marcas
        .filter((m) => m.empresaId === e.id)
        .map((m) => m.contaId)
        .sort(),
      pastas: regras
        .filter((r) => r.tipo === "pasta")
        .map((r) => ({ computador: r.computadorId ?? null, padrao: r.padrao })),
      titulos: regras
        .filter((r) => r.tipo === "titulo")
        .map((r) => ({ tipo: r.tipo, padrao: r.padrao, computador: r.computadorId ?? null })),
    }
  })
}

/** Em teste (sombra) nada muda nas sessões: conta como desligada, e o projeto em teste segue a empresa. */
export function ligada(u: UnidadeRascunho, lista: UnidadeRascunho[]): boolean {
  if (!u.pai) return u.modo === "ligado"
  if (u.modo === "ligado") return true
  if (u.modo === "desligado") return false
  return lista.find((x) => x.id === u.pai)?.modo === "ligado"
}

/** O modo depois de virar a chave. No projeto, ficar igual à empresa volta a seguir a empresa. */
export function modoAlternado(u: UnidadeRascunho, lista: UnidadeRascunho[]): ModoUnidade | null {
  const novo = !ligada(u, lista)
  if (!u.pai) return novo ? "ligado" : "desligado"
  const empresaLigada = lista.find((x) => x.id === u.pai)?.modo === "ligado"
  if (novo === empresaLigada) return null
  return novo ? "ligado" : "desligado"
}

/** As contas em que a unidade roda: as dela ou, no projeto sem nenhuma, as da empresa. */
export function contasDe(u: UnidadeRascunho, lista: UnidadeRascunho[]): string[] {
  if (u.contas.length || !u.pai) return u.contas
  return lista.find((x) => x.id === u.pai)?.contas ?? []
}

export function pastasEm(u: UnidadeRascunho, computador: string): { pasta: PastaRascunho; indice: number }[] {
  return u.pastas
    .map((pasta, indice) => ({ pasta, indice }))
    .filter(({ pasta }) => pasta.computador === null || pasta.computador === computador)
}

/** A unidade tem pasta ou regra de agente valendo neste computador. */
export function temRegraEm(u: UnidadeRascunho, computador: string): boolean {
  return (
    pastasEm(u, computador).some(({ pasta }) => pasta.padrao.trim()) ||
    u.titulos.some((r) => r.computador === null || r.computador === computador)
  )
}

/** A empresa roda neste computador se ela ou um projeto dela tem pasta ou regra de agente aqui. */
export function rodaEm(e: UnidadeRascunho, lista: UnidadeRascunho[], computador: string): boolean {
  return temRegraEm(e, computador) || lista.some((p) => p.pai === e.id && temRegraEm(p, computador))
}

function pastasValidas(u: UnidadeRascunho): PastaRascunho[] {
  const vistas = new Set<string>()
  const r: PastaRascunho[] = []
  for (const p of u.pastas) {
    const padrao = p.padrao.trim()
    const chave = `${p.computador ?? ""}|${normalizarPasta(padrao)}`
    if (!padrao || vistas.has(chave)) continue
    vistas.add(chave)
    r.push({ computador: p.computador, padrao })
  }
  return r
}

function assinatura(u: UnidadeRascunho): string {
  return JSON.stringify([
    u.nome.trim(),
    u.modo,
    [...u.contas].sort(),
    pastasValidas(u)
      .map((p) => `${p.computador ?? ""}|${p.padrao}`)
      .sort(),
    u.titulos.map((r) => `${r.computador ?? ""}|${r.padrao}`).sort(),
  ])
}

/** As unidades que mudaram em relação ao que está na nuvem. */
export function alteradas(base: UnidadeRascunho[], lista: UnidadeRascunho[]): UnidadeRascunho[] {
  const antes = new Map(base.map((u) => [u.id, assinatura(u)]))
  return lista.filter((u) => u.novo || antes.get(u.id) !== assinatura(u))
}

const colidem = (a: PastaRascunho, b: PastaRascunho) =>
  normalizarPasta(a.padrao) === normalizarPasta(b.padrao) &&
  (a.computador === null || b.computador === null || a.computador === b.computador)

/**
 * Confere só o que mudou (e os projetos da empresa que mudou): um cadastro antigo com problema não impede de salvar
 * outra empresa.
 */
export function validar(lista: UnidadeRascunho[], mudou: UnidadeRascunho[] = lista): ErroCadastro | null {
  const ids = new Set(mudou.map((u) => u.id))
  for (const u of lista.filter((x) => ids.has(x.id) || (x.pai !== null && ids.has(x.pai)))) {
    const nome = u.nome.trim()
    if (!nome) return { id: u.id, chave: u.pai ? "erroNomeProjeto" : "erroNomeEmpresa" }
    if (ligada(u, lista) && !contasDe(u, lista).length) return { id: u.id, chave: "erroConta", nome }
    const igual = lista.some(
      (x) => x.id !== u.id && x.pai === u.pai && x.nome.trim().toLowerCase() === nome.toLowerCase()
    )
    if (igual) return { id: u.id, chave: "erroDuplicado", nome }
    for (const p of pastasValidas(u)) {
      const dono = lista.find((x) => x.id !== u.id && pastasValidas(x).some((q) => colidem(p, q)))
      if (dono) return { id: u.id, chave: "erroPasta", pasta: p.padrao, dono: dono.nome.trim() }
    }
  }
  return null
}

const camposDe = (u: UnidadeRascunho): CamposUnidade => ({
  nome: u.nome.trim(),
  modo: u.modo,
  contas: u.contas,
  pastas: [...pastasValidas(u).map((p) => ({ tipo: "pasta" as const, ...p })), ...u.titulos],
  ...(u.novo ? { cor: u.cor, ...(u.pai ? { pai: u.pai } : {}) } : {}),
})

/**
 * A ordem de gravar, porque a nuvem confere cada unidade sozinha: primeiro solta a pasta que mudou de dono; depois as
 * empresas com conta (o projeto pode depender delas); os projetos; e por fim a empresa que ficou sem conta, quando
 * nenhum projeto ligado depende mais dela.
 */
export function planoDeGravar(base: UnidadeRascunho[], lista: UnidadeRascunho[]): PassoGravar[] {
  const mudou = alteradas(base, lista)
  const passos: PassoGravar[] = []
  for (const u of mudou) {
    const antes = base.find((x) => x.id === u.id)
    if (!antes || u.novo) continue
    const agora = pastasValidas(u)
    const fica = (p: PastaRascunho) =>
      agora.some((q) => q.computador === p.computador && normalizarPasta(q.padrao) === normalizarPasta(p.padrao))
    const sai = antes.pastas.filter((p) => !fica(p))
    const outroQuer = sai.some((p) => lista.some((x) => x.id !== u.id && pastasValidas(x).some((q) => colidem(p, q))))
    if (outroQuer)
      passos.push({
        id: u.id,
        novo: false,
        campos: { pastas: [...antes.pastas.filter(fica).map((p) => ({ tipo: "pasta" as const, ...p })), ...u.titulos] },
      })
  }
  const empresas = mudou.filter((u) => !u.pai)
  const passo = (u: UnidadeRascunho): PassoGravar => ({ id: u.id, novo: u.novo, campos: camposDe(u) })
  return [
    ...passos,
    ...empresas.filter((u) => u.novo || u.contas.length).map(passo),
    ...mudou.filter((u) => u.pai).map(passo),
    ...empresas.filter((u) => !u.novo && !u.contas.length).map(passo),
  ]
}
