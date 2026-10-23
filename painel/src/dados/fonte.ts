// A camada de dados do painel. Duas implementações: FonteDemo (dados falsos gerados no navegador) e FonteSupabase
// (o banco da instalação: nuvem/migracoes, leitura direta com RLS e escrita só pelas funções painel_*).
// As telas só conhecem esta interface.

import type {
  AcaoComando,
  Alerta,
  Comando,
  Conta,
  ConfigTroca,
  EscopoChave,
  EventoAlerta,
  Idioma,
  Instantaneo,
  Intervalo,
  EstadoLigacao,
  LinhaUso,
  NovoAlerta,
  Papel,
  PontoHistorico,
  RegistroAuditoria,
  SessaoAberta,
  SessaoUso,
  WebhookSaida,
} from "./tipos"

export type CamposConta = Partial<Pick<Conta, "cor" | "prioridade" | "reserva" | "pausada" | "agenda" | "tetoSemana" | "modelo">>

/** O que cada fonte sabe fazer. A tela esconde ou desliga o que a nuvem ainda não oferece. */
export interface Recursos {
  testarAlerta: boolean
  testarWebhook: boolean
  cancelarConvite: boolean
  /** Lista das sessões abertas de quem está logado. "Sair de todas" funciona sempre. */
  listarSessoes: boolean
  /** Inscrição de push do celular (precisa da chave pública de push da instalação). */
  push: boolean
}

/** O que volta do Atualizar a nuvem (a Edge Function atualizar-nuvem). */
export interface ResultadoNuvem {
  ok: boolean
  /** atualizada, em_dia, atualizando (outra rodada com a vez), falhou (com o motivo) ou parada. */
  estado: string
  para: string | null
  motivo: string | null
}

/** Como está o aviso ao vivo da nuvem para este painel. */
export type EstadoTempoReal = "conectando" | "ligado" | "caiu"

export interface Fonte {
  readonly demo: boolean
  readonly recursos: Recursos

  // leitura
  carregar(): Promise<Instantaneo>
  uso(intervalo: Intervalo): Promise<LinhaUso[]>
  sessoes(intervalo: Intervalo): Promise<SessaoUso[]>
  historico(desde: Date): Promise<PontoHistorico[]>
  auditoria(limite: number): Promise<RegistroAuditoria[]>
  minhasSessoes(): Promise<SessaoAberta[]>
  /**
   * Avisa quando algo mudou na nuvem (ou no relógio da demonstração). Devolve a função que cancela. `aoEstado` conta
   * como está o tempo real: conectando, ligado, ou caiu (o navegador congelou a aba, a rede caiu, a nuvem recusou).
   */
  assinar(aoMudar: () => void, aoEstado?: (estado: EstadoTempoReal) => void): () => void

  // escrita (no banco: admin + aal2; cada função grava a auditoria)
  salvarConfig(campos: Partial<ConfigTroca>): Promise<void>
  salvarConta(id: string, campos: CamposConta): Promise<void>
  /** Grava a ordem de preferência: a primeira da lista é a preferida. */
  ordenarContas(ids: string[]): Promise<void>
  trocarAgora(computadorId: string, contaId: string): Promise<void>
  /** A conta que este computador usa sempre que ela estiver livre (null tira). Se estiver livre agora, ele passa para ela. */
  preferirConta(computadorId: string, contaId: string | null): Promise<void>
  /** Liga ou desliga a saída enxuta neste computador (o mod do Reveza lê em até 30 s). */
  enxugarComputador(computadorId: string, ligado: boolean): Promise<void>
  comando(computadorId: string, acao: AcaoComando, corpo?: Record<string, unknown>): Promise<Comando>
  lerComando(id: number): Promise<Comando | null>
  /**
   * Cria a identidade pendente de um computador novo (administrador com duas etapas) e devolve o código de acesso que
   * o instalador pede (--ligar, rvzc_). O código só deixa o computador novo pedir para entrar: não abre o cofre.
   * `computadorId` é a linha pendente (revogável) que ele criou.
   */
  criarAcessoComputador(): Promise<{ codigo: string; computadorId: string | null }>
  /** O computador (que já tem a chave do cofre) onde a janela de liberar abre, na língua do painel. De novo: abre de novo. */
  escolherAprovador(computadorNovoId: string, aprovadorId: string): Promise<void>
  /** O andamento da ligação de um computador novo (o painel pergunta de tempos em tempos). */
  estadoLigacao(computadorNovoId: string): Promise<EstadoLigacao>
  revogarComputador(id: string): Promise<void>
  /**
   * O nome do computador no painel (administrador, 0029): fica mesmo quando o agente se registra de novo. Vazio: volta
   * ao nome do sistema, que o agente grava no próximo registro.
   */
  renomearComputador(id: string, nome: string): Promise<void>
  /**
   * Atualizar a nuvem (administrador): a nuvem aplica as migrações da versão oficial mais nova, sem token; com a
   * atualização completa ligada, funções e painel vêm depois, por um computador. Também destrava a publicação parada.
   */
  atualizarNuvem(): Promise<ResultadoNuvem>
  /** Desliga a atualização completa (administrador): os tokens cifrados saem da nuvem. Ligar é só num computador. */
  desligarAtualizacaoCompleta(): Promise<void>

  criarAlerta(alerta: NovoAlerta): Promise<void>
  mudarAlerta(alerta: Alerta, campos: { ativo?: boolean; eventos?: EventoAlerta[] }): Promise<void>
  removerAlerta(id: string): Promise<void>
  testarAlerta(id: string): Promise<void>

  criarChave(nome: string, escopos: EscopoChave[]): Promise<{ chave: string }>
  revogarChave(id: string): Promise<void>
  /** Cria o webhook e devolve o segredo da assinatura, que aparece uma vez só. */
  criarWebhook(url: string, eventos: string[]): Promise<{ segredo: string | null }>
  mudarWebhook(webhook: WebhookSaida, campos: { ativo?: boolean; eventos?: string[] }): Promise<void>
  testarWebhook(id: string): Promise<void>

  convidar(email: string, papel: Papel): Promise<{ link: string | null }>
  cancelarConvite(id: string): Promise<void>
  mudarPapel(userId: string, papel: Papel): Promise<void>
  revogarMembro(userId: string): Promise<void>

  meuIdioma(idioma: Idioma): Promise<void>
  chavePushPublica(): Promise<string | null>
  inscreverPush(inscricao: PushSubscriptionJSON): Promise<void>
  /** A nuvem tem a inscrição deste aparelho (o endereço dela) em nome de quem está logado? */
  pushRegistrado(endpoint: string): Promise<boolean>
}

/** Erro com código conhecido, para a tela traduzir a mensagem. */
export class ErroPainel extends Error {
  readonly codigo: string
  constructor(codigo: string, mensagem?: string) {
    super(mensagem ?? codigo)
    this.codigo = codigo
    this.name = "ErroPainel"
  }
}
