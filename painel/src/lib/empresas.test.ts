import { describe, expect, it } from "vitest"

import type { AgenteOpenBot, DadosEmpresas, Empresa, LinhaUso, RegraPasta, SessaoUso } from "@/dados/tipos"
import {
  SEM_DONO,
  agenteDaPasta,
  contaPeloTexto,
  contasPorEmpresa,
  criarClassificador,
  criarRodaEm,
  ehCaminho,
  empresasForaNoAntigo,
  modoDe,
  nomeUnidade,
  numerosPorEmpresa,
  ordenarUnidades,
  pastaAmpla,
  pastasSemDono,
  porPeriodoEmpresa,
  resumoRevezamento,
  semanaDe,
  subirAEmpresa,
  sugestaoPorDominio,
  trocaDoEvento,
  trocasPorEmpresa,
  versaoNum,
} from "./empresas"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"

const empresa = (id: string, o: Partial<Empresa> = {}): Empresa => ({
  id,
  nome: id,
  cor: 0,
  transbordo: "nenhum",
  transbordoContas: [],
  separar: false,
  criadaEm: "2026-11-01T00:00:00Z",
  pai: null,
  modo: null,
  herdarTransbordo: true,
  ...o,
})
const regra = (tipo: RegraPasta["tipo"], padrao: string, empresaId: string): RegraPasta => ({ id: `${tipo}:${padrao}`, tipo, padrao, empresaId })
const agente = (pasta: string, titulo: string, nome = "agente"): AgenteOpenBot => ({ computadorId: "pc", pasta, nome, titulo, vistoEm: "" })

function dados(regras: RegraPasta[], agentes: AgenteOpenBot[] = []): DadosEmpresas {
  return {
    empresas: ["a", "b", "c"].map((id) => empresa(id)),
    marcas: [],
    regras,
    agentes,
    trilhasNaNuvem: true,
    trilhas: [],
    projetosNaNuvem: true,
    sombras: [],
    computadoresNaNuvem: true,
    computadores: [],
  }
}

function linha(o: Partial<LinhaUso>): LinhaUso {
  return {
    hora: "2026-11-20T12:00:00Z",
    contaId: "c1",
    computadorId: "pc1",
    projeto: "app",
    pasta: "",
    modelo: "m",
    respostas: 1,
    entrada: 10,
    saida: 20,
    cacheEscrita: 30,
    cacheLeitura: 40,
    usd: 1,
    agentes: 0,
    ...o,
  }
}

describe("regra de pasta", () => {
  it("caminho: ~, / ou a letra de um disco do Windows; o resto é nome", () => {
    for (const c of ["~/Code/a", "/srv/a", "D:/cliente/api", "D:\\cliente", "C:"]) expect(ehCaminho(c), c).toBe(true)
    for (const n of ["api", "producao", "DD:/a"]) expect(ehCaminho(n), n).toBe(false)
  })

  it("larga demais (pegaria o uso de todas as empresas): a pasta pessoal e a raiz do disco", () => {
    for (const a of ["~", "~/", " ~ ", "/", "//", "C:", "c:/", "D:\\"]) expect(pastaAmpla(a), a).toBe(true)
    for (const b of ["~/Code", "/srv", "D:/cliente", "api"]) expect(pastaAmpla(b), b).toBe(false)
  })

  it("Windows: regra com a letra do disco pega a pasta e o que está dentro", () => {
    const c = criarClassificador(dados([regra("pasta", "D:/clienteA", "a")]))
    expect(c("D:/clienteA/api", "api")).toBe("a")
    expect(c("D:/clienteB/api", "api")).toBeNull()
  })
})

