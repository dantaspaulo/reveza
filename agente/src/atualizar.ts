// Atualizar o PRÓPRIO programa deste computador, a pedido do painel.
//
// Isto dá à nuvem o poder de trocar o programa dos computadores, então a nuvem não escolhe o código: o pedido traz no
// máximo um número de versão (X.Y.Z) ou "a mais nova", nunca endereço nem caminho. O agente consulta sozinho as
// versões publicadas do repositório oficial (fixo aqui, API pública do GitHub, sem token), só aceita uma versão MAIOR
// que a dele e que exista como versão publicada, baixa o pacote da tag pelo endereço fixo, confere a versão de dentro e
// roda o instalador DELE com `--atualizar --sim` (sem token: só este computador; a nuvem e o painel ficam) num processo
// separado, que sobrevive à troca do agente. A cópia do estado e a volta para a versão anterior quando a nova não sobe
// são do instalador.
//
// A trava de compatibilidade: a versão nova pode trazer migração da nuvem. As migrações vêm no próprio pacote
// (nuvem/migracoes); antes de rodar o instalador, o agente compara os nomes com os que a nuvem já aplicou
// (agente_migracoes, só a lista de nomes) e, faltando alguma, não se atualiza: a nuvem vem antes (desde a 0.3.0 ela se
// atualiza sozinha, pelo Atualizar a nuvem do painel ou no jeito de atualizar sozinho; antes, pelo instalador).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { Sistema } from "./config.js";
import { compararVersao } from "./doctor.js";
import { aspasWindows, conhost, usuarioWindows, xmlTexto } from "./servico.js";
import type { Executor } from "./util/executor.js";

export const REPOSITORIO = "dantaspaulo/reveza";
export const URL_VERSOES = `https://api.github.com/repos/${REPOSITORIO}/releases?per_page=30`;
/** github.com manda o pacote da tag para codeload.github.com: o download só segue dentro destes dois. */
const HOSTS_DO_PACOTE = new Set(["github.com", "codeload.github.com"]);
export const VERSAO_VALIDA = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
export const MAIS_NOVA = "mais_nova";
/** A API do GitHub sem token aceita 60 pedidos por hora por endereço: a versão mais nova é lida no máximo a cada 6 h. */
export const CONFERIR_VERSAO_S = 6 * 3600;
/** Atualização que não terminou nisso é dada como falha (e outra pode ser pedida). */
export const ATUALIZACAO_VALIDA_S = 30 * 60;
const PACOTE_MAXIMO = 64 * 1024 * 1024;
export const TAREFA_ATUALIZAR = "Reveza AI atualizar";
/** O fuso que o banco usa quando a instalação não tem um (config `fuso`). */
export const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * Como cada computador se atualiza sozinho (config `atualizar_sozinho` da instalação): desligada (o padrão), de
 * madrugada (true, das 3h às 5h) ou assim que sair (a versão nova é instalada assim que o agente a acha). Só esses três;
 * qualquer outro valor é desligada.
 */
export type ModoAtualizar = "desligada" | "madrugada" | "assim_que_sair";

export function modoAtualizar(valor: unknown): ModoAtualizar {
  if (valor === true || valor === "madrugada") return "madrugada";
  if (valor === "assim_que_sair") return "assim_que_sair";
  return "desligada";
}

/** O "Verificar atualização" do painel não confere mais de uma vez por minuto (a API do GitHub dá 60 por hora). */
export const CONFERIR_AGORA_S = 60;
/** Versão nova recusada pela trava: a nuvem é conferida de novo a cada 5 minutos. */
export const TRAVA_CONFERIR_S = 5 * 60;

/** O que o painel mostra quando a versão nova precisa da nuvem atualizada primeiro. */
export function textoPrecisaNuvem(versao: string): string {
  return `a versão ${versao} precisa da nuvem atualizada primeiro: use Atualizar a nuvem, no painel (Computadores)`;
}

/** Atualizar sozinho só de madrugada: das 3h às 5h no fuso da instalação. */
export function naMadrugada(epoch: number, fuso: unknown): boolean {
  const formatar = (tz: string) =>
    Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(epoch * 1000)));
  let hora: number;
  try {
    hora = formatar(typeof fuso === "string" && fuso ? fuso : FUSO_PADRAO);
  } catch {
    hora = formatar(FUSO_PADRAO); // fuso que este Node não conhece: o do banco
  }
  return hora >= 3 && hora < 5;
}

