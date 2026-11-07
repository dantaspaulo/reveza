import type { On } from 'claude-code'
import { expect, mock, test, type TestBody } from 'claude-code/testing'

import {
  aguardarMs,
  ambienteCritico,
  deveSegurar,
  entradaDaSessao,
  hmacHex,
  janelasTexto,
  paradaDoTurno,
  pedeCritica,
  releituraDaConta,
  resumo,
  tipoDoLimite,
} from './register'

// Agente falso: responde /api/ativa com a versão do momento e guarda o que o mod mandou.
// `instalacao` é o conteúdo do instalacao.json (o idioma da instalação); sem ele, o arquivo não existe (português).
function agente(on: On, instalacao?: string) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('session.cwd', () => ({ value: '/tmp/projeto' }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('command.register', () => ({ value: undefined }) as never)
  const status: (string | undefined)[] = []
  on('ui.status', ($, e) => (status.push((e as { text?: string }).text), { value: undefined }))
  const avisos: string[] = []
  on('ui.toast', ($, e) => (avisos.push(JSON.stringify(e)), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const recebidos: { url: string; corpo: Record<string, unknown> | null; metodo: string; cabecalhos: Record<string, string> }[] = []
  const estado = {
    versao: 3,
    email: 'a@exemplo.com',
    foraDoAr: false,
    impostor: false,
    enxugar: false,
    // o perfil oficial que a sessão lê com a credencial dela (null: sem resposta)
    perfil: null as { status: number; corpo: unknown } | null,
    // o agente diz que a sessão está noutra conta
    outraConta: false,
    // o que o agente acrescenta à resposta do limite (sessão atrasada na troca: { trocou, aguardarS }, ou { naoPegou })
    limiteExtra: {} as Record<string, unknown>,
    // o CLAUDE_CODE_ENTRYPOINT da sessão
    entrada: undefined as string | undefined,
    // sessões críticas: o que /api/ativa manda (undefined: função desligada), a marca guardada e o REVEZA_CRITICA
    criticas: undefined as { segurar: boolean; gatilho: number } | undefined,
    marcada: false,
    ambienteCritica: undefined as string | undefined,
  }
  const perfis: { auth: string | undefined; cabecalhos: Record<string, string> }[] = []
  on('http.fetch', async ($, e) => {
    if (e.url === 'https://api.anthropic.com/api/oauth/profile') {
      perfis.push({ auth: e.init?.auth, cabecalhos: (e.init?.headers ?? {}) as Record<string, string> })
      if (!estado.perfil) throw new Error('sem rede')
      return { value: { status: estado.perfil.status, ok: estado.perfil.status === 200, headers: {}, text: JSON.stringify(estado.perfil.corpo) } }
    }
    if (estado.foraDoAr) throw new Error('ECONNREFUSED')
    const corpo = e.init?.body ? (JSON.parse(e.init.body) as Record<string, unknown>) : null
    recebidos.push({
      url: e.url,
      corpo,
      metodo: e.init?.method ?? 'GET',
      cabecalhos: (e.init?.headers ?? {}) as Record<string, string>,
    })
    let resposta: unknown = { ok: true }
    if (e.url.endsWith('/api/ativa'))
      resposta = { slug: 'a', email: estado.email, versao: estado.versao, trocadaEm: 0, enxugar: estado.enxugar, ...(estado.criticas ? { criticas: estado.criticas } : {}) }
    if (e.url.endsWith('/api/critica')) {
      if (typeof corpo?.critica === 'boolean') estado.marcada = corpo.critica
      resposta = { ok: true, critica: estado.marcada }
    }
    if (e.url.endsWith('/api/limite')) resposta = { ok: true, versao: estado.versao, ...(estado.outraConta ? { outraConta: true } : {}), ...estado.limiteExtra }
    if (e.url.endsWith('/api/medida')) resposta = { ok: true, outraConta: estado.outraConta }
    if (e.url.endsWith('/api/estado'))
      resposta = {
        auto: true,
        modo: 'limiar',
        limiares: { aviso: 90, troca: 95 },
        contas: [
          { email: 'a@exemplo.com', org: 'Org A', estado: 'ativa', janelas: [{ tipo: 'five_hour', rotulo: '5 horas', pct: 42, resetEm: null }] },
          { email: 'b@exemplo.com', org: null, estado: 'livre', janelas: [{ tipo: 'seven_day_opus', pct: 12, resetEm: null }] },
        ],
      }
    const nonce = ((e.init?.headers ?? {}) as Record<string, string>)['X-Reveza-Nonce'] ?? ''
    const headers: Record<string, string> = estado.impostor ? {} : { 'x-reveza-servidor': await hmacHex('c'.repeat(64), `servidor\n${nonce}`) }
    return { value: { status: 200, ok: true, headers, text: JSON.stringify(resposta) } }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('env.get', ($, e) => ({
    value:
      e.name === 'HOME' ? '/home/teste' : e.name === 'CLAUDE_CODE_ENTRYPOINT' ? estado.entrada : e.name === 'REVEZA_CRITICA' ? estado.ambienteCritica : undefined,
  }))
  on('fs.read', ($, e) => {
    if (e.path === '/home/teste/.reveza/ponte.chave') return { value: `${'c'.repeat(64)}\n` }
    if (instalacao && e.path === '/home/teste/.reveza/instalacao.json') return { value: instalacao }
    throw new Error('ENOENT')
  })
  return { recebidos, estado, avisos, status, perfis }
}

test('no limite, avisa o agente e continua sozinha quando a conta troca', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  // a prova do agente é conferida com digest assíncrono: deixa a leitura da conta em uso terminar
  await relogio.settle()
  for (let i = 0; i < 5 && !recebidos.some(r => r.url.endsWith('/api/ativa')); i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  await $.classic.StopFailure({ error: 'rate_limit' })

  // a chave nunca viaja: vai só a prova
  expect(recebidos.every(r => r.cabecalhos['X-Reveza-Chave'] === undefined)).toBe(true)
  expect(recebidos.every(r => /^[0-9a-f]{64}$/.test(String(r.cabecalhos['X-Reveza-Prova'])))).toBe(true)
  expect(recebidos.every(r => !JSON.stringify(r.cabecalhos).includes('c'.repeat(64)))).toBe(true)
  const limite = recebidos.find(r => r.url.endsWith('/api/limite'))
  expect(limite?.corpo).toMatchObject({ erro: 'rate_limit', tipo: 'interativa', versao: 3, sessao: 'sessao-teste' })

  await relogio.advance(5000)
  expect(enviados).toHaveLength(0)

  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await relogio.advance(5000)
  await relogio.settle()
  for (let i = 0; i < 5 && enviados.length === 0; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('trocou de conta')
  expect(enviados[0]).not.toContain('b@exemplo.com') // o que a ponte devolve não entra no prompt
  expect(recebidos.some(r => r.url.includes('/api/fila/') && r.url.endsWith('/retomada'))).toBe(true)
})

test('a pessoa digitou durante a espera: não manda continuar por cima', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.start({ text: 'outra coisa', turnId: 't1' })
  estado.versao = 4
  await relogio.advance(5000)
  await relogio.settle()
  expect(enviados).toHaveLength(0)
})

test('rate_limit que não é limite de uso (contexto de 1M sem crédito, 429 momentâneo) não troca de conta nem manda continuar', async ($, on) => {
  const { recebidos, avisos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  // as mensagens de verdade do Claude Code 2.1.296
  await $.classic.StopFailure({
    error: 'rate_limit',
    error_details: '429 {"type":"error","error":{"type":"rate_limit_error","message":"Extra usage is required for long context requests."}}',
    last_assistant_message: 'API Error: Usage credits required for 1M context · run /usage-credits to turn them on',
  } as never)
  await $.classic.StopFailure({
    error: 'rate_limit',
    last_assistant_message: 'API Error: Request rejected (429) · this may be a temporary capacity issue.',
  } as never)
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
  expect(avisos.some(a => a.includes('/compact'))).toBe(true)
})

test('limite de uso de verdade (com o texto do Claude Code) avisa o agente', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit · resets 1pm (America/Fortaleza)" } as never)
  expect(recebidos.filter(r => r.url.endsWith('/api/limite'))).toHaveLength(1)
})

test('Prompt is too long: mostra como sair e manda ao agente o tamanho da conversa', async ($, on) => {
  const { recebidos, avisos } = agente(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 615000, window: 1000000, percent: 61 }, rateLimits: [] } }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.classic.StopFailure({ error: 'invalid_request', last_assistant_message: 'Prompt is too long' } as never)
  const erro = recebidos.find(r => r.url.endsWith('/api/sessao/erro'))
  expect(erro?.corpo).toMatchObject({ sessao: 'sessao-teste', tipo: 'contexto', tokens: 615000, janela: 1000000 })
  expect(avisos.some(a => a.includes('/rewind'))).toBe(true)
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
})

test('outro erro de API não mexe no agente', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.classic.StopFailure({ error: 'overloaded' })
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
})

test('o uso de cada resposta vai para o agente, com o cabeçalho X-Reveza e na porta padrão', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { window: 200000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 91.5, resetsAt: '2026-10-11T01:50:00Z' }],
    changed: ['rateLimits'],
  })
  const medida = recebidos.find(r => r.url.endsWith('/api/medida'))
  expect(medida?.corpo).toMatchObject({ janelas: [{ tipo: 'five_hour', pct: 91.5 }] })
  expect(medida?.url.startsWith('http://127.0.0.1:7788/')).toBe(true)
  expect(medida?.cabecalhos['X-Reveza']).toBe('1')
})

