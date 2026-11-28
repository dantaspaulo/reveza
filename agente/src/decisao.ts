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

/**
 * Conta esgotada (0.21.0): uma janela que decide em 100% ou mais e que ainda não renovou (sem saber quando renova, segue
 * esgotada). É o teste do Trocar agora do painel (`painel_trocar_agora`, 0039). A semana de um modelo só não decide, e
 * sem leitura não é esgotada: a falta de leitura tem regra própria.
 */
export function esgotada(conta: ContaLocal, t: number): boolean {
  return (conta.janelas ?? []).some(
    (j) => janelaDaConta(j.tipo) && j.pct !== null && j.pct !== undefined && Number(j.pct) >= 100 && (!j.resetEm || j.resetEm > t),
  );
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

/**
 * A conta é da mesma organização da em uso e tem folga de verdade (30 pontos até o gatilho de troca). O cache da conversa
 * é da organização: trocar para outra faz as sessões abertas mandarem a conversa inteira de novo (medido em 07/11/2026:
 * 67% das sessões, contra 17% na mesma organização). Igual à rvz_mesma_org da nuvem (0033).
 */
export function mesmaOrganizacao(estado: EstadoLocal, id: string, p: number): boolean {
  const org = estado.ativa ? estado.contas[estado.ativa]?.org : null;
  return !!org && estado.contas[id]?.org === org && p <= gatilhoDeTroca(estado) - 30;
}

/** O prazo de "vai renovar logo", em horas, conferido (inteiro de 12 a 168); fora disso, o de fábrica (48), como a nuvem (0051). */
function horasDoPrazo(estado: EstadoLocal): number {
  return horasDoAproveitar(estado.config.aproveitarHoras) ?? 48;
}

/** O prazo da opção de usar primeiro a conta que vai renovar: inteiro de 12 a 168 horas; senão, null. */
export function horasDoAproveitar(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 12 && v <= 168 ? v : null;
}

/**
 * Usar primeiro a conta que vai renovar (0.22.3): com a opção ligada, quando a semana da conta renova (o reset futuro,
 * dentro do prazo), se ela ainda tem 20 pontos de folga até o gatilho de troca; senão, null. Menos que 20 daria outra
 * troca logo depois. Igual à rvz_vence_logo da nuvem (0051). `p`: o uso efetivo da conta.
 */
export function venceLogo(estado: EstadoLocal, id: string, p: number, t: number): number | null {
  if (estado.config.aproveitarVencer !== true) return null;
  const semana = estado.contas[id]?.janelas?.find((j) => j.tipo === "seven_day");
  if (!semana || semana.pct === null || semana.pct === undefined || !semana.resetEm) return null;
  if (semana.resetEm <= t || semana.resetEm > t + horasDoPrazo(estado) * 3600) return null;
  return p <= gatilhoDeTroca(estado) - 20 ? semana.resetEm : null;
}

/**
 * A ordem das candidatas: a que vai renovar logo antes (a que renova antes primeiro; só com a opção ligada), depois a da
 * mesma organização com folga, o menor uso e o e-mail no empate. `aproveitar` falso: o socorro, que fica com a de mais
 * folga (como a rvz_socorro da nuvem).
 */
function ordenar(estado: EstadoLocal, saida: [number, string][], t: number, aproveitar = true): [number, string][] {
  // empate no uso: a ordem do e-mail (o id local é sorteado na importação; o e-mail é o mesmo em todo lugar)
  const email = (id: string) => estado.contas[id]?.email ?? id;
  const fora = (x: [number, string]) => (mesmaOrganizacao(estado, x[1], x[0]) ? 0 : 1);
  const vence = (x: [number, string]) => (aproveitar ? venceLogo(estado, x[1], x[0], t) : null) ?? Infinity;
  const antes = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
  return saida.sort(
    (a, b) => antes(vence(a), vence(b)) || fora(a) - fora(b) || a[0] - b[0] || email(a[1]).localeCompare(email(b[1])),
  );
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
  return ordenar(estado, saida, t);
}

export function candidata(estado: EstadoLocal, t: number): string | null {
  return livres(estado, t)[0]?.[1] ?? null;
}

/** A conta com mais folga abaixo de `teto` (exclusivo) e com menos uso que `atual` (null: qualquer uso). */
function comMaisFolga(estado: EstadoLocal, t: number, teto: number, atual: number | null): string | null {
  const saida: [number, string][] = [];
  for (const [id, c] of Object.entries(estado.contas)) {
    if (id === estado.ativa || c.pausada || c.precisaLogin || !leituraValida(c, t)) continue;
    if ((estado.semModelo?.[id]?.ate ?? 0) > t) continue;
    const p = pctEfetivo(c, t);
    if (p !== null && p < teto && (atual === null || p < atual)) saida.push([p, id]);
  }
  return ordenar(estado, saida, t, false)[0]?.[1] ?? null;
}

/**
 * Para onde ir quando a conta em uso precisa sair (relato do Paulo, 06/11/2026: com todas as outras acima do aviso, a
 * em uso ficou 47 minutos em 100%): a livre de sempre; sem ela, a com mais folga abaixo do gatilho; com a em uso cheia,
 * pausada ou sem login (`cheia`), a com mais folga abaixo de 100%. `atual`: o uso da em uso (a nova tem menos).
 */
export function destinoDaTroca(estado: EstadoLocal, t: number, atual: number | null, cheia: boolean): string | null {
  return (
    candidata(estado, t) ??
    comMaisFolga(estado, t, gatilhoDeTroca(estado), atual) ??
    (cheia ? comMaisFolga(estado, t, 100, atual) : null)
  );
}

/** A conta em uso não pode seguir: pausada ou sem login (sai de uso na hora, mesmo com a troca automática desligada). */
export function ativaForaDeUso(estado: EstadoLocal): boolean {
  const c = estado.ativa ? estado.contas[estado.ativa] : undefined;
  return !!c && (c.pausada || c.precisaLogin);
}

export function escolherRodizio(estado: EstadoLocal, t: number, sorteio: (xs: string[]) => string): string | null {
  const l = livres(estado, t);
  if (!l.length) return null;
  if (estado.config.rodizio.ordem === "menor_uso") return l[0]![1];
  // a que vai renovar logo vem antes do sorteio, como na nuvem (a lista já vem com ela na frente)
  if (venceLogo(estado, l[0]![1], l[0]![0], t) !== null) return l[0]![1];
  // sorteio entre as da mesma organização com folga, quando há (como a nuvem: a organização vem antes do sorteio)
  const mesma = l.filter(([p, id]) => mesmaOrganizacao(estado, id, p));
  return sorteio((mesma.length ? mesma : l).map(([, id]) => id).sort());
}

export const sorteioReal = (xs: string[]): string => xs[Math.floor(Math.random() * xs.length)]!;

export function decidir(estado: EstadoLocal, t: number, limite = false, sorteio = sorteioReal): Acao {
  const ativa = estado.ativa;
  if (!ativa || !estado.contas[ativa]) return ["nada", null];
  if (ativaForaDeUso(estado)) {
    const destino = destinoDaTroca(estado, t, null, true);
    return destino ? ["trocar", destino] : ["sem_livre", null];
  }
  if (!estado.config.auto) return ["nada", null];
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
    // cheia pelo uso (no limite da sessão a janela de 5 h já foi enchida); a conta sem o modelo da sessão não está
    // cheia: sem outra abaixo do gatilho, a sessão segue no modelo padrão nela
    const cheia = p !== null && p >= 100;
    const cand = destinoDaTroca(estado, t, limite ? null : p, cheia);
    if (!cand) return ["sem_livre", null];
    if (limite || cheia || t - (estado.trocadaEm || 0) >= espera) return ["trocar", cand];
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
