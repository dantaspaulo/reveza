// 0.22.1 (item 5): a checagem automática antes de ligar um projeto, no lugar do ensaio manual. Olha o que PASSA a ficar
// ligado no rascunho (desligado, em teste ou novo antes) e, no que já estava ligado, os computadores que entram no
// "Roda em". Recusa quando o projeto não teria como rodar e conta o que muda para as conversas, antes de salvar. Só o
// painel: a nuvem segue com a recusa dela (computador abaixo da 0.20.0), e esta é mais exigente só na hora de ligar.
import type { EstadoConta } from "@/dados/derivados"
import type { Computador, Conta } from "@/dados/tipos"

import { computadoresAtivos, contasDe, ligada, type UnidadeRascunho } from "./cadastro"
import { versaoNum } from "./empresas"

/** A versão do agente que espera uma conta voltar em vez de falhar a conversa (plano B, 0.21.0). */
export const VERSAO_COM_ESPERA = "0.21.0"
/** Como a nuvem: computador que não aparece há mais de um dia não segura a escolha. */
const VISTO_HA_MS = 24 * 60 * 60_000

export type MotivoSemRodar = "saindo" | "precisa_login" | "pausada" | "sumiu"

export type RecusaLigar =
  | { tipo: "semContaQueRode"; unidade: string; contas: { id: string; motivo: MotivoSemRodar }[] }
  | { tipo: "computadorSemEspera"; unidade: string; computador: string; versao: string }
  | { tipo: "semComputador"; unidade: string }

export type AvisoLigar =
  | { tipo: "trocam"; unidade: string; computador: string; contaId: string }
  | { tipo: "esperam"; unidade: string }

export interface ChecagemLigar {
  recusas: RecusaLigar[]
  avisos: AvisoLigar[]
}

type PcChecagem = Pick<Computador, "id" | "nome" | "versao" | "vistoEm" | "revogado" | "atribuicao">

export interface ContextoChecagem {
  contas: Conta[]
  estadoDe: (c: Conta) => EstadoConta
  computadores: PcChecagem[]
  agora: Date
}

const SEM_RODAR: ReadonlySet<EstadoConta> = new Set<EstadoConta>(["saindo", "precisa_login", "pausada"])

/** As unidades que passam a ficar ligadas: estavam desligadas, em teste, ou não existiam. */
function quemLiga(antes: UnidadeRascunho[], lista: UnidadeRascunho[]): UnidadeRascunho[] {
  return lista.filter((x) => {
    if (!ligada(x, lista)) return false
    const velho = antes.find((y) => y.id === x.id)
    return !velho || !ligada(velho, antes)
  })
}

/**
 * Os computadores ativos onde a unidade roda: os do "Roda em" da empresa (o projeto usa os dela), como `rvz_roda_em`
 * na nuvem. Todos, ou só os escolhidos que não foram removidos; a escolha só com removidos não roda em lugar nenhum
 * (não é a regra de mostrar da tela, `rodaNoComputador`, que cai em "todos").
 */
function ondeRoda(u: UnidadeRascunho, lista: UnidadeRascunho[], pcs: PcChecagem[]): PcChecagem[] {
  const raiz = u.pai ? lista.find((x) => x.id === u.pai) : u
  if (!raiz) return []
  const ativos = pcs.filter((p) => !p.revogado)
  const escolha = computadoresAtivos(raiz, ativos.map((p) => p.id))
  return ativos.filter((p) => escolha === null || escolha.includes(p.id))
}

function vistoHaPouco(p: PcChecagem, agora: Date): boolean {
  const visto = p.vistoEm ? Date.parse(p.vistoEm) : NaN
  return Number.isFinite(visto) && agora.getTime() - visto <= VISTO_HA_MS
}

