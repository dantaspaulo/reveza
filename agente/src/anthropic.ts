// Os dois endereços de conta que o agente lê com o token de acesso: perfil (de quem é o login) e uso (as janelas).
// São os mesmos que o assistente lê no /usage. Nenhum deles gira o token: ler não queima login.

import { isoParaEpoch } from "./util/tempo.js";

/** As janelas da conta toda: são elas que decidem a troca. */
export const TIPOS_JANELA = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"] as const;
/**
 * A semana de um modelo (a API manda na lista `limits`, tipo `weekly_scoped`, desde outubro de 2026): aparece no
 * painel, mas não decide a troca de quem usa outro modelo.
 */
export const TIPOS_JANELA_MODELO = ["seven_day_fable"] as const;
export type TipoJanelaConta = (typeof TIPOS_JANELA)[number];
export type TipoJanela = TipoJanelaConta | (typeof TIPOS_JANELA_MODELO)[number];

/** A janela é da conta toda (entra na decisão)? */
export function janelaDaConta(tipo: unknown): tipo is TipoJanelaConta {
  return (TIPOS_JANELA as readonly unknown[]).includes(tipo);
}
/** Um tipo de janela que o agente conhece (da conta toda ou de um modelo). */
export function tipoDeJanela(tipo: unknown): tipo is TipoJanela {
  return janelaDaConta(tipo) || (TIPOS_JANELA_MODELO as readonly unknown[]).includes(tipo);
}

export const ROTULOS: Record<TipoJanela, string> = {
  five_hour: "5 horas",
  seven_day: "Semana",
  seven_day_opus: "Semana, modelo maior",
  seven_day_sonnet: "Semana, modelo médio",
  seven_day_fable: "Semana, Fable",
};

export interface Janela {
  tipo: TipoJanela;
  pct: number | null;
  resetEm: number | null;
}

export interface Perfil {
  accountUuid: string | null;
  email: string | null;
  orgUuid: string | null;
  org: string | null;
  orgTipo: string | null;
  tier: string | null;
}

export interface ApiContas {
  perfil(token: string): Promise<{ status: number; perfil?: Perfil }>;
  uso(token: string): Promise<{ status: number; janelas?: Janela[] }>;
}

const BETA = "oauth-2025-04-20";

export class ApiAnthropic implements ApiContas {
  constructor(
    private versaoCli = "2.1.293",
    private base = "https://api.anthropic.com",
    private f: typeof fetch = fetch,
  ) {}

  private async get(caminho: string, token: string): Promise<{ status: number; j: unknown }> {
    try {
      const r = await this.f(this.base + caminho, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": BETA,
          "User-Agent": `claude-code/${this.versaoCli}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.status !== 200) return { status: r.status, j: null };
      return { status: 200, j: await r.json() };
    } catch {
      return { status: 0, j: null };
    }
  }

  async perfil(token: string) {
    const { status, j } = await this.get("/api/oauth/profile", token);
    if (status !== 200 || !j || typeof j !== "object") return { status };
    return { status: 200, perfil: perfilDaResposta(j as Record<string, unknown>) };
  }

  async uso(token: string) {
    const { status, j } = await this.get("/api/oauth/usage", token);
    if (status !== 200 || !j || typeof j !== "object") return { status };
    return { status: 200, janelas: janelasDaResposta(j as Record<string, unknown>) };
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function perfilDaResposta(j: Record<string, unknown>): Perfil {
  const a = (j.account ?? {}) as Record<string, unknown>;
  const o = (j.organization ?? {}) as Record<string, unknown>;
  return {
    accountUuid: texto(a.uuid),
    email: texto(a.email)?.toLowerCase() ?? null,
    orgUuid: texto(o.uuid),
    org: texto(o.name),
    orgTipo: texto(o.organization_type),
    tier: texto(o.rate_limit_tier),
  };
}

/**
 * O tipo de janela de um item da lista `limits` (o formato novo da API, outubro de 2026): `session` é a de 5 horas,
 * `weekly_all` a semana da conta e `weekly_scoped` a semana de um modelo (só a do Fable, por enquanto). Em 22/10/2026,
 * 6 das 8 contas Max lidas traziam a semana só aqui (o campo `seven_day` vinha nulo) ou nem traziam semana geral.
 */
export function tipoDoLimite(x: Record<string, unknown>): TipoJanela | null {
  if (x.kind === "session") return "five_hour";
  if (x.kind === "weekly_all") return "seven_day";
  if (x.kind === "weekly_scoped") {
    const modelo = ((x.scope as Record<string, unknown> | null)?.model as Record<string, unknown> | null)?.display_name;
    return typeof modelo === "string" && /^fable\b/i.test(modelo.trim()) ? "seven_day_fable" : null;
  }
  return null;
}

export function janelasDaResposta(j: Record<string, unknown>): Janela[] {
  const saida: Janela[] = [];
  for (const tipo of TIPOS_JANELA) {
    const v = j[tipo];
    if (v && typeof v === "object") {
      const pct = (v as Record<string, unknown>).utilization;
      saida.push({
        tipo,
        pct: typeof pct === "number" ? Math.round(pct * 10) / 10 : null,
        resetEm: isoParaEpoch((v as Record<string, unknown>).resets_at),
      });
    }
  }
  // o formato novo completa o que os campos antigos não trouxeram (o campo antigo, quando vem, vale)
  const tem = new Set<TipoJanela>(saida.map((x) => x.tipo));
  for (const l of Array.isArray(j.limits) ? j.limits : []) {
    if (!l || typeof l !== "object" || Array.isArray(l)) continue;
    const x = l as Record<string, unknown>;
    const tipo = tipoDoLimite(x);
    if (!tipo || tem.has(tipo)) continue;
    tem.add(tipo);
    const pct = x.percent;
    saida.push({
      tipo,
      pct: typeof pct === "number" && Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null,
      resetEm: isoParaEpoch(x.resets_at),
    });
  }
  return saida;
}
