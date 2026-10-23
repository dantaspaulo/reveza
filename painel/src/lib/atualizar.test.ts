import { describe, expect, it } from "vitest"

import type { Comando, Computador, EstadoNuvem, Evento } from "@/dados/tipos"
import {
  andamentoDaAtualizacao,
  andamentoDeTodos,
  assinarConferencia,
  comecarConferencia,
  conferenciaAtual,
  entendeAssimQueSair,
  faseDaNuvem,
  guardarLeitura,
  guardarPedido,
  limparConferencia,
  painelAtras,
  PEDIDO_ATUALIZAR,
  PEDIDO_CONFERIR,
  pedidoDe,
  pedidoRecente,
  pedidosEmAberto,
  pendenteDaPublicacao,
  PRAZO_DA_CONFERENCIA_MS,
  resultadoDaConferencia,
  versaoDisponivel,
} from "./atualizar"

const AGORA = new Date("2026-10-12T10:00:00.000Z")
const min = (n: number) => new Date(AGORA.getTime() + n * 60_000).toISOString()

const pc = (versao: string, extra: Partial<Computador> = {}): Computador => ({
  id: "pc-1",
  nome: "MacBook",
  sistema: "macos",
  versao,
  vistoEm: AGORA.toISOString(),
  revogado: false,
  criadoEm: min(-1000),
  diagnostico: { em: min(-5), versao, atrasoBuscaMs: 100, itens: [], versaoNova: "0.1.7" },
  atribuicao: null,
  contaPreferidaId: null,
  enxugar: false,
  nomeDoPainel: false,
  ...extra,
})

const cmd = (estado: Comando["estado"], resposta: Record<string, unknown> | null = null): Comando => ({
  id: 9,
  computadorId: "pc-1",
  acao: "atualizar",
  estado,
  criadoEm: min(-2),
  resposta,
})

const ev = (minutos: number, dados: Evento["dados"], tipo: Evento["tipo"] = "info"): Evento => ({
  id: Math.round(1000 + minutos),
  em: min(minutos),
  tipo,
  texto: "",
  dados: { computador: "pc-1", ...dados },
})

