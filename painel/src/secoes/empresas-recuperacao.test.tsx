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
import { recarregarPagina } from "@/lib/falha"
import Empresas from "./empresas"

vi.mock("@/lib/falha", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/falha")>()),
  recarregarPagina: vi.fn(),
}))

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

async function renderizar(fonte: FonteDemo) {
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
}

async function montar(preparar?: (fonte: FonteDemo) => void) {
  localStorage.setItem("reveza.idioma", "pt-BR")
  const fonte = new FonteDemo({ atrasoMs: 0, relogio: false })
  preparar?.(fonte)
  await renderizar(fonte)
  return fonte
}

/** Sair da tela e voltar, na mesma aba: o painel monta a seção de novo com a mesma fonte, sem recarregar a página. */
async function remontar(fonte: FonteDemo) {
  if (raiz) await act(async () => raiz?.unmount())
  tela?.remove()
  await renderizar(fonte)
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

  it("resultado incerto bloqueia a edição nesta aba e oferece só recarregar a página", async () => {
    vi.mocked(recarregarPagina).mockClear()
    const fonte = await montar()
    const salvarDeVerdade = fonte.salvarUnidades.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await salvarDeVerdade(passos)
      throw new Error("resposta perdida")
    })
    const ler = fonte.empresas.bind(fonte)
    vi.spyOn(fonte, "empresas").mockRejectedValue(new Error("sem leitura"))
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    await digitar(nome, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(nome.disabled).toBe(true)
    expect(tela.textContent).toContain("Não deu para confirmar se as mudanças foram salvas")
    expect(tela.textContent).toContain("recarregue a página")
    // o texto não promete que a edição volta sozinha: aqui ela não volta
    expect(tela.textContent).not.toContain("até o cadastro voltar")
    expect((await ler()).empresas.some((e) => e.nome === "Agência alterada")).toBe(true)
    // ler de novo não resolve: a gravação sem resposta pode terminar depois da leitura
    expect([...tela.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Tentar atualizar")).toBe(false)
    expect([...tela.querySelectorAll("button")].some((b) => b.textContent?.includes("Descartar rascunho e ver cadastro"))).toBe(false)
    await clicar(botao("Recarregar a página"))
    expect(recarregarPagina).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it("resultado incerto continua bloqueado quando a leitura nova volta", async () => {
    const fonte = await montar()
    const salvarDeVerdade = fonte.salvarUnidades.bind(fonte)
    vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await salvarDeVerdade(passos)
      throw new Error("resposta perdida")
    })
    const ler = vi.spyOn(fonte, "empresas")
    const nome = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    await digitar(nome, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(ler).toHaveBeenCalled()
    await expect(ler.mock.results.at(-1)?.value).resolves.toBeTruthy()
    await act(async () => {})
    const atualizado = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    expect(atualizado.disabled).toBe(true)
    expect(atualizado.value).toBe("Agência alterada")
    expect(tela.textContent).toContain("Não deu para confirmar se as mudanças foram salvas")
    expect(botao("Recarregar a página").disabled).toBe(false)
  })

  it("a trava do resultado incerto continua depois de sair da tela e voltar", async () => {
    const fonte = await montar()
    const salvarDeVerdade = fonte.salvarUnidades.bind(fonte)
    const salvar = vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await salvarDeVerdade(passos)
      throw new Error("resposta perdida")
    })
    await digitar(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!, "Agência alterada")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    await remontar(fonte)
    const depois = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    expect(depois.disabled).toBe(true)
    expect(tela.textContent).toContain("Não deu para confirmar se as mudanças foram salvas")
    expect(botao("Recarregar a página").disabled).toBe(false)
    expect([...tela.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Salvar")).toBe(false)
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it("sair com a gravação em curso e voltar: a edição só volta depois da resposta e de uma leitura nova", async () => {
    const fonte = await montar()
    const gravar = fonte.salvarUnidades.bind(fonte)
    let soltar!: () => void
    const salvar = vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await new Promise<void>((r) => {
        soltar = r
      })
      return gravar(passos)
    })
    await digitar(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!, "Alfa em curso")
    await clicar(botao("Salvar"))
    expect(salvar).toHaveBeenCalledTimes(1)
    await remontar(fonte)
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!.disabled).toBe(true)
    expect(tela.textContent).toContain("Uma gravação feita antes ainda está sem resposta")
    const ler = vi.spyOn(fonte, "empresas")
    await act(async () => {
      soltar()
    })
    await act(async () => {})
    expect(ler).toHaveBeenCalled()
    const campo = tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!
    expect(campo.disabled).toBe(false)
    expect(campo.value).toBe("Alfa em curso")
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it("sair com a gravação em curso e ela terminar sem resposta: a tela de volta fica travada", async () => {
    const fonte = await montar()
    const gravar = fonte.salvarUnidades.bind(fonte)
    let soltar!: () => void
    vi.spyOn(fonte, "salvarUnidades").mockImplementation(async (passos) => {
      await new Promise<void>((r) => {
        soltar = r
      })
      await gravar(passos)
      throw new Error("resposta perdida")
    })
    await digitar(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!, "Alfa em curso")
    await clicar(botao("Salvar"))
    await remontar(fonte)
    await act(async () => {
      soltar()
    })
    await act(async () => {})
    expect(tela.querySelector<HTMLInputElement>('input[aria-label="Nome do projeto"]')!.disabled).toBe(true)
    expect(tela.textContent).toContain("Não deu para confirmar se as mudanças foram salvas")
    expect(botao("Recarregar a página").disabled).toBe(false)
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
