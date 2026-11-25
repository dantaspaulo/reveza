import { describe, expect, it } from "vitest"

import type { EstadoConta } from "@/dados/derivados"
import type { AgenteOpenBot, Conta } from "@/dados/tipos"

import {
  adicionarTexto,
  agentesRecentes,
  agentesDoTexto,
  alternarAgente,
  avisoContas,
  classificadorDoRascunho,
  filtrarLinhas,
  linhasDeAgentes,
  pastasManuais,
  type Usado,
} from "./agentes"
import { planoDeGravar, type UnidadeRascunho } from "./cadastro"

const MAC = "mac"
const PC2 = "pc2"

const u = (id: string, campos: Partial<UnidadeRascunho> = {}): UnidadeRascunho => ({
  id,
  novo: false,
  nome: id,
  pai: null,
  cor: 0,
  modo: "desligado",
  contas: [],
  pastas: [],
  titulos: [],
  computadores: null,
  ...campos,
})
const ag = (nome: string, pasta: string, computadorId = MAC, titulo = "", vistoEm = "2026-11-24T12:00:00.000Z"): AgenteOpenBot => ({
  computadorId,
  pasta,
  nome,
  titulo,
  vistoEm,
})
const ana = ag("Ana", "/home/x/agentes/ana", MAC, "Vendas")
const bruno = ag("Bruno", "/home/x/agentes/bruno", MAC, "Suporte")
const caio = ag("Caio", "/home/x/agentes/caio", PC2, "Vendas")
const TODOS = [ana, bruno, caio]

const linhas = (lista: UnidadeRascunho[], id: string, agentes: AgenteOpenBot[] = TODOS, pc = MAC) =>
  linhasDeAgentes(lista, id, agentes, pc, classificadorDoRascunho(lista, agentes))
const linha = (lista: UnidadeRascunho[], id: string, a: AgenteOpenBot, agentes: AgenteOpenBot[] = TODOS) =>
  linhas(lista, id, agentes).find((x) => x.agente.pasta === a.pasta)
const de = (lista: UnidadeRascunho[], id: string) => lista.find((x) => x.id === id)!