test('a porta do agente vem da configuração do mod', { options: { porta: 7799 } }, async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { window: 200000 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    changed: ['rateLimits'],
  })
  expect(recebidos.some(r => r.url.startsWith('http://127.0.0.1:7799/api/medida'))).toBe(true)
})

test('/reveza resume as contas, sem marca de terceiros', async ($, on) => {
  agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('a@exemplo.com')
  expect(r.text).toContain('5 horas 42%')
  expect(r.text).toContain('Semana, modelo maior 12%')
  expect(r.text).toContain('Troca automática ligada')
  expect(/claude|anthropic|opus|sonnet/i.test(r.text ?? '')).toBe(false)
})

test('/reveza com o agente fora do ar explica como ligar', async ($, on) => {
  const { estado } = agente(on)
  estado.foraDoAr = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('fora do ar')
  expect(r.text).toContain('reveza servico instalar')
})

test('HMAC-SHA256 do mod bate com o vetor do RFC 4231 (caso 1)', async () => {
  expect(await hmacHex('0b'.repeat(20), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
})

test('outro programa na porta (sem a prova do agente) não controla o /reveza nem a retomada', async ($, on) => {
  const { estado } = agente(on)
  estado.impostor = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(String(r.text)).not.toContain('Org A')
})


test('o tipo do limite pelas mensagens reais do Claude Code', async () => {
  expect(tipoDoLimite(undefined, "You've hit your session limit · resets 1pm (America/Fortaleza)")).toBe('uso')
  expect(tipoDoLimite(undefined, "You've hit your weekly limit · resets 6am (America/Fortaleza)")).toBe('uso')
  expect(
    tipoDoLimite(undefined, "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit · your session limit resets 2:20am (America/Fortaleza)"),
  ).toBe('uso')
  expect(tipoDoLimite('Extra usage is required for long context requests.', undefined)).toBe('contexto_longo')
  expect(tipoDoLimite(undefined, 'API Error: Usage credits required for 1M context · run /usage-credits to turn them on')).toBe('contexto_longo')
  expect(tipoDoLimite(undefined, 'API Error: Request rejected (429) · this may be a temporary capacity issue.')).toBe('outro')
  // a conta não roda o modelo da sessão sem créditos de uso (o Fable 5.1 numa conta Team, 22/10/2026): troca de conta
  expect(tipoDoLimite(undefined, 'API Error: This model requires usage credits · /model to switch models.')).toBe('modelo')
  expect(tipoDoLimite(undefined, 'Fable 5.1 requires usage credits. Switch to another model to continue.')).toBe('modelo')
  expect(
    tipoDoLimite(undefined, 'Fable limit reached · continuing on Fable 5.1 uses usage credits, and the prompt to confirm went unanswered — nothing was sent · answer it where this session is running, or /model to change'),
  ).toBe('modelo')
  expect(tipoDoLimite(undefined, undefined)).toBe('uso')
})

// git status de verdade, com as dicas que a saída enxuta tira
const STATUS = [
  'On branch main',
  'Changes not staged for commit:',
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  '\tmodified:   agente/src/agente.ts',
  '',
  'no changes added to commit (use "git add" and/or "git commit -a")',
  '',
].join('\n')

// O fim da cadeia faz o papel do Claude Code: roda o "comando" e devolve a saída.
function bash(on: On, saida: { stdout: string; stderr?: string; interrupted?: boolean; erro?: boolean }) {
  on('tool.call', () => {
    if (saida.erro) return { isError: true, result: 'Exit code 1', text: 'Exit code 1' } as never
    const r = { stdout: saida.stdout, stderr: saida.stderr ?? '', interrupted: saida.interrupted ?? false }
    return { result: r, text: r.stdout, ref: 1 } as never
  })
}

async function rodar($: Parameters<TestBody>[0], comando: string) {
  return (await $.tool.call({ tool: 'Bash', command: comando } as never)) as { result?: { stdout: string; stderr: string }; ref?: number }
}

test('saída enxuta ligada no painel: tira as dicas do git status e deixa o stderr como veio', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  estado.enxugar = true
  bash(on, { stdout: STATUS, stderr: 'aviso: algo' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  const r = await rodar($, 'git status')
  expect(r.result?.stdout).toBe('On branch main\nChanges not staged for commit:\n\tmodified:   agente/src/agente.ts\nno changes added to commit\n')
  expect(r.result?.stderr).toBe('aviso: algo')
  expect(r.ref).toBe(undefined)
})

test('saída enxuta desligada (o padrão): a saída passa inteira, como o Claude Code mandou', async ($, on) => {
  const relogio = mock.clock(on)
  agente(on)
  bash(on, { stdout: STATUS })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  const r = await rodar($, 'git status')
  expect(r.result?.stdout).toBe(STATUS)
  expect(r.ref).toBe(1)
})

test('saída enxuta: o painel desliga e a próxima leitura já vale', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  estado.enxugar = true
  bash(on, { stdout: STATUS })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  expect((await rodar($, 'git status')).result?.stdout).not.toBe(STATUS)
  estado.enxugar = false
  for (let i = 0; i < 7; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  expect((await rodar($, 'git status')).result?.stdout).toBe(STATUS)
})

test('saída enxuta: com pipe, interrompida ou com erro, nada muda', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  estado.enxugar = true
  const saida: { stdout: string; interrupted?: boolean; erro?: boolean } = { stdout: STATUS }
  bash(on, saida)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  expect((await rodar($, 'git status | cat')).ref).toBe(1)
  saida.interrupted = true
  expect((await rodar($, 'git status')).ref).toBe(1)
  saida.interrupted = false
  saida.erro = true
  const r = (await $.tool.call({ tool: 'Bash', command: 'git status' } as never)) as { isError?: boolean; result?: unknown }
  expect(r.isError).toBe(true)
  expect(r.result).toBe('Exit code 1')
})

// Instalação em inglês (instalacao.json com "idioma":"en"): tudo o que a pessoa vê sai em inglês.

test('/reveza sai em inglês com a instalação em inglês', async ($, on) => {
  agente(on, JSON.stringify({ idioma: 'en' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({
    command: 'reveza',
    args: '',
    origin: { kind: 'composer' } as never,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('a@exemplo.com')
  expect(r.text).toContain('5 hours 42%')
  expect(r.text).toContain('Week, larger model 12%')
  expect(r.text).toContain('Auto switch is on')
  expect(/claude|anthropic|opus|sonnet/i.test(r.text ?? '')).toBe(false)
})

test('a retomada sai em inglês com a instalação em inglês', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on, JSON.stringify({ idioma: 'en' }))
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  await $.classic.StopFailure({ error: 'rate_limit' })
  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await relogio.advance(5000)
  await relogio.settle()
  for (let i = 0; i < 5 && enviados.length === 0; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('Continue the task')
  expect(enviados[0]).not.toContain('b@exemplo.com') // o que a ponte devolve não entra no prompt
})

test('resumo e janelasTexto no idioma pedido, com o português como padrão', () => {
  const estado = {
    auto: true,
    modo: 'limiar',
    limiares: { aviso: 90, troca: 95 },
    contas: [{ email: 'a@exemplo.com', org: null, estado: 'ativa', janelas: [{ tipo: 'five_hour', pct: 42, resetEm: null }] }],
  }
  expect(resumo(estado)).toContain('Troca automática ligada (aviso em 90%, troca em 95%)')
  expect(resumo(estado)).toContain('5 horas 42%')
  expect(resumo(estado, 'pt-BR')).toBe(resumo(estado))
  expect(resumo(estado, 'en')).toContain('Auto switch is on (warning at 90%, switch at 95%)')
  expect(janelasTexto([{ tipo: 'seven_day', pct: 10, resetEm: null }], 'en')).toBe('Week 10%')
  expect(janelasTexto([], 'en')).toBe('no reading yet')
  expect(janelasTexto([{ tipo: 'five_hour', pct: 42, resetEm: 1000000000 }], 'en')).toContain('(resets ')
})

// O Fable 5.1 numa conta Team sem créditos de uso (relato do Paulo, 22/10/2026): troca de conta e continua no Fable;
// sem troca em 2 minutos, ou parando de novo logo, segue no modelo padrão (/model default), sem ficar preso.
function comModelo(on: On) {
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  const comandos: string[] = []
  on('command.run', ($, e) => (comandos.push(`/${e.command} ${e.args}`.trim()), { text: '' }) as never)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => (enviados.push(e.text), { text: e.text }))
  return { comandos, enviados }
}
const FABLE_SEM_CREDITO = { error: 'rate_limit', last_assistant_message: 'Fable 5.1 requires usage credits. Switch to another model to continue.' } as never

async function andar(relogio: ReturnType<typeof mock.clock>, ms: number) {
  for (let feito = 0; feito < ms; feito += 5000) {
    await relogio.advance(5000)
    await relogio.settle()
  }
}

test('conta sem o modelo da sessão: avisa o agente com o modelo e continua no Fable quando a conta troca', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado, avisos } = agente(on)
  const { comandos, enviados } = comModelo(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  const limite = recebidos.find(r => r.url.endsWith('/api/limite'))
  expect(limite?.corpo).toMatchObject({ erro: 'modelo', modelo: 'claude-fable-5-1', tipo: 'interativa', versao: 3, sessao: 'sessao-teste' })
  expect(avisos.some(a => a.includes('não roda o claude-fable-5-1'))).toBe(true)
  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await andar(relogio, 15_000)
  expect(enviados).toHaveLength(1)
  expect(comandos).toEqual([])
})

test('conta sem o modelo e nenhuma troca em 2 minutos: vai para o modelo padrão e continua', async ($, on) => {
  const relogio = mock.clock(on)
  const { avisos } = agente(on)
  const { comandos, enviados } = comModelo(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  await andar(relogio, 60_000)
  expect(comandos).toEqual([])
  expect(enviados).toHaveLength(0)
  await andar(relogio, 70_000)
  expect(comandos).toEqual(['/model default'])
  expect(enviados).toHaveLength(1)
  expect(avisos.some(a => a.includes('segue no modelo padrão'))).toBe(true)
})

test('parou de novo pelo modelo logo depois: não pede outra troca, vai direto para o modelo padrão', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado } = agente(on)
  const { comandos, enviados } = comModelo(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  estado.versao = 4
  await andar(relogio, 15_000)
  expect(enviados).toHaveLength(1)
  // a conta nova também não roda
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  expect(recebidos.filter(r => r.url.endsWith('/api/limite'))).toHaveLength(1)
  await andar(relogio, 10_000)
  expect(comandos).toEqual(['/model default'])
  expect(enviados).toHaveLength(2)
})

// A conta da sessão (relato de um usuário, 22/10/2026): o app de desktop, com login próprio, carregava o mod e o uso
// dele ia para a conta em uso. O mod lê a conta com a credencial da sessão (o segredo fica no Claude Code) e manda ao
// agente; quem decide é o agente.
const MEDIDA = { context: { window: 200000 } as never, rateLimits: [{ kind: 'five_hour', percentUsed: 48 }], changed: ['rateLimits'] as never }
const PERFIL_A = { status: 200, corpo: { account: { uuid: 'acc-A', email: 'a@exemplo.com' }, organization: { uuid: 'org-A' } } }

test('a medida leva a conta da sessão, lida pelo perfil com a credencial dela (uma leitura, não uma por medida)', async ($, on) => {
  const { recebidos, estado, perfis } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'apelido-1', kind: 'bearer' as const } }))
  estado.perfil = PERFIL_A
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEDIDA)
  await $.session.measure({ ...MEDIDA, rateLimits: [{ kind: 'five_hour', percentUsed: 49 }] })
  const medidas = recebidos.filter(r => r.url.endsWith('/api/medida'))
  expect(medidas).toHaveLength(2)
  expect(medidas[0]?.corpo).toMatchObject({ conta: { accountUuid: 'acc-A', orgUuid: 'org-A' } })
  // só os dois identificadores vão ao agente: nem e-mail, nem o apelido da credencial
  expect(JSON.stringify(medidas[0]?.corpo)).not.toContain('a@exemplo.com')
  expect(JSON.stringify(recebidos)).not.toContain('apelido-1')
  expect(perfis).toHaveLength(1)
  expect(perfis[0]).toMatchObject({ auth: 'apelido-1', cabecalhos: { 'anthropic-beta': 'oauth-2025-04-20' } })
})