export function urlDoPacote(versao: string): string {
  if (!VERSAO_VALIDA.test(versao)) throw new Error("versão inválida");
  return `https://github.com/${REPOSITORIO}/archive/refs/tags/v${versao}.tar.gz`;
}

/**
 * O pedido do painel: `{ versao: "X.Y.Z" | "mais_nova" }` (atualizar) ou `{ conferir: true }` (Verificar atualização:
 * ler agora a versão publicada, sem esperar as 6 horas). Qualquer outro campo (endereço, caminho...) é recusado.
 */
export function lerPedido(
  corpo: Record<string, unknown>,
): { ok: true; versao: string } | { ok: true; conferir: true } | { ok: false; erro: string } {
  const chaves = Object.keys(corpo);
  if (chaves.length === 1 && chaves[0] === "conferir") {
    return corpo.conferir === true ? { ok: true, conferir: true } : { ok: false, erro: "pedido de conferir inválido" };
  }
  if (chaves.some((k) => k !== "versao")) return { ok: false, erro: "o pedido de atualização só leva a versão" };
  const v = corpo.versao;
  if (v === MAIS_NOVA || (typeof v === "string" && VERSAO_VALIDA.test(v))) return { ok: true, versao: v };
  return { ok: false, erro: "versão inválida: só X.Y.Z ou a mais nova" };
}

/** As versões publicadas (nem rascunho, nem pré-lançamento) na resposta da API de releases, da mais nova à mais velha. */
export function versoesPublicadas(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const vs = new Set<string>();
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (x.draft === true || x.prerelease === true || typeof x.tag_name !== "string") continue;
    const v = x.tag_name.replace(/^v/, "");
    if (VERSAO_VALIDA.test(v)) vs.add(v);
  }
  return [...vs].sort((a, b) => compararVersao(b, a));
}

export function escolherVersao(pedida: string, atual: string, publicadas: string[]): { ok: true; versao: string } | { ok: false; erro: string } {
  if (!publicadas.length) return { ok: false, erro: "não achei nenhuma versão publicada do Reveza" };
  if (pedida !== MAIS_NOVA && !publicadas.includes(pedida)) return { ok: false, erro: `a ${pedida} não é uma versão publicada do Reveza` };
  const alvo = pedida === MAIS_NOVA ? publicadas[0]! : pedida;
  if (compararVersao(alvo, atual) <= 0) {
    return { ok: false, erro: pedida === MAIS_NOVA ? `já está na versão mais nova (${atual})` : `a ${alvo} não é mais nova que a ${atual}: pelo painel o Reveza não volta versão` };
  }
  return { ok: true, versao: alvo };
}

/** De onde vêm as versões e o pacote: o GitHub oficial (os testes trocam por um falso). */
export interface FonteVersoes {
  publicadas(): Promise<string[]>;
  baixar(versao: string, arquivo: string): Promise<void>;
}

export class GithubOficial implements FonteVersoes {
  constructor(
    private agente: string,
    private f: typeof fetch = fetch,
  ) {}

  private cabecalhos(): Record<string, string> {
    return { "User-Agent": `reveza-agente/${this.agente}`, Accept: "application/vnd.github+json" };
  }

  async publicadas(): Promise<string[]> {
    const r = await this.f(URL_VERSOES, { headers: this.cabecalhos(), redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`o GitHub respondeu ${r.status} à lista de versões`);
    return versoesPublicadas(await r.json());
  }

  async baixar(versao: string, arquivo: string): Promise<void> {
    let url = urlDoPacote(versao);
    for (let i = 0; i < 5; i++) {
      const r = await this.f(url, { headers: this.cabecalhos(), redirect: "manual", signal: AbortSignal.timeout(120_000) });
      if (r.status >= 300 && r.status < 400) {
        const proximo = new URL(r.headers.get("location") ?? "", url);
        if (proximo.protocol !== "https:" || !HOSTS_DO_PACOTE.has(proximo.hostname)) throw new Error("o download do pacote foi mandado para fora do GitHub");
        // e só dentro do repositório oficial (um repositório renomeado ou transferido não leva o download para outro)
        if (!proximo.pathname.toLowerCase().startsWith(`/${REPOSITORIO.toLowerCase()}/`)) throw new Error("o download do pacote foi mandado para fora do repositório oficial");
        url = proximo.toString();
        continue;
      }
      if (!r.ok) throw new Error(`o GitHub respondeu ${r.status} ao pacote da ${versao}`);
      fs.writeFileSync(arquivo, await lerComLimite(r, PACOTE_MAXIMO), { mode: 0o600 });
      return;
    }
    throw new Error("redirecionamentos demais no download do pacote");
  }
}

/** O corpo inteiro, parando no limite enquanto chega (o codeload manda sem content-length). */
export async function lerComLimite(r: Response, maximo: number): Promise<Buffer> {
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > maximo) {
      await leitor.cancel().catch(() => undefined);
      throw new Error("o pacote é grande demais");
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes, total);
}

