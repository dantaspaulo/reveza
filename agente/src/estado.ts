// O registro local do agente (~/.reveza/estado.json). Só e-mail, organização, números e caminhos: segredo nunca
// entra aqui (fica nas credenciais do sistema).

import * as fs from "node:fs";
import { gravarJson, lerJson, clonar } from "./util/arquivos.js";
import type { Janela, Perfil } from "./anthropic.js";

export type Fonte = "sessao" | "api" | null;

export interface ContaLocal {
  id: string;
  /** Id da conta na nuvem (uuid), quando a nuvem existe. */
  contaId: string | null;
  email: string;
  org: string | null;
  accountUuid: string | null;
  orgUuid: string | null;
  plano: string | null;
  tier: string | null;
  /** ~/.reveza/contas/<id>: o CLAUDE_CONFIG_DIR da conta. */
  pasta: string;
  pausada: boolean;
  precisaLogin: boolean;
  conectadaEm: number;
  janelas: Janela[];
  lidoEm: number | null;
  fonte: Fonte;
  tokenExpiraEm: number | null;
  erro: string | null;
  /** Versão do cofre a que a cópia local corresponde (null: a cópia local nunca foi ao cofre). */
  versaoCofre: number | null;
}

export type TipoEvento = "troca" | "aviso" | "limite" | "retomada" | "conexao" | "erro" | "info" | "alerta";

export interface Evento {
  em: number;
  tipo: TipoEvento;
  texto: string;
  dados?: Record<string, unknown>;
}

export interface ItemFila {
  sessao: string;
  cwd: string;
  tipo: "interativa" | "headless";
  em: number;
  estado: "aguardando" | "retomada" | "descartada";
  conta: string | null;
}

export type Modo = "limiar" | "limite" | "rodizio";
export type OrdemRodizio = "aleatoria" | "menor_uso";

export interface ConfigLocal {
  auto: boolean;
  aviso: number;
  troca: number;
  modo: Modo;
  rodizio: { minutos: number; ordem: OrdemRodizio };
  retomarHeadless: boolean;
  esperaEntreTrocasS: number;
  intervaloS: number;
  /** Som do sistema quando este computador troca de conta. */
  som: boolean;
  /**
   * Resumo da conversa (autoCompactWindow do Claude Code) nas contas que não são 20x, em tokens; false: o agente não
   * mexe (ver resumo.ts).
   */
  resumo: number | false;
}

export interface PontoHistorico {
  t: number;
  p5: number | null;
  p7: number | null;
}

export interface EstadoLocal {
  formato: 1;
  ativa: string | null;
  proxima: string | null;
  versao: number;
  trocadaEm: number;
  contas: Record<string, ContaLocal>;
  eventos: Evento[];
  fila: ItemFila[];
  identidades: Record<string, Perfil>;
  config: ConfigLocal;
  proximoRodizioEm: number | null;
  historico: Record<string, PontoHistorico[]>;
  /** Linha do tempo de qual conta estava em uso: [desde, id]. É ela que diz de quem foi cada resposta. */
  linhaContas: [number, string][];
  nuvem: { computadorId: string | null; atribuicaoVersao: number; atribuicaoConta: string | null };
  /** O autoCompactWindow que o agente deixou no settings.json do Claude Code (null: nada dele lá). */
  resumoEscrito?: number | null;
  /** O "model" que o agente deixou no settings.json (null: nada dele lá). */
  modeloEscrito?: string | null;
  /** O "model" que a pessoa tinha antes do agente mexer (null: não tinha a chave). Volta quando a conta fica sem modelo. */
  modeloOriginal?: string | null;
  /** O modelo de cada conta da nuvem, pelo id dela (null: sem modelo). Conta fora daqui: a nuvem ainda não disse. */
  modelos?: Record<string, string | null>;
  /** Saída enxuta ligada neste computador (o painel liga; o mod lê pela ponte). */
  enxugar?: boolean;
  /** O DISABLE_AUTOUPDATER do `env` do settings.json é do agente (escolha "só pelo painel" do assistente). */
  assistenteDesligouAuto?: boolean;
  /** Quando o agente rodou o `claude update` sozinho pela última vez (epoch em segundos). */
  assistenteConferidoEm?: number;
  /** A última atualização do assistente de código feita pelo agente (a pedido do painel ou sozinho). */
  assistenteUltima?: UltimaAtualizacaoAssistente | null;
  /**
   * Conta que não roda o modelo das sessões deste computador (sem créditos de uso), pelo id local: fora da escolha
   * até `ate` (epoch em segundos). Sem nuvem é esta a marca; com nuvem, a da nuvem (contas_sem_modelo) decide.
   */
  semModelo?: Record<string, { modelo: string; ate: number }>;
}