test('o agente diz que a sessão está noutra conta: a linha de status diz isso', async ($, on) => {
  const { estado, status } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  estado.perfil = PERFIL_A
  estado.outraConta = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEDIDA)
  expect(status.at(-1)).toContain('noutra conta')
})

test('token só de uso no ambiente (o perfil recusa pelo escopo): a sessão vai como fora do login trocado', async ($, on) => {
  const { recebidos, estado } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  estado.perfil = { status: 403, corpo: { error: { message: 'OAuth token does not meet scope requirement user:profile' } } }
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEDIDA)
  expect(recebidos.find(r => r.url.endsWith('/api/medida'))?.corpo).toMatchObject({ conta: { fora: true } })
})

test('Claude Code sem o authorize, ou perfil sem resposta: a medida vai sem a conta, como antes', async ($, on) => {
  const { recebidos, estado } = agente(on)
  estado.perfil = null
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEDIDA)
  const medida = recebidos.find(r => r.url.endsWith('/api/medida'))
  expect(medida?.corpo).toMatchObject({ janelas: [{ tipo: 'five_hour', pct: 48 }] })
  expect(medida?.corpo?.conta).toBeUndefined()
})

test('limite numa sessão de outra conta: avisa, não espera troca nem manda continuar', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, avisos } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  estado.perfil = PERFIL_A
  estado.outraConta = true
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  expect(avisos.some(a => a.includes('O Reveza não troca a conta dela'))).toBe(true)
  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await andar(relogio, 15_000)
  expect(enviados).toHaveLength(0)
})

