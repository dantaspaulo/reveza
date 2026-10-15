// O agente como serviço do usuário: launchd no macOS, systemd de usuário no Linux, Agendador de Tarefas no Windows.
// Só do usuário (nada de root/administrador): o agente mexe nas credenciais de quem está logado.

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { Sistema } from "./config.js";
import { t } from "./i18n.js";
import type { Executor } from "./util/executor.js";

export const ROTULO = "ai.reveza.agente";
export const UNIDADE = "reveza-agente.service";
export const TAREFA = "Reveza AI agente";

export interface OpcoesServico {
  sistema: Sistema;
  home: string;
  exec: Executor;
  node: string;
  script: string;
  logs: string;
  sombra?: boolean;
  porta?: number;
  uid?: number;
  /** Espera entre tentativas (os testes passam uma que não espera). */
  dormir?: (ms: number) => Promise<void>;
  /** Alguém escuta na porta do agente? (os testes passam um falso; o padrão olha a porta de verdade) */
  portaOcupada?: (porta: number) => Promise<boolean>;
  /** Hora do registro da tarefa do Windows (os testes fixam). */
  agora?: Date;
}

export interface StatusServico {
  instalado: boolean;
  rodando: boolean;
  detalhe: string;
  /**
   * O gerenciador de serviços respondeu. Só o Linux diz que não: no WSL sem systemd (e em contêiner) a unidade pode
   * existir no disco sem nunca rodar, e o `systemctl` não responde nada na saída padrão.
   */
  gerenciador?: boolean;
}

function argumentos(o: OpcoesServico): string[] {
  const a = [o.script, "rodar"];
  if (o.sombra) a.push("--sombra");
  if (o.porta) a.push("--porta", String(o.porta));
  return a;
}

function caminhoPath(o: OpcoesServico): string {
  const dirs = [path.dirname(o.node), path.join(o.home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(dirs)].join(":");
}

function xml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Texto escapado para XML (plist e tarefas do Windows). */
export const xmlTexto = xml;

export function arquivoPlist(o: OpcoesServico): string {
  return path.join(o.home, "Library", "LaunchAgents", `${ROTULO}.plist`);
}

export function plist(o: OpcoesServico): string {
  const args = [o.node, ...argumentos(o)].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ROTULO}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(caminhoPath(o))}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(path.join(o.logs, "servico.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(o.logs, "servico.log"))}</string>
</dict>
</plist>
`;
}

export function arquivoUnidade(o: OpcoesServico): string {
  return path.join(o.home, ".config", "systemd", "user", UNIDADE);
}

function aspasSystemd(a: string): string {
  return `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function unidade(o: OpcoesServico): string {
  return `[Unit]
Description=Reveza AI: agente de contas
After=network-online.target

[Service]
Type=simple
ExecStart=${[o.node, ...argumentos(o)].map(aspasSystemd).join(" ")}
Environment=${aspasSystemd(`PATH=${caminhoPath(o)}`)}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

// ── Windows ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A tarefa sai de um XML, não do `schtasks /SC ONLOGON`, porque o jeito curto (provado no Windows de verdade, 12/10/2026):
// - abria uma janela de terminal com o agente na tela de quem entra (fechar a janela derrubava o agente);
// - deixava os padrões do Agendador: para o agente depois de 3 dias, não sobe na bateria e para ao tirar da tomada;
// - não trazia o agente de volta se ele caísse (o launchd e o systemd trazem);
// - criava um gatilho de entrada de QUALQUER usuário, que pede administrador.
// Aqui: o agente roda pelo `conhost.exe --headless` (console sem janela), com gatilho de entrada só deste usuário, um
// gatilho de minuto em minuto que só sobe o agente se ele não estiver rodando (IgnoreNew), sem limite de tempo e na
// bateria também. O conhost sai quando o agente sai; o agente sai quando o conhost sai (--vigiar-pai): o `schtasks /End`
// para os dois.

/** O XML da tarefa, guardado ao lado do estado (o schtasks lê dele). */
export function arquivoTarefa(o: OpcoesServico): string {
  return path.join(path.dirname(o.logs), "tarefa-windows.xml");
}

/** Um argumento na linha de comando do Windows (as regras do CommandLineToArgvW: aspas e as barras antes delas). */
export function aspasWindows(a: string): string {
  if (a && !/[\s"]/.test(a)) return a;
  let r = '"';
  let barras = 0;
  for (const ch of a) {
    if (ch === "\\") {
      barras++;
      continue;
    }
    r += ch === '"' ? "\\".repeat(barras * 2 + 1) + '"' : "\\".repeat(barras) + ch;
    barras = 0;
  }
  return r + "\\".repeat(barras * 2) + '"';
}

function horaLocal(d: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

export function conhost(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot || env.windir || "C:\\Windows", "System32", "conhost.exe");
}

/** O XML da tarefa do Windows para o usuário `usuario` (o SID, de preferência). */
export function xmlTarefa(o: OpcoesServico, usuario: string): string {
  const args = ["--headless", o.node, ...argumentos(o), "--vigiar-pai"].map(aspasWindows).join(" ");
  const u = xml(usuario);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Reveza AI: agente de contas (sem janela; volta sozinho se cair)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${u}</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${horaLocal(o.agora ?? new Date())}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${u}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(conhost())}</Command>
      <Arguments>${xml(args)}</Arguments>
      <WorkingDirectory>${xml(o.home)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** O SID de quem roda (o gatilho de entrada é só dele); sem o `whoami`, o nome DOMINIO\usuario. */
export async function usuarioWindows(o: { exec: Executor }): Promise<string> {
  const r = await o.exec.rodar(["whoami", "/user", "/fo", "csv", "/nh"]);
  const sid = /"(S-1-[0-9-]+)"/.exec(r.saida)?.[1];
  if (sid) return sid;
  const u = os.userInfo().username;
  return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${u}` : u;
}

function portaOcupada(porta: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port: porta, host: "127.0.0.1" });
    const fim = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.setTimeout(800, () => fim(false));
  });
}

