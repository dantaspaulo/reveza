// Cartão de conquista para os stories (1080 x 1920): um número do período com troféu, para a pessoa compartilhar
// (pedido do Paulo, 03/11/2026: "um card para postar nos stories do instagram bem bonito dizendo que foi usando X de
// tokens, com troféu... Ele escolher a métrica para exportar o jpg... marca d'água pequena da reveza.ia.br").
// Desenhado no canvas, sem biblioteca: só números agregados, nada de conta, e-mail ou projeto.

export const LARGURA = 1080
export const ALTURA = 1920
export const MARCA = "reveza.ia.br"

export interface TextosCartao {
  cabecalho: string
  periodo: string
  valor: string
  rotulo: string
  marco: string | null
}

/** O maior marco redondo (1, 2 ou 5 vezes uma potência de 10) que o valor já passou; null abaixo de 10. */
export function marco(valor: number): number | null {
  if (!Number.isFinite(valor) || valor < 10) return null
  const potencia = 10 ** Math.floor(Math.log10(valor))
  for (const m of [5, 2, 1]) if (valor >= m * potencia) return m * potencia
  return potencia
}

/** Sorteio previsível (a prévia e a imagem baixada têm os mesmos confetes). */
function sorteio(semente: number) {
  let s = semente >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OURO_CLARO = "#FFE58A"
const OURO = "#F5B301"
const OURO_ESCURO = "#B86E00"

function ouro(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  g.addColorStop(0, OURO_CLARO)
  g.addColorStop(0.55, OURO)
  g.addColorStop(1, OURO_ESCURO)
  return g
}

/** O troféu num quadrado de 100 x 100 (cálice, alças, haste, base e estrela), escalado para `tamanho`. */
function trofeu(ctx: CanvasRenderingContext2D, cx: number, cy: number, tamanho: number) {
  const e = tamanho / 100
  ctx.save()
  ctx.translate(cx - 50 * e, cy - 50 * e)
  ctx.scale(e, e)
  ctx.lineJoin = "round"
  ctx.lineCap = "round"

  // alças
  ctx.strokeStyle = OURO
  ctx.lineWidth = 6
  ctx.stroke(new Path2D("M24 18 H13 C8 18 5 21 5 26 C5 37 14 44 26 45"))
  ctx.stroke(new Path2D("M76 18 H87 C92 18 95 21 95 26 C95 37 86 44 74 45"))

  const preenchido = (d: string) => {
    const p = new Path2D(d)
    ctx.fillStyle = ouro(ctx, 0, 100)
    ctx.fill(p)
    ctx.strokeStyle = "rgba(120,64,0,0.55)"
    ctx.lineWidth = 1.2
    ctx.stroke(p)
  }
  preenchido("M22 8 H78 V26 C78 46 66 58 50 60 C34 58 22 46 22 26 Z") // cálice
  preenchido("M45 59 H55 L57 72 H43 Z") // haste
  preenchido("M33 71 H67 Q70 71 70 74 V78 H30 V74 Q30 71 33 71 Z") // base de cima
  preenchido("M24 78 H76 Q79 78 79 81 V90 Q79 93 76 93 H24 Q21 93 21 90 V81 Q21 78 24 78 Z") // pedestal

  // brilho do cálice
  ctx.fillStyle = "rgba(255,255,255,0.32)"
  ctx.fill(new Path2D("M28 12 H36 V27 C36 39 41 48 47 53 C36 51 28 41 28 27 Z"))

  // estrela
  const estrela = new Path2D()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 10 : 4.2
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = 50 + r * Math.cos(a)
    const y = 30 + r * Math.sin(a)
    if (i === 0) estrela.moveTo(x, y)
    else estrela.lineTo(x, y)
  }
  estrela.closePath()
  ctx.fillStyle = "#FFF6D6"
  ctx.fill(estrela)

  // plaquinha
  ctx.fillStyle = "rgba(90,48,0,0.35)"
  ctx.fillRect(38, 83, 24, 5)
  ctx.restore()
}

/** Diminui a fonte até o texto caber na largura. */
function caber(ctx: CanvasRenderingContext2D, texto: string, peso: number, tamanho: number, largura: number, familia: string) {
  let t = tamanho
  ctx.font = `${peso} ${t}px ${familia}`
  while (t > 24 && ctx.measureText(texto).width > largura) {
    t -= 4
    ctx.font = `${peso} ${t}px ${familia}`
  }
  return t
}