// Relato do Paulo (29/10/2026): sessões que seguiram na conta que saiu por minutos depois da troca bateram o limite dela
// e pararam sem voltar. O agente agora diz que a troca já aconteceu e quanto esperar: a sessão relê o login a cada 30 s.
function comEnvio(on: On) {
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  return enviados
}

test('sessão atrasada na troca: o agente pede 35 s e a sessão só continua depois deles, já com a versão nova', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, avisos } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  const enviados = comEnvio(on)
  estado.perfil = PERFIL_A
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  // a troca já aconteceu (versão 4): a sessão é que ainda estava na conta de antes
  estado.versao = 4
  estado.email = 'b@exemplo.com'
  estado.limiteExtra = { trocou: true, aguardarS: 35 }
  await $.classic.StopFailure({ error: 'rate_limit' })
  expect(avisos.some(a => a.includes('ainda estava na conta anterior'))).toBe(true)
  await andar(relogio, 25_000)
  expect(enviados).toHaveLength(0)
  await andar(relogio, 15_000)
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('trocou de conta')
})

test('no limite, a conta da sessão é lida de novo (a guardada pode ser de antes de ela reler o login)', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado, perfis } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  estado.perfil = PERFIL_A
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEDIDA)
  expect(perfis).toHaveLength(1)
  await andar(relogio, 5_000)
  estado.perfil = { status: 200, corpo: { account: { uuid: 'acc-B' }, organization: { uuid: 'org-B' } } }
  await $.classic.StopFailure({ error: 'rate_limit' })
  expect(perfis).toHaveLength(2)
  expect(recebidos.find(r => r.url.endsWith('/api/limite'))?.corpo).toMatchObject({ conta: { accountUuid: 'acc-B', orgUuid: 'org-B' } })
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  expect(perfis).toHaveLength(3)
})

