import type { HttpInit, Register, SessionRateLimit } from 'claude-code'

import type { Idioma } from './textos'
import { enxugarSaida } from './enxugar'
import { idiomaDaInstalacao, textos, usarIdioma } from './textos'

// O lado de cada sessão do Reveza AI (o agente roda no computador e escuta em 127.0.0.1, porta configurável).
// 1. Mostra na linha de status a conta em uso e o % da janela de 5 h.
// 2. Manda ao agente o uso que cada resposta trouxe (de graça e ao vivo): é com ele que a troca acontece na hora certa.
// 3. Quando a sessão bate o limite, avisa o agente (que troca na hora) e, assim que a conta muda, manda a sessão
//    continuar de onde parou. Sessão de terminal (`-p`) quem retoma é o agente, pelo --resume.
// 4. Com a saída enxuta ligada no painel para este computador, encurta a saída dos comandos de leitura (enxugar.ts).

export const PORTA_PADRAO = 7788

/**
 * Entre os erros que o Claude Code chama de `rate_limit`, só o limite de USO da conta se resolve trocando de conta. Caem
 * em `rate_limit` também (Claude Code 2.1.29x): "Usage credits required for 1M context" (a conversa passou de 200 mil
 * tokens numa conta sem uso extra; trocar não resolve e a retomada bate no mesmo erro, relato do Paulo de 13/10/2026),
 * "model requires usage credits" e "Request rejected (429) · this may be a temporary capacity issue" (momentâneo).
 * Sem texto nenhum (versão antiga do Claude Code), segue valendo como limite de uso, como antes.
 */
export type TipoDoLimite = 'uso' | 'contexto_longo' | 'outro'
const CONTEXTO_LONGO = /long context|1M context|context window/i
const OUTRO_429 = /usage credits|requires? usage credits|temporary capacity|Request rejected \(429\)|overloaded/i
const LIMITE_DE_USO = /hit your [^.·\n]*limit|usage limit|limit reached|out of (extra )?usage|resets? (at |in )?\d/i

export function tipoDoLimite(detalhe: string | undefined, mensagem: string | undefined): TipoDoLimite {
  const texto = `${detalhe ?? ''} ${mensagem ?? ''}`.trim()
  if (!texto) return 'uso'
  if (CONTEXTO_LONGO.test(texto)) return 'contexto_longo'
  if (OUTRO_429.test(texto)) return 'outro'
  return LIMITE_DE_USO.test(texto) ? 'uso' : 'outro'
}
const ESPERA_MAXIMA_MS = 2 * 60 * 60 * 1000
const LEITURA_MS = 30_000

export type Ativa = { slug: string | null; email: string | null; versao: number; trocadaEm: number; enxugar?: boolean }
type Janela = { tipo: string; rotulo?: string; pct: number | null; resetEm: number | null }
type Conta = { email: string; org: string | null; estado: string; janelas: Janela[] }
export type Estado = {
  contas: Conta[]
  auto: boolean
  modo?: string
  limiares: { aviso: number; troca: number }
  sombra?: boolean
  nuvem?: { ligada?: boolean; online?: boolean | null }
}

// Os rótulos e as frases ficam em textos.ts, nos dois idiomas (o da instalação, lido do instalacao.json no começo da
// sessão). Aqui fica só o que não se traduz: os nomes de comando (/compact, /rewind) e o que a ponte devolve.

export function base(porta: unknown): string {
  const p = typeof porta === 'number' && Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : PORTA_PADRAO
  return `http://127.0.0.1:${p}`
}