export interface UltimaAtualizacaoAssistente {
  /** epoch em segundos */
  em: number;
  ok: boolean;
  de: string | null;
  para: string | null;
  sozinho: boolean;
  erro?: string;
}

export const CONFIG_INICIAL: ConfigLocal = {
  auto: true,
  aviso: 90,
  troca: 95,
  modo: "limiar",
  rodizio: { minutos: 90, ordem: "aleatoria" },
  retomarHeadless: false,
  esperaEntreTrocasS: 90,
  intervaloS: 5,
  som: true,
  resumo: 180_000,
};

export function estadoInicial(): EstadoLocal {
  return {
    formato: 1,
    ativa: null,
    proxima: null,
    versao: 0,
    trocadaEm: 0,
    contas: {},
    eventos: [],
    fila: [],
    identidades: {},
    config: clonar(CONFIG_INICIAL),
    proximoRodizioEm: null,
    historico: {},
    linhaContas: [],
    nuvem: { computadorId: null, atribuicaoVersao: 0, atribuicaoConta: null },
  };
}

export function carregarEstado(caminho: string): EstadoLocal {
  return comBase(lerJson<Partial<EstadoLocal>>(caminho));
}

function comBase(lido: Partial<EstadoLocal> | null): EstadoLocal {
  const base = estadoInicial();
  if (!lido || typeof lido !== "object" || Array.isArray(lido)) return base;
  return {
    ...base,
    ...lido,
    config: { ...base.config, ...(lido.config ?? {}) },
    nuvem: { ...base.nuvem, ...(lido.nuvem ?? {}) },
  };
}

/** A cópia boa do estado, ao lado dele: a do último estado lido inteiro, refeita quando a lista de contas muda. */
export function copiaBoaDo(caminho: string): string {
  return `${caminho}.bom`;
}

export interface Recuperacao {
  /** Onde ficou o arquivo ilegível (guardado como prova, nunca apagado). */
  estragado: string | null;
  /** De quando é a cópia boa que voltou (null: não havia cópia legível). */
  copiaDe: number | null;
}

/**
 * O estado na partida do agente. Ilegível (vazio ou com bytes nulos depois de uma queda de energia, relato de um usuário
 * de 22/10/2026), ele não vira um estado em branco calado: o arquivo estragado fica guardado ao lado e volta a cópia boa.
 * Sem cópia, começa em branco e as contas voltam pelas pastas. Só o agente chama isto (a linha de comando só lê).
 */
export function carregarEstadoDoAgente(caminho: string, agoraMs = Date.now()): { estado: EstadoLocal; recuperacao: Recuperacao | null } {
  if (!fs.existsSync(caminho)) return { estado: estadoInicial(), recuperacao: null };
  const lido = lerJson<Partial<EstadoLocal>>(caminho);
  if (lido && typeof lido === "object" && !Array.isArray(lido)) {
    const estado = comBase(lido);
    try {
      salvarCopiaBoa(caminho, estado);
    } catch {
      // sem a cópia nova, a de antes continua valendo
    }
    return { estado, recuperacao: null };
  }
  const carimbo = new Date(agoraMs).toISOString().replace(/[:.]/g, "-");
  let estragado: string | null = `${caminho}.estragado-${carimbo}`;
  try {
    fs.renameSync(caminho, estragado);
  } catch {
    estragado = null;
  }
  const bom = copiaBoaDo(caminho);
  const copia = lerJson<Partial<EstadoLocal>>(bom);
  if (copia && typeof copia === "object" && !Array.isArray(copia)) {
    let copiaDe = agoraMs;
    try {
      copiaDe = fs.statSync(bom).mtimeMs;
    } catch {
      // fica a hora de agora
    }
    return { estado: comBase(copia), recuperacao: { estragado, copiaDe } };
  }
  return { estado: estadoInicial(), recuperacao: { estragado, copiaDe: null } };
}

export function salvarCopiaBoa(caminho: string, estado: EstadoLocal): void {
  gravarJson(copiaBoaDo(caminho), estado);
}

export function salvarEstado(caminho: string, estado: EstadoLocal): void {
  gravarJson(caminho, estado);
}

export function novaConta(id: string, perfil: Perfil, pasta: string, agora: number): ContaLocal {
  return {
    id,
    contaId: null,
    email: (perfil.email ?? "").toLowerCase(),
    org: perfil.org,
    accountUuid: perfil.accountUuid,
    orgUuid: perfil.orgUuid,
    plano: null,
    tier: perfil.tier,
    pasta,
    pausada: false,
    precisaLogin: false,
    conectadaEm: agora,
    janelas: [],
    lidoEm: null,
    fonte: null,
    tokenExpiraEm: null,
    erro: null,
    versaoCofre: null,
  };
}