test('voltou e não pegou a troca: o mod diz em que conta a sessão ficou e não manda continuar', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, avisos, status } = agente(on)
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' as const } }))
  const enviados = comEnvio(on)
  estado.perfil = PERFIL_A
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  estado.limiteExtra = { outraConta: true, naoPegou: 'contato@exemplo.com' }
  await $.classic.StopFailure({ error: 'rate_limit' })
  expect(avisos.some(a => a.includes('contato@exemplo.com') && a.includes('não pegou a troca'))).toBe(true)
  expect(status.at(-1)).toContain('noutra conta')
  estado.versao = 4
  await andar(relogio, 60_000)
  expect(enviados).toHaveLength(0)
})

test('modelo recusado numa sessão atrasada: espera o que o agente pede e continua no mesmo modelo', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, avisos } = agente(on)
  const { comandos, enviados } = comModelo(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  estado.versao = 4
  estado.limiteExtra = { trocou: true, aguardarS: 35 }
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  expect(avisos.some(a => a.includes('ainda estava na conta anterior'))).toBe(true)
  await andar(relogio, 25_000)
  expect(enviados).toHaveLength(0)
  await andar(relogio, 15_000)
  expect(enviados).toHaveLength(1)
  expect(comandos).toEqual([])
})

test('a conta da sessão é relida logo quando ela está numa conta deste computador que saiu de uso', () => {
  expect(releituraDaConta({ conta: 'atrasada', outraConta: false })).toBe(30_000)
  expect(releituraDaConta({ conta: 'atrasada', outraConta: true })).toBe(30_000)
  expect(releituraDaConta({ conta: 'outra', outraConta: true })).toBe(2 * 60 * 1000)
  expect(releituraDaConta({ conta: 'ativa', outraConta: false })).toBe(null)
  expect(releituraDaConta({ outraConta: false })).toBe(null)
  expect(releituraDaConta(null)).toBe(null)
})

