// O login oficial numa janela anônima deste computador (termina sozinho) e o endereço com código para outro aparelho.
// Relato de 12/10/2026: o login abria no perfil do navegador logado em outra conta, e o endereço mostrado dava um
// código sem lugar para colar.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { abrir } from "../src/abrir-login.js";
import { ClaudeCli } from "../src/claudecli.js";
import { textoDoTerminal } from "../src/cli.js";
import { lerAbertura, textoDoLogin, TEXTO_DO_LOGIN } from "../src/logins.js";
import { candidatos, comandoPadrao, comandoPrivado, ehWsl, enderecoDoLogin, semTela } from "../src/navegador.js";
import { blob, ExecutorFalso, montar, type Montado } from "./falsos.js";

const URL_LOCAL = "https://claude.com/cai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A50123%2Fcallback&state=s";
const URL_CODIGO = "https://claude.com/cai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s";

let m: Montado | undefined;
const temporarias: string[] = [];
afterEach(() => {
  m?.limpar();
  m = undefined;
  for (const d of temporarias.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const pastaTemp = (nome = "reveza-login-") => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), nome));
  temporarias.push(d);
  return d;
};

describe("endereço do login", () => {
  test("só o login oficial, em https, sem usuário, senha nem porta", () => {
    for (const bom of [URL_LOCAL, "https://claude.ai/oauth/authorize?x=1", "https://console.anthropic.com/oauth/authorize"]) assert.ok(enderecoDoLogin(bom), bom);
    for (const ruim of [
      "http://claude.com/cai/oauth/authorize",
      "https://claude.com.mau.com/oauth",
      "https://mauclaude.com/oauth",
      "https://u:s@claude.com/oauth",
      "https://claude.com:8443/oauth",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "--incognito",
      "",
      42,
      null,
    ])
      assert.equal(enderecoDoLogin(ruim), null, String(ruim));
  });
});