function espacar(ctx: CanvasRenderingContext2D, px: number) {
  // letterSpacing é recente (Chrome 99, Safari 17): sem ele, o texto sai sem o espaçamento
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`
}

/** Desenha o cartão inteiro. `familia` é a fonte do painel (já carregada pelo document.fonts). */
export function desenharCartao(ctx: CanvasRenderingContext2D, t: TextosCartao, familia: string, semente = 7) {
  const W = LARGURA
  const H = ALTURA
  const cx = W / 2
  // o Instagram cobre ~250 px em cima (perfil) e embaixo (resposta): o que importa fica entre 300 e 1700
  const cyTrofeu = 840
  ctx.save()
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"

  // fundo
  const fundo = ctx.createLinearGradient(0, 0, 0, H)
  fundo.addColorStop(0, "#050A16")
  fundo.addColorStop(0.55, "#0B1A3C")
  fundo.addColorStop(1, "#04070F")
  ctx.fillStyle = fundo
  ctx.fillRect(0, 0, W, H)

  // raios saindo do troféu
  ctx.save()
  ctx.translate(cx, cyTrofeu)
  for (let i = 0; i < 18; i++) {
    ctx.rotate((Math.PI * 2) / 18)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-70, -1100)
    ctx.lineTo(70, -1100)
    ctx.closePath()
    ctx.fillStyle = i % 2 ? "rgba(255,214,102,0.045)" : "rgba(57,135,229,0.05)"
    ctx.fill()
  }
  ctx.restore()

  // brilho atrás do troféu
  const brilho = ctx.createRadialGradient(cx, cyTrofeu, 0, cx, cyTrofeu, 520)
  brilho.addColorStop(0, "rgba(255,200,64,0.55)")
  brilho.addColorStop(0.45, "rgba(255,170,30,0.16)")
  brilho.addColorStop(1, "rgba(255,170,30,0)")
  ctx.fillStyle = brilho
  ctx.fillRect(0, 280, W, 1200)

  // confetes
  const r = sorteio(semente)
  const cores = [OURO_CLARO, OURO, "#3987E5", "#7CC4FF", "#FFFFFF", "#F28CB1"]
  for (let i = 0; i < 70; i++) {
    const x = r() * W
    const y = 120 + r() * 1500
    // longe do número e do rótulo, para não atrapalhar a leitura
    if (y > 1180 && y < 1660 && x > 120 && x < 960) continue
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(r() * Math.PI)
    ctx.globalAlpha = 0.35 + r() * 0.5
    ctx.fillStyle = cores[Math.floor(r() * cores.length)]!
    const largura = 8 + r() * 14
    ctx.fillRect(-largura / 2, -4, largura, 8 + r() * 6)
    ctx.restore()
  }
  ctx.globalAlpha = 1

  // cabeçalho
  ctx.fillStyle = "rgba(255,255,255,0.92)"
  espacar(ctx, 10)
  ctx.font = `700 46px ${familia}`
  ctx.fillText(t.cabecalho.toUpperCase(), cx, 330)
  espacar(ctx, 2)
  ctx.fillStyle = "rgba(255,255,255,0.6)"
  ctx.font = `500 38px ${familia}`
  ctx.fillText(t.periodo, cx, 400)
  espacar(ctx, 0)

  trofeu(ctx, cx, cyTrofeu, 600)

  // o número
  const tam = caber(ctx, t.valor, 800, 210, W - 140, familia)
  ctx.font = `800 ${tam}px ${familia}`
  ctx.shadowColor = "rgba(255,190,40,0.45)"
  ctx.shadowBlur = 40
  ctx.fillStyle = ouro(ctx, 1400 - tam, 1400)
  ctx.fillText(t.valor, cx, 1400)
  ctx.shadowBlur = 0

  // o que é o número
  ctx.fillStyle = "rgba(255,255,255,0.88)"
  caber(ctx, t.rotulo, 500, 58, W - 160, familia)
  ctx.fillText(t.rotulo, cx, 1495)

  // o marco
  if (t.marco) {
    const texto = t.marco.toUpperCase()
    espacar(ctx, 6)
    ctx.font = `700 38px ${familia}`
    const w = ctx.measureText(texto).width + 96
    const x = cx - w / 2
    const y = 1570
    ctx.beginPath()
    ctx.roundRect(x, y, w, 84, 42)
    ctx.fillStyle = "rgba(245,179,1,0.12)"
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = "rgba(255,214,102,0.8)"
    ctx.stroke()
    ctx.fillStyle = OURO_CLARO
    ctx.fillText(texto, cx, y + 56)
    espacar(ctx, 0)
  }

  // marca d'água
  espacar(ctx, 4)
  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.font = `600 34px ${familia}`
  ctx.fillText(MARCA, cx, H - 160)
  espacar(ctx, 0)
  ctx.restore()
}
