#!/usr/bin/env node
// Capturas de cada seção do painel no modo demonstração, no celular (390x844) e no computador (1440x900), claro e
// escuro, com conferência de rolagem horizontal e de erro no console. Salva em capturas/ (ignorada pelo git).
//
//   npm run build && npm run capturas          sobe o "vite preview" do build e fotografa
//   npm run capturas --dev                  usa o servidor de desenvolvimento (mais rápido para ajustar)
//   URL=http://localhost:5173 npm run capturas   fotografa um servidor que já está de pé
//   SO=uso,contas npm run capturas          só algumas seções
//   IDIOMA=en npm run capturas              tudo em inglês (capturas/en-*.png) e confere se sobrou texto em português
//   ALVO=celular,celular-estreito TEMA=claro npm run capturas   só alguns tamanhos e um tema
//
// Usa o playwright-core 1.63.0 fixo do package.json e o Chromium que já está na máquina (CHROME=<caminho> para outro).
// NÃO roda "playwright install".

/* global document, window, getComputedStyle */
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright-core"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const SAIDA = join(RAIZ, "capturas")
const args = new Set(process.argv.slice(2))

const PAGINAS = [
  ["visao", "/"],
  ["contas", "/contas"],
  ["computadores", "/computadores"],
  ["uso", "/uso"],
  ["troca", "/troca"],
  ["alertas", "/alertas"],
  ["integracoes", "/integracoes"],
  ["time", "/time"],
  ["minha-conta", "/conta"],
  ["como-funciona", "/como-funciona"],
  ["saude", "/saude"],
  ["entrar", "/entrar"],
  ["duas-etapas", "/duas-etapas"],
  ["ativar-duas-etapas", "/ativar-duas-etapas"],
  ["esqueci", "/esqueci"],
  ["nova-senha", "/nova-senha"],
  ["convite", "/aceitar?convite=exemplo"],
]

// Rótulos das interações no idioma da rodada (as caixas de diálogo também são conferidas em inglês).
const L = (pt, en) => (process.env.IDIOMA === "en" ? en : pt)

const INTERACOES = [
  [
    "i-contas-editar",
    "/contas",
    async (p) => {
      await p
        .getByRole("button", { name: L(/^Ações: trabalho/, /^Actions: work/) })
        .first()
        .click()
      await p.getByRole("menuitem", { name: L("Editar regras", "Edit rules") }).click()
    },
  ],
  [
    "i-contas-conectar",
    "/contas",
    async (p) => {
      await p
        .getByRole("button", { name: L("Conectar conta", "Connect account") })
        .first()
        .click()
    },
  ],
  [
    "i-computadores-ligar",
    "/computadores",
    async (p) => {
      await p
        .getByRole("button", { name: L("Ligar computador novo", "Link new computer") })
        .first()
        .click()
      await p.getByRole("button", { name: L("Gerar o código de acesso", "Generate the access code") }).click()
      await p.getByText(L("Quando ele pedir, cole este código de acesso:", "When it asks, paste this access code:")).waitFor()
    },
  ],
  [
    "i-computadores-revogar",
    "/computadores",
    async (p) => {
      await p
        .getByRole("button", { name: L("Revogar", "Revoke") })
        .first()
        .click()
    },
  ],
  [
    "i-computadores-trocar",
    "/computadores",
    async (p) => {
      await p
        .getByRole("button", { name: L("Trocar conta agora", "Switch account now") })
        .first()
        .click()
    },
  ],
  [
    "i-alertas-novo",
    "/alertas",
    async (p) => {
      await p
        .getByRole("button", { name: L("Novo alerta", "New alert") })
        .first()
        .click()
    },
  ],
  [
    "i-integracoes-chave",
    "/integracoes",
    async (p) => {
      await p.getByRole("button", { name: L("Nova chave", "New key") }).click()
      await p.getByLabel(L("Nome", "Name")).fill(L("Painel de exemplo", "Example panel"))
      await p.getByRole("button", { name: L("Criar chave", "Create key") }).click()
      await p.getByText(L("Sua chave", "Your key")).waitFor()
    },
  ],
  [
    "i-troca-rascunho",
    "/troca",
    async (p) => {
      await p.getByLabel(L("Rodízio", "Rotation")).click()
    },
  ],
  [
    "i-time-convidar",
    "/time",
    async (p) => {
      await p
        .getByRole("button", { name: L("Convidar", "Invite") })
        .first()
        .click()
    },
  ],
  [
    "i-simulador",
    "/como-funciona",
    async (p, alvo) => {
      await p.getByLabel(L("Uma sessão acabou de bater no limite", "A session just hit the limit")).click()
      await p
        .getByText(alvo.mobile ? L("Conta B", "Account B") : L("Situação", "Situation"), { exact: true })
        .first()
        .scrollIntoViewIfNeeded()
    },
  ],
  [
    "i-menu-recolhido",
    "/uso",
    async (p, alvo) => {
      if (alvo.mobile) return
      await p.locator('[data-sidebar="trigger"]').first().click()
    },
  ],
  [
    "i-ingles",
    "/",
    async (p) => {
      await p.evaluate(() => localStorage.setItem("reveza.idioma", "en"))
      await p.reload({ waitUntil: "networkidle" })
    },
  ],
  [
    "i-ingles-troca",
    "/troca",
    async (p) => {
      await p.evaluate(() => localStorage.setItem("reveza.idioma", "en"))
      await p.reload({ waitUntil: "networkidle" })
    },
  ],
]