export function checarLigar(antes: UnidadeRascunho[], lista: UnidadeRascunho[], ctx: ContextoChecagem): ChecagemLigar {
  const recusas: RecusaLigar[] = []
  const avisos: AvisoLigar[] = []
  const ids = new Set(quemLiga(antes, lista).map((x) => x.id))
  const porNome = (a: PcChecagem, b: PcChecagem) => a.nome.localeCompare(b.nome)
  // o computador atrasado que a empresa já recusou não se repete nos projetos dela (empresas antes)
  const recusados = new Set<string>()
  const ordem = [...lista].sort((a, b) => (a.pai ? 1 : 0) - (b.pai ? 1 : 0))
  for (const un of ordem) {
    if (!ligada(un, lista)) continue
    const nova = ids.has(un.id)
    const pai = un.pai ? lista.find((x) => x.id === un.pai) : undefined
    // o projeto sem conta própria cuja empresa liga agora, ou que já estava ligado com ela: a empresa responde por ele
    if (un.pai && !un.contas.length && pai && ligada(pai, lista) && (ids.has(un.pai) || !nova)) continue
    // quem liga agora: todos os computadores onde roda; quem já estava ligado: só os que entraram no "Roda em"
    const velho = nova ? undefined : antes.find((y) => y.id === un.id)
    const jaRodava = new Set(velho ? ondeRoda(velho, antes, ctx.computadores).map((p) => p.id) : [])
    const olhar = ondeRoda(un, lista, ctx.computadores)
      .filter((p) => !jaRodava.has(p.id))
      .sort(porNome)
    if (!nova && !olhar.length) continue
    const contas = contasDe(un, lista)
    // sem conta nenhuma é o erroConta do validar, que vem antes
    if (!contas.length) continue
    const estados = contas.map((id) => {
      const conta = ctx.contas.find((c) => c.id === id)
      return { id, estado: conta ? ctx.estadoDe(conta) : null }
    })
    // projeto já ligado que perde contas não é checado de novo (fora desta versão, ver o desenho)
    const ruins = estados.filter((x) => x.estado === null || SEM_RODAR.has(x.estado))
    const todasRuins = ruins.length === estados.length
    const semConta = nova && todasRuins
    if (semConta) {
      recusas.push({
        tipo: "semContaQueRode",
        unidade: un.id,
        contas: ruins.map((x) => ({ id: x.id, motivo: (x.estado ?? "sumiu") as MotivoSemRodar })),
      })
    }
    // "Roda em" só com computadores removidos: ligar assim não roda em lugar nenhum (e a nuvem tira as contas dele de
    // todos os computadores); a empresa que não veio na leitura não entra (não se sabe onde ela roda)
    const raiz = un.pai ? pai : un
    if (nova && raiz && Array.isArray(raiz.computadores) && !ondeRoda(un, lista, ctx.computadores).length) {
      recusas.push({ tipo: "semComputador", unidade: un.id })
      continue
    }
    const vistos = olhar.filter((p) => vistoHaPouco(p, ctx.agora))
    for (const p of vistos) {
      // a empresa marca o computador que recusou; o projeto não repete o da empresa, e cada projeto diz o seu
      const chave = `${un.pai ?? un.id}|${p.id}`
      if (versaoNum(p.versao) < versaoNum(VERSAO_COM_ESPERA) && !recusados.has(chave)) {
        if (!un.pai) recusados.add(chave)
        recusas.push({ tipo: "computadorSemEspera", unidade: un.id, computador: p.nome, versao: p.versao })
      }
    }
    // sem conta que rode não há o que prometer (no projeto já ligado também)
    if (todasRuins) continue
    for (const p of vistos) {
      const emUso = p.atribuicao?.contaId
      if (emUso && !contas.includes(emUso)) avisos.push({ tipo: "trocam", unidade: un.id, computador: p.nome, contaId: emUso })
    }
    // a nuvem escolhe conta abaixo de 100%: só esperam quando toda conta que pode rodar está esgotada
    const boas = estados.filter((x) => x.estado !== null && !SEM_RODAR.has(x.estado))
    if (nova && boas.every((x) => x.estado === "esgotada")) avisos.push({ tipo: "esperam", unidade: un.id })
  }
  return { recusas, avisos }
}
