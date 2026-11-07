// Sessões críticas (0.15.0). Pedido do Paulo, 07/11/2026: as contas esgotaram e tudo parou, inclusive as sessões de
// monitoramento e de correção, que não podem parar. Reservar uma conta não resolve: a conta vale para o computador
// inteiro, e quando ele entra nela todas as sessões abertas gastam junto. E ele não quer uma conta parada esperando.
//
// O jeito: a pessoa marca as sessões críticas (`/reveza critica` na sessão, `reveza criticas marcar <sessão>` ou
// REVEZA_CRITICA=1 no comando que abre a sessão). Com a função ligada, quando nenhuma conta tem mais folga abaixo do
// gatilho (75% de fábrica), as sessões comuns ficam em espera (o mod recusa o prompt e a ação delas) e só as críticas
// seguem, gastando o que sobra. Quando uma conta volta a ter folga, as comuns voltam.

import { pctEfetivo } from "./decisao.js";
import type { EstadoLocal } from "./estado.js";

export const GATILHO_CRITICAS_PADRAO = 75;
export const GATILHO_CRITICAS_MIN = 50;
export const GATILHO_CRITICAS_MAX = 95;
/** Marca de sessão crítica que ninguém tocou nesse tempo sai da lista (a sessão acabou há muito). */
const MARCA_VALE_S = 30 * 24 * 3600;
const MARCAS_MAX = 500;

export function gatilhoValido(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= GATILHO_CRITICAS_MIN && v <= GATILHO_CRITICAS_MAX ? Math.round(v) : null;
}

/** O id de sessão que o mod manda: o formato de um uuid ou de um id curto, nada de caminho nem espaço. */
export function sessaoValida(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(v) ? v : null;
}

/**
 * A conta ainda tem folga para as sessões comuns: dá para usar (sem pausa, com login, roda o modelo deste computador) e
 * o maior uso entre as janelas que decidem está abaixo do gatilho. Leitura velha vale pelo último número (com o reset
 * que já passou contando como zero): esperar uma leitura nova seguraria as comuns sem motivo.
 */
export function temFolga(estado: EstadoLocal, id: string, t: number, gatilho: number): boolean {
  const c = estado.contas[id];
  if (!c || c.pausada || c.precisaLogin) return false;
  if ((estado.semModelo?.[id]?.ate ?? 0) > t) return false;
  const p = pctEfetivo(c, t);
  return p !== null && p < gatilho;
}

export interface SituacaoCriticas {
  /** As sessões comuns estão em espera agora. */
  segurar: boolean;
  gatilho: number;
}

/** null: a função está desligada. Sem nenhuma conta conhecida, não segura (não há o que proteger). */
export function situacaoCriticas(estado: EstadoLocal, t: number): SituacaoCriticas | null {
  const k = estado.config;
  if (k.criticas !== true) return null;
  const gatilho = gatilhoValido(k.criticasGatilho) ?? GATILHO_CRITICAS_PADRAO;
  const ids = Object.keys(estado.contas);
  if (!ids.length) return { segurar: false, gatilho };
  return { segurar: !ids.some((id) => temFolga(estado, id, t, gatilho)), gatilho };
}

export function sessaoCritica(estado: EstadoLocal, sessao: string): boolean {
  return !!estado.sessoesCriticas?.[sessao];
}

/** Marca ou desmarca. Devolve se mudou. A marca guarda quando foi feita ou lembrada pela última vez. */
export function marcarCritica(estado: EstadoLocal, sessao: string, critica: boolean, t: number): boolean {
  const marcas = (estado.sessoesCriticas ??= {});
  const tinha = !!marcas[sessao];
  if (critica) marcas[sessao] = t;
  else delete marcas[sessao];
  podarCriticas(estado, t);
  return tinha !== critica;
}

/** A sessão marcada que voltou a falar com o agente renova a marca (sessão viva há mais de 30 dias continua crítica). */
export function lembrarCritica(estado: EstadoLocal, sessao: string, t: number): void {
  const marcas = estado.sessoesCriticas;
  if (marcas?.[sessao] && t - marcas[sessao]! > 24 * 3600) marcas[sessao] = t;
}

export function podarCriticas(estado: EstadoLocal, t: number): void {
  const marcas = estado.sessoesCriticas;
  if (!marcas) return;
  for (const [s, em] of Object.entries(marcas)) if (t - em > MARCA_VALE_S) delete marcas[s];
  const ordem = Object.entries(marcas).sort((a, b) => b[1] - a[1]);
  for (const [s] of ordem.slice(MARCAS_MAX)) delete marcas[s];
}
