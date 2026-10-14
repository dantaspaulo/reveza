// O login oficial abre numa janela anônima deste computador e termina sozinho.
//
// Por quê (relato de usuário e do Paulo, 12/10/2026): "diz que abriu e não abriu", "abriu na conta errada" (vários
// perfis do Chrome; numa janela anônima deu certo) e "o link gerou um código e não tem onde colar".
//
// Como o `claude auth login` funciona (conferido no 2.1.293, sem terminal, como o agente roda): ele abre DOIS caminhos
// ao mesmo tempo e aceita o que chegar primeiro.
// - O navegador deste computador recebe o endereço com retorno pelo localhost: entrou na conta, o login termina
//   sozinho, sem código. Quem abre é o programa da variável BROWSER (sem ela, o navegador padrão, no perfil que estiver
//   aberto: daí a conta errada).
// - A saída imprime outro endereço, com retorno para a página do código ("If the browser didn't open, visit: ..."),
//   para outro aparelho: lá a página mostra um código, que volta pela entrada do processo (o painel e o terminal têm o
//   campo para colar desde a 0.3.3).
// O agente aponta BROWSER para o abrir-login.js, que abre o primeiro endereço numa janela anônima. Janela anônima é o
// "deslogar e limpar antes" sem mexer no navegador de todo dia da pessoa: não há conta aberta para o login cair na
// errada, e a conta pedida ainda é conferida no fim (logins.ts).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Sistema } from "./config.js";

/** Os domínios do login oficial (o Claude Code 2.1.29x abre em claude.com; antes, claude.ai). */
const DOMINIOS_DO_LOGIN = ["claude.com", "claude.ai", "anthropic.com"];

/** Só o endereço do login oficial, em https, sem usuário e senha nem porta: é o único que se abre aqui. */
export function enderecoDoLogin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    const oficial = DOMINIOS_DO_LOGIN.some((d) => host === d || host.endsWith(`.${d}`));
    return u.protocol === "https:" && !u.username && !u.password && !u.port && oficial ? u.toString() : null;
  } catch {
    return null;
  }
}

interface Candidato {
  nome: string;
  /** Caminho do programa (ou do app, no macOS). */
  caminho: string;
  /** A opção de janela privada do navegador. */
  privado: string;
}

/**
 * Os navegadores que abrem janela privada pela linha de comando, na ordem de preferência. Os caminhos seguem o sistema
 * pedido, não o de quem roda (os testes rodam os três sistemas em qualquer um).
 */