describe("marcar um agente", () => {
  it("sem regra: põe a pasta dele só neste computador, e ele passa a entrar aqui", () => {
    const lista = [u("alfa")]
    const depois = alternarAgente(lista, "alfa", ana, MAC)!
    expect(de(depois, "alfa").pastas).toEqual([{ computador: MAC, padrao: ana.pasta }])
    expect(linha(depois, "alfa", ana)).toMatchObject({ onde: "alfa", marcado: true, porRegra: null, naoEntra: false, bloqueio: null })
    // o rascunho de antes fica como estava
    expect(lista[0]!.pastas).toEqual([])
  })

  it("em outro projeto pela mesma pasta neste computador: sai de lá e entra aqui; a gravação solta antes", () => {
    const antes = [u("alfa", { pastas: [{ computador: MAC, padrao: ana.pasta }] }), u("beta")]
    expect(linha(antes, "beta", ana)).toMatchObject({ onde: "alfa", ondeNome: "alfa", marcado: false, bloqueio: null })
    const depois = alternarAgente(antes, "beta", ana, MAC)!
    expect(de(depois, "alfa").pastas).toEqual([])
    expect(de(depois, "beta").pastas).toEqual([{ computador: MAC, padrao: ana.pasta }])
    expect(linha(depois, "beta", ana)).toMatchObject({ onde: "beta", marcado: true })
    const passos = planoDeGravar(antes, depois)
    expect(passos[0]).toMatchObject({ id: "alfa", campos: { pastas: [] } })
    expect(passos.findIndex((p) => p.id === "beta")).toBeGreaterThan(0)
  })

  it("no subprojeto, o agente da pasta do projeto passa para o subprojeto", () => {
    const antes = [u("alfa", { pastas: [{ computador: MAC, padrao: ana.pasta }] }), u("vendas", { pai: "alfa", modo: null })]
    expect(linha(antes, "vendas", ana)).toMatchObject({ onde: "alfa", marcado: false })
    const depois = alternarAgente(antes, "vendas", ana, MAC)!
    expect(de(depois, "alfa").pastas).toEqual([])
    expect(linha(depois, "vendas", ana)).toMatchObject({ onde: "vendas", ondeNome: "alfa / vendas", marcado: true })
    // na lista do projeto, a Ana aparece no subprojeto
    expect(linha(depois, "alfa", ana)).toMatchObject({ onde: "vendas", ondeNome: "alfa / vendas", marcado: false })
  })

  it("outro projeto tem a pasta em todos os computadores: não marca, e a linha diz de quem é", () => {
    const lista = [u("alfa", { pastas: [{ computador: null, padrao: ana.pasta }] }), u("beta")]
    expect(alternarAgente(lista, "beta", ana, MAC)).toBeNull()
    expect(linha(lista, "beta", ana)).toMatchObject({ onde: "alfa", bloqueio: "alfa", marcado: false })
  })

  it("não remove neste computador uma regra que vale em todos: ela também vale nos outros", () => {
    const lista = [u("alfa", { pastas: [{ computador: null, padrao: ana.pasta }] })]
    expect(alternarAgente(lista, "alfa", ana, MAC)).toBeNull()
    expect(de(lista, "alfa").pastas).toEqual([{ computador: null, padrao: ana.pasta }])
  })

  it("entra aqui por uma regra mais larga: aparece com a regra, sem caixa marcada", () => {
    const porPasta = [u("alfa", { pastas: [{ computador: MAC, padrao: "/home/x/agentes" }] })]
    expect(linha(porPasta, "alfa", ana)).toMatchObject({ onde: "alfa", marcado: false, porRegra: "/home/x/agentes" })
    const porNome = [u("alfa", { pastas: [{ computador: null, padrao: "agentes" }] })]
    expect(linha(porNome, "alfa", ana)).toMatchObject({ onde: "alfa", marcado: false, porRegra: "agentes" })
    const porTexto = [u("alfa", { titulos: [{ tipo: "titulo", padrao: "vendas", computador: MAC }] })]
    expect(linha(porTexto, "alfa", ana)).toMatchObject({ onde: "alfa", marcado: false, porRegra: "vendas" })
    expect(linha(porTexto, "alfa", bruno)).toMatchObject({ onde: null, porRegra: null })
  })

  it("em outro projeto por regra mais larga: a pasta exata aqui ganha, e o outro projeto não muda", () => {
    const antes = [u("alfa", { pastas: [{ computador: MAC, padrao: "/home/x/agentes" }] }), u("beta")]
    const depois = alternarAgente(antes, "beta", ana, MAC)!
    expect(de(depois, "alfa")).toEqual(antes[0])
    expect(linha(depois, "beta", ana)).toMatchObject({ onde: "beta", marcado: true })
    expect(linha(depois, "beta", bruno)).toMatchObject({ onde: "alfa", marcado: false })
  })

  it("desmarcar tira só a pasta exata daqui, e o agente volta para onde a regra larga manda", () => {
    const antes = [
      u("alfa", { pastas: [{ computador: MAC, padrao: "/home/x/agentes" }] }),
      u("beta", { pastas: [{ computador: MAC, padrao: ana.pasta }, { computador: MAC, padrao: "/outra" }] }),
    ]
    const depois = alternarAgente(antes, "beta", ana, MAC)!
    expect(de(depois, "beta").pastas).toEqual([{ computador: MAC, padrao: "/outra" }])
    expect(linha(depois, "beta", ana)).toMatchObject({ onde: "alfa", marcado: false })
  })

  it("marcar por engano e desmarcar devolve a pasta, com o texto de antes, ao projeto de onde ela saiu", () => {
    const original = { computador: MAC, padrao: `${ana.pasta}/` }
    const antes = [u("alfa", { pastas: [original] }), u("beta")]
    const marcado = alternarAgente(antes, "beta", ana, MAC, antes)!
    expect(de(marcado, "alfa").pastas).toEqual([])
    const desmarcado = alternarAgente(marcado, "beta", ana, MAC, antes)!
    expect(de(desmarcado, "alfa").pastas).toEqual([original])
    expect(de(desmarcado, "beta").pastas).toEqual([])
    expect(linha(desmarcado, "beta", ana)).toMatchObject({ onde: "alfa", marcado: false })
    // nada mudou de verdade: salvar não grava nada
    expect(planoDeGravar(antes, desmarcado)).toEqual([])
  })

  it("desmarcar a pasta que já era daqui antes da edição não a põe em outro projeto", () => {
    const antes = [u("alfa"), u("beta", { pastas: [{ computador: MAC, padrao: ana.pasta }] })]
    const depois = alternarAgente(antes, "beta", ana, MAC, antes)!
    expect(de(depois, "beta").pastas).toEqual([])
    expect(de(depois, "alfa").pastas).toEqual([])
  })

  it("não devolve à origem quando outro projeto já tem a pasta do agente aqui, nem a um projeto que saiu do rascunho", () => {
    const antes = [u("alfa", { pastas: [{ computador: MAC, padrao: ana.pasta }] }), u("beta"), u("gama")]
    const marcado = alternarAgente(antes, "beta", ana, MAC, antes)!
    // a mesma pasta digitada à mão em gama, neste computador
    const comGama = marcado.map((x) => (x.id === "gama" ? { ...x, pastas: [{ computador: MAC, padrao: ana.pasta }] } : x))
    const desmarcado = alternarAgente(comGama, "beta", ana, MAC, antes)!
    expect(de(desmarcado, "alfa").pastas).toEqual([])
    expect(de(desmarcado, "gama").pastas).toEqual([{ computador: MAC, padrao: ana.pasta }])
    const semAlfa = marcado.filter((x) => x.id !== "alfa")
    const desmarcadoSemAlfa = alternarAgente(semAlfa, "beta", ana, MAC, antes)!
    expect(desmarcadoSemAlfa.map((x) => x.id)).toEqual(["beta", "gama"])
    expect(desmarcadoSemAlfa.every((x) => x.pastas.length === 0)).toBe(true)
  })

  it("a pasta de origem em outro computador não volta para este", () => {
    const antes = [u("alfa", { pastas: [{ computador: PC2, padrao: ana.pasta }] }), u("beta")]
    const marcado = alternarAgente(antes, "beta", ana, MAC, antes)!
    expect(de(marcado, "alfa").pastas).toEqual([{ computador: PC2, padrao: ana.pasta }])
    const desmarcado = alternarAgente(marcado, "beta", ana, MAC, antes)!
    expect(de(desmarcado, "alfa").pastas).toEqual([{ computador: PC2, padrao: ana.pasta }])
    expect(de(desmarcado, "beta").pastas).toEqual([])
  })

  it("projeto que não roda neste computador: o agente marcado não entra, e a linha avisa", () => {
    const lista = [u("alfa", { computadores: [PC2], pastas: [{ computador: MAC, padrao: ana.pasta }] })]
    expect(linha(lista, "alfa", ana)).toMatchObject({ marcado: true, onde: null, naoEntra: true, foraDoComputador: true })
    const sub = [u("alfa", { computadores: [PC2] }), u("vendas", { pai: "alfa", modo: null, pastas: [{ computador: MAC, padrao: ana.pasta }] })]
    expect(linha(sub, "vendas", ana)).toMatchObject({ marcado: true, naoEntra: true, foraDoComputador: true })
  })

  it("não move um agente para projeto que não roda neste computador", () => {
    const lista = [u("alfa", { computadores: [PC2] }), u("beta", { pastas: [{ computador: MAC, padrao: ana.pasta }] })]
    expect(alternarAgente(lista, "alfa", ana, MAC)).toBeNull()
    expect(de(lista, "beta").pastas).toEqual([{ computador: MAC, padrao: ana.pasta }])
  })

  it("caminho do Windows, barra no fim e maiúsculas comparam iguais", () => {
    const dora = ag("Dora", "C:\\Users\\X\\Agentes\\Dora")
    const lista = [u("alfa", { pastas: [{ computador: MAC, padrao: "c:/users/x/agentes/dora/" }] })]
    expect(linha(lista, "alfa", dora, [dora])).toMatchObject({ marcado: true, onde: "alfa" })
    expect(de(alternarAgente(lista, "alfa", dora, MAC)!, "alfa").pastas).toEqual([])
  })
})