describe("botão de atualizar do painel", () => {
  it("o pedido leva só 'a mais nova': nunca endereço nem caminho", () => {
    expect(PEDIDO_ATUALIZAR).toEqual({ versao: "mais_nova" })
  })

  it("versão disponível: a publicada que o agente leu, ou a de outro computador na frente; nada quando já está nela", () => {
    expect(versaoDisponivel(pc("0.1.6"))).toBe("0.1.7")
    expect(versaoDisponivel(pc("0.1.7"))).toBeNull()
    expect(versaoDisponivel(pc("0.1.8"))).toBeNull()
    expect(versaoDisponivel(pc("0.1.6", { diagnostico: null }), "0.1.8")).toBe("0.1.8")
    expect(versaoDisponivel(pc("0.1.6"), "0.1.10")).toBe("0.1.10")
    expect(versaoDisponivel(pc("0.1.6", { diagnostico: null }))).toBeNull()
  })

  it("andamento pelo pedido: pedido, atualizando, voltou na versão nova, ou falhou com o motivo", () => {
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("pendente"), [], AGORA)).toEqual({ fase: "pedido" })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("reservado"), [], AGORA)?.fase).toBe("atualizando")
    const feito = cmd("feito", { ok: true, atualizando: true, de: "0.1.6", para: "0.1.7" })
    expect(andamentoDaAtualizacao(pc("0.1.6"), feito, [], AGORA)).toMatchObject({ fase: "atualizando", para: "0.1.7" })
    expect(andamentoDaAtualizacao(pc("0.1.7"), feito, [], AGORA)).toEqual({ fase: "concluida", para: "0.1.7" })
    const falha = [ev(-1, { atualizacao: "falhou", de: "0.1.6", para: "0.1.7", motivo: "o agente novo não respondeu em 30 s" }, "erro")]
    expect(andamentoDaAtualizacao(pc("0.1.6"), feito, falha, AGORA)).toEqual({
      fase: "falhou",
      motivo: "o agente novo não respondeu em 30 s",
      para: "0.1.7",
    })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("recusado", { ok: false, erro: "já está na versão mais nova (0.1.7)" }), [], AGORA)).toEqual({
      fase: "falhou",
      motivo: "já está na versão mais nova (0.1.7)",
      para: null,
    })
    expect(andamentoDaAtualizacao(pc("0.1.6"), cmd("expirado"), [], AGORA)?.fase).toBe("falhou")
    // agente de versão anterior: o "atualizar" dele só relê as contas
    expect(andamentoDaAtualizacao(pc("0.1.4"), cmd("feito", { ok: true }), [], AGORA)).toEqual({ fase: "sem_suporte" })
  })

  it("sem pedido desta tela (Atualizar todos, outra aba, sozinho de madrugada): pelos eventos e pelo diagnóstico", () => {
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [], AGORA)).toBeNull()
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [ev(-3, { atualizacao: "pedida", de: "0.1.6", para: "0.1.7" })], AGORA)).toMatchObject({
      fase: "atualizando",
      para: "0.1.7",
    })
    expect(andamentoDaAtualizacao(pc("0.1.7"), null, [ev(-1, { atualizacao: "concluida", de: "0.1.6", para: "0.1.7" })], AGORA)).toEqual({
      fase: "concluida",
      para: "0.1.7",
    })
    const comDiag = pc("0.1.6")
    comDiag.diagnostico!.atualizacao = { para: "0.1.7", desde: min(-4) }
    expect(andamentoDaAtualizacao(comDiag, null, [], AGORA)?.fase).toBe("atualizando")
    // velho demais: some da tela
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [ev(-90, { atualizacao: "pedida", de: "0.1.6", para: "0.1.7" })], AGORA)).toBeNull()
    // de outro computador: não conta
    const outro = { ...ev(-1, { atualizacao: "falhou", para: "0.1.7" }), dados: { computador: "pc-2", atualizacao: "falhou", para: "0.1.7" } }
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, [outro], AGORA)).toBeNull()
  })

  it("o pedido desta aba fica guardado para o cartão e a Saúde, e o Atualizar todos não pede de novo por 15 minutos", () => {
    guardarPedido("pc-x", 42, AGORA.getTime())
    expect(pedidoDe("pc-x")).toBe(42)
    expect(pedidoRecente("pc-x", AGORA.getTime() + 14 * 60_000)).toBe(true)
    expect(pedidoRecente("pc-x", AGORA.getTime() + 16 * 60_000)).toBe(false)
    expect(pedidoRecente("pc-y", AGORA.getTime())).toBe(false)
  })

  it("o painel atrás dos computadores aparece (a não ser que a nuvem saiba que o painel no ar é o da versão dela)", () => {
    expect(painelAtras("0.1.6", [pc("0.1.7"), pc("0.1.6")])).toBe("0.1.7")
    expect(painelAtras("0.1.7", [pc("0.1.7")])).toBeNull()
    expect(painelAtras("0.1.7", [pc("0.1.9", { revogado: true })])).toBeNull()
  })
})

