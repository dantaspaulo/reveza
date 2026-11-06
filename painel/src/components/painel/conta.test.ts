import { describe, expect, it } from "vitest"

import { nivelUso } from "./conta"

describe("nivelUso (cores da barra, 0.13.0)", () => {
  it("normal até 15 pontos antes do aviso, âmbar daí até o aviso e vermelho do aviso para cima", () => {
    expect(nivelUso(74.9, 90)).toBe("normal")
    expect(nivelUso(75, 90)).toBe("atencao")
    expect(nivelUso(89.9, 90)).toBe("atencao")
    expect(nivelUso(90, 90)).toBe("alerta")
    expect(nivelUso(100, 90)).toBe("alerta")
  })
  it("sem leitura ou sem o aviso, fica no normal", () => {
    expect(nivelUso(null, 90)).toBe("normal")
    expect(nivelUso(99, undefined)).toBe("normal")
  })
})