const ALVOS = [
  { nome: "celular", viewport: { width: 390, height: 844 }, escala: 2, mobile: true },
  { nome: "celular-estreito", viewport: { width: 360, height: 780 }, escala: 2, mobile: true },
  { nome: "desktop", viewport: { width: 1440, height: 900 }, escala: 1, mobile: false },
].filter((a) => !process.env.ALVO || process.env.ALVO.split(",").includes(a.nome))
const TEMAS = ["claro", "escuro"].filter((t) => !process.env.TEMA || t === process.env.TEMA)

function executavel() {
  if (process.env.CHROME) return process.env.CHROME
  const candidatos = [
    join(
      homedir(),
      "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ),
    join(homedir(), ".cache/ms-playwright/chromium-1243/chrome-linux/chrome"),
  ]
  return candidatos.find((c) => existsSync(c))
}

async function subirServidor() {
  if (process.env.URL) return { url: process.env.URL.replace(/\/$/, ""), fechar: async () => {} }
  const vite = await import("vite")
  if (args.has("--dev")) {
    const s = await vite.createServer({ root: RAIZ, server: { port: 5199, strictPort: true }, logLevel: "error" })
    await s.listen()
    return { url: "http://localhost:5199", fechar: () => s.close() }
  }
  if (!existsSync(join(RAIZ, "dist", "index.html"))) throw new Error("rode 'npm run build' antes (ou use --dev)")
  const s = await vite.preview({ root: RAIZ, preview: { port: 4199, strictPort: true }, logLevel: "error" })
  return { url: "http://localhost:4199", fechar: () => new Promise((r) => s.httpServer.close(r)) }
}

const so = process.env.SO ? new Set(process.env.SO.split(",")) : null
const IDIOMA = process.env.IDIOMA === "en" ? "en" : null
const PREFIXO = IDIOMA ? `${IDIOMA}-` : ""
// Sinais de português num painel que devia estar em inglês (os nomes de idioma do seletor ficam de fora).
const PORTUGUES =
  /[ãõçâêôáéíóú]|\b(conta|contas|computador|computadores|semana|horas|troca|agora|há|desde|renova|sessão|nuvem|exemplo|não|para|com|uma|um|em uso|livre|esgotada|leitura)\b/i
function textoEmPortugues(texto) {
  return (
    texto
      .replace(/Português( \(Brasil\))?/g, "")
      .split("\n")
      // e-mails, endereços e os campos da API (o contrato da API não muda com o idioma da tela) não contam
      .map((l) => l.replace(/\S+@\S+|https?:\/\/\S+|"[a-z_]+"\s*:/g, "").trim())
      .filter((l) => l && PORTUGUES.test(l))
      .slice(0, 8)
  )
}
const servidor = await subirServidor()
const navegador = await chromium.launch({
  executablePath: executavel(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
await mkdir(SAIDA, { recursive: true })

const problemas = []
let fotos = 0
try {
  for (const alvo of ALVOS) {
    for (const tema of TEMAS) {
      const contexto = await navegador.newContext({
        viewport: alvo.viewport,
        deviceScaleFactor: alvo.escala,
        isMobile: alvo.mobile,
        hasTouch: alvo.mobile,
        colorScheme: tema === "escuro" ? "dark" : "light",
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        serviceWorkers: "block",
      })
      if (IDIOMA) await contexto.addInitScript((i) => localStorage.setItem("reveza.idioma", i), IDIOMA)
      const pagina = await contexto.newPage()
      let erros = []
      pagina.on("console", (m) => m.type() === "error" && erros.push(m.text()))
      pagina.on("pageerror", (e) => erros.push(String(e)))
      for (const [nome, caminho] of PAGINAS) {
        if (so && !so.has(nome)) continue
        erros = []
        const sep = caminho.includes("?") ? "&" : "?"
        await pagina.goto(`${servidor.url}${caminho}${sep}demo=1`, { waitUntil: "networkidle" })
        await pagina.evaluate(() => document.fonts.ready)
        await pagina.waitForTimeout(2200)
        const largura = await pagina.evaluate(() => ({
          rolagem: document.documentElement.scrollWidth,
          tela: window.innerWidth,
          vazando: [...document.querySelectorAll("body *")]
            .filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed"
            })
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
        }))
        const base = `${PREFIXO}${alvo.nome}-${tema}-${nome}`
        if (IDIOMA) {
          const sobra = textoEmPortugues(await pagina.evaluate(() => document.body.innerText))
          if (sobra.length) problemas.push({ captura: base, problema: "texto em português", detalhe: sobra })
        }
        await pagina.screenshot({ path: join(SAIDA, `${base}.png`), fullPage: true })
        fotos++
        if (largura.rolagem > largura.tela + 1)
          problemas.push({ captura: base, problema: "rolagem horizontal", detalhe: largura })
        if (erros.length) problemas.push({ captura: base, problema: "erro no console", detalhe: erros.slice(0, 5) })
      }
      // Interações: caixas de diálogo, rascunho, menu recolhido e o painel em inglês.
      for (const [nome, caminho, fazer] of INTERACOES) {
        if (so && !so.has(nome) && !so.has("interacoes")) continue
        if (IDIOMA && nome.startsWith("i-ingles")) continue
        erros = []
        await pagina.goto(`${servidor.url}${caminho}${caminho.includes("?") ? "&" : "?"}demo=1`, {
          waitUntil: "networkidle",
        })
        await pagina.waitForTimeout(700)
        try {
          await fazer(pagina, alvo)
          await pagina.waitForTimeout(900)
          if (IDIOMA) {
            const sobra = textoEmPortugues(await pagina.evaluate(() => document.body.innerText))
            if (sobra.length)
              problemas.push({
                captura: `${PREFIXO}${alvo.nome}-${tema}-${nome}`,
                problema: "texto em português",
                detalhe: sobra,
              })
          }
          await pagina.screenshot({ path: join(SAIDA, `${PREFIXO}${alvo.nome}-${tema}-${nome}.png`) })
          fotos++
        } catch (e) {
          problemas.push({
            captura: `${alvo.nome}-${tema}-${nome}`,
            problema: "interação falhou",
            detalhe: String(e).slice(0, 200),
          })
        }
        if (erros.length)
          problemas.push({
            captura: `${alvo.nome}-${tema}-${nome}`,
            problema: "erro no console",
            detalhe: erros.slice(0, 5),
          })
        if (!IDIOMA) await pagina.evaluate(() => localStorage.removeItem("reveza.idioma"))
      }
      if (alvo.mobile && (!so || so.has("menu"))) {
        await pagina.goto(`${servidor.url}/?demo=1`, { waitUntil: "networkidle" })
        await pagina.waitForTimeout(800)
        await pagina.locator('[data-sidebar="trigger"]').first().click()
        await pagina.waitForTimeout(600)
        await pagina.screenshot({ path: join(SAIDA, `${PREFIXO}${alvo.nome}-${tema}-menu.png`) })
        fotos++
      }
      await contexto.close()
    }
  }
} finally {
  await navegador.close()
  await servidor.fechar()
}

await writeFile(join(SAIDA, `${PREFIXO}relatorio.json`), JSON.stringify({ fotos, problemas }, null, 2))
console.log(`${fotos} capturas em ${SAIDA}`)
if (problemas.length) {
  for (const p of problemas) console.log(`PROBLEMA  ${p.captura}: ${p.problema} ${JSON.stringify(p.detalhe)}`)
  process.exit(1)
}
console.log("sem rolagem horizontal e sem erro no console")
