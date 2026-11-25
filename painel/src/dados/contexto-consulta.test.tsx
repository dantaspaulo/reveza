// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { FonteDemo } from "@/dados/demo"
import { I18nProvider } from "@/i18n"
import { DadosFixos, useConsulta } from "./contexto"

describe("consulta depois de uma gravação", () => {
  it("identifica a leitura nova e não aceita a resposta atrasada da leitura anterior", async () => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    const fonte = new FonteDemo({ atrasoMs: 0, relogio: false })
    const estado = await fonte.carregar()
    const respostas: ((valor: string) => void)[] = []
    let consulta: ReturnType<typeof useConsulta<string>>
    function Tela() {
      consulta = useConsulta(() => new Promise<string>((resolve) => respostas.push(resolve)), [])
      return <span>{consulta.dados}</span>
    }
    const div = document.createElement("div")
    document.body.append(div)
    const raiz = createRoot(div)
    await act(async () => raiz.render(<I18nProvider><DadosFixos fonte={fonte} estado={estado}><Tela /></DadosFixos></I18nProvider>))
    expect(respostas).toHaveLength(1)
    let pedida: number | undefined
    await act(async () => { pedida = consulta.recarregar() })
    expect(pedida).toBe(1)
    expect(respostas).toHaveLength(2)
    await act(async () => respostas[0]!("antigo"))
    expect(consulta!.carregando).toBe(true)
    expect(consulta!.dados).not.toBe("antigo")
    await act(async () => respostas[1]!("atual"))
    expect(consulta!.dados).toBe("atual")
    expect(consulta!.versaoConcluida).toBe(pedida)
    await act(async () => raiz.unmount())
    div.remove()
  })
})
