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
      // revisão 2: a pasta de cada agente não se sabe (null), e não "sem pasta"
      assert.equal(semBoa[0]!.secoes, null);
      assert.equal(semBoa[1]!.secoes, null);
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
      // revisão 2: o OpenBot grava a barra num temporário e troca pelo nome (não some ao regravar); sem o arquivo e sem
      // pastas conhecidas antes, é a barra vazia, na hora
      assert.equal(semBarra.barraEstado(), "ok");
      fs.writeFileSync(barra, boa);
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B]);
      assert.equal(ob.barraEstado(), "ok", "voltou a ler: não está mais velha");

      assert.equal(fs.statSync(banco).mtimeMs, antesBanco, "o banco não foi escrito");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("revisão: antes da primeira leitura boa não está ok; o arquivo que falta vira barra vazia depois de uma folga", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-barra-"));
    try {
      const banco = path.join(d, "openbot.db");
      const barra = path.join(d, BARRA_ARQUIVO);
      let t = 1_000_000;
      const agora = () => t;
      // a leitura dos agentes que falha antes da barra (banco trancado ou estranho) não pode valer como barra lida: a
      // lista vazia das pastas apagaria as da nuvem
      fs.writeFileSync(banco, "isto não é um banco do OpenBot");
      const quebrado = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec, process.execPath, SQLITE, agora);
      assert.equal(quebrado.barraEstado(), "sem_leitura", "antes da primeira leitura");
      assert.throws(() => quebrado.agentes());
      assert.equal(quebrado.barraEstado(), "sem_leitura", "a leitura dos agentes falhou antes da barra");
      fs.rmSync(banco);

      const j = (o: unknown) => JSON.stringify(o).replace(/'/g, "''");
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT, agent_json TEXT);" +
          `INSERT INTO projection_agents VALUES ('agent-1', 't1', '${j({ workspacePath: "/Users/x/OpenBot/Agents/agent-1", name: "Um", title: "T" })}');`,
      ]);
      const boa = JSON.stringify({
        version: 2,
        sections: [{ id: A, name: "Empresa" }, { id: B, name: "Time", parentId: A }],
        agentAssignments: { "agent-1": B },
      });
      const ob = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec, process.execPath, SQLITE, agora);
      // revisão 2 (medido no OpenBot: a barra é trocada pelo nome, não some ao regravar): sem o arquivo e sem pastas
      // conhecidas, é a barra vazia na hora
      assert.equal(ob.agentes()[0]!.secoes, undefined);
      assert.equal(ob.barraEstado(), "ok");
      assert.deepEqual(ob.pastas(), []);

      fs.writeFileSync(barra, boa);
      t += 1_000;
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B]);
      assert.equal(ob.pastas().length, 2);
      // sem o arquivo depois de uma leitura com pastas (o OpenBot pôs de lado uma barra estragada): vale a última, sem prazo
      fs.rmSync(barra);
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B], "sumiu: vale a última");
      assert.equal(ob.barraEstado(), "velha");
      t += 3_600_000;
      assert.deepEqual(ob.agentes()[0]!.secoes, [A, B], "uma hora depois: segue valendo a última");
      assert.equal(ob.barraEstado(), "velha");
      assert.equal(ob.pastas().length, 2);

      // a última leitura boa sem pastas: sem o arquivo, barra vazia na hora
      fs.writeFileSync(barra, JSON.stringify({ version: 2, sections: [], agentAssignments: {} }));
      ob.agentes();
      assert.equal(ob.barraEstado(), "ok");
      fs.rmSync(barra);
      assert.equal(ob.agentes()[0]!.secoes, undefined);
      assert.equal(ob.barraEstado(), "ok");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("revisão 2: a última barra boa vai ao disco e volta ao religar; o agente que não estava nela fica sem saber (null)", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-barra-"));
    try {
      const banco = path.join(d, "openbot.db");
      const barra = path.join(d, BARRA_ARQUIVO);
      const guardado = path.join(d, "reveza", "openbot-barra.json");
      const j = (o: unknown) => JSON.stringify(o).replace(/'/g, "''");
      const agente = (id: string, nome: string) => `('${id}', 't', '${j({ workspacePath: `/Users/x/OpenBot/Agents/${id}`, name: nome, title: "" })}')`;
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT, agent_json TEXT);" +
          `INSERT INTO projection_agents VALUES ${agente("agent-1", "Um")}, ${agente("agent-2", "Dois")};`,
      ]);
      fs.writeFileSync(barra, JSON.stringify({ version: 2, sections: [{ id: A, name: "Empresa" }, { id: B, name: "Time", parentId: A }], agentAssignments: { "agent-1": B } }));
      const novo = (t: () => number = Date.now) => new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec, process.execPath, SQLITE, t, guardado);

      const ob = novo();
      ob.agentes();
      assert.equal(ob.barraEstado(), "ok");
      assert.ok(fs.existsSync(guardado), "a leitura boa foi guardada");
      assert.equal(fs.statSync(guardado).mode & 0o777, 0o600);
      // a mesma barra não regrava o guardado
      const passado = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000); // segundo inteiro: o disco guarda o mtime sem a fração
      fs.utimesSync(guardado, passado, passado);
      ob.agentes();
      assert.equal(fs.statSync(guardado).mtimeMs, passado.getTime(), "nada mudou: não regrava");

      // religa com a barra estragada e um agente novo no banco
      execFileSync(SQLITE, [banco, `INSERT INTO projection_agents VALUES ${agente("agent-3", "Três")};`]);
      fs.writeFileSync(barra, "{ pela metade");
      const religado = novo();
      assert.equal(religado.barraEstado(), "velha", "nasce com a última boa, antes de ler");
      assert.equal(religado.pastas().length, 2);
      const lista = religado.agentes();
      assert.deepEqual(lista.map((a) => [a.id, a.secoes]), [
        ["agent-1", [A, B]],
        ["agent-2", undefined],
        ["agent-3", null],
      ], "quem estava segue com a pasta (ou sem pasta); o novo não se sabe");
      assert.equal(religado.barraEstado(), "velha");

      // guardado estragado: ignorado, como se não houvesse
      fs.writeFileSync(guardado, "{ estragado");
      const semGuardado = novo();
      assert.equal(semGuardado.barraEstado(), "sem_leitura");
      assert.deepEqual(semGuardado.agentes().map((a) => a.secoes), [null, null, null]);
      assert.equal(fs.readFileSync(guardado, "utf8"), "{ estragado", "a leitura que falhou não regrava o guardado");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("revisão 2: um relógio só para a falha (desde a primeira leitura ruim depois da boa, ou desde ligar)", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-barra-"));
    try {
      const banco = path.join(d, "openbot.db");
      const barra = path.join(d, BARRA_ARQUIVO);
      const j = (o: unknown) => JSON.stringify(o).replace(/'/g, "''");
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT, agent_json TEXT);" +
          `INSERT INTO projection_agents VALUES ('agent-1', 't1', '${j({ workspacePath: "/Users/x/OpenBot/Agents/agent-1", name: "Um", title: "" })}');`,
      ]);
      let t = 5_000_000;
      const ob = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec, process.execPath, SQLITE, () => t);
      assert.equal(ob.barraFalhaHaMs(), 0, "conta desde ligar");
      t += 4_000;
      assert.equal(ob.barraFalhaHaMs(), 4_000);
      fs.writeFileSync(barra, JSON.stringify({ version: 2, sections: [{ id: A, name: "Empresa" }], agentAssignments: { "agent-1": A } }));
      ob.agentes();
      assert.equal(ob.barraFalhaHaMs(), null, "leitura boa: sem falha");
      fs.writeFileSync(barra, "{ pela metade");
      t += 1_000;
      ob.agentes();
      assert.equal(ob.barraFalhaHaMs(), 0);
      t += 60_000;
      ob.agentes();
      assert.equal(ob.barraFalhaHaMs(), 60_000, "a segunda falha não zera o relógio");
      fs.writeFileSync(barra, JSON.stringify({ version: 2, sections: [], agentAssignments: {} }));
      ob.agentes();
      assert.equal(ob.barraFalhaHaMs(), null);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("aviso do doctor sobre a barra do OpenBot (0.22.0)", () => {
  test("só avisa com a barra que existe e não dá para ler; sem OpenBot, sem a barra ou fora do macOS, nada", async () => {
    const { avisoDaBarra } = (await import("../src/openbot.js")) as { avisoDaBarra?: (home: string, plataforma?: NodeJS.Platform, guardado?: string) => string | null };
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
      // revisão 2: sem a barra, o guardado com pastas diz que valem as da última leitura boa
      fs.rmSync(path.join(pasta, BARRA_ARQUIVO));
      const guardado = path.join(home, "openbot-barra.json");
      const comPastas = { versao: 1, barra: JSON.stringify({ version: 2, sections: [{ id: A, name: "Empresa" }], agentAssignments: {} }), vistos: [] };
      fs.writeFileSync(guardado, JSON.stringify(comPastas));
      assert.match(avisoDaBarra!(home, "darwin", guardado) ?? "", /última leitura boa/);
      fs.writeFileSync(guardado, JSON.stringify({ ...comPastas, barra: JSON.stringify({ version: 2, sections: [], agentAssignments: {} }) }));
      assert.equal(avisoDaBarra!(home, "darwin", guardado), null, "a última boa sem pastas: nada a avisar");
      fs.writeFileSync(guardado, "{ estragado");
      assert.equal(avisoDaBarra!(home, "darwin", guardado), null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
