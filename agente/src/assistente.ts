// A versão do assistente de código (o Claude Code) em cada computador. Pedido do Paulo, 15/10/2026: "temos dois pcs, e
// eles estão com versões diferentes". A escolha é da instalação (`assistente_atualizar`, no painel):
//   padrao   o Reveza não mexe: o assistente segue o jeito dele (a instalação de fábrica se atualiza sozinha quando
//            uma sessão abre);
//   sozinho  o agente roda `claude update` de 6 em 6 horas, num momento calmo: todos os computadores ficam na mais
//            nova, também os que passam dias sem sessão aberta (o assistente só se confere quando está aberto);
//   manual   o agente desliga a atualização automática do assistente e a versão só muda pelo Atualizar do painel.
//
// Como (documentação oficial, code.claude.com/docs/en/setup e env-vars, conferida em 15/10/2026): `DISABLE_AUTOUPDATER`
// no `env` do settings.json do usuário só para a conferência de fundo; o `claude update` segue funcionando com ela, e
// atualiza a instalação nativa, a do npm e a do Homebrew (os gerenciadores de pacote do Linux precisam de root e
// respondem com erro, que vai ao painel). Sessões abertas seguem na versão em que começaram.
//
// O agente só mexe na variável que ele mesmo escreveu: um DISABLE_AUTOUPDATER (ou DISABLE_UPDATES) que a pessoa pôs à
// mão é dela, e fica.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { apagarSemErro } from "./util/arquivos.js";

export type ModoAssistente = "padrao" | "sozinho" | "manual";

/** De quanto em quanto tempo o agente roda o `claude update` sozinho (escolha "sozinho"). */
export const ASSISTENTE_CONFERIR_S = 6 * 3600;
/** Quanto o `claude update` pode levar (baixa o programa novo; a documentação dá 10 minutos ao download). */
export const ASSISTENTE_UPDATE_MS = 12 * 60_000;

/** A escolha gravada na nuvem; valor que não se conhece vale o padrão (o Reveza não mexe). */
export function modoAssistente(v: unknown): ModoAssistente {
  return v === "sozinho" || v === "manual" ? v : "padrao";
}

export interface ResultadoAutoUpdater {
  /** O DISABLE_AUTOUPDATER do arquivo é do agente. */
  escrito: boolean;
  /** Se o arquivo mudou agora. */
  mudou: boolean;
  /** A pessoa tem um valor próprio na variável: o agente não mexe. */
  daPessoa: boolean;
}

const CHAVE = "DISABLE_AUTOUPDATER";

/**
 * Liga (`desligar` false) ou desliga a atualização automática do assistente pelo `env.DISABLE_AUTOUPDATER` do
 * settings.json. Só mexe no valor que o próprio agente escreveu (`escritoAntes`); arquivo ilegível, ou com um `env` que
 * não é objeto, fica como está.
 */
export function aplicarAutoUpdater(arquivo: string, desligar: boolean, escritoAntes: boolean): ResultadoAutoUpdater {
  const igual = { escrito: escritoAntes, mudou: false, daPessoa: false };
  let dados: Record<string, unknown> = {};
  let modo = 0o644;
  try {
    const v = JSON.parse(fs.readFileSync(arquivo, "utf8")) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return igual;
    dados = v as Record<string, unknown>;
    modo = fs.statSync(arquivo).mode & 0o777;
  } catch (e) {
    // sem arquivo, começa vazio; arquivo que não se lê (o Claude Code no meio de uma gravação?) fica para a próxima
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return igual;
  }
  if (dados.env !== undefined && (!dados.env || typeof dados.env !== "object" || Array.isArray(dados.env))) return igual;
  const env = { ...((dados.env as Record<string, unknown> | undefined) ?? {}) };
  const atual = env[CHAVE];
  // a pessoa escreveu (ou mudou o que o agente escreveu): é dela
  if (atual !== undefined && (!escritoAntes || atual !== "1")) return { escrito: false, mudou: false, daPessoa: true };
  if (desligar) {
    if (atual === "1") return { escrito: true, mudou: false, daPessoa: false };
    env[CHAVE] = "1";
  } else {
    if (atual === undefined) return { escrito: false, mudou: false, daPessoa: false };
    delete env[CHAVE];
  }
  if (Object.keys(env).length) dados.env = env;
  else delete dados.env;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp.reveza.${process.pid}.${randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + "\n", { mode: modo, flag: "wx" });
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    apagarSemErro(tmp);
    throw e;
  }
  return { escrito: desligar, mudou: true, daPessoa: false };
}

/**
 * Quem desligou a atualização automática deste computador: o agente (escolha "só pelo painel"), a pessoa (à mão, no
 * settings.json) ou ninguém. Só olha o settings.json do usuário, que é o que o agente escreve.
 */
export function autoDesligado(arquivo: string, escritoPeloAgente: boolean): "reveza" | "pessoa" | null {
  let env: Record<string, unknown> = {};
  try {
    const v = JSON.parse(fs.readFileSync(arquivo, "utf8")) as { env?: unknown };
    if (v?.env && typeof v.env === "object" && !Array.isArray(v.env)) env = v.env as Record<string, unknown>;
  } catch {
    return null;
  }
  const ligada = (x: unknown) => typeof x === "string" && x.trim() !== "" && !/^(0|false|no|off)$/i.test(x.trim());
  if (ligada(env.DISABLE_UPDATES)) return "pessoa";
  if (ligada(env[CHAVE])) return escritoPeloAgente && env[CHAVE] === "1" ? "reveza" : "pessoa";
  return null;
}

/** Uma linha curta do erro do `claude update` para o painel (a última que diz algo). */
export function erroDoUpdate(saida: string, erro: string, codigo: number): string {
  const linhas = `${erro}\n${saida}`
    .split(/\r?\n/)
    // sem cores de terminal
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  const util = linhas.find((l) => /error|erro|fail|denied|permission|EACCES|disabled/i.test(l)) ?? linhas.at(-1);
  return (util ?? `o claude update terminou com o código ${codigo}`).slice(0, 200);
}