test('o limite leva de onde a sessão roda (o app de desktop tem login próprio, e o agente não o manda esperar)', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado } = agente(on)
  comModelo(on)
  estado.entrada = 'claude-desktop'
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 10_000)
  await $.session.measure(MEDIDA)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.classic.StopFailure(FABLE_SEM_CREDITO)
  expect(recebidos.find(r => r.url.endsWith('/api/medida'))?.corpo?.entrada).toBe('claude-desktop')
  const limites = recebidos.filter(r => r.url.endsWith('/api/limite'))
  expect(limites).toHaveLength(2)
  expect(limites.every(r => r.corpo?.entrada === 'claude-desktop')).toBe(true)
})

test('de onde a sessão roda vai só com a forma de um nome', () => {
  expect(entradaDaSessao('claude-desktop')).toBe('claude-desktop')
  expect(entradaDaSessao('cli')).toBe('cli')
  expect(entradaDaSessao('sdk-ts')).toBe('sdk-ts')
  expect(entradaDaSessao(undefined)).toBe(null)
  expect(entradaDaSessao('')).toBe(null)
  expect(entradaDaSessao('Claude Desktop')).toBe(null)
  expect(entradaDaSessao('x'.repeat(41))).toBe(null)
  expect(entradaDaSessao('a\nb')).toBe(null)
})

test('a espera que o agente pede vale em segundos, com teto de 10 minutos', () => {
  expect(aguardarMs(35)).toBe(35_000)
  expect(aguardarMs(120)).toBe(120_000)
  expect(aguardarMs(86_400)).toBe(600_000)
  expect(aguardarMs(undefined)).toBe(0)
  expect(aguardarMs(-5)).toBe(0)
  expect(aguardarMs('35')).toBe(0)
  expect(aguardarMs(Number.NaN)).toBe(0)
})

// Relato do Paulo (03/11/2026): no Chat do Orca (pelo SDK) cada chamada da linha de status vira um bloco novo, e a
// leitura de 30 s repetia "conta contato · 5h 25%" sem parar. A linha só é refeita quando o texto muda.
test('a linha de status só é refeita quando o texto muda', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, status } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await andar(relogio, 100_000)
  expect(status.filter(s => s === 'conta a')).toHaveLength(1)
  await $.session.measure(MEDIDA)
  await $.session.measure(MEDIDA)
  await andar(relogio, 65_000)
  expect(status.filter(s => s === 'conta a · 5h 48%')).toHaveLength(1)
  await $.session.measure({ ...MEDIDA, rateLimits: [{ kind: 'five_hour', percentUsed: 49 }] })
  expect(status.at(-1)).toBe('conta a · 5h 49%')
  estado.versao = 4
  estado.email = 'b@exemplo.com'
  await andar(relogio, 35_000)
  expect(status.at(-1)).toBe('conta b')
  expect(status.filter(s => s === 'conta b')).toHaveLength(1)
})

// Nas organizações Team e Enterprise o Claude Code põe o cc-plugin-sec-default na frente, e o classic.StopFailure não
// chega ao mod ("its classic.StopFailure hook was skipped", 06/11/2026): o limite vem pelo fim do turno com erro.
const FIM_NO_LIMITE = {
  answer: "You've hit your 5-hour limit · resets 12:40pm (America/Fortaleza)",
  reason: 'error' as const,
  durationMs: 900,
  isAborted: false,
  turnId: 'turno-1',
}

