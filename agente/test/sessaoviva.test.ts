// A conversa ainda tem processo vivo? (sessaoviva.ts): a linha de comando do ps, o registro de sessões do assistente
// e o fim da transcrição, que diz se a conversa parou no limite.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parouNoErro, pidsNaTabela, pidsNoRegistro, processoDaSessao } from "../src/sessaoviva.js";

const ID = "d2bf9479-0000-4000-8000-000000000001";
const OUTRO = "d2bf9479-0000-4000-8000-000000000002";

function pasta(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sessaoviva-"));
}

describe("processo vivo da conversa", () => {
  test("pela linha de comando: --resume, -r e --session-id, com espaço ou com =; só o assistente conta", () => {
    const tabela = [
      `  101 /Users/x/.local/bin/claude --resume ${ID} -p A conta anterior bateu o limite`,
      `  102 node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume=${ID} -p continue`,
      `  103 claude -r ${ID}`,
      `  104 /opt/claude/versions/2.1.322 --session-id ${ID} -p oi`,
      `  105 sh -c claude --resume ${ID} -p "x"`,
      `  201 grep -F -- --resume ${ID}`,
      `  202 claude --resume ${OUTRO} -p x`,
      `  203 claude -p ${ID}`,
      `  204 claude --resume ${ID}x -p x`,
      `  300 /usr/local/bin/node /agente/cli.js rodar --resume ${ID}`,
    ].join("\n");
    assert.deepEqual(pidsNaTabela(tabela, ID, 999), [101, 102, 103, 104, 105]);
    assert.deepEqual(pidsNaTabela(tabela, ID, 101), [102, 103, 104, 105], "o próprio processo não conta");
  });

  test("pelo registro do assistente: a conversa certa, viva e, com o ps, ainda do assistente", () => {
    const dir = pasta();
    try {
      const gravar = (n: string, j: unknown) => fs.writeFileSync(path.join(dir, n), typeof j === "string" ? j : JSON.stringify(j));
      gravar("401.json", { pid: 401, sessionId: ID, kind: "interactive", entrypoint: "sdk-cli" });
      gravar("402.json", { pid: 402, sessionId: ID });
      gravar("403.json", { pid: 403, sessionId: OUTRO });
      gravar("404.json", "{ cortado");
      gravar("405.json", { pid: "405", sessionId: ID });
      gravar("406.json", { pid: 406, sessionId: ID });
      gravar("407.key", "não é json");
      const vivo = (pid: number) => pid !== 402;
      assert.deepEqual(pidsNoRegistro(dir, ID, vivo, null, 999).sort(), [401, 406], "sem o ps (Windows): vivo basta");
      // com o ps: o 406 morreu e o número foi para outro programa
      const tabela = "  401 /Users/x/.local/bin/claude -p rodada\n  406 /usr/sbin/outro-programa\n";
      assert.deepEqual(pidsNoRegistro(dir, ID, vivo, tabela, 999), [401]);
      assert.deepEqual(pidsNoRegistro(dir, ID, vivo, tabela, 401), [], "o próprio processo não conta");
      assert.deepEqual(pidsNoRegistro(path.join(dir, "nao-existe"), ID, vivo, null), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("este processo de teste, registrado como uma conversa, é achado de verdade (ps e registro ao lado das transcrições)", () => {
    if (process.platform === "win32") return;
    const base = pasta();
    try {
      const projetos = path.join(base, "projects");
      fs.mkdirSync(projetos);
      fs.mkdirSync(path.join(base, "sessions"));
      // um filho vivo com "claude" na linha de comando, registrado como a conversa
      const filho = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "claude-de-teste"], { stdio: "ignore" });
      try {
        fs.writeFileSync(path.join(base, "sessions", `${filho.pid}.json`), JSON.stringify({ pid: filho.pid, sessionId: ID }));
        assert.equal(processoDaSessao(ID, projetos, false), filho.pid);
        assert.equal(processoDaSessao(OUTRO, projetos, false), null);
      } finally {
        filho.kill();
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test("a conversa parou no limite? a última resposta do assistente diz", () => {
    const projetos = pasta();
    try {
      const dir = path.join(projetos, "-p");
      fs.mkdirSync(dir);
      const gravar = (linhas: unknown[]) => fs.writeFileSync(path.join(dir, `${ID}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const resp = (extra: object = {}) => ({ type: "assistant", sessionId: ID, message: { content: [{ type: "text", text: "x" }] }, ...extra });
      const erro = resp({ isApiErrorMessage: true, error: "rate_limit" });
      gravar([{ type: "user", sessionId: ID }, resp(), erro, { type: "system", subtype: "stop_hook_summary", sessionId: ID }, { type: "queue-operation" }]);
      assert.equal(parouNoErro(projetos, ID), true);
      // depois do limite ela seguiu (o processo releu o login) e terminou
      gravar([{ type: "user", sessionId: ID }, erro, { type: "user", sessionId: ID }, resp()]);
      assert.equal(parouNoErro(projetos, ID), false);
      // a resposta de um subagente não conta como a da conversa
      gravar([{ type: "user", sessionId: ID }, erro, resp({ isSidechain: true })]);
      assert.equal(parouNoErro(projetos, ID), true);
      // sem resposta nenhuma, ou sem transcrição: não dá para saber
      gravar([{ type: "user", sessionId: ID }]);
      assert.equal(parouNoErro(projetos, ID), null);
      assert.equal(parouNoErro(projetos, OUTRO), null);
      // só o fim é lido: a linha cortada no começo do pedaço não atrapalha
      gravar([{ type: "user", sessionId: ID, texto: "y".repeat(5000) }, resp(), erro]);
      assert.equal(parouNoErro(projetos, ID, 3000), true);
    } finally {
      fs.rmSync(projetos, { recursive: true, force: true });
    }
  });
});
