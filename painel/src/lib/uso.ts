// Agregações do uso (tabela uso_tokens, uma linha por hora, conta, computador, projeto e modelo).

import type { LinhaUso, SessaoUso } from "@/dados/tipos"
import { chaveDia } from "./formato"

export type Dimensao = "conta" | "modelo" | "projeto" | "computador"
export type Metrica = "usd" | "tokens" | "respostas"

export interface Totais {
  usd: number
  tokens: number
  entrada: number
  saida: number
  cacheEscrita: number
  cacheLeitura: number
  respostas: number
  agentes: number
}

export function tokensDa(l: LinhaUso): number {
  return l.entrada + l.saida + l.cacheEscrita + l.cacheLeitura
}

export function valorDa(l: LinhaUso, m: Metrica): number {
  if (m === "usd") return l.usd
  if (m === "respostas") return l.respostas
  return tokensDa(l)
}

export function grupoDa(l: LinhaUso, d: Dimensao): string {
  if (d === "conta") return l.contaId ?? "sem_conta"
  if (d === "modelo") return l.modelo
  if (d === "computador") return l.computadorId
  return l.projeto || "sem_projeto"
}

export function totais(linhas: LinhaUso[]): Totais {
  const t: Totais = {
    usd: 0,
    tokens: 0,
    entrada: 0,
    saida: 0,
    cacheEscrita: 0,
    cacheLeitura: 0,
    respostas: 0,
    agentes: 0,
  }
  for (const l of linhas) {
    t.usd += l.usd
    t.entrada += l.entrada
    t.saida += l.saida
    t.cacheEscrita += l.cacheEscrita
    t.cacheLeitura += l.cacheLeitura
    t.respostas += l.respostas
    t.agentes += l.agentes
  }
  t.tokens = t.entrada + t.saida + t.cacheEscrita + t.cacheLeitura
  return t
}

/** Lista dos dias (chave local "AAAA-MM-DD") entre duas datas, inclusive. */
export function diasEntre(de: Date, ate: Date): string[] {
  const dias: string[] = []
  const d = new Date(de.getFullYear(), de.getMonth(), de.getDate())
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate())
  while (d.getTime() <= fim.getTime()) {
    dias.push(chaveDia(d))
    d.setDate(d.getDate() + 1)
  }
  return dias
}

/** Uma linha por dia, com uma coluna por grupo: [{ dia, grupoA: 1.2, grupoB: 0 }, ...]. */
export function porDia(
  linhas: LinhaUso[],
  dimensao: Dimensao,
  metrica: Metrica,
  dias: string[],
  mapaGrupo: (g: string) => string = (g) => g
): { dados: Record<string, number | string>[]; grupos: string[] } {
  const grupos = new Set<string>()
  const porChave = new Map<string, Record<string, number | string>>()
  for (const dia of dias) porChave.set(dia, { dia })
  for (const l of linhas) {
    const dia = chaveDia(l.hora)
    const linha = porChave.get(dia)
    if (!linha) continue
    const g = mapaGrupo(grupoDa(l, dimensao))
    grupos.add(g)
    linha[g] = ((linha[g] as number) ?? 0) + valorDa(l, metrica)
  }
  const lista = [...grupos]
  const dados = [...porChave.values()].map((linha) => {
    for (const g of lista) if (linha[g] === undefined) linha[g] = 0
    return linha
  })
  return { dados, grupos: lista }
}

export interface ItemRanking {
  grupo: string
  valor: number
  fatia: number
}

export function ranking(linhas: LinhaUso[], dimensao: Dimensao, metrica: Metrica): ItemRanking[] {
  const soma = new Map<string, number>()
  for (const l of linhas) {
    const g = grupoDa(l, dimensao)
    soma.set(g, (soma.get(g) ?? 0) + valorDa(l, metrica))
  }
  const total = [...soma.values()].reduce((a, b) => a + b, 0)
  return [...soma.entries()]
    .map(([grupo, valor]) => ({
      grupo,
      valor,
      fatia: total > 0 ? valor / total : 0,
    }))
    .sort((a, b) => b.valor - a.valor)
}

/** Mapa de calor 7 x 24: linha 0 = segunda ... 6 = domingo; coluna = hora local. */
export function mapaCalor(linhas: LinhaUso[], metrica: Metrica): number[][] {
  const m = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const l of linhas) {
    const t = new Date(l.hora)
    const dia = (t.getDay() + 6) % 7
    m[dia][t.getHours()] += valorDa(l, metrica)
  }
  return m
}

/**
 * Sessões novas (pelo dia em que começaram) e agentes (pela hora em que cada um começou, das linhas de uso) por dia. Os
 * agentes não saem das sessões: a sessão de editor fica aberta por semanas, e os agentes dela iam todos para o 1º dia.
 */
export function sessoesPorDia(
  sessoes: SessaoUso[],
  uso: LinhaUso[],
  dias: string[]
): { dia: string; sessoes: number; agentes: number }[] {
  const mapa = new Map(dias.map((d) => [d, { dia: d, sessoes: 0, agentes: 0 }]))
  for (const s of sessoes) {
    const linha = mapa.get(chaveDia(s.inicio))
    if (linha) linha.sessoes += 1
  }
  for (const l of uso) {
    const linha = mapa.get(chaveDia(l.hora))
    if (linha) linha.agentes += l.agentes
  }
  return [...mapa.values()]
}
