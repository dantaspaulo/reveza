// Tipos que o painel usa. Espelham as tabelas e funções de nuvem/contrato.sql, já em camelCase.

export type Idioma = "pt-BR" | "en"
export type Papel = "admin" | "leitura"
export type Modo = "limite" | "limiar" | "rodizio"
export type OrdemRodizio = "aleatoria" | "menor_uso"
/**
 * Como cada computador se atualiza sozinho: desligada (o padrão), de madrugada (3h às 5h no fuso) ou assim que sair (na
 * hora em que ele acha a versão nova). No banco, as duas primeiras são false e true (o true de antes é de madrugada).
 */
export type ModoAtualizar = "desligada" | "madrugada" | "assim_que_sair"
/**
 * O assistente de código de cada computador (0.8.0): o jeito dele (o Reveza não mexe), sempre a mais nova (cada agente
 * atualiza o assistente de 6 em 6 horas) ou só pelo painel (o agente desliga a atualização automática do assistente).
 */
export type ModoAssistente = "padrao" | "sozinho" | "manual"
/** "pendente": o código de acesso foi criado e o computador ainda não fez o primeiro contato (dá para revogar). */
export type Sistema = "macos" | "linux" | "windows" | "pendente"
/** As janelas da conta toda (decidem a troca). */
export type TipoJanelaConta = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet"
/** Mais a semana de um modelo (a API manda desde outubro de 2026): aparece, mas não decide a troca de quem usa outro. */
export type TipoJanela = TipoJanelaConta | "seven_day_fable"

export interface Janela {
  tipo: TipoJanela
  pct: number | null
  resetEm: string | null
}

/** Faixa de horário em que a conta pode ser usada. dias: 1 = segunda ... 7 = domingo. */
export interface FaixaAgenda {
  dias: number[]
  de: string
  ate: string
}

export interface Posse {
  computadorId: string
  motivo: "uso" | "leitura" | "renovacao" | "login"
  expiraEm: string
}

export interface Conta {
  id: string
  email: string
  organizacao: string | null
  plano: string | null
  nivel: string | null
  /**
   * No banco, a cor gravada da conta. Nas telas, a cor do workspace dela: o painel troca ao carregar
   * (lib/cores, pintarPorWorkspace), junto com os campos abaixo.
   */
  cor: number
  /** Tom da conta dentro do workspace, para os gráficos (0 = cor cheia, a conta mais antiga). */
  tom?: number
  /** Chave do workspace (organização, domínio ou a própria conta). */
  workspace?: string
  /** Nome do workspace para a tela; null quando a conta está sozinha (e-mail de provedor público, sem organização). */
  nomeWorkspace?: string | null
  contasNoWorkspace?: number
  prioridade: number
  reserva: boolean
  pausada: boolean
  agenda: FaixaAgenda[]
  tetoSemana: number | null
  /**
   * O modelo que o Claude Code usa nesta conta (opus, sonnet, claude-opus-5-5, claude-fable-5[1m]...). Quando um
   * computador passa para ela, o agente grava esse modelo nas configurações do Claude Code. null: não mexe.
   */
  modelo: string | null
  precisaLogin: boolean
  criadaEm: string
  janelas: Janela[]
  lidoEm: string | null
  fonte: "sessao" | "api" | null
  loginExpiraEm: string | null
  posse: Posse | null
  /**
   * A conta não roda o modelo das sessões destes computadores (sem créditos de uso), até a hora marcada (0028): nesse
   * tempo ela não é escolhida para eles. Nuvem de antes da 0.9.0: lista vazia.
   */
  semModelo: { computadorId: string; modelo: string; ate: string }[]
}

export interface ItemDiagnostico {
  id: string
  /** true: ok; null: aviso; false: falha. */
  ok: boolean | null
  /** O nome que o agente dá à conferência (as telas preferem a tradução pelo id). */
  nome?: string
  detalhe?: string
  /** O problema tem conserto automático seguro (o Corrigir do painel roda). */
  conserto?: boolean
  /** Problema sem conserto automático: o que fazer, em uma linha. */
  fazer?: string
  /** Depois do Corrigir: o que aconteceu com este problema. */
  consertado?: { resultado: "corrigido" | "nao_deu"; texto: string }
}

export interface Diagnostico {
  em: string
  versao: string
  atrasoBuscaMs: number | null
  itens: ItemDiagnostico[]
  /** A versão mais nova publicada, que o agente leu (no máximo a cada 6 h). */
  versaoNova?: string | null
  /** A atualização do programa em andamento neste computador. */
  atualizacao?: { para: string; desde: string } | null
  /** A versão nova que a trava recusou: ela precisa da nuvem e do painel atualizados no computador principal primeiro. */
  precisaNuvem?: { para: string } | null
  /** O agente entende o "assim que sair" (0.2.1 em diante); os de antes só se atualizam sozinhos de madrugada. */
  assimQueSair?: boolean
  /** O assistente de código deste computador (agente 0.8.0 em diante; null nos de antes). */
  assistente?: AssistenteDoComputador | null
}

