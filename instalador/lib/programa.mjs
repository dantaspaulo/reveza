// O programa no computador: cópia do agente e do mod, build, o comando `reveza`, o mod no Claude Code e o serviço.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { t } from "./texto.mjs";

const WIN = process.platform === "win32";

// Segredos que o instalador pode ter no próprio ambiente (--sim): nunca descem para npm, build ou outro programa.
// REVEZA_CODIGO é o código de acesso do computador (traz a senha da identidade dele) e REVEZA_TELEGRAM_TOKEN, o do bot.
export const SEGREDOS_DO_AMBIENTE = ["SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN", "REVEZA_ADMIN_SENHA", "REVEZA_SENHA", "REVEZA_RESEND_CHAVE",
  "REVEZA_FRASE", "REVEZA_CODIGO", "REVEZA_TELEGRAM_TOKEN"];

/** O ambiente do instalador sem os segredos, mais o que este filho precisa de verdade. */
export function ambienteLimpo(extra = {}) {
  const e = { ...process.env };
  for (const k of SEGREDOS_DO_AMBIENTE) delete e[k];
  return { ...e, ...extra };
}

/** Roda um programa sem shell (argumentos não passam por interpretação). No Windows, .cmd precisa do shell. */
export function rodar(cmd, args = [], { cwd, mostrar = false, env, entrada } = {}) {
  const precisaShell = WIN && !/\.exe$/i.test(cmd);
  const aspas = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replaceAll('"', '\\"')}"` : a);
  // `entrada`: o que vai pela entrada padrão (segredo nunca vai em argumento nem no ambiente do filho)
  const stdio = entrada !== undefined ? ["pipe", mostrar ? "inherit" : "pipe", mostrar ? "inherit" : "pipe"] : mostrar ? "inherit" : "pipe";
  const op = { cwd, stdio, env: env ?? ambienteLimpo(), encoding: "utf8", ...(entrada !== undefined ? { input: entrada } : {}) };
  const r = precisaShell ? spawnSync([cmd, ...args].map(aspas).join(" "), { ...op, shell: true }) : spawnSync(cmd, args, op);
  return { ok: r.status === 0, saida: `${r.stdout ?? ""}`, erro: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}

export const existe = (cmd) => (WIN ? rodar("where", [cmd]) : rodar("sh", ["-c", `command -v "$0"`, cmd])).ok;
export const npm = WIN ? "npm.cmd" : "npm";

/** Alguém já escuta na porta (outro gestor de contas, ou o próprio agente)? */
export function portaOcupada(porta, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port: porta, host });
    const fim = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.setTimeout(800, () => fim(false));
  });
}

// O que vai do repositório para o computador (e o que nunca vai: dependências, builds, capturas, React Bits).
const PECAS = ["agente", "mod", ".claude-plugin", "LICENSE"];
const FORA = ["node_modules", "dist", path.join("mod", ".claude-plugin", "types"), "capturas", ".DS_Store"];

/**
 * Copia o programa para `<app>.novo`, compila o agente e só então troca de lugar com o `<app>` atual (que fica como
 * `<app>.anterior` até a próxima atualização). Instalação que falha no meio não estraga a que estava rodando.
 */
/**
 * Copia as peças do programa. O filtro olha o caminho DENTRO de cada peça: pelo `npx github:...` o repositório chega
 * dentro de `~/.npm/_npx/<...>/node_modules/reveza`, e um filtro pelo caminho inteiro jogava tudo fora (o primeiro
 * computador novo de verdade parou em "agente/package-lock.json ausente", 11/10/2026).
 */
export function copiarPrograma(raiz, destino) {
  for (const p of PECAS) {
    const origem = path.join(raiz, p);
    if (!existsSync(origem)) continue;
    cpSync(origem, path.join(destino, p), {
      recursive: true,
      filter: (f) => {
        const rel = path.join(p, path.relative(origem, f));
        return !FORA.some((x) => rel.split(path.sep).includes(x) || rel === x || rel.startsWith(x + path.sep));
      },
    });
  }
}

