// O botão de atualizar o programa de um computador: o painel só pede ({ versao: "mais_nova" }); quem escolhe a versão,
// baixa e instala é o agente, só com versão oficial publicada e maior que a dele. A nuvem (desde a 0.3.0) se atualiza
// sozinha, sem token: o painel só pede (Atualizar a nuvem). Funções e painel vão ao ar pelo instalador ou, com a
// atualização completa ligada, por um computador; a versão que precisa da nuvem primeiro é recusada pelo agente (a
// trava de compatibilidade), e o painel mostra.

import { compararVersao } from "@/dados/derivados"
import type { Comando, Computador, EstadoNuvem, Evento, ModoAtualizar, VezAtualizacao } from "@/dados/tipos"

/** O corpo do pedido: nunca endereço nem caminho, só "a mais nova" (o agente confere tudo). */
export const PEDIDO_ATUALIZAR = { versao: "mais_nova" } as const

/** O Verificar atualização: o agente lê a versão publicada agora (sem esperar as 6 horas) e conta o que achou. */
export const PEDIDO_CONFERIR = { conferir: true } as const

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

function maior(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return compararVersao(a, b) >= 0 ? a : b
}

/**
 * A versão que este computador pode receber: a mais nova publicada que o agente leu, ou a de outro computador que já
 * está na frente. Null quando ele já está nela (ou não há notícia de versão mais nova).
 */
export function versaoDisponivel(pc: Computador, versaoDosOutros: string | null = null): string | null {
  const publicada = pc.diagnostico?.versaoNova && SEMVER.test(pc.diagnostico.versaoNova) ? pc.diagnostico.versaoNova : null
  const alvo = maior(publicada, versaoDosOutros && SEMVER.test(versaoDosOutros) ? versaoDosOutros : null)
  if (!alvo) return null
  if (!SEMVER.test(pc.versao)) return alvo
  return compararVersao(alvo, pc.versao) > 0 ? alvo : null
}

export type AndamentoAtualizacao =
  | { fase: "pedido" }
  | { fase: "atualizando"; para: string | null; desde: string | null }
  | { fase: "concluida"; para: string }
  | { fase: "falhou"; motivo: string; para: string | null }
  | { fase: "sem_suporte" }
  /** A versão nova precisa da nuvem e do painel atualizados no computador principal primeiro (a trava do agente). */
  | { fase: "precisa_nuvem"; para: string }

const MIN = 60_000

/** Os eventos de atualização deste computador, do mais novo para o mais velho. */
function eventosDe(pc: Computador, eventos: Evento[]): Evento[] {
  return eventos
    .filter((e) => e.dados?.computador === pc.id && typeof e.dados?.atualizacao === "string")
    .sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
}

/**
 * Em que pé está a atualização deste computador: pelo pedido feito nesta tela (se houver), pelo que o agente manda no
 * diagnóstico e pelos eventos dele (pedida, concluída, falhou). Null quando não há nada a mostrar.
 */
