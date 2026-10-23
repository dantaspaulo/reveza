// Cada seção do painel montada com o que a nuvem entrega de verdade: as linhas no formato das tabelas, passando pelo
// mapeamento da FonteSupabase (dados/supabase.ts), para a pessoa administradora sem as duas etapas na sessão (aal1) e
// com um fator pendente, como na instalação de produção em 12/10/2026. Sem DOM: a renderização do servidor do React
// roda a fase de desenho de cada tela (onde a falta de um campo derruba a seção) e espera o que carrega sob demanda.

import * as React from "react"
import { prerenderToNodeStream } from "react-dom/static"
import { beforeAll, describe, expect, it, vi } from "vitest"

const linhas = vi.hoisted(() => {
  const agora = Date.now()
  const iso = (msAtras: number) => new Date(agora - msAtras).toISOString()
  const H = 3_600_000
  // a janela, o histórico e o resto do navegador que as telas leem ao desenhar
  const ouvinte = { addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    location: {
      pathname: "/alertas",
      search: "",
      hash: "",
      origin: "https://painel.exemplo",
      href: "https://painel.exemplo/alertas",
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true
    },
    matchMedia: () => ({ matches: false, media: "", ...ouvinte }),
    history: { pushState() {}, replaceState() {} },
    scrollTo() {},
  }
  const guardado = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
    removeItem: (k: string) => void guardado.delete(k),
  }

  const contas = [
    ["c1", "ana@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 10],
    ["c2", "bia@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 20],
    ["c3", "caio@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 30],
    ["c4", "duda@escritorio-a.exemplo", "Escritório A - Team Startup", "team", "5x", 0, 40],
    ["c5", "edu@escritorio-b.exemplo", "Escritório B Team", "team", null, 1, 50],
    ["c6", "fulano@gmail.com", null, "max", "20x", 2, 60],
  ].map(([id, email, organizacao, plano, nivel, cor, prioridade]) => ({
    id,
    email,
    organizacao,
    plano,
    nivel,
    cor,
    prioridade,
    reserva: false,
    pausada: false,
    agenda: [],
    teto_semana: null,
    precisa_login: false,
    criado_em: iso(9 * 24 * H),
  }))
  const uso_janelas = contas.slice(0, 5).flatMap((c, i) => [
    {
      conta_id: c.id,
      tipo: "five_hour",
      pct: 12 + i * 17,
      reset_em: iso(-2 * H),
      lido_em: iso(60_000),
      fonte: "sessao",
    },
    {
      conta_id: c.id,
      tipo: "seven_day",
      pct: 30 + i * 9,
      reset_em: iso(-80 * H),
      lido_em: iso(60_000),
      fonte: "sessao",
    },
  ])
  const computadores = [
    {
      id: "pc1",
      nome: "Mac mini",
      sistema: "macos",
      versao: "0.1.4",
      visto_em: iso(4_000),
      revogado: false,
      diagnostico: {
        em: Math.floor((agora - 600_000) / 1000),
        conferencias: [{ id: "agente", nome: "Agente", situacao: "ok", detalhe: "versão 0.1.4" }],
      },
      criado_em: iso(8 * 24 * H),
    },
    {
      id: "pc2",
      nome: "MacBook",
      sistema: "macos",
      versao: "0.1.3",
      visto_em: iso(9_000),
      revogado: false,
      diagnostico: null,
      criado_em: iso(7 * 24 * H),
    },
    // os códigos de acesso criados e revogados antes do primeiro contato
    ...["pc3", "pc4"].map((id) => ({
      id,
      nome: "Computador novo",
      sistema: "pendente",
      versao: "",
      visto_em: null,
      revogado: true,
      diagnostico: null,
      criado_em: iso(2 * 24 * H),
    })),
  ]
  const config = [
    ["aviso", 90],
    ["troca", 95],
    ["modo", "limiar"],
    ["auto", true],
    ["rodizio_minutos", 90],
    ["rodizio_ordem", "aleatoria"],
    ["espera_entre_trocas_s", 90],
    ["fuso", "America/Fortaleza"],
    ["intervalo_s", 10],
    ["retomar_terminal", true],
    ["cofre_impressao", "a1b2c3d4"],
    ["alertas_ate", 24],
  ].map(([chave, valor]) => ({ chave, valor }))
  const eventos = [
    {
      id: 41,
      em: iso(5 * 60_000),
      tipo: "troca",
      texto: "Mac mini: bia → ana (limiar)",
      dados: { de: "c2", para: "c1", computador: "pc1", motivo: "limiar" },
    },
    {
      id: 40,
      em: iso(20 * 60_000),
      tipo: "aviso",
      texto: "bia em 91%",
      dados: { conta: "c2", pct: 91, origem: "nuvem" },
    },
    { id: 39, em: iso(H), tipo: "conexao", texto: "MacBook voltou", dados: { computador: "pc2" } },
    { id: 38, em: iso(2 * H), tipo: "info", texto: "computador novo pendente", dados: {} },
  ]
  return {
    agora,
    tabelas: {
      contas,
      uso_janelas,
      posse: [{ conta_id: "c1", computador_id: "pc1", motivo: "uso", expira_em: iso(-60_000) }],
      computadores,
      atribuicao: [
        { computador_id: "pc1", conta_id: "c1", motivo: "limiar", decidido_em: iso(5 * 60_000) },
        { computador_id: "pc2", conta_id: "c3", motivo: "computador sem conta", decidido_em: iso(H) },
      ],
      config,
      eventos,
      membros: [{ user_id: "u-admin", papel: "admin", nome: null, idioma: "pt-BR", criado_em: iso(9 * 24 * H) }],
      comandos: [
        {
          id: 7,
          computador_id: "pc1",
          acao: "diagnostico",
          estado: "feito",
          criado_em: iso(10 * 60_000),
          resposta: { ok: true },
        },
      ],
      chaves_api: [],
      convites: [],
      alertas: [] as Record<string, unknown>[],
      webhooks_saida: [],
    } as Record<string, Record<string, unknown>[]>,
  }
})

vi.mock("@/dados/cliente", () => {
  // Consulta encadeável do supabase-js (select, order, eq, in, is, gt, limit, range, maybeSingle) que resolve com as
  // linhas da tabela; o filtro de membros por user_id devolve uma linha só.
  function consulta(tabela: string) {
    let unica = false
    const q = {
      select: () => q,
      order: () => q,
      eq: () => q,
      in: () => q,
      is: () => q,
      gt: () => q,
      gte: () => q,
      lt: () => q,
      limit: () => q,
      range: () => q,
      maybeSingle: () => {
        unica = true
        return q
      },
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => {
        const dados = linhas.tabelas[tabela] ?? []
        return Promise.resolve({ data: unica ? (dados[0] ?? null) : dados, error: null }).then(ok, falha)
      },
    }
    return q
  }
  const cliente = {
    from: consulta,
    rpc: async (nome: string) => ({
      data:
        nome === "painel_validade_logins"
          ? [{ conta_id: "c1", expira_em: new Date(linhas.agora + 3 * 864e5).toISOString() }]
          : [],
      error: null,
    }),
    auth: {
      getUser: async () => ({ data: { user: { id: "u-admin", email: "admin@exemplo.com" } }, error: null }),
      mfa: {
        // um fator começado e não confirmado: a sessão fica em aal1 e o supabase-js não lista o fator em "totp"
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
        listFactors: async () => ({
          data: {
            all: [{ id: "f1", status: "unverified", factor_type: "totp", created_at: "2026-10-11T23:00:00Z" }],
            totp: [],
            phone: [],
          },
          error: null,
        }),
      },
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  }
  return { supabase: () => cliente, urlSupabase: () => "https://projeto.exemplo.co" }
})

import { AuthDemo } from "@/auth/auth"
import { SessaoProvider } from "@/auth/sessao"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DadosFixos } from "@/dados/contexto"
import { FonteSupabase } from "@/dados/supabase"
import type { Instantaneo } from "@/dados/tipos"
import { I18nProvider } from "@/i18n"
import { pintarPorWorkspace } from "@/lib/cores"
import { SECOES, type IdSecao } from "./rotas"

const TELAS: Record<IdSecao, () => Promise<{ default: React.ComponentType }>> = {
  visao: () => import("./visao-geral"),
  contas: () => import("./contas"),
  computadores: () => import("./computadores"),
  uso: () => import("./uso"),
  plano: () => import("./plano"),
  troca: () => import("./troca"),
  alertas: () => import("./alertas"),
  integracoes: () => import("./integracoes"),
  time: () => import("./time"),
  minhaConta: () => import("./minha-conta"),
  comoFunciona: () => import("./como-funciona"),
  saude: () => import("./saude"),
}

/** Desenha a tela inteira (esperando o que carrega sob demanda) e devolve o HTML e os erros de cada pedaço. */
async function desenhar(Tela: React.ComponentType, fonte: FonteSupabase, estado: Instantaneo) {
  const erros: unknown[] = []
  const { prelude } = await prerenderToNodeStream(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <SessaoProvider auth={new AuthDemo()}>
            <DadosFixos fonte={fonte} estado={estado}>
              <Tela />
            </DadosFixos>
          </SessaoProvider>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
    { onError: (e) => void erros.push(e) }
  )
  let html = ""
  for await (const pedaco of prelude as unknown as AsyncIterable<unknown>) html += String(pedaco)
  return { html, erros }
}

let fonte: FonteSupabase
let estado: Instantaneo

beforeAll(async () => {
  fonte = new FonteSupabase()
  const lido = await fonte.carregar()
  estado = { ...lido, contas: pintarPorWorkspace(lido.contas) }
})

describe("telas com os dados da produção (admin em aal1, fator pendente, alertas vazios)", () => {
  it("o mapeamento entrega o que a produção tem", () => {
    expect(estado.eu).toMatchObject({ papel: "admin", aal: "aal1", totp: null })
    expect(estado.alertas).toEqual([])
    expect(estado.computadores.filter((c) => c.sistema === "pendente")).toHaveLength(2)
    expect(estado.config).toMatchObject({ fuso: "America/Fortaleza", auto: true, intervaloS: 10 })
  })

  it.each(SECOES.map((s) => s.id))("a seção %s desenha sem erro", async (id) => {
    const { default: Tela } = await TELAS[id]()
    const { html, erros } = await desenhar(Tela, fonte, estado)
    expect(erros).toEqual([])
    expect(html.length).toBeGreaterThan(200)
  })

  it("Alertas vazia mostra o convite para criar o primeiro, com o botão liberado", async () => {
    const { default: Tela } = await TELAS.alertas()
    const { html } = await desenhar(Tela, fonte, estado)
    expect(html).toContain("Nenhum alerta ainda")
    const botoes = [...html.matchAll(/<button([^>]*)>(?:<svg[^]*?<\/svg>)?Novo alerta<\/button>/g)]
    expect(botoes).toHaveLength(2)
    for (const [, atributos] of botoes) expect(atributos).not.toMatch(/\sdisabled=""/)
  })

  it("Alertas com um alerta de cada canal (e um canal que saiu) desenha sem erro", async () => {
    const { default: Tela } = await TELAS.alertas()
    const alertas = [
      { id: "a1", canal: "telegram", destino: { chat_id: "123", vault_id: "v1" }, eventos: ["sem_livre"], ativo: true },
      {
        id: "a2",
        canal: "email",
        destino: { para: "a@exemplo.com", de: "b@exemplo.com", vault_id: "v2" },
        eventos: ["troca", "limite"],
        ativo: false,
      },
      {
        id: "a3",
        canal: "webhook",
        destino: { url: "https://hook.exemplo.com/x", vault_id: "v3" },
        eventos: ["resumo_dia"],
        ativo: true,
      },
      { id: "a4", canal: "push", destino: {}, eventos: ["computador_parado"], ativo: true },
      // canal que já existiu (ntfy) ou que uma versão nova da nuvem crie: a tela não pode cair por causa dele
      {
        id: "a5",
        canal: "ntfy",
        destino: { servidor: "https://ntfy.sh", vault_id: "v5" },
        eventos: ["precisa_login", "evento_novo"],
        ativo: true,
      },
    ]
    linhas.tabelas.alertas = alertas
    try {
      const lido = await fonte.carregar()
      const { html, erros } = await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })
      expect(erros).toEqual([])
      expect(html).toContain("hook.exemplo.com")
    } finally {
      linhas.tabelas.alertas = []
    }
  })
})

