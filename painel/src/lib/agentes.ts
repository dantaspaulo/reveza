// 0.21.1 (pedido do Paulo em 24/11/2026: "O Reveza precisa poder analisar e ver pastas (de projetos) e agentes deles"):
// escolher os agentes do OpenBot de cada computador num projeto ou subprojeto. Marcar um agente grava a regra da pasta
// dele só naquele computador; "nome ou título contém" grava uma regra de texto (tipo "titulo"). Tudo sobre o rascunho da
// tela de Projetos e sem React, para testar sozinho: a tela mostra o que a nuvem fará depois de salvar, porque o
// classificador é o mesmo de lib/empresas, que segue rvz_classificar.

import { cheia, type EstadoConta } from "@/dados/derivados"
import type { AgenteOpenBot, Conta, RegraPasta } from "@/dados/tipos"

import { contasEmLigado, ligada, pastasEm, type PastaRascunho, type UnidadeRascunho } from "./cadastro"
import { criarClassificador, ehCaminho, nomeUnidade, normalizarPasta, type Classificar } from "./empresas"

/** O classificador das regras do rascunho: onde cada pasta cai depois de salvar. */
export function classificadorDoRascunho(lista: UnidadeRascunho[], agentes: AgenteOpenBot[]): Classificar {
  const regras: RegraPasta[] = []
  for (const u of lista) {
    u.pastas.forEach((p, i) => {
      const padrao = p.padrao.trim()
      if (padrao) regras.push({ id: `${u.id}:p${i}`, tipo: "pasta", padrao, empresaId: u.id, computadorId: p.computador })
    })
    u.titulos.forEach((t, i) => {
      const padrao = t.padrao.trim()
      if (padrao) regras.push({ id: `${u.id}:t${i}`, tipo: t.tipo, padrao, empresaId: u.id, computadorId: t.computador })
    })
  }
  return criarClassificador({
    // sem a escolha de computadores (nuvem antiga ou "todos"), roda em todos
    empresas: lista.map((u) => ({ id: u.id, pai: u.pai, emTodosComputadores: !Array.isArray(u.computadores) })),
    computadores: lista.flatMap((u) =>
      !u.pai && Array.isArray(u.computadores) ? u.computadores.map((c) => ({ empresaId: u.id, computadorId: c })) : []
    ),
    regras,
    agentes,
  })
}

const mesmaPasta = (a: string, b: string) => {
  const x = normalizarPasta(a)
  return !!x && x === normalizarPasta(b)
}

export function agentesRecentes(agentes: AgenteOpenBot[]): AgenteOpenBot[] {
  const ultimos = new Map<string, number>()
  for (const a of agentes) {
    const t = Date.parse(a.vistoEm)
    if (Number.isFinite(t)) ultimos.set(a.computadorId, Math.max(ultimos.get(a.computadorId) ?? -Infinity, t))
  }
  return agentes.filter((a) => {
    const t = Date.parse(a.vistoEm)
    const ultimo = ultimos.get(a.computadorId)
    return !Number.isFinite(t) || ultimo === undefined || ultimo - t <= 2 * 60 * 60_000
  })
}

/** Uma regra de caminho (não de nome de pasta) que é a própria pasta do agente. */
const ehDoAgente = (p: PastaRascunho, pasta: string) => ehCaminho(p.padrao) && mesmaPasta(p.padrao, pasta)

/** Os agentes do computador, um por pasta (o visto por último), em ordem de nome. */
export function agentesDoComputador(agentes: AgenteOpenBot[], computador: string): AgenteOpenBot[] {
  const porPasta = new Map<string, AgenteOpenBot>()
  for (const a of agentes) {
    if (a.computadorId !== computador) continue
    const p = normalizarPasta(a.pasta)
    if (!p) continue
    const ja = porPasta.get(p)
    if (!ja || a.vistoEm > ja.vistoEm) porPasta.set(p, a)
  }
  return [...porPasta.values()].sort(
    (a, b) => a.nome.localeCompare(b.nome) || a.titulo.localeCompare(b.titulo) || a.pasta.localeCompare(b.pasta)
  )
}

