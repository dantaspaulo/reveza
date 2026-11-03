// Preço equivalente pela tabela pública da API, em dólar por milhão de tokens: (entrada, saída, leitura de cache).
// Escrita de cache: 1,25x a entrada (5 min) e 2x (1 h). É uma ESTIMATIVA do que a mesma conversa custaria pela API:
// na assinatura não se paga por token. Tabela herdada do registro de uso que já roda (cache de 06/10/2026).

export const PRECOS: Record<string, [number, number, number]> = {
  "claude-fable-5-1": [10.0, 50.0, 0.25],
  "claude-mythos-5-1": [10.0, 50.0, 0.25],
  "claude-fable-5": [10.0, 50.0, 1.0],
  "claude-mythos-5": [10.0, 50.0, 1.0],
  "claude-opus-5-5": [4.0, 20.0, 0.2],
  "claude-opus-5": [5.0, 25.0, 0.5],
  "claude-opus-4-8": [5.0, 25.0, 0.5],
  "claude-opus-4-7": [5.0, 25.0, 0.5],
  "claude-opus-4-6": [5.0, 25.0, 0.5],
  "claude-sonnet-5-5": [2.0, 10.0, 0.2],
  "claude-sonnet-5": [2.0, 10.0, 0.2],
  "claude-sonnet-4-6": [3.0, 15.0, 0.3],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-haiku-4-5": [1.0, 5.0, 0.1],
};
export const PRECO_PADRAO = "claude-opus-5-5";
/** Preço por faixa: com o pedido (entrada + cache) acima do limite, vale a outra tabela (o Haiku 5.5, acima de 100 mil). */
const FAIXA: Record<string, { acima: number; precos: [number, number, number] }> = {
  "claude-haiku-5-5": { acima: 100_000, precos: [0.5, 2.5, 0.05] },
};
const RAPIDO_X: Record<string, number> = { "claude-opus-5-5": 2.0, "claude-opus-5": 2.0, "claude-opus-4-8": 2.0 };
const POR_TAMANHO = Object.keys(PRECOS).sort((a, b) => b.length - a.length);

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

/** O nome da tabela de preços para um modelo como a transcrição o grava (com sufixo de data, [1m] etc.). */
export function familia(modelo: string | null | undefined): string | null {
  const m = (modelo ?? "").toLowerCase().split("[")[0]!;
  for (const nome of POR_TAMANHO) if (m.startsWith(nome)) return nome;
  return null;
}

export interface Tokens {
  ent: number;
  sai: number;
  c5: number;
  c1h: number;
  cl: number;
}

export function tokens(u: Usage): Tokens {
  const cc = u.cache_creation ?? {};
  let c5 = cc.ephemeral_5m_input_tokens;
  let c1h = cc.ephemeral_1h_input_tokens;
  if (c5 === undefined && c1h === undefined) {
    c5 = u.cache_creation_input_tokens ?? 0;
    c1h = 0;
  }
  return { ent: u.input_tokens ?? 0, sai: u.output_tokens ?? 0, c5: c5 ?? 0, c1h: c1h ?? 0, cl: u.cache_read_input_tokens ?? 0 };
}

/** US$ equivalentes de uma resposta e se foi estimado (modelo fora da tabela usa o preço padrão). */
export function custo(u: Usage, modelo: string | null | undefined): { usd: number; estimado: boolean } {
  const nome = familia(modelo);
  const t = tokens(u);
  const faixa = FAIXA[nome ?? ""];
  const [entrada, saida, leitura] =
    faixa && t.ent + t.c5 + t.c1h + t.cl > faixa.acima ? faixa.precos : PRECOS[nome ?? PRECO_PADRAO]!;
  const x = u.speed === "fast" ? (RAPIDO_X[nome ?? ""] ?? 1) : 1;
  const usd = ((t.ent * entrada + t.sai * saida + t.c5 * entrada * 1.25 + t.c1h * entrada * 2 + t.cl * leitura) / 1_000_000) * x;
  return { usd, estimado: nome === null };
}