export interface AssistenteDoComputador {
  /** A versão instalada (X.Y.Z); null: o programa não foi achado. */
  versao: string | null
  /** Quem desligou a atualização automática do assistente neste computador. */
  autoDesligado: "reveza" | "pessoa" | null
  /** O computador está rodando a atualização do assistente agora. */
  atualizando: boolean
  /** A última atualização que o agente rodou (a pedido do painel ou sozinho). */
  ultima: { em: string; ok: boolean; de: string | null; para: string | null; sozinho: boolean; erro?: string } | null
}

export interface Atribuicao {
  contaId: string | null
  motivo: string
  decididoEm: string
}

export interface Computador {
  id: string
  nome: string
  sistema: Sistema
  versao: string
  vistoEm: string | null
  revogado: boolean
  criadoEm: string
  diagnostico: Diagnostico | null
  atribuicao: Atribuicao | null
  /** A conta que este computador usa sempre que ela estiver livre. Uma conta é preferida de um computador só. */
  contaPreferidaId: string | null
  /** Saída enxuta: o mod do Reveza encurta a saída de comandos de leitura (git status, grep, find, ls) neste computador. */
  enxugar: boolean
  /** O nome foi dado no painel (0029): o agente não troca pelo nome do sistema. */
  nomeDoPainel: boolean
}

export interface ConfigTroca {
  auto: boolean
  modo: Modo
  aviso: number
  troca: number
  rodizioMinutos: number
  rodizioOrdem: OrdemRodizio
  intervaloS: number
  retomarTerminal: boolean
  esperaEntreTrocasS: number
  /** Fuso em que a agenda das contas vale (IANA, ex.: America/Sao_Paulo). */
  fuso: string
  /** Toda pessoa administradora precisa da verificação em duas etapas (desligado: cada uma escolhe). */
  exigirDuasEtapas: boolean
  /** Como cada computador se atualiza sozinho, um por vez. Desligada de fábrica. */
  atualizarSozinho: ModoAtualizar
  /** O assistente de código dos computadores: o jeito dele (o padrão), sempre a mais nova ou só pelo painel. */
  assistenteAtualizar: ModoAssistente
  /** Só leitura: de quem é a vez de atualizar sozinho agora (config `atualizacao_vez`, um computador por vez). */
  atualizacaoVez?: VezAtualizacao | null
  /** Só leitura: a nuvem e o painel (0.3.0): a versão da nuvem, o que está no ar e o andamento. */
  nuvem?: EstadoNuvem | null
  /** Só leitura: quando o banco marcou o próximo rodízio. */
  proximoRodizioEm: string | null
}

/**
 * A nuvem e o painel (0.3.0, migração 0021): a nuvem aplica as próprias migrações (sem token); as funções e o painel vão
 * ao ar pelo instalador (passo manual) ou, com a atualização completa ligada, por um computador da instalação.
 */
export interface EstadoNuvem {
  /** A versão cujas migrações a nuvem tem (null: nuvem de antes da 0.3.0). */
  versao: string | null
  /** A última atualização da nuvem. */
  atualizacao: {
    estado: "atualizando" | "atualizada" | "falhou"
    de: string | null
    para: string | null
    desde: string | null
    motivo: string | null
  } | null
  /** O que está no ar. */
  publicado: { funcoes: string | null; painel: string | null }
  /** O resumo das funções e do painel de cada versão (a nuvem calcula ao se atualizar). */
  impressoes: Record<string, { funcoes?: string; painel?: string }>
  /** Os tokens cifrados guardados (nunca os tokens): funções e painel vão sozinhos. */
  completa: boolean
  /** Quem está publicando funções e painel (um computador por vez). */
  publicacao: { computadorId: string | null; para: string; estado: "em_andamento" | "concluida" | "falhou"; desde: string | null; motivo: string | null } | null
}

/** A vez de atualizar sozinho (um computador por vez): quem, para qual versão e como está. */
export interface VezAtualizacao {
  computadorId: string
  para: string
  estado: "em_andamento" | "concluida" | "falhou"
  desde: string
}

export type TipoEvento = "troca" | "aviso" | "limite" | "retomada" | "conexao" | "erro" | "info" | "alerta"