export interface LinhaAgente {
  agente: AgenteOpenBot
  /** A unidade em que o agente cai, pelo rascunho; null: em nenhuma. */
  onde: string | null
  /** O nome de onde ele cai ("Projeto / Subprojeto"), ou null. */
  ondeNome: string | null
  /** A pasta exata dele está nesta unidade (neste computador ou em todos): a caixa marcada, que se pode desmarcar. */
  marcado: boolean
  /** A regra marcada vale em todos os computadores e deve ser alterada na lista de pastas. */
  regraEmTodos: boolean
  /** Entra nesta unidade por outra regra dela (pasta mais larga, nome de pasta ou texto): o padrão dessa regra. */
  porRegra: string | null
  /** Marcado aqui, mas cai em outro lugar. */
  naoEntra: boolean
  /** O projeto desta unidade não roda neste computador. */
  foraDoComputador: boolean
  /** Não dá para marcar: outra unidade tem a mesma pasta em todos os computadores (o nome dela). */
  bloqueio: string | null
}

/** A regra da unidade que pega a pasta do agente neste computador: a de caminho mais comprida, a de nome, a de texto. */
function regraQuePega(u: UnidadeRascunho, agente: AgenteOpenBot, computador: string): string | null {
  const p = normalizarPasta(agente.pasta)
  const vale = (pc: string | null) => pc === null || pc === computador
  let caminho: { padrao: string; tam: number } | null = null
  let nome: string | null = null
  for (const r of u.pastas) {
    const padrao = r.padrao.trim()
    if (!padrao || !vale(r.computador)) continue
    if (ehCaminho(padrao)) {
      const base = normalizarPasta(padrao)
      const dentro = p === base || (base === "/" ? p.startsWith("/") : p.startsWith(`${base}/`))
      if (dentro && (!caminho || base.length > caminho.tam)) caminho = { padrao, tam: base.length }
    } else if (!nome) {
      const n = normalizarPasta(padrao).replace(/^\/+|\/+$/g, "")
      if (n && p.split("/").includes(n)) nome = padrao
    }
  }
  if (caminho) return caminho.padrao
  if (nome) return nome
  const nomeAg = agente.nome.toLowerCase()
  const tituloAg = agente.titulo.toLowerCase()
  const texto = u.titulos
    .map((r) => ({ r, t: r.padrao.trim().toLowerCase() }))
    .filter(({ r, t }) => t && vale(r.computador) && (nomeAg.includes(t) || tituloAg.includes(t)))
    .sort((a, b) => b.t.length - a.t.length)[0]
  return texto ? texto.r.padrao.trim() : null
}

/** A lista de agentes do computador no editor de uma unidade: onde cada um cai e o que a caixa dele pode fazer. */
export function linhasDeAgentes(
  lista: UnidadeRascunho[],
  unidadeId: string,
  agentes: AgenteOpenBot[],
  computador: string,
  classificar: Classificar
): LinhaAgente[] {
  const u = lista.find((x) => x.id === unidadeId)
  if (!u) return []
  const raiz = u.pai ? lista.find((x) => x.id === u.pai) : u
  const foraDoComputador = !!raiz && Array.isArray(raiz.computadores) && !raiz.computadores.includes(computador)
  const nome = (id: string | null) => {
    const x = id ? lista.find((y) => y.id === id) : undefined
    return x ? nomeUnidade(x, lista) : null
  }
  return agentesDoComputador(agentes, computador).map((agente) => {
    const onde = classificar(agente.pasta, "", computador)
    const marcado = u.pastas.some(
      (p) => (p.computador === null || p.computador === computador) && ehDoAgente(p, agente.pasta)
    )
    const regraEmTodos = u.pastas.some((p) => p.computador === null && ehDoAgente(p, agente.pasta))
    const dono = marcado
      ? undefined
      : lista.find((x) => x.id !== u.id && x.pastas.some((p) => p.computador === null && ehDoAgente(p, agente.pasta)))
    return {
      agente,
      onde,
      ondeNome: nome(onde),
      marcado,
      regraEmTodos,
      porRegra: !marcado && onde === u.id ? regraQuePega(u, agente, computador) : null,
      naoEntra: marcado && onde !== u.id,
      foraDoComputador,
      bloqueio: dono ? nomeUnidade(dono, lista) : null,
    }
  })
}

