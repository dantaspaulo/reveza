import * as React from "react"

import type { Idioma } from "@/dados/tipos"
import { en, pt, type Chave } from "./dicionario"
import { traduzir, traduzirPlural, type Variaveis } from "./traduzir"

const CHAVE_LOCAL = "reveza.idioma"

// A descrição que vai para o <meta name="description"> do index.html, no idioma da tela.
const DESCRICAO = {
  "pt-BR": "Reveza AI: painel das suas contas de assistente de código, computadores, troca automática e uso.",
  en: "Reveza AI: a panel for your coding assistant accounts, computers, automatic switching and usage.",
} as const

/**
 * Idioma pela preferência do navegador: vale a primeira da lista (a principal do aparelho); "pt..." é português, o
 * resto cai no inglês. Sem a lista, lê do navigator; sem nenhum idioma conhecido, pt-BR (o padrão do produto). Função
 * pura quando recebe `langs`.
 */
export function idiomaDoNavegador(langs?: readonly string[]): Idioma {
  const nav = typeof navigator === "undefined" ? null : navigator
  const lista = (langs ?? (nav?.languages?.length ? nav.languages : [nav?.language ?? ""])).filter(Boolean)
  if (lista.length === 0) return "pt-BR"
  return lista[0]!.toLowerCase().startsWith("pt") ? "pt-BR" : "en"
}

/** Escolha explícita (localStorage) vence; sem ela, a preferência do navegador; fora do navegador (testes), pt-BR. */
export function idiomaGuardado(): Idioma {
  try {
    const v = localStorage.getItem(CHAVE_LOCAL)
    if (v === "en" || v === "pt-BR") return v
  } catch {
    // sem armazenamento (janela privada, prévia): cai para o navegador
  }
  // o node dos testes tem navigator (segue o LANG da máquina), mas não tem document: aí vale o padrão
  if (typeof document === "undefined") return "pt-BR"
  return idiomaDoNavegador()
}

interface ContextoI18n {
  idioma: Idioma
  setIdioma: (i: Idioma) => void
  t: (chave: Chave, vars?: Variaveis) => string
  tn: (chave: string, n: number, vars?: Variaveis) => string
  /** Chave montada em tempo de execução (ex.: "erros." + código). Sem conferência de tipo. */
  tx: (chave: string, vars?: Variaveis) => string
}

const Contexto = React.createContext<ContextoI18n | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [idioma, setIdiomaEstado] = React.useState<Idioma>(idiomaGuardado)

  const setIdioma = React.useCallback((i: Idioma) => {
    setIdiomaEstado(i)
    try {
      localStorage.setItem(CHAVE_LOCAL, i)
    } catch {
      // ignora: a escolha vale só nesta aba
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = idioma
    // a meta description é estática no index.html (a CSP bloqueia script inline): ajusta aqui, no idioma da tela
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute("content", DESCRICAO[idioma])
  }, [idioma])

  const valor = React.useMemo<ContextoI18n>(() => {
    const dic = idioma === "en" ? en : pt
    return {
      idioma,
      setIdioma,
      t: (chave, vars) => traduzir(dic, pt, chave, vars),
      tn: (chave, n, vars) => traduzirPlural(dic, pt, idioma, chave, n, vars),
      tx: (chave, vars) => traduzir(dic, pt, chave, vars),
    }
  }, [idioma, setIdioma])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useT() {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useT fora do I18nProvider")
  return c
}

export type { Chave }