export function andamentoDaAtualizacao(pc: Computador, cmd: Comando | null, eventos: Evento[], agora: Date): AndamentoAtualizacao | null {
  const t = agora.getTime()
  const desde = cmd ? Date.parse(cmd.criadoEm) - 5_000 : t - 60 * MIN
  const ev = eventosDe(pc, eventos).filter((e) => Date.parse(e.em) >= desde)
  const ultimo = ev[0]
  const para = (v: unknown) => (typeof v === "string" && SEMVER.test(v) ? v : null)
  if (cmd) {
    if (cmd.estado === "pendente") return { fase: "pedido" }
    if (cmd.estado === "reservado") return { fase: "atualizando", para: null, desde: cmd.criadoEm }
    const r = cmd.resposta ?? {}
    if (cmd.estado !== "feito" && r.precisa_nuvem === true && para(r.para)) return { fase: "precisa_nuvem", para: para(r.para)! }
    if (cmd.estado !== "feito") {
      const erro = typeof r.erro === "string" ? r.erro.slice(0, 300) : cmd.estado
      return { fase: "falhou", motivo: erro, para: null }
    }
    // agente de versão anterior: o "atualizar" dele só relê as contas
    if (r.atualizando !== true) return { fase: "sem_suporte" }
    const alvo = para(r.para)
    if (alvo && compararVersao(pc.versao, alvo) >= 0) return { fase: "concluida", para: alvo }
    if (ultimo?.dados?.atualizacao === "falhou") {
      return { fase: "falhou", motivo: String(ultimo.dados.motivo ?? "").slice(0, 300), para: alvo }
    }
    return { fase: "atualizando", para: alvo, desde: cmd.criadoEm }
  }
  // sem pedido desta tela (outra aba, Atualizar todos, ou sozinho de madrugada): pelo que o computador conta
  const emCurso = pc.diagnostico?.atualizacao
  if (ultimo?.dados?.atualizacao === "falhou") {
    return { fase: "falhou", motivo: String(ultimo.dados.motivo ?? "").slice(0, 300), para: para(ultimo.dados.para) }
  }
  if (ultimo?.dados?.atualizacao === "concluida" && t - Date.parse(ultimo.em) < 15 * MIN) {
    return { fase: "concluida", para: para(ultimo.dados.para) ?? pc.versao }
  }
  const atras = (v: string | null) => !!v && (!SEMVER.test(pc.versao) || compararVersao(pc.versao, v) < 0)
  if (ultimo?.dados?.atualizacao === "precisa_nuvem" && atras(para(ultimo.dados.para))) {
    return { fase: "precisa_nuvem", para: para(ultimo.dados.para)! }
  }
  const alvo = para(ultimo?.dados?.para) ?? para(emCurso?.para)
  if ((ultimo?.dados?.atualizacao === "pedida" || emCurso) && alvo && compararVersao(pc.versao, alvo) < 0) {
    if (t - Date.parse(ultimo?.em ?? emCurso!.desde) < 30 * MIN) return { fase: "atualizando", para: alvo, desde: ultimo?.em ?? emCurso!.desde }
  }
  if (alvo && compararVersao(pc.versao, alvo) >= 0 && ultimo?.dados?.atualizacao === "pedida") return { fase: "concluida", para: alvo }
  // a trava segue valendo no agente (o diagnóstico conta a cada 10 minutos), mesmo depois de o aviso sair da janela
  const travada = para(pc.diagnostico?.precisaNuvem?.para)
  if (atras(travada)) return { fase: "precisa_nuvem", para: travada! }
  return null
}

/**
 * A versão da instalação quando ela está na frente da do painel: a da nuvem (com o painel dela ainda por publicar) ou a
 * dos computadores. Sem a atualização completa, o painel não acompanha a nuvem (22/10/2026, relato de um usuário: a
 * nuvem foi para a 0.10 e o painel ficou na 0.7, sem nada dizendo isso fora do cartão de Atualizações).
 */
export function painelAtras(versaoPainel: string, computadores: Computador[], nuvem?: EstadoNuvem | null): string | null {
  // a nuvem sabe que o painel que está no ar é o da versão dela (ou que a versão nova não mexeu no painel): em dia
  if (nuvem?.versao && !pendenteDaPublicacao(nuvem).painel) return null
  let maisNova: string | null = nuvem?.versao && SEMVER.test(nuvem.versao) ? nuvem.versao : null
  for (const pc of computadores) if (!pc.revogado && SEMVER.test(pc.versao)) maisNova = maior(maisNova, pc.versao)
  return maisNova && SEMVER.test(versaoPainel) && compararVersao(maisNova, versaoPainel) > 0 ? maisNova : null
}

// ------------------------------------------------------------------------------------------------ pedidos em andamento

/** Os pedidos feitos nesta aba (computador → comando), para o cartão e a Saúde mostrarem o mesmo andamento. */
const pedidos = new Map<string, { comando: number; em: number }>()
const ouvintes = new Set<() => void>()
let mudancas = 0

export function guardarPedido(computadorId: string, comandoId: number, agora = Date.now()): void {
  pedidos.set(computadorId, { comando: comandoId, em: agora })
  mudancas++
  for (const o of ouvintes) o()
}

export function pedidoDe(computadorId: string): number | null {
  return pedidos.get(computadorId)?.comando ?? null
}

