import { afterEach, describe, expect, it, vi } from "vitest"

import { comRecarga, detalhesDaFalha, ehFalhaDeCarga, recarregarUmaVez, semDadoSensivel } from "./falha"

describe("falha de carga de uma versão antiga", () => {
  it("reconhece a mensagem de cada navegador e não confunde com erro de dado", () => {
    // Chrome/Edge, Safari, Firefox e o pré-carregamento do Vite
    for (const msg of [
      "Failed to fetch dynamically imported module: https://painel.exemplo/assets/alertas-OLD.js",
      "Importing a module script failed.",
      "error loading dynamically imported module: https://painel.exemplo/assets/alertas-OLD.js",
      "Unable to preload CSS for /assets/alertas-OLD.css",
    ])
      expect(ehFalhaDeCarga(new TypeError(msg)), msg).toBe(true)
    expect(ehFalhaDeCarga(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(ehFalhaDeCarga(null)).toBe(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function navegadorFalso() {
    const guardado = new Map<string, string>()
    const reload = vi.fn()
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
    })
    vi.stubGlobal("window", { location: { reload } })
    return reload
  }

  it("recarrega uma vez só por minuto (sem laço se o problema não for a versão)", () => {
    const reload = navegadorFalso()
    expect(recarregarUmaVez(1_000_000)).toBe(true)
    expect(recarregarUmaVez(1_030_000)).toBe(false)
    expect(recarregarUmaVez(1_061_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it("o carregador da tela recarrega a página quando o pedaço do build sumiu, e repassa o erro que não é de carga", async () => {
    const reload = navegadorFalso()
    const carregar = comRecarga(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: x")))
    const resultado = await Promise.race([carregar(), new Promise((r) => setTimeout(() => r("esperando"), 20))])
    expect(resultado).toBe("esperando")
    expect(reload).toHaveBeenCalledTimes(1)

    const carregar2 = comRecarga(() => Promise.reject(new Error("outra coisa")))
    await expect(carregar2()).rejects.toThrow("outra coisa")
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe("detalhes para copiar", () => {
  it("levam mensagem, pilha curta, rota e versão, sem dado sensível", () => {
    const erro = new TypeError(
      "conta ana@escritorio.exemplo sem leitura; token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc"
    )
    erro.stack = [
      `TypeError: ${erro.message}`,
      "    at Ze (https://painel.reveza.ia.br/assets/alertas-5U9JIrVV.js:1:2345)",
      "    at Gn (https://painel.reveza.ia.br/assets/index-Cy6747LR.js?v=1#x:10:99)",
    ].join("\n")
    const texto = detalhesDaFalha({
      erro,
      componentes: "\n    at Alertas\n    at Suspense\n    at ProtecaoSecao (https://painel.reveza.ia.br/assets/index-Cy6747LR.js:9:1)",
      caminho: "/alertas?convite=segredo123#access_token=eyJabc.def",
      versao: "0.1.5",
      agora: new Date("2026-10-12T04:00:00Z"),
      navegador: "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0",
    })
    expect(texto).toContain("Reveza AI · painel 0.1.5")
    expect(texto).toContain("Tela: /alertas\n")
    expect(texto).toContain("Quando: 2026-10-12T04:00:00.000Z")
    expect(texto).toContain("at Ze (/assets/alertas-5U9JIrVV.js:1:2345)")
    expect(texto).toContain("at Alertas")
    expect(texto).toContain("<e-mail>")
    expect(texto).toContain("<token>")
    expect(texto).not.toMatch(/ana@|segredo123|access_token|eyJhbGci|painel\.reveza\.ia\.br/)
  })

  it("a falha de carga vem marcada", () => {
    const texto = detalhesDaFalha({
      erro: new TypeError("Failed to fetch dynamically imported module: https://painel.exemplo/assets/alertas-OLD.js"),
      caminho: "/alertas",
      versao: "0.1.4",
    })
    expect(texto).toContain("pedaço do build não carregou")
  })

  it("em inglês os rótulos e a versão saem no idioma da tela", () => {
    const texto = detalhesDaFalha({
      erro: new TypeError("Failed to fetch dynamically imported module: https://painel.exemplo/assets/alertas-OLD.js"),
      caminho: "/alertas?convite=segredo123",
      versao: "0.1.5",
      agora: new Date("2026-10-12T04:00:00Z"),
      navegador: "Mozilla/5.0 (Macintosh)",
      idioma: "en",
    })
    expect(texto).toContain("Reveza AI · panel 0.1.5")
    expect(texto).toContain("Page: /alertas\n")
    expect(texto).toContain("When: 2026-10-12T04:00:00.000Z")
    expect(texto).toContain("Browser: Mozilla/5.0 (Macintosh)")
    expect(texto).toContain("build chunk failed to load")
    expect(texto).not.toMatch(/Tela:|Quando:|Navegador:|pedaço do build/)
    expect(texto).not.toContain("segredo123")
  })

  it("tira chaves, valores longos e telefones", () => {
    expect(semDadoSensivel("chave re_AbCdEfGh12345678 e sk-ant-api03-xyzxyzxyz")).toBe("chave <chave> e <chave>")
    expect(semDadoSensivel("x " + "A".repeat(50))).toBe("x <valor longo>")
    expect(semDadoSensivel("ligar +55 (85) 99999-1234")).toBe("ligar <número>")
    expect(semDadoSensivel("versão 0.1.5, linha 1:2345")).toBe("versão 0.1.5, linha 1:2345")
  })
})