describe("classificador", () => {
  it("0.20.0: a regra de um computador só vale nele e ganha da que vale para todos", () => {
    const c = criarClassificador(
      dados([
        regra("pasta", "~/Code/site", "c"),
        { ...regra("pasta", "~/Code/site", "a"), id: "r-a", computadorId: "pc1" },
        { ...regra("pasta", "~/Code/outra", "b"), id: "r-b", computadorId: "pc2" },
      ])
    )
    expect(c("~/Code/site", "site", "pc1")).toBe("a")
    expect(c("~/Code/site", "site", "pc2")).toBe("c")
    expect(c("~/Code/outra", "outra", "pc2")).toBe("b")
    expect(c("~/Code/outra", "outra", "pc1")).toBeNull()
    expect(c("~/Code/outra", "outra")).toBeNull()
  })

  it("0.20.1: a regra de um projeto só vale nos computadores dele, e o subprojeto segue o projeto", () => {
    const d = dados(
      [regra("pasta", "~/Code/alfa", "a"), regra("pasta", "~/Code/alfa/site", "s"), regra("titulo", "cliente x", "a")],
      [agente("~/agentes/x", "Cliente X")]
    )
    d.empresas = [empresa("a", { emTodosComputadores: false }), empresa("s", { pai: "a" }), empresa("b")]
    d.computadores = [{ empresaId: "a", computadorId: "pc1" }]
    const c = criarClassificador(d)
    expect(c("~/Code/alfa", "alfa", "pc1")).toBe("a")
    expect(c("~/Code/alfa/site", "site", "pc1")).toBe("s")
    expect(c("~/agentes/x", "x", "pc1")).toBe("a")
    expect(c("~/Code/alfa", "alfa", "pc2")).toBeNull()
    expect(c("~/Code/alfa/site", "site", "pc2")).toBeNull()
    expect(c("~/agentes/x", "x", "pc2")).toBeNull()
  })

  it("0.20.1: projeto em todos segue valendo, e a linha sem computador conhecido não perde o dono", () => {
    const d = dados([regra("pasta", "~/Code/alfa", "a"), regra("pasta", "~/Code/beta", "b")])
    d.empresas = [empresa("a", { emTodosComputadores: false }), empresa("b", { emTodosComputadores: true })]
    d.computadores = [{ empresaId: "a", computadorId: "pc1" }]
    const c = criarClassificador(d)
    expect(c("~/Code/beta", "beta", "pc2")).toBe("b")
    expect(c("~/Code/alfa", "alfa")).toBe("a")
  })

  it("prefixo: a pasta e tudo dentro dela; o mais comprido ganha; não confunde nome parecido", () => {
    const c = criarClassificador(dados([regra("pasta", "~/Code/um", "a"), regra("pasta", "~/Code/um/especial/", "b")]))
    expect(c("~/Code/um", "um")).toBe("a")
    expect(c("~/Code/um/x", "x")).toBe("a")
    expect(c("~/Code/um/especial", "especial")).toBe("b")
    expect(c("~/Code/um-outro", "um-outro")).toBeNull()
    expect(c("~/code/UM", "um"), "sem diferença de caixa").toBe("a")
  })

  it("nome: qualquer pasta com o nome no caminho; o prefixo mais fundo ganha do nome mais raso", () => {
    const c = criarClassificador(dados([regra("pasta", "cliente-x", "a"), regra("pasta", "~/Code/cliente-x/app", "b"), regra("pasta", "~/Code", "c")]))
    expect(c("~/Code/cliente-x", "cliente-x")).toBe("a")
    expect(c("~/Code/cliente-x/outro", "outro")).toBe("a")
    expect(c("~/Code/cliente-x/app", "app")).toBe("b")
    expect(c("~/Code/qualquer", "qualquer")).toBe("c")
  })

  it("título do agente do OpenBot: ganha de uma pasta mais larga e perde para a regra da própria pasta", () => {
    const ag = [agente("~/OpenBot/Agents/agent-1", "Atendimento do Cliente X"), agente("~/OpenBot/Agents/agent-2", "Outra coisa", "Cliente X bot")]
    const c = criarClassificador(dados([regra("titulo", "cliente x", "a"), regra("pasta", "~/OpenBot", "c")], ag))
    expect(c("~/OpenBot/Agents/agent-1", "agent-1")).toBe("a")
    expect(c("~/OpenBot/Agents/agent-1/trabalho", "trabalho"), "pasta de dentro do agente").toBe("a")
    expect(c("~/OpenBot/Agents/agent-2", "agent-2"), "pelo nome também").toBe("a")
    expect(c("~/OpenBot/Agents/agent-3", "agent-3")).toBe("c")
    const d = criarClassificador(dados([regra("titulo", "cliente x", "a"), regra("pasta", "~/OpenBot/Agents/agent-1", "b")], ag))
    expect(d("~/OpenBot/Agents/agent-1", "agent-1")).toBe("b")
  })

  it("linha sem pasta (antes da 0.17.0): só a regra de nome, pelo nome curto", () => {
    const c = criarClassificador(dados([regra("pasta", "app", "a"), regra("pasta", "~/Code/app", "b")]))
    expect(c("", "app")).toBe("a")
    expect(c("", "outro")).toBeNull()
  })

  it("regra de empresa apagada não vale", () => {
    const c = criarClassificador({ ...dados([regra("pasta", "~/Code", "sumiu")]) })
    expect(c("~/Code/a", "a")).toBeNull()
  })

  it("agente da pasta: o mais fundo", () => {
    const ag = [agente("~/OpenBot/Agents", "raiz"), agente("~/OpenBot/Agents/agent-1", "um")]
    expect(agenteDaPasta("~/OpenBot/Agents/agent-1/x", ag)?.titulo).toBe("um")
    expect(agenteDaPasta("~/Code", ag)).toBeNull()
    expect(agenteDaPasta("", ag)).toBeNull()
  })
})

