// Leitura e gravação de arquivos do agente: JSON atômico (grava ao lado e renomeia) e modo 600.

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function lerJson<T>(caminho: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * `duravel` (o padrão): o conteúdo vai ao disco antes da troca de nome, e a pasta depois dela. Sem isso, uma queda de
 * energia logo depois da gravação deixava o arquivo novo vazio ou com bytes nulos (relato de um usuário, Windows,
 * 22/10/2026: o estado.json voltou ilegível e o agente subiu sem a lista de contas). Custa uns 8 ms por gravação do
 * estado (medido no Mac mini, 200 KB); quem grava muito e se refaz sozinho (o registro de uso) pede `duravel: false`.
 */
export function gravarAtomico(caminho: string, conteudo: string | Buffer, modo = 0o600, { duravel = true }: { duravel?: boolean } = {}): void {
  fs.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
  // nome imprevisível e criação exclusiva ("wx"): nunca segue um link deixado no lugar do temporário
  const tmp = `${caminho}.tmp.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    const fd = fs.openSync(tmp, "wx", modo);
    try {
      fs.writeFileSync(fd, conteudo);
      if (duravel) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.chmodSync(tmp, modo);
    } catch {
      // Windows: o modo não se aplica; vale a ACL do perfil
    }
    fs.renameSync(tmp, caminho);
  } catch (e) {
    // disco cheio no meio da gravação deixava o temporário pela metade ao lado do arquivo (visto em 13/10/2026)
    apagarSemErro(tmp);
    throw e;
  }
  if (duravel) sincronizarPasta(path.dirname(caminho));
}

/** A troca de nome no disco (POSIX). O Windows não abre pasta para isso; lá o NTFS registra a troca no diário dele. */
function sincronizarPasta(pasta: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(pasta, "r");
    fs.fsyncSync(fd);
  } catch {
    // sem suporte: o conteúdo já foi ao disco, que é o que evita o arquivo vazio
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function apagarSemErro(caminho: string): void {
  try {
    fs.rmSync(caminho, { force: true });
  } catch {
    // o erro que importa é o da gravação
  }
}

export function gravarJson(caminho: string, dados: unknown, modo = 0o600, opcoes: { duravel?: boolean } = {}): void {
  gravarAtomico(caminho, JSON.stringify(dados, null, 1), modo, opcoes);
}

export function garantirPasta(caminho: string): void {
  fs.mkdirSync(caminho, { recursive: true, mode: 0o700 });
}

/** Cópia recursiva sem apagar nada no destino e sem tocar a origem (Node 18 não tem fs.cpSync estável). */
export function copiarPasta(origem: string, destino: string): number {
  let n = 0;
  garantirPasta(destino);
  for (const nome of fs.readdirSync(origem)) {
    const de = path.join(origem, nome);
    const para = path.join(destino, nome);
    const st = fs.lstatSync(de);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) n += copiarPasta(de, para);
    else if (st.isFile()) {
      fs.copyFileSync(de, para);
      try {
        fs.chmodSync(para, 0o600);
      } catch {
        // Windows
      }
      n += 1;
    }
  }
  return n;
}

export function igualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") {
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) saida[k] = ordenar((v as Record<string, unknown>)[k]);
    return saida;
  }
  return v;
}

export function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
