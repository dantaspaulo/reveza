// A pasta de cada uso (0.17.0): a raiz do git, relativa à pessoal, para o painel separar o uso por empresa. E a lista dos
// agentes do OpenBot (pasta, nome e título), lida do banco dele só para leitura.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Pastas, PASTA_MAX, pastaNaNuvem, raizDoGit, relativaAPessoal, type LeitorPastas } from "../src/registro/pasta.js";
import { Contador, chaveHora } from "../src/registro/contador.js";
import { agentesDaSaida, OpenBotLocal } from "../src/openbot.js";

const SQLITE = "/usr/bin/sqlite3";
const CASA = "/Users/x";

/** O caminho como o código o vê depois do path.resolve (no Windows, "/Users/x" vira "D:\Users\x"). */
const R = (p: string) => path.resolve(p);

/** Um disco de mentira: pasta -> conteúdo do .git ("" quando é pasta). As chaves vão resolvidas, como o código lê. */
function leitor(mapa: Record<string, string>): LeitorPastas & { lidas: string[] } {
  const lidas: string[] = [];
  const m = new Map(Object.entries(mapa).map(([k, v]) => [R(k), v] as const));
  return {
    lidas,
    git(p) {
      lidas.push(p);
      return m.has(p) ? m.get(p)! : null;
    },
  };
}

describe("pasta do uso", () => {
  test("relativa à pessoal; fora dela fica como está; barras do Windows viram /", () => {
    assert.equal(relativaAPessoal("/Users/x/Code/a/", CASA), "~/Code/a");
    assert.equal(relativaAPessoal("/Users/x", CASA), "~");
    assert.equal(relativaAPessoal("/Users/xy/Code", CASA), "/Users/xy/Code", "prefixo de outro nome não conta");
    assert.equal(relativaAPessoal("/srv/app", CASA), "/srv/app");
    assert.equal(relativaAPessoal("C:\\Users\\x\\Code\\a", "C:\\Users\\x"), "~/Code/a");
  });

  test("a raiz do git: o próprio repositório, de uma subpasta, de uma árvore de trabalho (o principal) e de um submódulo (ele mesmo)", () => {
    const l = leitor({
      "/Users/x/Code/repo": "",
      "/Users/x/wt/feat": "gitdir: /Users/x/Code/repo/.git/worktrees/feat\n",
      "/Users/x/wt/rel": "gitdir: ../../Code/repo/.git/worktrees/rel\n",
      "/Users/x/Code/repo/vendor/lib": "gitdir: ../../.git/modules/vendor/lib\n",
    });
    assert.equal(raizDoGit("/Users/x/Code/repo", CASA, l), R("/Users/x/Code/repo"));
    assert.equal(raizDoGit("/Users/x/Code/repo/src/a/b", CASA, l), R("/Users/x/Code/repo"));
    assert.equal(raizDoGit("/Users/x/wt/feat/src", CASA, l), R("/Users/x/Code/repo"), "árvore de trabalho conta como o repositório dela");
    assert.equal(raizDoGit("/Users/x/wt/rel", CASA, l), R("/Users/x/Code/repo"), "caminho relativo no gitdir");
    assert.equal(raizDoGit("/Users/x/Code/repo/vendor/lib/x", CASA, l), R("/Users/x/Code/repo/vendor/lib"), "submódulo é ele mesmo");
  });

  test("sem git: null, e não sobe além da pasta pessoal (um .git nela não faz dela o projeto)", () => {
    const l = leitor({ "/Users/x": "", "/": "" });
    assert.equal(raizDoGit("/Users/x/OpenBot/Agents/agent-1", CASA, l), null);
    assert.ok(!l.lidas.includes(R("/Users/x")), "a pessoal nem é lida");
    assert.equal(raizDoGit("/srv/app", CASA, leitor({})), null, "fora da pessoal para na raiz do disco");
  });

  test("Pastas.de: a raiz do git ou a própria pasta, relativa à pessoal, cortada e sem caracteres de controle; guarda a resposta", () => {
    const l = leitor({ "/Users/x/Code/repo": "" });
    const p = new Pastas(CASA, l);
    assert.equal(p.de("/Users/x/Code/repo/src"), "~/Code/repo");
    const lidas = l.lidas.length;
    assert.equal(p.de("/Users/x/Code/repo/src"), "~/Code/repo");
    assert.equal(l.lidas.length, lidas, "a segunda vez vem da memória");
    assert.equal(p.de("/Users/x/OpenBot/Agents/agent-1"), "~/OpenBot/Agents/agent-1", "sem git, a própria pasta");
    assert.equal(p.de("/Users/x/a\u0007b"), "~/ab");
    assert.equal(p.de("/Users/x/" + "a".repeat(400)).length, PASTA_MAX);
    for (const ruim of [undefined, null, 3, "", "x".repeat(5000)]) assert.equal(p.de(ruim), "");
    assert.equal(new Pastas(CASA, { git: () => { throw new Error("disco"); } }).de("/Users/x/a"), "", "erro de leitura não derruba o registro");
  });

  test("pastaNaNuvem: igual à rvz_pasta da nuvem (pontas, controle, 300 caracteres, só caminho; Windows com letra)", () => {
    assert.equal(pastaNaNuvem("~/Code/a "), "~/Code/a", "espaço no fim sai, como no btrim");
    assert.equal(pastaNaNuvem("~/a\u0085b"), "~/ab");
    assert.equal(pastaNaNuvem("D:/clienteA/api"), "D:/clienteA/api");
    assert.equal(pastaNaNuvem("D:"), "D:");
    assert.equal(pastaNaNuvem("~"), "~");
    for (const ruim of ["relativa", "~x", "", " ", "DD:/a", "1:/a"]) assert.equal(pastaNaNuvem(ruim), "", ruim);
    assert.equal(Array.from(pastaNaNuvem("/" + "😀".repeat(400))).length, PASTA_MAX, "conta caracteres, não metades de emoji");
  });

  test("a pasta de um agente do OpenBot vale como projeto mesmo dentro de um repositório; um repositório dentro dela é ele mesmo", () => {
    const l = leitor({ "/Users/x/OpenBot": "", "/Users/x/OpenBot/Agents/a1/repo": "" });
    let fixas: string[] = ["/Users/x/OpenBot/Agents/a1"];
    const p = new Pastas(CASA, l, () => fixas);
    assert.equal(p.de("/Users/x/OpenBot/Agents/a1"), "~/OpenBot/Agents/a1");
    assert.equal(p.de("/Users/x/OpenBot/Agents/a1/notas"), "~/OpenBot/Agents/a1");
    assert.equal(p.de("/Users/x/OpenBot/Agents/a1/repo/src"), "~/OpenBot/Agents/a1/repo");
    assert.equal(p.de("/Users/x/OpenBot/Agents/a2"), "~/OpenBot", "agente fora da lista: a raiz do git");
    assert.equal(p.de("/Users/x/OpenBot/Agents/a10"), "~/OpenBot", "prefixo de outro nome não conta");
    fixas = [...fixas, "/Users/x/OpenBot/Agents/a2"];
    assert.equal(p.de("/Users/x/OpenBot/Agents/a2"), "~/OpenBot/Agents/a2", "lista nova: a resposta guardada é refeita");
    assert.equal(new Pastas(CASA, l, () => { throw new Error("banco"); }).de("/Users/x/OpenBot/Agents/a1"), "~/OpenBot");
  });
});

