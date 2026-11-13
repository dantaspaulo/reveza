// Importação do roteador antigo: só copia (nada na origem muda), credencial de cada conta copiada para a pasta
// nova, configuração, linha do tempo e o uso.db como estado inicial do registro de uso. Tudo com cópias falsas.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { importar, lerBancoSqlite, type DadosBanco } from "../src/importar.js";
import { servicoDaPasta } from "../src/credenciais/blob.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { carregarEstado } from "../src/estado.js";
import { Contador } from "../src/registro/contador.js";
import { blob, ExecutorFalso, pastaTemporaria, T0, uuidDaOrg } from "./falsos.js";
import { executorReal } from "../src/util/executor.js";

let tmp: ReturnType<typeof pastaTemporaria>;
afterEach(() => tmp?.limpar());

function fotografia(dir: string): string {
  const h = createHash("sha256");
  const andar = (d: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const c = path.join(d, n);
      const st = fs.statSync(c);
      h.update(c + st.mode);
      if (st.isDirectory()) andar(c);
      else h.update(fs.readFileSync(c));
    }
  };
  andar(dir);
  return h.digest("hex");
}

function roteadorFalso(base: string) {
  const de = path.join(base, "roteador");
  const contasDir = path.join(base, "contas-antigas");
  fs.mkdirSync(de, { recursive: true });
  const pastaA = path.join(contasDir, "conta-aaaa");
  const pastaB = path.join(contasDir, "conta-bbbb");
  for (const [p, email] of [[pastaA, "a@exemplo.com"], [pastaB, "b@exemplo.com"]] as const) {
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  }
  const conta = (email: string, l: string, pasta: string, extra: Record<string, unknown> = {}) => ({
    email,
    org: `Org ${l}`,
    accountUuid: `acc-${l}`,
    orgUuid: uuidDaOrg(l),
    plano: "max",
    tier: "default_max_20x",
    pasta,
    servico: servicoDaPasta(pasta),
    pausada: false,
    precisaLogin: false,
    conectadaEm: T0 - 1000,
    janelas: [{ tipo: "five_hour", rotulo: "5 horas", pct: 12, resetEm: T0 + 100 }],
    lidoEm: T0 - 10,
    fonte: "api",
    tokenExpiraEm: T0 + 3600,
    erro: null,
    ...extra,
  });
  const estado = {
    formato: 1,
    auto: true,
    aviso: 85,
    troca: 93,
    retomarHeadless: true,
    modo: "limite",
    rodizio: { minutos: 120, ordem: "menor_uso" },
    ativa: "a-exemplo-com",
    proxima: "b-exemplo-com",
    versao: 4,
    trocadaEm: T0 - 500,
    contas: { "a-exemplo-com": conta("a@exemplo.com", "A", pastaA), "b-exemplo-com": conta("b@exemplo.com", "B", pastaB, { pausada: true }) },
    eventos: [{ em: T0 - 600, tipo: "troca", texto: "Troquei de b@exemplo.com para a@exemplo.com." }],
    fila: [{ sessao: "s-1", cwd: "/tmp", tipo: "headless", em: T0 - 300, estado: "aguardando", conta: "b-exemplo-com" }],
    identidades: {},
    historico: { "a-exemplo-com": [{ t: T0 - 300, p5: 10, p7: 2 }] },
    linhaContas: [
      [T0 - 9000, "b-exemplo-com"],
      [T0 - 600, "a-exemplo-com"],
    ],
  };
  fs.writeFileSync(path.join(de, "estado.json"), JSON.stringify(estado));
  fs.writeFileSync(path.join(de, "uso.db"), "banco falso: o conteúdo vem do lerBanco do teste");
  const cred = new CredenciaisFalsas();
  cred.d.set(pastaA, blob("A1"));
  cred.d.set(pastaB, blob("B1"));
  return { de, pastaA, pastaB, cred, contasDir };
}