// ── cópia antes de atualizar ──────────────────────────────────────────────────
// Pedido do Paulo (12/10/2026): "tem que garantir que não vai perder nada, nenhuma conexão, faz um backup antes".
// O que é estado do Reveza neste computador (contas e os logins delas, uso, configuração, identidade, ponte local).
// O programa (app), os logs e o build do painel não entram: o programa anterior já fica em `<app>.anterior`.
export const ESTADO = ["estado.json", "instalacao.json", "contas", "registro", "ponte.json", "ponte.chave", "ligar-pelo-painel"];
const MANTER_COPIAS = 2;

function medir(alvo) {
  if (!existsSync(alvo)) return { arquivos: 0, bytes: 0 };
  const s = statSync(alvo);
  if (!s.isDirectory()) return { arquivos: 1, bytes: s.size };
  let arquivos = 0;
  let bytes = 0;
  for (const n of readdirSync(alvo)) {
    const m = medir(path.join(alvo, n));
    arquivos += m.arquivos;
    bytes += m.bytes;
  }
  return { arquivos, bytes };
}

const carimbo = (d) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * Copia o estado para `<base>/copias/<data>-<rotulo>` e confere a cópia (mesmos arquivos e bytes) antes de devolver.
 * Se a conferência falhar, lança: a atualização para antes de mexer em qualquer coisa. Mantém as 2 cópias mais novas
 * (as cópias de login antigo da principal, `principal-*.json`, não entram na conta).
 */
const processoVivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};

/** Quanto vale a vez de uma publicação neste computador: a mesma da nuvem (45 minutos). */
export const PUBLICACAO_TRAVA_MS = 45 * 60_000;

/**
 * Uma publicação (--publicar-nuvem) por computador: se o agente cair com o instalador ainda vivo (no Windows os filhos
 * sobrevivem), o agente que volta pode pedir a vez de novo, e a nuvem devolve a mesma vez para o mesmo computador. A
 * trava local segura o segundo enquanto o primeiro estiver vivo. Devolve a função que solta, ou null se a vez é de outro.
 */
export function travarPublicacao(arquivo, { agora = Date.now(), vivo = processoVivo, pid = process.pid } = {}) {
  try {
    const t = JSON.parse(readFileSync(arquivo, "utf8"));
    if (Number.isInteger(t.pid) && t.pid !== pid && typeof t.desde === "number" && agora - t.desde < PUBLICACAO_TRAVA_MS && vivo(t.pid)) return null;
  } catch {
    // sem trava (ou ilegível): a vez é desta
  }
  mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  writeFileSync(arquivo, JSON.stringify({ pid, desde: agora }), { mode: 0o600 });
  return () => {
    try {
      if (JSON.parse(readFileSync(arquivo, "utf8")).pid === pid) rmSync(arquivo, { force: true });
    } catch {
      // já saiu
    }
  };
}

export function copiarEstado(base, rotulo, { agora = new Date(), manter = MANTER_COPIAS } = {}) {
  const pasta = path.join(base, "copias");
  const destino = path.join(pasta, `${carimbo(agora)}-${rotulo.replace(/[^\w.-]/g, "_")}`);
  mkdirSync(destino, { recursive: true, mode: 0o700 });
  if (!WIN) chmodSync(pasta, 0o700);
  for (const item of ESTADO) {
    const de = path.join(base, item);
    if (!existsSync(de)) continue;
    cpSync(de, path.join(destino, item), { recursive: true, preserveTimestamps: true });
    const a = medir(de);
    const b = medir(path.join(destino, item));
    if (a.arquivos !== b.arquivos || a.bytes !== b.bytes) {
      throw new Error(t(`a cópia de ${item} não bateu (${b.arquivos}/${a.arquivos} arquivos): nada foi atualizado`,
        `copying ${item} did not match (${b.arquivos}/${a.arquivos} files): nothing was updated`));
    }
  }
  const datadas = readdirSync(pasta).filter((n) => /^\d{8}-\d{6}-/.test(n)).sort();
  for (const velha of datadas.slice(0, Math.max(0, datadas.length - manter))) rmSync(path.join(pasta, velha), { recursive: true, force: true });
  return destino;
}

