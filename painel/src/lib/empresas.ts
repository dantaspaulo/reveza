// Empresas (0.17.0): de quem é cada uso. A pasta de cada linha (a raiz do git, relativa à pessoal) passa pelas regras
// que a pessoa criou no painel, e a regra mais específica ganha:
//   - "pasta" com ~/ ou / no começo: a pasta e tudo dentro dela (a mais comprida ganha);
//   - "pasta" sem barra no começo: qualquer pasta com esse nome no caminho (a mais funda ganha);
//   - "titulo": a pasta de um agente do OpenBot cujo título ou nome tem esse texto. Ganha de uma pasta mais larga que
//     a do agente, e perde para uma regra da própria pasta dele.
// Linha de antes da 0.17.0 (sem pasta): só a regra de nome, comparada com o nome curto do projeto.
// Tudo aqui roda no navegador, na hora de ler: mudar uma regra muda também o passado.

import type {
  AgenteOpenBot,
  Conta,
  DadosEmpresas,
  Empresa,
  LinhaUso,
  MarcaConta,
  ModoUnidade,
  RegraPasta,
  SessaoUso,
  TrocaUso,
} from "@/dados/tipos"
import { provedorPublico } from "./cores"
import { chaveDia } from "./formato"
import { tokensDa, type Metrica } from "./uso"

/** O grupo do uso que nenhuma regra pegou. */
export const SEM_DONO = "sem_dono"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Caminho para comparar: barras normais, sem barra no fim, minúsculo (pasta do macOS e do Windows não liga para caixa). */
export function normalizarPasta(p: string): string {
  const s = p.trim().replace(/\\/g, "/").replace(/\/+/g, "/")
  const sem = s.length > 1 ? s.replace(/\/+$/, "") : s
  return sem.toLowerCase()
}

/** A regra de pasta começa com ~, / ou a letra de um disco do Windows (D:/): é um caminho (prefixo). Sem isso, é um nome. */
export function ehCaminho(padrao: string): boolean {
  return /^([~/]|[A-Za-z]:(\/|\\|$))/.test(padrao.trim())
}

/**
 * A pasta pessoal ou a raiz do disco inteira: uma regra assim pegaria o uso de todas as empresas. A nuvem recusa
 * (painel_pasta_empresa), e o painel não oferece o clique rápido para ela.
 */
export function pastaAmpla(padrao: string): boolean {
  return /^(~|\/+|[A-Za-z]:)$/.test(padrao.trim().replace(/\\/g, "/").replace(/(.)\/+$/, "$1"))
}

/** O evento de troca como o painel conta (ver TrocaUso). */
export function trocaDoEvento(em: string, texto: string, dados: Record<string, unknown>): TrocaUso {
  const s = (v: unknown) => (typeof v === "string" ? v : null)
  const paraNuvem = s(dados.para_nuvem)
  const para = s(dados.para)
  const computadorId = s(dados.computador)
  if (paraNuvem && UUID.test(paraNuvem)) return { em, computadorId, para: paraNuvem, decisao: false, texto }
  // a decisão da nuvem já traz o id de lá; a troca feita vem depois, no evento do computador
  if (para && UUID.test(para)) return { em, computadorId, para, decisao: true, texto }
  return { em, computadorId, para: null, decisao: false, texto }
}

/** `computador` (0.20.0): a regra de um computador só vale nele; sem ele, só as regras que valem para todos. */
export type Classificar = (pasta: string, projeto: string, computador?: string) => string | null

/** 0.20.1: onde o projeto roda, como rvz_roda_em: o subprojeto segue o projeto; sem a escolha (ou nuvem antiga), em todos. */
export function criarRodaEm(dados: {
  empresas: Pick<Empresa, "id" | "pai" | "emTodosComputadores">[]
  computadores?: DadosEmpresas["computadores"]
}): (empresa: string, computador: string) => boolean {
  const restritos = new Map<string, Set<string>>()
  for (const e of dados.empresas) if (!e.pai && e.emTodosComputadores === false) restritos.set(e.id, new Set())
  for (const l of dados.computadores ?? []) restritos.get(l.empresaId)?.add(l.computadorId)
  const paiDe = new Map(dados.empresas.map((e) => [e.id, e.pai]))
  return (empresa, computador) => {
    const s = restritos.get(paiDe.get(empresa) ?? empresa)
    return !s || s.has(computador)
  }
}