/** Para a tarefa e espera o agente soltar a porta (até ~10 s), para o que subir depois ser a versão nova. */
async function pararTarefa(o: OpcoesServico): Promise<void> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ocupada = o.portaOcupada ?? portaOcupada;
  const porta = o.porta ?? (o.sombra ? 7789 : 7788);
  await o.exec.rodar(["schtasks", "/End", "/TN", TAREFA]);
  for (let i = 0; i < 20 && (await ocupada(porta)); i++) await dormir(500);
}

function uid(o: OpcoesServico): number {
  return o.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
}

export async function instalar(o: OpcoesServico): Promise<string> {
  fs.mkdirSync(o.logs, { recursive: true, mode: 0o700 });
  if (o.sistema === "macos") {
    const arq = arquivoPlist(o);
    const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const alvo = `gui/${uid(o)}/${ROTULO}`;
    const fora = await o.exec.rodar(["launchctl", "bootout", alvo]);
    // o bootout termina em segundo plano: carregar de novo antes de o rótulo sair dá "Bootstrap failed: 5"
    if (fora.codigo === 0) {
      for (let i = 0; i < 20 && (await o.exec.rodar(["launchctl", "print", alvo])).codigo === 0; i++) await dormir(250);
    }
    fs.writeFileSync(arq, plist(o), { mode: 0o644 });
    let r = await o.exec.rodar(["launchctl", "bootstrap", `gui/${uid(o)}`, arq]);
    for (let i = 0; i < 4 && r.codigo !== 0; i++) {
      await dormir(1000);
      r = await o.exec.rodar(["launchctl", "bootstrap", `gui/${uid(o)}`, arq]);
    }
    if (r.codigo !== 0) throw new Error(t(`launchctl bootstrap falhou: ${r.erro.trim() || r.codigo}`, `launchctl bootstrap failed: ${r.erro.trim() || r.codigo}`));
    return t(`serviço ${ROTULO} instalado (${arq})`, `service ${ROTULO} installed (${arq})`);
  }
  if (o.sistema === "linux") {
    const arq = arquivoUnidade(o);
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, unidade(o), { mode: 0o644 });
    await o.exec.rodar(["systemctl", "--user", "daemon-reload"]);
    const r = await o.exec.rodar(["systemctl", "--user", "enable", UNIDADE]);
    if (r.codigo !== 0) throw new Error(t(`systemctl --user enable falhou: ${r.erro.trim() || r.codigo}`, `systemctl --user enable failed: ${r.erro.trim() || r.codigo}`));
    // restart, não `enable --now`: numa atualização o agente antigo já está rodando, e o `--now` o deixaria lá
    const rr = await o.exec.rodar(["systemctl", "--user", "restart", UNIDADE]);
    if (rr.codigo !== 0) throw new Error(t(`systemctl --user restart falhou: ${rr.erro.trim() || rr.codigo}`, `systemctl --user restart failed: ${rr.erro.trim() || rr.codigo}`));
    return t(
      `serviço ${UNIDADE} instalado (${arq}); para seguir rodando sem sessão aberta: loginctl enable-linger ${os.userInfo().username}`,
      `service ${UNIDADE} installed (${arq}); to keep running without an open session: loginctl enable-linger ${os.userInfo().username}`,
    );
  }
  const arq = arquivoTarefa(o);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  // o schtasks lê o XML em UTF-16 (com a marca no começo): caminhos com acento chegam inteiros
  fs.writeFileSync(arq, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xmlTarefa(o, await usuarioWindows(o)), "utf16le")]));
  // numa atualização o agente antigo está rodando: sai antes, senão a tarefa nova não sobe (uma instância por vez)
  await pararTarefa(o);
  const r = await o.exec.rodar(["schtasks", "/Create", "/F", "/TN", TAREFA, "/XML", arq]);
  if (r.codigo !== 0) throw new Error(t(`schtasks /Create falhou: ${r.erro.trim() || r.saida.trim() || r.codigo}`, `schtasks /Create failed: ${r.erro.trim() || r.saida.trim() || r.codigo}`));
  await o.exec.rodar(["schtasks", "/Run", "/TN", TAREFA]);
  return t(`tarefa "${TAREFA}" criada (roda ao entrar no Windows, sem janela, e volta sozinha se cair)`, `task "${TAREFA}" created (runs when you sign in to Windows, without a window, and restarts on its own if it crashes)`);
}

