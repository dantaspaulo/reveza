// O assistente de código de cada computador (0.8.0): a versão de cada um, qual é a mais nova entre eles e quem está
// atrás. Pedido do Paulo, 15/10/2026: "temos dois pcs, e eles estão com versões diferentes".

import { compararVersao, versaoMaisNova } from "@/dados/derivados"
import type { Computador } from "@/dados/tipos"

/** O pedido desta aba conta como "atualizando" no máximo por este tempo (o `claude update` baixa o programa). */
export const ESPERA_PEDIDO_MS = 15 * 60_000

/** O momento de um pedido (relógio do navegador), fora do componente: o desenho da tela não lê o relógio. */
export function momentoDoPedido(): number {
  return Date.now()
}

export type EstadoAssistente = "mais_nova" | "atras" | "sem_versao" | "atualizando"

export interface LinhaAssistente {
  pc: Computador
  versao: string | null
  estado: EstadoAssistente
  /** O agente deste computador atualiza o assistente pelo painel (0.8.0 em diante) e não está atualizando agora. */
  podeAtualizar: boolean
}

/**
 * A versão do assistente do computador: a que o agente 0.8.0 manda num campo próprio, ou (agentes de antes) a do texto
 * da conferência "assistente" do diagnóstico, que é do próprio Reveza ("versão 2.1.300").
 */
export function versaoDoAssistente(pc: Computador): string | null {
  const v = pc.diagnostico?.assistente?.versao
  if (v) return v
  const item = pc.diagnostico?.itens.find((i) => i.id === "assistente")
  if (!item || item.ok === false) return null
  return /(\d{1,4}\.\d{1,4}\.\d{1,4})/.exec(item.detalhe ?? "")?.[1] ?? null
}

/** O agente deste computador entende o pedido de atualizar o assistente (0.8.0 em diante). */
export function atualizaPeloPainel(pc: Computador): boolean {
  return !!pc.diagnostico?.assistente
}

/**
 * Uma linha por computador e o resumo: a mais nova entre eles, quantos estão atrás e se estão todos na mesma versão.
 * `pedidos`: o momento (ms, relógio do navegador) em que esta aba pediu a atualização de cada computador.
 */
export function linhasDoAssistente(
  ativos: Computador[],
  pedidos: Record<string, number> = {},
  agoraMs = Date.now()
): { maisNova: string | null; linhas: LinhaAssistente[]; atras: number; iguais: boolean } {
  const versoes = ativos.map(versaoDoAssistente).filter((v): v is string => !!v)
  const maisNova = versaoMaisNova(versoes)
  const linhas = ativos.map((pc): LinhaAssistente => {
    const versao = versaoDoAssistente(pc)
    const a = pc.diagnostico?.assistente
    const pedido = pedidos[pc.id]
    // o pedido daqui vale até o computador contar uma atualização de depois dele (com um minuto de folga entre os
    // relógios do navegador e do computador) ou até a espera acabar
    const terminou = !!a?.ultima && Date.parse(a.ultima.em) >= (pedido ?? 0) - 60_000
    const esperando = pedido !== undefined && agoraMs - pedido < ESPERA_PEDIDO_MS && !terminou
    const estado: EstadoAssistente =
      a?.atualizando || esperando
        ? "atualizando"
        : !versao
          ? "sem_versao"
          : maisNova && compararVersao(versao, maisNova) < 0
            ? "atras"
            : "mais_nova"
    return { pc, versao, estado, podeAtualizar: atualizaPeloPainel(pc) && estado !== "atualizando" }
  })
  return {
    maisNova,
    linhas,
    atras: linhas.filter((l) => l.estado === "atras").length,
    iguais: versoes.length === ativos.length && new Set(versoes).size <= 1,
  }
}