describe("a lista de agentes", () => {
  it("descarta registros bem mais antigos que a última fotografia do mesmo computador", () => {
    const antigos = [ag("Antigo", "/antigo", MAC, "", "2026-11-24T08:00:00Z"), ana, caio]
    expect(agentesRecentes(antigos).map((a) => a.nome)).toEqual(["Ana", "Caio"])
    // computador sem fotografia nova não perde a lista; data ilegível continua incerta
    expect(agentesRecentes([antigos[0]!, { ...caio, vistoEm: "inválido" }])).toHaveLength(2)
  })
  it("classifica pelo agente do computador certo quando o caminho existe em dois computadores", () => {
    const outro = ag("Outro", ana.pasta, PC2, "Suporte")
    const lista = [
      u("alfa", { titulos: [{ tipo: "titulo", padrao: "Vendas", computador: MAC }] }),
      u("beta", { titulos: [{ tipo: "titulo", padrao: "Suporte", computador: PC2 }] }),
    ]
    const agentes = [outro, ana]
    const classificar = classificadorDoRascunho(lista, agentes)
    expect(classificar(ana.pasta, "", MAC)).toBe("alfa")
    expect(classificar(outro.pasta, "", PC2)).toBe("beta")
  })

  it("só os deste computador, um por pasta (o visto por último), em ordem de nome", () => {
    const velha = { ...ana, titulo: "antigo", vistoEm: "2026-11-20T12:00:00.000Z" }
    const l = linhas([u("alfa")], "alfa", [bruno, velha, caio, ana])
    expect(l.map((x) => x.agente.nome)).toEqual(["Ana", "Bruno"])
    expect(l[0]!.agente.titulo).toBe("Vendas")
  })

  it("a busca olha o nome, o título e onde o agente está, sem ligar para maiúsculas", () => {
    const lista = [u("alfa", { pastas: [{ computador: MAC, padrao: bruno.pasta }] })]
    const l = linhas(lista, "alfa")
    expect(filtrarLinhas(l, "").length).toBe(2)
    expect(filtrarLinhas(l, " ANA ").map((x) => x.agente.nome)).toEqual(["Ana"])
    expect(filtrarLinhas(l, "suporte").map((x) => x.agente.nome)).toEqual(["Bruno"])
    expect(filtrarLinhas(l, "alf").map((x) => x.agente.nome)).toEqual(["Bruno"])
  })

  it("a pasta editada continua na lista mesmo quando coincide com a de um agente", () => {
    const alfa = u("alfa", {
      pastas: [
        { computador: MAC, padrao: ana.pasta },
        { computador: MAC, padrao: "/home/x/agentes/sumiu" },
        { computador: null, padrao: bruno.pasta },
        { computador: PC2, padrao: "/outra" },
      ],
    })
    expect(pastasManuais(alfa, MAC, TODOS).map((p) => [p.indice, p.pasta.padrao])).toEqual([
      [0, ana.pasta],
      [1, "/home/x/agentes/sumiu"],
      [2, bruno.pasta],
    ])
  })
})

