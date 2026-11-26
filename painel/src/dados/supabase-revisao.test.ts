import { beforeEach, describe, expect, it, vi } from "vitest"

// 0.21.2: o cadastro de projetos leva a revisão lida na nuvem (0048) e a gravação confere no banco que nada mudou
const chamada = vi.hoisted(() => vi.fn())
const tabela = vi.hoisted(() => vi.fn())
vi.mock("./cliente", () => ({
  supabase: () => ({ rpc: chamada, from: tabela }),
  urlSupabase: () => "https://exemplo.invalid",
}))

import { codigoDoErro, FonteSupabase } from "./supabase"

const passos = [{ ref: "novo-1", id: null, campos: { nome: "Alfa" } }]
const REV = "a".repeat(64)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Uma consulta do supabase-js de mentira: select, order e limit devolvem ela mesma, e o await dá a resposta. */
function consulta(log: string[], nome: string) {
  const r = { data: [], error: null }
  const q: Record<string, unknown> = {
    select: () => q,
    order: () => q,
    limit: () => q,
    then: (ok: (v: typeof r) => unknown, falha?: (e: unknown) => unknown) => {
      log.push(`tabela:${nome}`)
      return Promise.resolve(r).then(ok, falha)
    },
  }
  return q
}

describe("revisão do cadastro (0.21.2)", () => {
  beforeEach(() => {
    chamada.mockReset()
    tabela.mockReset()
  })

  it("com revisão, grava pela função segura, com uma operação nova a cada gravação", async () => {
    chamada.mockResolvedValue({ data: { ok: true, ids: { "novo-1": "id-real" } }, error: null })
    await expect(new FonteSupabase().salvarUnidades(passos, REV)).resolves.toEqual({ "novo-1": "id-real" })
    await new FonteSupabase().salvarUnidades(passos, REV)
    const [[nome1, args1], [nome2, args2]] = chamada.mock.calls
    expect(nome1).toBe("painel_unidades_seguro")
    expect(nome2).toBe("painel_unidades_seguro")
    expect(args1).toMatchObject({ p_revisao: REV, p_passos: passos })
    expect(args1.p_operacao).toMatch(UUID)
    expect(args2.p_operacao).not.toBe(args1.p_operacao)
  })

  it("sem revisão (nuvem sem a 0048), grava como antes", async () => {
    chamada.mockResolvedValue({ data: { ok: true, ids: { "novo-1": "id-real" } }, error: null })
    await new FonteSupabase().salvarUnidades(passos)
    expect(chamada).toHaveBeenCalledWith("painel_unidades", { p_passos: passos })
  })

  it("a recusa da 0048 (texto exato) vira cadastro_mudou, recusa comprovada que manda recarregar", async () => {
    expect(codigoDoErro("o cadastro mudou; atualize antes de salvar")).toBe("cadastro_mudou")
    chamada.mockResolvedValueOnce({ data: { ok: false, erro: "o cadastro mudou; atualize antes de salvar" }, error: null })
    await expect(new FonteSupabase().salvarUnidades(passos, REV)).rejects.toMatchObject({
      codigo: "cadastro_mudou",
      recusaConfirmada: true,
    })
  })

  it("lê a revisão antes das tabelas: a revisão nunca é mais nova que o que a tela mostra", async () => {
    const log: string[] = []
    let soltar: (v: unknown) => void = () => {}
    chamada.mockImplementation((nome: string) => {
      log.push(`rpc:${nome}`)
      return new Promise((ok) => {
        soltar = ok
      })
    })
    tabela.mockImplementation((nome: string) => consulta(log, nome))
    const lendo = new FonteSupabase().empresas()
    await Promise.resolve()
    // enquanto a revisão não chega, nenhuma tabela foi pedida
    expect(tabela).not.toHaveBeenCalled()
    soltar({ data: { revisao: REV }, error: null })
    const dados = await lendo
    expect(dados.revisao).toBe(REV)
    expect(log[0]).toBe("rpc:painel_cadastro_revisao")
    expect(log.slice(1).every((l) => l.startsWith("tabela:"))).toBe(true)
  })

  it("nuvem sem a 0048: lê o cadastro sem revisão; falha passageira na revisão derruba a leitura", async () => {
    tabela.mockImplementation((nome: string) => consulta([], nome))
    for (const error of [
      { message: "Could not find the function public.painel_cadastro_revisao without parameters", code: "PGRST202" },
      { message: "function public.painel_cadastro_revisao() does not exist", code: "42883" },
    ]) {
      chamada.mockResolvedValueOnce({ data: null, error })
      const dados = await new FonteSupabase().empresas()
      expect(dados.revisao).toBeUndefined()
    }
    chamada.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch", code: "" } })
    await expect(new FonteSupabase().empresas()).rejects.toBeTruthy()
    chamada.mockResolvedValueOnce({ data: { revisao: "nao-e-hash" }, error: null })
    await expect(new FonteSupabase().empresas()).rejects.toBeTruthy()
  })
})

// Revisão de 26/11: o apagar de projeto também confere a revisão no banco
describe("apagar projeto com a revisão (0.21.2)", () => {
  beforeEach(() => {
    chamada.mockReset()
    tabela.mockReset()
  })

  it("com revisão, apaga pela função segura, com operação nova", async () => {
    chamada.mockResolvedValue({ data: { ok: true }, error: null })
    await new FonteSupabase().apagarEmpresa("e1", REV)
    const [[nome, args]] = chamada.mock.calls
    expect(nome).toBe("painel_empresa_apagar_seguro")
    expect(args).toMatchObject({ p_revisao: REV, p_id: "e1" })
    expect(args.p_operacao).toMatch(UUID)
  })

  it("sem revisão (nuvem sem a 0048), apaga como antes", async () => {
    chamada.mockResolvedValue({ data: { ok: true }, error: null })
    await new FonteSupabase().apagarEmpresa("e1")
    expect(chamada).toHaveBeenCalledWith("painel_empresa_apagar", { p_id: "e1" })
  })

  it("a recusa por leitura velha vira cadastro_mudou comprovada", async () => {
    chamada.mockResolvedValue({ data: { ok: false, erro: "o cadastro mudou; atualize antes de salvar" }, error: null })
    await expect(new FonteSupabase().apagarEmpresa("e1", REV)).rejects.toMatchObject({
      codigo: "cadastro_mudou",
      recusaConfirmada: true,
    })
  })

  it("resposta sem ok:true do apagar seguro não conta como apagado: fica incerta", async () => {
    chamada.mockResolvedValue({ data: null, error: null })
    await expect(new FonteSupabase().apagarEmpresa("e1", REV)).rejects.toMatchObject({
      codigo: "resultado_incerto",
      recusaConfirmada: false,
    })
  })

  it("sem crypto.randomUUID (página fora de https), a operação ainda sai com um identificador válido", async () => {
    chamada.mockResolvedValue({ data: { ok: true, ids: { "novo-1": "id-real" } }, error: null })
    const original = crypto.randomUUID
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true })
    try {
      await new FonteSupabase().salvarUnidades(passos, REV)
      await new FonteSupabase().apagarEmpresa("e1", REV)
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true })
    }
    const [[, a1], [, a2]] = chamada.mock.calls
    expect(a1.p_operacao).toMatch(UUID)
    expect(a2.p_operacao).toMatch(UUID)
    expect(a2.p_operacao).not.toBe(a1.p_operacao)
  })
})
