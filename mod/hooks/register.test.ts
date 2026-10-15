import type { On } from 'claude-code'
import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { hmacHex, janelasTexto, resumo, tipoDoLimite } from './register'

// Agente falso: responde /api/ativa com a versão do momento e guarda o que o mod mandou.
// `instalacao` é o conteúdo do instalacao.json (o idioma da instalação); sem ele, o arquivo não existe (português).
function agente(on: On, instalacao?: string) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('session.cwd', () => ({ value: '/tmp/projeto' }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }))
  const avisos: string[] = []
  on('ui.toast', ($, e) => (avisos.push(JSON.stringify(e)), { value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  const recebidos: { url: string; corpo: Record<string, unknown> | null; metodo: string; cabecalhos: Record<string, string> }[] = []
  const estado = { versao: 3, email: 'a@exemplo.com', foraDoAr: false, impostor: false, enxugar: false }
  on('http.fetch', async ($, e) => {
    if (estado.foraDoAr) throw new Error('ECONNREFUSED')
    const corpo = e.init?.body ? (JSON.parse(e.init.body) as Record<string, unknown>) : null
    recebidos.push({
      url: e.url,
      corpo,
      metodo: e.init?.method ?? 'GET',
      cabecalhos: (e.init?.headers ?? {}) as Record<string, string>,
    })
    let resposta: unknown = { ok: true }
    if (e.url.endsWith('/api/ativa')) resposta = { slug: 'a', email: estado.email, versao: estado.versao, trocadaEm: 0, enxugar: estado.enxugar }
    if (e.url.endsWith('/api/limite')) resposta = { ok: true, versao: estado.versao }
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
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/teste' : undefined }))
  on('fs.read', ($, e) => {
    if (e.path === '/home/teste/.reveza/ponte.chave') return { value: `${'c'.repeat(64)}\n` }
    if (instalacao && e.path === '/home/teste/.reveza/instalacao.json') return { value: instalacao }
    throw new Error('ENOENT')
  })
  return { recebidos, estado, avisos }
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
  expect(tipoDoLimite(undefined, 'API Error: This model requires usage credits · /model to switch models.')).toBe('outro')
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