/**
 * Atualização que não subiu: o programa anterior volta para o lugar (o novo fica em `<app>.falhou`) e a configuração
 * volta da cópia. As contas e os logins NÃO voltam da cópia: o login pode ter sido renovado depois dela, e o token
 * antigo já não valeria (eles ficam como estão, que é o mais novo).
 */
export function voltarAtualizacao(app, base, copia) {
  if (!existsSync(`${app}.anterior`)) return false;
  rmSync(`${app}.falhou`, { recursive: true, force: true });
  if (existsSync(app)) renameSync(app, `${app}.falhou`);
  renameSync(`${app}.anterior`, app);
  for (const item of ["estado.json", "instalacao.json"]) {
    const de = copia && path.join(copia, item);
    if (de && existsSync(de)) cpSync(de, path.join(base, item));
  }
  return true;
}

export function instalarPrograma(raiz, app, { log = () => {} } = {}) {
  const novo = `${app}.novo`;
  rmSync(novo, { recursive: true, force: true });
  mkdirSync(novo, { recursive: true });
  copiarPrograma(raiz, novo);
  const agente = path.join(novo, "agente");
  // Só as versões travadas no package-lock.json (com o resumo de cada pacote) e sem script de instalação de terceiros:
  // o agente guarda a chave do cofre e os logins (auditoria de segurança de 11/10/2026).
  if (!existsSync(path.join(agente, "package-lock.json"))) throw new Error(t("agente/package-lock.json ausente: a instalação só usa versões travadas",
    "agente/package-lock.json is missing: the installation only uses locked versions"));
  log(t("instalando as dependências do agente (versões travadas)", "installing the agent dependencies (locked versions)"));
  let r = rodar(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: agente });
  if (!r.ok) throw new Error(t(`npm install do agente falhou: ${r.erro.slice(-400)}`, `the agent npm install failed: ${r.erro.slice(-400)}`));
  log(t("compilando o agente", "building the agent"));
  r = rodar(npm, ["run", "build"], { cwd: agente });
  if (!r.ok) throw new Error(t(`build do agente falhou: ${(r.saida + r.erro).slice(-400)}`, `the agent build failed: ${(r.saida + r.erro).slice(-400)}`));
  if (!existsSync(path.join(agente, "dist", "src", "cli.js"))) throw new Error(t("o build do agente não gerou dist/src/cli.js", "the agent build did not produce dist/src/cli.js"));
  const anterior = `${app}.anterior`;
  rmSync(anterior, { recursive: true, force: true });
  if (existsSync(app)) renameSync(app, anterior);
  renameSync(novo, app);
  return path.join(app, "agente", "dist", "src", "cli.js");
}

/**
 * O `reveza.cmd` do Windows. O cmd lê o arquivo na página de código do console (850 no Windows em português), e o
 * caminho de quem tem acento no nome (C:\Users\João) chegava errado: o lançador passa para UTF-8 (65001) só enquanto
 * roda e volta à página de antes, com o código de saída do agente.
 */
export function lancadorWindows(node, cli) {
  return [
    "@echo off",
    "setlocal",
    'for /f "tokens=2 delims=:." %%p in (\'chcp\') do set /a "REVEZA_CP=%%p" >nul 2>&1',
    "chcp 65001 >nul",
    `"${node}" "${cli}" %*`,
    'set "REVEZA_SAIDA=%errorlevel%"',
    'if defined REVEZA_CP chcp %REVEZA_CP% >nul',
    "exit /b %REVEZA_SAIDA%",
    "",
  ].join("\r\n");
}

