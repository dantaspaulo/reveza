// Leituras derivadas do instantâneo, usadas por várias telas.

import type { Computador, ConfigTroca, Conta, Instantaneo, Janela, TipoJanela } from "./tipos"

/** O formato que a nuvem aceita para o modelo de uma conta (migração 0025): apelido ou ID, minúsculo, com [1m] opcional. */
export const FORMATO_MODELO = /^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$/

/** Os apelidos do Claude Code que o painel oferece prontos; outro modelo entra digitado. */
export const MODELOS_PRONTOS = ["opus", "sonnet", "haiku", "opusplan"] as const

/** O modelo como a nuvem grava: sem espaço nas pontas e minúsculo; vazio vira null (o agente não mexe). */
export function normalizarModelo(v: string | null | undefined): string | null {
  const m = (v ?? "").trim().toLowerCase()
  return m === "" ? null : m
}

export function janela(c: Conta, tipo: TipoJanela): Janela | undefined {
  return c.janelas.find((j) => j.tipo === tipo)
}

/** % de uma janela, com reset já vencido contando como zero. */
export function pctJanela(c: Conta, tipo: TipoJanela, agora: Date): number | null {
  const j = janela(c, tipo)
  if (!j || j.pct === null) return null
  if (j.resetEm && new Date(j.resetEm).getTime() <= agora.getTime()) return 0
  return j.pct
}

export function p5(c: Conta, agora: Date) {
  return pctJanela(c, "five_hour", agora)
}

export function p7(c: Conta, agora: Date) {
  return pctJanela(c, "seven_day", agora)
}

/** A maior entre as janelas (5 horas, semana e semana por família de modelo). */
export function cheia(c: Conta, agora: Date): number | null {
  const valores = c.janelas.map((j) => pctJanela(c, j.tipo, agora)).filter((v): v is number => v !== null)
  return valores.length ? Math.max(...valores) : null
}

export type EstadoConta = "precisa_login" | "pausada" | "esgotada" | "em_uso" | "aviso" | "reserva" | "livre"

export function estadoConta(c: Conta, config: ConfigTroca, agora: Date): EstadoConta {
  if (c.precisaLogin) return "precisa_login"
  if (c.pausada) return "pausada"
  const v = cheia(c, agora)
  if (v !== null && v >= 100) return "esgotada"
  if (c.posse?.motivo === "uso") return v !== null && v >= config.aviso ? "aviso" : "em_uso"
  if (v !== null && v >= config.troca) return "aviso"
  if (c.reserva) return "reserva"
  return "livre"
}

export type EstadoComputador = "online" | "atrasado" | "parado" | "revogado"

/**
 * Quanto o relógio dos dados anda além da última leitura. Menor que os 30 s de "online" menos a busca de 5 s dos
 * computadores: a leitura que atrasou não tira do "online" quem está em dia.
 */
export const FOLGA_DO_RELOGIO_MS = 20_000

/** Leitura mais velha que isto (o painel relê a cada 30 s) quer dizer que o painel deixou de ler: o cabeçalho avisa. */
export const LEITURA_VELHA_MS = 45_000

/**
 * O relógio contra o qual se julga o que a nuvem contou. Com a leitura em dia é o relógio de verdade; com o painel sem
 * ler (aba congelada pelo navegador, rede fora), para em `lidoEm` mais a folga: o que o painel não viu ele não sabe, e
 * a cegueira dele não vira "atrasado" nem "parado" nos computadores (o cabeçalho é que avisa que está reconectando).
 */
export function relogioDosDados(agora: Date, lidoEm: Date | null | undefined): Date {
  if (!lidoEm) return agora
  const limite = lidoEm.getTime() + FOLGA_DO_RELOGIO_MS
  return agora.getTime() > limite ? new Date(limite) : agora
}

/**
 * Busca a cada 5 s: até 30 s é normal, até 2 min está atrasado, mais que isso parou. `lidoEm` é quando o painel leu a
 * nuvem pela última vez (ver relogioDosDados).
 */
