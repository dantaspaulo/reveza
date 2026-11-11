import type { HttpInit, HttpResponse, Register, RenderSurface, SessionAuthorization, SessionRateLimit, SessionUsage } from 'claude-code'

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
 * Entre os erros que o Claude Code chama de `rate_limit`, o limite de USO da conta se resolve trocando de conta. Caem
 * em `rate_limit` também (Claude Code 2.1.29x): "Usage credits required for 1M context" (a conversa passou de 200 mil
 * tokens numa conta sem uso extra; trocar não resolve e a retomada bate no mesmo erro, relato do Paulo de 13/10/2026)
 * e "Request rejected (429) · this may be a temporary capacity issue" (momentâneo).
 * `modelo`: a conta não roda o modelo da sessão sem créditos de uso ("Fable 5.1 requires usage credits", ou "Fable
 * limit reached · continuing on Fable 5.1 uses usage credits"; o Fable numa conta Team, relato do Paulo de 22/10/2026).
 * Trocar para outra conta resolve; sem outra, a sessão vai para o modelo padrão.
 * Sem texto nenhum (versão antiga do Claude Code), segue valendo como limite de uso, como antes.
 */
export type TipoDoLimite = 'uso' | 'contexto_longo' | 'modelo' | 'outro'
const CONTEXTO_LONGO = /long context|1M context|context window/i
const MODELO_SEM_CREDITO = /requires? usage credits|limit reached · continuing on [^·\n]+ uses usage credits/i
const OUTRO_429 = /usage credits|temporary capacity|Request rejected \(429\)|overloaded/i
const LIMITE_DE_USO = /hit your [^.·\n]*limit|usage limit|limit reached|out of (extra )?usage|resets? (at |in )?\d/i

export function tipoDoLimite(detalhe: string | undefined, mensagem: string | undefined): TipoDoLimite {
  const texto = `${detalhe ?? ''} ${mensagem ?? ''}`.trim()
  if (!texto) return 'uso'
  if (CONTEXTO_LONGO.test(texto)) return 'contexto_longo'
  if (MODELO_SEM_CREDITO.test(texto)) return 'modelo'
  if (OUTRO_429.test(texto)) return 'outro'
  return LIMITE_DE_USO.test(texto) ? 'uso' : 'outro'
}
/**
 * O fim do turno com erro (`turn.complete`, motivo `error`) que é uma parada que o Reveza trata, pelo texto que a sessão
 * mostrou. Mais estrito que o `classic.StopFailure` (que diz se o erro foi `rate_limit`): aqui só o texto do limite de uso
 * ("You've hit your 5-hour limit · resets 12:40pm"), o da conta sem o modelo, o da conversa longa sem crédito e o
 * "Prompt is too long". Null para qualquer outro erro (rede, 500, 429 momentâneo).
 */
export function paradaDoTurno(texto: string | undefined): { erro: 'rate_limit' | 'invalid_request'; mensagem: string } | null {
  const mensagem = (texto ?? '').trim()
  if (!mensagem) return null
  if (/^Prompt is too long/i.test(mensagem)) return { erro: 'invalid_request', mensagem }
  if (CONTEXTO_LONGO_NO_TURNO.test(mensagem) || MODELO_SEM_CREDITO.test(mensagem) || LIMITE_NO_TURNO.test(mensagem)) {
    return { erro: 'rate_limit', mensagem }
  }
  return null
}
const LIMITE_NO_TURNO = /hit your [^.·\n]*limit|usage limit reached|out of (extra )?usage/i
const CONTEXTO_LONGO_NO_TURNO = /usage credits required for (1M|long) context/i
/** A mesma parada chega pelos dois caminhos em milissegundos: dentro deste tempo, o fim do turno não repete o StopFailure. */
const PARADA_REPETIDA_MS = 5000

/** As chamadas do `$` que o tratamento da parada usa: o `$` não sai do hook, então cada hook monta estas com ele. */
type Ferramentas = {
  toast: (texto: string) => void
  status: (texto: string | undefined) => void
  superficies: () => Promise<readonly RenderSurface[]>
  cwd: () => Promise<string>
  modelo: () => Promise<string>
  uso: () => Promise<SessionUsage>
  agora: () => Promise<number>
  autorizar: () => Promise<SessionAuthorization>
  buscar: (url: string, init: HttpInit) => Promise<HttpResponse>
}

const ESPERA_MAXIMA_MS = 2 * 60 * 60 * 1000
/** Conta sem o modelo da sessão: a espera pela troca (sem ela, a sessão vai para o modelo padrão, pedido do Paulo). */
export const ESPERA_MODELO_MS = 2 * 60 * 1000
/** Parou de novo pelo modelo dentro deste tempo (a conta nova também não roda): vai direto para o modelo padrão. */
const REPETIU_MODELO_MS = 10 * 60 * 1000
const LEITURA_MS = 30_000
/** A conta da sessão lida vale isto; sem resposta, ou com o agente dizendo que é outra conta, ela é relida mais cedo. */
const CONTA_VALE_MS = 30 * 60 * 1000
const CONTA_RECONFERE_MS = 2 * 60 * 1000
/** Numa conta deste computador que já saiu de uso, a sessão ainda vai reler o login (o assistente relê a cada 30 s). */
const CONTA_ATRASADA_MS = 30_000
/** O agente pede para esperar antes de mandar a sessão atrasada continuar; mais que isto, não. */
const AGUARDAR_MAXIMO_MS = 10 * 60 * 1000
const PERFIL = 'https://api.anthropic.com/api/oauth/profile'

/**
 * A conta da sessão: `{ accountUuid, orgUuid }`, ou `{ fora: true }` quando a sessão não usa um login que o Reveza troca
 * (chave de API, ou um token só de uso posto no ambiente, sem leitura do perfil). Null quando não deu para saber
 * (Claude Code sem o `authorize`, rede fora, tráfego não essencial desligado): o agente segue como antes.
 *
 * Relato de um usuário (22/10/2026): o app de desktop, com login próprio numa conta A, carregava o mod, e o uso dele ia
 * para a conta B, a em uso. A credencial fica no Claude Code: o mod só recebe um apelido dela, que vale só para o
 * endereço oficial do serviço, e manda ao agente os dois identificadores, nada mais.
 */
export type ContaSessao = { accountUuid: string; orgUuid: string } | { fora: true }

export async function lerContaDaSessao(
  autorizar: () => Promise<{ handle: string; kind: string } | null>,
  buscar: (url: string, init: HttpInit) => Promise<{ status: number; ok: boolean; text: string }>,
): Promise<ContaSessao | null> {
  let a: { handle: string; kind: string } | null
  try {
    a = await autorizar()
  } catch {
    return null
  }
  if (!a || a.kind !== 'bearer') return { fora: true }
  try {
    const r = await buscar(PERFIL, { method: 'GET', auth: a.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (r.status === 403 && /scope/i.test(r.text)) return { fora: true }
    if (!r.ok) return null
    const j = JSON.parse(r.text) as { account?: { uuid?: unknown }; organization?: { uuid?: unknown } }
    const conta = j.account?.uuid
    const org = j.organization?.uuid
    return typeof conta === 'string' && conta && typeof org === 'string' && org ? { accountUuid: conta, orgUuid: org } : null
  } catch {
    return null
  }
}

export type Ativa = {
  slug: string | null
  email: string | null
  versao: number
  trocadaEm: number
  enxugar?: boolean
  /** Sessões críticas (0.15.0): vem só com a função ligada no agente. */
  criticas?: { segurar?: boolean; gatilho?: number }
}
type Janela = { tipo: string; rotulo?: string; pct: number | null; resetEm: number | null }
type Conta = { email: string; org: string | null; estado: string; janelas: Janela[] }
export type Estado = {
  contas: Conta[]
  auto: boolean
  modo?: string
  limiares: { aviso: number; troca: number }
  sombra?: boolean
  nuvem?: { ligada?: boolean; online?: boolean | null }
  criticas?: { ligada?: boolean; gatilho?: number; segurar?: boolean }
}

/**
 * Sessões críticas (0.15.0, pedido do Paulo, 07/11/2026): com a função ligada e nenhuma conta com folga abaixo do
 * gatilho, a sessão comum espera (o prompt e a ação dela são recusados) e só as críticas seguem. A sessão noutra conta
 * (o app de desktop) não gasta das contas do Reveza, e com o agente fora do ar ninguém espera: na dúvida, segue.
 */
export function deveSegurar(s: { segurar: boolean; critica: boolean; outraConta: boolean; foraDoAr: boolean }): boolean {
  return s.segurar && !s.critica && !s.outraConta && !s.foraDoAr
}

/** `/reveza critica` (com ou sem acento, ou em inglês) marca ou desmarca esta sessão. */
export function pedeCritica(args: string): boolean {
  return /^(cr[ií]tica|critical)$/i.test(args.trim())
}

/** REVEZA_CRITICA=1 (ou true, sim, yes) no comando que abre a sessão: as rotinas de terminal já nascem críticas. */
export function ambienteCritico(valor: unknown): boolean {
  return typeof valor === 'string' && /^(1|true|sim|yes)$/i.test(valor.trim())
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

export function resumo(estado: Estado, idioma?: Idioma, critica?: boolean): string {
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
  if (critica !== undefined && estado.criticas) {
    const k = estado.criticas
    extra.push(x.criticas.resumo(k.ligada === true, k.gatilho ?? 75, k.segurar === true, critica))
  }
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

/**
 * Em quanto tempo a conta da sessão é relida, pelo que o agente disse na medida (null: vale o tempo normal). Noutra
 * conta pode ser só a sessão atrasada na troca; numa conta deste computador que saiu de uso, a releitura é logo, porque
 * a sessão relê o login em até 30 s e a medida dela volta a valer.
 */
export function releituraDaConta(resposta: { outraConta?: boolean; conta?: string } | null): number | null {
  if (resposta?.conta === 'atrasada') return CONTA_ATRASADA_MS
  return resposta?.outraConta === true ? CONTA_RECONFERE_MS : null
}

/**
 * De onde a sessão roda (`CLAUDE_CODE_ENTRYPOINT`: cli, claude-vscode, claude-desktop...), só com a forma de um nome. O
 * agente usa no limite: o app de desktop tem login próprio, e a sessão dele numa conta deste computador não está atrasada
 * na troca (esperar não adianta).
 */
export function entradaDaSessao(valor: unknown): string | null {
  return typeof valor === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(valor) ? valor : null
}

/**
 * A rotina que lançou esta sessão (REVEZA_ROTINA no ambiente, posto por quem roda `claude -p` de tempos em tempos): o
 * agente retoma só a passada mais nova de cada rotina, e nenhuma se outra passada dela já começou. A marca é explícita
 * de propósito: o rótulo do serviço que lançou o processo pode juntar tarefas diferentes. Null sem a marca ou com valor
 * fora do formato (letras, números, ponto, dois pontos, arroba, hífen e sublinhado, até 80).
 */
export function rotinaDaSessao(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const v = valor.trim()
  return /^[\w.:@-]{1,80}$/.test(v) ? v : null
}

/** O tempo que o agente pediu para esperar antes de a sessão continuar, em ms: 0 sem pedido, e no máximo 10 minutos. */
export function aguardarMs(segundos: unknown): number {
  return typeof segundos === 'number' && Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos * 1000, AGUARDAR_MAXIMO_MS) : 0
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
  // `desde`: Date.now() na espera do limite; no caso do modelo, o relógio da sessão ($.clock.now(), o que o teste move).
  // `apos`: no relógio da sessão, quando a sessão atrasada na troca pode continuar (dá tempo de ela reler o login).
  let espera: { referencia: number; desde: number; modelo?: string; apos?: number } | null = null
  let retomando = false
  let enxugar = false
  // a última vez que esta sessão parou porque a conta não roda o modelo dela
  let semModeloEm = -Infinity
  // o último StopFailure tratado (Date.now()): o fim do turno logo depois é a mesma parada
  let paradaClassicaEm = -Infinity
  // O idioma da instalação, lido uma vez por sessão (o arquivo não muda no meio dela); null até a primeira leitura.
  let idioma: Idioma | null = null
  // a conta desta sessão (lerContaDaSessao) e até quando vale; refeita quando a conta em uso muda
  let contaLida: { valor: ContaSessao | null; versao: number | null; ate: number } | null = null
  // o agente disse que esta sessão está noutra conta: a linha de status diz isso, e o limite dela não pede troca
  let outraConta = false
  // o último texto mostrado na linha de status (null: nada mostrado ainda). Relato do Paulo (03/11/2026): no Chat do
  // Orca (pelo SDK) cada chamada vira um bloco novo, e a leitura de 30 s repetia "conta contato · 5h 25%" sem parar
  let statusMostrado: string | undefined | null = null
  // de onde a sessão roda (entradaDaSessao), lido no começo dela; vai na medida e no limite
  let entrada: string | null = null
  // a rotina que lançou esta sessão sem tela (rotinaDaSessao), lida no começo dela; vai na medida e no limite
  let rotina: string | null = null
  // sessões críticas: esta sessão é crítica; o agente manda segurar as comuns; o gatilho; e se uma ação desta sessão
  // foi recusada na espera (ela volta sozinha quando a espera acaba)
  let critica = false
  let segurar = false
  let gatilho = 75
  let paradaNaEspera = false
  const segurando = () => deveSegurar({ segurar, critica, outraConta, foraDoAr })

  /** A marca desta sessão no agente: lê (critica undefined) ou grava. null: o agente não respondeu. */
  async function marcaNoAgente(buscar: (url: string, init: HttpInit) => Promise<HttpResponse>, nova?: boolean): Promise<boolean | null> {
    if (!sessao) return null
    try {
      const corpo = nova === undefined ? { sessao } : { sessao, critica: nova }
      const p = await pedido('POST', '/api/critica', corpo)
      const r = await buscar(`${BASE}/api/critica`, p.init)
      const c = (await doAgente(r, p.nonce)) ? lerJson<{ ok?: boolean; critica?: boolean }>(r) : null
      return c?.ok ? c.critica === true : null
    } catch {
      return null
    }
  }

  // `fresca`: no limite a conta é lida de novo, porque o limite é da credencial do pedido que acabou de falhar
  async function contaAtual(agora: number, ler: () => Promise<ContaSessao | null>, fresca = false): Promise<ContaSessao | null> {
    if (fresca || !contaLida || contaLida.versao !== versao || agora >= contaLida.ate) {
      const valor = await ler()
      contaLida = { valor, versao, ate: agora + (valor ? CONTA_VALE_MS : CONTA_RECONFERE_MS) }
    }
    return contaLida.valor
  }

  /** O texto da linha de status quando mudou desde o último mostrado; null quando é o mesmo (não chama o host). */
  function statusMudou(): { texto: string | undefined } | null {
    const texto = textoStatus()
    if (statusMostrado !== null && texto === statusMostrado) return null
    statusMostrado = texto
    return { texto }
  }

  function textoStatus(): string | undefined {
    const x = textos()
    if (foraDoAr) return x.agenteForaDoAr
    if (outraConta) return x.contaOutra
    if (segurando()) return x.criticas.status(gatilho)
    if (!email) return undefined
    const conta = x.contaEmUso(email.split('@')[0]!, cinco)
    return critica ? `${conta} · ${x.criticas.marca}` : conta
  }

  // Devolve o aviso a mostrar quando a conta mudou desde a última leitura.
  function aplicarAtiva(a: Ativa): string | null {
    enxugar = a.enxugar === true
    segurar = a.criticas?.segurar === true
    if (typeof a.criticas?.gatilho === 'number') gatilho = a.criticas.gatilho
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
    entrada = entradaDaSessao(await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => undefined))
    rotina = rotinaDaSessao(await $.env.get('REVEZA_ROTINA').catch(() => undefined))
    const raiz =
      (await $.env.get('REVEZA_HOME')) ??
      `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
    if (!idioma) idioma = usarIdioma(await idiomaDaInstalacao(caminho => $.fs.read(caminho), raiz))
    chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    await $.command.register({
      name: 'reveza',
      description: textos().descricao,
    })
    // crítica pelo ambiente (as rotinas de terminal) ou pela marca que o agente guarda (a sessão retomada continua)
    critica = ambienteCritico(await $.env.get('REVEZA_CRITICA').catch(() => undefined)) || (await marcaNoAgente((url, init) => $.http.fetch(url, init))) === true

    $.clock.every(5000, () => {
      void (async () => {
        // o agente pode ter subido depois da sessão (a chave nasce com ele)
        if (!chavePonte) chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
        // o relógio do host (e não o Date): é ele que marca os 5 s, e o teste o move
        const agora = await $.clock.now()
        // em espera, a leitura é a cada 5 s: a sessão volta logo que uma conta tiver folga
        if (!espera && !segurando() && agora - ultimaLeitura < LEITURA_MS) return
        ultimaLeitura = agora
        const segurandoAntes = segurando()
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
        // sessão noutra conta (o app de desktop): a troca da conta em uso não muda a dela, então não avisa
        if (aviso && !outraConta) $.ui.toast(aviso)
        const status = statusMudou()
        if (status) $.ui.status(status.texto)

        // sessões críticas: a espera desta sessão começou ou acabou
        const segurandoAgora = segurando()
        if (segurandoAgora && !segurandoAntes) $.ui.toast(textos().criticas.comecou(gatilho))
        if (!segurandoAgora && segurandoAntes) {
          $.ui.toast(textos().criticas.voltou)
          if (paradaNaEspera) {
            paradaNaEspera = false
            retomando = true
            // texto fixo, como a retomada do limite
            await $.prompt.submit({ text: textos().criticas.retomada }).catch(() => undefined)
            return
          }
        }

        // conta sem o modelo da sessão e nenhuma troca em 2 minutos: não fica preso, segue no modelo padrão
        if (espera?.modelo && agora - espera.desde > ESPERA_MODELO_MS && !(ativa && ativa.versao > espera.referencia)) {
          const modelo = espera.modelo
          espera = null
          retomando = true
          $.ui.toast(textos().toasts.modeloPadrao(modelo))
          await $.command.run({ command: 'model', args: 'default' }).catch(() => undefined)
          await $.prompt.submit({ text: textos().retomada })
          return
        }
        if (espera && !espera.modelo && Date.now() - espera.desde > ESPERA_MAXIMA_MS) espera = null
        if (!espera || !ativa || ativa.versao <= espera.referencia) return
        if (espera.apos !== undefined && agora < espera.apos) return
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
      const status = statusMudou()
      if (status) $.ui.status(status.texto)
      if (janelas.length > 0) {
        // o relógio do sistema: a validade da conta lida não precisa do relógio da sessão (que nem todo host tem aqui)
        const agora = Date.now()
        const conta = await contaAtual(agora, () => lerContaDaSessao(() => $.session.authorize(), (url, init) => $.http.fetch(url, init)))
        try {
          const p = await pedido('POST', '/api/medida', {
            sessao,
            versao,
            janelas,
            ...(conta ? { conta } : {}),
            ...(entrada ? { entrada } : {}),
            ...(rotina ? { rotina } : {}),
          })
          const r = await $.http.fetch(`${BASE}/api/medida`, p.init)
          if (await doAgente(r, p.nonce)) {
            const resposta = lerJson<{ outraConta?: boolean; conta?: string }>(r)
            const dito = resposta?.outraConta === true
            const releitura = releituraDaConta(resposta)
            if (releitura !== null && contaLida) contaLida.ate = Math.min(contaLida.ate, agora + releitura)
            if (dito !== outraConta) {
              outraConta = dito
              const status = statusMudou()
              if (status) $.ui.status(status.texto)
            }
          }
        } catch {
          // o agente fora do ar aparece na leitura de 5 em 5 s
        }
      }
    }
    return next(e)
  })

  /**
   * Uma sessão parou: o limite de uso, a conta sem o modelo da sessão, a conversa longa demais. Chega pelo
   * `classic.StopFailure` e, desde a 0.12.0, pelo fim do turno com erro (`turn.complete`): nas organizações Team e
   * Enterprise o Claude Code põe o cc-plugin-sec-default na frente dos plugins, e ele não deixa os eventos clássicos
   * chegarem aos que a pessoa instala ("its classic.StopFailure hook was skipped"). Assim o limite só chegava ao Reveza
   * pela leitura de uso, e a sessão não voltava sozinha depois da troca (relato do Paulo, 06/11/2026). Cada parada é
   * tratada uma vez, venha por um caminho ou pelos dois. `f`: as chamadas do `$` que o hook passa (o `$` não sai dele).
   */
  async function tratarParada(
    f: Ferramentas,
    origem: 'classico' | 'turno',
    erro: string,
    detalhe: string | undefined,
    mensagem: string | undefined,
  ): Promise<void> {
    // o StopFailure vem antes do fim do turno: o fim do turno logo depois de um StopFailure é a mesma parada
    if (origem === 'turno' && Date.now() - paradaClassicaEm < PARADA_REPETIDA_MS) return
    if (origem === 'classico') paradaClassicaEm = Date.now()
    const x = textos()
    if (erro === 'invalid_request' && /^Prompt is too long/i.test(mensagem ?? '')) {
      // A conversa passou do limite e nem o /compact cabe mais (relato do Paulo, 13/10/2026): diz como sair e manda ao
      // agente o tamanho dela, que fica nos eventos (sem isso, só lendo as transcrições do computador).
      f.toast(x.toasts.limite)
      const uso = await f.uso().catch(() => null)
      await f
        .buscar(
          `${BASE}/api/sessao/erro`,
          (await pedido('POST', '/api/sessao/erro', { sessao, tipo: 'contexto', tokens: uso?.context.tokens ?? null, janela: uso?.context.window ?? null })).init,
        )
        .catch(() => undefined)
      return
    }
    if (erro !== 'rate_limit') return
    const tipoLimite = tipoDoLimite(detalhe, mensagem)
    if (tipoLimite === 'contexto_longo') {
      f.toast(x.toasts.contexto)
      return
    }
    if (tipoLimite === 'modelo') {
      const modelo = (await f.modelo().catch(() => '')) || 'modelo'
      const superficiesModelo = await f.superficies().catch(() => [])
      const tipoModelo = interativa || superficiesModelo.length > 0 ? 'interativa' : 'headless'
      const agora = await f.agora()
      // a conta para onde trocou também não roda (ou parou de novo logo): direto para o modelo padrão
      const repetiu = agora - semModeloEm < REPETIU_MODELO_MS
      semModeloEm = agora
      const antesModelo = versao
      let respondeu = false
      let dito: { versao: number; trocou?: boolean; outraConta?: boolean; aguardarS?: number; naoPegou?: string } | null = null
      if (!repetiu) {
        try {
          const conta = await contaAtual(Date.now(), () => lerContaDaSessao(f.autorizar, f.buscar), true)
          const p = await pedido('POST', '/api/limite', {
            sessao,
            cwd: await f.cwd(),
            tipo: tipoModelo,
            erro: 'modelo',
            modelo,
            versao: antesModelo,
            ...(conta ? { conta } : {}),
            ...(entrada ? { entrada } : {}),
            ...(rotina ? { rotina } : {}),
          })
          const r = await f.buscar(`${BASE}/api/limite`, p.init)
          dito = (await doAgente(r, p.nonce)) ? lerJson(r) : null
          respondeu = !!dito
        } catch {
          respondeu = false
        }
      }
      if (dito?.outraConta) {
        // a sessão está noutra conta (o app de desktop, por exemplo), ou voltou e não pegou a troca: o Reveza não insiste
        outraConta = true
        const status = statusMudou()
        if (status) f.status(status.texto)
        f.toast(dito.naoPegou ? x.toasts.naoPegou(dito.naoPegou) : x.toasts.outraConta)
        return
      }
      if (tipoModelo === 'interativa') {
        // a volta para o modelo padrão sai na próxima conferência de 5 s (dentro deste hook o comando é recusado); a troca
        // que já aconteceu antes de a sessão reler o login conta como feita
        const referencia = dito?.trocou ? dito.versao - 1 : (antesModelo ?? -1)
        const aguardar = aguardarMs(dito?.aguardarS)
        espera = { referencia, desde: respondeu ? agora : agora - ESPERA_MODELO_MS - 1, modelo, ...(aguardar ? { apos: agora + aguardar } : {}) }
        if (respondeu) f.toast(aguardar ? x.toasts.atrasada : x.toasts.semModelo(modelo))
      }
      return
    }
    if (tipoLimite !== 'uso') return
    const superficies = await f.superficies().catch(() => [])
    const tipo = interativa || superficies.length > 0 ? 'interativa' : 'headless'
    const antes = versao
    let resposta: { ok: boolean; versao: number; trocou?: boolean; outraConta?: boolean; aguardarS?: number; naoPegou?: string } | null = null
    try {
      const conta = await contaAtual(Date.now(), () => lerContaDaSessao(f.autorizar, f.buscar), true)
      const p = await pedido('POST', '/api/limite', {
        sessao,
        cwd: await f.cwd(),
        tipo,
        erro: 'rate_limit',
        versao: antes,
        ...(conta ? { conta } : {}),
        ...(entrada ? { entrada } : {}),
        ...(rotina ? { rotina } : {}),
      })
      const r = await f.buscar(`${BASE}/api/limite`, p.init)
      resposta = (await doAgente(r, p.nonce)) ? lerJson(r) : null
    } catch {
      resposta = null
    }
    if (!resposta) {
      f.toast(x.toasts.semAgente)
    } else if (resposta.outraConta) {
      // o limite é de outra conta (o app de desktop, por exemplo), ou a sessão voltou e não pegou a troca: trocar a conta
      // em uso não faz esta sessão voltar
      outraConta = true
      const status = statusMudou()
      if (status) f.status(status.texto)
      f.toast(resposta.naoPegou ? x.toasts.naoPegou(resposta.naoPegou) : x.toasts.outraConta)
    } else if (tipo === 'interativa') {
      // a troca que já aconteceu antes de a sessão reler o login conta como feita: volta na próxima leitura (a sessão
      // atrasada numa conta que já saiu de uso volta depois do tempo que o agente pede, para reler o login antes)
      const aguardar = aguardarMs(resposta.aguardarS)
      espera = {
        referencia: resposta.trocou ? resposta.versao - 1 : (antes ?? resposta.versao),
        desde: Date.now(),
        ...(aguardar ? { apos: (await f.agora()) + aguardar } : {}),
      }
      f.toast(aguardar ? x.toasts.atrasada : x.toasts.troca)
    }
  }

  on('classic.StopFailure', async ($, e, next) => {
    const f: Ferramentas = {
      toast: texto => $.ui.toast(texto),
      status: texto => $.ui.status(texto),
      superficies: () => $.session.surfaces(),
      cwd: () => $.session.cwd(),
      modelo: () => $.session.model(),
      uso: () => $.session.usage(),
      agora: () => $.clock.now(),
      autorizar: () => $.session.authorize(),
      buscar: (url, init) => $.http.fetch(url, init),
    }
    // só as paradas que o Reveza trata contam para a repetição: outro erro não segura o fim do turno
    if (e.error === 'rate_limit' || (e.error === 'invalid_request' && /^Prompt is too long/i.test(e.last_assistant_message ?? ''))) {
      await tratarParada(f, 'classico', e.error, e.error_details, e.last_assistant_message)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // só o fim do turno principal com erro: o de um subagente não para a sessão
    if (e.agentId !== undefined || e.reason !== 'error') return r
    // o texto do erro não vem no `answer` (no 2.1.312 ele chega vazio, conferido numa sessão de verdade): vem da última
    // mensagem da sessão; sem ela, o uso que a resposta recusada trouxe (100% numa janela) diz que foi o limite de uso
    let parada = paradaDoTurno(e.answer)
    if (!parada) {
      const mensagens = await $.session.messages().catch(() => null)
      const ultima = Array.isArray(mensagens) ? [...mensagens].reverse().find(m => m.role === 'assistant') : undefined
      parada = paradaDoTurno(ultima?.text)
    }
    if (!parada) {
      const uso = await $.session.usage().catch(() => null)
      const cheia = uso?.rateLimits.some(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && l.percentUsed >= 100)
      // sem texto, o tipoDoLimite trata como limite de uso
      if (cheia) parada = { erro: 'rate_limit', mensagem: '' }
    }
    if (!parada) return r
    const f: Ferramentas = {
      toast: texto => $.ui.toast(texto),
      status: texto => $.ui.status(texto),
      superficies: () => $.session.surfaces(),
      cwd: () => $.session.cwd(),
      modelo: () => $.session.model(),
      uso: () => $.session.usage(),
      agora: () => $.clock.now(),
      autorizar: () => $.session.authorize(),
      buscar: (url, init) => $.http.fetch(url, init),
    }
    await tratarParada(f, 'turno', parada.erro, undefined, parada.mensagem || undefined).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    // Turno que não foi o nosso (a pessoa digitou, ou o assistente continuou sozinho no reset): a espera acabou.
    if (!retomando) espera = null
    retomando = false
    return next(e)
  })

  // Sessões críticas: na espera, o prompt da sessão comum não entra (os comandos de barra passam: /reveza critica, /model)
  on('prompt.submit', ($, e, next) => {
    if (!segurando() || e.command) return next(e)
    // o "continue" do próprio Reveza (a volta do limite) recusado aqui fica para quando a espera acabar
    if (e.origin?.kind === 'plugin') paradaNaEspera = true
    return { drop: textos().criticas.recusaPrompt(gatilho) }
  })

  // ...e a ação dela é recusada com o pedido de parar; quando a espera acaba, ela continua sozinha
  on('tool.call', ($, e, next) => {
    if (!segurando()) return next(e)
    paradaNaEspera = true
    return { deny: textos().criticas.recusaAcao(gatilho) }
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

  on('command.run', { command: 'reveza' }, async ($, e) => {
    let estado: Estado | null = null
    const raiz =
      (await $.env.get('REVEZA_HOME')) ??
      `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.reveza`
    if (!idioma) idioma = usarIdioma(await idiomaDaInstalacao(caminho => $.fs.read(caminho), raiz))
    if (!chavePonte) chavePonte = String(await $.fs.read(`${raiz}/ponte.chave`).catch(() => '')).trim()
    if (pedeCritica(e.args ?? '')) {
      const nova = await marcaNoAgente((url, init) => $.http.fetch(url, init), !critica)
      if (nova === null) return { text: textos().foraDoAr }
      critica = nova
      const status = statusMudou()
      if (status) $.ui.status(status.texto)
      return { text: critica ? textos().criticas.virouCritica : textos().criticas.virouComum }
    }
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
    return { text: resumo(estado, undefined, critica) }
  })
}