/**
 * O classificador das regras de agora: devolve o id da empresa da pasta, ou null (sem dono). 0.21.1: da empresa só
 * usa o id, o pai e onde roda, para servir também ao rascunho da tela de Projetos (lib/agentes).
 */
export function criarClassificador(
  dados: Pick<DadosEmpresas, "regras" | "agentes"> & {
    empresas: Pick<Empresa, "id" | "pai" | "emTodosComputadores">[]
    computadores?: DadosEmpresas["computadores"]
  }
): Classificar {
  const existe = new Set(dados.empresas.map((e) => e.id))
  // 0.20.1: o projeto escolhido para alguns computadores não classifica pasta nos outros (como rvz_classificar);
  // a linha sem computador conhecido não perde o dono
  const roda = criarRodaEm(dados)
  const rodaAqui = (empresa: string, pc?: string) => pc === undefined || roda(empresa, pc)
  // a regra de um computador vem antes da que vale para todos: no empate, ela ganha (como rvz_classificar)
  const regras = dados.regras
    .filter((r) => existe.has(r.empresaId))
    .sort((a, b) => Number(!a.computadorId) - Number(!b.computadorId))
  const prefixos = regras
    .filter((r) => r.tipo === "pasta" && ehCaminho(r.padrao))
    .map((r) => ({ base: normalizarPasta(r.padrao), empresa: r.empresaId, pc: r.computadorId ?? null }))
  const nomes = regras
    .filter((r) => r.tipo === "pasta" && !ehCaminho(r.padrao))
    .map((r) => ({ nome: normalizarPasta(r.padrao).replace(/^\/+|\/+$/g, ""), empresa: r.empresaId, pc: r.computadorId ?? null }))
    .filter((r) => r.nome)
  const titulos = regras
    .filter((r) => r.tipo === "titulo")
    .map((r) => ({ texto: r.padrao.trim().toLowerCase(), empresa: r.empresaId, pc: r.computadorId ?? null }))
    .filter((r) => r.texto)
    // o texto mais comprido é o mais específico
    .sort((a, b) => b.texto.length - a.texto.length)
  const agentes = new Map<string, Map<string, { nome: string; titulo: string }>>()
  const agentesSemComputador = new Map<string, { nome: string; titulo: string }>()
  for (const a of dados.agentes) {
    const p = normalizarPasta(a.pasta)
    if (!p) continue
    const info = { nome: a.nome.toLowerCase(), titulo: a.titulo.toLowerCase() }
    const doComputador = agentes.get(a.computadorId) ?? new Map()
    if (!doComputador.has(p)) doComputador.set(p, info)
    agentes.set(a.computadorId, doComputador)
    if (!agentesSemComputador.has(p)) agentesSemComputador.set(p, info)
  }
  const dentro = (p: string, base: string) => p === base || (base === "/" ? p.startsWith("/") : p.startsWith(base + "/"))

  const cache = new Map<string, string | null>()
  return (pasta, projeto, computador) => {
    const chave = `${pasta}\u0000${projeto}\u0000${computador ?? ""}`
    const vale = (r: { pc: string | null; empresa: string }) =>
      (r.pc === null || r.pc === computador) && rodaAqui(r.empresa, computador)
    const ja = cache.get(chave)
    if (ja !== undefined) return ja
    let melhor: { nota: number; empresa: string } | null = null
    const propor = (nota: number, empresa: string) => {
      if (!melhor || nota > melhor.nota) melhor = { nota, empresa }
    }
    const p = normalizarPasta(pasta)
    if (p) {
      for (const r of prefixos) if (vale(r) && dentro(p, r.base)) propor(r.base.length, r.empresa)
      const partes = p.split("/")
      for (const r of nomes) {
        if (!vale(r)) continue
        for (let i = partes.length - 1; i >= 0; i--) {
          if (partes[i] !== r.nome) continue
          propor(partes.slice(0, i + 1).join("/").length - 0.25, r.empresa)
          break
        }
      }
      if (titulos.length) {
        const agentesAqui = computador === undefined ? agentesSemComputador : agentes.get(computador)
        let pastaAgente: string | null = null
        for (const a of agentesAqui?.keys() ?? []) if (dentro(p, a) && (!pastaAgente || a.length > pastaAgente.length)) pastaAgente = a
        if (pastaAgente && agentesAqui) {
          const ag = agentesAqui.get(pastaAgente)!
          const r = titulos.find((x) => vale(x) && (ag.titulo.includes(x.texto) || ag.nome.includes(x.texto)))
          if (r) propor(pastaAgente.length - 0.5, r.empresa)
        }
      }
    } else {
      const nome = projeto.trim().toLowerCase()
      const r = nome ? nomes.find((x) => vale(x) && x.nome === nome) : undefined
      if (r) propor(0, r.empresa)
    }
    const r = (melhor as { empresa: string } | null)?.empresa ?? null
    if (cache.size > 20_000) cache.clear()
    cache.set(chave, r)
    return r
  }
}

