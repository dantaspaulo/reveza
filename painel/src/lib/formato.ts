// Formatação de números, dinheiro, tokens, porcentagens e tempo nos dois idiomas do painel.

import type { Idioma } from "@/dados/tipos"

const cacheNumero = new Map<string, Intl.NumberFormat>()

function nf(idioma: Idioma, opcoes: Intl.NumberFormatOptions) {
  const chave = idioma + JSON.stringify(opcoes)
  let f = cacheNumero.get(chave)
  if (!f) {
    f = new Intl.NumberFormat(idioma, opcoes)
    cacheNumero.set(chave, f)
  }
  return f
}

/** Custo equivalente em dólar: "US$ 1.234,56" / "$1,234.56". Abaixo de 1 centavo mostra "< US$ 0,01". */
export function fmtUsd(valor: number, idioma: Idioma, casas = 2): string {
  if (valor > 0 && valor < 0.01) {
    return `< ${nf(idioma, { style: "currency", currency: "USD" }).format(0.01)}`
  }
  return nf(idioma, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor)
}

/** Em real (a conversão do custo equivalente): "R$ 1.234" / "R$1,234". */
export function fmtBrl(valor: number, idioma: Idioma, casas = 0): string {
  return nf(idioma, {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor)
}

export function fmtNumero(valor: number, idioma: Idioma, casas = 0): string {
  return nf(idioma, {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor)
}

/** Número redondo em forma curta, com ou sem moeda: "100 bi", "US$ 20 mil", "R$ 200 mil" / "100B", "$20K". */
export function fmtCompacto(valor: number, idioma: Idioma, moeda?: "USD" | "BRL"): string {
  // a moeda puxa duas casas mínimas ("US$ 20,0 mil"): o número redondo sai sem casa
  return nf(idioma, {
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...(moeda ? { style: "currency", currency: moeda } : {}),
  }).format(valor)
}

/** Tokens em forma curta: "1,2 mi" / "1.2M", "345 mil" / "345K". Abaixo de mil, o número inteiro. */
export function fmtTokens(valor: number, idioma: Idioma): string {
  if (Math.abs(valor) < 1000) return fmtNumero(valor, idioma)
  return nf(idioma, { notation: "compact", maximumFractionDigits: 1 }).format(valor)
}

/** Porcentagem a partir de 0 a 100: "87%", "41,5%". */
export function fmtPct(valor: number | null | undefined, idioma: Idioma, casas = 0): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "–"
  return nf(idioma, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  }).format(valor / 100)
}

const UNIDADES = {
  "pt-BR": { s: "s", min: "min", h: "h", d: "d" },
  en: { s: "s", min: "min", h: "h", d: "d" },
} as const

/** Duração em segundos, com as duas maiores unidades: "45 s", "3 min", "1 h 52 min", "2 d 3 h". */
export function fmtDuracao(segundos: number, idioma: Idioma): string {
  const u = UNIDADES[idioma]
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return `${s} ${u.s}`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} ${u.min}`
  const h = Math.floor(min / 60)
  const restoMin = min % 60
  if (h < 24) return restoMin ? `${h} ${u.h} ${restoMin} ${u.min}` : `${h} ${u.h}`
  const d = Math.floor(h / 24)
  const restoH = h % 24
  return restoH ? `${d} ${u.d} ${restoH} ${u.h}` : `${d} ${u.d}`
}

/** "agora", "há 3 min", "há 2 h" / "just now", "3 min ago". */
export function fmtRelativo(data: string | number | Date | null | undefined, agora: Date, idioma: Idioma): string {
  if (!data) return idioma === "en" ? "never" : "nunca"
  const t = paraData(data)
  const seg = (agora.getTime() - t.getTime()) / 1000
  if (seg < 0) return fmtFuturo(t, agora, idioma)
  if (seg < 10) return idioma === "en" ? "just now" : "agora"
  const texto = fmtDuracao(seg, idioma)
  return idioma === "en" ? `${texto} ago` : `há ${texto}`
}

/** "em 1 h 20 min" / "in 1 h 20 min". */
export function fmtFuturo(data: string | number | Date, agora: Date, idioma: Idioma): string {
  const t = paraData(data)
  const seg = (t.getTime() - agora.getTime()) / 1000
  if (seg <= 0) return idioma === "en" ? "now" : "agora"
  const texto = fmtDuracao(seg, idioma)
  return idioma === "en" ? `in ${texto}` : `em ${texto}`
}

export function fmtHora(data: string | Date, idioma: Idioma): string {
  const t = typeof data === "string" ? new Date(data) : data
  return t.toLocaleTimeString(idioma, { hour: "2-digit", minute: "2-digit" })
}

/** Dia curto: "12 out" / "Oct 12". */
export function fmtDia(data: string | Date, idioma: Idioma): string {
  const t = typeof data === "string" ? new Date(data) : data
  return t.toLocaleDateString(idioma, { day: "numeric", month: "short" }).replace(/\.$/, "").replace(" de ", " ")
}

/** Dia da semana curto: "sex" / "Fri". */
export function fmtDiaSemana(data: string | Date, idioma: Idioma): string {
  const t = typeof data === "string" ? new Date(data) : data
  return t.toLocaleDateString(idioma, { weekday: "short" }).replace(/\.$/, "")
}

/** Data e hora: dentro de 6 dias, "sex 14:30"; mais longe, "12 out 14:30". */
export function fmtDataHora(data: string | Date, agora: Date, idioma: Idioma): string {
  const t = typeof data === "string" ? new Date(data) : data
  const dias = Math.abs(t.getTime() - agora.getTime()) / 86_400_000
  const dia = dias < 6 ? fmtDiaSemana(t, idioma) : fmtDia(t, idioma)
  return `${dia} ${fmtHora(t, idioma)}`
}

/** Chave de dia no fuso de quem vê: "2026-10-11". */
export function chaveDia(data: string | Date): string {
  const t = typeof data === "string" ? new Date(data) : data
  const a = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, "0")
  const d = String(t.getDate()).padStart(2, "0")
  return `${a}-${m}-${d}`
}

/** Iniciais para o avatar: "Ana Souza" -> "AS"; "ops@exemplo.com" -> "OP". */
export function iniciais(nomeOuEmail: string): string {
  const base = nomeOuEmail.split("@")[0].trim()
  const partes = base.split(/[\s._-]+/).filter(Boolean)
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

/** Data de texto ISO, Date ou número (epoch em segundos ou em milissegundos), sem quebrar a tela. */
export function paraData(v: string | number | Date): Date {
  if (v instanceof Date) return v
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v)
  return new Date(v)
}