function hora(epoch: number): string {
  const d = new Date(epoch * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function janelasTexto(janelas: Janela[], idioma?: Idioma): string {
  const x = textos(idioma)
  const partes = janelas
    .filter(j => j.pct !== null)
    .map(
      j =>
        `${x.janelas[j.tipo] ?? j.rotulo ?? j.tipo} ${Math.round(j.pct ?? 0)}%${j.resetEm ? x.renova(hora(j.resetEm)) : ''}`,
    )
  return partes.length ? partes.join(', ') : x.semLeitura
}

export function resumo(estado: Estado, idioma?: Idioma): string {
  const x = textos(idioma)
  const linhas = estado.contas.map(
    c => `- ${c.email}${c.org ? ` (${c.org})` : ''}: ${x.estados[c.estado] ?? c.estado}. ${janelasTexto(c.janelas, idioma)}`,
  )
  const modo =
    estado.modo === 'limite' ? x.soNoLimite : estado.modo === 'rodizio' ? x.rodizio : x.limiar(estado.limiares.aviso, estado.limiares.troca)
  const troca = estado.auto ? x.trocaLigada(modo) : x.trocaDesligada
  const extra: string[] = []
  if (estado.sombra) extra.push(x.sombra)
  if (estado.nuvem?.ligada && estado.nuvem.online === false) extra.push(x.semNuvem)
  return ['Reveza AI', troca, ...extra, ...(linhas.length ? linhas : [x.semContas])].join('\n')
}

export function janelasDaMedida(limites: readonly SessionRateLimit[]) {
  return limites
    .filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
    .map(l => ({ tipo: l.kind, pct: l.percentUsed, resetEm: l.resetsAt ?? null }))
}

// Chave local da ponte (~/.reveza/ponte.chave, só o dono do computador lê): sem ela o agente responde 401.
// A chave nunca viaja: vai só a prova (HMAC-SHA256 do método, caminho, hora e nonce), para que outro programa que
// estiver na porta no lugar do agente não a aprenda.
let chavePonte = ''

const hexParaBytes = (h: string) => new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16)))
const bytesParaHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** HMAC-SHA256 só com o digest (o ambiente do mod não tem importKey/sign). Chave em hex, até 64 bytes. */
export async function hmacHex(chaveHex: string, mensagem: string): Promise<string> {
  const k = new Uint8Array(64)
  k.set(hexParaBytes(chaveHex).slice(0, 64))
  const msg = new TextEncoder().encode(mensagem)
  const dentro = new Uint8Array(64 + msg.length)
  const fora = new Uint8Array(64 + 32)
  for (let i = 0; i < 64; i++) {
    dentro[i] = k[i]! ^ 0x36
    fora[i] = k[i]! ^ 0x5c
  }
  dentro.set(msg, 64)
  fora.set(new Uint8Array(await crypto.subtle.digest('SHA-256', dentro)), 64)
  return bytesParaHex(new Uint8Array(await crypto.subtle.digest('SHA-256', fora)))
}