describe("janela anônima", () => {
  test("macOS: prefere o Chrome; sem ele, o próximo que existe; sem nenhum, null", () => {
    const home = "/Users/x";
    const so = (...existem: string[]) => (p: string) => existem.includes(p);
    const chrome = comandoPrivado("macos", URL_LOCAL, so("/Applications/Firefox.app", "/Applications/Google Chrome.app"), {}, home);
    assert.deepEqual(chrome, {
      navegador: "Google Chrome",
      argv: ["/usr/bin/open", "-na", "/Applications/Google Chrome.app", "--args", "--incognito", URL_LOCAL],
    });
    const firefox = comandoPrivado("macos", URL_LOCAL, so("/Users/x/Applications/Firefox.app"), {}, home);
    assert.deepEqual(firefox?.argv, ["/usr/bin/open", "-na", "/Users/x/Applications/Firefox.app", "--args", "-private-window", URL_LOCAL]);
    assert.equal(comandoPrivado("macos", URL_LOCAL, so("/Applications/Microsoft Edge.app"), {}, home)?.argv[4], "--inprivate");
    assert.equal(comandoPrivado("macos", URL_LOCAL, so(), {}, home), null);
  });

  test("Linux: procura no PATH; Windows: nas pastas de programas", () => {
    const linux = comandoPrivado("linux", URL_LOCAL, (p) => p === "/usr/bin/chromium", { PATH: "/usr/local/bin:/usr/bin" });
    assert.deepEqual(linux, { navegador: "Chromium", argv: ["/usr/bin/chromium", "--incognito", URL_LOCAL] });
    const nomes = candidatos("windows", { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\L" }).map((c) => c.caminho);
    assert.ok(nomes.includes("C:\\PF\\Google\\Chrome\\Application\\chrome.exe"));
    assert.ok(nomes.includes("C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe"));
    assert.deepEqual(comandoPadrao("macos", URL_LOCAL), ["/usr/bin/open", URL_LOCAL]);
    assert.deepEqual(comandoPadrao("linux", URL_LOCAL), ["xdg-open", URL_LOCAL]);
  });

  test("Linux sem tela não abre navegador", () => {
    assert.equal(semTela("linux", {}), true);
    assert.equal(semTela("linux", { DISPLAY: ":0" }), false);
    assert.equal(semTela("linux", { WAYLAND_DISPLAY: "wayland-0" }), false);
    assert.equal(semTela("macos", {}), false);
  });

  test("WSL: abre a janela anônima do navegador do Windows, mesmo sem DISPLAY (o agente como serviço do systemd)", () => {
    const chrome = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
    const edge = "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    const so = (...existem: string[]) => (p: string) => existem.includes(p);
    assert.deepEqual(comandoPrivado("linux", URL_LOCAL, so(chrome, "/usr/bin/chromium"), { PATH: "/usr/bin" }, "/home/x", true), {
      navegador: "Google Chrome",
      argv: [chrome, "--incognito", URL_LOCAL],
    });
    assert.deepEqual(comandoPrivado("linux", URL_LOCAL, so(edge), { PATH: "/usr/bin" }, "/home/x", true)?.argv, [edge, "--inprivate", URL_LOCAL]);
    assert.equal(comandoPrivado("linux", URL_LOCAL, so(chrome), { PATH: "/usr/bin" }, "/home/x", false), null, "fora do WSL, nada de /mnt/c");
    assert.equal(semTela("linux", {}, true), false);
    assert.deepEqual(comandoPadrao("linux", URL_LOCAL, true), ["/mnt/c/Windows/explorer.exe", URL_LOCAL]);
  });

  test("WSL: pelas variáveis do WSL ou, sem elas (serviço do systemd), pela versão do kernel", () => {
    const falha = () => {
      throw new Error("sem /proc");
    };
    assert.equal(ehWsl({ WSL_DISTRO_NAME: "Ubuntu" }, falha), true);
    assert.equal(ehWsl({ WSL_INTEROP: "/run/WSL/1_interop" }, falha), true);
    assert.equal(ehWsl({}, () => "6.6.87.2-microsoft-standard-WSL2\n"), true);
    assert.equal(ehWsl({}, () => "6.8.0-45-generic\n"), false);
    assert.equal(ehWsl({}, falha), false);
  });
});

describe("abrir-login (o BROWSER do login)", () => {
  /** O spawn de mentira: o programa começa ("spawn"), não existe ("error", como o xdg-open no WSL) ou nem sai. */
  function espiao(falhar: false | "lancar" | "nao-existe" = false) {
    const chamadas: { cmd: string; args: string[]; op: unknown }[] = [];
    const iniciar = ((cmd: string, args: string[], op: unknown) => {
      if (falhar === "lancar") throw new Error("spawn falhou");
      chamadas.push({ cmd, args, op });
      const evento = falhar === "nao-existe" ? "error" : "spawn";
      return { on: (nome: string, f: (e?: Error) => void) => nome === evento && f(new Error("ENOENT")), unref: () => undefined };
    }) as unknown as typeof import("node:child_process").spawn;
    return { chamadas, iniciar };
  }

  test("abre numa janela anônima, solto, e avisa o navegador (nunca o endereço) num arquivo só do dono", () => {
    const d = pastaTemp();
    const aviso = path.join(d, ".login-aberto");
    const e = espiao();
    const r = abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso }, e.iniciar, "macos", (p) => p === "/Applications/Brave Browser.app");
    assert.equal(r, 0);
    assert.equal(e.chamadas.length, 1);
    assert.equal(e.chamadas[0]!.cmd, "/usr/bin/open");
    assert.deepEqual(e.chamadas[0]!.args, ["-na", "/Applications/Brave Browser.app", "--args", "--incognito", URL_LOCAL]);
    assert.deepEqual(e.chamadas[0]!.op, { detached: true, stdio: "ignore" });
    const texto = fs.readFileSync(aviso, "utf8");
    assert.deepEqual(JSON.parse(texto), { aberto: true, navegador: "Brave", privado: true });
    assert.ok(!texto.includes("claude.com"), "o endereço com o retorno local não fica no disco");
    if (process.platform !== "win32") assert.equal(fs.statSync(aviso).mode & 0o777, 0o600);
  });

  test("endereço que não é o login oficial não abre nada", () => {
    const d = pastaTemp();
    const e = espiao();
    assert.equal(abrir(["https://mau.com/x"], { REVEZA_LOGIN_ABERTO: path.join(d, "a") }, e.iniciar, "macos", () => true), 2);
    assert.equal(abrir([], {}, e.iniciar, "macos", () => true), 2);
    assert.equal(e.chamadas.length, 0);
    assert.equal(fs.existsSync(path.join(d, "a")), false);
  });

  test("REVEZA_LOGIN_NAVEGADOR=normal abre o navegador de sempre", () => {
    const d = pastaTemp();
    const aviso = path.join(d, "a");
    const e = espiao();
    assert.equal(abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso, REVEZA_LOGIN_NAVEGADOR: "normal" }, e.iniciar, "macos", () => true), 0);
    assert.equal(e.chamadas[0]!.cmd, "/usr/bin/open");
    assert.deepEqual(e.chamadas[0]!.args, [URL_LOCAL]);
    assert.deepEqual(JSON.parse(fs.readFileSync(aviso, "utf8")), { aberto: true, navegador: null, privado: false });
  });

  test("Linux sem tela e falha ao abrir: avisa que não abriu", () => {
    const d = pastaTemp();
    const aviso = path.join(d, "a");
    const e = espiao();
    assert.equal(abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso }, e.iniciar, "linux", () => true, false), 3);
    assert.equal(e.chamadas.length, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(aviso, "utf8")), { aberto: false, navegador: null, privado: false });
    const f = espiao("lancar");
    assert.equal(abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso, DISPLAY: ":0" }, f.iniciar, "linux", () => false, false), 1);
    assert.equal(JSON.parse(fs.readFileSync(aviso, "utf8")).aberto, false);
  });

  test("o programa que não existe (o xdg-open no WSL) não vira \"abri o navegador\"", () => {
    const d = pastaTemp();
    const aviso = path.join(d, "a");
    const e = espiao("nao-existe");
    abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso, DISPLAY: ":0" }, e.iniciar, "linux", () => false, false);
    assert.deepEqual(e.chamadas[0]!.args, [URL_LOCAL]);
    assert.deepEqual(JSON.parse(fs.readFileSync(aviso, "utf8")), { aberto: false, navegador: null, privado: false });
  });

  test("WSL sem DISPLAY: abre a janela anônima do Chrome do Windows", () => {
    const d = pastaTemp();
    const aviso = path.join(d, "a");
    const e = espiao();
    const chrome = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
    assert.equal(abrir([URL_LOCAL], { REVEZA_LOGIN_ABERTO: aviso, PATH: "/usr/bin" }, e.iniciar, "linux", (p) => p === chrome, true), 0);
    assert.equal(e.chamadas[0]!.cmd, chrome);
    assert.deepEqual(e.chamadas[0]!.args, ["--incognito", URL_LOCAL]);
    assert.deepEqual(JSON.parse(fs.readFileSync(aviso, "utf8")), { aberto: true, navegador: "Google Chrome", privado: true });
  });

  test("o aviso lido de volta só aceita os três campos, e nome de navegador sem nada estranho", () => {
    const d = pastaTemp();
    const a = path.join(d, "a");
    fs.writeFileSync(a, JSON.stringify({ aberto: true, navegador: "<img src=x>", privado: true, url: URL_LOCAL }));
    assert.deepEqual(lerAbertura(a), { aberto: true, navegador: null, privado: true });
    fs.writeFileSync(a, JSON.stringify({ aberto: "sim", privado: true }));
    assert.equal(lerAbertura(a), null);
    fs.writeFileSync(a, "não é json");
    assert.equal(lerAbertura(a), null);
    assert.equal(lerAbertura(path.join(d, "nao-existe")), null);
  });
});