/** Pedido feito nesta aba há menos de 15 minutos (o "Atualizar todos" não pede de novo a quem já está atualizando). */
export function pedidoRecente(computadorId: string, agora = Date.now()): boolean {
  const p = pedidos.get(computadorId)
  return !!p && agora - p.em < 15 * 60_000
}

/** Muda a cada pedido novo (para quem mostra a lista inteira se redesenhar). */
export function mudancasDosPedidos(): number {
  return mudancas
}

export function assinarPedidos(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}

// ------------------------------------------------------------------------------------------------ verificar atualização

/** Uma rodada do Verificar atualização: o pedido feito a cada computador ligado e o que cada um respondeu. */
export interface Conferencia {
  id: number
  em: number
  /** computador → comando do pedido */
  pedidos: Record<string, number>
  /** comando → como ficou na última leitura */
  lidos: Record<number, Comando>
}

let conferencia: Conferencia | null = null
let rodadas = 0
const ouvintesConferencia = new Set<() => void>()

function avisarConferencia() {
  for (const o of ouvintesConferencia) o()
}

/** Começa uma rodada nova (a anterior sai da tela). */
export function comecarConferencia(pedidos: Record<string, number>, agora = Date.now()): void {
  conferencia = { id: ++rodadas, em: agora, pedidos: { ...pedidos }, lidos: {} }
  avisarConferencia()
}

/** Guarda a leitura de um pedido da rodada atual (o objeto muda, para quem lê a rodada se redesenhar). */
export function guardarLeitura(c: Comando): void {
  if (!conferencia || !Object.values(conferencia.pedidos).includes(c.id)) return
  const antes = conferencia.lidos[c.id]
  if (antes && antes.estado === c.estado && JSON.stringify(antes.resposta) === JSON.stringify(c.resposta)) return
  conferencia = { ...conferencia, lidos: { ...conferencia.lidos, [c.id]: c } }
  avisarConferencia()
}

export function conferenciaAtual(): Conferencia | null {
  return conferencia
}

export function assinarConferencia(fn: () => void): () => void {
  ouvintesConferencia.add(fn)
  return () => ouvintesConferencia.delete(fn)
}

/** Só para os testes. */
export function limparConferencia(): void {
  conferencia = null
  avisarConferencia()
}

const FIM_DO_COMANDO = new Set(["feito", "recusado", "expirado"])
/** A nuvem expira o pedido em 2 minutos: depois disso, quem não respondeu não responde mais. */
export const PRAZO_DA_CONFERENCIA_MS = 150_000

/** Os pedidos da rodada que ainda podem responder (para quem acompanha ler de novo). */
export function pedidosEmAberto(c: Conferencia, agora = Date.now()): number[] {
  if (agora - c.em > PRAZO_DA_CONFERENCIA_MS) return []
  return Object.values(c.pedidos).filter((id) => !FIM_DO_COMANDO.has(c.lidos[id]?.estado ?? "pendente"))
}

export type ResultadoConferencia =
  | { fase: "conferindo"; responderam: number; total: number }
  | { fase: "sem_resposta" }
  | { fase: "em_dia"; versao: string }
  | { fase: "disponivel"; versao: string; atras: number; precisaNuvem: boolean }
  /** Quem sabe conferir respondeu que não conseguiu (sem acesso ao GitHub, por exemplo), e ninguém conferiu. */
  | { fase: "nao_conferiu"; erro: string }

const ativo = (pc: Computador) => !pc.revogado && pc.sistema !== "pendente"
/** O Verificar atualização chegou na 0.2.1: os de antes recusam o pedido sem saber o que é. */
const sabeConferir = (pc: Computador) => SEMVER.test(pc.versao) && compararVersao(pc.versao, "0.2.1") >= 0

/**
 * O resultado da rodada: conferindo (alguém ainda pode responder), ninguém respondeu, todos na mais nova, ou a versão
 * disponível com quantos computadores estão atrás. A versão mais nova junta a que os agentes acharam agora com a que já
 * se sabia (a de outro computador na frente, ou a lida antes); o "atrás" é pela versão de cada um, ao vivo.
 */
