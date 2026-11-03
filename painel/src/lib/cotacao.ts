// Cotação do dólar para mostrar o custo equivalente também em real (pedido do Paulo, 03/11/2026): a PTAX de venda do
// Banco Central, a referência oficial, pela API pública dele (responde ao painel pelo CORS; a CSP libera o endereço).
// Guardada no navegador por 6 horas; sem resposta, o painel só não mostra o real.

import * as React from "react"

export interface Cotacao {
  /** Reais por dólar (PTAX de venda). */
  valor: number
  /** Dia da cotação, "AAAA-MM-DD". */
  dia: string
}

const BASE = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata"
const GUARDA = "reveza:ptax"
const VALE_MS = 6 * 3_600_000

const mdy = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`

/** Os últimos 10 dias: a PTAX não sai no fim de semana nem no feriado, e a de hoje só depois das 13h. */
export function urlPtax(agora: Date): string {
  const de = new Date(agora.getTime() - 10 * 86_400_000)
  return (
    `${BASE}/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${mdy(de)}'&@dataFinalCotacao='${mdy(agora)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`
  )
}

/** A cotação mais recente da resposta (ou null se não veio nada que preste). */
export function lerPtax(json: unknown): Cotacao | null {
  const lista = (json as { value?: unknown } | null)?.value
  if (!Array.isArray(lista)) return null
  let melhor: Cotacao | null = null
  for (const item of lista) {
    const valor = Number((item as { cotacaoVenda?: unknown }).cotacaoVenda)
    const dia = String((item as { dataHoraCotacao?: unknown }).dataHoraCotacao ?? "").slice(0, 10)
    if (!Number.isFinite(valor) || valor <= 0 || valor > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue
    if (!melhor || dia >= melhor.dia) melhor = { valor, dia }
  }
  return melhor
}

export async function buscarCotacao(buscar: typeof fetch = fetch, agora = new Date()): Promise<Cotacao | null> {
  try {
    const r = await buscar(urlPtax(agora), { headers: { Accept: "application/json" } })
    return r.ok ? lerPtax(await r.json()) : null
  } catch {
    return null
  }
}

function guardada(): (Cotacao & { em: number }) | null {
  try {
    const v = JSON.parse(localStorage.getItem(GUARDA) ?? "null")
    return v && typeof v.valor === "number" && typeof v.dia === "string" && typeof v.em === "number" ? v : null
  } catch {
    return null
  }
}

/** A cotação fixa da demonstração (sem rede: a demonstração e os testes não saem do navegador). */
export const COTACAO_DEMO: Cotacao = { valor: 5.4, dia: "2026-10-30" }

/**
 * A cotação para converter o custo (null enquanto não chega, ou desligado). `fixa`: a da demonstração. A guardada no
 * navegador vale enquanto a nova não chega (e por 6 horas, sem pedir de novo).
 */
export function useCotacaoDolar(ligado: boolean, fixa?: Cotacao): Cotacao | null {
  const [buscada, setBuscada] = React.useState<Cotacao | null>(null)
  React.useEffect(() => {
    if (!ligado || fixa) return
    const g = guardada()
    if (g && Date.now() - g.em < VALE_MS) return
    let vivo = true
    void buscarCotacao().then((c) => {
      if (!vivo || !c) return
      setBuscada(c)
      try {
        localStorage.setItem(GUARDA, JSON.stringify({ ...c, em: Date.now() }))
      } catch {
        // aba privada: segue sem guardar
      }
    })
    return () => {
      vivo = false
    }
  }, [ligado, fixa])
  const g = ligado && !fixa ? (buscada ?? guardada()) : null
  const valor = g?.valor ?? null
  const dia = g?.dia ?? null
  // o mesmo objeto enquanto a cotação não muda: quem depende dela não refaz o desenho a cada render
  const lida = React.useMemo(() => (valor !== null && dia !== null ? { valor, dia } : null), [valor, dia])
  if (!ligado) return null
  return fixa ?? lida
}
