// Só as partes puras da FonteSupabase. As chamadas ao banco ficam para os testes com um banco de pé para o painel.
import { describe, expect, it } from "vitest"

import { rotuloDestino } from "./rotulos"
import {
  CHAVES_CONFIG,
  CONFIG_PADRAO,
  codigoDoErro,
  estadoDoCanal,
  faseDaLigacao,
  modoAtualizar,
  paraDiagnostico,
  paraNuvem,
  paraVez,
  valorDoModo,
} from "./supabase"

describe("FonteSupabase (partes puras)", () => {
  it("o canal de tempo real conta se está ligado ou caiu; os outros estados não mudam nada", () => {
    expect(estadoDoCanal("SUBSCRIBED")).toBe("ligado")
    expect(estadoDoCanal("CHANNEL_ERROR")).toBe("caiu")
    expect(estadoDoCanal("TIMED_OUT")).toBe("caiu")
    expect(estadoDoCanal("CLOSED")).toBe("caiu")
    expect(estadoDoCanal("JOINING")).toBeNull()
  })

  it("mensagens das funções do banco viram códigos traduzíveis", () => {
    expect(codigoDoErro("confirme a verificação em duas etapas")).toBe("precisa_aal2")
    expect(codigoDoErro("só administrador")).toBe("sem_permissao")
    expect(codigoDoErro("o aviso precisa ser menor que a troca")).toBe("aviso_maior_que_troca")
    expect(codigoDoErro("rodízio de 15 a 480 minutos")).toBe("rodizio_fora")
    expect(codigoDoErro("a conta está em uso em outro computador")).toBe("conta_ocupada")
    expect(codigoDoErro("conta sem login guardado")).toBe("conta_precisa_login")
    expect(codigoDoErro("o último administrador não pode deixar de ser administrador")).toBe("ultimo_admin")
    expect(codigoDoErro("qualquer coisa", "42501")).toBe("sem_permissao")
    expect(codigoDoErro("qualquer coisa")).toBe("falha")
  })

  it("chaves de configuração e padrões iguais aos do banco", () => {
    expect(Object.values(CHAVES_CONFIG).sort()).toEqual(
      [
        "atualizar_sozinho",
        "auto",
        "aviso",
        "espera_entre_trocas_s",
        "exigir_duas_etapas",
        "fuso",
        "intervalo_s",
        "modo",
        "retomar_terminal",
        "rodizio_minutos",
        "rodizio_ordem",
        "troca",
      ].sort()
    )
    expect(CONFIG_PADRAO).toMatchObject({
      auto: false,
      modo: "limiar",
      aviso: 90,
      troca: 95,
      rodizioOrdem: "aleatoria",
      atualizarSozinho: "desligada",
    })
  })

  it("atualizar sozinho: o true de antes é de madrugada, e o painel grava false e true para os jeitos de antes", () => {
    expect(modoAtualizar(true)).toBe("madrugada")
    expect(modoAtualizar("madrugada")).toBe("madrugada")
    expect(modoAtualizar("assim_que_sair")).toBe("assim_que_sair")
    for (const v of [false, undefined, null, "desligada", "sempre", 1]) expect(modoAtualizar(v)).toBe("desligada")
    // os agentes de antes da 0.2.1 só entendem true: de madrugada continua sendo true no banco
    expect(valorDoModo("desligada")).toBe(false)
    expect(valorDoModo("madrugada")).toBe(true)
    expect(valorDoModo("assim_que_sair")).toBe("assim_que_sair")
  })

  it("a vez de atualizar sozinho (escrita pelo banco) só entra conferida", () => {
    const desde = "2026-10-12T10:00:00.000Z"
    expect(paraVez({ computador: "pc-1", de: "0.2.0", para: "0.2.1", desde, estado: "em_andamento" })).toEqual({
      computadorId: "pc-1",
      para: "0.2.1",
      estado: "em_andamento",
      desde,
    })
    for (const mau of [null, "x", [], { computador: "pc-1", para: "https://x", desde, estado: "em_andamento" }, { computador: "pc-1", para: "0.2.1", desde: "lixo", estado: "em_andamento" }, { computador: "pc-1", para: "0.2.1", desde, estado: "qualquer" }])
      expect(paraVez(mau)).toBeNull()
  })

  it("o rótulo do destino de um alerta nunca mostra segredo", () => {
    expect(rotuloDestino("telegram", { chat_id: "123", bot_token: "segredo" })).toBe("chat 123")
    // canal que saiu (ntfy, 12/10/2026) ou desconhecido: sem rótulo, nunca o destino cru
    expect(rotuloDestino("ntfy", { servidor: "https://ntfy.sh", vault_id: "x" })).toBe("")
    expect(rotuloDestino("webhook", { url: "https://n8n.exemplo.com/webhook/x?token=segredo", segredo: "s" })).toBe(
      "n8n.exemplo.com/webhook/x"
    )
    expect(rotuloDestino("email", { para: "a@exemplo.com", de: "b@exemplo.com" })).toBe("a@exemplo.com")
  })
})

