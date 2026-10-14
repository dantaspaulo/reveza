// O agente de cada computador: junta a troca local, a leitura de uso, o cofre, a posse, a nuvem, o registro de uso
// das transcrições e a ponte com o mod.
//
// Com nuvem: a cada busca (5 s) chama `agente_ola`, aplica a atribuição que a nuvem decidiu, roda os comandos do
// painel e mantém as posses. Sem internet, mantém a conta atual e segue tentando.
// Sem nuvem (`--sem-nuvem`): decide sozinho, com as regras do roteador (limiar, limite ou rodízio).
// Modo sombra: lê e decide, mas não grava credencial, não pega posse e não responde comando; registra o que faria.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ApiContas } from "./anthropic.js";
import type { Cli } from "./claudecli.js";
import { ClaudeJson } from "./claudejson.js";
import { tocarSom } from "./som.js";
import { pedirConfirmacao } from "./confirmar.js";
import type { Executor } from "./util/executor.js";
import { CICLO_S, COMANDO_VALIDO_S, FATOR_LEITURA_SOMBRA, FILA_VALIDA_S, LER_ATIVA_PERTO_S, LER_ATIVA_S, LER_ESTACIONADA_AVISO_S, LER_ESTACIONADA_S, MEDIDA_FRESCA_S, POSSE_S, VERSAO, VENCIDO_EM_S, type Caminhos, type Sistema } from "./config.js";
import { expiraEm, hashToken, temRenovacao } from "./credenciais/blob.js";
import { PRINCIPAL } from "./credenciais/tipos.js";
import { CredenciaisSombra } from "./credenciais/sombra.js";
import type { Credenciais } from "./credenciais/tipos.js";
import { agendarRodizio, candidata, decidir, gatilhoDeTroca, pctEfetivo, sorteioReal } from "./decisao.js";
import { carregarEstado, salvarEstado, type EstadoLocal, type Modo } from "./estado.js";
import { conferirCodigo, entregarChave, impressaoDaChave, LIGACAO_DUPLA } from "./ligar.js";
import { Logins, EMAIL_VALIDO, type Login } from "./logins.js";
import { ErroNuvem, TIPOS_EVENTO_NUVEM, type Atribuicao, type ComandoNuvem, type JanelaNuvem, type Nuvem, type PedidoLigacao, type PontoNuvem } from "./nuvem/tipos.js";
import { PosseCofre } from "./posse.js";
import { chaveDaPonte, criarPonte, type Resposta } from "./ponte.js";
import { Contador } from "./registro/contador.js";
import { Trocador } from "./troca.js";
import { isoParaEpoch, epochParaIso, type Relogio } from "./util/tempo.js";
import type { Log } from "./util/log.js";
import type { Guarda } from "./cofre/guarda.js";
import { SEGREDO_COFRE } from "./cofre/guarda.js";
import type { Server } from "node:http";
import {
  acharInstalador,
  ATUALIZACAO_VALIDA_S,
  naMadrugada,
  CONFERIR_AGORA_S,
  CONFERIR_VERSAO_S,
  escolherVersao,
  extrairTarGz,
  faltamNaNuvem,
  lerPedido,
  migracoesDoPacote,
  resumosDoPacote,
  modoAtualizar,
  rodarSeparado,
  TAREFA_ATUALIZAR,
  textoPrecisaNuvem,
  TRAVA_CONFERIR_S,
  ultimaLinha,
  VERSAO_VALIDA,
  type AtualizacaoPendente,
  type FonteVersoes,
  type MigracoesDaNuvem,
  type ModoAtualizar,
} from "./atualizar.js";
import { compararVersao } from "./doctor.js";
import { abrirTokens, completaLigada, PUBLICA_DESDE, pendenteDaPublicacao, semSegredos } from "./completa.js";
import { gravarAtomico, gravarJson, lerJson } from "./util/arquivos.js";
import { aplicarResumo, contaGrande, janelaDaConta, RESUMO_MAXIMO, RESUMO_MINIMO } from "./resumo.js";
import { aplicarModelo } from "./modelo.js";

export interface Dependencias {
  c: Caminhos;
  sistema: Sistema;
  cred: Credenciais;
  api: ApiContas;
  cli: Cli;
  relogio: Relogio;
  log: Log;
  guarda: Guarda;
  nuvem: Nuvem | null;
  sombra: boolean;
  porta: number;
  sorteio?: (xs: string[]) => string;
  aleatorio?: () => number;
  diagnostico?: () => Promise<Record<string, unknown>>;
  /**
   * O conserto do Corrigir do painel (a lista fechada de conserto.ts, rodando dentro do agente). Devolve o diagnóstico
   * de depois, no formato do `diagnostico`, com o resultado de cada problema, e o resumo para o evento.
   */
  consertar?: () => Promise<{ diagnostico: Record<string, unknown>; resumo: string; corrigidos?: number; naoDeu?: number }>;
  /** Para tocar o som da troca (sem ele, não toca). */
  exec?: Executor;
  /** As versões publicadas e o pacote de cada uma (o GitHub oficial; os testes trocam). Sem isto, não se atualiza. */
  versoes?: FonteVersoes;
  /** O Node que roda o instalador da versão nova (o mesmo do agente). */
  node?: string;
  /** O ambiente do instalador da versão nova: sem segredo nem token (sem token, só este computador é atualizado). */
  ambienteDoInstalador?: NodeJS.ProcessEnv;
  /** O projeto do Supabase desta instalação (do endereço da nuvem): a publicação das funções e do painel precisa dele. */
  refNuvem?: string | null;
}

/** A publicação das funções e do painel que não terminou nisso é dada como falha. */
export const PUBLICACAO_VALIDA_MS = 40 * 60_000;
/** O instalador sai com este código quando outra publicação segue viva neste computador (travarPublicacao): esperar. */
export const PUBLICACAO_OCUPADA = 75;

const ACOES = new Set(["conectar", "entrar_de_novo", "cancelar_login", "codigo_login", "atualizar", "diagnostico", "retomar_sessao", "ligar"]);

/** O registro da atualização em andamento, com o que o agente já contou dela. */
type Pendente = AtualizacaoPendente & {
  sozinho?: boolean;
  /** O jeito da atualização sozinha (de madrugada ou assim que saiu), para os textos. */
  modo?: ModoAtualizar;
  relatado?: boolean;
  fim?: "concluida" | "falhou";
  motivo?: string;
  nuvemAvisada?: boolean;
};

/** Quanto a conta que a nuvem mandou pode levar para chegar à principal antes de o doctor acusar falha. */
export const ESPERA_CONTA_S = 120;

/**
 * Dois pedidos de computador novo ao mesmo tempo: todos são recusados (falha fechada). Quem escreve direto no banco
 * pode ler a chave pública do pedido verdadeiro e tentar um pedido dele junto; com um pareamento por vez, o forjado
 * derruba os dois em vez de ser liberado (revisão de segurança de 11/10/2026).
 */
export { LIGACAO_DUPLA };

/** O pedido de ligação pelo painel (frase cifrada para o navegador) saiu na 0.2.0. */
export const LIGAR_PELO_PAINEL_SAIU =
  "o pedido de ligação pelo painel saiu na 0.2.0: atualize o painel; o código aparece no computador novo e é digitado neste";

/** A versão nova que a trava de compatibilidade recusou: a nuvem ainda não tem as migrações que ela traz. */
export interface TravaNuvem {
  para: string;
  /** As migrações que vieram no pacote da versão nova. */
  precisa: string[];
  /** O resumo de cada uma (resumosDoPacote). */
  resumos: Record<string, string[]>;
  /** As que faltam na nuvem (null: a nuvem não disse quais, por ser de antes da 0.2.1 ou não ter o registro). */
  faltam: string[] | null;
  conferidaEm: number;
}

/** O resultado de pedir para atualizar o programa (o painel, ou o sozinho). */
export type ResultadoAtualizar =
  | { ok: true; de: string; para: string }
  | { ok: false; status: number; erro: string; precisaNuvem?: { para: string; faltam: string[] | null } };

/** Até 3 tentativas de digitar o código na janela; na terceira errada, o pedido é recusado. */
export const TENTATIVAS_CODIGO = 3;

/** O mesmo erro do log sobe ao painel no máximo a cada 30 min, e no máximo 10 erros por hora. */
export const ERRO_DO_LOG_REPETIDO_S = 1800;
export const ERROS_DO_LOG_POR_HORA = 10;

/**
 * A conta que a nuvem mandou e não entra vira alerta depois de 5 min e 3 tentativas (um por sequência): o agente grava
 * um erro com o motivo troca_falhou e os ids das contas, e a nuvem escreve e manda o alerta pelos canais (0023).
 */
export const TROCA_FALHOU_APOS_S = 300;
export const TROCA_FALHOU_TENTATIVAS = 3;

export class Agente {
  estado: EstadoLocal;
  trocador: Trocador;
  contador: Contador;
  logins: Logins;
  posse: PosseCofre | null = null;
  cred: Credenciais;
  cj: ClaudeJson;
  chave: Buffer | null = null;
  online: boolean | null = null;
  ultimaFalhaNuvem: string | null = null;
  ponte: Server | null = null;
  private parado = false;
  private emCiclo = false;
  private emBusca = false;
  private emRegistro = false;
  private aviso: string | null = null;
  private semLivre: string | null = null;
  private pastasEm = 0;
  private comandosVistos = new Set<number>();
  private usoEnviado = "";
  private usoEnviadoEm = 0;
  private historicoEnviado = new Map<string, number>();
  private diagnosticoEm = 0;
  /**
   * O diagnóstico que um comando do painel acabou de rodar (Rodar agora ou Corrigir): vai no próximo agente_ola, para o
   * guardado na nuvem (que o cartão do computador mostra) ficar igual ao que o painel acabou de ver.
   */
  private diagnosticoParaMandar: Record<string, unknown> | null = null;
  private sombraAtribuicao = "";
  private ligacaoAvisada = false;
  /** A janela de liberar computador novo aberta agora (só uma por vez); `anulada` quando outro pedido chegou junto. */
  private janelaLigacao: { chave: string; anulada: boolean } | null = null;
  /** Pedidos que já abriram janela aqui (o painel escolher de novo abre de novo: muda o aprovador_em). */
  private janelasAbertas = new Set<string>();
  private semTelaAvisado = new Set<string>();
  private falhaAtribuicao = new Map<string, number>();
  /** A conta atribuída que não está entrando: desde quando, quantas tentativas e se já virou alerta. */
  private trocaQueNaoSai: { conta: string; desde: number; vezes: number; avisado: boolean } | null = null;
  private emFundo = new Set<Promise<unknown>>();
  private possesLimpas = false;
  private impressaoConferida = false;
  private chaveDaInstalacao: boolean | null = null;
  private chaveLidaEm = 0;
  private registroTentado = new Map<string, number>();
  /** Quanto levou a última conversa com a nuvem (o painel mostra em Saúde). */
  ultimaBuscaMs: number | null = null;
  /** A última atribuição que a nuvem mandou (o conserto da credencial põe esta conta). */
  ultimaAtribuicao: Atribuicao | null = null;
  /** Quando o agente subiu (a conta que a nuvem manda chega na primeira busca). */
  private iniciadoEm = 0;
  /** A versão mais nova publicada (lida no máximo a cada 6 h) e quando foi lida. */
  versaoNova: string | null = null;
  private versaoNovaLidaEm = 0;
  /** A configuração da instalação que veio no último agente_ola (atualizar_sozinho, fuso...). */
  private configNuvem: Record<string, unknown> = {};
  private vezPedidaEm = 0;
  private sozinhoNaoComecouEm = 0;
  private motivoSemVez: string | null = null;
  /** A versão nova que a trava recusou (o agente espera a nuvem ter as migrações dela); o painel mostra. */
  travaNuvem: TravaNuvem | null = null;
  /** Versão da trava que já virou evento (um por versão, não um a cada conferência). */
  private travaAvisada: string | null = null;
  /** A versão cujas funções e painel este computador está publicando agora (atualização completa). */
  publicando: string | null = null;
  private publicacaoPedidaEm = 0;
  private motivoSemPublicar: string | null = null;
  /** O fim de uma publicação que a nuvem ainda não recebeu (sem rede na hora): vai na busca seguinte. */
  private publicacaoAContar: { para: string; estado: "concluida" | "falhou"; motivo: string | null } | null = null;
  /** O que a nuvem já sabe de cada conta sobre precisar de login (e quando foi a última tentativa recusada). */
  private loginInformado = new Map<string, boolean>();
  private loginTentado = new Map<string, number>();
  /** Sessões que já avisaram "Prompt is too long" (uma vez a cada 10 min por sessão). */
  private errosAvisados = new Map<string, number>();
  /** Erros do log que já subiram (chave sem números) e quando, para não repetir; e os da última hora. */
  private errosDoLog = new Map<string, number>();
  private errosDoLogNaHora: number[] = [];

