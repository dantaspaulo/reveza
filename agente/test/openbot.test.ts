// O OpenBot: a conversa de agente cortada pelo limite continua pelo próprio OpenBot, só no chat principal do agente.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { consultaDoChatPrincipal, lerIgnorar, OpenBotLocal, pedidoDoTexto } from "../src/openbot.js";
import { ultimoPedido } from "../src/sessaoviva.js";
import type { Executor, Resultado } from "../src/util/executor.js";

const S = "11111111-2222-4333-8444-555555555555";
const SQLITE = "/usr/bin/sqlite3";

function pasta(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-"));
}

describe("OpenBot", () => {
  test("o pedido de verdade: depois do histórico e sem os blocos de instrução da frente", () => {
    assert.equal(pedidoDoTexto("<openbot_turn_style>\numa linha\n</openbot_turn_style>\n[Renovação automática] Troca"), "[Renovação automática] Troca");
    assert.equal(pedidoDoTexto("<a>x</a><b k=\"1\">y</b>  Faça isto"), "Faça isto");
    assert.equal(pedidoDoTexto("antes [Renovação automática]\n--- current message ---\nRevise"), "Revise");
    assert.equal(pedidoDoTexto("Faça <b>isto</b>"), "Faça <b>isto</b>", "bloco no meio do pedido fica");
    assert.equal(pedidoDoTexto(""), "");
  });

  test("a lista de mensagens automáticas: uma por linha, sem vazias e sem comentários; sem arquivo, vazia", () => {
    const d = pasta();
    try {
      const arq = path.join(d, "retomar-ignorar.txt");
      assert.deepEqual(lerIgnorar(arq), []);
      fs.writeFileSync(arq, "# comentário\n\n  [Renovação automática]  \n[Vigia]\n");
      assert.deepEqual(lerIgnorar(arq), ["[Renovação automática]", "[Vigia]"]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("a consulta só aceita o id de uma conversa do assistente", () => {
    assert.equal(consultaDoChatPrincipal("x' OR 1=1 --"), null);
    assert.equal(consultaDoChatPrincipal("../../etc"), null);
    assert.match(consultaDoChatPrincipal(S.toUpperCase())!, new RegExp(`external_session_id = '${S}'`));
  });

  test("o último pedido da conversa: sem resultado de ferramenta, resumo, bastidor nem conversa lateral", () => {
    const d = pasta();
    try {
      const dir = path.join(d, "-proj");
      fs.mkdirSync(dir);
      const linhas = [
        { type: "user", sessionId: S, message: { content: "primeiro pedido" } },
        { type: "assistant", sessionId: S, message: { content: [{ type: "text", text: "ok" }] } },
        { type: "user", sessionId: S, message: { content: [{ type: "text", text: "segundo" }, { type: "text", text: "pedido" }] } },
        { type: "user", sessionId: S, message: { content: [{ type: "tool_result", content: "saída" }] } },
        { type: "user", sessionId: S, isMeta: true, message: { content: "bastidor" } },
        { type: "user", sessionId: S, isSidechain: true, message: { content: "lateral" } },
        { type: "assistant", sessionId: S, isApiErrorMessage: true, message: { content: [{ type: "text", text: "limite" }] } },
      ];
      fs.writeFileSync(path.join(dir, `${S}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
      assert.equal(ultimoPedido(d, S), "segundo\npedido");
      assert.equal(ultimoPedido(d, "22222222-2222-4333-8444-555555555555"), null);
      assert.equal(ultimoPedido(path.join(d, "nao-existe"), S), null);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("a continuação vai pelo comando do OpenBot: o agente, o texto pela entrada e a chave do corte", async () => {
    const chamadas: { argv: string[]; entrada?: string }[] = [];
    const exec: Executor = {
      async rodar(argv, op) {
        chamadas.push({ argv, entrada: op?.entrada });
        return { codigo: 0, saida: "", erro: "" } satisfies Resultado;
      },
      iniciar() {
        throw new Error("não abre processo solto");
      },
    };
    const ob = new OpenBotLocal({ banco: "/x/openbot.db", comando: "/x/openbot-cli.mjs" }, exec, "/x/node");
    assert.equal(await ob.continuar("agent-1", "continue", `reveza-${S}-10`), 0);
    assert.deepEqual(chamadas, [{ argv: ["/x/node", "/x/openbot-cli.mjs", "run", "agent-1", "-", "--id", `reveza-${S}-10`], entrada: "continue" }]);
    assert.equal(await ob.continuar("agent 1; rm", "x", "k"), 2, "agente fora do formato nem chama o comando");
    assert.equal(chamadas.length, 1);
  });

  test("o chat principal, lido do banco do OpenBot só para leitura: a sessão ativa; a antiga, a de outra conversa e a desconhecida não", { skip: !fs.existsSync(SQLITE) }, () => {
    const d = pasta();
    try {
      const banco = path.join(d, "openbot.db");
      const outra = "aaaaaaaa-2222-4333-8444-555555555555";
      const antiga = "bbbbbbbb-2222-4333-8444-555555555555";
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT);" +
          "CREATE TABLE projection_provider_sessions (id TEXT, thread_id TEXT, provider TEXT, external_session_id TEXT, state TEXT);" +
          "INSERT INTO projection_agents VALUES ('agent-1', 't1'), ('agent-2', 't2');" +
          `INSERT INTO projection_provider_sessions VALUES ('p1', 't1', 'claude', '${S}', 'active'),` +
          `('p0', 't1', 'claude', '${antiga}', 'inactive'), ('p2', 't9', 'claude', '${outra}', 'active');`,
      ]);
      const antes = fs.statSync(banco).mtimeMs;
      const ob = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, { rodar: async () => ({ codigo: 0, saida: "", erro: "" }), iniciar: () => { throw new Error(); } });
      assert.equal(ob.chatPrincipal(S), "agent-1");
      assert.equal(ob.chatPrincipal(antiga), null, "conversa antiga do agente (inativa)");
      assert.equal(ob.chatPrincipal(outra), null, "sessão sem agente (rodada de rotina, conversa lateral)");
      assert.equal(ob.chatPrincipal("cccccccc-2222-4333-8444-555555555555"), null);
      assert.equal(ob.chatPrincipal("não é id"), null);
      assert.equal(fs.statSync(banco).mtimeMs, antes, "o banco não foi escrito");
      assert.equal(new OpenBotLocal({ banco: path.join(d, "nao-existe.db"), comando: "/x" }, { rodar: async () => ({ codigo: 0, saida: "", erro: "" }), iniciar: () => { throw new Error(); } }).chatPrincipal(S), null);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
