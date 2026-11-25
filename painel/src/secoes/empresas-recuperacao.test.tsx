// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { AuthDemo } from "@/auth/auth"
import { SessaoProvider } from "@/auth/sessao"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DadosFixos } from "@/dados/contexto"
import { FonteDemo } from "@/dados/demo"
import { ErroPainel } from "@/dados/fonte"
import { I18nProvider, useT } from "@/i18n"
import Empresas from "./empresas"

let raiz: Root | undefined
let tela: HTMLDivElement

function MudarIdioma() {
  const { setIdioma } = useT()
  return <button onClick={() => setIdioma("en")}>Mudar idioma no teste</button>
}

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
        <DadosFixos fonte={fonte} estado={estado}><MudarIdioma /><Empresas /></DadosFixos>
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

async function clicar(b: HTMLElement) {
  await act(async () => b.click())
}

async function digitar(campo: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor)
    campo.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("cadastro após salvar", () => {
  it("mantém a edição bloqueada após duas leituras falharem e só tenta ler de novo", async () => {
    const fonte = await montar()
    const ler = fonte.empresas.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    let falhas = 2
    vi.spyOn(fonte, "empresas").mockImplementation(async () => {
      if (falhas-- > 0) throw new Error("leitura indisponível")
      return ler()
    })
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')
    expect(nome).not.toBeNull()
    await digitar(nome!, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(nome?.disabled).toBe(true)
    expect(tela.textContent).toContain("Salvo. Falta atualizar o cadastro")
    await clicar(botao("Tentar atualizar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(nome?.disabled).toBe(true)
    await clicar(botao("Tentar atualizar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')?.disabled).toBe(false)
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')?.value).toBe("Agência alterada")
  })

  it("recusa confirmada mantém o rascunho editável", async () => {
    const fonte = await montar()
    const ler = vi.spyOn(fonte, "empresas")
    vi.spyOn(fonte, "salvarUnidades").mockRejectedValue(new ErroPainel("cadastro", "recusado", true))
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    await digitar(nome, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(nome.disabled).toBe(false)
    expect(nome.value).toBe("Agência alterada")
    expect(botao("Salvar").disabled).toBe(false)
    expect(ler).not.toHaveBeenCalled()
  })

  it("resultado incerto mantém o rascunho bloqueado mesmo quando a leitura retorna", async () => {
    const fonte = await montar()
    const salvarDeVerdade = fonte.salvarUnidades.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await salvarDeVerdade(passos)
      throw new Error("resposta perdida")
    })
    const ler = fonte.empresas.bind(fonte)
    let falha = true
    vi.spyOn(fonte, "empresas").mockImplementation(async () => {
      if (falha) throw new Error("sem leitura")
      return ler()
    })
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    await digitar(nome, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(nome.disabled).toBe(true)
    expect(tela.textContent).toContain("Não deu para confirmar se as mudanças foram salvas")
    expect((await ler()).empresas.some((e) => e.nome === "Agência alterada")).toBe(true)
    falha = false
    await clicar(botao("Tentar atualizar"))
    expect(nome.disabled).toBe(true)
    expect(salvar).toHaveBeenCalledTimes(1)
    const atualizado = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    expect(atualizado.disabled).toBe(true)
    expect(atualizado.value).toBe("Agência alterada")
    expect([...tela.querySelectorAll("button")].some((b) => b.textContent?.includes("Descartar rascunho e ver cadastro"))).toBe(false)
  })

  it("não libera edição quando a escrita sem resposta ainda pode terminar depois da leitura", async () => {
    const fonte = await montar()
    const ler = fonte.empresas.bind(fonte)
    const gravar = fonte.salvarUnidades.bind(fonte)
    let terminar: (() => Promise<unknown>) | undefined
    const salvar = vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      terminar = () => gravar(passos)
      throw new Error("resposta perdida antes de gravar")
    })
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    await digitar(nome, "Alfa alterada")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect((await ler()).empresas.some((e) => e.nome === "Alfa alterada")).toBe(false)
    expect(nome.disabled).toBe(true)
    const liberar = [...tela.querySelectorAll("button")].find((b) => b.textContent?.includes("Descartar rascunho e ver cadastro"))
    expect(!liberar || liberar.disabled).toBe(true)
    await act(async () => { await terminar!() })
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(nome.disabled).toBe(true)
  })

  it("devolver antes de salvar restaura a regra de origem sem escrita", async () => {
    const fonte = await montar((f) => f.dados.empresas.regras.push({
      id: "regra-exata", tipo: "pasta", padrao: "~/agentes/suporte",
      empresaId: "empresa-consultoria", computadorId: "pc-notebook",
    }))
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    const caixa = tela.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Suporte"]')
    expect(caixa).not.toBeNull()
    await clicar(caixa!)
    expect(tela.textContent).toContain("Estava em Consultoria")
    await clicar(botao("Devolver"))
    expect(salvar).not.toHaveBeenCalled()
    expect(tela.textContent).not.toContain("Alterações não salvas")
  })

  it("ao recuperar um movimento salvo, a próxima volta exige uma nova gravação", async () => {
    const fonte = await montar((f) => f.dados.empresas.regras.push({
      id: "regra-exata", tipo: "pasta", padrao: "~/agentes/suporte",
      empresaId: "empresa-consultoria", computadorId: "pc-notebook",
    }))
    const ler = fonte.empresas.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    let falhas = 2
    vi.spyOn(fonte, "empresas").mockImplementation(async () => {
      if (falhas-- > 0) throw new Error("sem leitura")
      return ler()
    })
    await clicar(tela.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Suporte"]')!)
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect((await ler()).regras.find((r) => r.padrao === "~/agentes/suporte")?.empresaId).toBe("empresa-agencia")
    expect(tela.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Suporte"]')?.disabled).toBe(true)
    await clicar(botao("Tentar atualizar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(tela.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Suporte"]')?.disabled).toBe(true)
    await clicar(botao("Tentar atualizar"))
    expect(tela.textContent).not.toContain("Estava em Consultoria")
    await clicar(tela.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Suporte"]')!)
    expect(botao("Salvar").disabled).toBe(false)
    expect((await ler()).regras.find((r) => r.padrao === "~/agentes/suporte")?.empresaId).toBe("empresa-agencia")
  })

  it("preserva a seleção de projeto e subprojeto novos com seus IDs reais após recuperar a leitura", async () => {
    const fonte = await montar()
    const ler = fonte.empresas.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades")
    let falha = true
    vi.spyOn(fonte, "empresas").mockImplementation(async () => {
      if (falha) throw new Error("sem leitura")
      return ler()
    })
    await clicar(botao("Novo projeto em Notebook"))
    await digitar(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!, "Alfa novo")
    await clicar(botao("Novo subprojeto"))
    await digitar(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do subprojeto"]')!, "Beta novo")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    const dados = await ler()
    const alfa = dados.empresas.find((e) => e.nome === "Alfa novo")!
    const beta = dados.empresas.find((e) => e.nome === "Beta novo")!
    expect(alfa.id).not.toMatch(/^novo-/)
    expect(beta.pai).toBe(alfa.id)
    falha = false
    await clicar(botao("Tentar atualizar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')?.value).toBe("Alfa novo")
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do subprojeto"]')?.value).toBe("Beta novo")
  })

  it("ignora leitura anterior ao salvar e conserva edição concorrente trazida pela leitura nova", async () => {
    const fonte = await montar()
    const ler = fonte.empresas.bind(fonte)
    const fotografiaVelha = await ler()
    const pendentes: ((dados: Awaited<ReturnType<typeof ler>>) => void)[] = []
    vi.spyOn(fonte, "empresas").mockImplementation(() => new Promise((resolve) => pendentes.push(resolve)))
    await clicar(botao("Mudar idioma no teste"))
    expect(pendentes).toHaveLength(1)
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!
    await digitar(nome, "Alfa editada")
    await clicar(botao("Save"))
    expect(pendentes).toHaveLength(2)
    expect(nome.disabled).toBe(true)
    await act(async () => pendentes[0]!(fotografiaVelha))
    expect(nome.disabled).toBe(true)
    fonte.dados.empresas.empresas.find((e) => e.id === "empresa-consultoria")!.nome = "Beta externa"
    const nova = await ler()
    await act(async () => pendentes[1]!(nova))
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.disabled).toBe(false)
    expect(tela.textContent).toContain("Beta externa")
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe("Alfa editada")
  })
})
