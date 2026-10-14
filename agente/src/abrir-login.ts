// O "navegador" que o agente dá ao login do Claude Code (variável BROWSER): recebe o endereço do login oficial (o do
// retorno pelo localhost, que termina sozinho), abre numa janela anônima e conta ao agente onde abriu (arquivo da
// variável REVEZA_LOGIN_ABERTO: só o navegador, nunca o endereço). Sem navegador com janela privada, ou com
// REVEZA_LOGIN_NAVEGADOR=normal, abre o navegador de sempre. Ver navegador.ts.
//
// Uso (quem chama é o Claude Code): node abrir-login.js <endereço>

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sistemaAtual } from "./config.js";
import { comandoPadrao, comandoPrivado, ehWsl, enderecoDoLogin, semTela } from "./navegador.js";
import type { Sistema } from "./config.js";

/** O que o agente lê da pasta do login: se abriu, em qual navegador e se foi janela privada. */
export interface Abertura {
  aberto: boolean;
  navegador: string | null;
  privado: boolean;
}

function contar(env: NodeJS.ProcessEnv, a: Abertura): void {
  if (!env.REVEZA_LOGIN_ABERTO) return;
  try {
    fs.writeFileSync(env.REVEZA_LOGIN_ABERTO, JSON.stringify(a), { mode: 0o600 });
  } catch {
    // sem o aviso, o painel diz o texto de sempre (endereço e código)
  }
}

export function abrir(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  iniciar = spawn,
  sistema: Sistema = sistemaAtual(),
  existe?: (p: string) => boolean,
  wsl = sistema === "linux" && ehWsl(env),
): number {
  const url = enderecoDoLogin(argv[0]);
  if (!url) return 2; // só o login oficial abre por aqui
  if (semTela(sistema, env, wsl)) {
    contar(env, { aberto: false, navegador: null, privado: false });
    return 3;
  }
  const privado = env.REVEZA_LOGIN_NAVEGADOR === "normal" ? null : comandoPrivado(sistema, url, existe, env, undefined, wsl);
  const cmd = privado?.argv ?? comandoPadrao(sistema, url, wsl);
  try {
    const filho = iniciar(cmd[0]!, cmd.slice(1), { detached: true, stdio: "ignore" });
    // "abri" só depois que o programa começou de verdade: sem ele (o xdg-open que não existe no WSL), o erro chega
    // depois, e o terminal dizia que abriu sem abrir nada
    filho.on("spawn", () => contar(env, { aberto: true, navegador: privado?.navegador ?? null, privado: !!privado }));
    filho.on("error", () => contar(env, { aberto: false, navegador: null, privado: false }));
    filho.unref();
  } catch {
    contar(env, { aberto: false, navegador: null, privado: false });
    return 1;
  }
  return 0;
}

const chamadoDireto = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (chamadoDireto) process.exitCode = abrir(process.argv.slice(2));
