// A conversa ainda tem processo vivo neste computador? Antes de abrir `claude --resume <sessão> -p`, a retomada confere:
// o processo que bateu o limite pode seguir vivo, relendo o login e trabalhando na conta nova, e uma retomada anterior
// pode estar no meio do trabalho. Uma segunda cópia na mesma conversa faz o mesmo trabalho de novo (10/11/2026: um
// `claude -p` de hora em hora foi reaberto duas vezes, em duas trocas seguidas, com o processo original ainda vivo, e
// as cópias repetiram registros e avisos).

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Uma linha do `ps` com um destes antes da opção é o assistente (o binário nativo, o cli.js do npm, um sh -c). */
const ASSISTENTE = /claude/i;
const OPCOES = new Set(["--resume", "-r", "--session-id"]);
/** O registro de sessões do assistente tem um arquivo pequeno por processo; mais que isto, algo saiu do normal. */
const REGISTRO_MAX = 2000;

/**
 * Os processos do `ps -A -o pid= -o args=` que abrem esta conversa pela linha de comando (`--resume <id>`, `-r <id>`,
 * `--session-id <id>`, com espaço ou com `=`). Só conta a linha em que o assistente vem antes da opção: um `grep` com o
 * mesmo texto não é uma cópia da conversa.
 */
export function pidsNaTabela(tabela: string, sessao: string, eu = process.pid): number[] {
  const pids: number[] = [];
  for (const linha of tabela.split("\n")) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(linha);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === eu) continue;
    const args = m[2]!.trim().split(/\s+/);
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      const abre = (OPCOES.has(a) && args[i + 1] === sessao) || a === `--resume=${sessao}` || a === `--session-id=${sessao}`;
      if (abre && args.slice(0, i).some((x) => ASSISTENTE.test(x))) {
        pids.push(pid);
        break;
      }
    }
  }
  return pids;
}

/**
 * Os processos vivos desta conversa pelo registro que o próprio assistente mantém (`~/.claude/sessions/<pid>.json`, com
 * `sessionId`): pega também o processo original, que não traz o id na linha de comando, e o `-p` aberto com `--resume`
 * (o registro guarda o id da conversa retomada). Com a tabela do `ps`, o número precisa ser do assistente ainda: o
 * arquivo de um processo que morreu sem apagá-lo pode apontar para um número que outro programa pegou depois.
 */
export function pidsNoRegistro(dir: string, sessao: string, vivo: (pid: number) => boolean, tabela: string | null, eu = process.pid): number[] {
  let nomes: string[];
  try {
    nomes = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).slice(0, REGISTRO_MAX);
  } catch {
    return [];
  }
  const doAssistente = tabela === null ? null : new Map<number, boolean>();
  if (doAssistente && tabela !== null) {
    for (const linha of tabela.split("\n")) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(linha);
      if (m) doAssistente.set(Number(m[1]), ASSISTENTE.test(m[2]!));
    }
  }
  const pids: number[] = [];
  for (const n of nomes) {
    let j: { pid?: unknown; sessionId?: unknown };
    try {
      const arq = path.join(dir, n);
      if (fs.statSync(arq).size > 64 * 1024) continue;
      j = JSON.parse(fs.readFileSync(arq, "utf8")) as typeof j;
    } catch {
      continue;
    }
    if (j.sessionId !== sessao || typeof j.pid !== "number" || !Number.isInteger(j.pid) || j.pid <= 0 || j.pid === eu) continue;
    if (doAssistente && doAssistente.get(j.pid) !== true) continue;
    if (vivo(j.pid)) pids.push(j.pid);
  }
  return pids;
}

export function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `pid args` de todos os processos (macOS e Linux); null no Windows ou sem o `ps`. */
export function tabelaDoPs(windows: boolean): string | null {
  if (windows) return null;
  try {
    return execFileSync("ps", ["-ww", "-A", "-o", "pid=", "-o", "args="], { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Um processo vivo desta conversa neste computador, ou null. `projetos` é a pasta das transcrições
 * (`~/.claude/projects`); o registro de sessões mora ao lado dela (`~/.claude/sessions`).
 */
export function processoDaSessao(sessao: string, projetos: string, windows: boolean): number | null {
  const tabela = tabelaDoPs(windows);
  const pela = tabela === null ? [] : pidsNaTabela(tabela, sessao);
  if (pela.length) return pela[0]!;
  const reg = pidsNoRegistro(path.join(path.dirname(projetos), "sessions"), sessao, processoVivo, tabela);
  return reg[0] ?? null;
}

/**
 * A conversa parou num erro da API (o limite de uso, que o assistente grava como resposta sua com
 * `isApiErrorMessage`)? Lê o fim da transcrição e olha a última resposta do assistente. Serve para a retomada que
 * esperou o processo sair: se depois do limite ele seguiu trabalhando na conta nova e terminou, a última resposta é
 * normal e a conversa não precisa voltar. Sem transcrição, ou sem nenhuma resposta no pedaço lido: null (não dá para
 * saber).
 */
export function parouNoErro(projetos: string, sessao: string, ate = 2 * 1024 * 1024): boolean | null {
  let pastas: string[];
  try {
    pastas = fs.readdirSync(projetos);
  } catch {
    return null;
  }
  for (const p of pastas) {
    const arq = path.join(projetos, p, `${sessao}.jsonl`);
    let fd: number;
    try {
      fd = fs.openSync(arq, "r");
    } catch {
      continue;
    }
    try {
      const tam = fs.fstatSync(fd).size;
      const ler = Math.min(tam, ate);
      const buf = Buffer.alloc(ler);
      fs.readSync(fd, buf, 0, ler, tam - ler);
      const linhas = buf.toString("utf8").split("\n");
      for (let i = linhas.length - 1; i >= 0; i--) {
        const linha = linhas[i]!.trim();
        if (!linha.startsWith("{")) continue;
        let j: { type?: unknown; sessionId?: unknown; isApiErrorMessage?: unknown; isSidechain?: unknown };
        try {
          j = JSON.parse(linha) as typeof j;
        } catch {
          continue;
        }
        if (j.type !== "assistant" || j.isSidechain === true || (j.sessionId !== undefined && j.sessionId !== sessao)) continue;
        return j.isApiErrorMessage === true;
      }
      return null;
    } finally {
      fs.closeSync(fd);
    }
  }
  return null;
}