describe("diagnóstico do agente", () => {
  it("o formato que o agente manda vira o das telas (hora em segundos, conferências com situação)", () => {
    const d = paraDiagnostico(
      { em: 1791700000, conferencias: [{ id: "agente", nome: "Agente", situacao: "ok", detalhe: "versão 0.1.0" }, { id: "mod", nome: "Mod", situacao: "aviso", detalhe: "não carregado" }, { id: "nuvem", nome: "Nuvem", situacao: "falha", detalhe: "não responde" }] },
      "0.1.0"
    )!
    expect(d.em).toBe(new Date(1791700000 * 1000).toISOString())
    expect(d.itens.map((i) => i.ok)).toEqual([true, null, false])
    expect(d.itens[0]).toMatchObject({ nome: "Agente", detalhe: "versão 0.1.0" })
    expect(paraDiagnostico({ em: "lixo" }, "1")).toBeNull()
    // escrito por um computador comprometido: não derruba o painel de ninguém
    expect(paraDiagnostico({ em: 1e20 }, "1")).toBeNull()
    expect(paraDiagnostico({ em: -1e17 }, "1")).toBeNull()
    expect(paraDiagnostico({ em: 1760000000, itens: [null, 7, [], { id: "a", ok: true }] }, "1")?.itens).toEqual([
      { id: "a", ok: true, detalhe: undefined },
    ])
    expect(paraDiagnostico(null, "1")).toBeNull()
  })

  it("a trava que o agente conta (a versão nova precisa da nuvem): só X.Y.Z", () => {
    expect(paraDiagnostico({ em: 1791700000, conferencias: [], precisaNuvem: { para: "0.2.1" } }, "0.2.0")?.precisaNuvem).toEqual({ para: "0.2.1" })
    expect(paraDiagnostico({ em: 1791700000, conferencias: [], precisaNuvem: { para: "<b>" } }, "0.2.0")?.precisaNuvem).toBeNull()
    expect(paraDiagnostico({ em: 1791700000, conferencias: [] }, "0.2.0")?.precisaNuvem).toBeNull()
    // o agente da 0.2.1 conta que entende o "assim que sair"; o de antes, não
    expect(paraDiagnostico({ em: 1791700000, conferencias: [], assimQueSair: true }, "0.2.1")?.assimQueSair).toBe(true)
    expect(paraDiagnostico({ em: 1791700000, conferencias: [] }, "0.2.0")?.assimQueSair).toBe(false)
  })
})

describe("andamento da ligação de computador novo (ligacao_pedidos, 0019)", () => {
  const agora = new Date("2026-10-12T12:00:00Z")
  const pendente = { sistema: "pendente", revogado: false }
  it("cada fase pelo que a nuvem gravou", () => {
    const fase = (p: Record<string, unknown> | null, c: Record<string, unknown> | null = pendente) => faseDaLigacao(p, c, agora).fase
    expect(fase(null)).toBe("esperando_pedido")
    expect(fase({ aprovador: "pc-1" })).toBe("esperando_pedido")
    expect(fase({ pedido_em: "2026-10-12T11:58:00Z", expira_em: "2026-10-12T12:08:00Z" })).toBe("esperando_codigo")
    expect(fase({ pedido_em: "2026-10-12T11:48:00Z", expira_em: "2026-10-12T11:58:00Z" })).toBe("vencido")
    expect(fase({ pedido_em: "2026-10-12T11:58:00Z", expira_em: "2026-10-12T12:08:00Z", entregue_em: "2026-10-12T11:59:00Z" })).toBe("entregue")
    expect(fase({ pedido_em: "x", entregue_em: "x", lido_em: "x" }, { sistema: "linux", revogado: false })).toBe("ligado")
    const r = faseDaLigacao({ pedido_em: "x", recusado: "dois_pedidos", aprovador: "pc-1" }, pendente, agora)
    expect(r).toEqual({ fase: "recusado", motivo: "dois_pedidos", aprovadorId: "pc-1", expiraEm: null })
  })

  it("as mensagens novas da nuvem viram códigos traduzíveis", () => {
    expect(codigoDoErro("dois pedidos de ligação ao mesmo tempo: recusei os dois; gere de novo no painel")).toBe("ligacao_dupla")
    expect(codigoDoErro("computador novo desconhecido ou revogado")).toBe("computador_revogado")
    expect(codigoDoErro("outro computador já prefere esta conta")).toBe("preferida_de_outro")
    expect(codigoDoErro("modelo inválido")).toBe("modelo_invalido")
    expect(codigoDoErro("computador desconhecido")).toBe("computador_revogado")
  })

  it("a nuvem e o painel (0021): só o que a tela usa, conferido; nuvem de antes da 0.3.0 vem sem versão", () => {
    expect(paraNuvem(new Map())).toEqual({
      versao: null,
      atualizacao: null,
      publicado: { funcoes: null, painel: null },
      impressoes: {},
      completa: false,
      publicacao: null,
    })
    const n = paraNuvem(
      new Map<string, unknown>([
        ["nuvem_versao", "0.3.1"],
        ["nuvem_atualizacao", { estado: "falhou", de: "0.3.0", para: "0.3.2", desde: "2026-10-12T10:00:00Z", motivo: "x".repeat(400) }],
        ["publicado", { funcoes: "0.3.0", painel: "lixo", em: "2026-10-12T10:00:00Z" }],
        ["impressoes", { "0.3.1": { funcoes: "a", painel: "b" }, "nao-versao": { funcoes: "c" } }],
        ["atualizacao_completa", { ligada: true }],
        ["publicacao_vez", { computador: "pc-1", para: "0.3.1", estado: "em_andamento", desde: "2026-10-12T10:00:00Z" }],
      ])
    )
    expect(n.versao).toBe("0.3.1")
    expect(n.atualizacao?.estado).toBe("falhou")
    expect(n.atualizacao?.motivo?.length).toBe(300)
    expect(n.publicado).toEqual({ funcoes: "0.3.0", painel: null })
    expect(Object.keys(n.impressoes)).toEqual(["0.3.1"])
    expect(n.completa).toBe(true)
    expect(n.publicacao).toEqual({ computadorId: "pc-1", para: "0.3.1", estado: "em_andamento", desde: "2026-10-12T10:00:00Z", motivo: null })
    expect(paraNuvem(new Map([["publicacao_vez", { para: "x", estado: "em_andamento" }]])).publicacao).toBeNull()
  })
})