async function pedido(metodo: string, caminho: string, corpo?: unknown): Promise<{ init: HttpInit; nonce: string }> {
  const prova: Record<string, string> = {}
  const nonce = crypto.randomUUID()
  if (chavePonte) {
    const tempo = String(Date.now())
    prova['X-Reveza-Tempo'] = tempo
    prova['X-Reveza-Nonce'] = nonce
    prova['X-Reveza-Prova'] = await hmacHex(chavePonte, `${metodo}\n${caminho}\n${tempo}\n${nonce}`)
  }
  return {
    init: {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Reveza': '1', ...prova },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    },
    nonce,
  }
}

/** A resposta veio do agente de verdade? Ele assina com a mesma chave; outro programa na porta não consegue. */
async function doAgente(r: { ok: boolean; headers?: Record<string, string> }, nonce: string): Promise<boolean> {
  if (!r.ok || !chavePonte) return false
  return (r.headers?.['x-reveza-servidor'] ?? '') === (await hmacHex(chavePonte, `servidor\n${nonce}`))
}

function lerJson<T>(r: { ok: boolean; text: string }): T | null {
  if (!r.ok) return null
  try {
    return JSON.parse(r.text) as T
  } catch {
    return null
  }
}

export const register: Register = (on, options) => {
  const BASE = base(options?.porta)
  let sessao = ''
  let interativa = true
  let versao: number | null = null
  let email: string | null = null
  let cinco = ''
  let foraDoAr = false
  let ultimaLeitura = -Infinity
  let espera: { referencia: number; desde: number } | null = null
  let retomando = false
  let enxugar = false
  // O idioma da instalação, lido uma vez por sessão (o arquivo não muda no meio dela); null até a primeira leitura.
  let idioma: Idioma | null = null

  function textoStatus(): string | undefined {
    const x = textos()
    if (foraDoAr) return x.agenteForaDoAr
    if (!email) return undefined
    return x.contaEmUso(email.split('@')[0]!, cinco)
  }

  // Devolve o aviso a mostrar quando a conta mudou desde a última leitura.
  function aplicarAtiva(a: Ativa): string | null {
    enxugar = a.enxugar === true
    const mudou = versao !== null && a.versao !== versao && !!a.email && a.email !== email
    versao = a.versao
    email = a.email
    if (!mudou) return null
    cinco = ''
    return textos().contaMudou(a.email!)
  }

  on('session.start', async ($, e, next) => {
    interativa = e.isInteractive
    sessao = await $.session.id()
    const raiz =
      (await $.env.get('REVEZA_HOME')) ??
      `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
    if (!idioma) idioma = usarIdioma(await idiomaDaInstalacao(caminho => $.fs.read(caminho), raiz))
    chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    await $.command.register({
      name: 'reveza',
      description: textos().descricao,
    })

    $.clock.every(5000, () => {
      void (async () => {
        // o agente pode ter subido depois da sessão (a chave nasce com ele)
        if (!chavePonte) chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
        // o relógio do host (e não o Date): é ele que marca os 5 s, e o teste o move
        const agora = await $.clock.now()
        if (!espera && agora - ultimaLeitura < LEITURA_MS) return
        ultimaLeitura = agora
        let ativa: Ativa | null = null
        try {
          const p = await pedido('GET', '/api/ativa')
          const r = await $.http.fetch(`${BASE}/api/ativa`, p.init)
          ativa = (await doAgente(r, p.nonce)) ? lerJson<Ativa>(r) : null
          foraDoAr = false
        } catch {
          foraDoAr = true
        }
        const aviso = ativa ? aplicarAtiva(ativa) : null
        if (aviso) $.ui.toast(aviso)
        $.ui.status(textoStatus())

        if (espera && Date.now() - espera.desde > ESPERA_MAXIMA_MS) espera = null
        if (!espera || !ativa || ativa.versao <= espera.referencia) return
        espera = null
        retomando = true
        await $.prompt.submit({
          // texto fixo: o que a ponte local devolve não entra no prompt (outro programa poderia ocupar a porta)
          text: textos().retomada,
        })
        await $.http
          .fetch(
            `${BASE}/api/fila/${encodeURIComponent(sessao)}/retomada`,
            (await pedido('POST', `/api/fila/${encodeURIComponent(sessao)}/retomada`, {})).init,
          )
          .catch(() => undefined)
      })()
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const janelas = janelasDaMedida(e.rateLimits)
      const cincoHoras = e.rateLimits.find(l => l.kind === 'five_hour')
      cinco = cincoHoras ? `5h ${Math.round(cincoHoras.percentUsed)}%` : ''
      $.ui.status(textoStatus())
      if (janelas.length > 0) {
        await $.http
          .fetch(`${BASE}/api/medida`, (await pedido('POST', '/api/medida', { sessao, versao, janelas })).init)
          .catch(() => undefined)
      }
    }
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    const x = textos()
    if (e.error === 'invalid_request' && /^Prompt is too long/i.test(e.last_assistant_message ?? '')) {
      // A conversa passou do limite e nem o /compact cabe mais (relato do Paulo, 13/10/2026): diz como sair e manda ao
      // agente o tamanho dela, que fica nos eventos (sem isso, só lendo as transcrições do computador).
      $.ui.toast(x.toasts.limite)
      const uso = await $.session.usage().catch(() => null)
      await $.http
        .fetch(
          `${BASE}/api/sessao/erro`,
          (await pedido('POST', '/api/sessao/erro', { sessao, tipo: 'contexto', tokens: uso?.context.tokens ?? null, janela: uso?.context.window ?? null })).init,
        )
        .catch(() => undefined)
      return next(e)
    }
    if (e.error !== 'rate_limit') return next(e)
    const tipoLimite = tipoDoLimite(e.error_details, e.last_assistant_message)
    if (tipoLimite === 'contexto_longo') {
      $.ui.toast(x.toasts.contexto)
      return next(e)
    }
    if (tipoLimite !== 'uso') return next(e)
    const superficies = await $.session.surfaces().catch(() => [])
    const tipo = interativa || superficies.length > 0 ? 'interativa' : 'headless'
    const antes = versao
    let resposta: { ok: boolean; versao: number } | null = null
    try {
      const p = await pedido('POST', '/api/limite', { sessao, cwd: await $.session.cwd(), tipo, erro: 'rate_limit', versao: antes })
      const r = await $.http.fetch(`${BASE}/api/limite`, p.init)
      resposta = (await doAgente(r, p.nonce)) ? lerJson(r) : null
    } catch {
      resposta = null
    }
    if (!resposta) {
      $.ui.toast(x.toasts.semAgente)
    } else if (tipo === 'interativa') {
      espera = { referencia: antes ?? resposta.versao, desde: Date.now() }
      $.ui.toast(x.toasts.troca)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    // Turno que não foi o nosso (a pessoa digitou, ou o assistente continuou sozinho no reset): a espera acabou.
    if (!retomando) espera = null
    retomando = false
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash' || !enxugar) return next(e)
    const r = await next(e)
    if (r.deny !== undefined || r.isError) return r
    const s = r.result
    // saída que foi para arquivo, em segundo plano ou cortada no meio fica como veio
    if (s.interrupted || s.isImage || s.persistedOutputPath || s.rawOutputPath || s.backgroundTaskId || s.structuredContent) return r
    let curto: string | null = null
    try {
      curto = enxugarSaida(e.command, s.stdout)
    } catch {
      // defeito no enxugar não pode custar a saída: vai como o Claude Code mandou
    }
    return curto === null ? r : { result: { ...s, stdout: curto }, context: r.context }
  })

  on('command.run', { command: 'reveza' }, async $ => {
    let estado: Estado | null = null
    const raiz =
      (await $.env.get('REVEZA_HOME')) ??
      `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
    if (!idioma) idioma = usarIdioma(await idiomaDaInstalacao(caminho => $.fs.read(caminho), raiz))
    if (!chavePonte) chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    try {
      const p = await pedido('GET', '/api/estado')
      const r = await $.http.fetch(`${BASE}/api/estado`, p.init)
      estado = (await doAgente(r, p.nonce)) ? lerJson<Estado>(r) : null
    } catch {
      estado = null
    }
    if (!estado) {
      return { text: textos().foraDoAr }
    }
    return { text: resumo(estado) }
  })
}
