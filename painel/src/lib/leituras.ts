// Leituras do período: frases curtas tiradas dos números do uso, para quem não vai ler os gráficos (pedido do Paulo,
// 03/11/2026: "Queria que tivesse insights"). Só o que os dados mostram, sem adivinhar: cada leitura tem um piso para
// aparecer, e o texto fica no i18n (aqui saem o tipo e os números).

import type { LinhaUso, SessaoUso } from "@/dados/tipos"
import { chaveDia } from "./formato"
import { mapaCalor, ranking, totais } from "./uso"

export type Leitura =
  /** Custo por dia contra o período anterior de mesmo tamanho (fração: 0,25 = 25% a mais). */
  | { tipo: "tendencia"; variacao: number; dias: number }
  /** Fração dos tokens que foi releitura da conversa (cache lido). */
  | { tipo: "cache"; fatia: number }
  /** Sessões com uso no período que começaram há mais de uma semana. */
  | { tipo: "longas"; n: number; maisAntiga: number; usd: number }
  /** Sessões de até 3 respostas (execuções automáticas, em geral). */
  | { tipo: "curtas"; n: number; fatia: number }
  | { tipo: "modelo"; modelo: string; fatia: number }
  | { tipo: "projeto"; projeto: string; fatia: number }
  | { tipo: "pico"; dia: string; usd: number; respostas: number }
  /** Dia da semana (0 = segunda) e hora com mais custo. */
  | { tipo: "horario"; diaSemana: number; hora: number }

const DIA_MS = 86_400_000
export const LONGA_DIAS = 7
const CURTA_RESPOSTAS = 3

export function leituras({
  uso,
  sessoes,
  anterior,
  de,
  agora,
  diasPeriodo,
  maximo = 6,
}: {
  uso: LinhaUso[]
  sessoes: SessaoUso[]
  /** O uso do período anterior, de mesmo tamanho (null: ainda carregando ou sem). */
  anterior: LinhaUso[] | null
  de: Date
  agora: Date
  diasPeriodo: number
  maximo?: number
}): Leitura[] {
  const tot = totais(uso)
  if (tot.respostas === 0) return []
  const lista: Leitura[] = []

  // tendência: só com o período anterior coberto (uso em 70% dos dias): o registro novo não tem o mês de antes
  if (anterior && anterior.length) {
    const diasComUso = new Set(anterior.map((l) => chaveDia(l.hora))).size
    const ant = totais(anterior).usd
    const corridos = Math.max((agora.getTime() - de.getTime()) / DIA_MS, 1 / 24)
    if (ant > 0 && diasComUso >= diasPeriodo * 0.7) {
      const variacao = tot.usd / corridos / (ant / diasPeriodo) - 1
      if (Math.abs(variacao) >= 0.05) lista.push({ tipo: "tendencia", variacao, dias: diasPeriodo })
    }
  }

  if (tot.tokens > 0 && tot.cacheLeitura / tot.tokens >= 0.5) {
    lista.push({ tipo: "cache", fatia: tot.cacheLeitura / tot.tokens })
  }

  const limiteLonga = agora.getTime() - LONGA_DIAS * DIA_MS
  const longas = sessoes.filter((s) => new Date(s.inicio).getTime() < limiteLonga)
  if (longas.length) {
    const maisAntiga = Math.min(...longas.map((s) => new Date(s.inicio).getTime()))
    lista.push({
      tipo: "longas",
      n: longas.length,
      maisAntiga: Math.floor((agora.getTime() - maisAntiga) / DIA_MS),
      usd: longas.reduce((s, x) => s + x.usd, 0),
    })
  }

  const curtas = sessoes.filter((s) => s.respostas <= CURTA_RESPOSTAS).length
  if (curtas >= 20 && curtas / sessoes.length >= 0.3) {
    lista.push({ tipo: "curtas", n: curtas, fatia: curtas / sessoes.length })
  }

  const [modelo] = ranking(uso, "modelo", "usd")
  if (modelo && modelo.fatia >= 0.5) lista.push({ tipo: "modelo", modelo: modelo.grupo, fatia: modelo.fatia })

  const projeto = ranking(uso, "projeto", "usd").find((p) => p.grupo !== "sem_projeto")
  if (projeto && projeto.fatia >= 0.4) lista.push({ tipo: "projeto", projeto: projeto.grupo, fatia: projeto.fatia })

  const porDia = new Map<string, { usd: number; respostas: number }>()
  for (const l of uso) {
    const d = porDia.get(chaveDia(l.hora)) ?? { usd: 0, respostas: 0 }
    d.usd += l.usd
    d.respostas += l.respostas
    porDia.set(chaveDia(l.hora), d)
  }
  if (porDia.size > 1) {
    const [dia, v] = [...porDia.entries()].sort((a, b) => b[1].usd - a[1].usd)[0]!
    lista.push({ tipo: "pico", dia, usd: v.usd, respostas: v.respostas })
  }

  const calor = mapaCalor(uso, "usd")
  let maior = { d: 0, h: 0, v: 0 }
  calor.forEach((linha, d) => linha.forEach((v, h) => v > maior.v && (maior = { d, h, v })))
  if (maior.v > 0) lista.push({ tipo: "horario", diaSemana: maior.d, hora: maior.h })

  return lista.slice(0, maximo)
}