describe("a trava de compatibilidade no painel", () => {
  it("o pedido recusado pela trava mostra que a nuvem e o painel vêm primeiro (não 'falhou')", () => {
    const recusado = cmd("recusado", {
      ok: false,
      erro: "a versão 0.1.7 precisa da nuvem e do painel atualizados primeiro: rode a atualização no computador principal",
      precisa_nuvem: true,
      para: "0.1.7",
      faltam: ["0021_nova.sql"],
    })
    expect(andamentoDaAtualizacao(pc("0.1.6"), recusado, [], AGORA)).toEqual({ fase: "precisa_nuvem", para: "0.1.7" })
  })

  it("sem pedido desta tela: pelo aviso do agente, e depois pelo diagnóstico enquanto a trava valer", () => {
    const aviso = [ev(-2, { atualizacao: "precisa_nuvem", de: "0.1.6", para: "0.1.7", sozinho: true, modo: "assim_que_sair" })]
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, aviso, AGORA)).toEqual({ fase: "precisa_nuvem", para: "0.1.7" })
    // a nuvem foi atualizada e ele seguiu: o pedido mais novo vale
    const seguiu = [ev(-1, { atualizacao: "pedida", de: "0.1.6", para: "0.1.7", sozinho: true }), ...aviso]
    expect(andamentoDaAtualizacao(pc("0.1.6"), null, seguiu, AGORA)?.fase).toBe("atualizando")
    // o aviso saiu da janela de 60 minutos, mas o agente segue contando no diagnóstico
    const travado = pc("0.1.6")
    travado.diagnostico!.precisaNuvem = { para: "0.1.7" }
    expect(andamentoDaAtualizacao(travado, null, [], AGORA)).toEqual({ fase: "precisa_nuvem", para: "0.1.7" })
    // já está na versão: nada a mostrar
    const emDia = pc("0.1.7")
    emDia.diagnostico!.precisaNuvem = { para: "0.1.7" }
    expect(andamentoDaAtualizacao(emDia, null, [], AGORA)).toBeNull()
  })
})

