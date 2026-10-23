// O login do assistente no Gerenciador de Credenciais do Windows (relato de um usuário, 23/10/2026): a troca pelo
// arquivo não vale nas sessões. O agente confere de 10 em 10 minutos e avisa quando isso liga (e quando volta).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { montar, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const marca = (ligada: boolean) => fs.writeFileSync(m.c.claudeJson, JSON.stringify({ cachedGrowthBookFeatures: { tengu_windows_credman: ligada } }));
const avisos = () => m.agente.estado.eventos.filter((e) => /Gerenciador de Credenciais|arquivo de credenciais/.test(e.texto));

describe("login do assistente no Windows", () => {
  test("liga: um evento de erro (vai ao painel), uma vez; volta: um aviso de que a troca vale de novo", async () => {
    m = await montar({ sistema: "windows" });
    marca(true);
    await m.agente.ciclo();
    assert.equal(avisos().length, 1);
    assert.equal(avisos()[0]!.tipo, "erro");
    m.relogio.t += 601;
    await m.agente.ciclo();
    assert.equal(avisos().length, 1, "não repete enquanto segue ligado");
    marca(false);
    m.relogio.t += 601;
    await m.agente.ciclo();
    assert.equal(avisos().length, 2);
    assert.equal(avisos()[0]!.tipo, "info");
  });

  test("fora do Windows não confere nada", async () => {
    m = await montar({ sistema: "macos" });
    marca(true);
    await m.agente.ciclo();
    assert.equal(avisos().length, 0);
  });
});