/** 0.19.0: "Empresa / Projeto" (ou só o nome, numa empresa), como rvz_nome_unidade na nuvem. */
export function nomeUnidade(e: Pick<Empresa, "nome" | "pai">, empresas: Pick<Empresa, "id" | "nome">[]): string {
  if (!e.pai) return e.nome
  const pai = empresas.find((x) => x.id === e.pai)
  return `${pai?.nome ?? "?"} / ${e.nome}`
}

/** 0.19.0: as empresas em ordem de nome, cada uma seguida dos projetos dela (também em ordem de nome). */
export function ordenarUnidades<E extends Pick<Empresa, "id" | "nome" | "pai">>(empresas: E[]): E[] {
  const porNome = (a: E, b: E) => a.nome.localeCompare(b.nome)
  const ids = new Set(empresas.map((e) => e.id))
  // projeto cuja empresa não veio na lista fica entre as empresas, para não sumir
  const raiz = empresas.filter((e) => !e.pai || !ids.has(e.pai)).sort(porNome)
  const r: E[] = []
  for (const e of raiz) r.push(e, ...empresas.filter((p) => p.pai === e.id).sort(porNome))
  return r
}

/** 0.19.0: o modo que vale numa empresa ou projeto (o do projeto ou, sem ele, o da empresa), como rvz_modo_de. */
export function modoDe(e: Pick<Empresa, "pai" | "modo" | "separar">, empresas: Empresa[]): ModoUnidade {
  const daEmpresa = (x: Pick<Empresa, "modo" | "separar">): ModoUnidade =>
    x.separar ? "ligado" : x.modo === "sombra" ? "sombra" : "desligado"
  if (!e.pai) return daEmpresa(e)
  if (e.modo) return e.modo
  const pai = empresas.find((x) => x.id === e.pai)
  return pai ? daEmpresa(pai) : "desligado"
}

/**
 * 0.19.0: o resumo da chave "revezamento global ou por empresa e projeto". Global = nenhuma empresa ou projeto ligado
 * nem em teste: todas as contas giram juntas, como sempre.
 */
export function resumoRevezamento(empresas: Empresa[]): { ligadas: number; emTeste: number; global: boolean } {
  let ligadas = 0
  let emTeste = 0
  for (const e of empresas) {
    // projeto sem modo próprio segue a empresa: conta uma vez só, na empresa
    if (e.pai && !e.modo) continue
    const m = modoDe(e, empresas)
    if (m === "ligado") ligadas++
    else if (m === "sombra") emTeste++
  }
  return { ligadas, emTeste, global: ligadas === 0 && emTeste === 0 }
}

/** 0.19.0: o classificador com os projetos somados na empresa deles (os números "por empresa"). */
export function subirAEmpresa(classificar: Classificar, empresas: Pick<Empresa, "id" | "pai">[]): Classificar {
  const pai = new Map(empresas.filter((e) => e.pai).map((e) => [e.id, e.pai as string]))
  return (pasta, projeto, computador) => {
    const id = classificar(pasta, projeto, computador)
    return id ? (pai.get(id) ?? id) : null
  }
}

/** "0.19.0" vira 19000 (como rvz_versao_agente na nuvem); o que não casa vira 0. */
export function versaoNum(v: string | null | undefined): number {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(v ?? "")
  if (!m) return 0
  return Math.min(+m[1]!, 999) * 1_000_000 + Math.min(+m[2]!, 999) * 1000 + Math.min(+m[3]!, 999)
}