describe("Verificar atualização", () => {
  const comando = (id: number, estado: Comando["estado"], resposta: Record<string, unknown> | null = null, computadorId = "pc-1"): Comando => ({
    id,
    computadorId,
    acao: "atualizar",
    estado,
    criadoEm: AGORA.toISOString(),
    resposta,
  })
  const conferido = (mais_nova: string, extra: Record<string, unknown> = {}) => ({ ok: true, conferido: true, atual: "0.1.6", mais_nova, nova: true, ...extra })
  const dois = () => [pc("0.1.6"), pc("0.1.6", { id: "pc-2", nome: "Desktop" })]

  it("o pedido leva só { conferir: true }", () => {
    expect(PEDIDO_CONFERIR).toEqual({ conferir: true })
  })

  it("a rodada guarda o que cada computador respondeu; só os pedidos dela, e só muda quando muda algo", () => {
    let avisos = 0
    const sair = assinarConferencia(() => avisos++)
    comecarConferencia({ "pc-1": 11, "pc-2": 12 }, AGORA.getTime())
    const r0 = conferenciaAtual()!
    expect(avisos).toBe(1)
    expect(pedidosEmAberto(r0, AGORA.getTime())).toEqual([11, 12])
    guardarLeitura(comando(99, "feito", conferido("0.1.7")))
    expect(conferenciaAtual()).toBe(r0)
    guardarLeitura(comando(11, "feito", conferido("0.1.7")))
    const r1 = conferenciaAtual()!
    expect(r1).not.toBe(r0)
    guardarLeitura(comando(11, "feito", conferido("0.1.7")))
    expect(conferenciaAtual()).toBe(r1)
    expect(pedidosEmAberto(r1, AGORA.getTime())).toEqual([12])
    // depois do prazo da nuvem ninguém mais responde: para de ler
    expect(pedidosEmAberto(r1, AGORA.getTime() + PRAZO_DA_CONFERENCIA_MS + 1)).toEqual([])
    sair()
    limparConferencia()
  })

  it("resultados: conferindo, versão disponível, todos em dia, ninguém respondeu", () => {
    const t = AGORA.getTime()
    const rodada = (lidos: Comando[]) => ({ id: 1, em: t, pedidos: { "pc-1": 11, "pc-2": 12 }, lidos: Object.fromEntries(lidos.map((c) => [c.id, c])) })
    expect(resultadoDaConferencia(rodada([comando(11, "feito", conferido("0.1.7"))]), dois(), t)).toEqual({ fase: "conferindo", responderam: 1, total: 2 })
    const ambos = rodada([comando(11, "feito", conferido("0.1.8")), comando(12, "feito", conferido("0.1.8"), "pc-2")])
    expect(resultadoDaConferencia(ambos, dois(), t)).toEqual({ fase: "disponivel", versao: "0.1.8", atras: 2, precisaNuvem: false })
    // um já está na mais nova e o outro atrás
    expect(resultadoDaConferencia(ambos, [pc("0.1.8"), pc("0.1.6", { id: "pc-2" })], t)).toMatchObject({ fase: "disponivel", atras: 1 })
    expect(resultadoDaConferencia(ambos, [pc("0.1.8"), pc("0.1.8", { id: "pc-2" })], t)).toEqual({ fase: "em_dia", versao: "0.1.8" })
    // revogado e identidade pendente não contam
    expect(
      resultadoDaConferencia(ambos, [pc("0.1.8"), pc("0.1.2", { id: "pc-3", revogado: true }), pc("", { id: "pc-4", sistema: "pendente" })], t)
    ).toEqual({ fase: "em_dia", versao: "0.1.8" })
    // ninguém respondeu no prazo da nuvem (desligados no meio)
    expect(resultadoDaConferencia(rodada([comando(11, "expirado")]), dois(), t + PRAZO_DA_CONFERENCIA_MS + 1)).toEqual({ fase: "sem_resposta" })
    // computador de versão anterior recusa o pedido (não sabe conferir): vale o que já se sabe dele
    const antigo = rodada([comando(11, "recusado", { ok: false, erro: "o pedido de atualização só leva a versão" }), comando(12, "expirado")])
    expect(resultadoDaConferencia(antigo, dois(), t + PRAZO_DA_CONFERENCIA_MS + 1)).toEqual({ fase: "disponivel", versao: "0.1.7", atras: 2, precisaNuvem: false })
    // quem sabe conferir (0.2.1 em diante) e não conseguiu (sem acesso ao GitHub): não é "todos em dia"
    const semGithub = rodada([
      comando(11, "recusado", { ok: false, erro: "o GitHub respondeu 403" }),
      comando(12, "recusado", { ok: false, erro: "o GitHub respondeu 403" }, "pc-2"),
    ])
    const novos = [pc("0.3.0"), pc("0.3.0", { id: "pc-2", nome: "Desktop" })]
    expect(resultadoDaConferencia(semGithub, novos, t)).toEqual({ fase: "nao_conferiu", erro: "o GitHub respondeu 403" })
    // um conferiu: vale a conferência dele
    const um = rodada([comando(11, "recusado", { ok: false, erro: "o GitHub respondeu 403" }), comando(12, "feito", conferido("0.3.0"), "pc-2")])
    expect(resultadoDaConferencia(um, novos, t)).toEqual({ fase: "em_dia", versao: "0.3.0" })
  })

  it("a versão achada que precisa da nuvem e do painel primeiro aparece no resultado", () => {
    const t = AGORA.getTime()
    const r = { id: 1, em: t, pedidos: { "pc-1": 11 }, lidos: { 11: comando(11, "feito", conferido("0.1.8", { precisa_nuvem: true })) } }
    expect(resultadoDaConferencia(r, [pc("0.1.6")], t)).toEqual({ fase: "disponivel", versao: "0.1.8", atras: 1, precisaNuvem: true })
  })
})