describe("Computadores: o cartão de atualizações (Verificar, a escolha de como atualizar sozinho e a trava)", () => {
  const vazioDeConfig = () => linhas.tabelas.config.filter((c) => c.chave !== "atualizar_sozinho" && c.chave !== "atualizacao_vez")
  async function desenharComputadores(config: Record<string, unknown>[] = [], computadores?: Record<string, unknown>[]) {
    const antes = { config: linhas.tabelas.config, computadores: linhas.tabelas.computadores }
    linhas.tabelas.config = [...vazioDeConfig(), ...config]
    if (computadores) linhas.tabelas.computadores = computadores
    try {
      const lido = await fonte.carregar()
      const { default: Tela } = await TELAS.computadores()
      return { ...(await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })), lido }
    } finally {
      linhas.tabelas.config = antes.config
      linhas.tabelas.computadores = antes.computadores
    }
  }
  /** O botão de rádio da escolha (Radix): marcado ou não. */
  const marcado = (html: string, modo: string) => {
    const tag = html.match(new RegExp(`<button[^>]*id="atualizar-${modo}"[^>]*>`))?.[0] ?? ""
    return /aria-checked="true"/.test(tag)
  }

  it("a instalação que já estava com a opção ligada (true) aparece em 'De madrugada'; o Verificar aparece liberado", async () => {
    const { html, erros, lido } = await desenharComputadores([{ chave: "atualizar_sozinho", valor: true }])
    expect(erros).toEqual([])
    expect(lido.config.atualizarSozinho).toBe("madrugada")
    expect(marcado(html, "madrugada")).toBe(true)
    expect(marcado(html, "desligada")).toBe(false)
    expect(marcado(html, "assim_que_sair")).toBe(false)
    expect(html).toContain("De madrugada (3h às 5h)")
    expect(html).toContain("Assim que sair")
    const [botao] = [...html.matchAll(/<button([^>]*)>(?:<svg[^]*?<\/svg>)?Verificar atualização<\/button>/g)]
    expect(botao).toBeDefined()
    expect(botao![1]).not.toMatch(/\sdisabled=""/)
  })

  it("sem a opção gravada (a produção de 12/10): 'Desligada'; 'assim_que_sair' gravado aparece marcado", async () => {
    expect(marcado((await desenharComputadores()).html, "desligada")).toBe(true)
    expect(marcado((await desenharComputadores([{ chave: "atualizar_sozinho", valor: "assim_que_sair" }])).html, "assim_que_sair")).toBe(true)
  })

  /** Os computadores da produção com o agente da 0.2.1 (entendem o "assim que sair"). */
  const comAgenteNovo = () =>
    linhas.tabelas.computadores.map((c) =>
      c.id === "pc1" || c.id === "pc2"
        ? { ...c, diagnostico: { em: Math.floor(Date.now() / 1000), conferencias: [], assimQueSair: true } }
        : c
    )
  async function verificouComVersaoNova() {
    const { comecarConferencia, guardarLeitura } = await import("@/lib/atualizar")
    comecarConferencia({ pc1: 501, pc2: 502 })
    for (const [id, pc] of [[501, "pc1"], [502, "pc2"]] as const) {
      guardarLeitura({
        id,
        computadorId: pc,
        acao: "atualizar",
        estado: "feito",
        criadoEm: new Date().toISOString(),
        resposta: { ok: true, conferido: true, atual: "0.1.4", mais_nova: "0.2.1", nova: true, atualizando: null, precisa_nuvem: false },
      })
    }
  }

  it("o Verificar achou versão nova, mas os computadores são de antes da 0.2.1: com 'Assim que sair', o Atualizar todos fica para eles", async () => {
    const { limparConferencia } = await import("@/lib/atualizar")
    await verificouComVersaoNova()
    try {
      const { html, erros } = await desenharComputadores([{ chave: "atualizar_sozinho", valor: "assim_que_sair" }])
      expect(erros).toEqual([])
      expect(html).toContain("Versão 0.2.1 disponível para 2 computador(es).")
      expect(html).toContain("numa versão anterior à 0.2.1 só se atualizam sozinhos de madrugada")
      expect(html).toMatch(/Atualizar todos \(2\)/)
    } finally {
      limparConferencia()
    }
  })

  it("o Verificar achou versão nova com 'Assim que sair': eles começam sozinhos, com o andamento, sem o Atualizar todos", async () => {
    const { limparConferencia } = await import("@/lib/atualizar")
    await verificouComVersaoNova()
    try {
      const vez = { computador: "pc1", de: "0.1.4", para: "0.2.1", desde: new Date().toISOString(), estado: "em_andamento" }
      const { html, erros } = await desenharComputadores(
        [
          { chave: "atualizar_sozinho", valor: "assim_que_sair" },
          { chave: "atualizacao_vez", valor: vez },
        ],
        comAgenteNovo()
      )
      expect(erros).toEqual([])
      expect(html).toContain("Versão 0.2.1 disponível para 2 computador(es).")
      expect(html).toContain("eles começam sozinhos, um computador por vez")
      expect(html).toContain("0 de 2 na 0.2.1")
      expect(html).toContain("esperando a vez")
      expect(html).not.toMatch(/Atualizar todos \(/)
    } finally {
      limparConferencia()
    }
  })

  it("a versão nova precisa da nuvem primeiro: o cartão manda usar o Atualizar a nuvem", async () => {
    const computadores = linhas.tabelas.computadores.map((c) =>
      c.id === "pc1"
        ? {
            ...c,
            diagnostico: {
              em: Math.floor(Date.now() / 1000),
              conferencias: [],
              versaoNova: "0.2.1",
              precisaNuvem: { para: "0.2.1" },
            },
          }
        : c
    )
    const { html, erros } = await desenharComputadores([{ chave: "atualizar_sozinho", valor: "assim_que_sair" }], computadores)
    expect(erros).toEqual([])
    expect(html).toContain("A versão 0.2.1 precisa da nuvem atualizada primeiro: use Atualizar a nuvem, acima.")
    expect(html).toContain("esperando a nuvem")
  })

  /** O texto da linha "Nuvem e painel" (o parágrafo de estado dela). */
  const linhaNuvem = (html: string) => html.match(/Nuvem e painel<\/span>[\s\S]*?<p[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "") ?? ""
  // o svg do ícone (ou do spinner) não atravessa outro botão: o atributo capturado é o do próprio Atualizar a nuvem
  const botaoNuvem = (html: string) => html.match(/<button([^>]*)>(?:<svg(?:(?!<button)[^])*?<\/svg>)?Atualizar a nuvem<\/button>/)

  it("Nuvem e painel, na produção de 12/10 (nuvem de antes da 0.3.0): diz o que fazer, com o botão liberado para o administrador", async () => {
    const { html, erros, lido } = await desenharComputadores()
    expect(erros).toEqual([])
    expect(lido.config.nuvem?.versao).toBeNull()
    expect(linhaNuvem(html)).toContain("A nuvem ainda não sabe a versão dela (instalação de antes da 0.3.0)")
    expect(html).toContain("npx github:dantaspaulo/reveza --atualizar")
    const botao = botaoNuvem(html)
    expect(botao).not.toBeNull()
    expect(botao![1]).not.toMatch(/\sdisabled=""/)
  })

  it("Nuvem e painel em dia: as versões, e a atualização completa desligada com o comando de ligar", async () => {
    const { html, erros } = await desenharComputadores([
      { chave: "nuvem_versao", valor: "0.3.0" },
      { chave: "publicado", valor: { funcoes: "0.3.0", painel: "0.3.0" } },
      { chave: "nuvem_atualizacao", valor: { estado: "atualizada", de: "0.2.1", para: "0.3.0", desde: new Date().toISOString() } },
    ])
    expect(erros).toEqual([])
    expect(html).toContain("Nuvem 0.3.0 · funções 0.3.0 · painel 0.3.0")
    expect(linhaNuvem(html)).toBe("Nuvem e painel em dia na 0.3.0.")
    expect(html).toContain("Atualização completa desligada: funções e painel novos pedem o passo manual.")
    expect(html).toContain("reveza atualizacao-completa ligar")
  })

  it("a versão da nuvem mexe só no painel, sem a atualização completa: o passo manual, dizendo o que mudou", async () => {
    const { html, erros } = await desenharComputadores([
      { chave: "nuvem_versao", valor: "0.3.1" },
      { chave: "publicado", valor: { funcoes: "0.3.0", painel: "0.3.0" } },
      { chave: "impressoes", valor: { "0.3.0": { funcoes: "f1", painel: "p1" }, "0.3.1": { funcoes: "f1", painel: "p2" } } },
    ])
    expect(erros).toEqual([])
    expect(linhaNuvem(html)).toContain("A nuvem está na 0.3.1, que mexe no painel: rode a atualização pelo instalador")
  })

  it("a atualização da nuvem parou: o motivo, e o botão tenta de novo", async () => {
    const { html, erros } = await desenharComputadores([
      { chave: "nuvem_versao", valor: "0.3.0" },
      { chave: "publicado", valor: { funcoes: "0.3.0", painel: "0.3.0" } },
      {
        chave: "nuvem_atualizacao",
        valor: { estado: "falhou", de: "0.3.0", para: "0.3.1", desde: new Date().toISOString(), motivo: "a migração 0023_x.sql não entrou (nada dela ficou): erro" },
      },
    ])
    expect(erros).toEqual([])
    expect(linhaNuvem(html)).toContain("A atualização da nuvem para a 0.3.1 parou: a migração 0023_x.sql não entrou (nada dela ficou): erro.")
    expect(botaoNuvem(html)![1]).not.toMatch(/\sdisabled=""/)
  })

  it("atualização completa ligada e um computador publicando: o nome dele, e o Desligar para o administrador", async () => {
    const { html, erros } = await desenharComputadores([
      { chave: "nuvem_versao", valor: "0.3.1" },
      { chave: "publicado", valor: { funcoes: "0.3.0", painel: "0.3.0" } },
      { chave: "atualizacao_completa", valor: { ligada: true, em: new Date().toISOString(), computador: "pc1" } },
      { chave: "publicacao_vez", valor: { computador: "pc1", para: "0.3.1", desde: new Date().toISOString(), estado: "em_andamento" } },
    ])
    expect(erros).toEqual([])
    const nome = linhas.tabelas.computadores.find((c) => c.id === "pc1")?.nome as string
    expect(linhaNuvem(html)).toContain(`Publicando as funções e o painel da 0.3.1 em ${nome}`)
    expect(html).toContain("Atualização completa ligada")
    expect(html).toMatch(/>Desligar<\/button>/)
    expect(botaoNuvem(html)![1]).toMatch(/\sdisabled=""/)
  })

  it("todos na versão mais nova depois do Verificar", async () => {
    const { comecarConferencia, guardarLeitura, limparConferencia } = await import("@/lib/atualizar")
    comecarConferencia({ pc1: 601 })
    guardarLeitura({
      id: 601,
      computadorId: "pc1",
      acao: "atualizar",
      estado: "feito",
      criadoEm: new Date().toISOString(),
      resposta: { ok: true, conferido: true, atual: "0.1.4", mais_nova: "0.1.4", nova: false, atualizando: null, precisa_nuvem: false },
    })
    try {
      const computadores = linhas.tabelas.computadores.map((c) => (c.id === "pc2" ? { ...c, versao: "0.1.4" } : c))
      const { html } = await desenharComputadores([], computadores)
      expect(html).toContain("Todos na versão mais nova (0.1.4).")
    } finally {
      limparConferencia()
    }
  })
})