const banco: DadosBanco = {
  arquivos: [{ caminho: "/x/projects/p/s1.jsonl", lido: 1234 }],
  vistos: ["m1", "m2"],
  porHora: [
    { hora: T0 - 3600, conta: "a-exemplo-com", modelo: "claude-opus-5-5", msgs: 2, ent: 10, sai: 20, c5: 0, c1h: 0, cl: 5, usd: 1.5 },
    { hora: T0 - 7200, conta: "", modelo: "claude-opus-5-5", msgs: 1, ent: 1, sai: 1, c5: 0, c1h: 0, cl: 0, usd: 0.1 },
  ],
  sessoes: [
    { sessao: "s1", projeto: "/Users/x/Code/proj", inicio: T0 - 7200, fim: T0 - 3600, msgs: 3, ent: 11, sai: 21, c5: 0, c1h: 0, cl: 5, usd: 1.6, contas: '["a-exemplo-com",""]', modelos: '["claude-opus-5-5"]' },
  ],
  agentes: [{ sessao: "s1", agente: "x1", inicio: T0 - 3600, conta: "a-exemplo-com" }],
};

describe("importar do roteador antigo", () => {
  test("copia contas, credenciais, configuração, linha do tempo e uso; a origem fica intacta", async () => {
    tmp = pastaTemporaria();
    const r = roteadorFalso(tmp.dir);
    const antes = fotografia(r.de) + fotografia(r.contasDir);
    const rel = await importar({ de: r.de, c: tmp.c, cred: r.cred, exec: new ExecutorFalso(), agora: T0, lerBanco: async () => banco, conferirServico: true });
    assert.equal(fotografia(r.de) + fotografia(r.contasDir), antes, "nada na origem mudou");
    assert.equal(r.cred.token(r.pastaA), "A1", "a credencial antiga continua lá");
    assert.equal(r.cred.token(r.pastaB), "B1");

    const e = carregarEstado(tmp.c.estado);
    const contas = Object.values(e.contas);
    assert.equal(contas.length, 2);
    const a = contas.find((c) => c.email === "a@exemplo.com")!;
    const b = contas.find((c) => c.email === "b@exemplo.com")!;
    assert.equal(path.dirname(a.pasta), tmp.c.contas, "pasta nova em ~/.reveza/contas/<id>");
    assert.equal(r.cred.token(a.pasta), "A1", "credencial copiada para a entrada da pasta nova");
    assert.equal(r.cred.token(b.pasta), "B1");
    assert.equal(JSON.parse(fs.readFileSync(path.join(a.pasta, ".claude.json"), "utf8")).oauthAccount.emailAddress, "a@exemplo.com");
    assert.equal(b.pausada, true);
    assert.equal(e.ativa, a.id);
    assert.deepEqual(
      { auto: e.config.auto, aviso: e.config.aviso, troca: e.config.troca, modo: e.config.modo, retomar: e.config.retomarHeadless },
      { auto: true, aviso: 85, troca: 93, modo: "limite", retomar: true },
    );
    assert.deepEqual(e.config.rodizio, { minutos: 120, ordem: "menor_uso" });
    assert.deepEqual(e.linhaContas, [
      [T0 - 9000, b.id],
      [T0 - 600, a.id],
    ]);
    assert.equal(e.fila[0]!.conta, b.id);
    assert.equal(e.historico[a.id]!.length, 1);
    assert.ok(e.eventos.some((x) => x.texto.startsWith("Troquei")));
    assert.deepEqual(rel.contas.map((c) => c.credencial).sort(), ["copiada", "copiada"]);

    const reg = new Contador(tmp.c.registro, tmp.c.projetos, () => null);
    assert.equal(reg.e.arquivos["/x/projects/p/s1.jsonl"], 1234, "a leitura continua de onde o roteador parou");
    assert.ok(reg.vistos.has("m1"));
    assert.equal(reg.totais(0, T0 * 2).respostas, 3);
    assert.equal(reg.totais(0, T0 * 2, (h) => h.conta === a.id).usd, 1.5, "a conta antiga vira o id novo");
    assert.equal(reg.e.sessoes.s1!.projeto, "proj");
    assert.deepEqual(reg.e.sessoes.s1!.contas, ["", a.id].sort());
    assert.equal(reg.e.sessoes.s1!.agentes, 1);
  });

  test("rodar de novo atualiza a credencial copiada (login mais novo) e não soma o uso duas vezes", async () => {
    tmp = pastaTemporaria();
    const r = roteadorFalso(tmp.dir);
    const op = { de: r.de, c: tmp.c, cred: r.cred, exec: new ExecutorFalso(), agora: T0, lerBanco: async () => banco };
    await importar(op);
    r.cred.d.set(r.pastaA, blob("A9"));
    const rel = await importar(op);
    const e = carregarEstado(tmp.c.estado);
    assert.equal(Object.keys(e.contas).length, 2);
    const a = Object.values(e.contas).find((c) => c.email === "a@exemplo.com")!;
    assert.equal(r.cred.token(a.pasta), "A9");
    assert.equal(rel.uso.importado, false);
    assert.equal(new Contador(tmp.c.registro, tmp.c.projetos, () => null).totais(0, T0 * 2).respostas, 3);
  });

  test("entrada antiga que não bate com a pasta não é copiada (aviso)", async () => {
    tmp = pastaTemporaria();
    const r = roteadorFalso(tmp.dir);
    const est = JSON.parse(fs.readFileSync(path.join(r.de, "estado.json"), "utf8"));
    est.contas["b-exemplo-com"].servico = "Claude Code-credentials-00000000";
    fs.writeFileSync(path.join(r.de, "estado.json"), JSON.stringify(est));
    const rel = await importar({ de: r.de, c: tmp.c, cred: r.cred, exec: new ExecutorFalso(), agora: T0, lerBanco: async () => banco, conferirServico: true });
    assert.equal(rel.contas.find((c) => c.email === "b@exemplo.com")!.credencial, "sem credencial");
    assert.ok(rel.avisos.some((x) => x.includes("não bate")));
  });

  test("sem estado.json na origem: erro claro", async () => {
    tmp = pastaTemporaria();
    await assert.rejects(importar({ de: path.join(tmp.dir, "nada"), c: tmp.c, cred: new CredenciaisFalsas(), exec: new ExecutorFalso(), agora: T0 }), /não achei/);
  });

  test("uso.db de verdade (SQLite) é lido de uma cópia; o original e o -wal ficam intactos", async (t) => {
    let sqlite: { DatabaseSync: new (a: string) => { exec(s: string): void; close(): void } };
    try {
      sqlite = (await import("node:" + "sqlite")) as typeof sqlite;
    } catch {
      t.skip("node:sqlite indisponível nesta versão do Node");
      return;
    }
    tmp = pastaTemporaria();
    const arq = path.join(tmp.dir, "uso.db");
    const db = new sqlite.DatabaseSync(arq);
    db.exec(`pragma journal_mode=wal;
      create table arquivos (caminho text primary key, lido integer not null, mtime real not null);
      create table vistos (id text primary key);
      create table por_hora (hora integer, conta text, modelo text, msgs integer, ent integer, sai integer, c5 integer, c1h integer, cl integer, usd real);
      create table sessoes (sessao text primary key, projeto text, inicio integer, fim integer, msgs integer, ent integer, sai integer, c5 integer, c1h integer, cl integer, usd real, contas text, modelos text);
      create table agentes (sessao text, agente text, inicio integer, conta text);
      insert into arquivos values ('/p/s.jsonl', 99, 0);
      insert into vistos values ('m1');
      insert into por_hora values (${T0}, 'a-exemplo-com', 'claude-opus-5-5', 1, 2, 3, 0, 0, 0, 0.5);
      insert into sessoes values ('s', '/x/y', ${T0}, ${T0}, 1, 2, 3, 0, 0, 0, 0.5, '["a-exemplo-com"]', '["claude-opus-5-5"]');`);
    const antes = fotografia(tmp.dir);
    const dados = await lerBancoSqlite(arq, executorReal);
    const depois = fotografia(tmp.dir);
    db.close();
    assert.equal(dados.arquivos[0]!.lido, 99);
    assert.deepEqual(dados.vistos, ["m1"]);
    assert.equal(dados.porHora[0]!.usd, 0.5);
    assert.equal(dados.sessoes[0]!.projeto, "/x/y");
    assert.equal(depois, antes, "o banco original (e o -wal) não mudou");
  });
});
