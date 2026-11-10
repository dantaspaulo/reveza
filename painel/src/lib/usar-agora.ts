// "Usar agora" (0.12.0, pedido do Paulo em 06/11/2026: "trocar pelo painel a conta e selecionar a conta que eu quero
// usar agora... eu teria resolvido isso com um clique"): o que impede uma conta de ir para um computador, pelas mesmas
// regras da nuvem (painel_trocar_agora): pausada, sem login, esgotada, em uso em outro computador. Esgotada desde a
// 0.16.0 (Paulo, 09/11/2026: "Contas esgotadas não podem ser usadas, o botão de usar agora nem deve ficar ativo").

import { cheia } from "@/dados/derivados"
import type { Computador, Conta, Instantaneo } from "@/dados/tipos"

export type BloqueioUsar =
  | { motivo: "pausada" }
  | { motivo: "semLogin" }
  | { motivo: "esgotada" }
  | { motivo: "ocupada"; computador: string }
  | { motivo: "jaUsa" }

/** Os computadores que podem receber uma conta: ligados ao painel, sem os revogados e os que ainda não entraram. */
export function computadoresParaUsar(estado: Pick<Instantaneo, "computadores">): Computador[] {
  return estado.computadores.filter((pc) => !pc.revogado && pc.sistema !== "pendente")
}

/**
 * O que impede a conta, em qualquer computador: pausada, sem login ou esgotada (100% numa janela que ainda não
 * renovou: 5 horas, semana ou semana de uma família de modelo) (null: nada).
 */
export function bloqueioDaConta(conta: Conta, agora: Date = new Date()): BloqueioUsar | null {
  if (conta.pausada) return { motivo: "pausada" }
  if (conta.precisaLogin) return { motivo: "semLogin" }
  const v = cheia(conta, agora)
  if (v !== null && v >= 100) return { motivo: "esgotada" }
  return null
}

/** O que impede a conta neste computador (null: dá para usar agora). */
export function bloqueioUsar(
  conta: Conta,
  pc: Computador,
  estado: Pick<Instantaneo, "computadores">,
  agora: Date = new Date(),
): BloqueioUsar | null {
  const daConta = bloqueioDaConta(conta, agora)
  if (daConta) return daConta
  if (pc.atribuicao?.contaId === conta.id) return { motivo: "jaUsa" }
  // como a nuvem: qualquer outro computador com a conta (o revogado perde a dele ao ser revogado)
  const outro = estado.computadores.find((q) => q.id !== pc.id && q.atribuicao?.contaId === conta.id)
  return outro ? { motivo: "ocupada", computador: outro.nome } : null
}

/** O botão "Usar agora" da conta faz sentido: há algum computador em que ela pode entrar agora. */
export function podeUsarEmAlgum(conta: Conta, estado: Pick<Instantaneo, "computadores">, agora: Date = new Date()): boolean {
  return computadoresParaUsar(estado).some((pc) => bloqueioUsar(conta, pc, estado, agora) === null)
}
