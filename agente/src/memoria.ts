// A troca de conta e a memória do computador (0.10.6).
//
// Nos editores (VS Code e os derivados dele), a extensão do assistente vigia o ~/.claude.json. Quando o Reveza troca a
// conta, ela vê outra conta ali e atualiza todos os painéis, e cada painel abre um processo do assistente só para reler
// a configuração. Medido num Mac de 16 GB com 16 painéis: 16 processos em 1 s, 3,8 GB a mais e pressão de memória
// crítica; com a máquina já apertada, a leva travou a tela. Por isso a troca automática (o gatilho ou o rodízio) espera
// sobrar memória para a leva, até a conta em uso chegar a TETO_ESPERA_PCT ou a espera passar de ESPERA_MAXIMA_S. A troca
// do limite, do painel, da API e do conserto não espera.
//
// Os programas vão pelo caminho inteiro: o serviço do macOS roda com PATH curto, sem o /usr/sbin do sysctl (sem isso, a
// leitura dava null e a espera nunca ligava no Mac instalado como serviço; revisão da 0.10.6).
//
// Só contam as sessões abertas pela extensão do editor (0.10.7): é ela que abre a leva. A extensão sempre inicia o
// assistente com `--input-format stream-json`; sessão de terminal e `claude -p` não, e não abrem processo na troca. Sem
// sessão de editor (ou sem conseguir contar), a troca não espera: quem usa só o terminal fica como antes da 0.10.6.

import * as fs from "node:fs";
import * as os from "node:os";
import type { Sistema } from "./config.js";
import type { Executor } from "./util/executor.js";

export interface Memoria {
  /** Memória livre, em % do total. */
  livrePct: number;
  totalBytes: number;
  /** Sessões do assistente abertas pela extensão do editor agora: cada uma abre um processo na troca (null: não deu para contar). */
  sessoesEditor: number | null;
}

/** O que cada processo da leva chega a ocupar (medido: de 130 MB nos primeiros segundos a 250 MB). */
export const MB_POR_PROCESSO = 250;
/**
 * A leva estimada nunca passa disto (% da memória): nem todo painel aberto chega a abrir o processo, e sem teto, com 30
 * sessões no editor, toda troca automática esperaria até o fim.
 */
export const LEVA_MAXIMA_PCT = 20;
/** O que tem de sobrar livre depois da leva, em % da memória. Com o teto da leva, a troca espera abaixo de 30% livres. */
export const FOLGA_MINIMA_PCT = 10;
/** Com a conta em uso daqui para cima, a troca não espera mais (folga para um pedido grande antes do limite). */
export const TETO_ESPERA_PCT = 98;
/** Nenhuma troca espera mais do que isto. */
export const ESPERA_MAXIMA_S = 15 * 60;

const SYSCTL = "/usr/sbin/sysctl";
const PGREP = "/usr/bin/pgrep";
/** A linha de comando das sessões da extensão do editor (o pgrep -f compara com a linha inteira). */
export const PADRAO_EDITOR = "claude.*input-format stream-json";
/** O mesmo no Windows, pelo PowerShell (sem aspas duplas, que a linha de comando do Windows mexe). */
const CONTAR_NO_WINDOWS =
  "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -like '*--input-format stream-json*' }).Count";

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
  // sem sessão de editor não há leva: a troca não espera
  if (!mem.sessoesEditor) return { esperar: false };
  const totalMb = mem.totalBytes / (1024 * 1024);
  const levaMb = Math.min(mem.sessoesEditor * MB_POR_PROCESSO, (totalMb * LEVA_MAXIMA_PCT) / 100);
  const sobraPct = mem.livrePct - (levaMb * 100) / totalMb;
  return { esperar: sobraPct < FOLGA_MINIMA_PCT, sobraPct, levaMb };
}

/** De onde ler fora do macOS e de quem contar as sessões (os testes trocam). */
export interface FontesMemoria {
  meminfo?: string;
  so?: { freemem(): number; totalmem(): number };
  /** O usuário do agente: só as sessões dele contam. */
  uid?: number | null;
}

/** Lê a memória e conta as sessões do editor. Null quando não dá para ler a memória: aí a troca não espera. */
export async function lerMemoria(exec: Executor, sistema: Sistema, fontes: FontesMemoria = {}): Promise<Memoria | null> {
  let livrePct: number | null = null;
  let totalBytes = 0;
  try {
    if (sistema === "macos") {
      // a mesma medida do memory_pressure: % da memória disponível
      const r = await exec.rodar([SYSCTL, "-n", "kern.memorystatus_level", "hw.memsize"], { timeoutMs: 3000 });
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
  const uid = fontes.uid === undefined ? (process.getuid?.() ?? null) : fontes.uid;
  return { livrePct, totalBytes, sessoesEditor: await contarSessoesEditor(exec, sistema, uid) };
}

async function contarSessoesEditor(exec: Executor, sistema: Sistema, uid: number | null): Promise<number | null> {
  if (sistema === "windows") {
    const r = await exec.rodar(["powershell", "-NoProfile", "-NonInteractive", "-Command", CONTAR_NO_WINDOWS], { timeoutMs: 10000 });
    const n = Number(r.saida.trim());
    return r.codigo === 0 && r.saida.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
  }
  const r = await exec.rodar([PGREP, "-f", ...(uid === null ? [] : ["-U", String(uid)]), PADRAO_EDITOR], { timeoutMs: 3000 });
  if (r.codigo === 1) return 0; // o pgrep sai com 1 quando não acha nenhum
  if (r.codigo !== 0) return null;
  return r.saida.split("\n").filter((l) => /^\d+$/.test(l.trim())).length;
}