// ------------------------------------------------------------------------------------------------ pacote

function lerPax(bloco: Buffer): Record<string, string> {
  const r: Record<string, string> = {};
  let pos = 0;
  while (pos < bloco.length) {
    const espaco = bloco.indexOf(0x20, pos);
    if (espaco < 0) break;
    const tamanho = Number(bloco.subarray(pos, espaco).toString("ascii"));
    if (!Number.isInteger(tamanho) || tamanho <= 0) break;
    const linha = bloco.subarray(espaco + 1, pos + tamanho - 1).toString("utf8");
    const igual = linha.indexOf("=");
    if (igual > 0) r[linha.slice(0, igual)] = linha.slice(igual + 1);
    pos += tamanho;
  }
  return r;
}

/**
 * Extrai um .tar.gz com o Node (o mesmo em macOS, Linux e Windows, sem depender do tar do sistema). Só arquivos e
 * pastas: link, caminho absoluto ou com ".." recusa o pacote inteiro. Devolve os caminhos escritos.
 */
export function extrairTarGz(arquivo: string, destino: string): string[] {
  const dados = zlib.gunzipSync(fs.readFileSync(arquivo), { maxOutputLength: 512 * 1024 * 1024 });
  const base = path.resolve(destino);
  const escritos: string[] = [];
  let pos = 0;
  let nomePax: string | null = null;
  let nomeLongo: string | null = null;
  while (pos + 512 <= dados.length) {
    const h = dados.subarray(pos, pos + 512);
    if (h.every((b) => b === 0)) break;
    const campo = (ini: number, tam: number) => h.subarray(ini, ini + tam).toString("utf8").replace(/\0[\s\S]*$/, "");
    const soma = h.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
    if (soma !== parseInt(campo(148, 8).trim(), 8)) throw new Error("pacote corrompido (soma do cabeçalho)");
    const tamanho = parseInt(campo(124, 12).trim() || "0", 8);
    // tamanho que não lê (base 256, negativo, lixo): pacote recusado (negativo voltava ao mesmo cabeçalho para sempre)
    if (!Number.isSafeInteger(tamanho) || tamanho < 0) throw new Error("pacote corrompido (tamanho no cabeçalho)");
    const tipo = String.fromCharCode(h[156] || 48);
    pos += 512;
    const conteudo = dados.subarray(pos, pos + tamanho);
    pos += Math.ceil(tamanho / 512) * 512;
    if (tipo === "g") continue;
    if (tipo === "x") {
      nomePax = lerPax(conteudo).path ?? null;
      continue;
    }
    if (tipo === "L") {
      nomeLongo = conteudo.toString("utf8").replace(/\0[\s\S]*$/, "");
      continue;
    }
    const prefixo = campo(345, 155);
    const nome = nomePax ?? nomeLongo ?? (prefixo ? `${prefixo}/${campo(0, 100)}` : campo(0, 100));
    nomePax = null;
    nomeLongo = null;
    if (tipo === "1" || tipo === "2") throw new Error(`o pacote tem um link (${nome}): recusado`);
    if (!["0", "7", "5"].includes(tipo)) continue;
    const rel = nome.replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.split("/").includes("..")) throw new Error(`caminho inválido no pacote: ${nome}`);
    const alvo = path.resolve(base, rel);
    if (alvo !== base && !alvo.startsWith(base + path.sep)) throw new Error(`caminho inválido no pacote: ${nome}`);
    if (tipo === "5") {
      fs.mkdirSync(alvo, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const executavel = (parseInt(campo(100, 8).trim() || "0", 8) & 0o111) !== 0;
    fs.writeFileSync(alvo, conteudo, { mode: executavel ? 0o755 : 0o644 });
    escritos.push(rel);
  }
  return escritos;
}

/** O instalador dentro do pacote extraído, conferindo que o pacote é mesmo o da versão pedida. */
export function acharInstalador(pasta: string, versao: string): string {
  const raiz = fs.readdirSync(pasta).find((n) => fs.statSync(path.join(pasta, n)).isDirectory() && fs.existsSync(path.join(pasta, n, "package.json")));
  if (!raiz) throw new Error("o pacote não tem o programa");
  const pacote = JSON.parse(fs.readFileSync(path.join(pasta, raiz, "package.json"), "utf8")) as { name?: string; version?: string };
  if (pacote.name !== "reveza" || pacote.version !== versao) throw new Error(`o pacote não é o da ${versao} (veio ${pacote.version ?? "sem versão"})`);
  const instalador = path.join(pasta, raiz, "instalador", "instalar.mjs");
  if (!fs.existsSync(instalador)) throw new Error("o pacote não tem o instalador");
  return instalador;
}

/**
 * As migrações da nuvem que a versão nova traz: os nomes dos arquivos de `nuvem/migracoes` do pacote (o mesmo filtro do
 * instalador, provisionar.mjs). Pacote sem essa pasta é recusado: sem ela não há como saber se a nuvem está pronta.
 */
export function migracoesDoPacote(raiz: string): string[] {
  const dir = path.join(raiz, "nuvem", "migracoes");
  let nomes: string[];
  try {
    nomes = fs.readdirSync(dir);
  } catch {
    throw new Error("o pacote não tem as migrações da nuvem");
  }
  return nomes.filter((n) => n.endsWith(".sql") && !n.startsWith(".")).sort();
}

/** O que a nuvem disse (agente_migracoes): os nomes e, desde a 0.3.1, o resumo de cada uma (null numa nuvem antiga). */
export interface MigracoesDaNuvem {
  nomes: string[];
  hashes: Record<string, string> | null;
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

/**
 * Os resumos que valem para cada migração do pacote, o mesmo cálculo do instalador (provisionar.mjs, hashesAceitos): o
 * sha256 do texto com fim de linha LF e o da mesma migração com CRLF (o que um clone no Windows registrava antes da 0.3.1).
 */
export function resumosDoPacote(raiz: string): Record<string, string[]> {
  const dir = path.join(raiz, "nuvem", "migracoes");
  const r: Record<string, string[]> = {};
  for (const nome of migracoesDoPacote(raiz)) {
    const lf = fs.readFileSync(path.join(dir, nome), "utf8").replace(/\r\n/g, "\n");
    r[nome] = [sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))];
  }
  return r;
}

