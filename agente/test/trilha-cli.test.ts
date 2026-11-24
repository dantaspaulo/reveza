// reveza trilha (0.21.0): a pergunta do lançador chega ao agente com a pasta e o processo, a pergunta de novo da espera
// vai marcada, e a falta de resposta da ponte tem saída própria (o lançador segue esperando em vez de abrir na principal).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { executarCli, lerArgs, type Ambiente } from "../src/cli.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import { ApiFalsa, CliFalsa, ExecutorFalso, pastaTemporaria, RelogioFalso } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria> | undefined;
let servidor: http.Server | undefined;
afterEach(async () => {
  tmp?.limpar();
  tmp = undefined;
  if (servidor) await new Promise<void>((ok) => servidor!.close(() => ok()));
  servidor = undefined;
});

function ambiente(porta: number): Ambiente & { saidas: string[]; erros: string[] } {
  tmp = pastaTemporaria();
  const saidas: string[] = [];
  const erros: string[] = [];
  const guarda = new GuardaFalsa();
  return {
    c: tmp.c,
    sistema: "macos",
    exec: new ExecutorFalso(),
    relogio: new RelogioFalso(),
    saida: (t) => saidas.push(t),
    erro: (t) => erros.push(t),
    perguntar: async () => "",
    env: { REVEZA_PORTA: String(porta) },
    script: "/app/cli.js",
    fabricas: { cred: () => new CredenciaisFalsas(), guarda: async () => guarda, api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => null },
    saidas,
    erros,
  };
}

/** Uma ponte de mentira: guarda o corpo de cada pergunta e responde o que o teste mandar. */
async function ponte(status: number, corpo: unknown): Promise<{ porta: number; recebidos: Record<string, unknown>[] }> {
  const recebidos: Record<string, unknown>[] = [];
  servidor = http.createServer((req, res) => {
    let t = "";
    req.on("data", (p) => (t += p));
    req.on("end", () => {
      recebidos.push(JSON.parse(t || "{}"));
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(corpo));
    });
  });
  await new Promise<void>((ok) => servidor!.listen(0, "127.0.0.1", () => ok()));
  return { porta: (servidor.address() as AddressInfo).port, recebidos };
}

describe("reveza trilha", () => {
  test("--cwd e --pid levam o valor, e --de-novo é uma marca", () => {
    const a = lerArgs(["trilha", "--cwd", "/x/y", "--pid", "123", "--de-novo"]);
    assert.deepEqual(a.pos, ["trilha"]);
    assert.equal(a.flags.cwd, "/x/y");
    assert.equal(a.flags.pid, "123");
    assert.equal(a.flags["de-novo"], true);
  });

  test("a pergunta chega ao agente com a pasta e o processo; a de novo vai marcada", async () => {
    const p = await ponte(200, { ok: true, trilha: null, bloqueio: "Alfa: a conta deste projeto não está livre agora." });
    const amb = ambiente(p.porta);
    const pasta = tmp!.dir;
    assert.equal(await executarCli(["trilha", "--cwd", pasta, "--pid", "4321"], amb), 3);
    assert.equal(await executarCli(["trilha", "--cwd", pasta, "--pid", "4321", "--de-novo"], amb), 3);
    assert.deepEqual(p.recebidos[0], { cwd: pasta, pid: 4321 }, "o primeiro pedido segue como antes");
    assert.deepEqual(p.recebidos[1], { cwd: pasta, pid: 4321, deNovo: true });
    assert.deepEqual(amb.saidas, ["Alfa: a conta deste projeto não está livre agora.", "Alfa: a conta deste projeto não está livre agora."]);
  });

  test("sem resposta da ponte, ou resposta de erro, sai 4 e não escreve trilha", async () => {
    const amb = ambiente(1);
    assert.equal(await executarCli(["trilha", "--cwd", tmp!.dir, "--pid", "4321"], amb), 4);
    assert.deepEqual(amb.saidas, []);
    tmp!.limpar();
    const p = await ponte(500, { ok: false });
    const amb2 = ambiente(p.porta);
    assert.equal(await executarCli(["trilha", "--cwd", tmp!.dir, "--pid", "4321", "--de-novo"], amb2), 4);
    assert.deepEqual(amb2.saidas, []);
  });

  test("a resposta sem trilha (a principal) segue saindo 0, sem nada escrito", async () => {
    const p = await ponte(200, { ok: true, trilha: null });
    const amb = ambiente(p.porta);
    assert.equal(await executarCli(["trilha", "--cwd", tmp!.dir, "--pid", "4321"], amb), 0);
    assert.deepEqual(amb.saidas, []);
  });
});