describe("números por empresa", () => {
  const c = criarClassificador(dados([regra("pasta", "~/Code/a", "a"), regra("pasta", "~/Code/b", "b")]))
  const uso = [
    linha({ pasta: "~/Code/a", usd: 2, contaId: "c1" }),
    linha({ pasta: "~/Code/a/sub", projeto: "sub", usd: 3, contaId: "c2" }),
    linha({ pasta: "~/Code/b", usd: 5, contaId: "c1", agentes: 2 }),
    linha({ pasta: "~/solta", projeto: "solta", usd: 7, contaId: null, computadorId: "pc2" }),
    linha({ pasta: "", projeto: "velho", usd: 1, contaId: "c1" }),
  ]
  const sessoes = [{ pasta: "~/Code/a", projeto: "a" }, { pasta: "~/Code/b", projeto: "b" }, { pasta: "", projeto: "x" }] as SessaoUso[]

  it("custo, tokens por tipo, sessões, agentes, contas e pastas de cada uma; o resto no sem dono", () => {
    const n = numerosPorEmpresa(uso, sessoes, c)
    expect(n.get("a")!.usd).toBe(5)
    expect(n.get("a")!.tokens).toBe(200)
    expect(n.get("a")!.cacheLeitura).toBe(80)
    expect(n.get("a")!.sessoes).toBe(1)
    expect([...n.get("a")!.contas.keys()].sort()).toEqual(["c1", "c2"])
    expect([...n.get("a")!.pastas.keys()].sort()).toEqual(["~/Code/a", "~/Code/a/sub"])
    expect(n.get("b")!.agentes).toBe(2)
    expect(n.get(SEM_DONO)!.usd).toBe(8)
    expect(n.get(SEM_DONO)!.sessoes).toBe(1)
    expect([...n.get(SEM_DONO)!.pastas.keys()].sort()).toEqual(["projeto:velho", "~/solta"])
    const soma = [...n.values()].reduce((s, x) => s + x.usd, 0)
    expect(soma, "nada some nem conta duas vezes").toBe(18)
  })

  it("por dia e por semana (a semana começa na segunda)", () => {
    expect(semanaDe("2026-11-20")).toBe("2026-11-16")
    expect(semanaDe("2026-11-16")).toBe("2026-11-16")
    expect(semanaDe("2026-11-22")).toBe("2026-11-16")
    const dias = ["2026-11-19", "2026-11-20"]
    const u = [linha({ pasta: "~/Code/a", hora: "2026-11-19T12:00:00", usd: 1 }), linha({ pasta: "~/Code/b", hora: "2026-11-20T12:00:00", usd: 2 })]
    const porDia = porPeriodoEmpresa(u, c, dias, "dia", "usd")
    expect(porDia.dados).toEqual([
      { dia: "2026-11-19", a: 1, b: 0 },
      { dia: "2026-11-20", a: 0, b: 2 },
    ])
    const porSemana = porPeriodoEmpresa(u, c, dias, "semana", "tokens")
    expect(porSemana.dados).toEqual([{ dia: "2026-11-16", a: 100, b: 100 }])
  })

  it("pastas sem dono: da mais cara para a mais barata, com os computadores e o agente do OpenBot", () => {
    const ag = [agente("~/solta", "Agente solto")]
    const s = pastasSemDono(uso, c, ag)
    expect(s.map((x) => x.chave)).toEqual(["~/solta", "projeto:velho"])
    expect(s[0]!.computadores).toEqual(["pc2"])
    expect(s[0]!.agente?.titulo).toBe("Agente solto")
    expect(s[1]!.agente).toBeNull()
  })

  it("uso de cada conta por empresa", () => {
    const m = contasPorEmpresa(uso, c)
    expect(Object.fromEntries(m.get("c1")!)).toEqual({ a: 2, b: 5, [SEM_DONO]: 1 })
    expect(m.has("null")).toBe(false)
  })
})