/**
 * As migrações do pacote que a nuvem ainda não aplicou: pelo nome e, com os resumos dos dois lados, também a que existe
 * com outro conteúdo (uma reaplicável que mudou nesta versão, como as permissões da 0099: só o nome passaria, e o
 * programa novo chamaria função que a nuvem ainda não tem). Sem resumos (nuvem de antes da 0.3.1, ou nuvem que já está
 * nesta versão ou adiante), só o nome.
 */
export function faltamNaNuvem(doPacote: string[], aplicadas: string[] | MigracoesDaNuvem, resumos: Record<string, string[]> | null = null): string[] {
  const nuvem = Array.isArray(aplicadas) ? { nomes: aplicadas, hashes: null } : aplicadas;
  const tem = new Set(nuvem.nomes);
  return doPacote.filter((n) => {
    if (!tem.has(n)) return true;
    const daNuvem = nuvem.hashes?.[n];
    const aceitos = resumos?.[n];
    return Boolean(daNuvem && aceitos && !aceitos.includes(daNuvem));
  });
}

// ------------------------------------------------------------------------------------------------ processo separado

/**
 * O processo separado: roda o instalador com a saída no log e grava o código de saída no arquivo de resultado (o agente
 * que estiver de pé depois, o novo ou o antigo que voltou, lê e conta o que aconteceu). Código fixo, escrito pelo agente.
 */