test('Team (sem o StopFailure): o fim do turno no limite avisa o agente e a sessão continua quando a conta troca', async ($, on) => {
  const relogio = mock.clock(on)
  const { recebidos, estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await relogio.advance(5000)
  await relogio.settle()
  for (let i = 0; i < 5 && !recebidos.some(r => r.url.endsWith('/api/ativa')); i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  await $.turn.complete(FIM_NO_LIMITE as never)
  const limite = recebidos.filter(r => r.url.endsWith('/api/limite'))
  expect(limite).toHaveLength(1)
  expect(limite[0]?.corpo).toMatchObject({ erro: 'rate_limit', tipo: 'interativa', versao: 3, sessao: 'sessao-teste' })

  estado.versao = 4
  estado.email = 'b@exemplo.com'
  for (let i = 0; i < 6 && enviados.length === 0; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
  expect(enviados).toHaveLength(1)
  expect(enviados[0]).toContain('trocou de conta')
})

test('o fim do turno chega sem o texto (como no Claude Code de verdade): o texto vem da última mensagem da sessão', async ($, on) => {
  const { recebidos } = agente(on)
  on('session.messages', () => ({ value: [{ role: 'user', text: 'oi', toolUses: [] }, { role: 'assistant', text: FIM_NO_LIMITE.answer, toolUses: [] }] }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...FIM_NO_LIMITE, answer: '' } as never)
  expect(recebidos.filter(r => r.url.endsWith('/api/limite'))).toHaveLength(1)
})

test('sem o texto e sem as mensagens: o uso em 100% que a resposta trouxe diz que foi o limite', async ($, on) => {
  const { recebidos } = agente(on)
  on('session.messages', () => ({ value: { deny: 'sem acesso' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100 }] } }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...FIM_NO_LIMITE, answer: '' } as never)
  const limite = recebidos.filter(r => r.url.endsWith('/api/limite'))
  expect(limite).toHaveLength(1)
  expect(limite[0]?.corpo).toMatchObject({ erro: 'rate_limit' })
})

test('fim do turno com erro, sem texto de limite e com o uso abaixo de 100%: não mexe no agente', async ($, on) => {
  const { recebidos } = agente(on)
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'API Error: 500 Internal server error', toolUses: [] }] }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }] } }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...FIM_NO_LIMITE, answer: '' } as never)
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
})

test('o StopFailure e o fim do turno da mesma parada avisam o agente uma vez só', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: FIM_NO_LIMITE.answer } as never)
  await $.turn.complete(FIM_NO_LIMITE as never)
  expect(recebidos.filter(r => r.url.endsWith('/api/limite'))).toHaveLength(1)
})

test('fim de turno sem erro, com outro erro ou de um subagente não mexe no agente', async ($, on) => {
  const { recebidos } = agente(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...FIM_NO_LIMITE, reason: 'answer', answer: 'Pronto: o hit your limit do log foi corrigido.' } as never)
  await $.turn.complete({ ...FIM_NO_LIMITE, answer: 'API Error: 500 {"type":"error","error":{"type":"api_error"}}' } as never)
  await $.turn.complete({ ...FIM_NO_LIMITE, agentId: 'ajudante-1' } as never)
  expect(recebidos.some(r => r.url.endsWith('/api/limite'))).toBe(false)
})

test('o fim do turno também traz a conta sem o modelo e a conversa longa demais', async ($, on) => {
  const { recebidos, avisos } = agente(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 615000, window: 1000000, percent: 61 }, rateLimits: [] } }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ ...FIM_NO_LIMITE, answer: 'Prompt is too long' } as never)
  expect(recebidos.find(r => r.url.endsWith('/api/sessao/erro'))?.corpo).toMatchObject({ tipo: 'contexto', tokens: 615000 })
  expect(avisos.some(a => a.includes('/rewind'))).toBe(true)
})

test('as paradas que o fim do turno reconhece, pelo texto que a sessão mostrou', () => {
  expect(paradaDoTurno("You've hit your 5-hour limit · resets 12:40pm (America/Fortaleza)")).toEqual({
    erro: 'rate_limit',
    mensagem: "You've hit your 5-hour limit · resets 12:40pm (America/Fortaleza)",
  })
  expect(paradaDoTurno("You've hit your weekly limit · resets 6am (America/Fortaleza)")?.erro).toBe('rate_limit')
  expect(paradaDoTurno('Fable 5.1 requires usage credits. Switch to another model to continue.')?.erro).toBe('rate_limit')
  expect(paradaDoTurno('API Error: Usage credits required for 1M context · run /usage-credits to turn them on')?.erro).toBe('rate_limit')
  expect(paradaDoTurno('Prompt is too long')?.erro).toBe('invalid_request')
  expect(paradaDoTurno('API Error: Request rejected (429) · this may be a temporary capacity issue.')).toBeNull()
  expect(paradaDoTurno('API Error: 500 Internal server error')).toBeNull()
  expect(paradaDoTurno('')).toBeNull()
  expect(paradaDoTurno(undefined)).toBeNull()
})

// Sessões críticas (0.15.0): na espera, a sessão comum não manda prompt nem roda ação; a crítica segue.
async function leAtiva($: Parameters<TestBody>[0], relogio: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }, vezes = 8) {
  for (let i = 0; i < vezes; i++) {
    await relogio.advance(5000)
    await relogio.settle()
  }
}