describe("contador com a pasta", () => {
  const T = 1_800_000_000;
  const resposta = (mid: string, cwd: string, sessao = "s1") => ({
    type: "assistant",
    sessionId: sessao,
    cwd,
    timestamp: new Date((T + 10) * 1000).toISOString(),
    message: { id: mid, model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 100 } },
  });

  test("a chave de antes (sem pasta) não muda: registro antigo continua somando na mesma linha", () => {
    assert.equal(chaveHora({ hora: 7200, conta: "c", modelo: "m", projeto: "p" }), "7200|c|m|p");
    assert.equal(chaveHora({ hora: 7200, conta: "c", modelo: "m", projeto: "p", pasta: "" }), "7200|c|m|p");
    assert.equal(chaveHora({ hora: 7200, conta: "c", modelo: "m", projeto: "p", pasta: "~/a" }), "7200|c|m|p|~/a");
  });

  test("o mesmo nome curto em pastas diferentes vira duas linhas; a sessão guarda a pasta; tudo vai à nuvem", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-pasta-"));
    try {
      const proj = path.join(tmp, "projects", "-x");
      fs.mkdirSync(proj, { recursive: true });
      const l = leitor({ "/Users/x/Code/um/app": "", "/Users/x/Code/dois/app": "" });
      const c = new Contador(path.join(tmp, "registro"), path.join(tmp, "projects"), () => "conta-a", () => T + 7200, new Pastas(CASA, l));
      fs.writeFileSync(path.join(proj, "s1.jsonl"), [resposta("m1", "/Users/x/Code/um/app"), resposta("m2", "/Users/x/Code/um/app/src")].map((x) => JSON.stringify(x)).join("\n") + "\n");
      fs.writeFileSync(path.join(proj, "s2.jsonl"), JSON.stringify(resposta("m3", "/Users/x/Code/dois/app", "s2")) + "\n");
      await c.varrer();
      const linhas = c.linhas().map((x) => `${x.projeto}|${x.pasta}|${x.msgs}`).sort();
      assert.deepEqual(linhas, ["app|~/Code/dois/app|1", "app|~/Code/um/app|1", "src|~/Code/um/app|1"]);
      const lote = c.paraNuvem(() => "uuid-a");
      assert.deepEqual(lote.linhas.map((x) => x.pasta).sort(), ["~/Code/dois/app", "~/Code/um/app", "~/Code/um/app"]);
      assert.deepEqual(lote.sessoes.map((s) => `${s.id}:${s.pasta}`).sort(), ["s1:~/Code/um/app", "s2:~/Code/dois/app"]);
      assert.ok(!JSON.stringify(lote).includes("/Users/x"), "o caminho da pasta pessoal não sai");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sem leitor de pastas (como antes), a pasta vai vazia", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-pasta-"));
    try {
      const proj = path.join(tmp, "projects", "-x");
      fs.mkdirSync(proj, { recursive: true });
      const c = new Contador(path.join(tmp, "registro"), path.join(tmp, "projects"), () => "conta-a", () => T + 7200);
      fs.writeFileSync(path.join(proj, "s1.jsonl"), JSON.stringify(resposta("m1", "/Users/x/Code/um/app")) + "\n");
      await c.varrer();
      const lote = c.paraNuvem(() => "uuid-a");
      assert.equal(lote.linhas[0]!.pasta, "");
      assert.equal(lote.sessoes[0]!.pasta, "");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("agentes do OpenBot", () => {
  test("a saída da consulta: só pasta absoluta, textos curtos e sem caracteres de controle; saída ruim vira lista vazia", () => {
    const saida = JSON.stringify([
      { pasta: "/Users/x/OpenBot/Agents/agent-1", nome: "Um\nnome", titulo: "T".repeat(300) },
      { pasta: "relativa", nome: "x", titulo: "x" },
      { pasta: null, nome: "x", titulo: "x" },
      "texto",
      { pasta: "/a", nome: 3, titulo: null },
      { pasta: "C:\\Users\\x\\OpenBot\\Agents\\a3", nome: "Windows", titulo: "" },
    ]);
    const r = agentesDaSaida(saida);
    assert.equal(r.length, 3);
    assert.equal(r[2]!.pasta, "C:\\Users\\x\\OpenBot\\Agents\\a3", "caminho do Windows também vale");
    assert.deepEqual(r[0], { pasta: "/Users/x/OpenBot/Agents/agent-1", nome: "Um nome", titulo: "T".repeat(200) });
    assert.deepEqual(r[1], { pasta: "/a", nome: "", titulo: "" });
    assert.deepEqual(agentesDaSaida(""), []);
    assert.deepEqual(agentesDaSaida("{quebrado"), []);
    assert.deepEqual(agentesDaSaida('{"pasta":"/a"}'), []);
  });

  test("lidos do banco do OpenBot só para leitura; sem banco, lista vazia", { skip: !fs.existsSync(SQLITE) }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-openbot-agentes-"));
    try {
      const banco = path.join(d, "openbot.db");
      const j = (o: unknown) => JSON.stringify(o).replace(/'/g, "''");
      execFileSync(SQLITE, [
        banco,
        "CREATE TABLE projection_agents (agent_id TEXT, thread_id TEXT, agent_json TEXT);" +
          `INSERT INTO projection_agents VALUES ('a1', 't1', '${j({ workspacePath: "/Users/x/OpenBot/Agents/a1", name: "Um", title: "O título d'um" })}'),` +
          `('a2', 't2', '${j({ name: "sem pasta" })}'), ('a3', 't3', 'não é json');`,
      ]);
      const antes = fs.statSync(banco).mtimeMs;
      const exec = { rodar: async () => ({ codigo: 0, saida: "", erro: "" }), iniciar: () => { throw new Error(); } };
      const ob = new OpenBotLocal({ banco, comando: "/x/cli.mjs" }, exec);
      const lista = ob.agentes();
      assert.deepEqual(lista, [{ pasta: "/Users/x/OpenBot/Agents/a1", nome: "Um", titulo: "O título d'um" }]);
      assert.equal(fs.statSync(banco).mtimeMs, antes, "o banco não foi escrito");
      assert.deepEqual(new OpenBotLocal({ banco: path.join(d, "nao.db"), comando: "/x" }, exec).agentes(), []);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
