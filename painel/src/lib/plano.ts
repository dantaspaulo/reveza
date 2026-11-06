// Ritmo da semana e previsão de esgotar: contas puras, testadas, que as telas de Uso, Contas e Visão geral usam.

import type { PontoHistorico } from "@/dados/tipos"

export const SEMANA_MS = 7 * 86_400_000
export const DIA_MS = 86_400_000

export type Ritmo = "abaixo" | "no_ritmo" | "acima" | "esgotada" | "sem_dado"

export interface Plano {
  /** Início da janela da semana (reset menos 7 dias). */
  inicio: Date
  reset: Date
  /** Teto que vale para a conta: 100 ou o teto semanal escolhido. */
  limite: number
  usado: number
  /** Quanto já devia ter ido se o uso fosse igual em todos os dias. */
  esperadoAgora: number
  /** Cota de cada dia inteiro: limite dividido por 7. */
  cotaDia: number
  /** O que sobra dividido pelos dias que faltam até renovar. */
  porDiaRestante: number
  diasRestantes: number
  ritmo: Ritmo
  /** No ritmo médio desde o início da semana, quando chega ao limite (null se não chega antes do reset). */
  esgotaEm: Date | null
}

export function planoSemana({
  p7,
  resetEm,
  agora,
  teto,
  folga = 10,
}: {
  p7: number | null
  resetEm: string | Date | null
  agora: Date
  teto?: number | null
  folga?: number
}): Plano | null {
  if (!resetEm) return null
  const reset = new Date(resetEm)
  const inicio = new Date(reset.getTime() - SEMANA_MS)
  const limite = teto ?? 100
  const decorrido = Math.min(1, Math.max(0, (agora.getTime() - inicio.getTime()) / SEMANA_MS))
  const esperadoAgora = decorrido * limite
  const msRestantes = Math.max(0, reset.getTime() - agora.getTime())
  const diasRestantes = msRestantes / DIA_MS
  const usado = p7 ?? 0
  const sobra = Math.max(0, limite - usado)
  const porDiaRestante = diasRestantes > 0 ? sobra / Math.max(diasRestantes, 1 / 24) : 0
  let ritmo: Ritmo = "no_ritmo"
  if (p7 === null) ritmo = "sem_dado"
  else if (usado >= limite) ritmo = "esgotada"
  else if (usado > esperadoAgora + folga) ritmo = "acima"
  else if (usado < esperadoAgora - folga) ritmo = "abaixo"

  let esgotaEm: Date | null = null
  const decorridoMs = agora.getTime() - inicio.getTime()
  if (usado > 0 && usado < limite && decorridoMs > 0) {
    const porMs = usado / decorridoMs
    const t = inicio.getTime() + limite / porMs
    if (t < reset.getTime()) esgotaEm = new Date(t)
  }
  return {
    inicio,
    reset,
    limite,
    usado,
    esperadoAgora,
    cotaDia: limite / 7,
    porDiaRestante,
    diasRestantes,
    ritmo,
    esgotaEm,
  }
}

/**
 * Uso de cada dia da semana corrente a partir do histórico (pontos de 5 em 5 minutos): a subida de p7 dentro do dia.
 * Um reset no meio (p7 que cai) recomeça a conta do zero.
 */
export function usoPorDia(pontos: Pick<PontoHistorico, "em" | "p7">[], inicio: Date, dias = 7): number[] {
  const resultado = new Array(dias).fill(0)
  const ordenados = pontos
    .filter((p) => p.p7 !== null)
    .map((p) => ({ t: new Date(p.em).getTime(), v: p.p7 as number }))
    .filter((p) => p.t >= inicio.getTime())
    .sort((a, b) => a.t - b.t)
  for (let i = 1; i < ordenados.length; i++) {
    const a = ordenados[i - 1]
    const b = ordenados[i]
    const d = Math.floor((b.t - inicio.getTime()) / DIA_MS)
    if (d < 0 || d >= dias) continue
    const subida = b.v >= a.v ? b.v - a.v : b.v
    resultado[d] += subida
  }
  return resultado.map((v) => Math.round(v * 10) / 10)
}

export interface Previsao {
  janela: "cinco_horas" | "semana"
  em: Date
}

/**
 * Previsão de quando a conta esgota, pela inclinação recente (mínimos quadrados) de cada janela:
 * 5 horas olha a última hora; a semana olha as últimas 24 horas. Só conta o que chega antes do reset da janela.
 */
export function preverEsgotar({
  pontos,
  agora,
  reset5,
  reset7,
  atual5,
  atual7,
}: {
  pontos: Pick<PontoHistorico, "em" | "p5" | "p7">[]
  agora: Date
  reset5: Date | null
  reset7: Date | null
  atual5: number | null
  atual7: number | null
}): Previsao | null {
  const candidatas: Previsao[] = []
  const tentar = (
    janela: Previsao["janela"],
    campo: "p5" | "p7",
    atual: number | null,
    reset: Date | null,
    olharMs: number
  ) => {
    if (atual === null || atual >= 100) return
    const desde = agora.getTime() - olharMs
    const serie = pontos
      .filter((p) => p[campo] !== null && new Date(p.em).getTime() >= desde)
      .map((p) => ({
        x: (new Date(p.em).getTime() - agora.getTime()) / 3_600_000,
        y: p[campo] as number,
      }))
    const inclinacao = inclinacaoMinimosQuadrados(serie)
    if (inclinacao === null || inclinacao <= 0.05) return
    const horas = (100 - atual) / inclinacao
    const em = new Date(agora.getTime() + horas * 3_600_000)
    if (reset && em.getTime() >= reset.getTime()) return
    candidatas.push({ janela, em })
  }
  tentar("cinco_horas", "p5", atual5, reset5, 3_600_000)
  tentar("semana", "p7", atual7, reset7, DIA_MS)
  if (!candidatas.length) return null
  return candidatas.sort((a, b) => a.em.getTime() - b.em.getTime())[0]
}

/** Inclinação (y por unidade de x) por mínimos quadrados; null com menos de 3 pontos ou x sem variação. */
export function inclinacaoMinimosQuadrados(pontos: { x: number; y: number }[]): number | null {
  if (pontos.length < 3) return null
  const n = pontos.length
  const mx = pontos.reduce((s, p) => s + p.x, 0) / n
  const my = pontos.reduce((s, p) => s + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of pontos) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  return den === 0 ? null : num / den
}