/**
 * 0.19.0: as empresas e projetos ligados que um agente anterior à 0.19.0 erraria e que, por isso, a nuvem não manda a
 * ele (lá a separação fica desligada até atualizar). A mesma conta do portão de agente_empresas (0041): unidade (a
 * empresa, ou o projeto com contas ou modo ligado/desligado próprio; em teste segue a empresa), modo de verdade (o teste
 * não muda as sessões) e o projeto que tira sessões de uma empresa ligada, quando é da mesma empresa ou tem regra que
 * pode pegar uma pasta dela com mais precisão (nome de pasta e título contam sempre).
 */
export function empresasForaNoAntigo(dados: Pick<DadosEmpresas, "empresas" | "regras" | "marcas">): Empresa[] {
  const { empresas } = dados
  const porId = new Map(empresas.map((e) => [e.id, e]))
  const comConta = new Set(dados.marcas.map((m) => m.empresaId))
  const proprioModo = (e: Empresa) => e.modo === "desligado" || e.modo === "ligado"
  const unidadeDe = (e: Empresa) => (!e.pai || proprioModo(e) || comConta.has(e.id) ? e.id : e.pai)
  const ligada = (e: Empresa): boolean => {
    if (!e.pai) return e.separar
    if (proprioModo(e)) return e.modo === "ligado"
    return porId.get(e.pai)?.separar ?? false
  }
  const unidades = empresas.filter((e) => unidadeDe(e) === e.id)
  const tira = (x: Empresa) =>
    !!x.pai && !ligada(x) && unidades.some((y) => (y.id === x.pai || y.pai === x.pai) && ligada(y))
  const regrasDe = (u: Empresa) =>
    dados.regras.filter((r) => {
      const e = porId.get(r.empresaId)
      return !!e && unidadeDe(e) === u.id
    })
  const cruzam = (rx: RegraPasta, ru: RegraPasta) => {
    const caminho = (r: RegraPasta) => r.tipo === "pasta" && ehCaminho(r.padrao)
    if (!caminho(rx) || !caminho(ru)) return true
    const x = normalizarPasta(rx.padrao)
    const u = normalizarPasta(ru.padrao)
    return x === u || u === "/" || x.startsWith(`${u}/`)
  }
  const tiram = unidades.filter((x) => tira(x) && regrasDe(x).length > 0)
  return unidades.filter(
    (u) =>
      ligada(u) &&
      tiram.some(
        (x) =>
          (x.pai ?? x.id) === (u.pai ?? u.id) || regrasDe(x).some((rx) => regrasDe(u).some((ru) => cruzam(rx, ru)))
      )
  )
}

/** O agente do OpenBot da pasta (a pasta dele ou uma de dentro), ou null. */
export function agenteDaPasta(pasta: string, agentes: AgenteOpenBot[]): AgenteOpenBot | null {
  const p = normalizarPasta(pasta)
  if (!p) return null
  let r: AgenteOpenBot | null = null
  for (const a of agentes) {
    const b = normalizarPasta(a.pasta)
    if ((p === b || p.startsWith(b + "/")) && (!r || b.length > normalizarPasta(r.pasta).length)) r = a
  }
  return r
}

export interface NumerosEmpresa {
  id: string
  usd: number
  tokens: number
  entrada: number
  saida: number
  cacheEscrita: number
  cacheLeitura: number
  respostas: number
  agentes: number
  sessoes: number
  /** Por conta (null: uso sem conta conhecida). */
  contas: Map<string | null, { usd: number; tokens: number }>
  /** Por pasta (sem pasta: "projeto:<nome curto>"). */
  pastas: Map<string, { pasta: string; projeto: string; usd: number; tokens: number }>
}

const chavePasta = (pasta: string, projeto: string) => (pasta ? pasta : `projeto:${projeto}`)

function vazio(id: string): NumerosEmpresa {
  return {
    id,
    usd: 0,
    tokens: 0,
    entrada: 0,
    saida: 0,
    cacheEscrita: 0,
    cacheLeitura: 0,
    respostas: 0,
    agentes: 0,
    sessoes: 0,
    contas: new Map(),
    pastas: new Map(),
  }
}