describe("a caixa da tela quebrada", () => {
  async function caixa(erro: unknown) {
    const { SecaoQuebrou } = await import("@/App")
    const Tela = () => <SecaoQuebrou erro={erro} componentes={"\n    at Alertas"} aoTentar={() => {}} />
    return (await desenhar(Tela, fonte, estado)).html
  }

  it("mostra a mensagem do erro, tentar de novo e copiar detalhes", async () => {
    const html = await caixa(new TypeError("Cannot read properties of undefined (reading 'map')"))
    expect(html).toContain("Esta tela encontrou um dado que não soube mostrar")
    expect(html).toContain("Cannot read properties of undefined (reading &#x27;map&#x27;)")
    expect(html).toContain("Tentar de novo")
    expect(html).toContain("Copiar detalhes")
  })

  it("pedaço do build de uma versão anterior: pede para recarregar a página", async () => {
    const html = await caixa(
      new TypeError("Failed to fetch dynamically imported module: https://painel.exemplo/assets/alertas-5U9JIrVV.js")
    )
    expect(html).toContain("Saiu uma versão nova do painel")
    expect(html).toContain("Recarregar a página")
    expect(html).not.toContain("Tentar de novo")
    expect(html).toContain("Copiar detalhes")
  })
})

describe("Computadores: o cartão do assistente de código (a versão de cada computador e a escolha de como ele se atualiza)", () => {
  const segundos = (ms: number) => Math.floor((Date.now() - ms) / 1000)
  /** O diagnóstico como o agente 0.8.0 manda: a versão do assistente num campo próprio. */
  const comAssistente = (versao: string, extra: Record<string, unknown> = {}) => ({
    em: segundos(60_000),
    conferencias: [{ id: "assistente", nome: "Assistente de código", situacao: "ok", detalhe: `versão ${versao}`, valor: versao }],
    assistente: { versao, modo: "padrao", autoDesligado: null, atualizando: false, ultima: null, ...extra },
  })
  async function desenharAssistente(diags: Record<string, unknown>, config: Record<string, unknown>[] = []) {
    const antes = { config: linhas.tabelas.config, computadores: linhas.tabelas.computadores }
    linhas.tabelas.config = [...linhas.tabelas.config.filter((c) => c.chave !== "assistente_atualizar"), ...config]
    linhas.tabelas.computadores = linhas.tabelas.computadores.map((c) => (String(c.id) in diags ? { ...c, diagnostico: diags[String(c.id)] } : c))
    try {
      const lido = await fonte.carregar()
      const { default: Tela } = await TELAS.computadores()
      return { ...(await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })), lido }
    } finally {
      linhas.tabelas.config = antes.config
      linhas.tabelas.computadores = antes.computadores
    }
  }
  const marcado = (html: string, modo: string) =>
    /aria-checked="true"/.test(html.match(new RegExp(`<button[^>]*id="assistente-${modo}"[^>]*>`))?.[0] ?? "")

  it("dois computadores em versões diferentes: a mais nova, quem está atrás e o Atualizar os atrasados; de fábrica, o jeito do assistente", async () => {
    const { html, erros, lido } = await desenharAssistente({ pc1: comAssistente("2.1.301"), pc2: comAssistente("2.1.293") })
    expect(erros).toEqual([])
    expect(lido.config.assistenteAtualizar).toBe("padrao")
    expect(html).toContain("Assistente de código")
    expect(html).toContain("Versões diferentes: a mais nova aqui é a 2.1.301")
    expect(html).toContain("2.1.293")
    expect(html).toContain("atrás")
    expect(html).toMatch(/Atualizar os atrasados \(1\)/)
    expect(marcado(html, "padrao")).toBe(true)
    expect(marcado(html, "sozinho")).toBe(false)
  })

  it("todos na mesma versão: o resumo diz qual, sem o Atualizar os atrasados", async () => {
    const { html } = await desenharAssistente({ pc1: comAssistente("2.1.301"), pc2: comAssistente("2.1.301") })
    expect(html).toContain("Todos na versão 2.1.301")
    expect(html).not.toMatch(/Atualizar os atrasados/)
  })

  it("agente de antes da 0.8.0: a versão vem do texto do diagnóstico, e o Atualizar fica desligado com o motivo", async () => {
    const antigo = { em: segundos(60_000), conferencias: [{ id: "assistente", nome: "Assistente de código", situacao: "ok", detalhe: "versão 2.1.290" }] }
    const { html } = await desenharAssistente({ pc1: comAssistente("2.1.301"), pc2: antigo })
    expect(html).toContain("2.1.290")
    expect(html).toContain("Atualize o agente deste computador para atualizar o assistente pelo painel.")
    // um atrasado só, mas sem o agente novo: o Atualizar os atrasados não aparece para ele
    expect(html).not.toMatch(/Atualizar os atrasados/)
  })

  it("a escolha gravada aparece marcada, e a falha da última atualização aparece com o erro", async () => {
    const falhou = comAssistente("2.1.293", { ultima: { em: new Date().toISOString(), ok: false, de: "2.1.293", para: "2.1.293", sozinho: true, erro: "Error: Failed to install native update" } })
    const { html, lido } = await desenharAssistente({ pc1: comAssistente("2.1.301"), pc2: falhou }, [{ chave: "assistente_atualizar", valor: "manual" }])
    expect(lido.config.assistenteAtualizar).toBe("manual")
    expect(marcado(html, "manual")).toBe(true)
    expect(html).toContain("Não atualizou: Error: Failed to install native update")
  })
})

