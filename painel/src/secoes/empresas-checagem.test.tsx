// @vitest-environment jsdom
// 0.22.1 (item 5): a checagem automática antes de ligar um projeto, na tela. O Salvar recusa e diz o motivo quando o
// projeto não teria como rodar; o que muda para as conversas aparece antes de salvar.
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { AuthDemo } from "@/auth/auth"
import { SessaoProvider } from "@/auth/sessao"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DadosFixos } from "@/dados/contexto"
import { FonteDemo } from "@/dados/demo"
import { I18nProvider } from "@/i18n"
import Empresas from "./empresas"

let raiz: Root | undefined
let tela: HTMLDivElement

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  })
  class ResizeObserverFalso { observe() {} unobserve() {} disconnect() {} }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverFalso })
})

afterEach(async () => {
  if (raiz) await act(async () => raiz?.unmount())
  tela?.remove()
  raiz = undefined
  vi.restoreAllMocks()
})

async function montar(preparar?: (fonte: FonteDemo) => void) {
  localStorage.setItem("reveza.idioma", "pt-BR")
  const fonte = new FonteDemo({ atrasoMs: 0, relogio: false })
  preparar?.(fonte)
  const estado = await fonte.carregar()
  tela = document.createElement("div")
  document.body.append(tela)
  raiz = createRoot(tela)
  await act(async () => {
    raiz?.render(
      <ThemeProvider><I18nProvider><TooltipProvider><SessaoProvider auth={new AuthDemo()}>
        <DadosFixos fonte={fonte} estado={estado}><Empresas /></DadosFixos>
      </SessaoProvider></TooltipProvider></I18nProvider></ThemeProvider>
    )
  })
  return fonte
}

function botao(nome: string): HTMLButtonElement {
  const encontrado = [...tela.querySelectorAll("button")].find((b) => b.textContent?.trim() === nome)
  if (!encontrado) throw new Error(`Botão ausente: ${nome}`)
  return encontrado
}

function chave(nome: string): HTMLElement {
  const encontrada = tela.querySelector<HTMLElement>(`[aria-label="Ligar ${nome}"]`)
  if (!encontrada) throw new Error(`Chave ausente: ${nome}`)
  return encontrada
}

/** O texto dos avisos de erro da tela (o Alert também usa role="alert"). */
function alertas(): string {
  return [...tela.querySelectorAll('[role="alert"]')].map((x) => x.textContent ?? "").join(" | ")
}

async function clicar(b: HTMLElement) {
  await act(async () => b.click())
}

function conta(fonte: FonteDemo, id: string) {
  const c = fonte.dados.contas.find((x) => x.id === id)
  if (!c) throw new Error(`Conta ausente: ${id}`)
  return c
}

function computador(fonte: FonteDemo, id: string) {
  const p = fonte.dados.computadores.find((x) => x.id === id)
  if (!p) throw new Error(`Computador ausente: ${id}`)
  return p
}

describe("Projetos: a checagem antes de ligar (0.22.1)", () => {
  it("recusa ligar quando nenhuma conta do projeto pode rodar, com as contas e o motivo, e não grava", async () => {
    const fonte = await montar((f) => {
      // a Agência tem a conta de trabalho e a do laboratório (esta já sem login na demonstração)
      conta(f, "conta-trabalho").precisaLogin = true
    })
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    await clicar(chave("Agência"))
    await clicar(botao("Salvar"))
    expect(salvar).not.toHaveBeenCalled()
    const alerta = alertas()
    expect(alerta).toContain("Não dá para ligar Agência")
    expect(alerta).toContain("trabalho@exemplo.com")
    expect(alerta).toContain("laboratorio@exemplo.com")
    expect(alerta).toContain("Precisa entrar de novo")
    // cada conta com o motivo depois de dois-pontos, sem parêntese dentro do parêntese
    expect(alerta).toContain("(laboratorio@exemplo.com: Precisa entrar de novo; trabalho@exemplo.com: Precisa entrar de novo)")
  })

  it("recusa ligar quando um computador visto há pouco onde ele roda está abaixo da 0.21.0", async () => {
    const fonte = await montar((f) => {
      computador(f, "pc-desktop").versao = "0.20.2"
    })
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    await clicar(chave("Agência"))
    await clicar(botao("Salvar"))
    expect(salvar).not.toHaveBeenCalled()
    const alerta = alertas()
    expect(alerta).toContain("Não dá para ligar Agência")
    expect(alerta).toContain("Desktop")
    expect(alerta).toContain("0.20.2")
    // diz em qual projeto fica o "Roda em" (o subprojeto não tem o seu)
    expect(alerta).toContain("tire-o de \"Roda em\" em Agência")
  })

  it("a recusa sai da tela quando a pessoa muda o rascunho", async () => {
    await montar((f) => {
      computador(f, "pc-desktop").versao = "0.20.2"
    })
    await clicar(chave("Agência"))
    await clicar(botao("Salvar"))
    expect(tela.textContent).toContain("Não dá para ligar Agência")
    await clicar(chave("Agência"))
    expect(tela.textContent).not.toContain("Não dá para ligar Agência")
  })

  it("mostra antes de salvar o computador que troca de conta, e salva quando dá para rodar", async () => {
    const fonte = await montar()
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    // sem mudança, nada de relatório
    expect(tela.textContent).not.toContain("O que muda ao ligar")
    await clicar(chave("Agência"))
    // o Desktop usa a conta pessoal, que não é da Agência; o Notebook já usa a de trabalho
    expect(tela.textContent).toContain("O que muda ao ligar")
    expect(tela.textContent).toContain("Em Desktop, as conversas de Agência saem de pessoal@exemplo.com")
    expect(tela.textContent).not.toContain("Em Notebook, as conversas de Agência")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(tela.textContent).not.toContain("Não dá para ligar")
  })

  it("avisa que as conversas esperam quando toda conta que roda está no limite", async () => {
    await montar((f) => {
      // a conta de trabalho esgotada e a do laboratório sem login: liga, mas as conversas esperam
      const c = conta(f, "conta-trabalho")
      c.janelas = [{ tipo: "five_hour", pct: 100, resetEm: new Date(Date.now() + 3 * 3600_000).toISOString() }]
    })
    await clicar(chave("Agência"))
    expect(tela.textContent).toContain("Todas as contas de Agência que podem rodar agora estão no limite")
  })
})