describe("andamento de todos (o cartão de cima)", () => {
  it("cada computador: na versão, atualizando (a vez é dele), esperando a vez, falhou, esperando a nuvem", () => {
    // agentes da 0.2.1 em diante (contam no diagnóstico que entendem o "assim que sair")
    const novo = (versao: string, extra: Partial<Computador>) => {
      const c = pc(versao, extra)
      c.diagnostico = { ...c.diagnostico!, assimQueSair: true }
      return c
    }
    const pcs = [
      novo("0.1.7", { id: "a", nome: "A" }),
      novo("0.1.6", { id: "b", nome: "B" }),
      novo("0.1.6", { id: "c", nome: "C" }),
      novo("0.1.6", { id: "d", nome: "D" }),
      novo("0.1.6", { id: "e", nome: "E" }),
      novo("0.1.1", { id: "f", nome: "F", revogado: true }),
    ]
    const eventos: Evento[] = [
      { ...ev(-1, { atualizacao: "falhou", para: "0.1.7", motivo: "voltou" }, "erro"), dados: { computador: "d", atualizacao: "falhou", para: "0.1.7", motivo: "voltou" } },
      { ...ev(-1, { atualizacao: "precisa_nuvem", para: "0.1.7" }), dados: { computador: "e", atualizacao: "precisa_nuvem", para: "0.1.7" } },
    ]
    const vez = { computadorId: "b", para: "0.1.7", estado: "em_andamento" as const, desde: min(-3) }
    const linhas = andamentoDeTodos(pcs, "0.1.7", eventos, vez, "assim_que_sair", AGORA)
    expect(linhas.map((l) => [l.pc.id, l.estado])).toEqual([
      ["a", "em_dia"],
      ["b", "atualizando"],
      ["c", "na_fila"],
      ["d", "falhou"],
      ["e", "precisa_nuvem"],
    ])
    // desligada: quem está atrás só tem a versão disponível (ninguém vai sozinho)
    expect(andamentoDeTodos([pcs[2]!], "0.1.7", [], null, "desligada", AGORA)[0]!.estado).toBe("disponivel")
    // um voltou para a anterior: a vez parou, e quem iria sozinho fica "parada" (não "esperando a vez" para sempre)
    const falhou = { computadorId: "b", para: "0.1.7", estado: "falhou" as const, desde: min(-90) }
    expect(andamentoDeTodos([pcs[2]!], "0.1.7", [], falhou, "assim_que_sair", AGORA)[0]!.estado).toBe("parada")
    expect(andamentoDeTodos([pcs[2]!], "0.1.7", [], falhou, "desligada", AGORA)[0]!.estado).toBe("disponivel")
  })

  it("agente de antes da 0.2.1 não entende o 'assim que sair' (precisa do botão), mas vai sozinho de madrugada", () => {
    const antigo = pc("0.1.6", { id: "g", nome: "G" })
    expect(entendeAssimQueSair(antigo)).toBe(false)
    expect(andamentoDeTodos([antigo], "0.1.7", [], null, "assim_que_sair", AGORA)[0]!.estado).toBe("disponivel")
    expect(andamentoDeTodos([antigo], "0.1.7", [], null, "madrugada", AGORA)[0]!.estado).toBe("na_fila")
  })
})

