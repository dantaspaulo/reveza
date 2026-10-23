// O que o agente pede à nuvem: as funções `agente_*` do banco (nuvem/migracoes/0002_agente.sql). Só de dentro para
// fora. Binário (cofre, ligação) vai e volta em base64.

import type { Sistema } from "../config.js";

export interface CofreNuvem {
  cifrado: Buffer;
  nonce: Buffer;
  versao: number;
  expira_em: string | null;
}

export interface Atribuicao {
  conta_id: string | null;
  email: string | null;
  motivo: string;
  versao: number;
  /** O modelo do Claude Code nesta conta (0025). Null: o agente não mexe; undefined: nuvem de antes da 0025. */
  modelo?: string | null;
}

export interface ComandoNuvem {
  id: number;
  acao: string;
  corpo: Record<string, unknown>;
  /** A nuvem não manda: quem expira o comando velho é ela (2 min). */
  criado_em?: string;
}

export interface RespostaOla {
  computador_id: string | null;
  atribuicao: Atribuicao | null;
  config: Record<string, unknown>;
  comandos: ComandoNuvem[];
  ligacao_pendente: boolean;
  /** Pedidos de computador novo abertos (0019): mais de um ao mesmo tempo, todos são recusados. */
  ligacoes: PedidoLigacao[];
  /** Saída enxuta ligada neste computador (0025). */
  enxugar: boolean;
}

/** Chave pública ECDH P-256 em JWK, só o que importa. */
export interface ChavePublica {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** Coordenada de P-256 em base64url: 32 bytes = 43 caracteres. */
export function chavePublicaValida(v: unknown): ChavePublica | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Record<string, unknown>;
  const coord = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{43}$/.test(x);
  if (j.kty !== "EC" || j.crv !== "P-256" || !coord(j.x) || !coord(j.y)) return null;
  return { kty: "EC", crv: "P-256", x: j.x as string, y: j.y as string };
}

/** A chave do cofre cifrada para a chave pública do computador novo (ECDH efêmero + HKDF-SHA256 + AES-256-GCM). */
export interface EnvelopeChave {
  efemera: ChavePublica;
  iv: string;
  cifrado: string;
}

/** Um computador novo pedindo para entrar, como quem tem a chave do cofre vê. */
export interface PedidoLigacao {
  computador_id: string;
  publica: ChavePublica;
  pedido_em: string | null;
  expira_em: string | null;
  /** A janela abre aqui (o painel escolheu este computador). */
  para_mim: boolean;
  /** Quando o painel escolheu (escolher de novo abre a janela de novo). */
  aprovador_em: string | null;
  /** A língua da janela (a do painel que escolheu). */
  idioma: "pt-BR" | "en";
}

/** O que o computador novo vê do pedido dele. */
export interface RespostaReceber {
  estado: "sem_pedido" | "esperando" | "entregue" | "recusado" | "vencido" | "lido";
  envelope: EnvelopeChave | null;
  impressao: string | null;
  motivo: string | null;
  expira_em: string | null;
  aprovador: string | null;
}

export type MotivoRecusa = "recusado_na_tela" | "dois_pedidos" | "codigo_errado";

export type MotivoPosse = "uso" | "leitura" | "renovacao" | "login";

export interface JanelaNuvem {
  conta_id: string;
  tipo: string;
  pct: number | null;
  reset_em: string | null;
  fonte: "sessao" | "api";
}

export interface PontoNuvem {
  conta_id: string;
  em: string;
  p5: number | null;
  p7: number | null;
}

export interface LinhaTokens {
  hora: string;
  conta_id: string | null;
  projeto: string;
  modelo: string;
  respostas: number;
  entrada: number;
  saida: number;
  cache_escrita: number;
  cache_leitura: number;
  usd: number;
}

export interface SessaoNuvem {
  id: string;
  projeto: string;
  inicio: string | null;
  fim: string | null;
  respostas: number;
  tokens: number;
  usd: number;
  agentes: number;
  contas: string[];
  modelos: string[];
}

/** Tipos de evento que a nuvem aceita do agente. */
export const TIPOS_EVENTO_NUVEM = new Set(["troca", "aviso", "limite", "retomada", "conexao", "erro", "info"]);

/** Erro de rede ou do servidor: o agente mantém a conta atual e tenta de novo na próxima busca. */
export class ErroNuvem extends Error {
  constructor(
    mensagem: string,
    readonly semRede: boolean,
    readonly codigo?: string,
  ) {
    super(mensagem);
  }
}