export const EXECUTOR_DA_ATUALIZACAO = `// Reveza AI: roda o instalador da versão nova e grava o resultado (escrito pelo agente).
import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
const [instalador, log, resultado, ...args] = process.argv.slice(2);
const fd = openSync(log, "a");
const gravar = (r) => writeFileSync(resultado, JSON.stringify({ ...r, fim: new Date().toISOString() }));
const p = spawn(process.execPath, [instalador, ...args], { stdio: ["ignore", fd, fd], windowsHide: true });
p.on("error", (e) => gravar({ codigo: 127, erro: String(e && e.message) }));
p.on("close", (codigo) => gravar({ codigo: codigo ?? 1 }));
`;

export interface Separado {
  sistema: Sistema;
  exec: Executor;
  node: string;
  env: NodeJS.ProcessEnv;
  /** Pasta temporária da atualização (pacote extraído, executor). */
  pasta: string;
  instalador: string;
  log: string;
  resultado: string;
  args: string[];
}

/** O XML da tarefa de uma vez só, sem gatilho (roda pelo /Run), do Agendador de Tarefas do Windows. */
export function xmlTarefaAtualizar(comando: string, argumentos: string, pasta: string, usuario: string): string {
  const u = xmlTexto(usuario);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Reveza AI: atualização do programa pedida pelo painel (roda uma vez)</Description>
  </RegistrationInfo>
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
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlTexto(comando)}</Command>
      <Arguments>${xmlTexto(argumentos)}</Arguments>
      <WorkingDirectory>${xmlTexto(pasta)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * Sobe o processo separado, que sobrevive ao agente ser trocado no meio:
 * - macOS: destacado (sessão própria: o launchd derruba o grupo do serviço, não este);
 * - Linux: com o agente no systemd, num escopo próprio (`systemd-run --user --scope`): reiniciar o serviço derruba o
 *   grupo inteiro do serviço, e só fora dele o instalador termina; sem systemd, destacado;
 * - Windows: numa tarefa própria do Agendador (o `schtasks /End` do serviço encerra os processos da tarefa do agente).
 */
export async function rodarSeparado(o: Separado): Promise<void> {
  const executor = path.join(o.pasta, "executar-atualizacao.mjs");
  fs.writeFileSync(executor, EXECUTOR_DA_ATUALIZACAO, { mode: 0o600 });
  const argv = [o.node, executor, o.instalador, o.log, o.resultado, ...o.args];
  if (o.sistema === "windows") {
    const arq = path.join(o.pasta, "tarefa-atualizar.xml");
    const xml = xmlTarefaAtualizar(conhost(o.env), ["--headless", ...argv].map(aspasWindows).join(" "), o.pasta, await usuarioWindows(o));
    fs.writeFileSync(arq, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
    const c = await o.exec.rodar(["schtasks", "/Create", "/F", "/TN", TAREFA_ATUALIZAR, "/XML", arq]);
    if (c.codigo !== 0) throw new Error(`schtasks /Create falhou: ${c.erro.trim() || c.saida.trim() || c.codigo}`);
    const r = await o.exec.rodar(["schtasks", "/Run", "/TN", TAREFA_ATUALIZAR]);
    if (r.codigo !== 0) throw new Error(`schtasks /Run falhou: ${r.erro.trim() || r.saida.trim() || r.codigo}`);
    return;
  }
  const fd = fs.openSync(o.log, "a", 0o600);
  try {
    let final = argv;
    if (o.sistema === "linux" && o.env.INVOCATION_ID && (await o.exec.rodar(["systemd-run", "--version"])).codigo === 0) {
      final = ["systemd-run", "--user", "--scope", "--quiet", ...argv];
    }
    o.exec.iniciar(final, { cwd: o.pasta, env: o.env, solto: { saida: fd } });
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------------------------------------------ o que ficou registrado

/** A atualização em andamento (`~/.reveza/atualizacao.json`): quem estiver rodando depois conta como terminou. */
export interface AtualizacaoPendente {
  de: string;
  para: string;
  comando: number | null;
  em: number;
  pasta: string;
  log: string;
  resultado: string;
}

/** A última linha que diz algo no log do instalador (sem as cores do terminal), para o motivo da falha. */
export function ultimaLinha(log: string): string | null {
  try {
    const t = fs.readFileSync(log, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    const linhas = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return linhas.length ? linhas[linhas.length - 1]!.slice(0, 200) : null;
  } catch {
    return null;
  }
}