  constructor(private d: Dependencias) {
    this.estado = carregarEstado(d.c.estado);
    this.cred = d.sombra ? new CredenciaisSombra(d.cred, d.log) : d.cred;
    this.cj = new ClaudeJson(d.relogio, d.sombra, d.log);
    this.trocador = new Trocador(this.estado, this.cred, d.api, d.cli, this.cj, d.c, d.relogio, d.log, {
      podeRenovar: (id) => !d.sombra && (!d.nuvem || !!this.posse?.temPosse(id)),
      aoConectar: (id) => this.fundo(this.registrarNaNuvem(id)),
      aoEvento: (tipo, texto, dados) => {
        // A nuvem gera os próprios alertas; daqui vai o resto (alerta local chega lá como aviso).
        const t = tipo === "alerta" ? "aviso" : tipo;
        if (d.nuvem && !d.sombra && tipo !== "info" && TIPOS_EVENTO_NUVEM.has(t)) void d.nuvem.evento(t, texto, dados).catch(() => undefined);
        if (tipo === "troca") {
          this.somDaTroca(); // em sombra o trocador não troca, então não chega aqui
          this.aplicarResumo();
          this.aplicarModelo(true);
        }
      },
      aoRenovarPrincipal: () => {
        if (this.posse) this.posse.subirAtiva = true;
      },
    }, () => this.salvar());
    this.trocador.sombra = d.sombra;
    this.contador = new Contador(d.c.registro, d.c.projetos, (ts) => this.trocador.contaEm(ts), () => d.relogio.agora());
    this.logins = new Logins(this.trocador, this.cred, d.cli, d.relogio, (login, id) => this.loginTerminou(login, id));
    if (d.nuvem) {
      this.posse = new PosseCofre(() => this.estado, this.trocador, this.cred, d.nuvem, () => this.chave, this.cj, d.relogio, d.log, () =>
        this.salvar(),
      );
      this.posse.semEscrita = () => (this.chaveDaInstalacao === false ? "a chave do cofre deste computador não é a da instalação" : null);
    }
  }

  /** Trabalho que roda solto (registro na nuvem, avisos): guardado para os testes e o desligamento esperarem. */
  fundo(p: Promise<unknown>): void {
    const q = p.catch((e) => this.d.log.erro(`tarefa: ${(e as Error).message}`)).finally(() => this.emFundo.delete(q));
    this.emFundo.add(q);
  }

  async esperar(): Promise<void> {
    while (this.emFundo.size) await Promise.all([...this.emFundo]);
  }

  get comNuvem(): boolean {
    return !!this.d.nuvem;
  }

  /**
   * O resumo da conversa acompanha a conta em uso: perto de `config.resumo` tokens nas que não são 20x, o automático do
   * Claude Code nas de 20x (resumo.ts). Em modo sombra não mexe em nada.
   */
  aplicarResumo(): void {
    if (this.d.sombra) return;
    const conta = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
    const desejado = janelaDaConta(conta, this.estado.config.resumo ?? false);
    const antes = this.estado.resumoEscrito ?? null;
    try {
      const r = aplicarResumo(path.join(this.d.c.principalDir, "settings.json"), desejado, antes);
      if (r.daPessoa && antes !== null) this.d.log.info("resumo da conversa: o autoCompactWindow do assistente de código foi mudado à mão; o agente não mexe mais nele");
      if (r.mudou) this.d.log.info(`resumo da conversa: ${desejado === null ? "automático do assistente de código" : `perto de ${Math.round(desejado / 1000)} mil tokens`}${conta ? ` (${conta.email})` : ""}`);
      if (r.escrito !== antes) {
        this.estado.resumoEscrito = r.escrito;
        this.salvar();
      }
    } catch (e) {
      this.d.log.erro(`resumo da conversa: ${(e as Error).message}`);
    }
  }

  /**
   * O modelo do Claude Code acompanha a conta em uso: o que o painel escolheu para ela (modelo.ts). `forcar` na troca de
   * conta e quando o painel muda o modelo da conta em uso; fora disso, um modelo que a pessoa escolheu fica. Conta de que
   * a nuvem ainda não disse o modelo: não mexe. Em modo sombra não mexe em nada.
   */
  aplicarModelo(forcar: boolean): void {
    if (this.d.sombra) return;
    const conta = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
    const modelos = this.estado.modelos ?? {};
    if (!conta?.contaId || !(conta.contaId in modelos)) return;
    const desejado = modelos[conta.contaId] ?? null;
    const escrito = this.estado.modeloEscrito ?? null;
    const original = this.estado.modeloOriginal ?? null;
    try {
      const r = aplicarModelo(path.join(this.d.c.principalDir, "settings.json"), desejado, escrito, original, forcar);
      if (r.daPessoa && escrito !== null) this.d.log.info("modelo: o model do assistente de código foi mudado à mão; o agente só volta a mexer na próxima troca de conta");
      if (r.mudou) this.d.log.info(`modelo: ${desejado ?? (original === null ? "o padrão do assistente de código" : `de volta a ${original}`)} (${conta.email})`);
      if (r.escrito !== escrito || r.original !== original) {
        this.estado.modeloEscrito = r.escrito;
        this.estado.modeloOriginal = r.original;
        this.salvar();
      }
    } catch (e) {
      this.d.log.erro(`modelo: ${(e as Error).message}`);
    }
  }

  /**
   * O que a nuvem disse da conta atribuída e deste computador: o modelo da conta (anotado antes da troca, que o lê) e a
   * saída enxuta. Modelo que mudou na conta em uso vale na hora.
   */
  private anotarDaNuvem(a: Atribuicao | null, enxugar: boolean): void {
    if (this.estado.enxugar !== enxugar) {
      this.estado.enxugar = enxugar;
      this.d.log.info(`saída enxuta ${enxugar ? "ligada" : "desligada"} neste computador`);
      this.salvar();
    }
    if (!a?.conta_id || a.modelo === undefined) return;
    const modelos = (this.estado.modelos ??= {});
    if (a.conta_id in modelos && modelos[a.conta_id] === a.modelo) return;
    modelos[a.conta_id] = a.modelo;
    this.salvar();
    const ativa = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
    if (ativa?.contaId === a.conta_id) this.aplicarModelo(true);
  }

  /** Toca o som de troca, se estiver ligado. Solto: a troca não espera o som. */
  somDaTroca(forcar = false): Promise<boolean> {
    if (!this.d.exec || (!forcar && this.estado.config.som === false)) return Promise.resolve(false);
    return tocarSom(this.d.exec, this.d.sistema).then(
      (ok) => {
        if (!ok) this.d.log.info("som da troca: nenhum tocador de som neste sistema");
        return ok;
      },
      () => false,
    );
  }