export interface Nuvem {
  registrar(nome: string, sistema: Sistema, versao: string): Promise<{ computador_id: string }>;
  ola(versao: string, diagnostico: Record<string, unknown> | null, contaLocal: string | null): Promise<RespostaOla>;
  pegarPosse(contaId: string, motivo: MotivoPosse, segundos: number): Promise<{ ok: boolean; erro: string | null; cofre: CofreNuvem | null }>;
  devolverCofre(
    contaId: string,
    cifrado: Buffer,
    nonce: Buffer,
    versaoAnterior: number,
    expiraEm: string | null,
  ): Promise<{ ok: boolean; versao: number | null; erro: string | null }>;
  soltarPosse(contaId: string): Promise<{ ok: boolean }>;
  registrarConta(
    email: string,
    organizacao: string | null,
    plano: string | null,
    nivel: string | null,
    cifrado: Buffer,
    nonce: Buffer,
    expiraEm: string | null,
  ): Promise<{ ok: boolean; conta_id: string | null; versao: number | null; erro: string | null }>;
  relatarUso(janelas: JanelaNuvem[], historico: PontoNuvem[]): Promise<{ ok: boolean }>;
  relatarTokens(linhas: LinhaTokens[], sessoes: SessaoNuvem[]): Promise<{ ok: boolean }>;
  limite(contaId: string, sessao: string | null): Promise<{ ok: boolean; trocou: boolean; versao: number | null }>;
  /** A conta em uso não roda o modelo da sessão (0028): fora da escolha deste computador por 6 horas, e decide na hora. */
  semModelo(contaId: string, modelo: string, sessao: string | null): Promise<{ ok: boolean; trocou: boolean; versao: number | null }>;
  reservarComando(id: number): Promise<{ ok: boolean; comando: ComandoNuvem | null }>;
  responderComando(id: number, http: number, resposta: Record<string, unknown>): Promise<{ ok: boolean }>;
  evento(tipo: string, texto: string, dados: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** Avisa a nuvem que a conta perdeu (ou recuperou) o login neste computador; só vale para conta na mão. */
  marcarLogin(contaId: string, precisa: boolean): Promise<{ ok: boolean }>;
  /** Frase de emergência (computador já ativo que perdeu a chave): quem tem a chave publica, o outro busca. */
  ligacaoPublicar(embrulho: Buffer, sal: Buffer): Promise<{ ok: boolean; expira_em: string | null }>;
  ligacaoBuscar(): Promise<{ embrulho: Buffer; sal: Buffer } | null>;
  /** Computador novo (identidade pendente): registra a chave pública dele, uma vez só. */
  ligacaoPedir(publica: ChavePublica): Promise<{ computador_id: string; expira_em: string | null }>;
  /** Computador novo: o andamento do pedido; a chave entregue vem uma vez só. */
  ligacaoReceber(): Promise<RespostaReceber>;
  /** Quem tem a chave do cofre: os pedidos abertos. */
  ligacoesAbertas(): Promise<PedidoLigacao[]>;
  ligacaoEntregar(computadorId: string, publica: ChavePublica, envelope: EnvelopeChave): Promise<{ ok: boolean; erro: string | null }>;
  ligacaoRecusar(computadorId: string, motivo: MotivoRecusa): Promise<{ ok: boolean }>;
  /** Grava a impressão da chave do cofre se a instalação ainda não tem (null só lê); devolve a da instalação. */
  cofreImpressao(impressao: string | null): Promise<string | null>;
  /** Hora do servidor (epoch s), para o `doctor` conferir o relógio. */
  horaDoServidor(): Promise<number | null>;
  /** Atualizar sozinho: pede a vez (um computador por vez). `motivo` diz por que não (desligado, outro, falhou...). */
  vezDeAtualizar(de: string, para: string): Promise<{ pode: boolean; motivo: string | null }>;
  /** Como terminou a atualização sozinha deste computador (libera a vez, ou para os outros e vira alerta). */
  resultadoAtualizacao(para: string, estado: "concluida" | "falhou" | "nao_comecou", motivo: string | null): Promise<{ ok: boolean }>;
  /**
   * As migrações que a nuvem já aplicou: os nomes e o resumo de cada uma (hashes null numa nuvem de antes da 0.3.1). Null
   * quando a nuvem não tem o registro; erro com código
   * PGRST202/42883 quando ela é de antes da 0.2.1 (sem a função).
   */
  migracoesAplicadas(): Promise<{ nomes: string[]; hashes: Record<string, string> | null } | null>;
  /** Atualização completa (0021): guarda os dois tokens cifrados com a chave do cofre (com a impressão dela). */
  credenciaisGuardar(supabase: TokenNuvem, vercel: TokenNuvem, impressao: string): Promise<{ ok: boolean }>;
  /** Os tokens cifrados (só computador ativo lê; sem a chave do cofre, não abre). */
  credenciaisLer(): Promise<{ supabase: (TokenNuvem & { gravadoEm: string | null }) | null; vercel: (TokenNuvem & { gravadoEm: string | null }) | null }>;
  credenciaisApagar(): Promise<{ ok: boolean }>;
  /** Os dados do painel na Vercel (projeto e equipe), para conferir o token da Vercel. Null: a nuvem ainda não sabe. */
  painelPublicacao(): Promise<{ projeto: string; equipe: string | null } | null>;
  /** A vez de publicar as funções e o painel da versão em que a nuvem está (um computador por vez). */
  vezDePublicar(para: string): Promise<{ pode: boolean; motivo: string | null; funcoes: boolean; painel: boolean }>;
  /** Como terminou a publicação (concluída marca o que está no ar; falhou vira alerta e segura os computadores). */
  resultadoPublicacao(para: string, estado: "concluida" | "falhou", motivo: string | null): Promise<{ ok: boolean }>;
}

/** Um token cifrado com a chave do cofre (AES-256-GCM; o dado associado diz qual token é). */
export interface TokenNuvem {
  cifrado: Buffer;
  nonce: Buffer;
}