describe("Contas e Plano: a conta sem o modelo de um computador e a semana do Fable (relato de 22/10/2026)", () => {
  const H = 3_600_000
  const daqui = (ms: number) => new Date(Date.now() + ms).toISOString()
  async function desenharCom(tela: "contas" | "plano") {
    const antes = { janelas: linhas.tabelas.uso_janelas, semModelo: linhas.tabelas.contas_sem_modelo }
    linhas.tabelas.contas_sem_modelo = [
      { conta_id: "c2", computador_id: "pc1", modelo: "claude-fable-5-1", ate: daqui(3 * H) },
      // a que já venceu não aparece
      { conta_id: "c4", computador_id: "pc1", modelo: "claude-fable-5-1", ate: daqui(-H) },
    ]
    // c3: a Anthropic só manda a semana do Fable; c4: só a janela de 5 horas
    linhas.tabelas.uso_janelas = [
      ...antes.janelas.filter((j) => !((j.conta_id === "c3" || j.conta_id === "c4") && j.tipo === "seven_day")),
      { conta_id: "c3", tipo: "seven_day_fable", pct: 21, reset_em: daqui(60 * H), lido_em: daqui(-60_000), fonte: "api" },
    ]
    try {
      const lido = await fonte.carregar()
      const { default: Tela } = await TELAS[tela]()
      return { ...(await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })), lido }
    } finally {
      linhas.tabelas.uso_janelas = antes.janelas
      if (antes.semModelo) linhas.tabelas.contas_sem_modelo = antes.semModelo
      else delete linhas.tabelas.contas_sem_modelo
    }
  }

  it("Contas: a marca que vale aparece na conta, com o computador e a hora; a vencida não; e a semana do Fable", async () => {
    const { html, erros, lido } = await desenharCom("contas")
    expect(erros).toEqual([])
    expect(lido.contas.find((c) => c.id === "c2")!.semModelo).toHaveLength(1)
    expect(lido.contas.find((c) => c.id === "c4")!.semModelo).toHaveLength(0)
    expect(html).toMatch(/sem o Fable 5\.1 em Mac mini até \d{2}:\d{2}/)
    expect(html.match(/sem o Fable 5\.1/g)).toHaveLength(2) // a tabela e o cartão do celular, da mesma conta
    expect(html).toContain("semana do Fable: 21%")
  })

  it("Plano: sem a semana geral, mostra a do Fable com o aviso; sem nenhuma semana, diz que a conta não informa", async () => {
    const { html, erros } = await desenharCom("plano")
    expect(erros).toEqual([])
    expect(html).toContain("Esta é a semana do Fable, que só conta para as sessões no Fable.")
    expect(html).toContain("Esta conta não informa cota semanal agora: só a janela de 5 horas.")
    // a conta sem leitura nenhuma (c6) segue com o aviso de antes
    expect(html).toContain("Esta conta ainda não tem leitura da semana.")
  })
})

describe("Computadores: renomear (pedido de um usuário, 22/10/2026)", () => {
  it("cada computador tem o botão de renomear, com o nome dele no rótulo", async () => {
    const lido = await fonte.carregar()
    const { default: Tela } = await TELAS.computadores()
    const { html, erros } = await desenhar(Tela, fonte, { ...lido, contas: pintarPorWorkspace(lido.contas) })
    expect(erros).toEqual([])
    expect(html).toContain('aria-label="Renomear Mac mini"')
    expect(html).toContain('aria-label="Renomear MacBook"')
  })

  it("o nome dado no painel chega da nuvem (nome_do_painel)", async () => {
    const antes = linhas.tabelas.computadores
    linhas.tabelas.computadores = antes.map((c) => (c.id === "pc1" ? { ...c, nome: "Notebook da Ana", nome_do_painel: true } : c))
    try {
      const lido = await fonte.carregar()
      const pc = lido.computadores.find((c) => c.id === "pc1")!
      expect(pc.nome).toBe("Notebook da Ana")
      expect(pc.nomeDoPainel).toBe(true)
      expect(lido.computadores.find((c) => c.id === "pc2")!.nomeDoPainel).toBe(false)
    } finally {
      linhas.tabelas.computadores = antes
    }
  })
})
