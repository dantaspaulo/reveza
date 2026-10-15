// Guarda de segredos do próprio agente (a chave do cofre e a senha da identidade do computador), no lugar seguro de
// cada sistema:
// - macOS: Keychain (serviço "Reveza AI", conta = nome do segredo), pelo `security`, segredo por stdin quando cabe;
// - Windows: DPAPI do usuário (PowerShell `ProtectedData`), gravado em arquivo; o segredo entra pelo stdin;
// - Linux: `secret-tool` (Secret Service) quando existe; senão arquivo 600, com aviso no `doctor`.

import * as fs from "node:fs";
import * as path from "node:path";
import { gravarAtomico } from "../util/arquivos.js";
import type { Executor } from "../util/executor.js";
import { comandoGravar, decodificarSaida } from "../credenciais/macos.js";
import type { Sistema } from "../config.js";
import { t } from "../i18n.js";

export interface Guarda {
  readonly tipo: "keychain" | "dpapi" | "secret-tool" | "arquivo" | "falsa";
  /** Texto de aviso quando o lugar é mais fraco que o do sistema (arquivo 600). */
  readonly aviso: string | null;
  ler(nome: string): Promise<string | null>;
  gravar(nome: string, valor: string): Promise<void>;
  apagar(nome: string): Promise<void>;
}

export const SERVICO_GUARDA = "Reveza AI";

const NOME_VALIDO = /^[a-z][a-z0-9-]{0,40}$/;
function conferirNome(nome: string): void {
  if (!NOME_VALIDO.test(nome)) throw new Error(`nome de segredo inválido: ${nome}`);
}

export class GuardaMac implements Guarda {
  readonly tipo = "keychain" as const;
  readonly aviso = null;
  constructor(private exec: Executor) {}

  async ler(nome: string): Promise<string | null> {
    conferirNome(nome);
    const r = await this.exec.rodar(["security", "find-generic-password", "-s", SERVICO_GUARDA, "-a", nome, "-w"]);
    return r.codigo === 0 ? decodificarSaida(r.saida) : null;
  }

  async gravar(nome: string, valor: string): Promise<void> {
    conferirNome(nome);
    const { argv, entrada } = comandoGravar(nome, SERVICO_GUARDA, valor);
    const r = await this.exec.rodar(argv, { entrada: entrada ?? undefined });
    if (r.codigo !== 0 || (await this.ler(nome)) !== valor) throw new Error(`não consegui guardar ${nome} no chaveiro`);
  }

  async apagar(nome: string): Promise<void> {
    conferirNome(nome);
    await this.exec.rodar(["security", "delete-generic-password", "-s", SERVICO_GUARDA, "-a", nome]);
  }
}

const PS_PROTEGER =
  "Add-Type -AssemblyName System.Security;" +
  "$t=[Console]::In.ReadToEnd();" +
  "$b=[Text.Encoding]::UTF8.GetBytes($t);" +
  "$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser');" +
  "[Console]::Out.Write([Convert]::ToBase64String($p))";

const PS_ABRIR =
  "Add-Type -AssemblyName System.Security;" +
  "$t=[Console]::In.ReadToEnd();" +
  "$p=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($t),$null,'CurrentUser');" +
  "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))";

export class GuardaWindows implements Guarda {
  readonly tipo = "dpapi" as const;
  readonly aviso = null;
  constructor(
    private exec: Executor,
    private pasta: string,
  ) {}

  private arquivo(nome: string): string {
    conferirNome(nome);
    return path.join(this.pasta, `${nome}.dpapi`);
  }

  private ps(script: string, entrada: string) {
    return this.exec.rodar(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], { entrada, timeoutMs: 30_000 });
  }

  async ler(nome: string): Promise<string | null> {
    let protegido: string;
    try {
      protegido = fs.readFileSync(this.arquivo(nome), "utf8").trim();
    } catch {
      return null;
    }
    const r = await this.ps(PS_ABRIR, protegido);
    return r.codigo === 0 && r.saida ? r.saida : null;
  }

  async gravar(nome: string, valor: string): Promise<void> {
    const r = await this.ps(PS_PROTEGER, valor);
    if (r.codigo !== 0 || !r.saida.trim()) throw new Error(`não consegui proteger ${nome} com a DPAPI`);
    gravarAtomico(this.arquivo(nome), r.saida.trim());
    if ((await this.ler(nome)) !== valor) throw new Error(`não consegui guardar ${nome}`);
  }

  async apagar(nome: string): Promise<void> {
    try {
      fs.unlinkSync(this.arquivo(nome));
    } catch {
      // já não existia
    }
  }
}

