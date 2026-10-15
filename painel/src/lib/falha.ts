// Quando uma tela quebra: reconhecer a falha de carga de uma versão antiga do painel (a aba aberta antes de uma versão
// nova pede um pedaço do build que não existe mais) e montar os detalhes que a pessoa copia para mandar, sem dado
// sensível.

import * as React from "react"

import type { Idioma } from "@/dados/tipos"

const CHAVE_RECARGA = "reveza.recarregou-por-versao"

/**
 * A mensagem que cada navegador dá quando o import() de um pedaço do build falha (404 depois de uma versão nova, rede
 * caída no meio): Chrome/Edge, Safari, Firefox e o pré-carregamento do Vite.
 */
export function ehFalhaDeCarga(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "")
  return /dynamically imported module|importing a module script failed|unable to preload css|chunkloaderror|loading (css )?chunk [\w-]+ failed|module script/i.test(
    msg
  )
}

/**
 * Recarrega a página uma vez para buscar a versão nova. Se já recarregou há menos de 1 minuto (a falha não era de
 * versão, ou a rede caiu), não recarrega de novo e devolve false: a tela mostra o erro.
 */
export function recarregarUmaVez(agora = Date.now()): boolean {
  try {
    const antes = Number(sessionStorage.getItem(CHAVE_RECARGA) ?? 0)
    if (agora - antes < 60_000) return false
    sessionStorage.setItem(CHAVE_RECARGA, String(agora))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * O carregador de um pedaço do build que, se o pedaço sumiu (versão nova publicada com a aba aberta), recarrega a
 * página uma vez e fica esperando, em vez de devolver a falha. Outros erros passam adiante.
 */
export function comRecarga<M>(carregar: () => Promise<M>): () => Promise<M> {
  return async () => {
    try {
      return await carregar()
    } catch (e) {
      // a página vai recarregar: fica "carregando" até lá, em vez de piscar o erro
      if (ehFalhaDeCarga(e) && recarregarUmaVez()) return new Promise<M>(() => {})
      throw e
    }
  }
}

/**
 * React.lazy com a recarga acima. O React guarda a falha de um lazy para sempre: sem recarregar a página, "Tentar de
 * novo" não teria como dar certo.
 */
export function telaPreguicosa<T extends React.ComponentType>(
  carregar: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(comRecarga(carregar))
}

/** Tira do texto o que pode ser dado de alguém: e-mail, token, chave longa, telefone e parâmetros de endereço. */
export function semDadoSensivel(texto: string): string {
  return (
    texto
      // endereços: só o caminho (a busca e o fragmento levam convite, token de sessão e afins)
      .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/gi, "$1")
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<e-mail>")
      .replace(/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, "<token>")
      .replace(/\b(sk|pk|rk|whsec|re|ghp|gho|xox[abp])[_-][\w-]{8,}/gi, "<chave>")
      .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "<valor longo>")
      .replace(/\+?\d[\d\s().-]{9,}\d/g, "<número>")
  )
}

export interface ContextoFalha {
  erro: unknown
  /** A pilha de componentes que o React passa ao limite de erro. */
  componentes?: string | null
  caminho: string
  versao: string
  agora?: Date
  navegador?: string
  /** Idioma da tela. Ausente cai em pt-BR (testes afirmam o português). */
  idioma?: Idioma
}

// Os rótulos de "Copiar detalhes" nos dois idiomas: é texto que a pessoa manda para quem cuida da instalação.
const TEXTOS = {
  "pt-BR": {
    cabecalho: "Reveza AI · painel",
    tela: "Tela",
    quando: "Quando",
    navegador: "Navegador",
    erro: "Erro",
    tipoSemCarregar: "Tipo: pedaço do build não carregou (versão nova publicada com a aba aberta?)",
    pilha: "Pilha",
    componentes: "Componentes",
  },
  en: {
    cabecalho: "Reveza AI · panel",
    tela: "Page",
    quando: "When",
    navegador: "Browser",
    erro: "Error",
    tipoSemCarregar: "Type: build chunk failed to load (new version published while this tab was open?)",
    pilha: "Stack",
    componentes: "Components",
  },
} as const

/** O texto de "Copiar detalhes": mensagem, pilha curta, rota e versão, sem dado sensível. */
export function detalhesDaFalha({
  erro,
  componentes,
  caminho,
  versao,
  agora = new Date(),
  navegador,
  idioma = "pt-BR",
}: ContextoFalha) {
  const x = TEXTOS[idioma]
  const e = erro instanceof Error ? erro : null
  const mensagem = e ? `${e.name}: ${e.message}` : String(erro)
  const pilha = (e?.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(`${e?.name}:`) && l !== e?.message)
    .slice(0, 8)
    // só o arquivo do build, sem o domínio
    .map((l) => l.replace(/https?:\/\/[^/\s)]+/g, "").replace(/\?[^\s):]*/g, ""))
  const comps = (componentes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((l) => l.replace(/https?:\/\/[^/\s)]+/g, "").replace(/\?[^\s):]*/g, ""))
  const linhas = [
    `${x.cabecalho} ${versao}`,
    `${x.tela}: ${caminho.split(/[?#]/)[0]}`,
    `${x.quando}: ${agora.toISOString()}`,
    ...(navegador ? [`${x.navegador}: ${navegador}`] : []),
    `${x.erro}: ${mensagem}`,
    ...(ehFalhaDeCarga(erro) ? [`${x.tipoSemCarregar}`] : []),
    ...(pilha.length ? [`${x.pilha}:`, ...pilha.map((l) => `  ${l}`)] : []),
    ...(comps.length ? [`${x.componentes}:`, ...comps.map((l) => `  ${l}`)] : []),
  ]
  return semDadoSensivel(linhas.join("\n"))
}
