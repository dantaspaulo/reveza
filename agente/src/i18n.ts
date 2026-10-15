// Idioma do que o agente mostra à pessoa (linha de comando e diagnóstico): português (o padrão) ou inglês.
//
// A escolha é a da instalação: o instalador pergunta no primeiro passo e grava `idioma` no instalacao.json; enquanto
// instala, passa REVEZA_IDIOMA às chamadas da linha de comando (o arquivo só é gravado no fim). O mesmo contrato do
// instalador (instalador/lib/texto.mjs): t("português", "english").
//
// O LANG do terminal não decide: o das máquinas de CI é inglês, e a saída sem escolha tem de seguir em português.

import * as path from "node:path";
import type { Caminhos } from "./config.js";
import { lerJson } from "./util/arquivos.js";

export type Idioma = "pt-BR" | "en";

let atual: Idioma = "pt-BR";

/** Aceita "en", "en-US", "pt", "pt-BR"; qualquer outra coisa (ou nada) fica no português. */
export function normalizarIdioma(i: unknown): Idioma {
  return /^en\b/i.test(String(i ?? "")) ? "en" : "pt-BR";
}

export function usarIdioma(i: unknown): Idioma {
  atual = normalizarIdioma(i);
  return atual;
}

export function idiomaAtual(): Idioma {
  return atual;
}

export function t(pt: string, en: string): string {
  return atual === "en" ? en : pt;
}

/** O idioma que a instalação escolheu (instalacao.json); sem o campo, das versões antes da escolha: português. */
export function idiomaDaInstalacao(c: Pick<Caminhos, "base">): Idioma {
  return normalizarIdioma(lerJson<{ idioma?: string }>(path.join(c.base, "instalacao.json"))?.idioma);
}

/** --idioma vence; depois o REVEZA_IDIOMA (o instalador, enquanto instala); depois o instalacao.json. */
export function resolverIdioma(flag: unknown, env: NodeJS.ProcessEnv, c: Pick<Caminhos, "base">): Idioma {
  if (typeof flag === "string" && flag) return normalizarIdioma(flag);
  if (env.REVEZA_IDIOMA) return normalizarIdioma(env.REVEZA_IDIOMA);
  return idiomaDaInstalacao(c);
}
