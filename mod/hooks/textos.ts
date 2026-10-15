// Os textos do mod nos dois idiomas, português (o padrão) e inglês. Mesmo contrato do instalador e do agente:
// t("português", "english"). O idioma é o da instalação, lido do ~/.reveza/instalacao.json no começo da sessão
// (register.ts); sem o arquivo, sem o campo, ou com qualquer erro, segue em português.
//
// Os nomes de comando (/compact, /rewind), as flags, os subcomandos (reveza contas conectar) e as chaves da ponte
// continuam como estão: são o que a pessoa digita e o que o agente espera.

export type Idioma = 'pt-BR' | 'en'

let atual: Idioma = 'pt-BR'

/** Aceita "en", "en-US", "pt", "pt-BR"; qualquer outra coisa (ou nada) fica no português. */
export function normalizarIdioma(i: unknown): Idioma {
  return /^en\b/i.test(String(i ?? '')) ? 'en' : 'pt-BR'
}

export function usarIdioma(i: unknown): Idioma {
  atual = normalizarIdioma(i)
  return atual
}

export function idiomaAtual(): Idioma {
  return atual
}

/** O mesmo contrato, no idioma pedido (um teste, ou um idioma que não o da sessão). */
export function emIdioma(i: Idioma, pt: string, en: string): string {
  return i === 'en' ? en : pt
}

export function t(pt: string, en: string): string {
  return emIdioma(atual, pt, en)
}

/**
 * O idioma que a instalação escolheu (instalacao.json, gravado pelo instalador). Sem o arquivo, sem o campo ou com
 * JSON inválido, português: é o padrão das instalações antigas e o dos testes.
 */
export async function idiomaDaInstalacao(ler: (caminho: string) => Promise<string>, raiz: string): Promise<Idioma> {
  try {
    const inst = JSON.parse(await ler(`${raiz}/instalacao.json`)) as { idioma?: unknown }
    return normalizarIdioma(inst?.idioma)
  } catch {
    return 'pt-BR'
  }
}

export type Textos = {
  estados: Record<string, string>
  janelas: Record<string, string>
  renova: (h: string) => string
  semLeitura: string
  soNoLimite: string
  rodizio: string
  limiar: (aviso: number, troca: number) => string
  trocaLigada: (modo: string) => string
  trocaDesligada: string
  sombra: string
  semNuvem: string
  semContas: string
  agenteForaDoAr: string
  contaEmUso: (nome: string, cinco: string) => string
  contaMudou: (email: string) => string
  descricao: string
  retomada: string
  foraDoAr: string
  toasts: { limite: string; contexto: string; semAgente: string; troca: string }
}

/** Os textos no idioma pedido (por padrão, o da sessão). Sempre no momento do uso: o idioma só existe depois do import. */
export function textos(i: Idioma = atual): Textos {
  const o = (pt: string, en: string) => emIdioma(i, pt, en)
  return {
    estados: {
      ativa: o('em uso', 'in use'),
      proxima: o('próxima', 'next'),
      livre: o('livre', 'free'),
      esgotada: o('esgotada', 'exhausted'),
      pausada: o('pausada', 'paused'),
      precisa_login: o('precisa entrar de novo', 'needs to sign in again'),
      sem_leitura: o('sem leitura', 'no reading'),
    },
    janelas: {
      five_hour: o('5 horas', '5 hours'),
      seven_day: o('Semana', 'Week'),
      seven_day_opus: o('Semana, modelo maior', 'Week, larger model'),
      seven_day_sonnet: o('Semana, modelo médio', 'Week, medium model'),
    },
    renova: (h: string) => o(` (renova ${h})`, ` (resets ${h})`),
    semLeitura: o('sem leitura ainda', 'no reading yet'),
    soNoLimite: o('só no limite', 'only at the limit'),
    rodizio: o('rodízio ao longo do dia', 'rotation throughout the day'),
    limiar: (aviso: number, troca: number) => o(`aviso em ${aviso}%, troca em ${troca}%`, `warning at ${aviso}%, switch at ${troca}%`),
    trocaLigada: (modo: string) => o(`Troca automática ligada (${modo}).`, `Auto switch is on (${modo}).`),
    trocaDesligada: o('Troca automática desligada.', 'Auto switch is off.'),
    sombra: o('Agente em modo sombra: só observa e registra o que faria.', 'Agent in shadow mode: it only watches and records what it would do.'),
    semNuvem: o('Sem falar com a nuvem agora: a conta atual fica.', "Can't reach the cloud right now: staying on the current account."),
    semContas: o('Nenhuma conta conectada. No terminal: reveza contas conectar <email>', 'No account connected. In the terminal: reveza contas conectar <email>'),
    agenteForaDoAr: o('Reveza: agente fora do ar', 'Reveza: agent is down'),
    contaEmUso: (nome: string, cinco: string) => o(`conta ${nome}${cinco ? ` · ${cinco}` : ''}`, `account ${nome}${cinco ? ` · ${cinco}` : ''}`),
    contaMudou: (email: string) => o(`Reveza: agora na conta ${email}`, `Reveza: now on account ${email}`),
    descricao: o('Reveza AI: a conta em uso, o uso de cada conta e o estado do agente', "Reveza AI: the account in use, each account's usage and the agent's state"),
    retomada: o(
      'A conta anterior bateu o limite de uso e o Reveza trocou de conta. Continue a tarefa de onde parou.',
      'The previous account hit its usage limit and Reveza switched accounts. Continue the task from where you left off.',
    ),
    foraDoAr: o(
      'O agente do Reveza está fora do ar. No terminal: reveza servico instalar (ou reveza rodar), e depois reveza doctor.',
      'The Reveza agent is down. In the terminal: reveza servico instalar (or reveza rodar), then reveza doctor.',
    ),
    toasts: {
      limite: o(
        'A conversa passou do limite: rode /rewind, volte algumas mensagens e rode /compact (ou comece outra sessão).',
        'The conversation is over the limit: run /rewind, go back a few messages and run /compact (or start another session).',
      ),
      contexto: o(
        'A conversa passou do contexto que esta conta usa sem crédito extra: rode /compact (ou comece outra sessão). Trocar de conta não resolve.',
        'The conversation is larger than the context this account gets without extra usage: run /compact (or start another session). Switching accounts won\'t help.',
      ),
      semAgente: o(
        'Limite da conta atingido e o agente do Reveza está fora do ar: a sessão espera o reset.',
        'Account limit reached and the Reveza agent is down: the session will wait for the reset.',
      ),
      troca: o(
        'Limite da conta atingido. Assim que o Reveza trocar de conta, a sessão continua sozinha.',
        'Account limit reached. As soon as Reveza switches accounts, the session continues on its own.',
      ),
    },
  }
}
