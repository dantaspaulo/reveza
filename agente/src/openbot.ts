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
  /**
   * Os agentes deste OpenBot: a pasta de trabalho (caminho absoluto), o nome e o título (0.17.0: o painel liga a pasta
   * de um agente a uma empresa pelo título). Vazio só quando não há OpenBot neste computador; a leitura que falha
   * lança erro (0.21.0), para o agente manter a última lista em vez de tirar as pastas dos projetos.
   */
  agentes?(): AgenteOpenBot[];
  /** As pastas da barra lateral da última leitura boa (0.22.0). */
  pastas?(): PastaOpenBot[];
  /** Como foi a última leitura da barra (0.22.0): "ok", "velha" (vale a anterior) ou "sem_leitura" (nunca houve uma boa). */
  barraEstado?(): "ok" | "velha" | "sem_leitura";
}

export interface AgenteOpenBot {
  /** O id do agente no OpenBot (0.22.0), quando a consulta trouxe um válido. */
  id?: string;
  pasta: string;
  nome: string;
  titulo: string;
  /** As pastas da barra do OpenBot em que o agente está, da raiz até a dele (ids; 0.22.0). Sem pasta: ausente. */
  secoes?: string[];
}

/** O arquivo da barra lateral do OpenBot, na pasta do banco dele. */
export const BARRA_ARQUIVO = "openbot-sidebar-layout-v1.json";

/** Uma pasta da barra lateral do OpenBot (0.22.0). `pai`: a pasta de cima, ou null na raiz. */
export interface PastaOpenBot {
  id: string;
  nome: string;
  pai: string | null;
}

/** A barra lateral do OpenBot: as pastas e, de cada agente, a cadeia de pastas da raiz até a dele (ids). */
export interface BarraOpenBot {
  pastas: PastaOpenBot[];
  deAgente: Map<string, string[]>;
}

const PASTA_VALIDA = /^[\w-]{1,100}$/;
/** As versões do arquivo da barra que o Reveza conhece (a 2 desde o OpenBot de novembro de 2026). */
const BARRA_VERSOES = new Set([2]);
const BARRA_PASTAS_MAX = 500;
const BARRA_ATRIBUICOES_MAX = 2000;
const BARRA_NIVEIS_MAX = 10;
/** O arquivo da barra que falta por este tempo (duas leituras) é barra vazia, não uma regravação do OpenBot. */
const BARRA_AUSENTE_MS = 25_000;

/** Texto de fora: sem caracteres de controle, sem espaço nas pontas, curto. */
function textoCurto(v: unknown, max: number): string {
  return typeof v === "string" ? cortar(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim(), max) : "";
}

