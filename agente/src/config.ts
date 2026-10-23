// Caminhos e constantes do agente. Tudo do agente mora em ~/.reveza (ou REVEZA_HOME); o assistente segue no lugar dele.

import * as os from "node:os";
import * as path from "node:path";

export const VERSAO = "0.10.2";
export const PORTA_PADRAO = 7788;
/** No modo sombra o agente roda ao lado do roteador antigo, que já ocupa a 7788. */
export const PORTA_SOMBRA = 7789;

export type Sistema = "macos" | "linux" | "windows";

export function sistemaAtual(plataforma: NodeJS.Platform = process.platform): Sistema {
  if (plataforma === "darwin") return "macos";
  if (plataforma === "win32") return "windows";
  return "linux";
}

export interface Caminhos {
  home: string;
  /** ~/.reveza */
  base: string;
  /** ~/.reveza/contas: uma pasta por conta, que vira o CLAUDE_CONFIG_DIR dela */
  contas: string;
  estado: string;
  logs: string;
  log: string;
  registro: string;
  /** Chave local da ponte (mod e linha de comando mandam no cabeçalho X-Reveza-Chave). */
  ponteChave: string;
  segredos: string;
  permitidas: string;
  /**
   * Arquivo da liberação sem perguntar da 0.1.x (`reveza ligar --painel ligar`), que deixava a nuvem autorizar sozinha.
   * Saiu na 0.2.0: o agente não lê mais; `reveza ligar --painel ...` só o apaga.
   */
  ligarPeloPainel: string;
  /** Pasta de configuração que as sessões usam (onde fica o .credentials.json fora do macOS). */
  principalDir: string;
  /** ~/.claude.json, com o oauthAccount da conta em uso */
  claudeJson: string;
  projetos: string;
}

export function caminhos(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): Caminhos {
  const base = env.REVEZA_HOME || path.join(home, ".reveza");
  const principalDir = path.join(home, ".claude");
  return {
    home,
    base,
    contas: path.join(base, "contas"),
    estado: path.join(base, "estado.json"),
    logs: path.join(base, "logs"),
    log: path.join(base, "logs", "agente.log"),
    registro: path.join(base, "registro"),
    ponteChave: path.join(base, "ponte.chave"),
    segredos: path.join(base, "segredos"),
    permitidas: path.join(base, "contas-permitidas.txt"),
    ligarPeloPainel: path.join(base, "ligar-pelo-painel"),
    principalDir,
    claudeJson: path.join(home, ".claude.json"),
    projetos: path.join(principalDir, "projects"),
  };
}

// Tempos (segundos), herdados do roteador que já roda.
export const CICLO_S = 15;
export const BUSCA_S = 5;
export const LER_ATIVA_S = 60;
/** Sessão na fila há mais que isso não é retomada sozinha (a do terminal também tem prazo, como a interativa). */
export const FILA_VALIDA_S = 2 * 3600;
/** Conta em uso perto do gatilho (no aviso ou a 10 pontos da troca): lê a cada ciclo, para trocar antes de esgotar. */
export const LER_ATIVA_PERTO_S = 15;
export const LER_ESTACIONADA_S = 300;
export const LER_ESTACIONADA_AVISO_S = 120;
/** No modo sombra as leituras de uso ficam 5 vezes mais espaçadas (o outro gestor já lê as mesmas contas). */
export const FATOR_LEITURA_SOMBRA = 5;
export const MEDIDA_FRESCA_S = 180;
export const IGNORAR_MEDIDA_APOS_TROCA_S = 30;
export const ESPERA_ENTRE_TROCAS_S = 90;
export const LEITURA_VALIDA_S = 900;
export const RECUO_429_S = 600;
export const CONFERIR_TROCA_MS = 5000;
export const RENOVAR_ANTES_S = 300;
export const VENCIDO_EM_S = 120;
export const POSSE_S = 120;
/** Cada passo da renovação de uma conta parada (o `auth status` e o `-p` curto) espera até isto. */
export const RENOVAR_PASSO_S = 120;
/**
 * Posse curta (leitura ou renovação de conta parada): cobre os dois passos da renovação, para ela não vencer no meio e
 * outro computador renovar o mesmo login ao mesmo tempo (21/10/2026: com 90 s, o cofre recusou o login renovado).
 */
export const POSSE_CURTA_S = 2 * RENOVAR_PASSO_S + 60;
export const COMANDO_VALIDO_S = 120;
export const HISTORICO_PASSO_S = 300;
export const HISTORICO_JANELA_S = 24 * 3600;
export const RITMO_JANELA_S = 3600;