export interface Evento {
  id: number
  em: string
  tipo: TipoEvento
  texto: string
  dados: {
    de?: string | null
    para?: string | null
    conta?: string | null
    computador?: string | null
    motivo?: string | null
    pct?: number | null
    [k: string]: unknown
  }
}

export interface LinhaUso {
  hora: string
  contaId: string | null
  computadorId: string
  projeto: string
  modelo: string
  respostas: number
  entrada: number
  saida: number
  cacheEscrita: number
  cacheLeitura: number
  usd: number
}

export interface SessaoUso {
  id: string
  computadorId: string
  projeto: string
  inicio: string
  fim: string | null
  respostas: number
  tokens: number
  usd: number
  agentes: number
  contas: string[]
  modelos: string[]
  paradaNoLimite: boolean
}

export interface PontoHistorico {
  contaId: string
  em: string
  p5: number | null
  p7: number | null
}

export type CanalAlerta = "telegram" | "email" | "webhook" | "push"
export type EventoAlerta =
  | "sem_livre"
  | "precisa_login"
  | "computador_parado"
  | "login_vence"
  | "resumo_dia"
  | "troca"
  | "limite"
  | "atualizacao_falhou"
  | "troca_falhou"

export interface Alerta {
  id: string
  canal: CanalAlerta
  /** Rótulo para a tela, montado só com os campos que não são segredo. */
  destino: string
  /**
   * O destino como está no banco (só administrador lê). Fica na memória para regravar o alerta ao ligar/desligar;
   * a tela nunca mostra os campos de segredo dele.
   */
  destinoBruto: Record<string, unknown>
  eventos: EventoAlerta[]
  ativo: boolean
}

/**
 * O que a pessoa digita ao criar um alerta. `destino` vai para a tabela (sem segredo); `segredo` (token do bot, chave
 * do serviço de e-mail, assinatura do webhook) vai só para o Vault do Supabase (painel_alerta_segredo).
 */
export interface NovoAlerta {
  canal: CanalAlerta
  eventos: EventoAlerta[]
  destino: Record<string, string>
  segredo: string | null
}

export type EscopoChave = "ler" | "trocar" | "config"

export interface ChaveApi {
  id: string
  nome: string
  prefixo: string
  escopos: EscopoChave[]
  criadaEm: string
  usadaEm: string | null
  revogada: boolean
}

export interface WebhookSaida {
  id: string
  url: string
  eventos: string[]
  ativo: boolean
}

export interface Membro {
  userId: string
  /** O banco não expõe o e-mail dos outros membros; vem preenchido só na demonstração e para você. */
  email: string | null
  nome: string | null
  papel: Papel
  criadoEm: string
}

export interface Convite {
  id: string
  email: string
  papel: Papel
  expiraEm: string
  usadoEm: string | null
}

export interface RegistroAuditoria {
  id: number
  em: string
  quem: string
  acao: string
  alvo: string | null
}

export interface Eu {
  userId: string
  email: string
  nome: string | null
  papel: Papel
  idioma: Idioma
  aal: "aal1" | "aal2"
  totp: { fatorId: string; criadoEm: string } | null
}

export interface SessaoAberta {
  id: string
  criadaEm: string
  ultimaVez: string
  aparelho: string
  atual: boolean
}

export type AcaoComando =
  "conectar" | "entrar_de_novo" | "cancelar_login" | "codigo_login" | "atualizar" | "diagnostico" | "retomar_sessao" | "ligar"

export type EstadoComando = "pendente" | "reservado" | "feito" | "recusado" | "expirado"

export interface Comando {
  id: number
  computadorId: string
  acao: AcaoComando
  estado: EstadoComando
  criadoEm: string
  resposta: Record<string, unknown> | null
}

/**
 * O andamento da ligação de um computador novo (0.2.0), como o painel acompanha: esperando ele pedir, esperando a
 * pessoa digitar o código dele no computador escolhido, chave entregue, ligado; ou recusado / vencido.
 */
export type FaseLigacao = "esperando_pedido" | "esperando_codigo" | "entregue" | "ligado" | "recusado" | "vencido"

export type MotivoRecusaLigacao = "recusado_na_tela" | "dois_pedidos" | "codigo_errado"

export interface EstadoLigacao {
  fase: FaseLigacao
  /** O computador onde a janela abre (o que o painel escolheu). */
  aprovadorId: string | null
  /** Quando o pedido vence (10 minutos depois de o computador novo pedir). */
  expiraEm: string | null
  motivo: MotivoRecusaLigacao | null
}

/** Tudo o que as telas leem de uma vez (o resto vem sob demanda: uso, sessões, histórico, auditoria). */
export interface Instantaneo {
  agora: string
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
}

export interface Intervalo {
  de: Date
  ate: Date
}