/** Corta sem deixar meio emoji no fim (a metade solta não vira JSON que a nuvem aceite). */
function cortar(s: string, max: number): string {
  return s.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

/**
 * A barra lateral do OpenBot (`openbot-sidebar-layout-v1.json`, ao lado do banco dele), lida só para leitura (0.22.0).
 * null: o arquivo não existe (barra vazia; pessoa sem pastas). Lança quando o texto não é a barra que o Reveza conhece
 * (JSON pela metade no meio de uma gravação, versão nova do OpenBot): quem chama mantém a última leitura boa, para não
 * tirar um agente do projeto dele. Pasta com id estranho fica de fora; pai que não existe vira raiz; ciclo de pais ou
 * mais de 10 níveis deixam os agentes dali sem pasta, porque o arquivo está fora do que se espera e não se adivinha.
 */
export function barraDoLayout(texto: string | null): BarraOpenBot {
  if (texto === null) return { pastas: [], deAgente: new Map() };
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error("a barra do OpenBot não veio em JSON");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("a barra do OpenBot não veio no formato conhecido");
  const o = j as Record<string, unknown>;
  if (typeof o.version !== "number" || !BARRA_VERSOES.has(o.version)) {
    throw new Error(`a barra do OpenBot veio numa versão desconhecida (versão ${String(o.version)})`);
  }
  const secoes = o.sections;
  const atrib = o.agentAssignments;
  if (!Array.isArray(secoes) || !atrib || typeof atrib !== "object" || Array.isArray(atrib)) {
    throw new Error("a barra do OpenBot não veio no formato conhecido");
  }
  const pastas: PastaOpenBot[] = [];
  const porId = new Map<string, PastaOpenBot>();
  for (const s of secoes) {
    if (pastas.length >= BARRA_PASTAS_MAX) break;
    if (!s || typeof s !== "object") continue;
    const x = s as Record<string, unknown>;
    if (typeof x.id !== "string" || !PASTA_VALIDA.test(x.id) || porId.has(x.id)) continue;
    const pai = typeof x.parentId === "string" && PASTA_VALIDA.test(x.parentId) ? x.parentId : null;
    const p: PastaOpenBot = { id: x.id, nome: textoCurto(x.name, 120), pai };
    pastas.push(p);
    porId.set(p.id, p);
  }
  // pai que não existe, ou a própria pasta, vira raiz (a nuvem e o painel fazem o mesmo)
  for (const p of pastas) if (p.pai !== null && (p.pai === p.id || !porId.has(p.pai))) p.pai = null;
  const cadeias = new Map<string, string[] | null>();
  const cadeiaDe = (id: string): string[] | null => {
    if (cadeias.has(id)) return cadeias.get(id)!;
    const ids: string[] = [];
    const vistos = new Set<string>();
    let atual = porId.get(id);
    let r: string[] | null = null;
    while (atual) {
      if (vistos.has(atual.id) || ids.length >= BARRA_NIVEIS_MAX) break;
      vistos.add(atual.id);
      ids.push(atual.id);
      if (atual.pai === null) {
        r = ids.reverse();
        break;
      }
      atual = porId.get(atual.pai);
    }
    cadeias.set(id, r);
    return r;
  };
  const deAgente = new Map<string, string[]>();
  let n = 0;
  for (const [agente, pasta] of Object.entries(atrib as Record<string, unknown>)) {
    if (++n > BARRA_ATRIBUICOES_MAX) break;
    if (!AGENTE_VALIDO.test(agente) || typeof pasta !== "string") continue;
    const c = cadeiaDe(pasta);
    if (c) deAgente.set(agente, [...c]);
  }
  return { pastas, deAgente };
}

/**
 * A consulta dos agentes (só leitura): id (0.22.0, para achar a pasta da barra), pasta, nome e título de cada um, em
 * JSON. Linha com JSON estragado fica de fora (senão a consulta inteira falha).
 */
export const CONSULTA_AGENTES =
  "SELECT agent_id AS id, json_extract(agent_json, '$.workspacePath') AS pasta, json_extract(agent_json, '$.name') AS nome, " +
  "json_extract(agent_json, '$.title') AS titulo FROM projection_agents WHERE json_valid(agent_json) LIMIT 500;";

/** As linhas da consulta, conferidas: pasta absoluta, nome e título como texto curto. */
export function agentesDaSaida(saida: string): AgenteOpenBot[] {
  let linhas: unknown;
  try {
    linhas = JSON.parse(saida.trim() || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(linhas)) return [];
  const texto = (v: unknown, max: number) => (typeof v === "string" ? cortar(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim(), max) : "");
  const r: AgenteOpenBot[] = [];
  for (const l of linhas.slice(0, 500)) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const pasta = texto(o.pasta, 4096);
    if (!pasta.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(pasta)) continue; // só caminho absoluto (macOS, Linux, Windows)
    const a: AgenteOpenBot = { pasta, nome: texto(o.nome, 120), titulo: texto(o.titulo, 200) };
    if (typeof o.id === "string" && AGENTE_VALIDO.test(o.id)) a.id = o.id;
    r.push(a);
  }
  return r;
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

/**
 * As conversas do OpenBot carregam a configuração do assistente (os hooks e plugins de `~/.claude`, onde mora o mod)?
 * Ele tem a opção "Usar minha configuração do Claude Code", desligada de fábrica: desligada, as conversas dele rodam
 * sem o mod, e o Reveza não vê o limite nem o uso ao vivo delas (16/11/2026: um computador que só usava o OpenBot nunca
 * avisou um limite e nunca trocou sozinho). O arquivo da opção só existe depois que alguém mexe nela: sem ele, desligada.
 * null: sem OpenBot neste computador (por enquanto só no macOS).
 */
export function openBotCarregaConfiguracao(home: string, plataforma: NodeJS.Platform = process.platform): boolean | null {
  if (plataforma !== "darwin") return null;
  const pasta = path.join(home, "Library", "Application Support", "OpenBot");
  if (!fs.existsSync(path.join(pasta, "openbot.db"))) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(pasta, "openbot-claude-user-setup-v1.json"), "utf8")) as { enabled?: unknown } | null;
    return j?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * O aviso do doctor sobre a barra lateral do OpenBot (0.22.0): o motivo quando o arquivo existe e não dá para ler (JSON
 * pela metade, versão nova do OpenBot), ou null (sem OpenBot, sem a barra, barra boa, fora do macOS). Só leitura.
 */
export function avisoDaBarra(home: string, plataforma: NodeJS.Platform = process.platform): string | null {
  if (plataforma !== "darwin") return null;
  const pasta = path.join(home, "Library", "Application Support", "OpenBot");
  if (!fs.existsSync(path.join(pasta, "openbot.db"))) return null;
  const arquivo = path.join(pasta, BARRA_ARQUIVO);
  try {
    if (fs.statSync(arquivo).size > 4 << 20) return "a barra do OpenBot está grande demais";
    barraDoLayout(fs.readFileSync(arquivo, "utf8"));
    return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return (e as Error).message;
  }
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
    private agora: () => number = Date.now,
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

  /**
   * Os agentes do banco do OpenBot. Sem o banco, não há OpenBot aqui: lista vazia. A leitura que falha (banco trancado,
   * consulta que não roda depois de uma atualização dele, saída fora do JSON) lança: a lista vazia diria "nenhum agente"
   * e tiraria a pasta de um agente do projeto dele (plano B versão 2, regra 1).
   */
  agentes(): AgenteOpenBot[] {
    if (!fs.existsSync(this.locais.banco)) return [];
    const saida = execFileSync(this.sqlite, ["-readonly", "-bail", "-json", "-cmd", ".timeout 2000", this.locais.banco, CONSULTA_AGENTES], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 4 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    try {
      if (!Array.isArray(JSON.parse(saida || "[]"))) throw new Error("não é lista");
    } catch {
      throw new Error("a leitura dos agentes do OpenBot não veio em JSON");
    }
    const lista = agentesDaSaida(saida);
    const barra = this.lerBarra();
    for (const a of lista) {
      const secoes = a.id ? barra.deAgente.get(a.id) : undefined;
      if (secoes) a.secoes = [...secoes];
    }
    return lista;
  }

  private barraBoa: BarraOpenBot | null = null;
  // nasce falha: antes da primeira leitura (ou com a dos agentes falhando antes dela) não se sabe nada da barra, e a
  // lista vazia das pastas apagaria as da nuvem (revisão da 0.22.0)
  private barraFalhou = true;
  /** Desde quando o arquivo da barra falta (ms), para a falta que dura virar barra vazia. */
  private barraAusenteDesde: number | null = null;

  /** As pastas da barra do OpenBot da última leitura boa (vazia sem pastas). */
  pastas(): PastaOpenBot[] {
    return (this.barraBoa?.pastas ?? []).map((p) => ({ ...p }));
  }

  /**
   * A última leitura da barra: "ok"; "velha" (falhou e vale a anterior; o doctor avisa); "sem_leitura" (ainda não lida,
   * ou falhou sem nunca ter havido uma boa: ninguém tem pasta, a nuvem mantém a cadeia que tinha, e a conversa de um
   * agente que pode ser de um projeto estrito pela pasta do OpenBot espera).
   */
  barraEstado(): "ok" | "velha" | "sem_leitura" {
    return !this.barraFalhou ? "ok" : this.barraBoa ? "velha" : "sem_leitura";
  }

  /**
   * A barra lateral do OpenBot, só leitura. A leitura que falha (JSON pela metade, versão nova do OpenBot, arquivo que
   * sumiu no meio de uma regravação) mantém a última boa; sem leitura boa antes, barra vazia e estado "sem_leitura". O
   * arquivo que falta em duas leituras com BARRA_AUSENTE_MS ou mais entre elas é barra vazia e boa (OpenBot sem pastas,
   * ou zerado): sem isso a nuvem guardaria para sempre as pastas de antes. Nunca lança: a barra estragada não pode
   * derrubar a lista dos agentes de quem nem usa pastas (a lista que falha deixa o agente sem certeza em todas as conversas).
   */
  private lerBarra(): BarraOpenBot {
    const arquivo = path.join(path.dirname(this.locais.banco), BARRA_ARQUIVO);
    try {
      let texto: string | null = null;
      try {
        if (fs.statSync(arquivo).size > 4 << 20) throw new Error("a barra do OpenBot está grande demais");
        texto = fs.readFileSync(arquivo, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`a barra do OpenBot não deu para ler: ${(e as Error).message}`);
        // a falta de agora pode ser o OpenBot regravando: só a que dura é barra vazia
        const agora = this.agora();
        if (this.barraAusenteDesde === null) this.barraAusenteDesde = agora;
        if (agora - this.barraAusenteDesde < BARRA_AUSENTE_MS) throw new Error("a barra do OpenBot não existe agora");
      }
      if (texto !== null) this.barraAusenteDesde = null;
      const b = barraDoLayout(texto);
      this.barraBoa = b;
      this.barraFalhou = false;
      return b;
    } catch {
      this.barraFalhou = true;
      return this.barraBoa ?? { pastas: [], deAgente: new Map() };
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
