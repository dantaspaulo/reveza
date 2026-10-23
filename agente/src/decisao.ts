// Decisão LOCAL de troca, usada só sem nuvem (instalação `--sem-nuvem`). Com a nuvem ligada, quem decide é a função
// `decidir()` do banco e o agente só aplica a atribuição. As regras são as do roteador que já roda, com teste.

import { janelaDaConta } from "./anthropic.js";
import { ESPERA_ENTRE_TROCAS_S, LEITURA_VALIDA_S } from "./config.js";
import type { ContaLocal, EstadoLocal } from "./estado.js";

export type Acao =
  | ["trocar", string]
  | ["rodizio", string]
  | ["reagendar", null]
  | ["aviso", string | null]
  | ["sem_livre", null]
  | ["nada", null];

/** O maior % entre as janelas que decidem. Janela cujo reset já passou conta como zerada. */
export function pctEfetivo(conta: ContaLocal, t: number): number | null {
  const valores: number[] = [];
  for (const j of conta.janelas ?? []) {
    if (!janelaDaConta(j.tipo) || j.pct === null || j.pct === undefined) continue;
    valores.push(j.resetEm && j.resetEm <= t ? 0 : Number(j.pct));
  }
  return valores.length ? Math.max(...valores) : null;
}

export function leituraValida(conta: ContaLocal, t: number): boolean {
  if (!conta.lidoEm) return false;
  if (t - conta.lidoEm <= LEITURA_VALIDA_S) return true;
  // Leitura velha ainda vale se o que a tornava cheia já zerou (o reset passou).
  return pctEfetivo(conta, t) === 0;
}

export function gatilhoDeTroca(estado: EstadoLocal): number {
  return estado.config.modo === "limite" ? 100 : estado.config.troca;
}

function livres(estado: EstadoLocal, t: number): [number, string][] {
  const saida: [number, string][] = [];
  for (const [id, c] of Object.entries(estado.contas)) {
    if (id === estado.ativa || c.pausada || c.precisaLogin || !leituraValida(c, t)) continue;
    // não roda o modelo das sessões deste computador (sem créditos de uso): fora até a marca vencer
    if ((estado.semModelo?.[id]?.ate ?? 0) > t) continue;
    const p = pctEfetivo(c, t);
    if (p !== null && p < estado.config.aviso) saida.push([p, id]);
  }
  // empate no uso: a ordem do e-mail (o id local é sorteado na importação; o e-mail é o mesmo em todo lugar)
  const email = (id: string) => estado.contas[id]?.email ?? id;
  return saida.sort((a, b) => a[0] - b[0] || email(a[1]).localeCompare(email(b[1])));
}

export function candidata(estado: EstadoLocal, t: number): string | null {
  return livres(estado, t)[0]?.[1] ?? null;
}

export function escolherRodizio(estado: EstadoLocal, t: number, sorteio: (xs: string[]) => string): string | null {
  const l = livres(estado, t);
  if (!l.length) return null;
  if (estado.config.rodizio.ordem === "menor_uso") return l[0]![1];
  return sorteio(l.map(([, id]) => id).sort());
}

export const sorteioReal = (xs: string[]): string => xs[Math.floor(Math.random() * xs.length)]!;

export function decidir(estado: EstadoLocal, t: number, limite = false, sorteio = sorteioReal): Acao {
  const ativa = estado.ativa;
  if (!estado.config.auto || !ativa || !estado.contas[ativa]) return ["nada", null];
  const espera = estado.config.esperaEntreTrocasS ?? ESPERA_ENTRE_TROCAS_S;
  const p = pctEfetivo(estado.contas[ativa]!, t);
  if (
    estado.config.modo === "rodizio" &&
    estado.proximoRodizioEm &&
    t >= estado.proximoRodizioEm &&
    !limite &&
    (p === null || p < gatilhoDeTroca(estado))
  ) {
    if (t - (estado.trocadaEm || 0) < espera) return ["nada", null];
    const destino = escolherRodizio(estado, t, sorteio);
    return destino ? ["rodizio", destino] : ["reagendar", null];
  }
  if (limite || (p !== null && p >= gatilhoDeTroca(estado))) {
    const cand = candidata(estado, t);
    if (!cand) return ["sem_livre", null];
    if (limite || t - (estado.trocadaEm || 0) >= espera) return ["trocar", cand];
    return ["aviso", cand];
  }
  if (p !== null && p >= estado.config.aviso) return ["aviso", candidata(estado, t)];
  return ["nada", null];
}

export type EstadoConta = "precisa_login" | "ativa" | "pausada" | "proxima" | "sem_leitura" | "esgotada" | "livre";

export function estadoDaConta(estado: EstadoLocal, id: string, t: number): EstadoConta {
  const c = estado.contas[id]!;
  if (c.precisaLogin) return "precisa_login";
  if (id === estado.ativa) return "ativa";
  if (c.pausada) return "pausada";
  if (id === estado.proxima) return "proxima";
  const p = pctEfetivo(c, t);
  if (p === null) return "sem_leitura";
  return p >= gatilhoDeTroca(estado) ? "esgotada" : "livre";
}

export function agendarRodizio(estado: EstadoLocal, t: number, aleatorio = Math.random): void {
  if (estado.config.modo !== "rodizio") {
    estado.proximoRodizioEm = null;
    return;
  }
  const minutos = estado.config.rodizio.minutos || 90;
  estado.proximoRodizioEm = Math.floor(t + minutos * 60 * (0.75 + 0.5 * aleatorio()));
}
