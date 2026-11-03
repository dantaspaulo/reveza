#!/usr/bin/env node
// Escreve o vercel.json do painel com os cabeçalhos de segurança da instalação: CSP restrita (scripts só do próprio
// domínio, conexões só com o Supabase da pessoa), HSTS, frame-ancestors 'none', Permissions-Policy, nosniff e
// Referrer-Policy, mais o rewrite de SPA. O instalador chama com a URL do Supabase (e o domínio próprio, se houver),
// faz o build aqui mesmo e copia este vercel.json para dentro de dist/ antes de publicar: a Vercel só serve o estático,
// por isso o arquivo não pede build nem framework.
//
//   node scripts/vercel-json.mjs --supabase https://<ref>.supabase.co [--dominio painel.exemplo.com --vercel x.vercel.app]
//   node scripts/vercel-json.mjs [--conferir]   só confere o arquivo existente (o build roda assim); saída 0 = ok

import { readFileSync, writeFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ARQUIVO = join(RAIZ, "vercel.json")
export const MARCADOR = "https://SEU-PROJETO.supabase.co"
export const COTACAO = "https://olinda.bcb.gov.br"

export function origemSupabase(url) {
  const u = new URL(url)
  if (u.protocol !== "https:") throw new Error("a URL do Supabase precisa ser https")
  return u.origin
}

export function csp(supabase) {
  const https = origemSupabase(supabase)
  const wss = https.replace(/^https:/, "wss:")
  return [
    "default-src 'self'",
    "script-src 'self'",
    // style-src precisa de 'unsafe-inline': os componentes (Radix, gráficos, animação) aplicam estilo em linha
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // a cotação do dólar (PTAX do Banco Central) para mostrar o custo também em real
    `connect-src 'self' ${https} ${wss} ${COTACAO}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ")
}

export function configuracao({ supabase = MARCADOR, dominio = null, vercelApp = null } = {}) {
  const seguranca = [
    { key: "Content-Security-Policy", value: csp(supabase) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=(), clipboard-write=(self)",
    },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ]
  const cfg = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    rewrites: [
      { source: "/((?!assets/|icones/|sw\\.js$|manifest\\.webmanifest$|robots\\.txt$).*)", destination: "/index.html" },
    ],
    headers: [
      { source: "/(.*)", headers: seguranca },
      { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ],
  }
  // Um domínio só: o endereço *.vercel.app redireciona para o domínio próprio.
  if (dominio && vercelApp)
    cfg.redirects = [
      // a raiz à parte: na Vercel, "/:caminho*" não pega o "/" (o index.html era servido no endereço velho)
      { source: "/", has: [{ type: "host", value: vercelApp }], destination: `https://${dominio}/`, permanent: true },
      {
        source: "/:caminho+",
        has: [{ type: "host", value: vercelApp }],
        destination: `https://${dominio}/:caminho+`,
        permanent: true,
      },
    ]
  return cfg
}

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : null
}

/** Confere o vercel.json: existe, tem a CSP e, com VITE_SUPABASE_URL no ambiente, libera exatamente esse Supabase. */
export function conferir(texto, url = process.env.VITE_SUPABASE_URL) {
  let cfg
  try {
    cfg = JSON.parse(texto)
  } catch {
    return "vercel.json não é um JSON válido"
  }
  const cabecalhos = cfg.headers?.find((h) => h.source === "/(.*)")?.headers ?? []
  const politica = cabecalhos.find((h) => h.key === "Content-Security-Policy")?.value
  if (!politica) return "vercel.json sem Content-Security-Policy"
  if (url && !politica.includes(`connect-src 'self' ${origemSupabase(url)} `))
    return `a CSP do vercel.json não libera ${origemSupabase(url)}: rode node scripts/vercel-json.mjs --supabase ${url}`
  return null
}

// Chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: a comparação de import.meta.url com
// `file://${argv[1]}` falhava calada no Windows e em pasta com espaço ou acento, e o script saía sem fazer nada.
function chamadoDireto() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

if (chamadoDireto()) {
  const supabase = argumento("supabase")
  if (!supabase) {
    let texto = ""
    try {
      texto = readFileSync(ARQUIVO, "utf8")
    } catch {
      console.error("vercel.json não existe: rode node scripts/vercel-json.mjs --supabase https://<ref>.supabase.co")
      process.exit(1)
    }
    const problema = conferir(texto)
    if (problema) {
      console.error(problema)
      process.exit(1)
    }
    process.exit(0)
  }
  const cfg = configuracao({ supabase, dominio: argumento("dominio"), vercelApp: argumento("vercel") })
  writeFileSync(ARQUIVO, JSON.stringify(cfg, null, 2) + "\n")
  console.log(`vercel.json escrito (connect-src: ${origemSupabase(supabase)})`)
}