/** O comando `reveza` em ~/.reveza/bin, apontando para o agente instalado com o Node que rodou o instalador. */
export function criarLancador(bin, cli, node = process.execPath) {
  mkdirSync(bin, { recursive: true });
  if (WIN) {
    const arq = path.join(bin, "reveza.cmd");
    writeFileSync(arq, lancadorWindows(node, cli));
    return arq;
  }
  const arq = path.join(bin, "reveza");
  writeFileSync(arq, `#!/bin/sh\nexec "${node}" "${cli}" "$@"\n`);
  chmodSync(arq, 0o755);
  criarLancadorClaude(path.join(path.dirname(bin), "lancador"), cli, node);
  return arq;
}

/** Aspas simples do sh: o texto vai como está (o caminho de quem tem aspas ou cifrão no nome não vira comando). */
function aspasSh(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * O lançador do assistente com as trilhas das empresas separadas (0.18.0): ~/.reveza/lancador/claude. Fica FORA do
 * ~/.reveza/bin de propósito (que está no PATH): nada muda até a pessoa ligar, apontando o programa que abre o
 * assistente para ele (no OpenBot, OPENBOT_CLAUDE_PATH; no terminal, a pasta antes no PATH ou um alias).
 *
 * Sem a marca ~/.reveza/trilhas/ligadas (o agente a põe quando o painel tem empresa separada), ele só abre o assistente
 * de verdade. Com ela, pergunta ao agente (`reveza trilha`) de qual empresa é a pasta e, sendo de uma separada, abre o
 * assistente com a pasta de login da trilha (CLAUDE_SECURESTORAGE_CONFIG_DIR) e a marca REVEZA_TRILHA. O exec mantém o
 * número do processo, que o agente acompanha. Quem já nasceu numa trilha (um `claude -p` de um gancho), ou já tem a
 * própria pasta de login no ambiente, fica como está. Um `claude` achado que é o próprio lançador (um link para ele no
 * PATH) para com erro em vez de abrir a si mesmo sem fim (o exec mantém o número do processo). Pasta de uma empresa que
 * roda só nas contas dela, sem conta livre (`reveza trilha` sai 3): mostra o motivo e não abre, com a saída 78.
 *
 * Plano B (0.21.0): antes dos 78, espera a conta do projeto. Pergunta de novo (`--de-novo`) a cada REVEZA_ESPERA_PASSO_S
 * (15 s) até REVEZA_ESPERA_S (720 s, pelo relógio: cada pergunta leva até 20 s), abaixo dos 15 min sem sinal em que o
 * OpenBot fecha a conversa. O agente sem responder (saída 4) não abre a sessão na principal: segue esperando. Versão 2
 * (regra 1): só sai da espera a trilha com as duas linhas (saída 0) ou a principal com a certeza do agente (saída 5).
 * Regra 4: o comando que não conversa (COMANDOS_SEM_CONVERSA) pergunta sem o processo e nunca espera.
 * REVEZA_ESPERA_S=0 volta ao comportamento antigo. Toda pergunta roda com </dev/null (quem chama pelo SDK deixa a
 * primeira mensagem na entrada), e o sleep da espera roda com wait, para Ctrl+C e sinal de encerrar saírem na hora.
 */
/**
 * O primeiro argumento que não abre conversa: o lançador pergunta sem o processo (o agente não anota nem segura a conta
 * em uso por ele) e nunca espera a conta do projeto. Saiu do `claude --help` (2.1.331) e um teste compara com a ajuda do
 * Claude Code instalado. "help" fica fora de propósito: pode ser o começo de um pedido.
 */
export const COMANDOS_SEM_CONVERSA = [
  "-v", "--version", "-h", "--help", "agents", "attach", "auth", "auto-mode", "config", "doctor", "gateway", "import",
  "install", "kill", "logs", "mcp", "migrate-installer", "plugin", "plugins", "purge", "respawn", "rm", "setup-token",
  "stop", "ultrareview", "update", "upgrade",
];

export function lancadorClaude(dir, cli, node = process.execPath) {
  const marca = path.join(path.dirname(dir), "trilhas", "ligadas");
  return [
    "#!/bin/sh",
    "# Reveza AI: lançador do Claude Code com as trilhas das empresas separadas. Refeito pelo instalador a cada versão.",
    "# O corpo é uma função chamada na última linha: o shell lê tudo antes de rodar, e o arquivo trocado ou regravado",
    "# durante a espera não muda o que já roda.",
    "reveza_lancar() {",
    `eu=${aspasSh(dir)}`,
    'real="${REVEZA_CLAUDE_REAL:-}"',
    'if [ -z "$real" ]; then',
    "  antes=$IFS",
    "  IFS=:",
    "  for d in $PATH; do",
    '    [ -z "$d" ] && continue',
    '    [ "${d%/}" = "$eu" ] && continue',
    '    if [ -f "$d/claude" ] && [ -x "$d/claude" ]; then real="$d/claude"; break; fi',
    "  done",
    "  IFS=$antes",
    "fi",
    'if [ -z "$real" ] && [ -x "$HOME/.local/bin/claude" ]; then real="$HOME/.local/bin/claude"; fi',
    'if [ -z "$real" ]; then echo "reveza: não achei o claude no PATH (ou defina REVEZA_CLAUDE_REAL)" >&2; exit 127; fi',
    'if [ "${REVEZA_LANCADOR_PID:-}" = "$$" ]; then echo "reveza: o claude achado é o próprio lançador; defina REVEZA_CLAUDE_REAL" >&2; exit 127; fi',
    "REVEZA_LANCADOR_PID=$$",
    "export REVEZA_LANCADOR_PID",
    `if [ -z "\${REVEZA_TRILHA:-}" ] && [ -z "\${CLAUDE_SECURESTORAGE_CONFIG_DIR:-}" ] && [ -f ${aspasSh(marca)} ]; then`,
    // a pasta como ela é no disco (sem atalho), a mesma que o registro de uso vê e as regras dos projetos usam
    '  aqui=$(pwd -P 2>/dev/null || pwd 2>/dev/null || echo "$PWD")',
    // o comando que não conversa (versão, login, ajuda) pergunta sem o processo: o agente não segura a conta em uso por
    // ele (plano B versão 2, regra 4)
    "  conversa=1",
    '  case "${1:-}" in',
    `    ${COMANDOS_SEM_CONVERSA.join("|")}) conversa=0 ;;`,
    "  esac",
    '  if [ "$conversa" = 1 ]; then',
    `    saida=$(${aspasSh(node)} ${aspasSh(cli)} trilha --cwd "$aqui" --pid "$$" </dev/null 2>/dev/null)`,
    "    rc=$?",
    "  else",
    `    saida=$(${aspasSh(node)} ${aspasSh(cli)} trilha --cwd "$aqui" </dev/null 2>/dev/null)`,
    "    rc=$?",
    "  fi",
    // sem conta da empresa, a conversa espera a conta dela (plano B); o comando que não conversa segue valendo na hora
    '  if [ "$rc" = 3 ]; then',
    '    case "$conversa" in',
    '      0) saida="" ;;',
    "      *)",
    '        printf "reveza: %s\\n" "$saida" >&2',
    '        espera=${REVEZA_ESPERA_S:-720}',
    '        case "$espera" in ""|*[!0-9]*) espera=720 ;; esac',
    '        passo=${REVEZA_ESPERA_PASSO_S:-15}',
    '        case "$passo" in ""|*[!0-9]*|0) passo=15 ;; esac',
    '        [ "$espera" -gt 0 ] || exit 78',
    '        printf "reveza: esperando uma conta do projeto ficar livre, por até %s min (Ctrl+C cancela).\\n" "$(( (espera + 59) / 60 ))" >&2',
    '        fim=$(( $(date +%s) + espera ))',
    '        sono=""',
    '        parar() { [ -n "$sono" ] && kill "$sono" 2>/dev/null; exit "$1"; }',
    "        trap 'parar 130' INT",
    "        trap 'parar 143' TERM",
    "        trap 'parar 129' HUP",
    "        while :; do",
    '          if [ "$(date +%s)" -ge "$fim" ]; then',
    '            printf "reveza: a espera terminou sem conta livre; a sessão não abriu.\\n" >&2',
    '            printf "reveza: %s\\n" "$saida" >&2',
    "            exit 78",
    "          fi",
    '          sleep "$passo" &',
    "          sono=$!",
    '          wait "$sono"',
    '          sono=""',
    `          nova=$(${aspasSh(node)} ${aspasSh(cli)} trilha --cwd "$aqui" --pid "$$" --de-novo </dev/null 2>/dev/null)`,
    "          rc=$?",
    // plano B versão 2 (regra 1): só resposta positiva e explícita tira da espera. 0 com as duas linhas: a trilha; 5: a
    // principal, com a certeza do agente. 3: segue sem conta; 4: o agente não sabe ou não respondeu (reinício,
    // atualização); 0 sem as linhas (o cli antigo), erro ou programa que sumiu: também segue, porque a pasta já se sabe
    // que é de projeto
    '          case "$rc" in',
    "            0)",
    '              p1=$(printf "%s\\n" "$nova" | sed -n 1p)',
    '              p2=$(printf "%s\\n" "$nova" | sed -n 2p)',
    '              if [ -n "$p1" ] && [ -n "$p2" ]; then saida=$nova; break; fi',
    "              ;;",
    '            5) saida=""; break ;;',
    '            3) [ -n "$nova" ] && saida=$nova ;;',
    "          esac",
    "        done",
    "        trap - INT TERM HUP",
    "        ;;",
    "    esac",
    "  fi",
    '  pasta=$(printf "%s\\n" "$saida" | sed -n 1p)',
    '  empresa=$(printf "%s\\n" "$saida" | sed -n 2p)',
    '  if [ -n "$pasta" ] && [ -n "$empresa" ]; then',
    '    CLAUDE_SECURESTORAGE_CONFIG_DIR=$pasta',
    '    REVEZA_TRILHA=$empresa',
    "    export CLAUDE_SECURESTORAGE_CONFIG_DIR REVEZA_TRILHA",
    "  fi",
    "fi",
    'exec "$real" "$@"',
    "}",
    'reveza_lancar "$@"',
    "",
  ].join("\n");
}

/**
 * Grava o lançador num temporário da mesma pasta e troca pelo nome (plano B versão 2, regra 3): quem já roda segue no
 * arquivo antigo, que o shell lê pela posição, e quem abre agora pega o antigo ou o novo inteiro, nunca a metade.
 */
export function criarLancadorClaude(dir, cli, node = process.execPath) {
  if (WIN) return null;
  mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, "claude");
  const tmp = path.join(dir, `.claude.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, lancadorClaude(dir, cli, node), { mode: 0o755 });
    chmodSync(tmp, 0o755);
    renameSync(tmp, arq);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return arq;
}

/** Linha para o PATH, conforme o shell (o instalador mostra e, com ok da pessoa, acrescenta). */
export function linhaPath(bin, shell = process.env.SHELL || "", win = WIN) {
  if (win) return { arquivo: "HKCU\\Environment", linha: path.win32.join(bin, "reveza.cmd") };
  if (/fish$/.test(shell)) return { arquivo: path.join(process.env.HOME || "", ".config", "fish", "config.fish"), linha: `fish_add_path "${bin}"` };
  const arquivo = /zsh$/.test(shell) ? ".zshrc" : ".bashrc";
  return { arquivo: path.join(process.env.HOME || "", arquivo), linha: `export PATH="${bin}:$PATH"` };
}

/**
 * Windows: o Path do usuário (HKCU\Environment), lido SEM expandir (o %USERPROFILE% de quem já estava lá fica como
 * estava) e gravado como REG_EXPAND_SZ; mudar uma variável pelo .NET avisa o Windows (WM_SETTINGCHANGE) e os terminais
 * novos já enxergam o `reveza`. O caminho vai pelo ambiente, não pelo texto do script.
 */
const PS_PATH = [
  "$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
  "$atual = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "$partes = @($atual -split ';' | Where-Object { $_ })",
  "if ($partes -notcontains $env:REVEZA_BIN) {",
  "  $k.SetValue('Path', (($partes + $env:REVEZA_BIN) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
  "  [Environment]::SetEnvironmentVariable('REVEZA_AVISO', '1', 'User')",
  "  [Environment]::SetEnvironmentVariable('REVEZA_AVISO', $null, 'User')",
  "}",
  "$k.Close()",
].join("\n");

export function acrescentarPath(bin) {
  if (WIN) {
    const script = Buffer.from(PS_PATH, "utf16le").toString("base64");
    const r = rodar("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", script], { env: ambienteLimpo({ REVEZA_BIN: bin }) });
    return r.ok;
  }
  const l = linhaPath(bin);
  if (!l) return false;
  const atual = existsSync(l.arquivo) ? readFileSync(l.arquivo, "utf8") : "";
  if (atual.includes(bin)) return true;
  mkdirSync(path.dirname(l.arquivo), { recursive: true });
  writeFileSync(l.arquivo, `${atual.replace(/\n?$/, "\n")}# Reveza AI\n${l.linha}\n`);
  return true;
}

/** O mod nas sessões: o marketplace é a pasta do programa; a porta acompanha o agente (7789 no modo sombra). */
export function instalarMod(app, { porta = 7788, env } = {}) {
  if (!existe("claude")) return { ok: false, erro: t("claude não encontrado no PATH", "claude not found on PATH") };
  const r = rodar("claude", ["plugin", "install", "reveza", "--marketplace", app, "--scope", "user", "--config", `porta=${porta}`, "--json", "-y"], { env });
  if (r.ok) return { ok: true };
  if (/already installed|já instalad/i.test(r.saida + r.erro)) {
    const u = rodar("claude", ["plugin", "marketplace", "update", "reveza"], { env });
    const p = rodar("claude", ["plugin", "update", "reveza@reveza"], { env });
    return { ok: u.ok && p.ok, erro: (u.erro + p.erro).trim().slice(-300) };
  }
  return { ok: false, erro: (r.saida + r.erro).trim().slice(-300) };
}

export function removerMod({ env } = {}) {
  if (!existe("claude")) return false;
  const r = rodar("claude", ["plugin", "uninstall", "reveza@reveza", "--scope", "user", "--keep-data"], { env });
  rodar("claude", ["plugin", "marketplace", "remove", "reveza"], { env });
  return r.ok;
}

/** Configuração da troca no estado local (sem nuvem): só mexe na chave `config`, o resto do estado fica. */
export function gravarConfigLocal(arquivoEstado, cfg) {
  let estado = {};
  try { estado = JSON.parse(readFileSync(arquivoEstado, "utf8")); } catch { /* primeira vez */ }
  estado.config = { ...(estado.config || {}), ...cfg };
  if (!estado.formato) estado.formato = 1;
  mkdirSync(path.dirname(arquivoEstado), { recursive: true, mode: 0o700 });
  if (!WIN) chmodSync(path.dirname(arquivoEstado), 0o700);
  const tmp = `${arquivoEstado}.tmp`;
  writeFileSync(tmp, JSON.stringify(estado, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, arquivoEstado);
}

/** O que a instalação lembra para atualizar e conferir depois. Nada de segredo aqui. */
export function lerInstalacao(arquivo) {
  try { return JSON.parse(readFileSync(arquivo, "utf8")); } catch { return null; }
}

export function gravarInstalacao(arquivo, dados) {
  const proibido = /(token|senha|secret|segredo|service_role|sbp_)/i;
  for (const [k, v] of Object.entries(flat(dados))) {
    if (proibido.test(k) || (typeof v === "string" && /^(sbp_|sk-|sb_secret_)/.test(v))) throw new Error(t(`instalacao.json não guarda segredo (${k})`,
      `instalacao.json does not store secrets (${k})`));
  }
  mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  if (!WIN) chmodSync(path.dirname(arquivo), 0o700);
  writeFileSync(arquivo, JSON.stringify(dados, null, 2) + "\n", { mode: 0o600 });
}

function flat(o, pre = "") {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, `${pre}${k}.`));
    else out[`${pre}${k}`] = v;
  }
  return out;
}
