
import { describe, expect, it } from "vitest"

import { idiomaDoNavegador } from "@/i18n"
import sw from "../../public/sw.js?raw"

/** O idiomaDoSistema do service worker (public/sw.js), rodado com um navigator de mentira. */
function idiomaDoSistema(navigator: unknown): string {
  const fonte = /function idiomaDoSistema\(\) \{[\s\S]*?\n\}\n/.exec(sw)?.[0]
  if (!fonte) throw new Error("idiomaDoSistema sumiu do sw.js")
  return new Function("self", `${fonte}; return idiomaDoSistema()`)({ navigator }) as string
}

describe("idioma do aviso sem corpo (service worker)", () => {
  it("segue a mesma regra do painel: vale o primeiro idioma da lista", () => {
    const listas = [["pt-BR"], ["pt-PT", "en"], ["en-US"], ["en-US", "pt-BR"], ["es-ES", "pt-BR"], ["fr"]]
    for (const languages of listas) {
      expect(idiomaDoSistema({ languages, language: languages[0] })).toBe(idiomaDoNavegador(languages))
    }
  })

  it("sem navigator ou sem idioma, fica em pt-BR", () => {
    expect(idiomaDoSistema(undefined)).toBe("pt-BR")
    expect(idiomaDoSistema({ languages: [], language: "" })).toBe("pt-BR")
  })
})
