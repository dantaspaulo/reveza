// FonteDemo: dados de exemplo gerados no próprio navegador (?demo=1). Nada vai para a nuvem.
// 5 contas fictícias com nomes genéricos (3 delas no mesmo workspace, para a cor por workspace aparecer), 2 computadores
// na versão do pacote (um deles uma atrás, para o aviso de atualização), 30 dias de uso, sessões, eventos e o resto.
// O gerador é determinístico pela semente: a mesma semente e o mesmo "agora" dão os mesmos dados (os testes contam com isso).

import { codigoDeAcesso } from "@/lib/ligacao"
import { proximaCorLivre } from "@/lib/cores"
import { versao as versaoDoInstalador } from "@/lib/instalador"
import { localizarDemo } from "./demo-idioma"
import { compararVersao, FORMATO_MODELO, normalizarModelo } from "./derivados"
import { rotuloDestino } from "./rotulos"
import {
  ErroPainel,
  type CamposConta,
  type EstadoTempoReal,
  type Fonte,
  type Recursos,
  type ResultadoNuvem,
} from "./fonte"
import type {
  AcaoComando,
  Alerta,
  ChaveApi,
  Comando,
  ConfigTroca,
  Conta,
  Computador,
  Convite,
  Diagnostico,
  EscopoChave,
  Eu,
  Evento,
  EventoAlerta,
  Idioma,
  Instantaneo,
  Intervalo,
  EstadoLigacao,
  LinhaUso,
  Membro,
  NovoAlerta,
  Papel,
  PontoHistorico,
  RegistroAuditoria,
  SessaoAberta,
  SessaoUso,
  WebhookSaida,
} from "./tipos"

/** A versão mais nova do assistente de código que a demonstração conhece (para onde o Atualizar leva). */
const ASSISTENTE_MAIS_NOVO_DEMO = "2.1.301"

const H = 3_600_000
const MIN = 60_000
const DIA = 24 * H

