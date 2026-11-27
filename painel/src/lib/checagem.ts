// 0.22.1 (item 5): a checagem automática antes de ligar um projeto, no lugar do ensaio manual. Olha só o que PASSA a
// ficar ligado no rascunho (desligado, em teste ou novo antes). Recusa quando o projeto não teria como rodar e conta o
// que muda para as conversas, antes de salvar. Só o painel: a nuvem segue com a recusa dela (computador abaixo da
// 0.20.0), e esta é mais exigente só na hora de ligar.
import type { EstadoConta } from "@/dados/derivados"
import type { Computador, Conta } from "@/dados/tipos"

import { contasDe, ligada, rodaNoComputador, type UnidadeRascunho } from "./cadastro"
import { versaoNum } from "./empresas"

/** A versão do agente que espera uma conta voltar em vez de falhar a conversa (plano B, 0.21.0). */
export const VERSAO_COM_ESPERA = "0.21.0"
/** Como a nuvem: computador que não aparece há mais de um dia não segura a escolha. */
const VISTO_HA_MS = 24 * 60 * 60_000

export type MotivoSemRodar = "saindo" | "precisa_login" | "pausada" | "sumiu"

export type RecusaLigar =
  | { tipo: "semContaQueRode"; unidade: string; contas: { id: string; motivo: MotivoSemRodar }[] }
  | { tipo: "computadorSemEspera"; unidade: string; computador: string; versao: string }

export type AvisoLigar =
  | { tipo: "trocam"; unidade: string; computador: string; contaId: string }
  | { tipo: "esperam"; unidade: string }

export interface ChecagemLigar {
  recusas: RecusaLigar[]
  avisos: AvisoLigar[]
}

export interface ContextoChecagem {
  contas: Conta[]
  estadoDe: (c: Conta) => EstadoConta
  computadores: Pick<Computador, "id" | "nome" | "versao" | "vistoEm" | "revogado" | "atribuicao">[]
  agora: Date
}

const SEM_RODAR: ReadonlySet<EstadoConta> = new Set<EstadoConta>(["saindo", "precisa_login", "pausada"])
const PERTO_DO_LIMITE: ReadonlySet<EstadoConta> = new Set<EstadoConta>(["esgotada", "aviso"])

/** As unidades que passam a ficar ligadas: estavam desligadas, em teste, ou não existiam. */
function quemLiga(antes: UnidadeRascunho[], lista: UnidadeRascunho[]): UnidadeRascunho[] {
  return lista.filter((x) => {
    if (!ligada(x, lista)) return false
    const velho = antes.find((y) => y.id === x.id)
    return !velho || !ligada(velho, antes)
  })
}

export function checarLigar(antes: UnidadeRascunho[], lista: UnidadeRascunho[], ctx: ContextoChecagem): ChecagemLigar {
  const recusas: RecusaLigar[] = []
  const avisos: AvisoLigar[] = []
  const ligam = quemLiga(antes, lista)
  const ids = new Set(ligam.map((x) => x.id))
  const ativos = ctx.computadores.filter((p) => !p.revogado).map((p) => p.id)
  const porNome = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome)
  for (const un of ligam) {
    // o projeto sem conta própria que liga junto com a empresa: a empresa já responde por ele
    if (un.pai && !un.contas.length && ids.has(un.pai)) continue
    const raiz = un.pai ? lista.find((x) => x.id === un.pai) : un
    if (!raiz) continue
    const contas = contasDe(un, lista)
    // sem conta nenhuma é o erroConta do validar, que vem antes
    if (!contas.length) continue
    const estados = contas.map((id) => {
      const conta = ctx.contas.find((c) => c.id === id)
      return { id, estado: conta ? ctx.estadoDe(conta) : null }
    })
    const ruins = estados.filter((x) => x.estado === null || SEM_RODAR.has(x.estado))
    const semConta = ruins.length === estados.length
    if (semConta) {
      recusas.push({
        tipo: "semContaQueRode",
        unidade: un.id,
        contas: ruins.map((x) => ({ id: x.id, motivo: (x.estado ?? "sumiu") as MotivoSemRodar })),
      })
    }
    const roda = ctx.computadores.filter((p) => !p.revogado && rodaNoComputador(raiz, p.id, ativos)).sort(porNome)
    // o projeto que liga dentro de uma empresa que também liga agora: os computadores são os dela, já conferidos
    if (!(un.pai && ids.has(un.pai))) {
      for (const p of roda) {
        const visto = p.vistoEm ? Date.parse(p.vistoEm) : NaN
        if (!Number.isFinite(visto) || ctx.agora.getTime() - visto > VISTO_HA_MS) continue
        if (versaoNum(p.versao) < versaoNum(VERSAO_COM_ESPERA)) {
          recusas.push({ tipo: "computadorSemEspera", unidade: un.id, computador: p.nome, versao: p.versao })
        }
      }
    }
    // com recusa de conta não há o que prometer
    if (semConta) continue
    for (const p of roda) {
      const emUso = p.atribuicao?.contaId
      if (emUso && !contas.includes(emUso)) avisos.push({ tipo: "trocam", unidade: un.id, computador: p.nome, contaId: emUso })
    }
    const boas = estados.filter((x) => x.estado !== null && !SEM_RODAR.has(x.estado))
    if (boas.every((x) => PERTO_DO_LIMITE.has(x.estado as EstadoConta))) avisos.push({ tipo: "esperam", unidade: un.id })
  }
  return { recusas, avisos }
}
