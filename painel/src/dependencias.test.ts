import { describe, expect, it } from "vitest"

import lock from "../package-lock.json?raw"
import pacote from "../package.json?raw"

type Lock = { packages: Record<string, { version?: string }> }

/** braces até a 3.0.3 derruba o Node com padrões muito aninhados (GHSA-vfj7-8cjw-p6xm) e não tinha versão corrigida. */
function bracesVulneravel(versao: string): boolean {
  const [a, b, c] = versao.split(".").map(Number)
  return a < 3 || (a === 3 && b === 0 && c <= 3)
}

/**
 * minimatch antes da 11.0.1 tem negação de serviço por padrões (alerta do Dependabot de 31/10/2026). Ele vem só pelas
 * ferramentas de lint (eslint, typescript-eslint), que ainda pedem a 10: o package.json força a 11 em `overrides`.
 */
function minimatchVulneravel(versao: string): boolean {
  const [a, b, c] = versao.split(".").map(Number)
  return a < 11 || (a === 11 && b === 0 && c < 1)
}

describe("dependências do painel", () => {
  it("a CLI do shadcn não entra na instalação (o CSS dela mora em src/shadcn-tailwind.css; um @import dela sem o pacote quebra o build)", () => {
    const { dependencies = {}, devDependencies = {} } = JSON.parse(pacote) as Record<string, Record<string, string>>
    expect(dependencies).not.toHaveProperty("shadcn")
    expect(devDependencies).not.toHaveProperty("shadcn")
  })

  it("nenhum braces com a falha de estouro de pilha no package-lock.json", () => {
    const { packages } = JSON.parse(lock) as Lock
    const achados = Object.entries(packages)
      .filter(([caminho, p]) => /(^|\/)node_modules\/braces$/.test(caminho) && bracesVulneravel(p.version ?? "0.0.0"))
      .map(([caminho, p]) => `${caminho}@${p.version}`)
    expect(achados).toEqual([])
  })

  it("nenhum minimatch com a falha de negação de serviço no package-lock.json", () => {
    const { packages } = JSON.parse(lock) as Lock
    const achados = Object.entries(packages)
      .filter(([caminho, p]) => /(^|\/)node_modules\/minimatch$/.test(caminho) && minimatchVulneravel(p.version ?? "0.0.0"))
      .map(([caminho, p]) => `${caminho}@${p.version}`)
    expect(achados).toEqual([])
    expect(minimatchVulneravel("10.2.6")).toBe(true)
    expect(minimatchVulneravel("11.0.0")).toBe(true)
    expect(minimatchVulneravel("11.0.1")).toBe(false)
    expect(minimatchVulneravel("12.0.0")).toBe(false)
  })

  it("a regra da versão vulnerável", () => {
    expect(bracesVulneravel("3.0.3")).toBe(true)
    expect(bracesVulneravel("2.3.2")).toBe(true)
    expect(bracesVulneravel("3.0.4")).toBe(false)
    expect(bracesVulneravel("3.1.0")).toBe(false)
    expect(bracesVulneravel("4.0.0")).toBe(false)
  })
})
