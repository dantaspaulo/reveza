// Remover conta pelo painel (0.12.0, pedido do Paulo em 06/11/2026: "não tem botão para remover conta"). A nuvem tira a
// conta e deixa o registro em contas_removidas; cada computador apaga a cópia do login que guarda dela, também o que
// estava desligado na hora.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { REMOVIDAS_S } from "../src/agente.js";
import { ativaEm, BancoFalso, contaEstacionada, montar, NuvemFalsa, type Montado } from "./falsos.js";

let m: Montado | undefined;
afterEach(() => {
  m?.limpar();
  m = undefined;
});

async function preparar() {
  const banco = new BancoFalso();
  m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
  banco.agora = () => m!.relogio.agora();
  return banco;
}

test("conta removida: sai deste computador com o login e a pasta; a conta em uso fica até a troca", async () => {
  const banco = await preparar();
  const a = await ativaEm(m!, "A", 30, "conta-a");
  const b = contaEstacionada(m!, "B", 10, { contaId: "conta-b" });
  const c = contaEstacionada(m!, "C", 10, { contaId: "conta-c" });
  const pastaB = m!.agente.estado.contas[b]!.pasta;
  banco.removidas.push({ conta_id: "conta-b", email: "b@exemplo.com" }, { conta_id: "conta-a", email: "a@exemplo.com" });
  await m!.agente.esquecerRemovidas();
  const e = m!.agente.estado;
  assert.equal(e.contas[b], undefined);
  assert.equal(fs.existsSync(pastaB), false, "a pasta sai: senão a partida a traria de volta pelo .claude.json");
  assert.equal(m!.cred.d.has(pastaB), false, "o login guardado sai");
  assert.ok(e.contas[a], "a em uso espera a troca que a nuvem faz antes de remover");
  assert.ok(e.contas[c], "a que não foi removida fica");
  assert.match(e.eventos.map((x) => x.texto).join("\n"), /b@exemplo\.com saiu do Reveza pelo painel/);
});

test("confere de 5 em 5 minutos; nuvem sem a função (de antes da 0.12.0) não derruba nada", async () => {
  const banco = await preparar();
  await ativaEm(m!, "A", 30, "conta-a");
  const b = contaEstacionada(m!, "B", 10, { contaId: "conta-b" });
  const nuvem = m!.agente["d"].nuvem as NuvemFalsa;
  nuvem.contasRemovidas = async () => {
    throw new Error("Could not find the function public.agente_contas_removidas");
  };
  await m!.agente.esquecerRemovidas();
  assert.ok(m!.agente.estado.contas[b]);
  nuvem.contasRemovidas = async () => [{ conta_id: "conta-b", email: "b@exemplo.com" }];
  await m!.agente.esquecerRemovidas();
  assert.ok(m!.agente.estado.contas[b], "antes dos 5 minutos não confere de novo");
  await m!.relogio.avancar((REMOVIDAS_S + 1) * 1000);
  await m!.agente.esquecerRemovidas();
  assert.equal(m!.agente.estado.contas[b], undefined);
  void banco;
});

test("a pasta só sai quando está dentro da pasta de contas do Reveza", async () => {
  await preparar();
  await ativaEm(m!, "A", 30, "conta-a");
  const b = contaEstacionada(m!, "B", 10, { contaId: "conta-b" });
  const fora = fs.mkdtempSync(`${m!.c.base}-fora-`);
  try {
    m!.agente.estado.contas[b]!.pasta = fora;
    assert.equal(await m!.agente.trocador.esquecer(b), true);
    assert.equal(fs.existsSync(fora), true, "pasta fora de ~/.reveza/contas não é apagada");
  } finally {
    fs.rmSync(fora, { recursive: true, force: true });
  }
});