/**
 * Marcar ou desmarcar um agente. Marcar põe a pasta dele nesta unidade, só neste computador, e tira a mesma pasta de
 * outra unidade neste computador (o agente muda de projeto). Desmarcar tira a pasta exata dele daqui. null: outra
 * unidade tem a pasta em todos os computadores, e mudar lá mexeria nos outros computadores.
 */
export function alternarAgente(
  lista: UnidadeRascunho[],
  unidadeId: string,
  agente: AgenteOpenBot,
  computador: string
): UnidadeRascunho[] | null {
  const u = lista.find((x) => x.id === unidadeId)
  if (!u || !normalizarPasta(agente.pasta)) return null
  if (u.pastas.some((p) => p.computador === null && ehDoAgente(p, agente.pasta))) return null
  const aqui = (p: PastaRascunho) => (p.computador === null || p.computador === computador) && ehDoAgente(p, agente.pasta)
  if (u.pastas.some(aqui)) return lista.map((x) => (x.id === u.id ? { ...x, pastas: x.pastas.filter((p) => !aqui(p)) } : x))
  const raiz = u.pai ? lista.find((x) => x.id === u.pai) : u
  if (raiz && Array.isArray(raiz.computadores) && !raiz.computadores.includes(computador)) return null
  if (lista.some((x) => x.id !== u.id && x.pastas.some((p) => p.computador === null && ehDoAgente(p, agente.pasta))))
    return null
  const sai = (p: PastaRascunho) => p.computador === computador && ehDoAgente(p, agente.pasta)
  return lista.map((x) => {
    if (x.id === u.id) return { ...x, pastas: [...x.pastas, { computador, padrao: agente.pasta.trim() }] }
    return x.pastas.some(sai) ? { ...x, pastas: x.pastas.filter((p) => !sai(p)) } : x
  })
}

/** As pastas seguem editáveis mesmo quando passam a coincidir com a de um agente. */
export function pastasManuais(
  u: UnidadeRascunho,
  computador: string,
  _agentes: AgenteOpenBot[]
): { pasta: PastaRascunho; indice: number }[] {
  return pastasEm(u, computador)
}

/** A busca da lista: nome, título e onde o agente cai, sem ligar para maiúsculas. */
export function filtrarLinhas(linhas: LinhaAgente[], busca: string): LinhaAgente[] {
  const t = busca.trim().toLowerCase()
  if (!t) return linhas
  return linhas.filter((l) => [l.agente.nome, l.agente.titulo, l.ondeNome ?? ""].some((s) => s.toLowerCase().includes(t)))
}

/** Os agentes deste computador que um texto pega, pelo nome ou pelo título (a prévia da regra). */
export function agentesDoTexto(texto: string, agentes: AgenteOpenBot[], computador: string): AgenteOpenBot[] {
  const t = texto.trim().toLowerCase()
  if (!t) return []
  return agentesDoComputador(agentes, computador).filter(
    (a) => a.nome.toLowerCase().includes(t) || a.titulo.toLowerCase().includes(t)
  )
}

const temControle = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)

/**
 * A regra "nome ou título contém", só neste computador. null: texto vazio, longo demais ou com caractere de controle
 * (a nuvem recusaria), ou já está nesta unidade.
 */
export function adicionarTexto(
  lista: UnidadeRascunho[],
  unidadeId: string,
  texto: string,
  computador: string
): UnidadeRascunho[] | null {
  const u = lista.find((x) => x.id === unidadeId)
  const padrao = texto.trim()
  if (!u || !padrao || padrao.length > 300 || temControle(padrao)) return null
  const repetido = u.titulos.some(
    (r) =>
      r.tipo === "titulo" &&
      (r.computador === null || r.computador === computador) &&
      normalizarPasta(r.padrao) === normalizarPasta(padrao)
  )
  if (repetido) return null
  return lista.map((x) =>
    x.id === u.id ? { ...x, titulos: [...x.titulos, { tipo: "titulo" as const, padrao, computador }] } : x
  )
}

/** Uma pasta usada num computador: a de um agente do OpenBot ou a de uma sessão recente. */
export interface Usado {
  pasta: string
  projeto: string
  computadorId: string
}

export interface AvisoContas {
  /** "nenhuma": toda conta ativa está num projeto ligado; "semFolga": as que sobram não rodam agora. */
  tipo: "nenhuma" | "semFolga"
  /** Quantas pastas usadas ficam fora dos projetos ligados. */
  fora: number
  /** Quantas contas ficam fora dos projetos ligados. */
  livres: number
}

