import { afterEach, describe, expect, it, vi } from "vitest"

import { en, pt } from "./dicionario"
import { idiomaDoNavegador, idiomaGuardado } from "./index"
import { buscar, interpolar, traduzir, traduzirPlural } from "./traduzir"

function folhas(o: unknown, prefixo = ""): Record<string, string> {
  const r: Record<string, string> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k
    if (typeof v === "string") r[caminho] = v
    else Object.assign(r, folhas(v, caminho))
  }
  return r
}

const fPt = folhas(pt)
const fEn = folhas(en)

describe("i18n", () => {
  it("português e inglês têm exatamente as mesmas chaves", () => {
    expect(Object.keys(fEn).sort()).toEqual(Object.keys(fPt).sort())
  })

  it("nenhum texto vazio", () => {
    expect(Object.entries(fPt).filter(([, v]) => !v.trim())).toEqual([])
    expect(Object.entries(fEn).filter(([, v]) => !v.trim())).toEqual([])
  })

  it("as variáveis {x} são as mesmas nos dois idiomas", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",")
    const diferentes = Object.keys(fPt).filter((k) => vars(fPt[k]) !== vars(fEn[k]))
    expect(diferentes).toEqual([])
  })

  it("sem nome de marca de terceiros do assistente nos textos", () => {
    const proibidas = /claude|anthropic|opus|sonnet|haiku/i
    expect(Object.entries(fPt).filter(([, v]) => proibidas.test(v))).toEqual([])
    expect(Object.entries(fEn).filter(([, v]) => proibidas.test(v))).toEqual([])
  })

  it("busca por caminho, troca variáveis e cai no português quando falta", () => {
    expect(buscar(pt, "menu.secoes.uso")).toBe("Uso")
    expect(buscar(pt, "menu.nao.existe")).toBeUndefined()
    expect(interpolar("Olá {nome}, {n} contas", { nome: "Ana", n: 3 })).toBe("Olá Ana, 3 contas")
    expect(interpolar("fica {x}", {})).toBe("fica {x}")
    expect(traduzir(en, pt, "menu.secoes.uso")).toBe("Usage")
    expect(traduzir({}, pt, "menu.secoes.uso")).toBe("Uso")
    expect(traduzir({}, {}, "chave.que.falta")).toBe("chave.que.falta")
    expect(traduzir(pt, pt, "computadores.versao", { versao: "0.4.2" })).toBe("versão 0.4.2")
  })

  it("plural: zero cai em 'outros' no português e usa .zero quando existe", () => {
    const dic = {
      c: { um: "{n} conta", outros: "{n} contas" },
      z: { zero: "nenhuma", um: "{n} conta", outros: "{n} contas" },
    }
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 1)).toBe("1 conta")
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 0)).toBe("0 contas")
    expect(traduzirPlural(dic, dic, "pt-BR", "c", 2)).toBe("2 contas")
    expect(traduzirPlural(dic, dic, "en", "z", 0)).toBe("nenhuma")
  })
})

describe("idioma do navegador", () => {
  it("qualquer 'pt...' é português; o resto cai no inglês", () => {
    expect(idiomaDoNavegador(["pt-BR"])).toBe("pt-BR")
    expect(idiomaDoNavegador(["pt", "en-US"])).toBe("pt-BR")
    expect(idiomaDoNavegador(["pt-PT"])).toBe("pt-BR")
    expect(idiomaDoNavegador(["en-US"])).toBe("en")
    expect(idiomaDoNavegador(["fr-FR", "en-GB"])).toBe("en")
    expect(idiomaDoNavegador(["en-US", "pt-BR"])).toBe("en")
    expect(idiomaDoNavegador([])).toBe("pt-BR")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function comNavegador() {
    vi.stubGlobal("document", {})
  }

  function armazenamento(valor: string | null) {
    vi.stubGlobal("localStorage", {
      getItem: () => valor,
      setItem: () => {},
    })
  }

  it("a escolha explícita vence o navegador; sem escolha, vale o navegador", () => {
    comNavegador()
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" })
    armazenamento("pt-BR")
    expect(idiomaGuardado()).toBe("pt-BR")

    armazenamento("en")
    expect(idiomaGuardado()).toBe("en")

    armazenamento(null)
    expect(idiomaGuardado()).toBe("en")
  })

  it("sem localStorage (prévia, janela privada) usa o navegador sem quebrar", () => {
    comNavegador()
    vi.stubGlobal("navigator", { languages: ["pt-BR"], language: "pt-BR" })
    expect(idiomaGuardado()).toBe("pt-BR")
  })

  it("fora do navegador (sem document, como nos testes) o padrão é pt-BR, qualquer que seja o LANG", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" })
    expect(idiomaGuardado()).toBe("pt-BR")
  })
})
