// Empresas (0.20.0): o rascunho da tela de cadastro, a conferência antes de salvar e a ordem de gravar. Sem React, para
// testar sozinho. A nuvem confere tudo de novo em painel_unidade: aqui é para dizer o problema antes de gravar a metade.

import type { CamposUnidade } from "@/dados/fonte"
import type { DadosEmpresas, ModoUnidade, RegraPasta } from "@/dados/tipos"

import { modoDe, nomeUnidade, normalizarPasta, ordenarUnidades } from "./empresas"

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
  /** 0.20.1. null: roda em todos; lista: só nesses; undefined: nuvem antiga ou subprojeto (segue o projeto). */
  computadores?: string[] | null
}

export interface ErroCadastro {
  id: string
  chave: "erroNomeEmpresa" | "erroNomeProjeto" | "erroConta" | "erroDuplicado" | "erroPasta" | "erroComputador"
  nome?: string
  pasta?: string
  dono?: string
}

export interface PassoGravar {
  id: string
  novo: boolean
  campos: CamposUnidade
}

export function rascunhoDe(
  d: Pick<DadosEmpresas, "empresas" | "marcas" | "regras"> &
    Partial<Pick<DadosEmpresas, "computadoresNaNuvem" | "computadores">>
): UnidadeRascunho[] {
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
      computadores:
        !d.computadoresNaNuvem || e.pai
          ? undefined
          : e.emTodosComputadores === false
            ? (d.computadores ?? [])
                .filter((l) => l.empresaId === e.id)
                .map((l) => l.computadorId)
                .sort()
            : null,
    }
  })
}

/**
 * 0.20.1: o projeto aparece na aba deste computador. Sem nenhum computador ativo na escolha (o último foi removido, ou
 * a pessoa acabou de desmarcar), aparece em todas: nada some da tela antes de escolher outro.
 */
export function rodaNoComputador(u: UnidadeRascunho, computador: string, ativos: string[]): boolean {
  if (u.computadores == null) return true
  if (u.computadores.includes(computador)) return true
  return !u.computadores.some((c) => ativos.includes(c))
}

/** 0.20.1: os computadores ativos onde o projeto roda de verdade; null é "todos". Computador removido não conta. */
export function computadoresAtivos(u: UnidadeRascunho, ativos: string[]): string[] | null {
  return u.computadores == null ? null : u.computadores.filter((c) => ativos.includes(c))
}

/** 0.20.1: clicar num computador. De "todos" fica só ele; computador removido sai da lista quando a pessoa mexe nela. */
export function alternarComputador(atual: string[] | null | undefined, computador: string, ativos: string[]): string[] {
  if (atual == null) return [computador]
  const validos = atual.filter((c) => ativos.includes(c))
  return validos.includes(computador) ? validos.filter((c) => c !== computador) : [...validos, computador]
}

type PcDaConta = { id: string; nome: string; revogado: boolean; atribuicao: { contaId: string | null } | null }

/** Onde uma conta está em uso: `unidade` null é a conta principal do computador. */
export interface OndeEsta {
  computadorId: string
  computador: string
  unidade: string | null
}

/** 0.20.1: os lugares em que a conta está agora, por computador ativo: a principal e as trilhas de cada projeto. */
export function ondeEsta(
  contaId: string,
  computadores: PcDaConta[],
  trilhas: { computadorId: string; empresaId: string; contaId: string }[],
  lista: UnidadeRascunho[]
): OndeEsta[] {
  const r: OndeEsta[] = []
  const poe = (c: PcDaConta, unidade: string | null) => {
    if (!r.some((x) => x.computadorId === c.id && x.unidade === unidade))
      r.push({ computadorId: c.id, computador: c.nome, unidade })
  }
  for (const c of computadores) {
    if (c.revogado) continue
    if (c.atribuicao?.contaId === contaId) poe(c, null)
    for (const t of trilhas) {
      if (t.computadorId !== c.id || t.contaId !== contaId) continue
      const u = lista.find((x) => x.id === t.empresaId)
      // trilha de um projeto que saiu da lista: a conta segue em uso, só sem o nome
      poe(c, u ? nomeUnidade(u, lista) : null)
    }
  }
  return r
}

/**
 * 0.20.1: os computadores que saem desta conta ao salvar. Conta marcada num projeto ligado deixa de servir de conta
 * principal em qualquer computador (rvz_principal_pode), então quem está nela troca. Já era assim antes: não avisa.
 */
export function saemDaConta(
  u: UnidadeRascunho,
  lista: UnidadeRascunho[],
  antes: UnidadeRascunho[],
  contaId: string,
  computadores: PcDaConta[]
): string[] {
  if (!ligada(u, lista) || !contasDe(u, lista).includes(contaId)) return []
  if (antes.some((x) => ligada(x, antes) && contasDe(x, antes).includes(contaId))) return []
  return computadores.filter((c) => !c.revogado && c.atribuicao?.contaId === contaId).map((c) => c.nome)
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

/** A escolha de computadores como texto: a ordem não conta, e "todos" é diferente de "nuvem antiga". */
const chaveComputadores = (u: UnidadeRascunho) =>
  u.computadores == null ? String(u.computadores) : [...u.computadores].sort().join(",")

function assinatura(u: UnidadeRascunho): string {
  return JSON.stringify([
    u.nome.trim(),
    u.modo,
    [...u.contas].sort(),
    pastasValidas(u)
      .map((p) => `${p.computador ?? ""}|${p.padrao}`)
      .sort(),
    u.titulos.map((r) => `${r.computador ?? ""}|${r.padrao}`).sort(),
    chaveComputadores(u),
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
    if (!u.pai && Array.isArray(u.computadores) && !u.computadores.length) return { id: u.id, chave: "erroComputador", nome }
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

// os computadores só vão quando mudaram: salvar outro campo não desfaz o que outra pessoa escolheu nesse meio tempo
const camposDe = (u: UnidadeRascunho, antes?: UnidadeRascunho): CamposUnidade => ({
  nome: u.nome.trim(),
  modo: u.modo,
  contas: u.contas,
  pastas: [...pastasValidas(u).map((p) => ({ tipo: "pasta" as const, ...p })), ...u.titulos],
  ...(u.novo ? { cor: u.cor, ...(u.pai ? { pai: u.pai } : {}) } : {}),
  ...(!u.pai && u.computadores !== undefined && (u.novo || !antes || chaveComputadores(u) !== chaveComputadores(antes))
    ? { computadores: u.computadores }
    : {}),
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
  const passo = (u: UnidadeRascunho): PassoGravar => ({
    id: u.id,
    novo: u.novo,
    campos: camposDe(
      u,
      base.find((x) => x.id === u.id)
    ),
  })
  return [
    ...passos,
    ...empresas.filter((u) => u.novo || u.contas.length).map(passo),
    ...mudou.filter((u) => u.pai).map(passo),
    ...empresas.filter((u) => !u.novo && !u.contas.length).map(passo),
  ]
}