describe("a regra por nome ou título", () => {
  it("vazio, repetido ou com caractere de controle não cria; cria só neste computador", () => {
    const lista = [u("alfa")]
    expect(adicionarTexto(lista, "alfa", "   ", MAC)).toBeNull()
    expect(adicionarTexto(lista, "alfa", "a\tb", MAC)).toBeNull()
    const d = adicionarTexto(lista, "alfa", " Vendas ", MAC)!
    expect(de(d, "alfa").titulos).toEqual([{ tipo: "titulo", padrao: "Vendas", computador: MAC }])
    expect(adicionarTexto(d, "alfa", "vendas", MAC)).toBeNull()
    expect(linha(d, "alfa", ana)).toMatchObject({ onde: "alfa", porRegra: "Vendas" })
  })

  it("a prévia mostra quem o texto pega neste computador, pelo nome ou pelo título", () => {
    expect(agentesDoTexto("vend", TODOS, MAC).map((a) => a.nome)).toEqual(["Ana"])
    expect(agentesDoTexto("BRU", TODOS, MAC).map((a) => a.nome)).toEqual(["Bruno"])
    expect(agentesDoTexto(" ", TODOS, MAC)).toEqual([])
  })
})

describe("o aviso de conta livre", () => {
  const c = (id: string, extra: Partial<Conta> = {}): Conta =>
    ({ id, email: `${id}@exemplo.com`, saiEm: null, pausada: false, precisaLogin: false, agenda: [], tetoSemana: null,
      semModelo: [], semModeloConhecido: true, cofreDisponivel: true, lidoEm: "2026-11-25T11:55:00Z", janelas: [{ tipo: "seven_day", pct: 10, resetEm: null }], ...extra }) as Conta
  const estado =
    (mapa: Record<string, EstadoConta> = {}) =>
    (x: Conta): EstadoConta =>
      mapa[x.id] ?? "livre"
  const usados: Usado[] = [
    { pasta: ana.pasta, projeto: "", computadorId: MAC },
    { pasta: "/home/x/outro", projeto: "", computadorId: MAC },
    { pasta: "/home/x/outro", projeto: "", computadorId: MAC },
  ]
  const ligadoComAna = (contas: string[]) => [
    u("alfa", { modo: "ligado", contas, pastas: [{ computador: MAC, padrao: ana.pasta }] }),
  ]
  const agora = new Date("2026-11-25T12:00:00Z")
  const aviso = (lista: UnidadeRascunho[], contas: Conta[], mapa: Record<string, EstadoConta> = {}, us = usados,
    computadores: { id: string; atribuicao: { contaId: string | null } | null }[] = [], trilhas: { contaId: string }[] = []) =>
    avisoContas(lista, contas, estado(mapa), us, classificadorDoRascunho(lista, TODOS), { agora, fuso: "UTC", computadores, trilhas, trilhasConhecidas: true })

  it("sem projeto ligado, não avisa", () => {
    expect(aviso([u("alfa", { modo: "sombra", contas: ["c1"] })], [c("c1")])).toBeNull()
  })

  it("projeto ligado com todas as contas e trabalho fora dele: nenhuma conta fica livre", () => {
    expect(aviso(ligadoComAna(["c1", "c2"]), [c("c1"), c("c2")])).toEqual({ tipo: "nenhuma", fora: 1, livres: 0 })
  })

  it("tudo o que se usa está em projeto ligado: não avisa", () => {
    expect(aviso(ligadoComAna(["c1"]), [c("c1")], {}, [usados[0]!])).toBeNull()
  })

  it("conta saindo não conta como livre", () => {
    expect(aviso(ligadoComAna(["c1"]), [c("c1"), c("c2", { saiEm: "2026-11-25T12:00:00.000Z" })])).toEqual({
      tipo: "nenhuma",
      fora: 1,
      livres: 0,
    })
  })

  it("as livres estão esgotadas, pausadas ou sem login: avisa que estão sem folga", () => {
    const contas = [c("c1"), c("c2"), c("c3"), c("c4")]
    const mapa: Record<string, EstadoConta> = { c2: "esgotada", c3: "pausada", c4: "precisa_login" }
    expect(aviso(ligadoComAna(["c1"]), contas, mapa)).toEqual({ tipo: "semFolga", fora: 1, livres: 3 })
    expect(aviso(ligadoComAna(["c1"]), [...contas, c("c5")], mapa)).toBeNull()
  })

  it("não confirma folga quando a única alternativa já está no aviso de consumo", () => {
    expect(aviso(ligadoComAna(["c1"]), [c("c1"), c("c2")], { c2: "aviso" })).toMatchObject({ tipo: "semFolga" })
  })

  it("uma conta livre ocupada em outro computador não é alternativa para este", () => {
    const lista = ligadoComAna(["c1"])
    const contas = [c("c1"), c("c2", { posse: { computadorId: PC2, motivo: "uso", expiraEm: "2099-01-01T00:00:00Z" } })]
    expect(aviso(lista, contas, { c2: "em_uso" })).toEqual({ tipo: "semFolga", fora: 1, livres: 1 })
  })

  it("não conta como alternativa conta sem leitura, no teto semanal ou sem modelo neste computador", () => {
    const lista = ligadoComAna(["c1"])
    const semLeitura = c("c2", { janelas: [] })
    const teto = c("c3", { tetoSemana: 10 })
    const semModelo = c("c4", { semModelo: [{ computadorId: MAC, modelo: "opus", ate: "2099-01-01T00:00:00Z" }] })
    expect(aviso(lista, [c("c1"), semLeitura, teto, semModelo])).toMatchObject({ tipo: "semFolga", fora: 1 })
  })

  it("não conta atribuição ou trilha já em uso mesmo que a posse esteja vencida", () => {
    const lista = ligadoComAna(["c1"])
    const contas = [c("c1"), c("c2"), c("c3")]
    const computadores = [{ id: PC2, atribuicao: { contaId: "c2" } }]
    expect(aviso(lista, contas, {}, usados, computadores, [{ contaId: "c3" }])).toMatchObject({ tipo: "semFolga" })
  })

  it("respeita a agenda no fuso configurado", () => {
    const lista = ligadoComAna(["c1"])
    const fora = c("c2", { agenda: [{ dias: [3], de: "13:00", ate: "14:00" }] })
    expect(aviso(lista, [c("c1"), fora])).toMatchObject({ tipo: "semFolga" })
    const dentro = c("c2", { agenda: [{ dias: [3], de: "11:00", ate: "13:00" }] })
    expect(aviso(lista, [c("c1"), dentro])).toBeNull()
  })

  it("aceita o início exato de uma agenda com segundos", () => {
    const lista = ligadoComAna(["c1"])
    const conta = c("c2", { agenda: [{ dias: [3], de: "12:00:00", ate: "13:00:00" }] })
    expect(aviso(lista, [c("c1"), conta])).toBeNull()
  })

  it("trata uma leitura velha como insuficiente para confirmar alternativa", () => {
    const lista = ligadoComAna(["c1"])
    const conta = c("c2", { lidoEm: "2026-11-25T11:40:00Z" })
    expect(aviso(lista, [c("c1"), conta])).toMatchObject({ tipo: "semFolga" })
  })

  it("não confirma alternativa quando a leitura das trilhas falhou", () => {
    const lista = ligadoComAna(["c1"])
    expect(avisoContas(lista, [c("c1"), c("c2")], estado(), usados, classificadorDoRascunho(lista, TODOS), {
      agora, fuso: "UTC", computadores: [], trilhas: [], trilhasConhecidas: false,
    })).toMatchObject({ tipo: "semFolga" })
  })

  it("não confirma uma conta sem login no cofre ou com leitura do cofre indisponível", () => {
    const lista = ligadoComAna(["c1"])
    expect(aviso(lista, [c("c1"), c("c2", { cofreDisponivel: false })])).toMatchObject({ tipo: "semFolga" })
    expect(aviso(lista, [c("c1"), c("c2", { cofreDisponivel: null })])).toMatchObject({ tipo: "semFolga" })
  })

  it("não confirma alternativa quando não conseguiu ler restrições de modelo", () => {
    expect(aviso(ligadoComAna(["c1"]), [c("c1"), c("c2", { semModeloConhecido: false })])).toMatchObject({ tipo: "semFolga" })
  })

  it("avisa sobre todas as contas reservadas mesmo sem pastas vistas fora de projeto", () => {
    const lista = ligadoComAna(["c1"])
    expect(aviso(lista, [c("c1")], {}, [usados[0]!], [{ id: MAC, atribuicao: null }])).toMatchObject({ tipo: "nenhuma", fora: 0 })
  })

  it("o subprojeto ligado sem conta própria reserva as do projeto", () => {
    const lista = [u("alfa", { contas: ["c1"] }), u("vendas", { pai: "alfa", modo: "ligado", pastas: [{ computador: MAC, padrao: ana.pasta }] })]
    expect(aviso(lista, [c("c1")])).toEqual({ tipo: "nenhuma", fora: 1, livres: 0 })
  })

  it("o rascunho muda o aviso na hora: desligar o projeto tira o aviso antes de salvar", () => {
    const lista = ligadoComAna(["c1"])
    expect(aviso(lista, [c("c1")])).not.toBeNull()
    expect(aviso([{ ...lista[0]!, modo: "desligado" }], [c("c1")])).toBeNull()
  })
})