/** Os números de cada empresa (e do sem dono) no período, das linhas de uso e das sessões. */
export function numerosPorEmpresa(uso: LinhaUso[], sessoes: SessaoUso[], classificar: Classificar): Map<string, NumerosEmpresa> {
  const r = new Map<string, NumerosEmpresa>()
  const de = (id: string) => {
    let n = r.get(id)
    if (!n) r.set(id, (n = vazio(id)))
    return n
  }
  for (const l of uso) {
    const n = de(classificar(l.pasta, l.projeto, l.computadorId) ?? SEM_DONO)
    const tk = tokensDa(l)
    n.usd += l.usd
    n.tokens += tk
    n.entrada += l.entrada
    n.saida += l.saida
    n.cacheEscrita += l.cacheEscrita
    n.cacheLeitura += l.cacheLeitura
    n.respostas += l.respostas
    n.agentes += l.agentes
    const c = n.contas.get(l.contaId) ?? { usd: 0, tokens: 0 }
    c.usd += l.usd
    c.tokens += tk
    n.contas.set(l.contaId, c)
    const k = chavePasta(l.pasta, l.projeto)
    const p = n.pastas.get(k) ?? { pasta: l.pasta, projeto: l.projeto, usd: 0, tokens: 0 }
    p.usd += l.usd
    p.tokens += tk
    n.pastas.set(k, p)
  }
  for (const s of sessoes) de(classificar(s.pasta, s.projeto, s.computadorId) ?? SEM_DONO).sessoes += 1
  return r
}