describe("trocas por empresa", () => {
  const contas = [
    { id: U1, email: "um@empresa.exemplo" },
    { id: U2, email: "um@empresa.exemplo.br" },
  ]

  it("o evento: id da nuvem da 0.17.0; a decisão da nuvem não conta de novo; agente antigo sem id", () => {
    expect(trocaDoEvento("t", "x", { para: "abc12345", para_nuvem: U1, computador: "pc" })).toEqual({ em: "t", computadorId: "pc", para: U1, decisao: false, texto: "x" })
    expect(trocaDoEvento("t", "x", { para: U1 }).decisao).toBe(true)
    expect(trocaDoEvento("t", "x", { para: "abc12345" })).toMatchObject({ para: null, decisao: false })
    expect(trocaDoEvento("t", "x", { para_nuvem: "não é id" })).toMatchObject({ para: null, decisao: false })
  })

  it("pelo texto: o último e-mail citado, e o mais comprido na mesma posição", () => {
    expect(contaPeloTexto("Troquei de um@empresa.exemplo (90%) para um@empresa.exemplo.br (3%).", contas)).toBe(U2)
    expect(contaPeloTexto("Troquei de um@empresa.exemplo.br (90%) para um@empresa.exemplo (3%).", contas)).toBe(U1)
    expect(contaPeloTexto("Pus UM@empresa.exemplo no assistente", contas)).toBe(U1)
    expect(contaPeloTexto("nada aqui", contas)).toBeNull()
  })

  it("pelo texto: um e-mail que é o fim de outro não vale dentro dele", () => {
    const duas = [
      { id: U1, email: "ana@empresa.exemplo" },
      { id: U2, email: "joana@empresa.exemplo" },
    ]
    expect(contaPeloTexto("Troquei de ana@empresa.exemplo para joana@empresa.exemplo.", duas)).toBe(U2)
    expect(contaPeloTexto("Troquei de joana@empresa.exemplo para ana@empresa.exemplo.", duas)).toBe(U1)
    expect(contaPeloTexto("Só joana@empresa.exemplo aqui", [duas[0]!])).toBeNull()
  })

  it("conta de várias empresas conta para cada uma; sem marca e sem conta à parte; decisão fora", () => {
    const trocas = [
      trocaDoEvento("1", "", { para: "x", para_nuvem: U1 }),
      trocaDoEvento("2", "Troquei de a para um@empresa.exemplo.br (1%).", { para: "y" }),
      trocaDoEvento("3", "", { para: U1 }),
      trocaDoEvento("4", "", { para: "z" }),
      trocaDoEvento("5", "", { para: "x", para_nuvem: "33333333-3333-4333-8333-333333333333" }),
    ]
    const r = trocasPorEmpresa(trocas, contas, [
      { contaId: U1, empresaId: "a" },
      { contaId: U1, empresaId: "b" },
    ])
    expect(r.total).toBe(4)
    expect(Object.fromEntries(r.porEmpresa)).toEqual({ a: 1, b: 1 })
    expect(r.semMarca).toBe(1)
    expect(r.semConta, "conta que saiu e evento sem conta").toBe(2)
  })
})

