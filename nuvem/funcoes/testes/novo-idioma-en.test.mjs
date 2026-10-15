import assert from "node:assert/strict";
import { test } from "node:test";
import { textoDoEvento } from "../_comum/i18n.ts";

test("em inglês: nome de computador com vírgula e data por extenso", () => {
  const troca = { tipo: "alerta", dados: { motivo: "troca_falhou" }, texto: "No computador Mac, sala 2, a troca para x@exemplo.com não firmou. Confira no painel." };
  assert.equal(textoDoEvento(troca, "en"), "On computer Mac, sala 2, the switch to x@exemplo.com didn't take. Check the panel.");
  const parado = { tipo: "alerta", dados: { motivo: "computador_parado" }, texto: "O computador Mac não dá notícia desde 05/10 14:30." };
  assert.equal(textoDoEvento(parado, "en"), "Computer Mac hasn't checked in since Oct 5, 14:30.");
});