describe("o login no Claude Code", () => {
  test("macOS e Linux: BROWSER é um script da pasta da conta que chama o abrir-login.js; a linha de comando não muda", () => {
    const pasta = pastaTemp("reveza conta 'aspas' ");
    const exec = new ExecutorFalso();
    new ClaudeCli(exec, "/bin/claude", "macos").login(pasta, "a@exemplo.com");
    const { argv, op } = exec.iniciados[0]!;
    assert.deepEqual(argv, ["/bin/claude", "auth", "login", "--claudeai", "--email", "a@exemplo.com"]);
    const nav = path.join(pasta, ".abrir-login");
    assert.equal(op.env?.BROWSER, nav);
    assert.equal(op.env?.REVEZA_LOGIN_ABERTO, path.join(pasta, ".login-aberto"));
    assert.equal(op.env?.CLAUDE_CONFIG_DIR, pasta);
    if (process.platform !== "win32") assert.equal(fs.statSync(nav).mode & 0o777, 0o700);
    const script = fs.readFileSync(nav, "utf8");
    assert.match(script, /^#!\/bin\/sh\nexec '.+' '.+abrir-login\.js' "\$@"\n$/);
    // o script roda de verdade (com o Node e o abrir-login.js compilado), mesmo com espaço e aspas no caminho:
    // um endereço que não é o login oficial sai com 2 sem abrir nada
    if (process.platform !== "win32") {
      const r = spawnSync(nav, ["https://mau.com/x"], { env: { PATH: process.env.PATH ?? "", REVEZA_LOGIN_ABERTO: path.join(pasta, ".login-aberto") } });
      assert.equal(r.status, 2, String(r.stderr));
      assert.equal(fs.existsSync(path.join(pasta, ".login-aberto")), false);
    }
  });

  test("Windows: segue com o navegador padrão (o BROWSER de lá precisaria de um .exe)", () => {
    const pasta = pastaTemp();
    const exec = new ExecutorFalso();
    new ClaudeCli(exec, "C:\\claude.exe", "windows").login(pasta, null);
    assert.equal(exec.iniciados[0]!.op.env?.BROWSER, undefined);
    assert.equal(fs.existsSync(path.join(pasta, ".abrir-login")), false);
  });
});

describe("o que o painel e o terminal dizem", () => {
  test("janela anônima aberta: termina sozinho; o endereço é para outro aparelho", async () => {
    m = await montar();
    const l = m.agente.logins.iniciar("b@exemplo.com");
    const proc = m.cli.logins.at(-1)!.proc;
    proc.emitir("Opening browser to sign in…");
    proc.emitir(`If the browser didn't open, visit: ${URL_CODIGO}`);
    assert.equal(l.url, URL_CODIGO);
    assert.equal(l.mensagem, TEXTO_DO_LOGIN, "sem o aviso ainda, o texto de sempre");
    fs.writeFileSync(path.join(l.pasta, ".login-aberto"), JSON.stringify({ aberto: true, navegador: "Google Chrome", privado: true }));
    fs.writeFileSync(path.join(l.pasta, ".abrir-login"), "#!/bin/sh\n");
    await m.agente.logins.aguardarEndereco(l);
    assert.deepEqual(l.janela, { aberto: true, navegador: "Google Chrome", privado: true });
    assert.match(l.mensagem, /^Abri o login numa janela anônima do Google Chrome neste computador: entre na conta e pronto/);
    const pub = m.agente.logins.publico().find((x) => x.id === l.id)!;
    assert.deepEqual(pub.janela, l.janela);
    assert.equal(pub.url, URL_CODIGO);
    // terminou: o "navegador" e o aviso saem da pasta, que vira o CLAUDE_CONFIG_DIR da conta
    m.cred.d.set(l.pasta, blob("B1"));
    proc.fim(0);
    await l.concluido;
    assert.equal(l.estado, "ok");
    assert.equal(fs.existsSync(path.join(l.pasta, ".abrir-login")), false);
    assert.equal(fs.existsSync(path.join(l.pasta, ".login-aberto")), false);
  });

  test("sem aviso (Windows), espera 3 s depois do endereço e segue com o texto de sempre", async () => {
    m = await montar();
    const l = m.agente.logins.iniciar("b@exemplo.com");
    m.cli.logins.at(-1)!.proc.emitir(`If the browser didn't open, visit: ${URL_CODIGO}`);
    const antes = m.relogio.agoraMs();
    await m.agente.logins.aguardarEndereco(l);
    const esperou = m.relogio.agoraMs() - antes;
    // o relógio falso é dividido com a vigia do login (que também dorme): basta não esperar os 15 s inteiros
    assert.ok(esperou >= 3000 && esperou <= 6000, String(esperou));
    assert.equal(l.janela, null);
    assert.equal(l.mensagem, TEXTO_DO_LOGIN);
  });

  test("conta errada na janela anônima: pede para entrar com a conta certa", async () => {
    m = await montar();
    const l = m.agente.logins.iniciar("b@exemplo.com");
    const proc = m.cli.logins.at(-1)!.proc;
    proc.emitir(`visit: ${URL_CODIGO}`);
    fs.writeFileSync(path.join(l.pasta, ".login-aberto"), JSON.stringify({ aberto: true, navegador: "Firefox", privado: true }));
    m.agente.logins.abertura(l);
    m.cred.d.set(l.pasta, blob("C1"));
    proc.fim(0);
    await l.concluido;
    assert.equal(l.estado, "erro");
    assert.match(l.mensagem, /entrou como c@exemplo\.com, não como b@exemplo\.com\. Tente de novo e, na janela que abrir, entre com b@exemplo\.com/);
  });

  test("textos do painel e do terminal para cada caso", () => {
    assert.match(textoDoLogin({ aberto: true, navegador: null, privado: false }), /^Abri o login no navegador neste computador/);
    assert.match(textoDoLogin({ aberto: false, navegador: null, privado: false }), /^Não consegui abrir o navegador/);
    const anonima = textoDoTerminal({ aberto: true, navegador: "Microsoft Edge", privado: true }, URL_CODIGO, "b@exemplo.com").join("\n");
    assert.match(anonima, /janela anônima do Microsoft Edge: entre na conta b@exemplo\.com e pronto/);
    assert.match(anonima, /Em outro aparelho/);
    assert.ok(anonima.includes(`  ${URL_CODIGO}`));
    const normal = textoDoTerminal({ aberto: true, navegador: null, privado: false }, URL_CODIGO, null).join("\n");
    assert.match(normal, /logado em outra conta, use o endereço abaixo numa janela anônima/);
    assert.match(textoDoTerminal({ aberto: false, navegador: null, privado: false }, URL_CODIGO, null).join("\n"), /Não consegui abrir/);
    assert.match(textoDoTerminal(null, URL_CODIGO, null).join("\n"), /Se o navegador abriu/);
  });
});