export function resultadoDaConferencia(c: Conferencia, computadores: Computador[], agora = Date.now()): ResultadoConferencia {
  const ids = Object.values(c.pedidos)
  const fechados = ids.filter((id) => FIM_DO_COMANDO.has(c.lidos[id]?.estado ?? "pendente"))
  if (fechados.length < ids.length && agora - c.em <= PRAZO_DA_CONFERENCIA_MS) {
    return { fase: "conferindo", responderam: fechados.length, total: ids.length }
  }
  const respostas = ids
    .map((id) => c.lidos[id])
    .filter((x): x is Comando => !!x && x.estado === "feito" && x.resposta?.conferido === true)
    .map((x) => x.resposta!)
  // computador de versão anterior recusa o pedido (não sabe conferir): responde, mas sem versão
  const recusaram = ids.some((id) => c.lidos[id]?.estado === "recusado")
  // o que sabe conferir (0.2.1 em diante) e recusou com motivo não conferiu: sem nenhuma conferência, "em dia" seria mentira
  if (!respostas.length) {
    const pcDoPedido = new Map(Object.entries(c.pedidos).map(([pc, id]) => [id, pc]))
    const erros = ids.flatMap((id) => {
      const x = c.lidos[id]
      const pc = computadores.find((p) => p.id === pcDoPedido.get(id))
      const erro = x?.resposta?.erro
      return x?.estado === "recusado" && typeof erro === "string" && pc && sabeConferir(pc) ? [erro] : []
    })
    if (erros.length) return { fase: "nao_conferiu", erro: erros[0]! }
  }
  if (!respostas.length && !recusaram) return { fase: "sem_resposta" }
  const ativos = computadores.filter(ativo)
  const conhecidas = [
    ...respostas.map((r) => r.mais_nova),
    ...ativos.flatMap((pc) => [pc.versao, pc.diagnostico?.versaoNova]),
  ].filter((v): v is string => typeof v === "string" && SEMVER.test(v))
  const versao = conhecidas.reduce<string | null>((m, v) => maior(m, v), null)
  if (!versao) return { fase: "sem_resposta" }
  const atras = ativos.filter((pc) => !SEMVER.test(pc.versao) || compararVersao(pc.versao, versao) < 0).length
  if (!atras) return { fase: "em_dia", versao }
  const precisaNuvem =
    respostas.some((r) => r.precisa_nuvem === true && r.mais_nova === versao) ||
    ativos.some((pc) => pc.diagnostico?.precisaNuvem?.para === versao)
  return { fase: "disponivel", versao, atras, precisaNuvem }
}

// ------------------------------------------------------------------------------------------------ andamento de todos

/**
 * O agente deste computador entende o "assim que sair" (conta no diagnóstico, 0.2.1 em diante). Os de antes só se
 * atualizam sozinhos de madrugada: com "assim que sair", eles precisam do botão.
 */
export function entendeAssimQueSair(pc: Computador): boolean {
  return pc.diagnostico?.assimQueSair === true
}

export type EstadoNaAtualizacao = "em_dia" | "atualizando" | "na_fila" | "parada" | "falhou" | "precisa_nuvem" | "disponivel"

/**
 * Onde cada computador está na atualização para `alvo` (o andamento do cartão de cima): já nela, atualizando agora (a vez
 * é dele, ou ele contou), falhou, travado pela nuvem, esperando a vez (com a atualização sozinha ligada) ou só disponível.
 */
export function andamentoDeTodos(
  computadores: Computador[],
  alvo: string,
  eventos: Evento[],
  vez: VezAtualizacao | null | undefined,
  modo: ModoAtualizar,
  agora: Date
): { pc: Computador; estado: EstadoNaAtualizacao }[] {
  return computadores.filter(ativo).map((pc) => {
    if (SEMVER.test(pc.versao) && compararVersao(pc.versao, alvo) >= 0) return { pc, estado: "em_dia" as const }
    const a = andamentoDaAtualizacao(pc, null, eventos, agora)
    if (a?.fase === "atualizando" || a?.fase === "pedido") return { pc, estado: "atualizando" as const }
    if (a?.fase === "falhou") return { pc, estado: "falhou" as const }
    if (a?.fase === "precisa_nuvem") return { pc, estado: "precisa_nuvem" as const }
    if (vez?.estado === "em_andamento" && vez.computadorId === pc.id) return { pc, estado: "atualizando" as const }
    const vaiSozinho = modo === "madrugada" || (modo === "assim_que_sair" && entendeAssimQueSair(pc))
    // um voltou para a anterior: a vez parou para todos até o administrador retomar (não fica "esperando a vez" para sempre)
    if (vaiSozinho && vez?.estado === "falhou") return { pc, estado: "parada" as const }
    return { pc, estado: vaiSozinho ? ("na_fila" as const) : ("disponivel" as const) }
  })
}

