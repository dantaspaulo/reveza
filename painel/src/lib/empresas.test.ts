import { describe, expect, it } from "vitest"

import type { AgenteOpenBot, DadosEmpresas, Empresa, LinhaUso, RegraPasta, SessaoUso } from "@/dados/tipos"
import {
  SEM_DONO,
  agenteDaPasta,
  contaPeloTexto,
  contasPorEmpresa,
  criarClassificador,
  ehCaminho,
  numerosPorEmpresa,
  pastaAmpla,
  pastasSemDono,
  porPeriodoEmpresa,
  semanaDe,
  sugestaoPorDominio,
  trocaDoEvento,
  trocasPorEmpresa,
} from "./empresas"

const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"

const empresa = (id: string): Empresa => ({ id, nome: id, cor: 0, transbordo: "nenhum", transbordoContas: [], criadaEm: "2026-11-01T00:00:00Z" })
const regra = (tipo: RegraPasta["tipo"], padrao: string, empresaId: string): RegraPasta => ({ id: `${tipo}:${padrao}`, tipo, padrao, empresaId })
const agente = (pasta: string, titulo: string, nome = "agente"): AgenteOpenBot => ({ computadorId: "pc", pasta, nome, titulo, vistoEm: "" })

function dados(regras: RegraPasta[], agentes: AgenteOpenBot[] = []): DadosEmpresas {
  return { empresas: ["a", "b", "c"].map(empresa), marcas: [], regras, agentes }
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