export class GuardaSecretTool implements Guarda {
  readonly tipo = "secret-tool" as const;
  readonly aviso = null;
  constructor(private exec: Executor) {}

  async ler(nome: string): Promise<string | null> {
    conferirNome(nome);
    const r = await this.exec.rodar(["secret-tool", "lookup", "servico", "reveza", "nome", nome]);
    return r.codigo === 0 && r.saida ? r.saida.replace(/\n$/, "") : null;
  }

  async gravar(nome: string, valor: string): Promise<void> {
    conferirNome(nome);
    const r = await this.exec.rodar(["secret-tool", "store", `--label=${SERVICO_GUARDA} (${nome})`, "servico", "reveza", "nome", nome], {
      entrada: valor,
    });
    if (r.codigo !== 0 || (await this.ler(nome)) !== valor) throw new Error(`não consegui guardar ${nome} no secret-tool`);
  }

  async apagar(nome: string): Promise<void> {
    conferirNome(nome);
    await this.exec.rodar(["secret-tool", "clear", "servico", "reveza", "nome", nome]);
  }
}

export class GuardaArquivo implements Guarda {
  readonly tipo = "arquivo" as const;
  // no idioma da hora em que o doctor lê (o idioma só existe depois do import)
  get aviso(): string {
    return t(
      "Os segredos do agente estão em arquivo com permissão 600 (sem Secret Service neste computador). " +
        "Instale o gnome-keyring ou o KeePassXC com o secret-tool para guardar no chaveiro do sistema.",
      "The agent's secrets are in a file with permission 600 (no Secret Service on this computer). " +
        "Install gnome-keyring or KeePassXC with secret-tool to store them in the system keychain.",
    );
  }
  constructor(private pasta: string) {}

  private arquivo(nome: string): string {
    conferirNome(nome);
    return path.join(this.pasta, nome);
  }

  async ler(nome: string): Promise<string | null> {
    try {
      return fs.readFileSync(this.arquivo(nome), "utf8");
    } catch {
      return null;
    }
  }

  async gravar(nome: string, valor: string): Promise<void> {
    gravarAtomico(this.arquivo(nome), valor, 0o600);
  }

  async apagar(nome: string): Promise<void> {
    try {
      fs.unlinkSync(this.arquivo(nome));
    } catch {
      // já não existia
    }
  }
}

export class GuardaFalsa implements Guarda {
  readonly tipo = "falsa" as const;
  readonly aviso = null;
  d = new Map<string, string>();
  async ler(nome: string) {
    return this.d.get(nome) ?? null;
  }
  async gravar(nome: string, valor: string) {
    this.d.set(nome, valor);
  }
  async apagar(nome: string) {
    this.d.delete(nome);
  }
}

/** A guarda do sistema. No Linux, o secret-tool só vale se responder (sem sessão D-Bus ele falha). */
export async function guardaDoSistema(sistema: Sistema, exec: Executor, pastaSegredos: string): Promise<Guarda> {
  if (sistema === "macos") return new GuardaMac(exec);
  if (sistema === "windows") return new GuardaWindows(exec, pastaSegredos);
  const r = await exec.rodar(["secret-tool", "search", "servico", "reveza"], { timeoutMs: 5000 });
  if (r.codigo === 0 || (r.codigo === 1 && !/not found|No such|cannot|Cannot/.test(r.erro))) return new GuardaSecretTool(exec);
  return new GuardaArquivo(pastaSegredos);
}

/** Nomes dos segredos que o agente guarda. */
export const SEGREDO_COFRE = "chave-cofre";
export const SEGREDO_COMPUTADOR = "computador";