test('sessões críticas: quem segura e quem segue', () => {
  expect(deveSegurar({ segurar: true, critica: false, outraConta: false, foraDoAr: false })).toBe(true)
  expect(deveSegurar({ segurar: true, critica: true, outraConta: false, foraDoAr: false })).toBe(false)
  expect(deveSegurar({ segurar: true, critica: false, outraConta: true, foraDoAr: false })).toBe(false)
  expect(deveSegurar({ segurar: true, critica: false, outraConta: false, foraDoAr: true })).toBe(false)
  expect(deveSegurar({ segurar: false, critica: false, outraConta: false, foraDoAr: false })).toBe(false)
  expect(pedeCritica(' critica ')).toBe(true)
  expect(pedeCritica('crítica')).toBe(true)
  expect(pedeCritica('critical')).toBe(true)
  expect(pedeCritica('')).toBe(false)
  expect(pedeCritica('criticas demais')).toBe(false)
  expect(ambienteCritico('1')).toBe(true)
  expect(ambienteCritico('sim')).toBe(true)
  expect(ambienteCritico('0')).toBe(false)
  expect(ambienteCritico(undefined)).toBe(false)
})

test('sessão comum na espera: o prompt não entra, a ação é recusada, e ela volta sozinha quando há folga', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, avisos, status } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => (enviados.push(e.text), { text: e.text }))
  bash(on, { stdout: 'ok' })
  estado.criticas = { segurar: true, gatilho: 75 }
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await leAtiva($, relogio)
  expect(avisos.some(a => a.includes('passaram de 75%'))).toBe(true)
  expect(status.at(-1)).toContain('em espera')

  const p = await $.prompt.submit({ text: 'faz mais uma coisa' } as never)
  expect((p as { drop?: string }).drop).toContain('/reveza critica')
  expect(enviados).toHaveLength(0)
  const comando = await $.prompt.submit({ text: '/model', command: { name: 'model' } } as never)
  expect((comando as { drop?: string }).drop).toBeUndefined()

  const r = (await rodar($, 'ls')) as { deny?: string }
  expect(r.deny).toContain('Pare agora')

  estado.criticas = { segurar: false, gatilho: 75 }
  await leAtiva($, relogio, 3)
  expect(avisos.some(a => a.includes('voltou a ter folga'))).toBe(true)
  expect(enviados.some(t => t.includes('continue a tarefa'))).toBe(true)
  expect(((await rodar($, 'ls')) as { deny?: string }).deny).toBeUndefined()
})

test('/reveza critica marca a sessão no agente, e a crítica segue na espera', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado, recebidos, status } = agente(on)
  bash(on, { stdout: 'ok' })
  estado.criticas = { segurar: true, gatilho: 80 }
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await leAtiva($, relogio)
  const r = await $.command.run({ command: 'reveza', args: 'critica', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toContain('agora é crítica')
  expect(estado.marcada).toBe(true)
  expect(recebidos.find(x => x.url.endsWith('/api/critica') && x.corpo?.critica === true)?.corpo).toMatchObject({ sessao: 'sessao-teste' })
  expect(((await rodar($, 'ls')) as { deny?: string }).deny).toBeUndefined()
  expect(status.at(-1)).toContain('crítica')
  const de_novo = await $.command.run({ command: 'reveza', args: 'critica', origin: { kind: 'composer' } as never, presentation: { isFullscreen: false, columns: 100 } })
  expect(de_novo.text).toContain('voltou a ser comum')
  expect(estado.marcada).toBe(false)
})

test('sessão marcada antes (retomada) ou aberta com REVEZA_CRITICA=1 já nasce crítica', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  bash(on, { stdout: 'ok' })
  estado.criticas = { segurar: true, gatilho: 75 }
  estado.ambienteCritica = '1'
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await leAtiva($, relogio)
  expect(((await rodar($, 'ls')) as { deny?: string }).deny).toBeUndefined()
})

test('agente fora do ar: ninguém fica em espera (e a sessão parada continua)', async ($, on) => {
  const relogio = mock.clock(on)
  const { estado } = agente(on)
  const enviados: string[] = []
  on('prompt.submit', ($, e) => (enviados.push(e.text), { text: e.text }))
  bash(on, { stdout: 'ok' })
  estado.criticas = { segurar: true, gatilho: 75 }
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await leAtiva($, relogio)
  expect(((await rodar($, 'ls')) as { deny?: string }).deny).toContain('Pare agora')
  estado.foraDoAr = true
  await leAtiva($, relogio, 3)
  expect(((await rodar($, 'ls')) as { deny?: string }).deny).toBeUndefined()
  expect(enviados.some(t => t.includes('continue a tarefa'))).toBe(true)
})

test('/reveza mostra as sessões críticas quando o agente manda', () => {
  const texto = resumo(
    { auto: true, modo: 'limiar', limiares: { aviso: 90, troca: 95 }, contas: [], criticas: { ligada: true, gatilho: 75, segurar: true } },
    'pt-BR',
    true,
  )
  expect(texto).toContain('Sessões críticas: ligadas, gatilho em 75% (agora só as críticas seguem). Esta sessão: crítica')
})