  salvar(): void {
    try {
      salvarEstado(this.d.c.estado, this.estado);
    } catch (e) {
      this.d.log.erro(`não consegui salvar o estado: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------ partida

  async iniciar(opcoes: { laços?: boolean; ponte?: boolean } = {}): Promise<void> {
    fs.mkdirSync(this.d.c.contas, { recursive: true, mode: 0o700 });
    this.iniciadoEm = this.d.relogio.agora();
    const k = await this.d.guarda.ler(SEGREDO_COFRE).catch(() => null);
    this.chave = k ? Buffer.from(k, "base64") : null;
    if (this.chave && this.chave.length !== 32) this.chave = null;
    this.d.log.info(`agente ${VERSAO} ${this.d.sombra ? "em modo sombra " : ""}${this.comNuvem ? "com nuvem" : "sem nuvem"}`);
    if (opcoes.ponte !== false) await this.abrirPonte();
    this.aplicarResumo();
    this.aplicarModelo(false);
    if (opcoes.laços === false) return;
    this.laco(() => this.ciclo(), CICLO_S * 1000);
    if (this.comNuvem) this.laco(() => this.busca(), () => Math.max(2, Math.min(60, this.estado.config.intervaloS || 5)) * 1000);
    this.laco(() => this.registro(), 60_000);
  }

  parar(): void {
    this.parado = true;
    this.logins.encerrar();
    this.ponte?.close();
  }

  private laco(fn: () => Promise<void>, intervalo: number | (() => number)): void {
    const proximo = () => (typeof intervalo === "number" ? intervalo : intervalo());
    const rodar = async () => {
      if (this.parado) return;
      try {
        await fn();
      } catch (e) {
        this.d.log.erro(`laço: ${(e as Error).message}`);
      }
      if (!this.parado) this.d.relogio.agendar(() => void rodar(), proximo());
    };
    this.d.relogio.agendar(() => void rodar(), 10);
  }

  private abrirPonte(): Promise<void> {
    return new Promise((resolve) => {
      const s = criarPonte(this.alvoPonte(), this.d.porta, chaveDaPonte(this.d.c.ponteChave));
      s.on("error", (e: NodeJS.ErrnoException) => {
        this.d.log.erro(`ponte local não abriu na porta ${this.d.porta}: ${e.code ?? e.message}`);
        resolve();
        // outro programa na porta: tenta de novo daqui a pouco (a chave não vaza: quem pede manda só a prova dela)
        if (!this.ponte && !this.parado) this.d.relogio.agendar(() => void this.abrirPonte(), 15_000);
      });
      s.listen(this.d.porta, "127.0.0.1", () => {
        this.ponte = s;
        resolve();
      });
    });
  }

  // ------------------------------------------------------------------------------------------------ ciclo local

  async ciclo(): Promise<void> {
    if (this.emCiclo) return;
    this.emCiclo = true;
    try {
      const pendentes = await this.trocador.geral.com(async () => {
        const t = this.d.relogio.agora();
        if (t - this.pastasEm >= 60) {
          this.pastasEm = t;
          await this.trocador.arrumarPastas(this.logins.pastas());
        }
        this.trocador.registrarHistorico(t);
        if (!this.comNuvem && this.estado.config.modo === "rodizio" && !this.estado.proximoRodizioEm) {
          agendarRodizio(this.estado, t, this.d.aleatorio);
        }
        const ativa = await this.trocador.conferirPrincipalDentro();
        const lista: string[] = [];
        // Na sombra, outro gestor já lê as mesmas contas: ler 5 vezes menos não dobra o pedido no serviço de uso.
        const fator = this.d.sombra ? FATOR_LEITURA_SOMBRA : 1;
        for (const [id, c] of Object.entries(this.estado.contas)) {
          const ultima = this.trocador.ultimaLeitura[id] ?? 0;
          if (id === ativa) {
            const fresca = c.fonte === "sessao" && t - (c.lidoEm ?? 0) < MEDIDA_FRESCA_S;
            // Perto do gatilho a leitura não espera: agentes em paralelo gastam vários pontos por minuto, e a troca
            // precisa acontecer antes de a conta esgotar (11/10/2026: a conta foi de 95% a 100% entre duas leituras).
            const pct = pctEfetivo(c, t) ?? 0;
            const perto = pct >= Math.min(this.estado.config.aviso, gatilhoDeTroca(this.estado) - 10);
            if (perto ? t - ultima >= LER_ATIVA_PERTO_S * fator : !fresca && t - ultima >= LER_ATIVA_S * fator) lista.push(id);
          } else if (!c.pausada && t - ultima >= LER_ESTACIONADA_S * fator) lista.push(id);
        }
        return lista;
      });
      for (const id of pendentes) await this.lerUsoConta(id);
      if (!this.comNuvem || this.d.sombra) await this.agir();
      this.salvar();
    } finally {
      this.emCiclo = false;
    }
  }

  /**
   * Lê o uso de uma conta. Com nuvem, conta parada só é lida com a posse (curta): a nuvem só aceita o número de quem
   * tem a conta em mãos, e só quem tem a posse renova. Sem posse (a conta está com outro computador), quem lê é ele.
   */
  async lerUsoConta(id: string, forcar = false): Promise<void> {
    const c = this.estado.contas[id];
    if (!c) return;
    if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId) return this.trocador.lerUso(id, forcar);
    if (this.posse.temPosse(id)) {
      await this.trocador.lerUso(id, forcar);
      return this.relatarUso(true).catch(() => undefined);
    }
    if (!this.online) return;
    const blob = await this.cred.ler(c.pasta);
    const motivo = blob && expiraEm(blob) > this.d.relogio.agora() + VENCIDO_EM_S + 60 ? "leitura" : "renovacao";
    const r = await this.posse
      .com(id, motivo, async () => {
        await this.trocador.lerUso(id, true);
        await this.relatarUso(true);
        return true;
      })
      .catch((e) => {
        this.d.log.erro(`leitura de ${c.email} com posse: ${(e as Error).message}`);
        return null;
      });
    if (r === null) this.trocador.ultimaLeitura[id] = this.d.relogio.agora();
  }

  /**
   * Decisão local: sem nuvem, é ela que troca; no modo sombra roda sempre (com a configuração local, que a importação
   * traz do roteador antigo) para o log dizer o que o agente faria.
   */
  async agir(limite = false): Promise<void> {
    if (this.comNuvem && !this.d.sombra) return;
    await this.trocador.geral.com(async () => {
      const t = this.d.relogio.agora();
      const [acao, alvo] = decidir(this.estado, t, limite, this.d.sorteio ?? sorteioReal);
      const ativa = this.estado.ativa;
      if (acao === "aviso") {
        this.estado.proxima = alvo;
        const chave = `${ativa}>${alvo}`;
        if (this.aviso !== chave && ativa) {
          this.aviso = chave;
          const p = pctEfetivo(this.estado.contas[ativa]!, t) ?? 0;
          const prox = alvo ? this.estado.contas[alvo]!.email : "nenhuma livre";
          this.trocador.evento("aviso", `${this.estado.contas[ativa]!.email} chegou a ${p.toFixed(0)}%. Próxima: ${prox}.`);
          for (const id of Object.keys(this.estado.contas)) {
            const fator = this.d.sombra ? FATOR_LEITURA_SOMBRA : 1;
            if (id !== ativa && t - (this.trocador.ultimaLeitura[id] ?? 0) > LER_ESTACIONADA_AVISO_S * fator) await this.trocador.lerUso(id);
          }
        }
      } else if (acao === "trocar" || acao === "rodizio") {
        const motivo =
          acao === "rodizio" ? "rodízio" : limite ? "a sessão bateu o limite" : `chegou a ${gatilhoDeTroca(this.estado).toFixed(0)}%`;
        const r = await this.trocador.trocarDentro(alvo, motivo);
        if (r.ok) {
          this.aviso = null;
          this.retomarHeadless();
        }
        agendarRodizio(this.estado, t, this.d.aleatorio);
      } else if (acao === "reagendar") {
        agendarRodizio(this.estado, t, this.d.aleatorio);
        this.trocador.evento("info", "Rodízio: nenhuma outra conta livre agora; tento de novo mais tarde.");
      } else if (acao === "sem_livre") {
        this.estado.proxima = null;
        if (this.semLivre !== ativa) {
          this.semLivre = ativa;
          this.trocador.evento("erro", "Nenhuma conta livre para trocar; as sessões esperam o reset.");
        }
      } else {
        this.estado.proxima = this.estado.ativa ? candidata(this.estado, t) : null;
        this.semLivre = null;
      }
      this.salvar();
    });
  }

  retomarHeadless(): void {
    if (!this.estado.config.retomarHeadless) return;
    const t = this.d.relogio.agora();
    for (const f of this.estado.fila) {
      if (f.tipo !== "headless" || f.estado !== "aguardando") continue;
      // entrada velha (de antes de ligar a opção, ou importada) não volta a rodar sozinha
      if (t - f.em > FILA_VALIDA_S) {
        f.estado = "descartada";
        continue;
      }
      const cwd = this.retomar(f.sessao);
      f.estado = cwd ? "retomada" : "descartada";
      if (cwd) this.trocador.evento("retomada", `Retomei a sessão de terminal ${f.sessao.slice(0, 8)} em ${path.basename(cwd)}.`, { sessao: f.sessao });
    }
  }

  /**
   * Retoma a sessão na pasta em que ela rodou, lida da transcrição que o próprio assistente gravou: a pasta que veio
   * pela ponte local não vale (qualquer programa do computador fala com a ponte). Devolve a pasta, ou null.
   */
  private retomar(sessao: string): string | null {
    const cwd = cwdDaSessao(this.d.c.projetos, sessao);
    if (!cwd || !fs.existsSync(cwd)) {
      this.d.log.erro(`sessão ${sessao.slice(0, 8)}: não achei a transcrição dela; não retomo`);
      return null;
    }
    if (this.d.sombra) {
      this.d.log.faria(`retomar a sessão ${sessao.slice(0, 8)}`);
      return cwd;
    }
    fs.mkdirSync(this.d.c.logs, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(path.join(this.d.c.logs, `retomada-${sessao.slice(0, 40)}.log`), "a", 0o600);
    try {
      this.d.cli.retomar(sessao, cwd, "A conta anterior bateu o limite de uso e o Reveza trocou de conta. Continue a tarefa de onde parou.", fd);
    } finally {
      fs.closeSync(fd);
    }
    return cwd;
  }

  // ------------------------------------------------------------------------------------------------ nuvem

  /**
   * A chave deste computador é a da instalação? A primeira chave registra a impressão. Confere a cada busca (a impressão
   * vem na configuração): com outra chave, este computador não responde a pedido de ligação (passaria adiante uma chave
   * que divide o cofre) e não cifra login nenhum para o cofre (quem trocou a impressão no banco leria o que ele mandasse).
   */
  private async conferirImpressao(nuvem: Nuvem, config: Record<string, unknown> | null | undefined): Promise<void> {
    if (!this.chave) return;
    const minha = impressaoDaChave(this.chave);
    let daNuvem = typeof config?.cofre_impressao === "string" ? config.cofre_impressao : null;
    if (!daNuvem && !this.impressaoConferida) daNuvem = await nuvem.cofreImpressao(minha).catch(() => null);
    if (!daNuvem) return;
    this.impressaoConferida = true;
    const antes = this.chaveDaInstalacao;
    this.chaveDaInstalacao = daNuvem === minha;
    if (!this.chaveDaInstalacao && antes !== false) {
      this.trocador.evento(
        "erro",
        "A chave do cofre deste computador não é a da instalação (a impressão na nuvem é outra): este computador parou de mandar login para o cofre. Se você não religou a instalação, alguém mexeu direto no banco; confira e ligue este computador de novo com `reveza ligar`.",
        { motivo: "impressao_diferente" },
      );
    }
  }

  /** A chave do cofre pode chegar depois de o agente ligar (`reveza ligar` roda em outro processo). */
  private async recarregarChave(): Promise<void> {
    if (this.chave || this.d.relogio.agora() - this.chaveLidaEm < 60) return;
    this.chaveLidaEm = this.d.relogio.agora();
    const k = await this.d.guarda.ler(SEGREDO_COFRE).catch(() => null);
    const b = k ? Buffer.from(k, "base64") : null;
    if (b && b.length === 32) {
      this.chave = b;
      this.d.log.info("chave do cofre carregada");
    }
  }

  async busca(): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse || this.emBusca) return;
    this.emBusca = true;
    try {
      await this.recarregarChave();
      if (!this.estado.nuvem.computadorId) {
        const r = await nuvem.registrar(os.hostname().slice(0, 60), this.d.sistema, VERSAO);
        this.estado.nuvem.computadorId = r.computador_id;
        this.salvar();
      }
      let diagnostico: Record<string, unknown> | null = null;
      const pendente = this.diagnosticoParaMandar;
      if (pendente) {
        diagnostico = pendente;
        this.diagnosticoEm = this.d.relogio.agora();
      } else if (this.d.diagnostico && this.d.relogio.agora() - this.diagnosticoEm > 600) {
        this.diagnosticoEm = this.d.relogio.agora();
        diagnostico = await this.d.diagnostico().catch(() => null);
      }
      const ativa = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
      const inicio = Date.now();
      const r = await nuvem.ola(VERSAO, diagnostico, ativa?.email ?? null);
      this.ultimaBuscaMs = Date.now() - inicio;
      // só sai da fila depois de a nuvem receber (sem rede, vai na busca seguinte)
      if (pendente && this.diagnosticoParaMandar === pendente) this.diagnosticoParaMandar = null;
      if (r.computador_id && r.computador_id !== this.estado.nuvem.computadorId) this.estado.nuvem.computadorId = r.computador_id;
      if (this.online === false) this.d.log.info("nuvem de volta");
      this.online = true;
      this.ultimaFalhaNuvem = null;
      this.configNuvem = r.config ?? {};
      await this.vigiarAtualizacao();
      this.fundo(this.conferirVersaoNova());
      // a ordem: a nuvem já está na versão nova; funções e painel (atualização completa) antes do programa daqui
      await this.talvezPublicar();
      await this.talvezAtualizarSozinho();
      if (!this.d.sombra) this.aplicarConfig(r.config);
      await this.conferirImpressao(nuvem, r.config);
      this.estado.nuvem.atribuicaoConta = r.atribuicao?.conta_id ?? null;
      this.ultimaAtribuicao = r.atribuicao?.conta_id ? r.atribuicao : null;
      if (r.ligacao_pendente && !this.ligacaoAvisada) {
        this.ligacaoAvisada = true;
        this.d.log.info("há uma frase de emergência aberta (6 palavras, válida por 10 minutos)");
      } else if (!r.ligacao_pendente) this.ligacaoAvisada = false;
      if (!this.d.sombra) {
        if (!this.possesLimpas) await this.limparPossesAntigas();
        await this.registrarPendentes();
        await this.informarLogins();
        await this.garantirPosseDaAtiva();
        await this.posse.processarSaidas();
        await this.posse.subirAtivaSePreciso();
      }
      if (!this.d.sombra) this.anotarDaNuvem(r.atribuicao, r.enxugar === true);
      if (r.atribuicao) await this.aplicarAtribuicao(r.atribuicao);
      for (const cmd of r.comandos) await this.comando(cmd.id);
      await this.vigiarLigacoes(r.ligacoes ?? []);
      await this.relatarUso();
    } catch (e) {
      const msg = (e as Error).message;
      if (this.online !== false || this.ultimaFalhaNuvem !== msg) this.d.log.erro(`nuvem: ${msg}; mantenho a conta atual e tento de novo`);
      this.online = e instanceof ErroNuvem && !e.semRede ? true : false;
      this.ultimaFalhaNuvem = msg;
    } finally {
      this.emBusca = false;
    }
  }

  aplicarConfig(cfg: Record<string, unknown>): void {
    const k = this.estado.config;
    const num = (v: unknown, min: number, max: number) => (typeof v === "number" && v >= min && v <= max ? v : null);
    if (typeof cfg.auto === "boolean") k.auto = cfg.auto;
    if (cfg.modo === "limite" || cfg.modo === "limiar" || cfg.modo === "rodizio") k.modo = cfg.modo as Modo;
    k.aviso = num(cfg.aviso, 1, 100) ?? k.aviso;
    k.troca = num(cfg.troca, 1, 100) ?? k.troca;
    k.intervaloS = num(cfg.intervalo_s, 2, 60) ?? k.intervaloS;
    k.esperaEntreTrocasS = num(cfg.espera_entre_trocas_s, 0, 3600) ?? k.esperaEntreTrocasS;
    k.rodizio.minutos = num(cfg.rodizio_minutos, 15, 480) ?? k.rodizio.minutos;
    if (cfg.rodizio_ordem === "aleatoria" || cfg.rodizio_ordem === "menor_uso") k.rodizio.ordem = cfg.rodizio_ordem;
    if (typeof cfg.retomar_terminal === "boolean") k.retomarHeadless = cfg.retomar_terminal;
  }

  /**
   * Primeira conversa com a nuvem depois de ligar: posse que ficou de antes (o agente caiu com uma conta parada na
   * mão) volta ao cofre com a cópia daqui e é solta; senão a nuvem renovaria essa posse para sempre a cada busca.
   */
  private async limparPossesAntigas(): Promise<void> {
    this.possesLimpas = true;
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId || c.id === this.estado.ativa || this.posse!.temPosse(c.id)) continue;
      this.posse!.posses.set(c.id, "renovacao");
      await this.posse!.devolver(c.id, { silencioso: true }).catch(() => false);
      await this.posse!.soltar(c.id).catch(() => undefined);
      this.posse!.posses.delete(c.id);
    }
  }

  /** Conta com login aqui e ainda fora da nuvem (a nuvem estava fora quando ela apareceu): tenta de 5 em 5 min. */
  private async registrarPendentes(): Promise<void> {
    if (!this.chave) return;
    const t = this.d.relogio.agora();
    for (const c of Object.values(this.estado.contas)) {
      if (c.contaId || c.precisaLogin || t - (this.registroTentado.get(c.id) ?? 0) < 300) continue;
      this.registroTentado.set(c.id, t);
      await this.registrarNaNuvem(c.id);
    }
  }

  /**
   * Conta que perdeu o login aqui (ou voltou a ter) avisa a nuvem, para o decidir() não mandá-la de novo a este ou a
   * outro computador. A nuvem só aceita para conta na mão; recusada, tenta de novo em 5 min.
   */
  private async informarLogins(): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse) return;
    const t = this.d.relogio.agora();
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId) continue;
      const sabido = this.loginInformado.get(c.id);
      const naMao = this.posse!.temPosse(c.id) || this.estado.nuvem.atribuicaoConta === c.contaId;
      if (sabido === c.precisaLogin || (sabido === undefined && !c.precisaLogin && !naMao)) continue;
      if (t - (this.loginTentado.get(c.id) ?? 0) < 300) continue;
      const r = await nuvem.marcarLogin(c.contaId, c.precisaLogin).catch(() => ({ ok: false }));
      if (r.ok) {
        this.loginInformado.set(c.id, c.precisaLogin);
        this.loginTentado.delete(c.id);
      } else this.loginTentado.set(c.id, t);
    }
  }

  /**
   * Desligamento do serviço: a conta em uso sobe ao cofre (se outro computador assumir, pega um login válido) e as
   * contas paradas que estão na mão voltam e são soltas. A posse de uso fica e vence sozinha em 2 min.
   */
  async desligar(prazoMs = 8000): Promise<void> {
    const trabalho = (async () => {
      if (!this.posse || this.d.sombra || this.online === false) return;
      for (const [id] of [...this.posse.posses]) {
        await this.posse.devolver(id).catch(() => false);
        if (id !== this.estado.ativa) await this.posse.soltar(id).catch(() => undefined);
      }
    })();
    await Promise.race([trabalho, new Promise((r) => this.d.relogio.agendar(() => r(undefined), prazoMs))]);
    this.salvar();
    this.parar();
  }

  /** A conta em uso precisa estar com a posse deste computador. */
  private async garantirPosseDaAtiva(): Promise<void> {
    const ativa = this.estado.ativa;
    const c = ativa ? this.estado.contas[ativa] : null;
    if (!ativa || !c?.contaId || this.posse!.posses.get(ativa) === "uso") return;
    // A nuvem só dá posse de uso da conta que ela atribuiu a este computador; se atribuiu outra, a troca vem já.
    if (this.estado.nuvem.atribuicaoConta && this.estado.nuvem.atribuicaoConta !== c.contaId) return;
    const r = await this.posse!.pegar(ativa, "uso");
    if (r.ok) this.posse!.posses.set(ativa, "uso");
    else if (this.semLivre !== `posse:${ativa}`) {
      this.semLivre = `posse:${ativa}`;
      this.trocador.evento("alerta", `${c.email} está em uso aqui, mas a nuvem não deu a posse (${r.erro ?? "sem motivo"}).`, { conta: ativa });
    }
  }

  /**
   * Aplica a conta que a nuvem atribuiu. `principalSemConta` (o conserto da credencial): o assistente está sem login,
   * então a conta entra mesmo sendo a que já consta em uso, com a cópia mais nova do cofre, e sem a espera de 1 min.
   */
  async aplicarAtribuicao(a: Atribuicao, principalSemConta = false): Promise<{ ok: boolean; erro?: string }> {
    if (!a.conta_id) return { ok: false, erro: "a nuvem não atribuiu conta" };
    this.estado.nuvem.atribuicaoConta = a.conta_id;
    const destino = this.posse!.porContaId(a.conta_id);
    const ativa = this.estado.ativa;
    if (destino && destino === ativa && !principalSemConta) {
      this.estado.nuvem.atribuicaoVersao = Math.max(this.estado.nuvem.atribuicaoVersao, a.versao);
      this.estado.nuvem.atribuicaoConta = a.conta_id;
      this.trocaQueNaoSai = null;
      return { ok: true };
    }
    if (this.d.sombra) {
      const chave = `${a.conta_id}#${a.versao}`;
      if (this.sombraAtribuicao !== chave) {
        this.sombraAtribuicao = chave;
        const email = destino ? this.estado.contas[destino]!.email : a.conta_id;
        this.d.log.faria(`pegar a posse e trocar para ${email} (${a.motivo || "atribuição da nuvem"})`);
      }
      return { ok: false, erro: "modo sombra: o agente não troca" };
    }
    const chave = `${a.conta_id}#${a.versao}`;
    if (!principalSemConta && (this.falhaAtribuicao.get(chave) ?? 0) > this.d.relogio.agora()) return { ok: false, erro: "tento de novo em 1 minuto" };
    const nuvem = this.d.nuvem!;
    const r = await nuvem.pegarPosse(a.conta_id, "uso", POSSE_S);
    if (!r.ok) {
      this.d.log.info(`a conta atribuída (${a.email ?? a.conta_id}) não veio: ${r.erro ?? "sem motivo"}; espero a nuvem`);
      return this.falhouAtribuir(a, principalSemConta, `a nuvem não entregou a conta atribuída (${r.erro ?? "sem motivo"})`);
    }
    let id = destino;
    if (!id) {
      id = await this.posse!.materializar(a.conta_id, a.email, r.cofre, (pasta) => this.d.cli.renovar(pasta, 0));
      if (!id) {
        await nuvem.soltarPosse(a.conta_id).catch(() => undefined);
        return this.falhouAtribuir(a, principalSemConta, this.chave
          ? "o login da conta atribuída não abriu do cofre: entre de novo nela pelo painel (Contas, Entrar de novo)"
          : "este computador não tem a chave do cofre: ligue-o pelo painel (Computadores, Ligar computador novo) ou com reveza ligar");
      }
    } else {
      await this.posse!.sincronizar(id, r.cofre, principalSemConta);
    }
    const ja = this.posse!.posses.get(id);
    this.posse!.posses.set(id, "uso");
    const res = await this.trocador.trocar(id, a.motivo || "decisão da nuvem");
    if (!res.ok) {
      // Não trocou (conta sem login guardado, rede fora na hora de identificar a principal...): solta a conta e
      // tenta de novo em 1 min, sem martelar a cada busca.
      this.falhaAtribuicao.set(chave, this.d.relogio.agora() + 60);
      if (ja !== "uso") {
        await this.posse!.devolver(id).catch(() => false);
        await this.posse!.soltar(id).catch(() => undefined);
      }
      return this.falhouAtribuir(a, principalSemConta, res.erro);
    }
    this.falhaAtribuicao.delete(chave);
    this.trocaQueNaoSai = null;
    this.estado.nuvem.atribuicaoVersao = a.versao;
    this.estado.nuvem.atribuicaoConta = a.conta_id;
    if (res.de && res.de !== id && this.estado.contas[res.de]?.contaId) {
      // A que saiu volta ao cofre depois da conferência da troca (5 s, até 3 refeitas).
      this.posse!.soltarDepois.set(res.de, this.d.relogio.agora() + 20);
    }
    this.retomarHeadless();
    this.salvar();
    return { ok: true };
  }

  /**
   * Mais uma tentativa de pôr a conta atribuída que não deu certo. Com TROCA_FALHOU_TENTATIVAS tentativas em
   * TROCA_FALHOU_APOS_S, vira o erro com o motivo troca_falhou que a nuvem transforma em alerta. Um por sequência:
   * volta a avisar depois que uma troca firmar ou a nuvem mandar outra conta. O conserto da credencial não conta (o
   * painel já mostra o erro a quem pediu).
   */
  private falhouAtribuir(a: Atribuicao, principalSemConta: boolean, erro: string | undefined): { ok: false; erro?: string } {
    if (principalSemConta || !a.conta_id) return { ok: false, erro };
    const agora = this.d.relogio.agora();
    if (this.trocaQueNaoSai?.conta !== a.conta_id) this.trocaQueNaoSai = { conta: a.conta_id, desde: agora, vezes: 0, avisado: false };
    const s = this.trocaQueNaoSai;
    s.vezes++;
    if (s.avisado || s.vezes < TROCA_FALHOU_TENTATIVAS || agora - s.desde < TROCA_FALHOU_APOS_S) return { ok: false, erro };
    s.avisado = true;
    const destino = this.posse?.porContaId(a.conta_id);
    const email = a.email ?? (destino ? this.estado.contas[destino]?.email : null) ?? a.conta_id;
    const ativa = this.estado.ativa;
    this.trocador.evento("erro",
      `A troca para ${email} não firmou em ${Math.round((agora - s.desde) / 60)} min (${s.vezes} tentativas): ${erro ?? "sem motivo"}.`,
      { motivo: "troca_falhou", de: ativa ? this.estado.contas[ativa]?.contaId ?? null : null, para: a.conta_id });
    return { ok: false, erro };
  }

  // ------------------------------------------------------------------------------------------------ atualização

  private arquivoAtualizacao(): string {
    return path.join(this.d.c.base, "atualizacao.json");
  }

  /**
   * Erro escrito no log do agente (disco cheio, cofre recusando, arquivo que não se grava) vai ao painel como evento,
   * para quem acompanha de longe ver na hora. O mesmo erro sobe uma vez a cada 30 min, e no máximo 10 por hora.
   * O que já é evento (linha "[erro] ...", escrita pelo trocador) já subiu pelo aoEvento.
   */
  erroDoLog(texto: string): void {
    if (!this.d.nuvem || this.d.sombra || texto.startsWith("[")) return;
    const t = this.d.relogio.agora();
    const home = this.d.c.home;
    const limpo = (home && home.length > 1 ? texto.split(home).join("~") : texto).slice(0, 280);
    const chave = limpo.replace(/[0-9a-f]{6,}|\d+/gi, "#");
    const ultimo = this.errosDoLog.get(chave);
    if (ultimo !== undefined && t - ultimo < ERRO_DO_LOG_REPETIDO_S) return;
    this.errosDoLogNaHora = this.errosDoLogNaHora.filter((e) => t - e < 3600);
    if (this.errosDoLogNaHora.length >= ERROS_DO_LOG_POR_HORA) return;
    this.errosDoLog.set(chave, t);
    if (this.errosDoLog.size > 200) this.errosDoLog.delete(this.errosDoLog.keys().next().value!);
    this.errosDoLogNaHora.push(t);
    void this.d.nuvem.evento("erro", `Erro no agente: ${limpo}`, { log: true }).catch(() => undefined);
  }

  /** Evento local e na nuvem (o "info" não sobe sozinho pelo aoEvento: aqui sobe de propósito). */
  private registrarEvento(tipo: "info" | "erro", texto: string, dados: Record<string, unknown>): void {
    this.trocador.evento(tipo, texto, dados);
    if (tipo === "info" && this.d.nuvem && !this.d.sombra) void this.d.nuvem.evento("info", texto, dados).catch(() => undefined);
  }

  /** A versão mais nova publicada, lida do GitHub oficial no máximo a cada 6 h (guardada para sobreviver ao reinício). */
  async conferirVersaoNova(): Promise<void> {
    if (!this.d.versoes) return;
    const arq = path.join(this.d.c.base, "versoes.json");
    if (!this.versaoNovaLidaEm) {
      const c = lerJson<{ lidoEm?: number; maisNova?: string | null }>(arq);
      if (c && typeof c.lidoEm === "number") {
        this.versaoNovaLidaEm = c.lidoEm;
        this.versaoNova = typeof c.maisNova === "string" ? c.maisNova : null;
      }
    }
    const t = this.d.relogio.agora();
    if (t - this.versaoNovaLidaEm < CONFERIR_VERSAO_S) return;
    this.versaoNovaLidaEm = t; // antes de pedir: falha não vira um pedido por busca
    try {
      this.versaoNova = (await this.d.versoes.publicadas())[0] ?? null;
      gravarJson(arq, { lidoEm: t, maisNova: this.versaoNova });
    } catch (e) {
      this.d.log.erro(`versões publicadas: ${(e as Error).message}`);
    }
  }

  /** A atualização em andamento, se houver (o arquivo é do próprio agente). */
  atualizacaoPendente(): Pendente | null {
    const p = lerJson<Pendente>(this.arquivoAtualizacao());
    return p && typeof p.para === "string" && typeof p.em === "number" ? p : null;
  }

  /**
   * Atualizar sozinho (opção da instalação `atualizar_sozinho`, desligada de fábrica): com versão nova publicada, de
   * madrugada (entre 3h e 5h no fuso da instalação) ou assim que o agente a acha (na conferência de 6 em 6 horas ou no
   * Verificar atualização do painel). Sempre num momento calmo e com a vez da nuvem (um computador por vez: o próximo só
   * quando o anterior voltou na versão nova; se um voltou para a anterior, ninguém mais), pelo mesmo caminho do botão do
   * painel, com a trava de compatibilidade.
   */
  async talvezAtualizarSozinho(): Promise<void> {
    const cfg = this.configNuvem;
    const nuvem = this.d.nuvem;
    const modo = modoAtualizar(cfg.atualizar_sozinho);
    if (modo === "desligada" || !nuvem || this.d.sombra || !this.d.versoes || this.publicando) return;
    const para = this.versaoNova;
    if (!para || compararVersao(para, VERSAO) <= 0) return;
    const t = this.d.relogio.agora();
    if (modo === "madrugada" && !naMadrugada(t, cfg.fuso)) return;
    if (this.atualizacaoPendente() || !this.momentoCalmo()) return;
    // a vez é pedida no máximo a cada 5 minutos; a que nem começou (o pacote não baixou) espera: de madrugada, a noite
    // seguinte; assim que sair, uma hora
    const esperaNaoComecou = modo === "madrugada" ? 12 * 3600 : 3600;
    if (t - this.vezPedidaEm < 300 || t - this.sozinhoNaoComecouEm < esperaNaoComecou) return;
    // versão já recusada pela trava: só pede a vez quando a nuvem tiver as migrações dela (sem baixar o pacote de novo)
    if (this.travaNuvem?.para === para && !(await this.travaLiberou())) return;
    this.vezPedidaEm = t;
    const vez = await nuvem.vezDeAtualizar(VERSAO, para).catch(() => ({ pode: false, motivo: "sem rede" }));
    if (!vez.pode) {
      if (this.motivoSemVez !== vez.motivo) this.d.log.info(`atualizar sozinho para a ${para}: ainda não (${vez.motivo ?? "sem motivo"})`);
      this.motivoSemVez = vez.motivo;
      return;
    }
    const r = await this.atualizarPrograma(para, { comando: null, sozinho: true, modo });
    if (!r.ok) {
      // a trava espera a nuvem (conferida de 5 em 5 minutos); o resto, o tempo de cima
      if (!r.precisaNuvem) this.sozinhoNaoComecouEm = t;
      await nuvem.resultadoAtualizacao(para, "nao_comecou", r.erro).catch(() => undefined);
    }
  }

  /** Nenhuma troca de conta em andamento nem sessão do assistente no limite agora. */
  momentoCalmo(): boolean {
    const t = this.d.relogio.agora();
    if (this.trocador.geral.ocupada || t - (this.estado.trocadaEm || 0) < 300) return false;
    if (this.posse?.soltarDepois.size) return false;
    if (this.estado.fila.some((f) => f.estado === "aguardando" && t - f.em < FILA_VALIDA_S)) return false;
    const ativa = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
    return !ativa || (pctEfetivo(ativa, t) ?? 0) < 100;
  }

  /**
   * Atualiza o programa deste computador para `pedida` (X.Y.Z ou "mais_nova"): só versão publicada do repositório
   * oficial e maior que esta, pelo instalador da própria versão nova, num processo separado (atualizar.ts).
   */
  async atualizarPrograma(pedida: string, origem: { comando: number | null; sozinho: boolean; modo?: ModoAtualizar }): Promise<ResultadoAtualizar> {
    if (this.d.sombra) return { ok: false, status: 409, erro: "modo sombra: o agente não se atualiza" };
    if (!this.d.versoes || !this.d.exec) return { ok: false, status: 501, erro: "este agente não se atualiza pelo painel" };
    const pendente = this.atualizacaoPendente();
    if (pendente) return { ok: false, status: 409, erro: `já há uma atualização em andamento (para a ${pendente.para})` };
    // a publicação roda num processo deste agente: atualizar agora a derrubaria no meio
    if (this.publicando) return { ok: false, status: 409, erro: `publicando as funções e o painel da ${this.publicando}: tente de novo daqui a pouco` };
    let publicadas: string[];
    try {
      publicadas = await this.d.versoes.publicadas();
    } catch (e) {
      return { ok: false, status: 502, erro: `não consegui ler as versões publicadas (${(e as Error).message})` };
    }
    this.versaoNova = publicadas[0] ?? this.versaoNova;
    const escolha = escolherVersao(pedida, VERSAO, publicadas);
    if (!escolha.ok) return { ok: false, status: 409, erro: escolha.erro };
    const para = escolha.versao;
    const sozinho = origem.sozinho ? { modo: origem.modo ?? "madrugada" } : {};
    const dados = { atualizacao: "falhou", de: VERSAO, para, comando: origem.comando, sozinho: origem.sozinho, ...sozinho };
    // a mesma versão já foi recusada pela trava: confere a nuvem antes de baixar o pacote de novo
    const recusada = this.travaNuvem?.para === para ? this.travaNuvem : null;
    if (recusada && !(await this.travaLiberou(true))) return this.recusaDaTrava(recusada);
    let pasta: string | null = null;
    let instalador: string;
    let precisa: string[];
    let resumos: Record<string, string[]>;
    try {
      pasta = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-atualizar-"));
      const pacote = path.join(pasta, `reveza-${para}.tar.gz`);
      await this.d.versoes.baixar(para, pacote);
      extrairTarGz(pacote, path.join(pasta, "pacote"));
      instalador = acharInstalador(path.join(pasta, "pacote"), para);
      precisa = migracoesDoPacote(path.dirname(path.dirname(instalador)));
      resumos = resumosDoPacote(path.dirname(path.dirname(instalador)));
    } catch (e) {
      if (pasta) fs.rmSync(pasta, { recursive: true, force: true });
      const motivo = (e as Error).message;
      this.registrarEvento("erro", `A atualização para a ${para} não começou: ${motivo}.`, { ...dados, motivo });
      return { ok: false, status: 502, erro: `a atualização não começou: ${motivo}` };
    }
    // a trava de compatibilidade: a nuvem já tem as migrações que a versão nova traz? (a nuvem vem antes)
    if (this.d.nuvem) {
      const c = await this.conferirMigracoes(para, precisa, resumos);
      if (!c.ok) {
        fs.rmSync(pasta, { recursive: true, force: true });
        if (!c.precisaNuvem) {
          this.registrarEvento("erro", `A atualização para a ${para} não começou: ${c.erro}.`, { ...dados, motivo: c.erro });
          return { ok: false, status: 503, erro: `a atualização não começou: ${c.erro}` };
        }
        const trava: TravaNuvem = { para, precisa, resumos, faltam: c.faltam, conferidaEm: this.d.relogio.agora() };
        this.travaNuvem = trava;
        if (this.travaAvisada !== para) {
          this.travaAvisada = para;
          this.registrarEvento("info", `A versão ${para} precisa da nuvem atualizada primeiro: use Atualizar a nuvem, no painel (Computadores).`, {
            ...dados,
            atualizacao: "precisa_nuvem",
            faltam: c.faltam?.slice(0, 20) ?? null,
          });
        }
        return this.recusaDaTrava(trava);
      }
    }
    if (this.travaNuvem?.para === para) this.travaNuvem = null;
    fs.mkdirSync(this.d.c.logs, { recursive: true, mode: 0o700 });
    const log = path.join(this.d.c.logs, `atualizacao-${para}.log`);
    const resultado = path.join(pasta, "resultado.json");
    const instalacao = lerJson<{ semServico?: boolean }>(path.join(this.d.c.base, "instalacao.json"));
    const registro = { de: VERSAO, para, comando: origem.comando, em: this.d.relogio.agora(), pasta, log, resultado, sozinho: origem.sozinho, ...sozinho };
    gravarJson(this.arquivoAtualizacao(), registro);
    try {
      await rodarSeparado({
        sistema: this.d.sistema,
        exec: this.d.exec,
        node: this.d.node ?? process.execPath,
        env: this.d.ambienteDoInstalador ?? {},
        pasta,
        instalador,
        log,
        resultado,
        // sem token nenhum: só este computador (a nuvem se atualiza sozinha; funções e painel, pela atualização completa)
        args: ["--atualizar", "--sim", ...(instalacao?.semServico ? ["--sem-servico"] : [])],
      });
    } catch (e) {
      fs.rmSync(this.arquivoAtualizacao(), { force: true });
      fs.rmSync(pasta, { recursive: true, force: true });
      const motivo = (e as Error).message;
      this.registrarEvento("erro", `A atualização para a ${para} não começou: ${motivo}.`, { ...dados, motivo });
      return { ok: false, status: 500, erro: `a atualização não começou: ${motivo}` };
    }
    const como = !origem.sozinho ? "pedido pelo painel" : origem.modo === "assim_que_sair" ? "sozinho, assim que saiu" : "sozinho, de madrugada";
    this.registrarEvento("info", `Atualizando de ${VERSAO} para ${para} (${como}). Log: ${log}`, { ...dados, atualizacao: "pedida" });
    return { ok: true, de: VERSAO, para };
  }

  private recusaDaTrava(t: TravaNuvem): ResultadoAtualizar {
    return { ok: false, status: 409, erro: textoPrecisaNuvem(t.para), precisaNuvem: { para: t.para, faltam: t.faltam } };
  }

  /**
   * A trava de compatibilidade: a nuvem tem todas as migrações que vieram no pacote, com o mesmo conteúdo? Pergunta os
   * nomes e os resumos (agente_migracoes). Nuvem que já está nesta versão ou adiante (nuvem_versao) só precisa ter os
   * nomes: uma reaplicável dela pode ser mais nova que a do pacote. Nuvem de antes da 0.2.1 (sem a função) ou sem o
   * registro conta como desatualizada; sem rede ou outro erro, não se sabe agora, e também não atualiza.
   */
  async conferirMigracoes(
    para: string,
    precisa: string[],
    resumos: Record<string, string[]>,
  ): Promise<{ ok: true } | { ok: false; precisaNuvem: true; faltam: string[] | null } | { ok: false; precisaNuvem: false; erro: string }> {
    const nuvem = this.d.nuvem;
    if (!nuvem) return { ok: true };
    let aplicadas: MigracoesDaNuvem | null;
    try {
      aplicadas = await nuvem.migracoesAplicadas();
    } catch (e) {
      const semFuncao = e instanceof ErroNuvem && (e.codigo === "PGRST202" || e.codigo === "42883");
      if (semFuncao) return { ok: false, precisaNuvem: true, faltam: null };
      return { ok: false, precisaNuvem: false, erro: `não consegui conferir as migrações da nuvem (${(e as Error).message})` };
    }
    if (aplicadas === null) return { ok: false, precisaNuvem: true, faltam: null };
    const versaoDaNuvem = this.configNuvem.nuvem_versao;
    const aFrente = typeof versaoDaNuvem === "string" && VERSAO_VALIDA.test(versaoDaNuvem) && compararVersao(versaoDaNuvem, para) >= 0;
    const faltam = faltamNaNuvem(precisa, aplicadas, aFrente ? null : resumos);
    return faltam.length ? { ok: false, precisaNuvem: true, faltam } : { ok: true };
  }

  /** A versão recusada pela trava pode seguir? Confere a nuvem de novo (no máximo a cada 5 minutos, menos se forçar). */
  private async travaLiberou(forcar = false): Promise<boolean> {
    const tr = this.travaNuvem;
    if (!tr) return true;
    const t = this.d.relogio.agora();
    if (!forcar && t - tr.conferidaEm < TRAVA_CONFERIR_S) return false;
    tr.conferidaEm = t;
    const c = await this.conferirMigracoes(tr.para, tr.precisa, tr.resumos);
    if (c.ok) {
      this.travaNuvem = null;
      this.d.log.info(`a nuvem já tem as migrações da ${tr.para}: a atualização pode seguir`);
      return true;
    }
    if (c.precisaNuvem) tr.faltam = c.faltam;
    return false;
  }

  /**
   * O "Verificar atualização" do painel: lê agora a versão mais nova publicada (sem esperar as 6 horas; no máximo uma
   * vez por minuto) e conta o que achou. Com a atualização sozinha ligada, o resto segue o jeito escolhido: assim que
   * sair, a próxima busca já pede a vez; de madrugada, espera a janela.
   */
  async conferirAgora(): Promise<{ ok: true; corpo: Record<string, unknown> } | { ok: false; status: number; erro: string }> {
    if (!this.d.versoes) return { ok: false, status: 501, erro: "este agente não confere versões pelo painel" };
    const t = this.d.relogio.agora();
    if (t - this.versaoNovaLidaEm >= CONFERIR_AGORA_S) {
      this.versaoNovaLidaEm = t;
      try {
        this.versaoNova = (await this.d.versoes.publicadas())[0] ?? null;
        gravarJson(path.join(this.d.c.base, "versoes.json"), { lidoEm: t, maisNova: this.versaoNova });
      } catch (e) {
        return { ok: false, status: 502, erro: `não consegui ler as versões publicadas (${(e as Error).message})` };
      }
    }
    if (this.travaNuvem && this.travaNuvem.para === this.versaoNova) await this.travaLiberou(true);
    // o próximo agente_ola leva o diagnóstico com a versão nova (o cartão do computador mostra)
    this.diagnosticoEm = 0;
    const nova = !!this.versaoNova && compararVersao(this.versaoNova, VERSAO) > 0;
    const pendente = this.atualizacaoPendente();
    return {
      ok: true,
      corpo: {
        ok: true,
        conferido: true,
        atual: VERSAO,
        mais_nova: this.versaoNova,
        nova,
        atualizando: pendente && !pendente.relatado ? pendente.para : null,
        // a mais nova precisa da nuvem e do painel atualizados primeiro (a trava já recusou esta versão aqui)
        precisa_nuvem: !!this.travaNuvem && this.travaNuvem.para === this.versaoNova,
      },
    };
  }

  /**
   * Quem estiver rodando depois de uma atualização conta como ela terminou: o agente novo (subiu na versão pedida) ou o
   * antigo (o instalador falhou, ou voltou para a anterior). A pasta temporária só sai quando o instalador terminou.
   */
  async vigiarAtualizacao(): Promise<void> {
    const p = this.atualizacaoPendente();
    if (!p) return;
    const t = this.d.relogio.agora();
    const r = lerJson<{ codigo?: number; erro?: string }>(p.resultado);
    const terminou = !!r || t - p.em > ATUALIZACAO_VALIDA_S;
    let atual: Pendente = p;
    if (!p.relatado) {
      let fim: "concluida" | "falhou" | null = null;
      let motivo = "";
      if (VERSAO === p.para) fim = "concluida";
      else if (r) {
        fim = "falhou";
        motivo = r.erro ?? ultimaLinha(p.log) ?? `o instalador saiu com o código ${r.codigo}`;
      } else if (terminou) {
        fim = "falhou";
        motivo = "a atualização não terminou em 30 minutos";
      }
      if (!fim) return;
      const dados = { atualizacao: fim, de: p.de, para: p.para, comando: p.comando ?? null, sozinho: !!p.sozinho, ...(p.sozinho ? { modo: p.modo ?? "madrugada" } : {}) };
      if (fim === "concluida") this.registrarEvento("info", `Atualizado de ${p.de} para ${p.para}.`, dados);
      else {
        this.registrarEvento("erro", `A atualização de ${p.de} para ${p.para} não deu certo: ${motivo}. Este computador segue na ${VERSAO}.`, {
          ...dados,
          motivo: motivo.slice(0, 200),
        });
      }
      atual = { ...p, relatado: true, fim, motivo: motivo.slice(0, 200) };
      gravarJson(this.arquivoAtualizacao(), atual);
    }
    // a atualização sozinha conta à nuvem como terminou: libera a vez, ou para os outros e vira alerta
    if (atual.sozinho && !atual.nuvemAvisada && atual.fim && this.d.nuvem) {
      const ok = await this.d.nuvem.resultadoAtualizacao(atual.para, atual.fim, atual.motivo || null).then(() => true, () => false);
      if (!ok) return; // sem rede: conta na busca seguinte
      atual = { ...atual, nuvemAvisada: true };
      gravarJson(this.arquivoAtualizacao(), atual);
    }
    if (!terminou) return;
    fs.rmSync(this.arquivoAtualizacao(), { force: true });
    // só a pasta temporária que o próprio agente criou
    if (path.basename(p.pasta).startsWith("reveza-atualizar-") && path.dirname(path.resolve(p.pasta)) === path.resolve(os.tmpdir())) {
      fs.rmSync(p.pasta, { recursive: true, force: true });
    }
    if (this.d.sistema === "windows" && this.d.exec) await this.d.exec.rodar(["schtasks", "/Delete", "/F", "/TN", TAREFA_ATUALIZAR]).catch(() => undefined);
  }

  // ------------------------------------------------------------------------------------------------ atualização completa

  /**
   * Atualização completa (desligada de fábrica): com os tokens cifrados na nuvem, a nuvem já na versão nova e as funções
   * ou o painel dela ainda fora do ar, o primeiro computador ligado e calmo que pegar a vez publica (um por vez, a vez
   * é do banco). Qualquer sistema serve: é o instalador da versão nova, com o Node deste agente.
   */
  async talvezPublicar(): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || this.d.sombra || !this.d.versoes || !this.d.exec || !this.chave || this.publicando) return;
    await this.contarPublicacao();
    const cfg = this.configNuvem;
    if (!completaLigada(cfg) || !this.d.refNuvem) return;
    const p = pendenteDaPublicacao(cfg);
    if (!p.versao || (!p.funcoes && !p.painel) || compararVersao(p.versao, PUBLICA_DESDE) < 0) return;
    const vez = cfg.publicacao_vez as { para?: unknown; estado?: unknown } | undefined;
    if (vez && vez.para === p.versao && vez.estado === "falhou") return; // parou: quem pede de novo é o administrador
    if (this.atualizacaoPendente() || !this.momentoCalmo()) return;
    const t = this.d.relogio.agora();
    if (t - this.publicacaoPedidaEm < 300) return;
    this.publicacaoPedidaEm = t;
    const r = await nuvem.vezDePublicar(p.versao).catch(() => ({ pode: false, motivo: "sem rede", funcoes: false, painel: false }));
    if (!r.pode) {
      if (this.motivoSemPublicar !== r.motivo) this.d.log.info(`publicar funções e painel da ${p.versao}: ainda não (${r.motivo ?? "sem motivo"})`);
      this.motivoSemPublicar = r.motivo;
      return;
    }
    this.motivoSemPublicar = null;
    const para = p.versao;
    this.publicando = para;
    this.fundo(
      this.publicar(para, { funcoes: r.funcoes, painel: r.painel }).finally(() => {
        this.publicando = null;
      }),
    );
  }

  /**
   * Publica as funções e/ou o painel da versão `para` pelo instalador DELA (`--publicar-nuvem`): só versão publicada do
   * repositório oficial, pacote da tag pelo endereço fixo, os tokens abertos com a chave do cofre na memória e entregues
   * pela entrada padrão. O que o instalador escreve vai para o log sem nenhum pedaço dos tokens.
   */
  async publicar(para: string, partes: { funcoes: boolean; painel: boolean }): Promise<{ ok: boolean; motivo: string | null }> {
    const nuvem = this.d.nuvem!;
    let segredos: string[] = [];
    let motivo: string | null = null;
    let pasta: string | null = null;
    let ocupada = false;
    try {
      const tokens = abrirTokens(this.chave!, await nuvem.credenciaisLer());
      segredos = [tokens.supabase, tokens.vercel];
      const publicadas = await this.d.versoes!.publicadas();
      if (!publicadas.includes(para)) throw new Error(`a ${para} não é uma versão publicada do Reveza`);
      pasta = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-publicar-"));
      const pacote = path.join(pasta, `reveza-${para}.tar.gz`);
      await this.d.versoes!.baixar(para, pacote);
      extrairTarGz(pacote, path.join(pasta, "pacote"));
      const instalador = acharInstalador(path.join(pasta, "pacote"), para);
      const lista = [partes.funcoes && "funcoes", partes.painel && "painel"].filter(Boolean).join(",");
      this.d.log.info(`publicando ${lista} da ${para} (atualização completa)`);
      const r = await this.d.exec!.rodar([this.d.node ?? process.execPath, instalador, "--publicar-nuvem", "--ref", this.d.refNuvem!, "--partes", lista], {
        entrada: JSON.stringify(tokens),
        env: this.d.ambienteDoInstalador ?? {},
        cwd: pasta,
        timeoutMs: PUBLICACAO_VALIDA_MS,
        arvore: true,
      });
      const saida = semSegredos(`${r.saida}${r.erro}`, segredos).replace(/\x1b\[[0-9;]*m/g, "");
      fs.mkdirSync(this.d.c.logs, { recursive: true, mode: 0o700 });
      gravarAtomico(path.join(this.d.c.logs, `publicacao-${para}.log`), saida);
      if (r.codigo === PUBLICACAO_OCUPADA) ocupada = true;
      else if (r.codigo !== 0) {
        const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        motivo = (linhas.reverse().find((l) => /Parei|Stopped|erro|falh/i.test(l)) ?? linhas[0] ?? `o instalador saiu com o código ${r.codigo}`).slice(0, 200);
      }
    } catch (e) {
      motivo = semSegredos(String((e as Error).message ?? e), segredos).slice(0, 200);
    } finally {
      if (pasta) fs.rmSync(pasta, { recursive: true, force: true });
    }
    if (ocupada) {
      // a publicação de antes (de um agente que caiu com o instalador vivo) segue e grava o que publicou
      this.d.log.info(`publicar ${para}: outra publicação segue viva neste computador; espero ela terminar`);
      return { ok: false, motivo: "outra publicação em andamento neste computador" };
    }
    if (motivo) this.d.log.erro(`a publicação da ${para} não deu certo: ${motivo}`);
    else this.d.log.info(`funções e painel da ${para} publicados`);
    this.publicacaoAContar = { para, estado: motivo ? "falhou" : "concluida", motivo };
    await this.contarPublicacao();
    return { ok: !motivo, motivo };
  }

  /** Conta à nuvem como a publicação terminou (sem rede, tenta na busca seguinte). */
  private async contarPublicacao(): Promise<void> {
    const c = this.publicacaoAContar;
    if (!c || !this.d.nuvem) return;
    const ok = await this.d.nuvem.resultadoPublicacao(c.para, c.estado, c.motivo).then(() => true, () => false);
    if (ok) this.publicacaoAContar = null;
  }

  // ------------------------------------------------------------------------------------------------ conserto

  /**
   * O conserto da credencial em uso (`reveza doctor` e o Corrigir do painel): o assistente está sem login, ou com um
   * login morto. Com nuvem, entra a conta que ela atribuiu a este computador (do cofre, com a posse); sem nuvem, a conta
   * em uso se ainda serve, senão a melhor livre. Sempre pelo trocador: nada de gravar credencial por fora dele.
   */
  async consertarCredencial(): Promise<{ ok: boolean; texto: string }> {
    if (this.d.sombra) {
      return { ok: false, texto: "modo sombra: o agente não troca conta (para sair da sombra: instalador com --atualizar --sair-da-sombra)" };
    }
    const antes = await this.principalComLogin();
    if (antes) return { ok: true, texto: `o assistente já está com login (${antes})` };
    let r: { ok: boolean; erro?: string };
    if (this.d.nuvem && this.posse) {
      // traz a atribuição mais nova; dentro de uma busca (o Corrigir do painel chega numa) não roda de novo
      await this.busca();
      const a = this.ultimaAtribuicao;
      if (!a?.conta_id) {
        return {
          ok: false,
          texto:
            this.online === false
              ? "o agente está sem falar com a nuvem, que é quem escolhe a conta: confira a internet e corrija de novo"
              : "a nuvem ainda não mandou conta para este computador: escolha uma no painel (Computadores, Trocar conta agora)",
        };
      }
      r = await this.aplicarAtribuicao(a, true);
    } else {
      const destino = this.contaParaConserto();
      if (!destino) {
        return { ok: false, texto: "nenhuma conta livre neste computador agora (no limite, pausadas ou sem login): entre de novo numa delas ou espere o reset" };
      }
      r = await this.trocador.trocar(destino, "conserto: o assistente estava sem login");
    }
    const depois = await this.principalComLogin();
    if (depois) return { ok: true, texto: `o assistente voltou a ter login: ${depois}` };
    if (r.ok) return { ok: false, texto: "a conta entrou, mas o login dela não vale mais: entre de novo nela pelo painel (Contas, Entrar de novo)" };
    if (r.erro === "não consegui identificar a conta em uso") {
      return {
        ok: false,
        texto: "o login em uso venceu e as sessões ainda podem renová-lo (ou falta rede para conferir): se o assistente seguir pedindo login, corrija de novo em 15 minutos",
      };
    }
    if (r.erro === "conta sem login guardado") return { ok: false, texto: "a conta escolhida está sem login guardado: entre de novo nela pelo painel (Contas, Entrar de novo)" };
    return { ok: false, texto: r.erro ?? "a troca não aconteceu" };
  }

  /**
   * O assistente está sem login e a conta que a nuvem mandou está para chegar: a busca aplica a atribuição em segundos
   * (computador recém-ligado ou recém-atualizado, ou a nuvem mandou outra conta). Não vale para a conta que já consta
   * em uso (a busca não a põe de volta: aí é o conserto) nem depois de 2 minutos (algo travou: também é o conserto).
   * A prova final do instalador espera por isto antes de conferir, e o doctor mostra aviso em vez de falha
   * (12/10/2026: a prova acusou "nenhum login" 1 a 2 s antes de o agente novo pôr a conta).
   */
  esperandoConta(): boolean {
    if (!this.d.nuvem || !this.posse || this.d.sombra) return false;
    const tr = this.trocador;
    if (tr.principalLida && tr.principalSemLoginDesde === null) return false;
    if (this.d.relogio.agora() - (tr.principalSemLoginDesde ?? this.iniciadoEm) > ESPERA_CONTA_S) return false;
    if (this.online === null) return true; // ainda não falou com a nuvem: a atribuição vem na primeira busca
    const a = this.ultimaAtribuicao;
    if (!a?.conta_id) return false;
    const destino = this.posse.porContaId(a.conta_id);
    return !destino || destino !== this.estado.ativa;
  }

  /** O e-mail da conta com login de pé na principal (dentro da validade, ou com renovação), ou null. */
  private async principalComLogin(): Promise<string | null> {
    const blob = await this.cred.ler(PRINCIPAL).catch(() => null);
    const h = hashToken(blob);
    if (!h || (expiraEm(blob) <= this.d.relogio.agora() && !temRenovacao(blob))) return null;
    const ultima = this.trocador.ultimaPrincipal;
    if (ultima && hashToken(ultima[1]) === h) return this.estado.contas[ultima[0]]?.email ?? null;
    if (expiraEm(blob) <= this.d.relogio.agora()) return null; // vencido e de ninguém conhecido: a API não diz de quem é
    const perfil = await this.trocador.identidade(blob).catch(() => null);
    return perfil?.email ?? null;
  }

  /** Sem nuvem: a conta em uso se ainda serve; senão a melhor livre; senão a menos usada das que têm login. */
  private contaParaConserto(): string | null {
    const t = this.d.relogio.agora();
    const e = this.estado;
    const serve = (id: string) => {
      const c = e.contas[id];
      return !!c && !c.precisaLogin && !c.pausada && (pctEfetivo(c, t) ?? 0) < gatilhoDeTroca(e);
    };
    if (e.ativa && serve(e.ativa)) return e.ativa;
    const livre = candidata(e, t);
    if (livre) return livre;
    return (
      Object.keys(e.contas)
        .filter(serve)
        .sort((a, b) => (pctEfetivo(e.contas[a]!, t) ?? 0) - (pctEfetivo(e.contas[b]!, t) ?? 0))[0] ?? null
    );
  }

  // ------------------------------------------------------------------------------------------------ comandos

  async comando(id: number): Promise<void> {
    if (this.comandosVistos.has(id)) return;
    this.comandosVistos.add(id);
    if (this.comandosVistos.size > 500) this.comandosVistos = new Set([...this.comandosVistos].slice(-200));
    if (this.d.sombra) {
      this.d.log.faria(`reservar e responder o comando ${id}`);
      return;
    }
    const nuvem = this.d.nuvem!;
    const r = await nuvem.reservarComando(id);
    if (!r.ok || !r.comando) return;
    const cmd = r.comando;
    const tratar = async (): Promise<void> => {
      let resposta: Resposta;
      try {
        resposta = await this.executar(cmd);
      } catch (e) {
        this.d.log.erro(`comando ${cmd.acao}: ${(e as Error).message}`);
        resposta = { status: 500, corpo: { ok: false, erro: "falha interna no computador; veja o log do agente" } };
      }
      await nuvem.responderComando(id, resposta.status, resposta.corpo as Record<string, unknown>).catch(() => undefined);
      this.d.log.info(`comando ${cmd.acao} (${id}) -> ${resposta.status}`);
    };
    await tratar();
  }

  // ------------------------------------------------------------------------------------------------ computador novo

  /** A janela de liberar computador novo, que roda à parte (espera a pessoa digitar); os testes esperam por ela. */
  emEspera: Promise<void> | null = null;

  /**
   * Pedidos de computador novo abertos na instalação. Mais de um ao mesmo tempo: recusa todos (e anula a janela aberta).
   * Um só, com a janela marcada para este computador: toca o som e abre a janela pedindo o código que aparece no
   * computador novo. Sem tela, o pedido fica aberto para `reveza ligar XXXX-XXXX-YYYY`.
   */
  private async vigiarLigacoes(pedidos: PedidoLigacao[]): Promise<void> {
    if (this.d.sombra || !this.chave || this.chaveDaInstalacao === false) return;
    const nuvem = this.d.nuvem!;
    if (pedidos.length > 1) {
      if (this.janelaLigacao) this.janelaLigacao.anulada = true;
      for (const p of pedidos) await nuvem.ligacaoRecusar(p.computador_id, "dois_pedidos").catch(() => undefined);
      this.avisarLigacaoDupla();
      return;
    }
    const p = pedidos[0];
    const chave = p ? `${p.computador_id}|${p.pedido_em}|${p.aprovador_em}` : "";
    if (this.janelaLigacao) {
      // a janela aberta é de um pedido que não está mais aberto (ou mudou): o que se digitar nela não libera nada
      if (this.janelaLigacao.chave !== chave) this.janelaLigacao.anulada = true;
      return;
    }
    if (!p || !p.para_mim || this.janelasAbertas.has(chave)) return;
    this.janelasAbertas.add(chave);
    if (this.janelasAbertas.size > 50) this.janelasAbertas = new Set([...this.janelasAbertas].slice(-20));
    if (!this.d.exec) return this.avisarSemTela(p);
    const janela = { chave, anulada: false };
    this.janelaLigacao = janela;
    this.emEspera = this.confirmarLigacao(p, janela)
      .catch((e) => this.d.log.erro(`ligação de computador novo: ${(e as Error).message}`))
      .finally(() => {
        if (this.janelaLigacao === janela) this.janelaLigacao = null;
        this.emEspera = null;
      });
  }

  private avisarSemTela(p: PedidoLigacao): void {
    if (this.semTelaAvisado.has(p.computador_id)) return;
    this.semTelaAvisado.add(p.computador_id);
    this.d.log.info("um computador novo pediu para entrar, e este computador não tem tela para a janela: rode reveza ligar com o código que aparece nele");
  }

  private async confirmarLigacao(p: PedidoLigacao, janela: { anulada: boolean }): Promise<void> {
    const nuvem = this.d.nuvem!;
    // o código não se calcula inteiro aqui: a primeira parte confere com a chave pública do pedido, e a parte sorteada
    // (os 4 últimos, que só existem na tela do computador novo) vai na cifra do envelope
    let segredo: string | null = null;
    const confere = async (digitado: string) => (segredo = await conferirCodigo(digitado, p.publica)) !== null;
    // a língua é a do painel que escolheu este computador (só "pt-BR" ou "en"; o texto da janela é fixo)
    const idioma = p.idioma === "en" ? "en" : "pt-BR";
    void this.somDaTroca(true);
    for (let tentativa = 1; tentativa <= TENTATIVAS_CODIGO; tentativa++) {
      const r = await pedirConfirmacao(this.d.exec!, this.d.sistema, confere, idioma, process.env, tentativa > 1);
      // outro pedido chegou enquanto a janela estava aberta: nem o código certo libera este
      if (janela.anulada) {
        this.d.log.info(`ligação de computador novo: ${LIGACAO_DUPLA}`);
        return;
      }
      if (r === "sem_tela") return this.avisarSemTela(p);
      if (r === "sem_resposta") {
        this.d.log.info("ligação de computador novo: ninguém respondeu à janela; o pedido segue aberto para reveza ligar com o código");
        return;
      }
      if (r === "recusou") {
        await nuvem.ligacaoRecusar(p.computador_id, "recusado_na_tela").catch(() => undefined);
        this.trocador.evento("info", "Pedido de computador novo recusado na tela deste computador.");
        return;
      }
      if (r === "liberou") {
        // de novo, logo antes de entregar: um pedido que chegou durante a janela anula este
        if (janela.anulada || !this.chave || !segredo) return;
        await entregarChave(nuvem, this.chave, p, segredo);
        this.trocador.evento("info", "Computador novo liberado aqui: a chave do cofre foi entregue cifrada só para ele.");
        return;
      }
    }
    await nuvem.ligacaoRecusar(p.computador_id, "codigo_errado").catch(() => undefined);
    // "info" fica só aqui (a nuvem registra a recusa com os dados dela, para o painel)
    this.trocador.evento("info", "Pedido de computador novo recusado: o código digitado não conferiu três vezes.");
  }

  private ligacaoDuplaAvisadaEm = 0;
  private avisarLigacaoDupla(): void {
    // um aviso (com som) por rodada de pedidos, não um por pedido
    if (this.d.relogio.agora() - this.ligacaoDuplaAvisadaEm < 60) return;
    this.ligacaoDuplaAvisadaEm = this.d.relogio.agora();
    this.trocador.evento("info", `Pedido de computador novo: ${LIGACAO_DUPLA}.`);
    void this.somDaTroca(true);
  }

  permitidas(): Set<string> | null {
    try {
      const linhas = fs.readFileSync(this.d.c.permitidas, "utf8").split(/\r?\n/);
      return new Set(linhas.map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
    } catch {
      return null;
    }
  }

  async executar(cmd: ComandoNuvem): Promise<Resposta> {
    const recusa = (status: number, erro: string): Resposta => ({ status, corpo: { ok: false, erro } });
    if (!ACOES.has(cmd.acao)) return recusa(403, "ação não permitida");
    if (JSON.stringify(cmd.corpo).length > 4096) return recusa(413, "pedido grande demais");
    // Quem expira comando velho é a nuvem (2 min); se ela mandar a hora, confere aqui também.
    const criado = cmd.criado_em ? isoParaEpoch(cmd.criado_em) : null;
    if (criado && this.d.relogio.agora() - criado > COMANDO_VALIDO_S) return recusa(410, "pedido expirado");
    const corpo = cmd.corpo;
    switch (cmd.acao) {
      case "conectar":
      case "entrar_de_novo": {
        let email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
        if (cmd.acao === "entrar_de_novo" && typeof corpo.conta_id === "string") {
          const id = this.posse?.porContaId(corpo.conta_id);
          if (id) email = this.estado.contas[id]!.email;
        }
        if (!EMAIL_VALIDO.test(email)) return recusa(400, "e-mail inválido");
        const lista = this.permitidas();
        if (lista && !lista.has(email)) return recusa(403, "este computador só conecta as contas da lista dele (contas-permitidas.txt)");
        const l = this.logins.iniciar(email);
        await this.logins.aguardarEndereco(l);
        return { status: 200, corpo: { ok: true, login_id: l.id, url: l.url, janela: l.janela, estado: l.estado, mensagem: l.mensagem } };
      }
      case "codigo_login": {
        const r = this.logins.codigo(String(corpo.login_id ?? ""), String(corpo.codigo ?? ""));
        return { status: r.ok ? 200 : 400, corpo: r };
      }
      case "cancelar_login": {
        const r = this.logins.cancelar(String(corpo.login_id ?? ""));
        return { status: r.ok ? 200 : 400, corpo: r };
      }
      case "atualizar": {
        // com a versão no corpo, é atualizar o PROGRAMA (só X.Y.Z ou "mais_nova"); sem nada, é reler as contas
        if (Object.keys(corpo).length) {
          const p = lerPedido(corpo);
          if (!p.ok) return recusa(400, p.erro);
          if ("conferir" in p) {
            const c = await this.conferirAgora();
            return c.ok ? { status: 200, corpo: c.corpo } : recusa(c.status, c.erro);
          }
          const r = await this.atualizarPrograma(p.versao, { comando: cmd.id ?? null, sozinho: false });
          if (!r.ok) {
            if (!r.precisaNuvem) return recusa(r.status, r.erro);
            return { status: r.status, corpo: { ok: false, erro: r.erro, precisa_nuvem: true, para: r.precisaNuvem.para, faltam: r.precisaNuvem.faltam?.slice(0, 20) ?? null } };
          }
          return { status: 200, corpo: { ok: true, atualizando: true, de: r.de, para: r.para } };
        }
        await this.atualizarTudo();
        return { status: 200, corpo: { ok: true } };
      }
      case "diagnostico": {
        // Corrigir pelo painel: só o sim/não vem da nuvem; o que roda é a lista fechada de conserto.ts
        if (corpo.corrigir === true) {
          if (!this.d.consertar) return recusa(501, "este agente não conserta pelo painel");
          const r = await this.d.consertar();
          const texto = `Conserto pedido pelo painel: ${r.resumo}.`.slice(0, 300);
          this.trocador.evento("info", texto);
          // o evento "info" não sobe sozinho (aoEvento): o conserto vai à nuvem de propósito, para ficar registrado
          await this.d.nuvem
            ?.evento("info", texto, { conserto: true, comando: cmd.id ?? null, corrigidos: r.corrigidos ?? 0, nao_deu: r.naoDeu ?? 0 })
            .catch(() => undefined);
          // o próximo agente_ola leva o diagnóstico de depois do conserto para o guardado na nuvem
          this.diagnosticoParaMandar = r.diagnostico;
          return { status: 200, corpo: { ok: true, corrigir: true, diagnostico: r.diagnostico } };
        }
        const diag = this.d.diagnostico ? await this.d.diagnostico() : {};
        // o Rodar agora: o guardado na nuvem também fica novo (antes só mudava na conferência de 10 em 10 min)
        if (this.d.diagnostico) this.diagnosticoParaMandar = diag;
        return { status: 200, corpo: { ok: true, diagnostico: diag } };
      }
      case "ligar":
        // a frase cifrada para o navegador saiu na 0.2.0: o computador novo mostra o código e a pessoa digita aqui
        return recusa(410, LIGAR_PELO_PAINEL_SAIU);
      case "retomar_sessao": {
        const sessao = String(corpo.sessao ?? "");
        const f = this.estado.fila.find((x) => x.sessao === sessao);
        if (!f) return recusa(404, "sessão desconhecida neste computador");
        if (f.estado !== "aguardando") return recusa(409, `a sessão já foi ${f.estado}`);
        // sessão com tela continua sozinha pelo mod; retomar no terminal por cima dela daria duas conversas ao mesmo tempo
        if (f.tipo !== "headless") return recusa(409, "sessão com tela: ela continua sozinha quando a conta troca");
        if (!this.retomar(f.sessao)) return recusa(404, "a transcrição da sessão não está neste computador");
        f.estado = "retomada";
        this.trocador.evento("retomada", `Retomei a sessão ${f.sessao.slice(0, 8)} pelo painel.`, { sessao: f.sessao });
        this.salvar();
        return { status: 200, corpo: { ok: true } };
      }
    }
    return recusa(403, "ação não permitida");
  }

  async atualizarTudo(): Promise<void> {
    await this.trocador.conferirPrincipal();
    for (const id of Object.keys(this.estado.contas)) await this.lerUsoConta(id, true);
    if (!this.comNuvem) await this.agir();
    else await this.relatarUso(true);
    this.salvar();
  }

  // ------------------------------------------------------------------------------------------------ contas novas

  private async loginTerminou(login: Login, id: string | null): Promise<void> {
    if (this.d.nuvem && !this.d.sombra) {
      void this.d.nuvem
        .evento("conexao", login.mensagem, { login_id: login.id, estado: login.estado, email: login.email })
        .catch(() => undefined);
    }
    if (!id) return;
    this.salvar();
    await this.registrarNaNuvem(id);
    await this.lerUsoConta(id, true);
    this.salvar();
  }

  async registrarNaNuvem(id: string): Promise<void> {
    if (!this.posse || this.d.sombra) return;
    if (!this.chave) {
      this.trocador.evento("alerta", "Conta conectada só neste computador: falta a chave do cofre (`reveza ligar`).", { conta: id });
      return;
    }
    await this.posse.registrarNaNuvem(id).catch((e) => this.d.log.erro(`registrar conta na nuvem: ${(e as Error).message}`));
  }

  // ------------------------------------------------------------------------------------------------ relatos

  /** Janelas e histórico das contas que este computador tem em mãos (a nuvem ignora as outras). */
  async relatarUso(forcar = false): Promise<void> {
    const nuvem = this.d.nuvem;
    if (!nuvem || !this.posse) return;
    const t = this.d.relogio.agora();
    const janelas: JanelaNuvem[] = [];
    const historico: PontoNuvem[] = [];
    for (const c of Object.values(this.estado.contas)) {
      if (!c.contaId || !c.lidoEm || !this.posse.temPosse(c.id)) continue;
      for (const j of c.janelas) {
        janelas.push({
          conta_id: c.contaId,
          tipo: j.tipo,
          pct: j.pct,
          reset_em: j.resetEm ? epochParaIso(j.resetEm) : null,
          fonte: c.fonte === "sessao" ? "sessao" : "api",
        });
      }
      const ultimo = this.historicoEnviado.get(c.id) ?? 0;
      for (const p of this.estado.historico[c.id] ?? []) {
        if (p.t > ultimo) historico.push({ conta_id: c.contaId, em: epochParaIso(p.t), p5: p.p5, p7: p.p7 });
      }
    }
    const assinatura = JSON.stringify(janelas);
    if (!forcar && assinatura === this.usoEnviado && !historico.length && t - this.usoEnviadoEm < 60) return;
    if (!janelas.length && !historico.length) return;
    await nuvem.relatarUso(janelas.slice(0, 100), historico.slice(-500));
    this.usoEnviado = assinatura;
    this.usoEnviadoEm = t;
    for (const c of Object.values(this.estado.contas)) {
      const pontos = this.estado.historico[c.id] ?? [];
      if (pontos.length && this.posse.temPosse(c.id)) this.historicoEnviado.set(c.id, pontos[pontos.length - 1]!.t);
    }
  }

  /** Varre as transcrições e manda os agregados que mudaram. */
  async registro(orcamentoMs = 20_000): Promise<void> {
    if (this.emRegistro) return;
    this.emRegistro = true;
    try {
      await this.contador.varrer(orcamentoMs);
      const nuvem = this.d.nuvem;
      if (!nuvem || this.online === false) return;
      const contaNuvem = (id: string) => this.estado.contas[id]?.contaId ?? null;
      for (let i = 0; i < 20; i++) {
        const lote = this.contador.paraNuvem(contaNuvem);
        if (!lote.linhas.length && !lote.sessoes.length) break;
        const r = await nuvem.relatarTokens(lote.linhas, lote.sessoes);
        if (!r.ok) break;
        this.contador.confirmarEnvio(lote.chaves, lote.ids);
      }
      this.contador.salvar();
    } catch (e) {
      this.d.log.erro(`registro de uso: ${(e as Error).message}`);
    } finally {
      this.emRegistro = false;
    }
  }

  // ------------------------------------------------------------------------------------------------ ponte

  publico(): Record<string, unknown> {
    return this.trocador.publico({
      // a versão do programa que está rodando: o instalador confere por ela que a versão nova subiu de verdade
      programa: VERSAO,
      sombra: this.d.sombra,
      nuvem: { ligada: this.comNuvem, online: this.online, computadorId: this.estado.nuvem.computadorId },
      cofre: !!this.chave,
      conexoes: this.logins.publico(),
      credencial: { esperandoConta: this.esperandoConta() },
      modelo: this.estado.modeloEscrito ?? null,
      enxugar: this.estado.enxugar === true,
    });
  }

  alvoPonte() {
    return {
      ativa: () => {
        const e = this.estado;
        const c = e.ativa ? e.contas[e.ativa] : undefined;
        return { slug: e.ativa, email: c?.email ?? null, versao: e.versao, trocadaEm: e.trocadaEm, enxugar: e.enxugar === true };
      },
      estado: () => this.publico(),
      medida: (corpo: Record<string, unknown>): Resposta => {
        const entrou = this.trocador.medidaDaSessao(corpo);
        if (entrou) this.fundo(this.comNuvem ? this.relatarUso() : this.agir());
        return { status: 200, corpo: { ok: true } };
      },
      limite: (corpo: Record<string, unknown>): Resposta => {
        const r = this.trocador.limiteDaSessao(corpo);
        const sessao = String(corpo.sessao ?? "").slice(0, 80);
        if (sessao) this.contador.marcarParada(sessao);
        this.salvar();
        if (r.anotado) this.fundo(this.limiteDepois(sessao));
        return { status: 200, corpo: { ok: true, versao: r.versao } };
      },
      fila: (sessao: string, acao: string): Resposta => {
        for (const f of this.estado.fila) {
          if (f.sessao !== sessao) continue;
          f.estado = acao === "descartar" ? "descartada" : "retomada";
          if (acao === "retomada") this.trocador.evento("retomada", `A sessão ${sessao.slice(0, 8)} voltou a trabalhar na conta nova.`, { sessao });
        }
        this.salvar();
        return { status: 200, corpo: { ok: true } };
      },
      trocar: async (corpo: Record<string, unknown>): Promise<Resposta> => {
        const email = String(corpo.email ?? "").trim().toLowerCase();
        const id = this.trocador.contaPorEmail(email);
        if (!id) return { status: 404, corpo: { ok: false, erro: "conta desconhecida neste computador" } };
        if (this.comNuvem && corpo.local !== true) {
          return { status: 409, corpo: { ok: false, erro: "com a nuvem ligada, quem decide a conta é o painel (Trocar agora); use --local para forçar" } };
        }
        if (this.d.sombra) return { status: 409, corpo: { ok: false, erro: "modo sombra: o agente não troca" } };
        const r = await this.trocador.trocar(id, "pedido pela linha de comando");
        return { status: r.ok ? 200 : 400, corpo: { ok: r.ok, erro: r.erro ?? null } };
      },
      atualizar: async (): Promise<Resposta> => {
        await this.atualizarTudo();
        return { status: 200, corpo: { ok: true } };
      },
      conectar: (corpo: Record<string, unknown>): Resposta => {
        if (this.d.sombra) return { status: 409, corpo: { ok: false, erro: "modo sombra: o agente não conecta conta" } };
        const email = typeof corpo.email === "string" && corpo.email.trim() ? corpo.email.trim().toLowerCase() : null;
        if (email !== null && !EMAIL_VALIDO.test(email)) return { status: 400, corpo: { ok: false, erro: "e-mail inválido" } };
        const l = this.logins.iniciar(email);
        return { status: 200, corpo: { ok: true, id: l.id } };
      },
      codigoLogin: (corpo: Record<string, unknown>): Resposta => {
        const r = this.logins.codigo(String(corpo.id ?? ""), String(corpo.codigo ?? ""));
        return { status: r.ok ? 200 : 400, corpo: r };
      },
      adotar: async (): Promise<Resposta> => {
        const id = await this.trocador.conferirPrincipal();
        this.salvar();
        return { status: 200, corpo: { ok: !!id, conta: id ? this.estado.contas[id]!.email : null } };
      },
      consertar: async (corpo: Record<string, unknown>): Promise<Resposta> => {
        // só os consertos que precisam do agente rodando, pelo nome (a lista fechada); o resto roda no terminal
        if (corpo.item !== "credenciais") return { status: 400, corpo: { ok: false, erro: "conserto desconhecido" } };
        const r = await this.consertarCredencial();
        if (r.ok) this.trocador.evento("info", `Conserto pelo terminal: ${r.texto}.`);
        return { status: 200, corpo: r };
      },
      som: async (corpo: Record<string, unknown>): Promise<Resposta> => {
        if (typeof corpo.ligado === "boolean") {
          this.estado.config.som = corpo.ligado;
          this.salvar();
        }
        const tocou = corpo.testar === true ? await this.somDaTroca(true) : null;
        return { status: 200, corpo: { ok: true, ligado: this.estado.config.som !== false, tocou } };
      },
      resumo: (corpo: Record<string, unknown>): Resposta => {
        // { tokens: 100000..1000000 } liga ou muda; { tokens: false } desliga (o agente tira o que escreveu); {} só lê
        if (corpo.tokens === false) this.estado.config.resumo = false;
        else if (corpo.tokens !== undefined) {
          const n = Number(corpo.tokens);
          if (!Number.isInteger(n) || n < RESUMO_MINIMO || n > RESUMO_MAXIMO) {
            return { status: 400, corpo: { ok: false, erro: "o resumo vai de 100 mil a 1 milhão de tokens (ex.: 180k), ou desligar" } };
          }
          this.estado.config.resumo = n;
        }
        this.salvar();
        this.aplicarResumo();
        const conta = this.estado.ativa ? this.estado.contas[this.estado.ativa] : null;
        return {
          status: 200,
          corpo: {
            ok: true,
            tokens: this.estado.config.resumo ?? false,
            emUso: this.estado.resumoEscrito ?? null,
            contaGrande: contaGrande(conta),
            conta: conta?.email ?? null,
          },
        };
      },
      sessaoErro: (corpo: Record<string, unknown>): Resposta => {
        // a sessão que travou com "Prompt is too long" (o mod manda): fica nos eventos, com o tamanho da conversa, para
        // dar para saber depois por que travou (13/10/2026: sem isso, foi preciso ler as transcrições do computador)
        const sessao = String(corpo.sessao ?? "").slice(0, 80);
        const tokens = Number(corpo.tokens);
        const janela = Number(corpo.janela);
        const mil = (n: number) => (Number.isFinite(n) && n > 0 ? `${Math.round(n / 1000)} mil` : "?");
        const agora = this.d.relogio.agora();
        if (corpo.tipo !== "contexto" || (this.errosAvisados.get(sessao) ?? 0) > agora - 600) return { status: 200, corpo: { ok: true } };
        this.errosAvisados.set(sessao, agora);
        this.trocador.evento("erro", `Uma sessão parou com "Prompt is too long": conversa em ${mil(tokens)} de ${mil(janela)} tokens.`, {
          sessao: sessao.slice(0, 8),
        });
        return { status: 200, corpo: { ok: true } };
      },
    };
  }

  /** O limite de uma sessão decide na hora: na nuvem (agente_limite) ou aqui, sem nuvem. */
  private async limiteDepois(sessao: string): Promise<void> {
    if (this.d.sombra) {
      this.d.log.faria(`avisar o limite da sessão ${sessao.slice(0, 8)} e trocar de conta`);
      return;
    }
    if (!this.comNuvem) return this.agir(true);
    const ativa = this.estado.ativa;
    const contaId = ativa ? this.estado.contas[ativa]?.contaId : null;
    if (!contaId) return;
    try {
      await this.d.nuvem!.limite(contaId, sessao || null);
      await this.busca();
    } catch (e) {
      this.d.log.erro(`avisar o limite à nuvem: ${(e as Error).message}`);
    }
  }
}

const SESSAO_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pasta em que a sessão rodou, pelo campo `cwd` da transcrição em ~/.claude/projects/<pasta>/<sessão>.jsonl. */
export function cwdDaSessao(projetos: string, sessao: string): string | null {
  if (!SESSAO_VALIDA.test(sessao)) return null;
  let pastas: string[];
  try {
    pastas = fs.readdirSync(projetos);
  } catch {
    return null;
  }
  for (const p of pastas) {
    const arq = path.join(projetos, p, `${sessao}.jsonl`);
    if (!fs.existsSync(arq)) continue;
    const fd = fs.openSync(arq, "r");
    try {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      for (const linha of buf.subarray(0, n).toString("utf8").split("\n")) {
        try {
          const j = JSON.parse(linha) as { cwd?: unknown; sessionId?: unknown };
          if (typeof j.cwd === "string" && path.isAbsolute(j.cwd) && (j.sessionId === sessao)) return j.cwd;
        } catch {
          /* linha cortada no fim do pedaço lido */
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return null;
}