/** PRNG pequeno e determinístico (mulberry32). */
export function criarSorteio(semente: number) {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Preço por milhão de tokens de cada modelo de exemplo: entrada, saída, gravação e leitura de cache. */
export const PRECOS: Record<string, [number, number, number, number]> = {
  "modelo-grande": [15, 75, 18.75, 1.5],
  "modelo-medio": [3, 15, 3.75, 0.3],
  "modelo-rapido": [1, 5, 1.25, 0.1],
}

interface ModeloConta {
  id: string
  email: string
  organizacao: string
  plano: string
  nivel: string | null
  cor: number
  prioridade: number
  reserva?: boolean
  precisaLogin?: boolean
  p5: number | null
  p7: number | null
  p7Grande?: number
  reset5Min: number
  reset7Min: number
  conectadaDias: number
  agenda?: Conta["agenda"]
  tetoSemana?: number | null
  modelo?: string | null
}

const MODELO_CONTAS: ModeloConta[] = [
  {
    id: "conta-trabalho",
    email: "trabalho@exemplo.com",
    organizacao: "Empresa Exemplo",
    plano: "max",
    nivel: "20x",
    cor: 0,
    prioridade: 10,
    modelo: "opus",
    p5: 64,
    p7: 41,
    p7Grande: 63,
    reset5Min: 130,
    reset7Min: 3 * 1440 + 250,
    conectadaDias: 41,
  },
  {
    id: "conta-pessoal",
    email: "pessoal@exemplo.com",
    organizacao: "Pessoal",
    plano: "max",
    nivel: "5x",
    cor: 1,
    prioridade: 20,
    p5: 22,
    p7: 58,
    reset5Min: 240,
    reset7Min: 1 * 1440 + 1200,
    conectadaDias: 33,
    tetoSemana: 80,
  },
  {
    id: "conta-cliente",
    email: "cliente-a@exemplo.com",
    organizacao: "Cliente A",
    plano: "pro",
    nivel: null,
    cor: 2,
    prioridade: 30,
    p5: 100,
    p7: 83,
    reset5Min: 80,
    reset7Min: 2 * 1440 + 360,
    conectadaDias: 20,
    agenda: [{ dias: [1, 2, 3, 4, 5], de: "08:00", ate: "20:00" }],
  },
  {
    id: "conta-laboratorio",
    email: "laboratorio@exemplo.com",
    organizacao: "Empresa Exemplo",
    plano: "team",
    nivel: "5x",
    cor: 3,
    prioridade: 40,
    precisaLogin: true,
    p5: null,
    p7: null,
    reset5Min: 0,
    reset7Min: 0,
    conectadaDias: 27,
  },
  {
    id: "conta-reserva",
    email: "reserva@exemplo.com",
    organizacao: "Empresa Exemplo",
    plano: "pro",
    nivel: null,
    cor: 4,
    prioridade: 90,
    reserva: true,
    p5: 0,
    p7: 12,
    reset5Min: 0,
    reset7Min: 5 * 1440 + 90,
    conectadaDias: 12,
  },
]

const COMPUTADORES_BASE = [
  {
    id: "pc-notebook",
    nome: "Notebook",
    sistema: "macos" as const,
    projetos: ["loja-online", "api-pagamentos", "estudos"],
    fator: 1,
  },
  {
    id: "pc-desktop",
    nome: "Desktop",
    sistema: "linux" as const,
    projetos: ["app-mobile", "site-institucional", "scripts"],
    fator: 0.7,
  },
]

/**
 * A versão que os computadores da demonstração mostram: a do pacote, a mesma que o painel recebe no build
 * (VITE_REVEZA_VERSAO, que o instalador preenche) ou, sem ela, a do package.json do painel.
 */
export function versaoDemo(): string {
  const v = versaoDoInstalador() ?? (typeof __VERSAO_PAINEL__ === "string" ? __VERSAO_PAINEL__ : "")
  return /^\d+\.\d+\.\d+$/.test(v) ? v : "0.1.0"
}

/** A versão anterior a esta, para um computador ficar uma atrás: 0.1.5 -> 0.1.4, 0.2.0 -> 0.1.0, 1.0.0 -> 0.0.0. */
export function versaoAnterior(v: string): string | null {
  const [maior, menor, correcao] = v.split(".").map((x) => parseInt(x, 10) || 0)
  if (correcao > 0) return `${maior}.${menor}.${correcao - 1}`
  if (menor > 0) return `${maior}.${menor - 1}.0`
  if (maior > 0) return `${maior - 1}.0.0`
  return null
}

/** Conta em uso por computador, hora a hora (h = horas atrás). As últimas horas seguem a história dos eventos. */
function contaNaHora(pc: string, h: number, sorteio: () => number): string | null {
  if (pc === "pc-notebook") {
    if (h <= 2) return "conta-trabalho"
    if (h <= 4) return "conta-cliente"
    if (h <= 8) return "conta-trabalho"
  } else {
    if (h <= 6) return "conta-pessoal"
    if (h <= 9) return "conta-cliente"
  }
  if (h > 24 * 4 && h < 24 * 20 && sorteio() < 0.18) return "conta-laboratorio"
  if (h > 24 * 4 && h < 24 * 6 && sorteio() < 0.15) return "conta-reserva"
  const bloco = Math.floor(h / 6) + (pc === "pc-notebook" ? 0 : 1)
  return ["conta-trabalho", "conta-pessoal", "conta-cliente"][bloco % 3]
}

function atividade(t: Date, fator: number): number {
  const dia = t.getDay()
  const hora = t.getHours()
  const util = dia >= 1 && dia <= 5
  let p = 0.04
  if (util && ((hora >= 9 && hora < 12) || (hora >= 14 && hora < 19))) p = 0.85
  else if (util && hora >= 12 && hora < 14) p = 0.45
  else if (util && hora >= 19 && hora < 23) p = 0.4
  else if (!util && hora >= 10 && hora < 18) p = 0.22
  return p * fator
}

export interface DadosDemo {
  /** A versão do pacote que os computadores mostram (o "atualizar" leva até ela). */
  versao: string
  eu: Eu
  contas: Conta[]
  computadores: Computador[]
  config: ConfigTroca
  eventos: Evento[]
  alertas: Alerta[]
  chaves: ChaveApi[]
  webhooks: WebhookSaida[]
  membros: Membro[]
  convites: Convite[]
  comandos: Comando[]
  auditoria: RegistroAuditoria[]
  sessoesAbertas: SessaoAberta[]
  uso: LinhaUso[]
  sessoes: SessaoUso[]
  historico: PontoHistorico[]
}

export function gerarDemo(agora: Date, semente = 7, versao = versaoDemo()): DadosDemo {
  const sorteio = criarSorteio(semente)
  const iso = (ms: number) => new Date(ms).toISOString()
  const t0 = agora.getTime()
  const horaAtual = new Date(agora)
  horaAtual.setMinutes(0, 0, 0)

  // ── uso por hora, 30 dias, por computador ─────────────────────────────
  const uso: LinhaUso[] = []
  const modelos = Object.keys(PRECOS)
  for (const pc of COMPUTADORES_BASE) {
    for (let h = 30 * 24; h >= 0; h--) {
      const hora = new Date(horaAtual.getTime() - h * H)
      // a história recente sempre tem uso (as contas em uso agora precisam de uso na janela delas)
      const forcada = (pc.id === "pc-notebook" && h <= 4) || (pc.id === "pc-desktop" && h <= 6)
      if (!forcada && sorteio() > atividade(hora, pc.fator)) continue
      const contaId = contaNaHora(pc.id, h, sorteio)
      const nProjetos = sorteio() < 0.35 ? 2 : 1
      for (let k = 0; k < nProjetos; k++) {
        const projeto = pc.projetos[Math.floor(sorteio() * pc.projetos.length)]
        const r = sorteio()
        const modelo = r < 0.45 ? modelos[0] : r < 0.9 ? modelos[1] : modelos[2]
        const parcial = h === 0 ? Math.max(0.15, agora.getMinutes() / 60) : 1
        const respostas = Math.max(1, Math.round((6 + sorteio() * 48) * parcial))
        const entrada = Math.round(respostas * (200 + sorteio() * 1800))
        const saida = Math.round(respostas * (300 + sorteio() * 1200))
        const cacheEscrita = Math.round(respostas * (1000 + sorteio() * 5000))
        const cacheLeitura = Math.round(respostas * (20000 + sorteio() * 60000))
        const [pe, ps, pw, pr] = PRECOS[modelo]
        const usd = (entrada * pe + saida * ps + cacheEscrita * pw + cacheLeitura * pr) / 1e6
        uso.push({
          hora: hora.toISOString(),
          contaId,
          computadorId: pc.id,
          projeto,
          modelo,
          respostas,
          entrada,
          saida,
          cacheEscrita,
          cacheLeitura,
          usd: Math.round(usd * 10000) / 10000,
        })
      }
    }
  }

  // ── sessões: horas seguidas do mesmo computador e projeto ───────────────
  const sessoes: SessaoUso[] = []
  const chaveGrupo = (l: LinhaUso) => `${l.computadorId}|${l.projeto}`
  const porGrupo = new Map<string, LinhaUso[]>()
  for (const l of uso) {
    const g = porGrupo.get(chaveGrupo(l)) ?? []
    g.push(l)
    porGrupo.set(chaveGrupo(l), g)
  }
  let nSessao = 0
  for (const linhas of porGrupo.values()) {
    linhas.sort((a, b) => a.hora.localeCompare(b.hora))
    let atual: LinhaUso[] = []
    const fechar = () => {
      if (!atual.length) return
      const ini = new Date(atual[0].hora).getTime() + Math.floor(sorteio() * 40) * MIN
      const ultima = new Date(atual[atual.length - 1].hora).getTime()
      const aberta = t0 - ultima < H
      const fim = aberta ? null : iso(ultima + (15 + Math.floor(sorteio() * 40)) * MIN)
      const contas = [...new Set(atual.map((l) => l.contaId).filter(Boolean))] as string[]
      sessoes.push({
        id: `s-${++nSessao}`,
        computadorId: atual[0].computadorId,
        projeto: atual[0].projeto,
        inicio: iso(Math.min(ini, t0 - MIN)),
        fim,
        respostas: atual.reduce((s, l) => s + l.respostas, 0),
        tokens: atual.reduce((s, l) => s + l.entrada + l.saida + l.cacheEscrita + l.cacheLeitura, 0),
        usd: Math.round(atual.reduce((s, l) => s + l.usd, 0) * 100) / 100,
        agentes: Math.floor(sorteio() * sorteio() * 9),
        contas,
        modelos: [...new Set(atual.map((l) => l.modelo))],
        paradaNoLimite: contas.includes("conta-cliente") && sorteio() < 0.2,
      })
      atual = []
    }
    for (const l of linhas) {
      const ultima = atual[atual.length - 1]
      if (ultima && new Date(l.hora).getTime() - new Date(ultima.hora).getTime() > 2 * H) fechar()
      atual.push(l)
      if (atual.length >= 5) fechar()
    }
    fechar()
  }
  sessoes.sort((a, b) => b.inicio.localeCompare(a.inicio))

  // ── contas e janelas ──────────────────────────────────────────────────
  const contas: Conta[] = MODELO_CONTAS.map((m) => {
    const janelas: Conta["janelas"] = []
    if (m.p5 !== null)
      janelas.push({ tipo: "five_hour", pct: m.p5, resetEm: m.reset5Min ? iso(t0 + m.reset5Min * MIN) : null })
    if (m.p7 !== null) janelas.push({ tipo: "seven_day", pct: m.p7, resetEm: iso(t0 + m.reset7Min * MIN) })
    if (m.p7Grande !== undefined)
      janelas.push({ tipo: "seven_day_opus", pct: m.p7Grande, resetEm: iso(t0 + m.reset7Min * MIN) })
    // a semana do Fable que a API manda à parte (outubro de 2026); a conta de equipe não tem
    const fable = m.id === "conta-trabalho" ? 18 : m.id === "conta-pessoal" ? 7 : null
    if (fable !== null) janelas.push({ tipo: "seven_day_fable", pct: fable, resetEm: iso(t0 + m.reset7Min * MIN) })
    const posse =
      m.id === "conta-trabalho"
        ? { computadorId: "pc-notebook", motivo: "uso" as const, expiraEm: iso(t0 + 2 * MIN) }
        : m.id === "conta-pessoal"
          ? { computadorId: "pc-desktop", motivo: "uso" as const, expiraEm: iso(t0 + 2 * MIN) }
          : null
    return {
      id: m.id,
      email: m.email,
      organizacao: m.organizacao,
      plano: m.plano,
      nivel: m.nivel,
      cor: m.cor,
      prioridade: m.prioridade,
      reserva: !!m.reserva,
      pausada: false,
      agenda: m.agenda ?? [],
      tetoSemana: m.tetoSemana ?? null,
      modelo: m.modelo ?? null,
      precisaLogin: !!m.precisaLogin,
      criadaEm: iso(t0 - m.conectadaDias * DIA),
      janelas,
      lidoEm: m.precisaLogin ? iso(t0 - 26 * H) : iso(t0 - (20 + Math.floor(sorteio() * 60)) * 1000),
      fonte: m.precisaLogin ? null : m.id === "conta-reserva" || m.id === "conta-cliente" ? "api" : "sessao",
      loginExpiraEm: m.precisaLogin ? iso(t0 - 26 * H) : iso(t0 + (m.id === "conta-reserva" ? 5 : 30) * H),
      posse,
      // a conta de equipe não roda o Fable sem créditos: fora do Notebook por algumas horas (o caso de 22/10/2026)
      semModelo: m.id === "conta-laboratorio" ? [{ computadorId: "pc-notebook", modelo: "claude-fable-5-1", ate: iso(t0 + 4 * H) }] : [],
    }
  })

  // ── histórico de 5 em 5 minutos (8 dias), coerente com o uso de cada conta ─────────
  const historico: PontoHistorico[] = []
  const usdPorContaHora = new Map<string, Map<number, number>>()
  for (const l of uso) {
    if (!l.contaId) continue
    const m = usdPorContaHora.get(l.contaId) ?? new Map<number, number>()
    const t = new Date(l.hora).getTime()
    m.set(t, (m.get(t) ?? 0) + l.usd)
    usdPorContaHora.set(l.contaId, m)
  }
  // soma acumulada por hora (prefixo), para somar qualquer intervalo em tempo constante
  const inicioHoras = horaAtual.getTime() - 31 * DIA
  const nHoras = 31 * 24 + 2
  const prefixos = new Map<string, Float64Array>()
  for (const [contaId, m] of usdPorContaHora) {
    const p = new Float64Array(nHoras + 1)
    for (const [t, v] of m) {
      const i = Math.round((t - inicioHoras) / H)
      if (i >= 0 && i < nHoras) p[i + 1] += v
    }
    for (let i = 1; i <= nHoras; i++) p[i] += p[i - 1]
    prefixos.set(contaId, p)
  }
  const ate = (p: Float64Array, t: number) => {
    const x = Math.max(0, Math.min(nHoras, (t - inicioHoras) / H))
    const i = Math.floor(x)
    const resto = x - i
    return p[i] + (i < nHoras ? (p[i + 1] - p[i]) * resto : 0)
  }
  const acumulado = (contaId: string, de: number, fim: number) => {
    const p = prefixos.get(contaId)
    if (!p || fim <= de) return 0
    return ate(p, fim) - ate(p, de)
  }
  for (const m of MODELO_CONTAS) {
    if (m.p7 === null) continue
    const reset7 = t0 + m.reset7Min * MIN
    const inicio7 = reset7 - 7 * DIA
    const total7 = acumulado(m.id, inicio7, t0)
    const escala7 = total7 > 0 ? m.p7 / total7 : 0
    const anteriorInicio = inicio7 - 7 * DIA
    const totalAnterior = acumulado(m.id, anteriorInicio, inicio7)
    const escalaAnterior = totalAnterior > 0 ? 70 / totalAnterior : 0
    const reset5 = m.reset5Min ? t0 + m.reset5Min * MIN : t0
    const inicio5 = reset5 - 5 * H
    const total5 = acumulado(m.id, inicio5, t0)
    const escala5 = total5 > 0 && m.p5 ? m.p5 / total5 : escala7 * 4.5
    for (let t = t0 - 8 * DIA; t <= t0; t += 5 * MIN) {
      // conta quase parada na semana (a reserva): o uso já veio de antes e fica no mesmo ponto
      const p7 =
        t >= inicio7
          ? total7 > 0
            ? acumulado(m.id, inicio7, t) * escala7
            : m.p7
          : acumulado(m.id, anteriorInicio, t) * escalaAnterior
      // janelas de 5 horas encadeadas para trás a partir da atual
      const k = Math.floor((inicio5 - t) / (5 * H)) + 1
      const ini5 = t >= inicio5 ? inicio5 : inicio5 - k * 5 * H
      const p5 = Math.min(100, acumulado(m.id, ini5, t) * escala5)
      historico.push({
        contaId: m.id,
        em: iso(t),
        p5: Math.round(p5 * 10) / 10,
        p7: Math.round(Math.min(100, p7) * 10) / 10,
      })
    }
  }

  // ── computadores ──────────────────────────────────────────────────────
  // as mesmas conferências do `reveza doctor`; o Desktop tem problemas, dois com conserto automático (o Corrigir)
  const diagnostico = (doComputador: string, atraso: number, comProblema: boolean, assistente: string): Diagnostico => ({
    em: iso(t0 - 4 * MIN),
    versao: doComputador,
    atrasoBuscaMs: atraso,
    // a mais nova publicada, que o agente leu no GitHub oficial (na demonstração, a versão do pacote)
    versaoNova: versao,
    assimQueSair: true,
    // os dois computadores com versões diferentes do assistente de código (o caso que pediu o cartão, 15/10/2026)
    assistente: { versao: assistente, autoDesligado: null, atualizando: false, ultima: null },
    itens: [
      { id: "agente", ok: true, detalhe: `versão ${doComputador}, Node 22.12.0` },
      { id: "servico", ok: true, detalhe: "rodando" },
      { id: "ponte", ok: true, detalhe: "o agente responde na porta local" },
      comProblema
        ? { id: "mod", ok: null, detalhe: "o mod não está carregado nas sessões (uso ao vivo e retomada ficam sem)", conserto: true }
        : { id: "mod", ok: true, detalhe: "plugin instalado (reveza@reveza)" },
      comProblema
        ? { id: "credenciais", ok: false, detalhe: "nenhum login em /home/ana/.claude/.credentials.json", conserto: true }
        : { id: "credenciais", ok: true, detalhe: "trabalho@exemplo.com; token vence em 312 min" },
      { id: "contas", ok: true, detalhe: "5 conta(s)" },
      { id: "chaveiro", ok: true, detalhe: "keychain, chave do cofre presente" },
      { id: "nuvem", ok: true, detalhe: "https://reveza-exemplo.supabase.co responde" },
      comProblema
        ? {
            id: "relogio",
            ok: false,
            detalhe: "diferença de 412 s para o servidor",
            fazer: "acerte a data e a hora do sistema (ligue o acerto automático pela internet); o Reveza não mexe nisso",
          }
        : { id: "relogio", ok: true, detalhe: "diferença de 0 s para o servidor" },
      { id: "assistente", ok: true, detalhe: `versão ${assistente}` },
    ],
  })
  // o Desktop fica uma versão atrás (se houver anterior), para o aviso de atualização aparecer
  const anterior = versaoAnterior(versao)
  const computadores: Computador[] = [
    {
      id: "pc-notebook",
      nome: "Notebook",
      sistema: "macos",
      versao,
      vistoEm: iso(t0 - 3000),
      revogado: false,
      criadoEm: iso(t0 - 41 * DIA),
      diagnostico: diagnostico(versao, 180, false, "2.1.301"),
      atribuicao: { contaId: "conta-trabalho", motivo: "limite", decididoEm: iso(t0 - 2 * H - 4 * MIN) },
      contaPreferidaId: "conta-trabalho",
      nomeDoPainel: false,
      enxugar: true,
    },
    {
      id: "pc-desktop",
      nome: "Desktop",
      sistema: "linux",
      versao: anterior ?? versao,
      vistoEm: iso(t0 - 4000),
      revogado: false,
      criadoEm: iso(t0 - 12 * DIA),
      diagnostico: diagnostico(anterior ?? versao, 420, anterior !== null, "2.1.293"),
      atribuicao: { contaId: "conta-pessoal", motivo: "rodizio", decididoEm: iso(t0 - 6 * H - 11 * MIN) },
      contaPreferidaId: null,
      nomeDoPainel: false,
      enxugar: false,
    },
  ]

  // ── eventos ───────────────────────────────────────────────────────────
  let idEvento = 1000
  const ev = (minAtras: number, tipo: Evento["tipo"], texto: string, dados: Evento["dados"]): Evento => ({
    id: idEvento--,
    em: iso(t0 - minAtras * MIN),
    tipo,
    texto,
    dados,
  })
  const eventos: Evento[] = [
    ev(118, "retomada", "sessão retomada", { computador: "pc-notebook", conta: "conta-trabalho" }),
    ev(124, "troca", "troca", {
      computador: "pc-notebook",
      de: "conta-cliente",
      para: "conta-trabalho",
      motivo: "limite",
    }),
    ev(125, "limite", "limite", { computador: "pc-notebook", conta: "conta-cliente", pct: 100 }),
    ev(126, "alerta", "alerta enviado", { canal: "telegram", motivo: "limite" }),
    ev(152, "aviso", "aviso", { computador: "pc-notebook", conta: "conta-cliente", pct: 91 }),
    ev(244, "troca", "troca", {
      computador: "pc-notebook",
      de: "conta-trabalho",
      para: "conta-cliente",
      motivo: "rodizio",
    }),
    ev(371, "troca", "troca", {
      computador: "pc-desktop",
      de: "conta-cliente",
      para: "conta-pessoal",
      motivo: "rodizio",
    }),
    ev(530, "troca", "troca", {
      computador: "pc-desktop",
      de: "conta-trabalho",
      para: "conta-cliente",
      motivo: "rodizio",
    }),
    ev(26 * 60, "erro", "login venceu", { conta: "conta-laboratorio", motivo: "precisa_login" }),
    ev(26 * 60 + 2, "alerta", "alerta enviado", { canal: "telegram", motivo: "precisa_login" }),
    ev(3 * 1440, "info", "config", { motivo: "auto_ligada" }),
    ev(12 * 1440, "conexao", "computador ligado", { computador: "pc-desktop" }),
  ]

  // ── o resto do painel ─────────────────────────────────────────────────
  const eu: Eu = {
    userId: "u-admin",
    email: "admin@exemplo.com",
    nome: "Administração",
    papel: "admin",
    idioma: "pt-BR",
    aal: "aal2",
    totp: { fatorId: "fator-1", criadoEm: iso(t0 - 40 * DIA) },
  }
  const config: ConfigTroca = {
    auto: true,
    modo: "limiar",
    aviso: 90,
    troca: 95,
    rodizioMinutos: 90,
    rodizioOrdem: "aleatoria",
    intervaloS: 5,
    retomarTerminal: false,
    esperaEntreTrocasS: 90,
    fuso: "America/Sao_Paulo",
    exigirDuasEtapas: false,
    atualizarSozinho: "desligada",
    assistenteAtualizar: "padrao",
    atualizacaoVez: null,
    // a nuvem e o painel na versão da demonstração, com a atualização completa desligada (o padrão)
    nuvem: {
      versao,
      atualizacao: { estado: "atualizada", de: versaoAnterior(versao), para: versao, desde: iso(t0 - 2 * DIA), motivo: null },
      publicado: { funcoes: versao, painel: versao },
      impressoes: {},
      completa: false,
      publicacao: null,
    },
    proximoRodizioEm: null,
  }
  const alertas: Alerta[] = [
    {
      id: "al-1",
      canal: "telegram",
      destino: "chat 4821",
      destinoBruto: { chat_id: "4821", vault_id: "vault-1" },
      eventos: ["sem_livre", "troca_falhou", "precisa_login", "computador_parado", "limite"],
      ativo: true,
    },
    {
      id: "al-2",
      canal: "push",
      destino: "",
      destinoBruto: {},
      eventos: ["sem_livre", "troca_falhou", "precisa_login", "computador_parado"],
      ativo: true,
    },
    {
      id: "al-3",
      canal: "email",
      destino: "admin@exemplo.com",
      destinoBruto: { para: "admin@exemplo.com", de: "alertas@exemplo.com", vault_id: "vault-3" },
      eventos: ["resumo_dia"],
      ativo: false,
    },
  ]
  const chaves: ChaveApi[] = [
    {
      id: "ch-1",
      nome: "Automação n8n",
      prefixo: "rvz_7kq2m4",
      escopos: ["ler", "trocar"],
      criadaEm: iso(t0 - 18 * DIA),
      usadaEm: iso(t0 - 2 * H),
      revogada: false,
    },
    {
      id: "ch-2",
      nome: "Script do terminal",
      prefixo: "rvz_p9xa3c",
      escopos: ["ler"],
      criadaEm: iso(t0 - 6 * DIA),
      usadaEm: null,
      revogada: false,
    },
  ]
  const webhooks: WebhookSaida[] = [
    {
      id: "wh-1",
      url: "https://n8n.exemplo.com/webhook/reveza",
      eventos: ["troca", "limite", "sem_livre", "troca_falhou"],
      ativo: true,
    },
  ]
  const membros: Membro[] = [
    {
      userId: "u-admin",
      email: "admin@exemplo.com",
      nome: "Administração",
      papel: "admin",
      criadoEm: iso(t0 - 41 * DIA),
    },
    { userId: "u-financeiro", email: null, nome: "Financeiro", papel: "leitura", criadoEm: iso(t0 - 9 * DIA) },
  ]
  const convites: Convite[] = [
    { id: "cv-1", email: "equipe@exemplo.com", papel: "leitura", expiraEm: iso(t0 + 47 * H), usadoEm: null },
  ]
  const auditoria: RegistroAuditoria[] = [
    { id: 9, em: iso(t0 - 26 * MIN), quem: "Administração", acao: "comando", alvo: "Desktop · diagnostico" },
    { id: 8, em: iso(t0 - 3 * 1440 * MIN), quem: "Administração", acao: "config", alvo: "auto = ligada" },
    { id: 7, em: iso(t0 - 3 * 1440 * MIN - 5 * MIN), quem: "Administração", acao: "config", alvo: "modo = limiar" },
    { id: 6, em: iso(t0 - 6 * DIA), quem: "Administração", acao: "chave_api_criar", alvo: "Script do terminal" },
    { id: 5, em: iso(t0 - 7 * DIA), quem: "Administração", acao: "convidar", alvo: "equipe@exemplo.com · leitura" },
    { id: 4, em: iso(t0 - 9 * DIA), quem: "Administração", acao: "convidar", alvo: "financeiro@exemplo.com · leitura" },
    { id: 3, em: iso(t0 - 12 * DIA), quem: "Administração", acao: "registrar_computador", alvo: "Desktop" },
    { id: 2, em: iso(t0 - 18 * DIA), quem: "Administração", acao: "chave_api_criar", alvo: "Automação n8n" },
    { id: 1, em: iso(t0 - 41 * DIA), quem: "instalador", acao: "registrar_computador", alvo: "Notebook" },
  ]
  const sessoesAbertas: SessaoAberta[] = [
    { id: "se-1", criadaEm: iso(t0 - 3 * H), ultimaVez: iso(t0 - MIN), aparelho: "navegador_desktop", atual: true },
    { id: "se-2", criadaEm: iso(t0 - 4 * DIA), ultimaVez: iso(t0 - 5 * H), aparelho: "celular_app", atual: false },
    {
      id: "se-3",
      criadaEm: iso(t0 - 9 * DIA),
      ultimaVez: iso(t0 - 2 * DIA),
      aparelho: "navegador_outro",
      atual: false,
    },
  ]
  return {
    versao,
    eu,
    contas,
    computadores,
    config,
    eventos,
    alertas,
    chaves,
    webhooks,
    membros,
    convites,
    comandos: [],
    auditoria,
    sessoesAbertas,
    uso,
    sessoes,
    historico,
  }
}

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function idAleatorio(prefixo: string) {
  return `${prefixo}-${Math.random().toString(36).slice(2, 9)}`
}

function hexAleatorio(bytes: number) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export interface OpcoesDemo {
  agora?: () => Date
  semente?: number
  /** Atraso simulado das escritas (a tela mostra o "salvando"). */
  atrasoMs?: number
  /** Liga o relógio que atualiza "visto há" dos computadores de 5 em 5 s. */
  relogio?: boolean
  /** Idioma dos textos de exemplo (nomes, projetos, e-mails). */
  idioma?: Idioma
  /** Versão do pacote que os computadores mostram (padrão: versaoDemo()). */
  versao?: string
}

export class FonteDemo implements Fonte {
  readonly demo = true
  readonly recursos: Recursos = {
    testarAlerta: true,
    testarWebhook: true,
    cancelarConvite: true,
    listarSessoes: true,
    push: false,
  }
  private d: DadosDemo
  private ouvintes = new Set<() => void>()
  private agora: () => Date
  private atrasoMs: number
  private relogio: ReturnType<typeof setInterval> | null = null
  private comRelogio: boolean
  private idioma: Idioma = "pt-BR"
  /** Ligações de computador novo encenadas: quando o código foi criado e onde a janela abre. */
  private ligacoesDemo = new Map<string, { criadoEm: number; aprovador: string | null }>()

  constructor(opcoes: OpcoesDemo = {}) {
    this.agora = opcoes.agora ?? (() => new Date())
    this.atrasoMs = opcoes.atrasoMs ?? 350
    this.comRelogio = opcoes.relogio ?? true
    this.idioma = opcoes.idioma ?? "pt-BR"
    this.d = gerarDemo(this.agora(), opcoes.semente ?? 7, opcoes.versao ?? versaoDemo())
  }

  /** O idioma da tela: em inglês, os textos de exemplo (nomes, projetos, e-mails) saem em inglês. */
  usarIdioma(idioma: Idioma) {
    if (idioma === this.idioma) return
    this.idioma = idioma
    this.emitir()
  }

  private l<T>(v: T): T {
    return localizarDemo(v, this.idioma)
  }

  /** Só para os testes: o estado bruto. */
  get dados(): DadosDemo {
    return this.d
  }

  private emitir() {
    for (const o of this.ouvintes) o()
  }

  private async escrever<T>(fazer: () => T): Promise<T> {
    if (this.atrasoMs) await esperar(this.atrasoMs)
    const r = fazer()
    this.emitir()
    return r
  }

  private evento(tipo: Evento["tipo"], texto: string, dados: Evento["dados"]) {
    const maior = this.d.eventos.reduce((m, e) => Math.max(m, e.id), 0)
    this.d.eventos.unshift({ id: maior + 1, em: this.agora().toISOString(), tipo, texto, dados })
  }

  private auditar(acao: string, alvo: string) {
    const maior = this.d.auditoria.reduce((m, e) => Math.max(m, e.id), 0)
    this.d.auditoria.unshift({
      id: maior + 1,
      em: this.agora().toISOString(),
      quem: this.d.eu.nome ?? this.d.eu.email,
      acao,
      alvo,
    })
  }

  private conta(id: string) {
    const c = this.d.contas.find((x) => x.id === id)
    if (!c) throw new ErroPainel("nao_encontrado")
    return c
  }

  private computador(id: string) {
    const c = this.d.computadores.find((x) => x.id === id)
    if (!c) throw new ErroPainel("nao_encontrado")
    return c
  }

  async carregar(): Promise<Instantaneo> {
    const copia = this.l(structuredClone(this.d))
    return {
      agora: this.agora().toISOString(),
      eu: copia.eu,
      contas: copia.contas,
      computadores: copia.computadores,
      config: copia.config,
      eventos: copia.eventos.slice(0, 100),
      alertas: copia.alertas,
      chaves: copia.chaves,
      webhooks: copia.webhooks,
      membros: copia.membros,
      convites: copia.convites,
      comandos: copia.comandos,
    }
  }

  async uso({ de, ate }: Intervalo): Promise<LinhaUso[]> {
    const a = de.getTime()
    const b = ate.getTime()
    return this.l(
      this.d.uso.filter((l) => {
        const t = new Date(l.hora).getTime()
        return t >= a && t < b
      })
    )
  }

  async sessoes({ de, ate }: Intervalo): Promise<SessaoUso[]> {
    const a = de.getTime()
    const b = ate.getTime()
    return this.l(
      this.d.sessoes.filter((s) => {
        const t = new Date(s.inicio).getTime()
        return t >= a && t < b
      })
    )
  }

  async historico(desde: Date): Promise<PontoHistorico[]> {
    const a = desde.getTime()
    return this.d.historico.filter((p) => new Date(p.em).getTime() >= a)
  }

  async auditoria(limite: number): Promise<RegistroAuditoria[]> {
    return this.l(this.d.auditoria.slice(0, limite))
  }

  async minhasSessoes(): Promise<SessaoAberta[]> {
    return structuredClone(this.d.sessoesAbertas)
  }

  assinar(aoMudar: () => void, aoEstado?: (estado: EstadoTempoReal) => void): () => void {
    this.ouvintes.add(aoMudar)
    // a demonstração não tem rede: o "tempo real" dela é o relógio deste navegador, sempre ligado
    aoEstado?.("ligado")
    if (this.comRelogio && !this.relogio && typeof window !== "undefined") {
      this.relogio = setInterval(() => {
        const t = this.agora().getTime()
        for (const c of this.d.computadores) {
          if (c.revogado || c.sistema === "pendente") continue
          c.vistoEm = new Date(t - 1000 - Math.floor(Math.random() * 3000)).toISOString()
        }
        this.emitir()
      }, 5000)
    }
    return () => {
      this.ouvintes.delete(aoMudar)
      if (!this.ouvintes.size && this.relogio) {
        clearInterval(this.relogio)
        this.relogio = null
      }
    }
  }

  salvarConfig(campos: Partial<ConfigTroca>) {
    return this.escrever(() => {
      if (campos.aviso !== undefined || campos.troca !== undefined) {
        const aviso = campos.aviso ?? this.d.config.aviso
        const troca = campos.troca ?? this.d.config.troca
        if (aviso >= troca) throw new ErroPainel("aviso_maior_que_troca")
      }
      const antes = this.d.config.auto
      const { atualizacaoVez: _vez, proximoRodizioEm: _prox, nuvem: _nuvem, ...gravaveis } = campos
      void _vez
      void _prox
      void _nuvem
      Object.assign(this.d.config, gravaveis)
      for (const [k, v] of Object.entries(gravaveis)) this.auditar("config", `${k} = ${String(v)}`)
      if (campos.auto !== undefined && campos.auto !== antes)
        this.evento("info", "config", { motivo: campos.auto ? "auto_ligada" : "auto_desligada" })
      // como no banco: mudar a escolha destrava a vez; "assim que sair" começa já com quem sabe da versão nova
      if (campos.atualizarSozinho !== undefined) {
        this.d.config.atualizacaoVez = null
        this.rolarSozinho()
      }
      // como os agentes: "só pelo painel" desliga a atualização automática do assistente; "sempre a mais nova" alinha já
      if (campos.assistenteAtualizar !== undefined) {
        for (const pc of this.d.computadores) {
          if (pc.diagnostico?.assistente) pc.diagnostico.assistente.autoDesligado = campos.assistenteAtualizar === "manual" ? "reveza" : null
        }
        if (campos.assistenteAtualizar === "sozinho") {
          for (const pc of this.d.computadores) this.atualizarAssistenteDemo(pc, true)
        }
      }
    })
  }

  /** Como o agente: o `claude update` leva uns segundos e o computador volta na mais nova que a demonstração conhece. */
  private atualizarAssistenteDemo(pc: Computador, sozinho: boolean): string | null {
    const a = pc.diagnostico?.assistente
    if (!a || a.atualizando || pc.revogado) return null
    const de = a.versao
    const para = ASSISTENTE_MAIS_NOVO_DEMO
    a.atualizando = true
    setTimeout(() => {
      a.atualizando = false
      a.versao = para
      a.ultima = { em: this.agora().toISOString(), ok: true, de, para, sozinho }
      if (pc.diagnostico) {
        pc.diagnostico.itens = pc.diagnostico.itens.map((i) => (i.id === "assistente" ? { ...i, detalhe: `versão ${para}` } : i))
      }
      this.emitir()
    }, 3500)
    return de
  }

  /**
   * Como os agentes com "assim que sair": um computador por vez, quem está atrás da versão que conhece se atualiza; o
   * próximo só quando o anterior voltou na versão nova.
   */
  private rolarSozinho() {
    if (this.d.config.atualizarSozinho !== "assim_que_sair" || this.d.config.atualizacaoVez?.estado === "em_andamento") return
    // como a trava do agente: quem precisa da nuvem e do painel atualizados primeiro não vai
    const pc = this.d.computadores.find(
      (c) =>
        !c.revogado &&
        c.sistema !== "pendente" &&
        c.diagnostico?.versaoNova &&
        compararVersao(c.diagnostico.versaoNova, c.versao) > 0 &&
        c.diagnostico.precisaNuvem?.para !== c.diagnostico.versaoNova
    )
    if (!pc) return
    const de = pc.versao
    const para = pc.diagnostico!.versaoNova!
    const desde = this.agora().toISOString()
    this.d.config.atualizacaoVez = { computadorId: pc.id, para, estado: "em_andamento", desde }
    pc.diagnostico!.atualizacao = { para, desde }
    this.evento("info", "atualizacao", { computador: pc.id, atualizacao: "pedida", de, para, comando: null, sozinho: true, modo: "assim_que_sair" })
    this.emitir()
    setTimeout(() => {
      pc.versao = para
      if (pc.diagnostico) {
        pc.diagnostico.versao = para
        pc.diagnostico.atualizacao = null
        pc.diagnostico.itens = pc.diagnostico.itens.map((i) => (i.id === "agente" ? { ...i, detalhe: `versão ${para}, Node 22.12.0` } : i))
      }
      this.d.config.atualizacaoVez = { computadorId: pc.id, para, estado: "concluida", desde }
      this.evento("info", "atualizacao", { computador: pc.id, atualizacao: "concluida", de, para, comando: null, sozinho: true, modo: "assim_que_sair" })
      this.emitir()
      this.rolarSozinho()
    }, 6000)
  }

  salvarConta(id: string, campos: CamposConta) {
    return this.escrever(() => {
      const c = this.conta(id)
      if (campos.tetoSemana != null && (campos.tetoSemana < 1 || campos.tetoSemana > 100))
        throw new ErroPainel("teto_invalido")
      // como na nuvem (0025): minúsculo e sem espaço; vazio tira; fora do formato recusa sem mudar nada
      if (campos.modelo !== undefined) {
        const modelo = normalizarModelo(campos.modelo)
        if (modelo !== null && !FORMATO_MODELO.test(modelo)) throw new ErroPainel("modelo_invalido")
        campos = { ...campos, modelo }
      }
      Object.assign(c, campos)
      this.auditar("conta", `${c.email} · ${Object.keys(campos).join(", ")}`)
    })
  }

  ordenarContas(ids: string[]) {
    return this.escrever(() => {
      ids.forEach((id, i) => {
        this.conta(id).prioridade = (i + 1) * 10
      })
      this.auditar("conta", "ordem de preferência")
    })
  }

  trocarAgora(computadorId: string, contaId: string) {
    return this.escrever(() => {
      const pc = this.computador(computadorId)
      const destino = this.conta(contaId)
      if (destino.posse && destino.posse.computadorId !== computadorId) throw new ErroPainel("conta_ocupada")
      if (destino.precisaLogin) throw new ErroPainel("conta_precisa_login")
      const de = pc.atribuicao?.contaId ?? null
      if (de) {
        const antiga = this.d.contas.find((c) => c.id === de)
        if (antiga) antiga.posse = null
      }
      const agora = this.agora()
      destino.posse = { computadorId, motivo: "uso", expiraEm: new Date(agora.getTime() + 2 * MIN).toISOString() }
      pc.atribuicao = { contaId, motivo: "manual", decididoEm: agora.toISOString() }
      this.evento("troca", "troca", { computador: computadorId, de, para: contaId, motivo: "manual" })
      this.auditar("trocar", `${pc.nome} → ${destino.email}`)
    })
  }

  preferirConta(computadorId: string, contaId: string | null) {
    return this.escrever(() => {
      const pc = this.computador(computadorId)
      if (pc.revogado) throw new ErroPainel("computador_revogado")
      const conta = contaId ? this.conta(contaId) : null
      if (conta && this.d.computadores.some((q) => q.id !== computadorId && !q.revogado && q.contaPreferidaId === conta.id))
        throw new ErroPainel("preferida_de_outro")
      pc.contaPreferidaId = conta?.id ?? null
      this.auditar("preferida", `${pc.nome} · ${conta?.email ?? "nenhuma"}`)
      // como na nuvem: se a preferida estiver livre (sem outro computador, com login, fora de pausa), passa para ela na hora
      const livre =
        conta &&
        pc.atribuicao?.contaId !== conta.id &&
        !conta.pausada &&
        !conta.precisaLogin &&
        !(conta.posse && conta.posse.computadorId !== computadorId) &&
        !this.d.computadores.some((q) => q.id !== computadorId && q.atribuicao?.contaId === conta.id)
      if (conta && livre) {
        const de = pc.atribuicao?.contaId ?? null
        if (de) {
          const antiga = this.d.contas.find((c) => c.id === de)
          if (antiga) antiga.posse = null
        }
        const agora = this.agora()
        const motivo = "conta preferida deste computador"
        conta.posse = { computadorId, motivo: "uso", expiraEm: new Date(agora.getTime() + 2 * MIN).toISOString() }
        pc.atribuicao = { contaId: conta.id, motivo, decididoEm: agora.toISOString() }
        this.evento("troca", "troca", { computador: computadorId, de, para: conta.id, motivo })
      }
    })
  }

  enxugarComputador(computadorId: string, ligado: boolean) {
    return this.escrever(() => {
      const pc = this.computador(computadorId)
      if (pc.revogado) throw new ErroPainel("computador_revogado")
      pc.enxugar = ligado
      this.auditar("enxugar", `${pc.nome} · ${ligado ? "ligada" : "desligada"}`)
    })
  }

  async comando(computadorId: string, acao: AcaoComando, corpo: Record<string, unknown> = {}): Promise<Comando> {
    const pc = this.computador(computadorId)
    const cmd = await this.escrever(() => {
      const c: Comando = {
        id: this.d.comandos.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        computadorId,
        acao,
        estado: "pendente",
        criadoEm: this.agora().toISOString(),
        resposta: null,
      }
      this.d.comandos.unshift(c)
      this.auditar("comando", `${pc.nome} · ${acao}`)
      return c
    })
    // o computador busca a cada 5 s: na demonstração, reserva logo e responde em seguida
    setTimeout(() => {
      cmd.estado = "reservado"
      this.emitir()
    }, 700)
    setTimeout(() => {
      cmd.estado = "feito"
      if (acao === "diagnostico" && pc.diagnostico) {
        pc.diagnostico.em = this.agora().toISOString()
        pc.diagnostico.atrasoBuscaMs = 150 + Math.floor(Math.random() * 300)
        if (corpo.corrigir === true) {
          // como o agente: só o que tem conserto automático muda; a resposta vem no formato do `reveza doctor`
          const consertado = (id: string) =>
            id === "mod"
              ? { detalhe: "plugin instalado (reveza@reveza)", texto: "mod reinstalado (vale nas sessões novas)" }
              : id === "credenciais"
                ? { detalhe: "pessoal@exemplo.com; token vence em 288 min", texto: "o assistente voltou a ter login: pessoal@exemplo.com" }
                : null
          const conferencias = pc.diagnostico.itens.map((i) => {
            const c = i.ok !== true && i.conserto ? consertado(i.id) : null
            return {
              id: i.id,
              situacao: c ? "ok" : i.ok === true ? "ok" : i.ok === false ? "falha" : "aviso",
              detalhe: c?.detalhe ?? i.detalhe ?? "",
              ...(c ? { consertado: { resultado: "corrigido", texto: c.texto } } : {}),
              ...(!c && i.ok !== true && i.fazer ? { fazer: i.fazer } : {}),
            }
          })
          pc.diagnostico.itens = pc.diagnostico.itens.map((i) => {
            const c = i.ok !== true && i.conserto ? consertado(i.id) : null
            return c ? { id: i.id, ok: true, detalhe: c.detalhe } : i
          })
          cmd.resposta = {
            ok: true,
            corrigir: true,
            diagnostico: { conferencias, em: pc.diagnostico.em, versao: pc.versao, atrasoBuscaMs: pc.diagnostico.atrasoBuscaMs },
          }
          const corrigidos = conferencias.filter((c) => c.consertado).length
          this.evento("info", "conserto", { computador: computadorId, conserto: true, corrigidos, nao_deu: 0 })
        } else {
          // o Rodar agora responde o diagnóstico, como o agente (a tela mostra o da resposta)
          const conferencias = pc.diagnostico.itens.map((i) => ({
            id: i.id,
            situacao: i.ok === true ? "ok" : i.ok === false ? "falha" : "aviso",
            detalhe: i.detalhe ?? "",
            ...(i.ok !== true && i.conserto ? { conserto: i.id } : {}),
            ...(i.ok !== true && i.fazer ? { fazer: i.fazer } : {}),
          }))
          cmd.resposta = {
            ok: true,
            diagnostico: { conferencias, em: pc.diagnostico.em, versao: pc.versao, atrasoBuscaMs: pc.diagnostico.atrasoBuscaMs },
          }
        }
      }
      if (acao === "atualizar" && corpo.conferir === true) {
        // como o agente: lê a versão publicada agora e conta o que achou (na demonstração, a do pacote)
        const maisNova = this.d.versao
        if (pc.diagnostico) pc.diagnostico.versaoNova = maisNova
        const nova = compararVersao(maisNova, pc.versao) > 0
        cmd.resposta = {
          ok: true,
          conferido: true,
          atual: pc.versao,
          mais_nova: maisNova,
          nova,
          atualizando: pc.diagnostico?.atualizacao?.para ?? null,
          precisa_nuvem: false,
        }
        setTimeout(() => this.rolarSozinho(), 1500)
      }
      if (acao === "atualizar" && corpo.assistente === true) {
        const de = this.atualizarAssistenteDemo(pc, false)
        cmd.resposta = de === null && pc.diagnostico?.assistente?.atualizando
          ? { ok: false, erro: "o assistente de código já está atualizando neste computador" }
          : { ok: true, assistente: true, atualizando: true, de }
      }
      if (acao === "atualizar" && typeof corpo.versao === "string") {
        // como o agente: baixa a versão oficial mais nova e volta nela uns segundos depois
        const de = pc.versao
        const para = pc.diagnostico?.versaoNova ?? this.d.versao
        cmd.resposta = { ok: true, atualizando: true, de, para }
        this.evento("info", "atualizacao", { computador: computadorId, atualizacao: "pedida", de, para, sozinho: false })
        setTimeout(() => {
          pc.versao = para
          if (pc.diagnostico) {
            pc.diagnostico.versao = para
            pc.diagnostico.itens = pc.diagnostico.itens.map((i) =>
              i.id === "agente" ? { ...i, detalhe: `versão ${para}, Node 22.12.0` } : i
            )
          }
          this.evento("info", "atualizacao", { computador: computadorId, atualizacao: "concluida", de, para, sozinho: false })
          this.emitir()
        }, 4000)
      }
      if (acao === "entrar_de_novo" || acao === "conectar") {
        const email = String(corpo.email ?? "").toLowerCase()
        let c = this.d.contas.find((x) => x.email === email)
        if (!c && acao === "conectar" && email) {
          c = {
            id: idAleatorio("conta"),
            email,
            organizacao: null,
            plano: "pro",
            nivel: null,
            cor: proximaCorLivre(this.d.contas.map((x) => x.cor)),
            prioridade: (this.d.contas.reduce((m, x) => Math.max(m, x.prioridade), 0) || 0) + 10,
            reserva: false,
            pausada: false,
            agenda: [],
            tetoSemana: null,
            modelo: null,
            precisaLogin: false,
            criadaEm: this.agora().toISOString(),
            janelas: [],
            semModelo: [],
            lidoEm: null,
            fonte: null,
            loginExpiraEm: null,
            posse: null,
          }
          this.d.contas.push(c)
        }
        if (c) {
          c.precisaLogin = false
          c.loginExpiraEm = new Date(this.agora().getTime() + 30 * H).toISOString()
          c.janelas = [
            { tipo: "five_hour", pct: 0, resetEm: null },
            { tipo: "seven_day", pct: 4, resetEm: new Date(this.agora().getTime() + 6 * DIA).toISOString() },
          ]
          c.lidoEm = this.agora().toISOString()
          c.fonte = "api"
          this.evento("conexao", "login", { conta: c.id, computador: computadorId })
        }
      }
      cmd.resposta ??= { ok: true }
      this.emitir()
    }, 2600)
    return cmd
  }

  async lerComando(id: number): Promise<Comando | null> {
    const c = this.d.comandos.find((x) => x.id === id)
    return c ? structuredClone(c) : null
  }

  async criarAcessoComputador(): Promise<{ codigo: string; computadorId: string | null }> {
    await esperar(this.atrasoMs)
    // como na nuvem: a identidade pendente aparece na lista desde já, e pode ser revogada
    const id = `pc-novo-${this.d.computadores.length + 1}`
    this.d.computadores.push({
      id,
      nome: "Computador novo",
      sistema: "pendente",
      versao: "",
      vistoEm: null,
      revogado: false,
      criadoEm: this.agora().toISOString(),
      diagnostico: null,
      atribuicao: null,
      contaPreferidaId: null,
      enxugar: false,
      nomeDoPainel: false,
    })
    this.ligacoesDemo.set(id, { criadoEm: this.agora().getTime(), aprovador: null })
    this.auditar("computador_novo", "acesso criado")
    this.emitir()
    return {
      codigo: codigoDeAcesso({
        u: "https://exemplo.supabase.co",
        k: "chave-publica-de-exemplo",
        e: "pc-exemplo@computadores.reveza.invalid",
        s: "senha-de-exemplo",
      }),
      computadorId: id,
    }
  }

  async escolherAprovador(computadorNovoId: string, aprovadorId: string) {
    await esperar(this.atrasoMs)
    const lig = this.ligacoesDemo.get(computadorNovoId)
    if (!lig || this.computador(computadorNovoId).revogado) throw new ErroPainel("computador_revogado")
    if (this.computador(aprovadorId).revogado) throw new ErroPainel("computador_revogado")
    lig.aprovador = aprovadorId
  }

  /**
   * O caminho real, encenado: o computador novo "pede" 5 s depois do código, a pessoa "digita" o código dele 10 s
   * depois no computador escolhido, e ele entra 2 s depois disso.
   */
  async estadoLigacao(computadorNovoId: string): Promise<EstadoLigacao> {
    const lig = this.ligacoesDemo.get(computadorNovoId)
    const pc = this.d.computadores.find((c) => c.id === computadorNovoId)
    const base = { aprovadorId: lig?.aprovador ?? null, expiraEm: null, motivo: null }
    if (!lig || !pc || pc.revogado) return { ...base, fase: "esperando_pedido" }
    if (pc.sistema !== "pendente") return { ...base, fase: "ligado" }
    const passou = this.agora().getTime() - lig.criadoEm
    const expiraEm = new Date(lig.criadoEm + 5_000 + 10 * MIN).toISOString()
    if (passou < 5_000) return { ...base, fase: "esperando_pedido" }
    if (passou < 15_000 || !lig.aprovador) return { ...base, expiraEm, fase: "esperando_codigo" }
    if (passou < 17_000) return { ...base, expiraEm, fase: "entregue" }
    pc.nome = this.idioma === "en" ? "New laptop" : "Notebook novo"
    pc.sistema = "macos"
    pc.versao = this.d.computadores[0]?.versao ?? ""
    pc.vistoEm = this.agora().toISOString()
    this.evento("info", "Computador novo liberado: a chave do cofre foi entregue cifrada só para ele.", { computador: pc.id })
    this.emitir()
    return { ...base, expiraEm, fase: "ligado" }
  }

  /** Como a função atualizar-nuvem: a nuvem da demonstração já está na versão mais nova; a conferência leva um instante. */
  async atualizarNuvem(): Promise<ResultadoNuvem> {
    const n = this.d.config.nuvem
    if (!n) return { ok: false, estado: "falhou", para: null, motivo: "sem nuvem" }
    const antes = n.atualizacao
    n.atualizacao = { estado: "atualizando", de: n.versao, para: n.versao, desde: this.agora().toISOString(), motivo: null }
    if (n.publicacao?.estado === "falhou") n.publicacao = null
    this.emitir()
    await esperar(this.atrasoMs ? this.atrasoMs : 1200)
    n.atualizacao = antes ?? { estado: "atualizada", de: n.versao, para: n.versao, desde: this.agora().toISOString(), motivo: null }
    this.auditar("atualizar_nuvem", n.versao ?? "?")
    this.emitir()
    return { ok: true, estado: "em_dia", para: n.versao, motivo: null }
  }

  desligarAtualizacaoCompleta() {
    return this.escrever(() => {
      if (this.d.config.nuvem) this.d.config.nuvem.completa = false
      this.evento("info", "A atualização completa foi desligada (pelo painel): os tokens cifrados saíram da nuvem.", { atualizacao_completa: "desligada" })
      this.auditar("atualizacao_completa", "desligar")
    })
  }

  renomearComputador(id: string, nome: string) {
    return this.escrever(() => {
      const pc = this.computador(id)
      if (pc.revogado) throw new ErroPainel("computador_revogado")
      // como o banco (0029): espaços juntos, até 60 caracteres, sem repetir o nome de outro ativo; vazio, o do sistema
      const limpo = nome.replace(/\s+/g, " ").trim()
      const controle = [...limpo].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
      if (limpo.length > 60 || controle) throw new ErroPainel("nome_invalido")
      if (!limpo) {
        pc.nomeDoPainel = false
        this.auditar("computador_nome", pc.nome)
        return
      }
      if (this.d.computadores.some((x) => x.id !== id && !x.revogado && x.nome.toLowerCase() === limpo.toLowerCase()))
        throw new ErroPainel("nome_repetido")
      pc.nome = limpo
      pc.nomeDoPainel = true
      this.auditar("computador_nome", limpo)
    })
  }

  revogarComputador(id: string) {
    return this.escrever(() => {
      const pc = this.computador(id)
      pc.revogado = true
      pc.contaPreferidaId = null
      for (const c of this.d.contas) if (c.posse?.computadorId === id) c.posse = null
      pc.atribuicao = null
      this.evento("info", "computador revogado", { computador: id, motivo: "revogado" })
      this.auditar("revogar_computador", pc.nome)
    })
  }

  criarAlerta(a: NovoAlerta) {
    return this.escrever(() => {
      if (!a.eventos.length) throw new ErroPainel("sem_evento")
      // a mesma conferência de destino que painel_alerta faz no banco, em forma simples
      const d = a.destino
      const httpsPublico = (u?: string) => !!u && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:443)?(\/|$)/i.test(u)
      const valido =
        (a.canal === "telegram" && /^(-?\d+|@\w{3,})$/.test(d.chat_id ?? "")) ||
        (a.canal === "email" &&
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.para ?? "") &&
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.de ?? "")) ||
        (a.canal === "webhook" && httpsPublico(d.url)) ||
        a.canal === "push"
      if (!valido) throw new ErroPainel("destino_invalido")
      this.d.alertas.push({
        id: idAleatorio("al"),
        canal: a.canal,
        destino: rotuloDestino(a.canal, a.destino),
        // como no banco: o segredo não fica no destino, só a marca de que ele existe (no Vault)
        destinoBruto: { ...a.destino, ...(a.segredo ? { vault_id: idAleatorio("vault") } : {}) },
        eventos: a.eventos,
        ativo: true,
      })
      this.auditar("alerta", a.canal)
    })
  }

  mudarAlerta(alerta: Alerta, campos: { ativo?: boolean; eventos?: EventoAlerta[] }) {
    return this.escrever(() => {
      const a = this.d.alertas.find((x) => x.id === alerta.id)
      if (!a) throw new ErroPainel("nao_encontrado")
      Object.assign(a, campos)
      this.auditar("alerta", a.canal)
    })
  }

  removerAlerta(id: string) {
    return this.escrever(() => {
      this.d.alertas = this.d.alertas.filter((a) => a.id !== id)
      this.auditar("alerta_apagar", id)
    })
  }

  testarAlerta(id: string) {
    return this.escrever(() => {
      const a = this.d.alertas.find((x) => x.id === id)
      if (!a) throw new ErroPainel("nao_encontrado")
      this.evento("alerta", "teste", { canal: a.canal, motivo: "teste" })
    })
  }

  criarChave(nome: string, escopos: EscopoChave[]) {
    return this.escrever(() => {
      if (!nome.trim()) throw new ErroPainel("nome_vazio")
      if (!escopos.length) throw new ErroPainel("sem_escopo")
      const prefixo = `rvz_${hexAleatorio(3)}`
      this.d.chaves.unshift({
        id: idAleatorio("ch"),
        nome: nome.trim().slice(0, 80),
        prefixo,
        escopos,
        criadaEm: this.agora().toISOString(),
        usadaEm: null,
        revogada: false,
      })
      this.auditar("chave_api_criar", nome.trim())
      return { chave: `${prefixo}_${hexAleatorio(32)}` }
    })
  }

  revogarChave(id: string) {
    return this.escrever(() => {
      const c = this.d.chaves.find((x) => x.id === id)
      if (!c) throw new ErroPainel("nao_encontrado")
      c.revogada = true
      this.auditar("chave_api_revogar", c.nome)
    })
  }

  criarWebhook(url: string, eventos: string[]) {
    return this.escrever(() => {
      if (!/^https:\/\/[^/\s]+/.test(url.trim())) throw new ErroPainel("url_invalida")
      this.d.webhooks.push({ id: idAleatorio("wh"), url: url.trim(), eventos, ativo: true })
      this.auditar("webhook", url)
      return { segredo: hexAleatorio(32) }
    })
  }

  mudarWebhook(webhook: WebhookSaida, campos: { ativo?: boolean; eventos?: string[] }) {
    return this.escrever(() => {
      const w = this.d.webhooks.find((x) => x.id === webhook.id)
      if (!w) throw new ErroPainel("nao_encontrado")
      Object.assign(w, campos)
      this.auditar("webhook", w.url)
    })
  }

  testarWebhook(id: string) {
    return this.escrever(() => {
      const w = this.d.webhooks.find((x) => x.id === id)
      if (!w) throw new ErroPainel("nao_encontrado")
      this.evento("info", "teste de webhook", { motivo: "teste_webhook" })
    })
  }

  convidar(email: string, papel: Papel) {
    return this.escrever(() => {
      const e = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ErroPainel("email_invalido")
      if (this.d.membros.some((m) => m.email === e)) throw new ErroPainel("ja_membro")
      this.d.convites.push({
        id: idAleatorio("cv"),
        email: e,
        papel,
        expiraEm: new Date(this.agora().getTime() + 72 * H).toISOString(),
        usadoEm: null,
      })
      this.auditar("convidar", `${e} · ${papel}`)
      return {
        link: `${typeof window !== "undefined" ? window.location.origin : ""}/aceitar?convite=${hexAleatorio(32)}&demo=1`,
      }
    })
  }

  cancelarConvite(id: string) {
    return this.escrever(() => {
      this.d.convites = this.d.convites.filter((c) => c.id !== id)
      this.auditar("convite_cancelar", id)
    })
  }

  mudarPapel(userId: string, papel: Papel) {
    return this.escrever(() => {
      const m = this.d.membros.find((x) => x.userId === userId)
      if (!m) throw new ErroPainel("nao_encontrado")
      if (m.userId === this.d.eu.userId) throw new ErroPainel("nao_pode_voce")
      m.papel = papel
      this.auditar("papel", `${m.nome ?? m.userId} · ${papel}`)
    })
  }

  revogarMembro(userId: string) {
    return this.escrever(() => {
      if (userId === this.d.eu.userId) throw new ErroPainel("nao_pode_voce")
      const m = this.d.membros.find((x) => x.userId === userId)
      this.d.membros = this.d.membros.filter((x) => x.userId !== userId)
      this.auditar("revogar_membro", m?.nome ?? userId)
    })
  }

  meuIdioma(idioma: Idioma) {
    return this.escrever(() => {
      this.d.eu.idioma = idioma
      this.idioma = idioma
    })
  }

  async chavePushPublica(): Promise<string | null> {
    return null
  }

  inscreverPush() {
    return this.escrever(() => {
      this.auditar("push", "este aparelho")
    })
  }

  async pushRegistrado(): Promise<boolean> {
    return false
  }
}
