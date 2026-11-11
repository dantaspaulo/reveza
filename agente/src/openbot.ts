// O OpenBot (openbot.run) roda agentes que conversam pelo Claude Code. Quando a conta bate o limite no meio de um turno,
// o turno cortado fica cortado: o OpenBot só abre o programa do agente quando chega mensagem ou rotina (medido em
// 10/11/2026: 12 conversas cortadas às 20:58, nenhuma continuou sozinha quando o crédito voltou). E uma cópia aberta
// pelo Reveza com `claude --resume -p` trabalharia junto com a do OpenBot (a 0.16.1 parou com isso). O caminho certo é
// mandar a continuação pelo próprio OpenBot, ao chat principal do agente, uma vez por corte.
//
// Só leitura do banco do OpenBot, para saber se a conversa cortada é o chat principal de um agente agora (rodada de
// rotina roda numa sessão própria, temporária, que o OpenBot não guarda: essa fica com a próxima rodada da rotina). A
// mensagem vai pelo comando que o OpenBot traz para scripts locais (`openbot-cli run`), que só enfileira (sem --wait).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Executor } from "./util/executor.js";

const SESSAO_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENTE_VALIDO = /^[\w-]{1,100}$/;
/** O comando do OpenBot: 0 enfileirou, 1 recusou, 2 linha errada, 5 OpenBot fora do ar ou agente não achado. */
export const OPENBOT_CODIGOS: Record<number, string> = {
  1: "o OpenBot recusou a mensagem",
  2: "o comando do OpenBot não aceitou a linha",
  5: "o OpenBot não respondeu, ou o agente não tem scripts locais ligados",
};

export interface OpenBot {
  /**
   * O agente do OpenBot cujo chat principal roda nesta conversa do assistente agora (a sessão ativa dele), ou null:
   * conversa de rodada de rotina, conversa antiga do agente ou OpenBot que não dá para ler.
   */
  chatPrincipal(sessao: string): string | null;
  /** Manda o texto ao chat principal do agente (só enfileira). `chave`: a mesma chave não entra duas vezes. */
  continuar(agente: string, texto: string, chave: string): Promise<number>;
}

export interface LocaisOpenBot {
  banco: string;
  comando: string;
}

/** Onde o OpenBot guarda o banco e o comando para scripts locais (só no macOS por enquanto), ou null sem OpenBot. */
export function locaisDoOpenBot(home: string, plataforma: NodeJS.Platform = process.platform): LocaisOpenBot | null {
  if (plataforma !== "darwin") return null;
  const banco = path.join(home, "Library", "Application Support", "OpenBot", "openbot.db");
  const comando = ["/Applications", path.join(home, "Applications")]
    .map((d) => path.join(d, "OpenBot.app", "Contents", "Resources", "cli", "openbot-cli.mjs"))
    .find((c) => fs.existsSync(c));
  return comando && fs.existsSync(banco) ? { banco, comando } : null;
}

/** A consulta do chat principal: a sessão do assistente ativa ligada à conversa (thread) de um agente. */
export function consultaDoChatPrincipal(sessao: string): string | null {
  if (!SESSAO_VALIDA.test(sessao)) return null;
  return (
    "SELECT a.agent_id FROM projection_provider_sessions s JOIN projection_agents a ON a.thread_id = s.thread_id " +
    `WHERE s.provider = 'claude' AND s.external_session_id = '${sessao.toLowerCase()}' AND s.state = 'active' LIMIT 1;`
  );
}

export class OpenBotLocal implements OpenBot {
  constructor(
    private locais: LocaisOpenBot,
    private exec: Executor,
    private node: string = process.execPath,
    private sqlite = "/usr/bin/sqlite3",
  ) {}

  chatPrincipal(sessao: string): string | null {
    const sql = consultaDoChatPrincipal(sessao);
    if (!sql) return null;
    try {
      // -readonly: o Reveza nunca escreve no banco do OpenBot; .timeout: espera um instante se ele estiver gravando
      const saida = execFileSync(this.sqlite, ["-readonly", "-bail", "-noheader", "-list", "-cmd", ".timeout 2000", this.locais.banco, sql], {
        encoding: "utf8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const agente = saida.split("\n")[0]!.trim();
      return AGENTE_VALIDO.test(agente) ? agente : null;
    } catch {
      return null;
    }
  }

  async continuar(agente: string, texto: string, chave: string): Promise<number> {
    if (!AGENTE_VALIDO.test(agente)) return 2;
    const r = await this.exec.rodar([this.node, this.locais.comando, "run", agente, "-", "--id", chave.slice(0, 120)], {
      entrada: texto,
      timeoutMs: 90_000,
    });
    return r.codigo;
  }
}

/** O OpenBot deste computador, ou null quando ele não está instalado aqui. */
export function openBotDoComputador(home: string, exec: Executor): OpenBot | null {
  const locais = locaisDoOpenBot(home);
  return locais ? new OpenBotLocal(locais, exec) : null;
}

/**
 * O pedido de verdade dentro do texto que o OpenBot manda ao assistente: o que vem depois de "--- current message ---"
 * (conversa nova, com o histórico em cima) e sem os blocos de instrução que ele põe na frente (`<openbot_turn_style>`).
 */
export function pedidoDoTexto(texto: string): string {
  const marca = "--- current message ---";
  const i = texto.lastIndexOf(marca);
  let s = i >= 0 ? texto.slice(i + marca.length) : texto;
  const bloco = /^\s*<([a-z_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/i;
  for (let n = 0; n < 20 && bloco.test(s); n++) s = s.replace(bloco, "");
  return s.trim();
}

/**
 * As mensagens automáticas que não se continuam (o remetente as repete sozinho): uma por linha em
 * <base>/retomar-ignorar.txt, comparadas com o começo do pedido cortado. Linhas vazias e com # são ignoradas.
 */
export function lerIgnorar(arquivo: string): string[] {
  try {
    return fs
      .readFileSync(arquivo, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .slice(0, 50)
      .map((l) => l.slice(0, 200));
  } catch {
    return [];
  }
}
