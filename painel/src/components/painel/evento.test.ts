import { describe, expect, it } from "vitest"

import { traduzirMotivo } from "./evento"

describe("traduzirMotivo", () => {
  const t = ((k: string) => `[${k}]`) as never
  it("traduz o que o banco grava e devolve o resto como veio", () => {
    expect(traduzirMotivo("pedido pelo painel", { t })).toBe("[motivo.manual]")
    expect(traduzirMotivo("pedido pela API", { t })).toBe("[motivo.api]")
    expect(traduzirMotivo("outro motivo", { t })).toBe("outro motivo")
    expect(traduzirMotivo("conta preferida deste computador", { t })).toBe("[motivo.preferida]")
    expect(traduzirMotivo("devolvendo a conta preferida de outro computador", { t })).toBe("[motivo.devolvendo]")
  })
  it("os motivos da 0.12.0 têm texto nos dois idiomas", async () => {
    const { en, pt } = await import("@/i18n/dicionario")
    const { traduzir } = await import("@/i18n/traduzir")
    // sem reserva: a chave que faltar volta como veio (motivo.x) e o teste pega
    const tr = (dic: unknown) => ((k: string, v?: Record<string, string | number>) => traduzir(dic, {}, k, v)) as never
    for (const m of ["a conta em uso foi pausada", "a conta em uso precisa entrar de novo", "a conta em uso foi removida", "chegou a 100%"]) {
      expect(traduzirMotivo(m, { t: tr(pt) })).not.toMatch(/^motivo\./)
      expect(traduzirMotivo(m, { t: tr(en) })).not.toMatch(/^motivo\./)
      // em português o texto é o que o banco grava; em inglês, só sai traduzido se o motivo estiver no mapa
      expect(traduzirMotivo(m, { t: tr(en) })).not.toBe(m)
    }
  })
  it("nome de propriedade herdada não vira chave de tradução (não derruba a tela)", () => {
    for (const m of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(traduzirMotivo(m, { t })).toBe(m)
  })
})

describe("textoEvento do conserto", () => {
  it("monta o texto pelos números do evento, no idioma da tela, sem ler o texto do computador", async () => {
    const { textoEvento } = await import("./evento")
    const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
    const r = textoEvento(
      {
        id: 1,
        em: "2026-10-12T10:00:00.000Z",
        tipo: "info",
        texto: "Conserto pedido pelo painel: <qualquer coisa>",
        dados: { computador: "pc-1", conserto: true, comando: 3, corrigidos: 2, nao_deu: "x" },
      },
      { contas: [], computadores: [{ id: "pc-1", nome: "Desktop" } as never] },
      { t, tx: t, idioma: "pt-BR" } as never
    )
    expect(r.titulo).toContain("evento.conserto")
    expect(r.titulo).toContain("Desktop")
    expect(r.detalhe).toBe('[evento.consertoResumo {"corrigidos":2,"naoDeu":0}]')
  })
})

describe("textoEvento da atualização", () => {
  const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
  const estado = { contas: [], computadores: [{ id: "pc-1", nome: "MacBook" } as never] }
  const evento = (tipo: "info" | "erro" | "alerta", dados: Record<string, unknown>) => ({ id: 1, em: "2026-10-12T10:00:00.000Z", tipo, texto: "x", dados })
  it("de e para são versões (não contas), e a falha traz o motivo", async () => {
    const { textoEvento } = await import("./evento")
    const i = { t, tx: t, idioma: "pt-BR" } as never
    const p = textoEvento(evento("info", { computador: "pc-1", atualizacao: "pedida", de: "0.1.6", para: "0.1.7", sozinho: true }), estado, i)
    expect(p.titulo).toBe('[evento.atualizacaoPedida {"computador":"MacBook","de":"0.1.6","para":"0.1.7"}]')
    expect(p.detalhe).toBe("[evento.atualizacaoSozinho]")
    const f = textoEvento(evento("erro", { computador: "pc-1", atualizacao: "falhou", de: "0.1.6", para: "0.1.7", motivo: "não subiu" }), estado, i)
    expect(f.titulo).toContain("evento.atualizacaoFalhou")
    expect(f.detalhe).toBe("não subiu")
    const a = textoEvento(evento("alerta", { computador: "pc-1", motivo: "atualizacao_falhou", para: "0.1.7" }), estado, i)
    expect(a.titulo).toContain("evento.atualizacaoSozinhoFalhou")
    const lixo = textoEvento(evento("info", { computador: "pc-1", atualizacao: "pedida", de: "<script>", para: "../x" }), estado, i)
    expect(lixo.titulo).toContain('"de":"?","para":"?"')
  })
})

describe("textoEvento da ligação de computador novo", () => {
  const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
  const estado = { contas: [], computadores: [{ id: "pc-1", nome: "MacBook" } as never, { id: "pc-n", nome: "Computador novo" } as never] }
  const evento = (tipo: "info" | "aviso", dados: Record<string, unknown>) => ({ id: 1, em: "2026-10-12T10:00:00.000Z", tipo, texto: "x", dados })
  it("pedido, entrega (por quem) e recusa (com o motivo), sem ler o texto do banco", async () => {
    const { textoEvento } = await import("./evento")
    const i = { t, tx: t, idioma: "pt-BR" } as never
    expect(textoEvento(evento("info", { computador: "pc-n", ligacao: "pedido" }), estado, i).titulo).toBe("[evento.ligacaoPedido]")
    expect(textoEvento(evento("info", { computador: "pc-n", por: "pc-1", ligacao: "entregue" }), estado, i).titulo).toBe('[evento.ligacaoEntregue {"por":"MacBook"}]')
    const r = textoEvento(evento("aviso", { computador: "pc-n", por: "pc-1", ligacao: "recusado", motivo: "codigo_errado" }), estado, i)
    expect(r.titulo).toBe("[evento.ligacaoRecusada]")
    expect(r.detalhe).toBe('[evento.ligacaoMotivo.codigo_errado {"por":"MacBook"}]')
    const lixo = textoEvento(evento("aviso", { por: "pc-1", ligacao: "recusado", motivo: "constructor" }), estado, i)
    expect(lixo.detalhe).toContain("evento.ligacaoMotivo.recusado_na_tela")
  })
})

describe("textoEvento da nuvem e do painel (0.3.0)", () => {
  it("a nuvem atualizada, a publicação e as falhas de cada parte, com o computador pelo nome", async () => {
    const { textoEvento } = await import("./evento")
    const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
    const estado = { contas: [], computadores: [{ id: "pc-1", nome: "Desktop" } as never] }
    const ev = (tipo: string, dados: Record<string, unknown>) =>
      textoEvento({ id: 1, em: "2026-10-12T10:00:00.000Z", tipo: tipo as never, texto: "texto do banco", dados }, estado, { t, tx: t, idioma: "pt-BR" } as never)
    expect(ev("info", { atualizacao_nuvem: "concluida", para: "0.3.1", aplicadas: 2 }).titulo).toBe('[evento.nuvemAtualizada {"para":"0.3.1"}]')
    expect(ev("info", { publicacao: "concluida", para: "0.3.1", computador: "pc-1" }).titulo).toBe('[evento.publicacaoConcluida {"para":"0.3.1","computador":"Desktop"}]')
    expect(ev("alerta", { motivo: "atualizacao_falhou", parte: "nuvem", para: "0.3.1", erro: "x" })).toEqual({
      titulo: '[evento.nuvemFalhou {"para":"0.3.1"}]',
      detalhe: "x",
    })
    expect(ev("alerta", { motivo: "atualizacao_falhou", parte: "publicacao", para: "0.3.1", computador: "pc-1" }).titulo).toBe(
      '[evento.publicacaoFalhou {"para":"0.3.1","computador":"Desktop"}]'
    )
    expect(ev("info", { atualizacao_completa: "desligada", computador: null }).titulo).toMatch(/evento\.completaDesligada/)
  })
})

describe("textoEvento do erro", () => {
  const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
  const estado = { contas: [], computadores: [{ id: "pc-1", nome: "Mac mini" } as never] }
  const ev = (texto: string, dados: Record<string, unknown>) =>
    textoEvento({ id: 1, em: "2026-10-13T17:00:00.000Z", tipo: "erro", texto, dados }, estado, { t, tx: t, idioma: "pt-BR" } as never)
  let textoEvento: typeof import("./evento").textoEvento
  it("mostra o que deu errado, não só onde (antes o texto do computador sumia)", async () => {
    textoEvento = (await import("./evento")).textoEvento
    const r = ev("Não consegui identificar a conta em uso (sem rede?); troca adiada.", { computador: "pc-1" })
    expect(r.titulo).toContain("evento.erro")
    expect(r.titulo).toContain("Mac mini")
    expect(r.detalhe).toBe("Não consegui identificar a conta em uso (sem rede?); troca adiada.")
  })
  it("erro do log: sem o prefixo do agente e com no máximo 200 caracteres; login vencido fica só no título", async () => {
    textoEvento = (await import("./evento")).textoEvento
    expect(ev("Erro no agente: não consegui salvar o estado: ENOSPC", { computador: "pc-1", log: true }).detalhe).toBe("não consegui salvar o estado: ENOSPC")
    expect(ev("Erro no agente: " + "x".repeat(400), { computador: "pc-1", log: true }).detalhe).toHaveLength(200)
    expect(ev("o login venceu", { computador: "pc-1", conta: "c1", motivo: "precisa_login" }).detalhe).toBeNull()
    expect(ev("", { computador: "pc-1" }).detalhe).toBeNull()
    expect(ev("texto", { computador: "pc-1", erro: "o erro de verdade" }).detalhe).toBe("o erro de verdade")
  })
})

describe("textoEvento da troca que não firmou (0.4.5)", () => {
  it("o painel monta o título com as contas que conhece; sem conta, fica genérico", async () => {
    const { textoEvento } = await import("./evento")
    const t = ((k: string, v?: Record<string, unknown>) => `[${k}${v ? ` ${JSON.stringify(v)}` : ""}]`) as never
    const estado = {
      contas: [{ id: "c-a", email: "a@exemplo.com" } as never, { id: "c-b", email: "b@exemplo.com" } as never],
      computadores: [{ id: "pc-1", nome: "MacBook" } as never],
    }
    const ev = (dados: Record<string, unknown>) =>
      textoEvento({ id: 1, em: "2026-10-13T18:00:00.000Z", tipo: "alerta", texto: "texto do banco", dados }, estado, { t, tx: t, idioma: "pt-BR" } as never)
    const r = ev({ motivo: "troca_falhou", computador: "pc-1", de: "c-a", para: "c-b" })
    expect(r.titulo).toContain("evento.trocaFalhou ")
    expect(r.titulo).toContain('"computador":"MacBook"')
    expect(r.titulo).toContain('"para":"b@exemplo.com"')
    expect(r.detalhe).toContain('"de":"a@exemplo.com"')
    const s = ev({ motivo: "troca_falhou", computador: "pc-1", de: null, para: null })
    expect(s.titulo).toContain("evento.trocaFalhouSemConta")
    expect(s.detalhe).toBeNull()
  })
})