describe("a nuvem e o painel (0.3.0)", () => {
  const nuvem = (extra: Partial<EstadoNuvem> = {}): EstadoNuvem => ({
    versao: "0.3.1",
    atualizacao: null,
    publicado: { funcoes: "0.3.0", painel: "0.3.0" },
    impressoes: {},
    completa: false,
    publicacao: null,
    ...extra,
  })

  it("o que falta publicar: a mesma regra do banco e do agente", () => {
    expect(pendenteDaPublicacao(null)).toEqual({ funcoes: false, painel: false })
    expect(pendenteDaPublicacao(nuvem())).toEqual({ funcoes: true, painel: true })
    const imp = { "0.3.0": { funcoes: "f1", painel: "p1" }, "0.3.1": { funcoes: "f1", painel: "p2" } }
    expect(pendenteDaPublicacao(nuvem({ impressoes: imp }))).toEqual({ funcoes: false, painel: true })
    expect(pendenteDaPublicacao(nuvem({ publicado: { funcoes: "0.4.0", painel: "0.3.1" } }))).toEqual({ funcoes: false, painel: false })
    expect(pendenteDaPublicacao(nuvem({ publicado: { funcoes: null, painel: null } }))).toEqual({ funcoes: true, painel: true })
  })

  it("a fase: desconhecida, atualizando, falhou, publicando, publicação parada, passo manual, esperando e em dia", () => {
    expect(faseDaNuvem(null, AGORA)).toEqual({ fase: "desconhecida" })
    expect(faseDaNuvem(nuvem({ atualizacao: { estado: "atualizando", de: "0.3.0", para: "0.3.2", desde: min(-2), motivo: null } }), AGORA)).toEqual({
      fase: "atualizando",
      versao: "0.3.2",
    })
    // a vez da nuvem venceu (10 minutos): não fica girando para sempre, nem passa por "em dia" na versão de antes
    expect(faseDaNuvem(nuvem({ atualizacao: { estado: "atualizando", de: "0.3.0", para: "0.3.2", desde: min(-11), motivo: null } }), AGORA)).toEqual({
      fase: "interrompida",
      versao: "0.3.2",
    })
    // nuvem de antes da 0.3.0 (sem versão) com a primeira rodada caída: também libera o botão
    expect(faseDaNuvem(nuvem({ versao: null, atualizacao: { estado: "atualizando", de: null, para: "0.3.2", desde: min(-2), motivo: null } }), AGORA).fase).toBe("atualizando")
    expect(faseDaNuvem(nuvem({ versao: null, atualizacao: { estado: "atualizando", de: null, para: "0.3.2", desde: min(-11), motivo: null } }), AGORA).fase).toBe("interrompida")
    expect(faseDaNuvem(nuvem({ atualizacao: { estado: "falhou", de: "0.3.1", para: "0.3.2", desde: min(-2), motivo: "erro x" } }), AGORA)).toEqual({
      fase: "falhou",
      versao: "0.3.2",
      motivo: "erro x",
    })
    // a falha de uma versão que a nuvem já passou não aparece mais
    expect(faseDaNuvem(nuvem({ atualizacao: { estado: "falhou", de: "0.3.0", para: "0.3.1", desde: min(-60), motivo: "x" } }), AGORA).fase).toBe("passo_manual")
    const publicando = nuvem({ completa: true, publicacao: { computadorId: "pc-1", para: "0.3.1", estado: "em_andamento", desde: min(-3), motivo: null } })
    expect(faseDaNuvem(publicando, AGORA)).toEqual({ fase: "publicando", versao: "0.3.1", computadorId: "pc-1" })
    const parada = nuvem({ completa: true, publicacao: { computadorId: "pc-1", para: "0.3.1", estado: "falhou", desde: min(-3), motivo: "403" } })
    expect(faseDaNuvem(parada, AGORA)).toEqual({ fase: "publicacao_falhou", versao: "0.3.1", motivo: "403" })
    expect(faseDaNuvem(nuvem(), AGORA)).toEqual({ fase: "passo_manual", versao: "0.3.1", funcoes: true, painel: true })
    expect(faseDaNuvem(nuvem({ completa: true }), AGORA)).toEqual({ fase: "esperando_publicacao", versao: "0.3.1" })
    expect(faseDaNuvem(nuvem({ publicado: { funcoes: "0.3.1", painel: "0.3.1" } }), AGORA)).toEqual({ fase: "atualizada", versao: "0.3.1" })
  })

  it("o painel atrás: com a nuvem dizendo que o painel no ar está em dia, nada de aviso", () => {
    const emDia = nuvem({ publicado: { funcoes: "0.3.1", painel: "0.3.1" } })
    expect(painelAtras("0.3.0", [pc("0.3.1")], emDia)).toBeNull()
    expect(painelAtras("0.3.0", [pc("0.3.1")], nuvem())).toBe("0.3.1")
    expect(painelAtras("0.3.0", [pc("0.3.1")], null)).toBe("0.3.1")
  })

  it("o painel atrás da nuvem: a nuvem subiu e os computadores ainda não, e o painel não foi junto", () => {
    // a nuvem na 0.3.1 com o painel por publicar, os computadores na versão do painel: o painel está atrás da nuvem
    expect(painelAtras("0.3.0", [pc("0.3.0")], nuvem())).toBe("0.3.1")
    // o painel desta aba já é o da nuvem: nada a dizer
    expect(painelAtras("0.3.1", [pc("0.3.0")], nuvem())).toBeNull()
    // computador na frente da nuvem (não acontece pela trava, mas a mais nova vence)
    expect(painelAtras("0.3.0", [pc("0.3.2")], nuvem())).toBe("0.3.2")
  })
})
