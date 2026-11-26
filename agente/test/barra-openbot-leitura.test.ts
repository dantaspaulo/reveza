// A leitura da barra do OpenBot junto com os agentes (0.22.0): cada agente leva a cadeia de pastas dele; a leitura da
// barra que falha mantém a última boa (nunca tira um agente do projeto); sem leitura boa antes,
// a barra fica vazia com o estado "sem_leitura", sem derrubar a lista dos agentes.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OpenBotLocal, BARRA_ARQUIVO } from "../src/openbot.js";

const SQLITE = "/usr/bin/sqlite3";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const exec = { rodar: async () => ({ codigo: 0, saida: "", erro: "" }), iniciar: () => { throw new Error(); } };

describe("agentes do OpenBot com as pastas da barra", { skip: !fs.existsSync(SQLITE) }, () => {
  test("cada agente leva a cadeia; barra estragada mantém a última boa; sem a barra, sem pasta", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-barra-"));
    try {
      const banco = path.join(d, "openbot.db");
      const barra = path.join(d, BARRA_ARQUIVO);
      const j = (o: unknown) => JSON.stringify(o).replace(/'/g, "''");
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT, agent_json TEXT);" +
          `INSERT INTO projection_agents VALUES ('agent-1', 't1', '${j({ workspacePath: "/Users/x/OpenBot/Agents/agent-1", name: "Um", title: "T" })}'),` +
          `('agent-2', 't2', '${j({ workspacePath: "/Users/x/OpenBot/Agents/agent-2", name: "Dois", title: "" })}');`,
      ]);
      const boa = JSON.stringify({
        version: 2,
        revision: 1,
        sections: [{ id: A, name: "Empresa" }, { id: B, name: "Time", parentId: A }],
        order: [],
        agentAssignments: { "agent-1": B },
        agentOrder: [],
      });
      fs.writeFileSync(barra, boa);
      const antesBanco = fs.statSync(banco).mtimeMs;
      const antesBarra = fs.statSync(barra).mtimeMs;

      const ob = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec);
      const lista = ob.agentes();
      assert.deepEqual(lista, [
        { id: "agent-1", pasta: "/Users/x/OpenBot/Agents/agent-1", nome: "Um", titulo: "T", secoes: [A, B] },
        { id: "agent-2", pasta: "/Users/x/OpenBot/Agents/agent-2", nome: "Dois", titulo: "" },
      ]);
      assert.deepEqual(ob.pastas(), [
        { id: A, nome: "Empresa", pai: null },
        { id: B, nome: "Time", pai: A },
      ]);
      assert.equal(ob.barraEstado(), "ok");
      assert.equal(fs.statSync(barra).mtimeMs, antesBarra, "a barra não foi escrita");

      fs.writeFileSync(barra, boa.slice(0, 40)); // o OpenBot no meio de uma gravação
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B], "estragada: vale a última boa");
      assert.equal(ob.pastas().length, 2);
      assert.equal(ob.barraEstado(), "velha");

      const nova = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec);
      const semBoa = nova.agentes();
      assert.equal(semBoa.length, 2, "sem leitura boa antes: a lista dos agentes vem do mesmo jeito");
      assert.equal(semBoa[0]!.secoes, undefined);
      assert.equal(nova.barraEstado(), "sem_leitura");
      assert.deepEqual(nova.pastas(), []);

      fs.writeFileSync(barra, JSON.stringify({ ...JSON.parse(boa), version: 3 }));
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B], "versão nova do OpenBot: vale a última boa");
      assert.equal(ob.barraEstado(), "velha");

      fs.rmSync(barra);
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B], "o arquivo sumiu depois de uma leitura boa (OpenBot regravando): vale a última");
      assert.equal(ob.barraEstado(), "velha");
      const semBarra = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec);
      assert.equal(semBarra.agentes()[0]!.secoes, undefined, "nunca houve arquivo: ninguém tem pasta, sem erro");
      assert.deepEqual(semBarra.pastas(), []);
      // parte C: sem arquivo desde que ligou não é leitura (o OpenBot pode estar regravando): a nuvem mantém o que tinha
      assert.equal(semBarra.barraEstado(), "sem_leitura");
      fs.writeFileSync(barra, boa);
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B]);
      assert.equal(ob.barraEstado(), "ok", "voltou a ler: não está mais velha");

      assert.equal(fs.statSync(banco).mtimeMs, antesBanco, "o banco não foi escrito");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("aviso do doctor sobre a barra do OpenBot (0.22.0)", () => {
  test("só avisa com a barra que existe e não dá para ler; sem OpenBot, sem a barra ou fora do macOS, nada", async () => {
    const { avisoDaBarra } = (await import("../src/openbot.js")) as { avisoDaBarra?: (home: string, plataforma?: NodeJS.Platform) => string | null };
    assert.equal(typeof avisoDaBarra, "function");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-doctor-barra-"));
    try {
      const pasta = path.join(home, "Library", "Application Support", "OpenBot");
      assert.equal(avisoDaBarra!(home, "darwin"), null, "sem OpenBot");
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(path.join(pasta, "openbot.db"), "");
      assert.equal(avisoDaBarra!(home, "darwin"), null, "sem a barra (ninguém usa pastas)");
      fs.writeFileSync(path.join(pasta, BARRA_ARQUIVO), JSON.stringify({ version: 2, sections: [], agentAssignments: {} }));
      assert.equal(avisoDaBarra!(home, "darwin"), null, "barra boa");
      fs.writeFileSync(path.join(pasta, BARRA_ARQUIVO), "{ pela metade");
      assert.match(avisoDaBarra!(home, "darwin") ?? "", /JSON/);
      fs.writeFileSync(path.join(pasta, BARRA_ARQUIVO), JSON.stringify({ version: 3, sections: [], agentAssignments: {} }));
      assert.match(avisoDaBarra!(home, "darwin") ?? "", /versão desconhecida/);
      assert.equal(avisoDaBarra!(home, "linux"), null, "fora do macOS não há OpenBot");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
