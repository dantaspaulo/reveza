import { describe, expect, it } from "vitest"

import { secaoDoCaminho, SECOES } from "./rotas"

describe("rotas", () => {
  it("a tela Plano saiu do menu (0.13.0); o endereço guardado abre Contas", () => {
    expect(SECOES.some((s) => s.caminho === "/plano")).toBe(false)
    expect(secaoDoCaminho("/plano")?.id).toBe("contas")
    expect(secaoDoCaminho("/plano/")?.id).toBe("contas")
    expect(secaoDoCaminho("/constructor")).toBeUndefined()
    expect(secaoDoCaminho("/contas")?.id).toBe("contas")
  })

  it("Empresas virou Projetos (0.20.1): o endereço novo abre a tela e o guardado continua abrindo", () => {
    expect(SECOES.some((s) => s.caminho === "/empresas")).toBe(false)
    expect(secaoDoCaminho("/projetos")?.id).toBe("empresas")
    expect(secaoDoCaminho("/empresas")?.id).toBe("empresas")
    expect(secaoDoCaminho("/empresas/")?.id).toBe("empresas")
  })
})
