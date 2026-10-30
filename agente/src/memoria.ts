// A troca de conta e a memória do computador (0.10.6).
//
// Nos editores (VS Code e os derivados dele), a extensão do assistente vigia o ~/.claude.json. Quando o Reveza troca a
// conta, ela vê outra conta ali e atualiza todos os painéis, e cada painel abre um processo do assistente só para reler
// a configuração. Medido num Mac de 16 GB com 16 painéis: 16 processos em 1 s, 3,8 GB a mais e pressão de memória
// crítica; com a máquina já apertada, a leva travou a tela. Por isso a troca automática (o gatilho ou o rodízio) espera
// sobrar memória para a leva, até a conta em uso chegar a TETO_ESPERA_PCT ou a espera passar de ESPERA_MAXIMA_S. A troca
// do limite, do painel, da API e do conserto não espera.

import * as fs from "node:fs";
import * as os from "node:os";
import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

export interface Memoria {
  /** Memória livre, em % do total. */
  livrePct: number;
  totalBytes: number;
  /** Processos do assistente rodando agora (null: não deu para contar). */
  processos: number | null;
}

/** O que cada processo da leva chega a ocupar (medido: de 130 MB nos primeiros segundos a 250 MB). */
export const MB_POR_PROCESSO = 250;
/** O que tem de sobrar livre depois da leva, em % da memória. */
export const FOLGA_MINIMA_PCT = 15;
/** Com a conta em uso daqui para cima, a troca não espera mais. */
export const TETO_ESPERA_PCT = 99;
/** Nenhuma troca espera mais do que isto. */
export const ESPERA_MAXIMA_S = 15 * 60;

/** A troca automática (o gatilho abaixo de 100% ou o rodízio) pode esperar; a do limite, do painel, da API e do conserto, não. */
export function trocaPodeEsperar(motivo: string): boolean {
  const m = /^chegou a (\d+(?:[.,]\d+)?)\s*%$/.exec(motivo.trim());
  if (m) return Number(m[1]!.replace(",", ".")) < 100;
  return /^rodízio/i.test(motivo.trim());
}

export interface PedidoDeTroca {
  motivo: string;
  /** O uso da conta em uso, em % (null: sem leitura). */
  pctConta: number | null;
  /** Desde quando esta troca espera (null: ainda não esperou). */
  desde: number | null;
  t: number;
}

/** Esperar ou não; quando a conta foi feita, quanto sobraria livre depois da leva (%) e o tamanho estimado dela (MB). */
export interface Espera {
  esperar: boolean;
  sobraPct?: number;
  levaMb?: number;
}

export function esperarMemoria(mem: Memoria | null, p: PedidoDeTroca): Espera {
  if (!mem || !(mem.totalBytes > 0) || !trocaPodeEsperar(p.motivo)) return { esperar: false };
  if (p.pctConta !== null && p.pctConta >= TETO_ESPERA_PCT) return { esperar: false };
  if (p.desde !== null && p.t - p.desde >= ESPERA_MAXIMA_S) return { esperar: false };
  const levaMb = (mem.processos ?? 0) * MB_POR_PROCESSO;
  const sobraPct = mem.livrePct - (levaMb * 1024 * 1024 * 100) / mem.totalBytes;
  return { esperar: sobraPct < FOLGA_MINIMA_PCT, sobraPct, levaMb };
}

/** De onde ler fora do macOS (os testes trocam). */
export interface FontesMemoria {
  meminfo?: string;
  so?: { freemem(): number; totalmem(): number };
}

/** Lê a memória e conta os processos do assistente. Null quando não dá para ler a memória: aí a troca não espera. */
export async function lerMemoria(exec: Executor, sistema: Sistema, fontes: FontesMemoria = {}): Promise<Memoria | null> {
  let livrePct: number | null = null;
  let totalBytes = 0;
  try {
    if (sistema === "macos") {
      // a mesma medida do memory_pressure: % da memória disponível
      const r = await exec.rodar(["sysctl", "-n", "kern.memorystatus_level", "hw.memsize"], { timeoutMs: 3000 });
      const [nivel, total] = r.saida.trim().split(/\s+/).map(Number);
      if (r.codigo === 0 && Number.isFinite(nivel) && Number.isFinite(total)) {
        livrePct = nivel!;
        totalBytes = total!;
      }
    } else if (sistema === "linux") {
      const texto = fs.readFileSync(fontes.meminfo ?? "/proc/meminfo", "utf8");
      const kb = (nome: string) => Number(new RegExp(`^${nome}:\\s+(\\d+)\\s*kB`, "m").exec(texto)?.[1] ?? NaN);
      const disponivel = kb("MemAvailable");
      const total = kb("MemTotal");
      if (disponivel >= 0 && total > 0) {
        livrePct = (disponivel / total) * 100;
        totalBytes = total * 1024;
      }
    } else {
      const so = fontes.so ?? os;
      const total = so.totalmem();
      if (total > 0) {
        livrePct = (so.freemem() / total) * 100;
        totalBytes = total;
      }
    }
  } catch {
    return null;
  }
  if (livrePct === null || !(totalBytes > 0)) return null;
  return { livrePct, totalBytes, processos: await contarProcessos(exec, sistema) };
}

async function contarProcessos(exec: Executor, sistema: Sistema): Promise<number | null> {
  if (sistema === "windows") {
    const r = await exec.rodar(["tasklist", "/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"], { timeoutMs: 5000 });
    if (r.codigo !== 0) return null;
    return r.saida.split(/\r?\n/).filter((l) => /^"claude\.exe"/i.test(l.trim())).length;
  }
  const r = await exec.rodar(["pgrep", "-x", "claude"], { timeoutMs: 3000 });
  if (r.codigo === 1) return 0; // o pgrep sai com 1 quando não acha nenhum
  if (r.codigo !== 0) return null;
  return r.saida.split("\n").filter((l) => /^\d+$/.test(l.trim())).length;
}