export async function remover(o: OpcoesServico): Promise<string> {
  if (o.sistema === "macos") {
    await o.exec.rodar(["launchctl", "bootout", `gui/${uid(o)}/${ROTULO}`]);
    fs.rmSync(arquivoPlist(o), { force: true });
    return t(`serviço ${ROTULO} removido`, `service ${ROTULO} removed`);
  }
  if (o.sistema === "linux") {
    await o.exec.rodar(["systemctl", "--user", "disable", "--now", UNIDADE]);
    fs.rmSync(arquivoUnidade(o), { force: true });
    await o.exec.rodar(["systemctl", "--user", "daemon-reload"]);
    return t(`serviço ${UNIDADE} removido`, `service ${UNIDADE} removed`);
  }
  // desliga antes de parar: o gatilho de minuto em minuto não sobe o agente de novo no meio da remoção
  await o.exec.rodar(["schtasks", "/Change", "/TN", TAREFA, "/DISABLE"]);
  await pararTarefa(o);
  await o.exec.rodar(["schtasks", "/Delete", "/F", "/TN", TAREFA]);
  fs.rmSync(arquivoTarefa(o), { force: true });
  return t(`tarefa "${TAREFA}" removida`, `task "${TAREFA}" removed`);
}

/**
 * Como o serviço está instalado: em modo sombra? em outra porta? Lido do próprio arquivo do serviço (plist, unidade ou
 * XML da tarefa), para quem reinstala (o conserto do `reveza doctor`) não tirar nem pôr o modo sombra por engano.
 * Null quando não há serviço instalado.
 */
export function instalado(o: OpcoesServico): { sombra: boolean; porta: number | undefined } | null {
  let texto: string;
  try {
    if (o.sistema === "macos") texto = fs.readFileSync(arquivoPlist(o), "utf8");
    else if (o.sistema === "linux") texto = fs.readFileSync(arquivoUnidade(o), "utf8");
    else {
      const bruto = fs.readFileSync(arquivoTarefa(o));
      texto = bruto[0] === 0xff && bruto[1] === 0xfe ? bruto.subarray(2).toString("utf16le") : bruto.toString("utf8");
    }
  } catch {
    return null;
  }
  // plist: <string>--sombra</string>; unidade: "--sombra"; tarefa: --sombra no meio dos argumentos
  const sombra = /(^|[\s>"])--sombra([\s<"]|$)/m.test(texto);
  const porta = /--porta(?:<\/string>\s*<string>|"\s+"|\s+)(\d{2,5})/.exec(texto)?.[1];
  return { sombra, porta: porta ? Number(porta) : undefined };
}

export async function status(o: OpcoesServico): Promise<StatusServico> {
  if (o.sistema === "macos") {
    const instalado = fs.existsSync(arquivoPlist(o));
    const r = await o.exec.rodar(["launchctl", "print", `gui/${uid(o)}/${ROTULO}`]);
    const rodando = r.codigo === 0 && /state = running/.test(r.saida);
    return { instalado, rodando, detalhe: r.codigo === 0 ? (rodando ? t("rodando", "running") : t("carregado, parado", "loaded, stopped")) : t("não carregado", "not loaded") };
  }
  if (o.sistema === "linux") {
    const instalado = fs.existsSync(arquivoUnidade(o));
    const r = await o.exec.rodar(["systemctl", "--user", "is-active", UNIDADE]);
    const estado = r.saida.trim() || t("desconhecido", "unknown");
    return { instalado, rodando: estado === "active", detalhe: estado, gerenciador: r.saida.trim() !== "" };
  }
  const r = await o.exec.rodar(["schtasks", "/Query", "/TN", TAREFA, "/FO", "LIST"]);
  const rodando = /Running|Em execu/i.test(r.saida);
  return { instalado: r.codigo === 0, rodando, detalhe: r.codigo === 0 ? (rodando ? t("rodando", "running") : t("pronta", "ready")) : t("não instalada", "not installed") };
}
