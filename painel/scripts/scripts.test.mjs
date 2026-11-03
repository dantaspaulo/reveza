import { describe, expect, it } from "vitest"

import { COMPONENTES, NOMES } from "./react-bits-lista.mjs"
import { componentesReactBits } from "./trava-react-bits.mjs"
import { configuracao, conferir, csp, origemSupabase } from "./vercel-json.mjs"

describe("trava do React Bits", () => {
  it("pega a pasta react-bits e o nome do componente em qualquer lugar", () => {
    expect(
      componentesReactBits([
        "painel/src/components/react-bits/CountUp.tsx",
        "painel/src/outro/ShinyText.tsx",
        "painel/src/components/rb/index.tsx",
        "painel/scripts/react-bits-lista.mjs",
      ])
    ).toEqual(["painel/src/components/react-bits/CountUp.tsx", "painel/src/outro/ShinyText.tsx"])
  })

  it("pega pelo conteúdo vindo do registro", () => {
    // o endereço montado em partes, para este próprio arquivo não cair na trava
    const ler = (c) => (c === "x.tsx" ? `// fonte: ${"react" + "bits.dev"}/r/Algo-TS-TW.json` : "")
    expect(componentesReactBits(["x.tsx", "y.tsx"], ler)).toEqual(["x.tsx"])
  })

  it("cada componente tem o resumo sha256 revisado (código de fora só entra conferido)", () => {
    expect(COMPONENTES.every((c) => /^[0-9a-f]{64}$/.test(c.sha256))).toBe(true)
  })

  it("a lista só tem componentes grátis (nenhum do Pro)", () => {
    expect(NOMES.length).toBeGreaterThan(5)
    expect(NOMES.every((n) => /^[A-Z][A-Za-z]+$/.test(n))).toBe(true)
  })
})

describe("cabeçalhos do vercel.json", () => {
  it("CSP restrita: script só do próprio domínio, conexão só com o Supabase da instalação", () => {
    const c = csp("https://abc.supabase.co")
    expect(c).toContain("script-src 'self';")
    expect(c).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co https://olinda.bcb.gov.br;")
    expect(c).toContain("frame-ancestors 'none'")
    expect(c).not.toContain("unsafe-eval")
    expect(c).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it("HSTS, nosniff, Referrer-Policy, Permissions-Policy e redirecionamento do domínio da Vercel", () => {
    const cfg = configuracao({
      supabase: "https://abc.supabase.co",
      dominio: "painel.exemplo.com",
      vercelApp: "x.vercel.app",
    })
    const nomes = cfg.headers[0].headers.map((h) => h.key)
    for (const n of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ])
      expect(nomes).toContain(n)
    expect(cfg.redirects[0]).toMatchObject({ source: "/", destination: "https://painel.exemplo.com/" })
    expect(cfg.redirects[1].destination).toBe("https://painel.exemplo.com/:caminho+")
  })

  it("conferir: recusa CSP de outro Supabase e arquivo sem CSP", () => {
    const texto = JSON.stringify(configuracao({ supabase: "https://abc.supabase.co" }))
    expect(conferir(texto, "https://abc.supabase.co")).toBeNull()
    expect(conferir(texto, "")).toBeNull()
    expect(conferir(texto, "https://outro.supabase.co")).toMatch(/não libera/)
    expect(conferir("{}", "")).toMatch(/sem Content-Security-Policy/)
    expect(conferir("não é json", "")).toMatch(/JSON/)
    expect(JSON.parse(texto)).not.toHaveProperty("buildCommand")
  })

  it("só aceita Supabase em https", () => {
    expect(origemSupabase("https://abc.supabase.co/")).toBe("https://abc.supabase.co")
    expect(() => origemSupabase("http://abc.supabase.co")).toThrow()
  })
})