/** Segunda-feira da semana do dia ("AAAA-MM-DD", no fuso de quem vê). */
export function semanaDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00`)
  const desde = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - desde)
  return chaveDia(d)
}

/** Uma linha por dia (ou por semana), uma coluna por empresa: [{ dia, <empresa>: valor }]. */
export function porPeriodoEmpresa(
  uso: LinhaUso[],
  classificar: Classificar,
  dias: string[],
  agrupar: "dia" | "semana",
  metrica: Metrica
): { dados: Record<string, number | string>[]; grupos: string[] } {
  const chaves = agrupar === "dia" ? dias : [...new Set(dias.map(semanaDe))]
  const porChave = new Map<string, Record<string, number | string>>()
  for (const k of chaves) porChave.set(k, { dia: k })
  const grupos = new Set<string>()
  for (const l of uso) {
    const dia = chaveDia(l.hora)
    const linha = porChave.get(agrupar === "dia" ? dia : semanaDe(dia))
    if (!linha) continue
    const g = classificar(l.pasta, l.projeto, l.computadorId) ?? SEM_DONO
    grupos.add(g)
    const v = metrica === "usd" ? l.usd : metrica === "respostas" ? l.respostas : tokensDa(l)
    linha[g] = ((linha[g] as number) ?? 0) + v
  }
  const lista = [...grupos]
  const dados = [...porChave.values()].map((linha) => {
    for (const g of lista) if (linha[g] === undefined) linha[g] = 0
    return linha
  })
  return { dados, grupos: lista }
}

/** A conta para onde a troca foi, pelo texto do evento (agente de antes da 0.17.0): o último e-mail de conta citado. */
export function contaPeloTexto(texto: string, contas: Pick<Conta, "id" | "email">[]): string | null {
  const t = texto.toLowerCase()
  let r: { id: string; pos: number; tam: number } | null = null
  for (const c of contas) {
    const e = c.email.trim().toLowerCase()
    if (e.length < 3) continue
    // o último lugar em que o e-mail aparece inteiro (ana@x não vale dentro de joana@x)
    let pos = t.lastIndexOf(e)
    while (pos > 0 && /[a-z0-9._%+-]/.test(t[pos - 1]!)) pos = t.lastIndexOf(e, pos - 1)
    // na mesma posição, o e-mail mais comprido (a@x.com.br, não a@x.com)
    if (pos >= 0 && (!r || pos > r.pos || (pos === r.pos && e.length > r.tam))) r = { id: c.id, pos, tam: e.length }
  }
  return r?.id ?? null
}

export interface ContagemTrocas {
  /** Trocas para contas marcadas para a empresa (uma conta de várias empresas conta para cada uma). */
  porEmpresa: Map<string, number>
  /** Trocas para contas sem marca (servem a todas). */
  semMarca: number
  /** Trocas sem conta reconhecida (a conta saiu, ou o evento não diz). */
  semConta: number
  total: number
}

/** Quantas trocas o período teve para as contas de cada empresa. */
export function trocasPorEmpresa(trocas: TrocaUso[], contas: Pick<Conta, "id" | "email">[], marcas: MarcaConta[]): ContagemTrocas {
  const empresasDa = new Map<string, string[]>()
  for (const m of marcas) empresasDa.set(m.contaId, [...(empresasDa.get(m.contaId) ?? []), m.empresaId])
  const conhecidas = new Set(contas.map((c) => c.id))
  const r: ContagemTrocas = { porEmpresa: new Map(), semMarca: 0, semConta: 0, total: 0 }
  for (const t of trocas) {
    if (t.decisao) continue
    r.total += 1
    const para = t.para && conhecidas.has(t.para) ? t.para : t.para ? null : contaPeloTexto(t.texto, contas)
    if (!para) {
      r.semConta += 1
      continue
    }
    const es = empresasDa.get(para)
    if (!es?.length) {
      r.semMarca += 1
      continue
    }
    for (const e of es) r.porEmpresa.set(e, (r.porEmpresa.get(e) ?? 0) + 1)
  }
  return r
}

export interface PastaSemDono {
  chave: string
  pasta: string
  projeto: string
  usd: number
  tokens: number
  computadores: string[]
  agente: AgenteOpenBot | null
}

/** As pastas que nenhuma regra pegou, da mais cara para a mais barata. */
export function pastasSemDono(uso: LinhaUso[], classificar: Classificar, agentes: AgenteOpenBot[]): PastaSemDono[] {
  const r = new Map<string, PastaSemDono & { pcs: Set<string> }>()
  for (const l of uso) {
    if (classificar(l.pasta, l.projeto, l.computadorId)) continue
    const k = chavePasta(l.pasta, l.projeto)
    let p = r.get(k)
    if (!p) {
      p = { chave: k, pasta: l.pasta, projeto: l.projeto, usd: 0, tokens: 0, computadores: [], agente: null, pcs: new Set() }
      r.set(k, p)
    }
    p.usd += l.usd
    p.tokens += tokensDa(l)
    p.pcs.add(l.computadorId)
  }
  return [...r.values()]
    .map(({ pcs, ...p }) => ({ ...p, computadores: [...pcs].sort(), agente: p.pasta ? agenteDaPasta(p.pasta, agentes) : null }))
    .sort((a, b) => b.usd - a.usd || a.chave.localeCompare(b.chave))
}

/** O uso de cada conta por empresa: conta -> empresa (ou SEM_DONO) -> custo. */
export function contasPorEmpresa(uso: LinhaUso[], classificar: Classificar): Map<string, Map<string, number>> {
  const r = new Map<string, Map<string, number>>()
  for (const l of uso) {
    if (!l.contaId) continue
    const e = classificar(l.pasta, l.projeto, l.computadorId) ?? SEM_DONO
    const m = r.get(l.contaId) ?? new Map<string, number>()
    m.set(e, (m.get(e) ?? 0) + l.usd)
    r.set(l.contaId, m)
  }
  return r
}

export interface Sugestao {
  /** O domínio do e-mail das contas: vira o nome da empresa (dá para mudar depois). */
  dominio: string
  contas: string[]
}

/**
 * A sugestão de um clique: uma empresa por domínio de e-mail (menos os de provedor público, como gmail.com), com as
 * contas daquele domínio marcadas. Só as contas que ficam (as que estão saindo, não).
 */
export function sugestaoPorDominio(contas: Pick<Conta, "id" | "email" | "saiEm">[]): Sugestao[] {
  const r = new Map<string, string[]>()
  for (const c of contas) {
    if (c.saiEm) continue
    const e = c.email.trim().toLowerCase()
    const i = e.lastIndexOf("@")
    const dominio = i > 0 ? e.slice(i + 1) : ""
    if (!dominio || provedorPublico(dominio)) continue
    r.set(dominio, [...(r.get(dominio) ?? []), c.id])
  }
  return [...r.entries()]
    .map(([dominio, ids]) => ({ dominio, contas: ids }))
    .sort((a, b) => b.contas.length - a.contas.length || a.dominio.localeCompare(b.dominio))
}