const NAO_RODA: ReadonlySet<EstadoConta> = new Set<EstadoConta>(["saindo", "precisa_login", "pausada", "esgotada", "aviso"])

interface CondicoesDoAviso {
  agora: Date
  fuso: string
  computadores: { atribuicao: { contaId: string | null } | null }[]
  trilhas: { contaId: string }[]
  trilhasConhecidas: boolean
}

/** O mesmo dia e horário da agenda da nuvem. Se não for possível interpretar, não garante disponibilidade. */
function agendaPermite(c: Conta, agora: Date, fuso: string): boolean {
  if (!c.agenda.length) return true
  try {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(agora)
    const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ""
    const dia = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(obter("weekday")) + 1
    const hora = `${obter("hour")}:${obter("minute")}:${obter("second")}`
    const comSegundos = (s: string) => /^\d{2}:\d{2}$/.test(s) ? `${s}:00` : s
    return dia > 0 && c.agenda.some((a) => a.dias.includes(dia) && hora >= comSegundos(a.de) && hora < comSegundos(a.ate))
  } catch {
    return false
  }
}

/**
 * Com algum projeto ligado, a conta marcada nele deixa de servir ao resto (rvz_principal_pode). Avisa quando há pasta
 * usada fora dos projetos ligados e nenhuma conta sobra para ela, ou as que sobram não rodam agora. null: nada a avisar.
 */
export function avisoContas(
  lista: UnidadeRascunho[],
  contas: Conta[],
  estadoDe: (c: Conta) => EstadoConta,
  usados: Usado[],
  classificar: Classificar,
  condicoes: CondicoesDoAviso
): AvisoContas | null {
  if (!lista.some((u) => ligada(u, lista))) return null
  const porId = new Map(lista.map((u) => [u.id, u]))
  const vistos = new Set<string>()
  const foraPorComputador = new Map<string, number>()
  let fora = 0
  for (const x of usados) {
    const chave = `${x.computadorId}\u0000${normalizarPasta(x.pasta) || `projeto:${x.projeto}`}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const id = classificar(x.pasta, x.projeto, x.computadorId)
    const un = id ? porId.get(id) : undefined
    if (!un || !ligada(un, lista)) {
      fora++
      foraPorComputador.set(x.computadorId, (foraPorComputador.get(x.computadorId) ?? 0) + 1)
    }
  }
  const reservadas = contasEmLigado(lista)
  const livres = contas.filter((c) => !c.saiEm && !reservadas.has(c.id))
  if (!livres.length && (fora > 0 || condicoes.computadores.length > 0)) return { tipo: "nenhuma", fora, livres: 0 }
  if (!fora) return null
  const temAlternativa = (computador: string) => livres.some((c) => {
    if (NAO_RODA.has(estadoDe(c))) return false
    if (c.cofreDisponivel !== true) return false
    if (c.semModeloConhecido !== true) return false
    const { agora, fuso, computadores, trilhas, trilhasConhecidas } = condicoes
    if (!trilhasConhecidas) return false
    if (computadores.some((pc) => pc.atribuicao?.contaId === c.id) || trilhas.some((t) => t.contaId === c.id)) return false
    if (c.semModelo.some((s) => s.computadorId === computador && Date.parse(s.ate) > agora.getTime())) return false
    if (!agendaPermite(c, agora, fuso)) return false
    const semana = c.janelas.find((j) => j.tipo === "seven_day")?.pct ?? 0
    if (c.tetoSemana !== null && semana >= c.tetoSemana) return false
    const lido = c.lidoEm ? Date.parse(c.lidoEm) : NaN
    if (!Number.isFinite(lido) || agora.getTime() - lido >= 15 * 60_000 || cheia(c, agora) === null) return false
    if (!c.posse || Date.parse(c.posse.expiraEm) <= agora.getTime()) return true
    return c.posse.computadorId === computador && c.posse.motivo !== "uso"
  })
  const semAlternativa = [...foraPorComputador].reduce((n, [pc, quantidade]) => n + (temAlternativa(pc) ? 0 : quantidade), 0)
  if (semAlternativa) return { tipo: "semFolga", fora: semAlternativa, livres: livres.length }
  return null
}