export function candidatos(sistema: Sistema, env: NodeJS.ProcessEnv = process.env, home = os.homedir(), wsl = false): Candidato[] {
  if (sistema === "macos") {
    const apps: [string, string, string][] = [
      ["Google Chrome", "Google Chrome.app", "--incognito"],
      ["Microsoft Edge", "Microsoft Edge.app", "--inprivate"],
      ["Brave", "Brave Browser.app", "--incognito"],
      ["Chromium", "Chromium.app", "--incognito"],
      ["Firefox", "Firefox.app", "-private-window"],
    ];
    return apps.flatMap(([nome, app, privado]) =>
      ["/Applications", path.posix.join(home, "Applications")].map((d) => ({ nome, caminho: path.posix.join(d, app), privado })),
    );
  }
  if (sistema === "windows") {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return [
      { nome: "Google Chrome", caminho: path.win32.join(pf, "Google", "Chrome", "Application", "chrome.exe"), privado: "--incognito" },
      { nome: "Google Chrome", caminho: path.win32.join(pf86, "Google", "Chrome", "Application", "chrome.exe"), privado: "--incognito" },
      { nome: "Google Chrome", caminho: path.win32.join(local, "Google", "Chrome", "Application", "chrome.exe"), privado: "--incognito" },
      { nome: "Microsoft Edge", caminho: path.win32.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), privado: "--inprivate" },
      { nome: "Microsoft Edge", caminho: path.win32.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"), privado: "--inprivate" },
      { nome: "Firefox", caminho: path.win32.join(pf, "Mozilla Firefox", "firefox.exe"), privado: "-private-window" },
    ];
  }
  const bins: [string, string, string][] = [
    ["Google Chrome", "google-chrome", "--incognito"],
    ["Google Chrome", "google-chrome-stable", "--incognito"],
    ["Chromium", "chromium", "--incognito"],
    ["Chromium", "chromium-browser", "--incognito"],
    ["Microsoft Edge", "microsoft-edge", "--inprivate"],
    ["Brave", "brave-browser", "--incognito"],
    ["Firefox", "firefox", "-private-window"],
  ];
  const dirs = (env.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(":").filter(Boolean);
  const doLinux = bins.flatMap(([nome, bin, privado]) => dirs.map((d) => ({ nome, caminho: path.posix.join(d, bin), privado })));
  // no WSL, o navegador da pessoa é o do Windows: vem antes de um navegador do Linux que esteja instalado
  return wsl ? [...DO_WINDOWS_NO_WSL, ...doLinux] : doLinux;
}

/** O disco C: visto de dentro do WSL. */
const C_NO_WSL = "/mnt/c";

/** Os navegadores do Windows, vistos de dentro do WSL (o WSL roda os .exe do Windows direto). */
const DO_WINDOWS_NO_WSL: Candidato[] = (
  [
    ["Google Chrome", "Program Files/Google/Chrome/Application/chrome.exe", "--incognito"],
    ["Google Chrome", "Program Files (x86)/Google/Chrome/Application/chrome.exe", "--incognito"],
    ["Microsoft Edge", "Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "--inprivate"],
    ["Microsoft Edge", "Program Files/Microsoft/Edge/Application/msedge.exe", "--inprivate"],
    ["Firefox", "Program Files/Mozilla Firefox/firefox.exe", "-private-window"],
  ] as const
).map(([nome, caminho, privado]) => ({ nome, caminho: path.posix.join(C_NO_WSL, caminho), privado }));

/**
 * O Linux do WSL (relato de 13/10/2026: "diz que abre o navegador, mas não abre"). Lá não há `xdg-open` nem navegador
 * do Linux, e o agente, como serviço do systemd, roda sem DISPLAY e sem as variáveis WSL_*: por isso a versão do kernel.
 */
export function ehWsl(env: NodeJS.ProcessEnv = process.env, versao = () => fs.readFileSync("/proc/sys/kernel/osrelease", "utf8")): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(versao());
  } catch {
    return false;
  }
}

/**
 * O comando que abre `url` numa janela privada do primeiro navegador que existe, ou null (então abre o navegador de
 * sempre, e o painel e o terminal ainda mostram o endereço e aceitam o código).
 */
export function comandoPrivado(
  sistema: Sistema,
  url: string,
  existe: (p: string) => boolean = fs.existsSync,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
  wsl = false,
): { navegador: string; argv: string[] } | null {
  const c = candidatos(sistema, env, home, wsl).find((x) => existe(x.caminho));
  if (!c) return null;
  // macOS: `open -na` entrega a janela nova ao navegador que já está aberto (ou abre ele)
  if (sistema === "macos") return { navegador: c.nome, argv: ["/usr/bin/open", "-na", c.caminho, "--args", c.privado, url] };
  return { navegador: c.nome, argv: [c.caminho, c.privado, url] };
}

/**
 * No Linux sem tela (servidor, serviço sem DISPLAY), não há navegador para abrir: o login segue pelo código. No WSL a
 * tela é a do Windows, que não precisa de DISPLAY.
 */
export function semTela(sistema: Sistema, env: NodeJS.ProcessEnv = process.env, wsl = false): boolean {
  return sistema === "linux" && !wsl && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

/** O navegador de sempre (quando não há um com janela privada). */
export function comandoPadrao(sistema: Sistema, url: string, wsl = false): string[] {
  if (sistema === "macos") return ["/usr/bin/open", url];
  if (sistema === "windows") return ["explorer.exe", url];
  if (wsl) return [path.posix.join(C_NO_WSL, "Windows", "explorer.exe"), url];
  return ["xdg-open", url];
}

/** Aspas de shell POSIX (o BROWSER do login é um script de shell que chama o abrir-login.js). */
export function aspasSh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