// ------------------------------------------------------------------------------------------------ a nuvem e o painel

/**
 * O que falta publicar para a versão da nuvem (a mesma regra do banco, rvz_publicacao_pendente): uma parte está em dia
 * quando a versão no ar já é a da nuvem (ou mais nova), ou quando a nuvem calculou o mesmo resumo das duas.
 */
export function pendenteDaPublicacao(n: EstadoNuvem | null | undefined): { funcoes: boolean; painel: boolean } {
  if (!n?.versao) return { funcoes: false, painel: false }
  const v = n.versao
  const falta = (parte: "funcoes" | "painel") => {
    const p = n.publicado[parte]
    if (!p || !SEMVER.test(p)) return true
    if (compararVersao(p, v) >= 0) return false
    const a = n.impressoes[v]?.[parte]
    return !(a && a === n.impressoes[p]?.[parte])
  }
  return { funcoes: falta("funcoes"), painel: falta("painel") }
}

export type FaseNuvem =
  /** Nuvem de antes da 0.3.0: ela ainda não sabe a versão dela (o instalador grava na primeira atualização). */
  | { fase: "desconhecida" }
  | { fase: "atualizando"; versao: string | null }
  /** Começou e não terminou em 10 minutos (a função caiu no meio): o banco já deixa tentar de novo. */
  | { fase: "interrompida"; versao: string | null }
  | { fase: "falhou"; versao: string | null; motivo: string }
  | { fase: "publicando"; versao: string; computadorId: string | null }
  | { fase: "publicacao_falhou"; versao: string; motivo: string }
  /** A versão da nuvem mexe em funções ou painel e a atualização completa está desligada. */
  | { fase: "passo_manual"; versao: string; funcoes: boolean; painel: boolean }
  /** Com a atualização completa, um computador ligado publica funções e painel em instantes. */
  | { fase: "esperando_publicacao"; versao: string }
  | { fase: "atualizada"; versao: string }

/** Em que pé estão a nuvem e o painel, para a linha "Nuvem e painel" do cartão de atualizações. */
export function faseDaNuvem(n: EstadoNuvem | null | undefined, agora: Date): FaseNuvem {
  const t = agora.getTime()
  const recente = (iso: string | null, min: number) => !!iso && t - Date.parse(iso) < min * MIN
  const at = n?.atualizacao
  // a mesma janela do banco (servico_nuvem_comecar): depois de 10 minutos, "atualizando" é uma rodada que caiu
  if (at?.estado === "atualizando") {
    if (recente(at.desde, 10)) return { fase: "atualizando", versao: at.para }
    if (!n?.versao || (at.para && SEMVER.test(at.para) && compararVersao(at.para, n.versao) > 0)) return { fase: "interrompida", versao: at.para }
  }
  if (!n?.versao) return { fase: "desconhecida" }
  if (at?.estado === "falhou" && at.para && compararVersao(at.para, n.versao) > 0) {
    return { fase: "falhou", versao: at.para, motivo: at.motivo ?? "" }
  }
  const pub = n.publicacao
  if (pub?.para === n.versao && pub.estado === "em_andamento" && recente(pub.desde, 45)) {
    return { fase: "publicando", versao: n.versao, computadorId: pub.computadorId }
  }
  if (pub?.para === n.versao && pub.estado === "falhou") return { fase: "publicacao_falhou", versao: n.versao, motivo: pub.motivo ?? "" }
  const p = pendenteDaPublicacao(n)
  if (p.funcoes || p.painel) {
    return n.completa ? { fase: "esperando_publicacao", versao: n.versao } : { fase: "passo_manual", versao: n.versao, ...p }
  }
  return { fase: "atualizada", versao: n.versao }
}