export function estadoComputador(pc: Computador, agora: Date, lidoEm?: Date | null): EstadoComputador {
  if (pc.revogado) return "revogado"
  if (!pc.vistoEm) return "parado"
  const seg = (relogioDosDados(agora, lidoEm).getTime() - new Date(pc.vistoEm).getTime()) / 1000
  if (seg <= 30) return "online"
  if (seg <= 120) return "atrasado"
  return "parado"
}

/** Próximo reset de uma janela (para "renova em"). */
export function resetDe(c: Conta, tipo: TipoJanela): Date | null {
  const j = janela(c, tipo)
  return j?.resetEm ? new Date(j.resetEm) : null
}

export function nomePlano(c: Pick<Conta, "plano" | "nivel">): string | null {
  if (!c.plano) return null
  const plano = c.plano.charAt(0).toUpperCase() + c.plano.slice(1)
  return c.nivel ? `${plano} ${c.nivel}` : plano
}

export function contaPorId(estado: Instantaneo, id: string | null | undefined): Conta | undefined {
  return id ? estado.contas.find((c) => c.id === id) : undefined
}

export function computadorPorId(estado: Instantaneo, id: string | null | undefined): Computador | undefined {
  return id ? estado.computadores.find((c) => c.id === id) : undefined
}

/** A versão mais nova entre os computadores (comparação por partes numéricas). */
export function versaoMaisNova(versoes: string[]): string | null {
  const ordenadas = [...versoes].sort(compararVersao)
  return ordenadas.pop() ?? null
}

export function compararVersao(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

export type TipoFaixa =
  "precisa_login" | "sem_livre" | "computador_parado" | "login_vence" | "auto_desligada" | "versao_antiga"

export interface FaixaAlerta {
  tipo: TipoFaixa
  nivel: "erro" | "atencao" | "info"
  contaId?: string
  computadorId?: string
}

/** As faixas de alerta da visão geral, da mais grave para a mais leve. */
export function faixasDeAlerta(e: Instantaneo, agora: Date, lidoEm?: Date | null): FaixaAlerta[] {
  const faixas: FaixaAlerta[] = []
  const ativos = e.computadores.filter((c) => !c.revogado)
  for (const pc of ativos) {
    if (pc.atribuicao && pc.atribuicao.contaId === null)
      faixas.push({ tipo: "sem_livre", nivel: "erro", computadorId: pc.id })
  }
  for (const c of e.contas) {
    if (c.precisaLogin) faixas.push({ tipo: "precisa_login", nivel: "erro", contaId: c.id })
  }
  for (const pc of ativos) {
    if (estadoComputador(pc, agora, lidoEm) === "parado")
      faixas.push({ tipo: "computador_parado", nivel: "atencao", computadorId: pc.id })
  }
  // A validade guardada é a do token de acesso (algumas horas), que o computador renova sozinho com o token de
  // renovação: a conta segue conectada. Login perdido de verdade aparece como "precisa entrar de novo" (acima).
  const nova = versaoMaisNova(ativos.map((c) => c.versao))
  for (const pc of ativos) {
    if (nova && compararVersao(pc.versao, nova) < 0)
      faixas.push({ tipo: "versao_antiga", nivel: "info", computadorId: pc.id })
  }
  if (!e.config.auto) faixas.push({ tipo: "auto_desligada", nivel: "info" })
  return faixas
}

export type SituacaoDoPainel = "ao_vivo" | "reconectando" | "sem_rede"

/**
 * O que o cabeçalho diz sobre o próprio painel. "Ao vivo" com a rede e a última leitura em dia (com o aviso ao vivo da
 * nuvem ele relê a cada mudança; sem ele, a cada 30 s); leitura que falhou ou ficou velha (a aba congelada pelo
 * navegador, por exemplo) é "reconectando", com o último estado lido na tela. Nada disso mexe nos computadores: eles
 * trocam sozinhos com o painel aberto, fechado ou congelado.
 */
export function situacaoDoPainel(p: { online: boolean; erro: unknown; atualizadoEm: Date; agora: Date }): SituacaoDoPainel {
  if (!p.online) return "sem_rede"
  if (p.erro || p.agora.getTime() - p.atualizadoEm.getTime() > LEITURA_VELHA_MS) return "reconectando"
  return "ao_vivo"
}
