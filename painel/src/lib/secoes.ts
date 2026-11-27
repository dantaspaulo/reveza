// 0.22.0 (parte D2): escolher, no editor do projeto, pastas da barra do OpenBot de um computador. A regra (tipo
// "secao", o padrão é o id exato da pasta) põe no projeto os agentes daquela pasta e das subpastas, só naquele
// computador. Sem React, para testar sozinho.

import type { AgenteOpenBot, SecaoOpenBot } from "@/dados/tipos"

import { agentesDoComputador } from "./agentes"
import { computadoresAtivos, type UnidadeRascunho } from "./cadastro"
import { nomeUnidade, versaoNum } from "./empresas"

/** A primeira versão do agente que manda as pastas e entende a regra (antes dela, a nuvem não a entrega ao computador). */
export const VERSAO_SECOES = "0.22.0"

/** Mais fundo que isso, o formato é suspeito: o agente não usa a pasta, e o painel não a oferece. */
const NIVEIS = 10

export interface OpcaoSecao {
  id: string
  /** "Pasta / Subpasta", com o texto de pasta sem nome no lugar do nome vazio. */
  caminho: string
  /** 1 na raiz. */
  fundo: number
  /** Os agentes do computador que estão nela ou numa subpasta dela. */
  agentes: number
  semNome: boolean
}

/**
 * As pastas da barra do OpenBot de um computador, em árvore: a pasta antes das subpastas, cada nível por nome. Pai que
 * não existe faz a pasta virar raiz; ciclo e mais de 10 níveis ficam de fora, como no agente.
 */
export function opcoesDeSecoes(
  secoes: SecaoOpenBot[],
  agentes: AgenteOpenBot[],
  computador: string,
  semNome: string
): OpcaoSecao[] {
  const daqui = secoes.filter((s) => s.computadorId === computador)
  const porId = new Map(daqui.map((s) => [s.id, s]))
  const filhos = new Map<string | null, SecaoOpenBot[]>()
  for (const s of porId.values()) {
    const pai = s.pai !== null && porId.has(s.pai) && s.pai !== s.id ? s.pai : null
    filhos.set(pai, [...(filhos.get(pai) ?? []), s])
  }
  const cadeias = agentesDoComputador(agentes, computador).map((a) => a.secoes ?? [])
  const r: OpcaoSecao[] = []
  const visitar = (pai: string | null, caminho: string[], fundo: number) => {
    if (fundo > NIVEIS) return
    const lista = [...(filhos.get(pai) ?? [])].sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id))
    for (const s of lista) {
      const nome = s.nome.trim()
      const aqui = [...caminho, nome || semNome]
      r.push({
        id: s.id,
        caminho: aqui.join(" / "),
        fundo,
        agentes: cadeias.filter((c) => c.includes(s.id)).length,
        semNome: !nome,
      })
      visitar(s.id, aqui, fundo + 1)
    }
  }
  visitar(null, [], 1)
  return r
}

export type EstadoSecao = "ok" | "sem_nome" | "sumiu"

/** O que mostrar da regra escolhida: o caminho da pasta, ou o id dela quando ela sumiu da barra (ou do OpenBot). */
export function rotuloDaSecao(id: string, opcoes: OpcaoSecao[]): { texto: string; estado: EstadoSecao } {
  const o = opcoes.find((x) => x.id === id)
  if (!o) return { texto: id, estado: "sumiu" }
  return { texto: o.caminho, estado: o.semNome ? "sem_nome" : "ok" }
}

/**
 * Se a unidade pode escolher pastas do OpenBot neste computador. "nao": a nuvem não guarda as pastas ou o projeto não
 * roda aqui (a regra não teria efeito); "versao": o computador ainda não entende a regra.
 */
export function escolheSecoes(o: {
  secoesNaNuvem: boolean | undefined
  versao: string | null | undefined
  lista: UnidadeRascunho[]
  unidade: string
  computador: string
  ativos: string[]
}): "sim" | "nao" | "versao" {
  if (!o.secoesNaNuvem) return "nao"
  const u = o.lista.find((x) => x.id === o.unidade)
  const raiz = u?.pai ? o.lista.find((x) => x.id === u.pai) : u
  if (!raiz) return "nao"
  const onde = computadoresAtivos(raiz, o.ativos)
  if (onde !== null && !onde.includes(o.computador)) return "nao"
  return versaoNum(o.versao) >= versaoNum(VERSAO_SECOES) ? "sim" : "versao"
}

/** Põe a pasta na unidade, só neste computador; a mesma pasta já escolhida aqui não se repete. */
export function adicionarSecao(lista: UnidadeRascunho[], unidade: string, id: string, computador: string): UnidadeRascunho[] {
  return lista.map((u) =>
    u.id !== unidade || u.titulos.some((t) => t.tipo === "secao" && t.padrao === id && t.computador === computador)
      ? u
      : { ...u, titulos: [...u.titulos, { tipo: "secao" as const, padrao: id, computador }] }
  )
}

/** O nome de outra unidade que já tem esta pasta neste computador, ou null. */
export function donoDaSecao(lista: UnidadeRascunho[], unidade: string, id: string, computador: string): string | null {
  const dono = lista.find(
    (x) =>
      x.id !== unidade &&
      x.titulos.some((t) => t.tipo === "secao" && t.padrao.trim() === id && (t.computador === null || t.computador === computador))
  )
  return dono ? nomeUnidade(dono, lista) : null
}

/** O caminho de uma pasta pelo id, em qualquer computador (para a mensagem de erro do cadastro); sem ela, o próprio id. */
export function caminhoDaSecao(id: string, secoes: SecaoOpenBot[], semNome: string): string {
  const s = secoes.find((x) => x.id === id)
  if (!s) return id
  return rotuloDaSecao(id, opcoesDeSecoes(secoes, [], s.computadorId, semNome)).texto
}