describe("sugestão por domínio", () => {
  it("um grupo por domínio, maior primeiro; provedor público e conta saindo ficam de fora", () => {
    const s = sugestaoPorDominio([
      { id: "1", email: "a@um.exemplo.br", saiEm: null },
      { id: "2", email: "b@UM.exemplo.br", saiEm: null },
      { id: "3", email: "c@dois.exemplo", saiEm: null },
      { id: "4", email: "d@gmail.com", saiEm: null },
      { id: "5", email: "e@dois.exemplo", saiEm: "2026-11-21T00:00:00Z" },
    ])
    expect(s).toEqual([
      { dominio: "um.exemplo.br", contas: ["1", "2"] },
      { dominio: "dois.exemplo", contas: ["3"] },
    ])
  })
})

describe("projetos (0.19.0)", () => {
  const loja = empresa("loja", { nome: "Loja", pai: "agencia" })
  const blog = empresa("blog", { nome: "Blog", pai: "agencia", modo: "desligado" })
  const agencia = empresa("agencia", { nome: "Agência", separar: true, modo: "ligado" })
  const outra = empresa("outra", { nome: "Outra", modo: "desligado" })
  const todas = [loja, blog, agencia, outra]

  it("o nome do projeto leva o da empresa", () => {
    expect(nomeUnidade(agencia, todas)).toBe("Agência")
    expect(nomeUnidade(loja, todas)).toBe("Agência / Loja")
    expect(nomeUnidade(empresa("x", { pai: "sumiu" }), todas)).toBe("? / x")
  })

  it("cada empresa vem seguida dos projetos dela, em ordem de nome", () => {
    expect(ordenarUnidades(todas).map((e) => e.id)).toEqual(["agencia", "blog", "loja", "outra"])
  })

  it("projeto sem modo próprio segue a empresa; com modo, vale o dele", () => {
    expect(modoDe(agencia, todas)).toBe("ligado")
    expect(modoDe(loja, todas)).toBe("ligado")
    expect(modoDe(blog, todas)).toBe("desligado")
    expect(modoDe(outra, todas)).toBe("desligado")
    // empresa de antes da 0.19.0: só o "separar"
    expect(modoDe(empresa("velha", { separar: true }), todas)).toBe("ligado")
  })

  it("revezamento global só com tudo desligado; projeto que herda conta uma vez, na empresa", () => {
    expect(resumoRevezamento(todas)).toEqual({ ligadas: 1, emTeste: 0, global: false })
    expect(resumoRevezamento([outra, empresa("p", { pai: "outra" })])).toEqual({ ligadas: 0, emTeste: 0, global: true })
    expect(resumoRevezamento([outra, empresa("p", { pai: "outra", modo: "sombra" })])).toEqual({
      ligadas: 0,
      emTeste: 1,
      global: false,
    })
  })

  it("os números por empresa somam os projetos na empresa deles", () => {
    const classificar = (pasta: string) => (pasta === "/l" ? "loja" : pasta === "/a" ? "agencia" : null)
    const porEmpresa = subirAEmpresa(classificar, todas)
    expect(porEmpresa("/l", "")).toBe("agencia")
    expect(porEmpresa("/a", "")).toBe("agencia")
    expect(porEmpresa("/z", "")).toBeNull()
  })

  it("a versão vira número; o que não casa (ou é grande demais) conta como anterior", () => {
    expect(versaoNum("0.19.0")).toBe(19000)
    expect(versaoNum("0.18.4")).toBeLessThan(versaoNum("0.19.0"))
    expect(versaoNum("0.19.0-rc1")).toBe(19000)
    expect(versaoNum("0.9")).toBe(0)
    expect(versaoNum(null)).toBe(0)
    expect(versaoNum("99999.0.0")).toBe(0)
  })

  it("a empresa ligada com projeto desligado e com regra fica de fora no agente antigo", () => {
    const regras = [regra("pasta", "~/agencia/blog", "blog")]
    expect(empresasForaNoAntigo({ empresas: todas, regras, marcas: [] }).map((e) => e.id)).toEqual(["agencia"])
    // sem regra no projeto desligado, o agente antigo não erra: nada fica de fora
    expect(empresasForaNoAntigo({ empresas: todas, regras: [], marcas: [] })).toEqual([])
    // projeto que herda o modo não conta
    expect(empresasForaNoAntigo({ empresas: [agencia, loja], regras: [regra("pasta", "~/l", "loja")], marcas: [] })).toEqual([])
    // projeto em teste segue a empresa: não tira nada dela
    const teste = empresa("teste", { pai: "agencia", modo: "sombra" })
    expect(empresasForaNoAntigo({ empresas: [agencia, teste], regras: [regra("pasta", "~/t", "teste")], marcas: [] })).toEqual([])
  })

  it("de outra empresa: nome de pasta conta sempre; caminho só com a barra", () => {
    const beta = empresa("beta", { separar: true, modo: "ligado" })
    const ferramenta = empresa("ferramenta", { pai: "beta", modo: "desligado" })
    const base = [agencia, beta, ferramenta]
    const ids = (regras: RegraPasta[]) => empresasForaNoAntigo({ empresas: base, regras, marcas: [] }).map((e) => e.id).sort()
    expect(ids([regra("pasta", "~/Code", "agencia"), regra("pasta", "ferramenta", "ferramenta")])).toEqual(["agencia", "beta"])
    expect(ids([regra("pasta", "~/Code/site", "agencia"), regra("pasta", "~/Code/site2", "ferramenta")])).toEqual(["beta"])
    expect(ids([regra("pasta", "~/Code/site", "agencia"), regra("pasta", "~/Code/site/sub", "ferramenta")])).toEqual(["agencia", "beta"])
    // a empresa de cima desligada não tira nada de ninguém (como na 0.18)
    const gama = empresa("gama", { modo: "desligado" })
    const g = [regra("pasta", "~/Code", "agencia"), regra("pasta", "~/Code/g", "gama")]
    expect(empresasForaNoAntigo({ empresas: [agencia, gama], regras: g, marcas: [] })).toEqual([])
  })

  it("onde o projeto roda (como rvz_roda_em): o subprojeto segue o projeto; sem a escolha, em todos", () => {
    const so = empresa("so", { emTodosComputadores: false })
    const sub = empresa("sub", { pai: "so" })
    const todos = empresa("todos", { emTodosComputadores: true })
    const antigo = empresa("antigo")
    const roda = criarRodaEm({
      empresas: [so, sub, todos, antigo],
      computadores: [{ empresaId: "so", computadorId: "pc1" }],
    })
    expect([roda("so", "pc1"), roda("so", "pc2"), roda("sub", "pc1"), roda("sub", "pc2")]).toEqual([true, false, true, false])
    expect([roda("todos", "pc2"), roda("antigo", "pc2")]).toEqual([true, true])
    // nuvem antiga, sem a lista: tudo roda em todos
    expect(criarRodaEm({ empresas: [antigo] })("antigo", "pc9")).toBe(true)
  })
})
