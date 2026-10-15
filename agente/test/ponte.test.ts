// Ponte local com o mod: só 127.0.0.1, Host conferido, cabeçalho X-Reveza, corpo limitado, nada de segredo.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { executarCli } from "../src/cli.js";
import { criarPonte } from "../src/ponte.js";
import { ativaEm, blob, contaEstacionada, ExecutorFalso, montar, RelogioFalso, type Montado } from "./falsos.js";

let m: Montado;
let srv: http.Server;
let porta: number;

function pedir(metodo: string, caminho: string, o: { corpo?: unknown; host?: string; cabecalho?: boolean; bruto?: string } = {}) {
  return new Promise<{ status: number; corpo: any }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        method: metodo,
        path: caminho,
        headers: {
          Host: o.host ?? `127.0.0.1:${porta}`,
          "Content-Type": "application/json",
          ...(o.cabecalho === false ? {} : { "X-Reveza": "1" }),
        },
      },
      (res) => {
        let t = "";
        res.on("data", (d) => (t += d));
        res.on("end", () => resolve({ status: res.statusCode!, corpo: t ? JSON.parse(t) : null }));
      },
    );
    req.on("error", reject);
    if (o.bruto !== undefined) req.end(o.bruto);
    else req.end(o.corpo === undefined ? undefined : JSON.stringify(o.corpo));
  });
}

describe("ponte local", () => {
  before(async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    contaEstacionada(m, "B");
    srv = criarPonte(m.agente.alvoPonte(), 0);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    porta = (srv.address() as AddressInfo).port;
    // a ponte confere o Host com a porta configurada; aqui a porta é a que o sistema deu
    srv.close();
    srv = criarPonte(m.agente.alvoPonte(), porta);
    await new Promise<void>((r) => srv.listen(porta, "127.0.0.1", () => r()));
  });
  after(() => {
    srv.close();
    m.limpar();
  });

  test("/api/ativa no formato que o mod lê", async () => {
    const r = await pedir("GET", "/api/ativa");
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.corpo).sort(), ["email", "enxugar", "slug", "trocadaEm", "versao"]);
    assert.equal(r.corpo.email, "a@exemplo.com");
    assert.equal(r.corpo.enxugar, false, "saída enxuta desligada por padrão");
  });

  test("/api/estado não vaza token nem refresh, nem no arquivo de estado", async () => {
    const r = await pedir("GET", "/api/estado");
    assert.equal(r.status, 200);
    const texto = JSON.stringify(r.corpo);
    for (const proibido of ['"A1"', '"B1"', "r-A1", "refreshToken", "accessToken"]) assert.ok(!texto.includes(proibido), proibido);
    assert.equal(r.corpo.contas.length, 2);
    m.agente.salvar();
    const arquivo = (await import("node:fs")).readFileSync(m.c.estado, "utf8");
    assert.ok(!arquivo.includes("r-A1") && !arquivo.includes("accessToken"));
  });

  test("sem o cabeçalho X-Reveza: 403, até no GET", async () => {
    assert.equal((await pedir("GET", "/api/ativa", { cabecalho: false })).status, 403);
    assert.equal((await pedir("POST", "/api/medida", { corpo: {}, cabecalho: false })).status, 403);
  });

  test("Host estranho (DNS rebinding): 403", async () => {
    assert.equal((await pedir("GET", "/api/ativa", { host: `mal.exemplo:${porta}` })).status, 403);
    assert.equal((await pedir("GET", "/api/ativa", { host: "127.0.0.1:1" })).status, 403);
  });

  test("localhost também vale", async () => {
    assert.equal((await pedir("GET", "/api/ativa", { host: `localhost:${porta}` })).status, 200);
  });

  test("preflight não é respondido", async () => {
    assert.equal((await pedir("OPTIONS", "/api/medida", { cabecalho: false })).status, 405);
  });

  test("corpo que não é objeto, JSON quebrado e corpo grande demais", async () => {
    assert.equal((await pedir("POST", "/api/medida", { bruto: "[1]" })).status, 400);
    assert.equal((await pedir("POST", "/api/medida", { bruto: "{x" })).status, 400);
    await assert.rejects(pedir("POST", "/api/medida", { bruto: JSON.stringify({ x: "a".repeat(70_000) }) }));
  });

  test("rota desconhecida e sessão com caractere estranho", async () => {
    assert.equal((await pedir("GET", "/api/nada")).status, 404);
    assert.equal((await pedir("POST", "/api/fila/..%2F..%2Fetc/retomada", { corpo: {} })).status, 400);
  });

  test("medida, limite e retomada na fila", async () => {
    m.agente.estado.trocadaEm = 0;
    const med = await pedir("POST", "/api/medida", { corpo: { sessao: "s", versao: m.agente.estado.versao, janelas: [{ tipo: "five_hour", pct: 42.5, resetEm: "2027-01-01T00:00:00Z" }] } });
    assert.equal(med.status, 200);
    const ativa = m.agente.estado.contas[m.agente.estado.ativa!]!;
    assert.equal(ativa.janelas.find((j) => j.tipo === "five_hour")!.pct, 42.5);
    assert.equal(ativa.fonte, "sessao");
    const lim = await pedir("POST", "/api/limite", { corpo: { sessao: "sessao-1", cwd: "/tmp", tipo: "interativa", erro: "rate_limit", versao: m.agente.estado.versao } });
    assert.equal(lim.status, 200);
    assert.equal(typeof lim.corpo.versao, "number");
    await m.agente.esperar();
    const ret = await pedir("POST", "/api/fila/sessao-1/retomada", { corpo: {} });
    assert.equal(ret.status, 200);
    assert.equal(m.agente.estado.fila.find((f) => f.sessao === "sessao-1")!.estado, "retomada");
  });

  test("conectar pela linha de comando e o código da página do login pela ponte", async () => {
    const r = await pedir("POST", "/api/contas/conectar", { corpo: { email: "b@exemplo.com" } });
    assert.equal(r.status, 200);
    const id = (r.corpo as { id: string }).id;
    const proc = m.cli.logins[m.cli.logins.length - 1]!.proc;
    const c = await pedir("POST", "/api/contas/codigo", { corpo: { id, codigo: "codigo#estado" } });
    assert.equal(c.status, 200);
    assert.deepEqual(proc.escrito, ["codigo#estado\n"]);
    assert.equal((await pedir("POST", "/api/contas/codigo", { corpo: { id: "outro", codigo: "x" } })).status, 400);
    assert.equal((await pedir("POST", "/api/contas/codigo", { corpo: { id, codigo: "x" }, cabecalho: false })).status, 403);
  });

  test("contas conectar: código incompleto recusado no terminal, que pergunta de novo até o código inteiro", async () => {
    const respostas = ["so-a-parte-de-antes", "codigo#estado"];
    const perguntas: string[] = [];
    const erros: string[] = [];
    const antes = m.cli.logins.length;
    const rodando = executarCli(["contas", "conectar", "c@exemplo.com"], {
      c: m.c,
      sistema: "linux",
      exec: new ExecutorFalso(),
      relogio: new RelogioFalso(),
      saida: () => undefined,
      erro: (t) => erros.push(t),
      perguntar: async (q) => (perguntas.push(q), respostas.shift() ?? ""),
      env: { REVEZA_PORTA: String(porta) },
      script: "/app/cli.js",
    });
    const esperar = async (cond: () => boolean) => {
      for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
      assert.ok(cond());
    };
    await esperar(() => m.cli.logins.length > antes);
    const { pasta, proc } = m.cli.logins[m.cli.logins.length - 1]!;
    proc.emitir("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y");
    await esperar(() => proc.escrito.length > 0);
    assert.deepEqual(proc.escrito, ["codigo#estado\n"]);
    assert.equal(perguntas.length, 2);
    assert.match(erros.join("\n"), /incompleto/);
    m.cred.d.set(pasta, blob("C1"));
    proc.fim(0);
    assert.equal(await rodando, 0);
  });

  test("trocar pela linha de comando (sem nuvem) e conta desconhecida", async () => {
    const r = await pedir("POST", "/api/trocar", { corpo: { email: "ninguem@exemplo.com" } });
    assert.equal(r.status, 404);
  });
});

describe("chave local da ponte", () => {
  test("criada uma vez em arquivo 600 e exigida em toda rota; a CLI manda e passa", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { chaveDaPonte, pedirPonte } = await import("../src/ponte.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-chave-"));
    const arq = path.join(dir, "ponte.chave");
    const m2 = await montar();
    let s2: http.Server | null = null;
    try {
      assert.equal(chaveDaPonte(arq, false), null, "sem criar, não inventa");
      const k = chaveDaPonte(arq)!;
      assert.match(k, /^[0-9a-f]{64}$/);
      assert.equal(chaveDaPonte(arq), k, "a mesma nas próximas vezes");
      if (process.platform !== "win32") assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
      s2 = criarPonte(m2.agente.alvoPonte(), 0, k);
      await new Promise<void>((r) => s2!.listen(0, "127.0.0.1", () => r()));
      const p2 = (s2.address() as AddressInfo).port;
      s2.close();
      s2 = criarPonte(m2.agente.alvoPonte(), p2, k);
      await new Promise<void>((r) => s2!.listen(p2, "127.0.0.1", () => r()));
      assert.equal((await pedirPonte(p2, "GET", "/api/estado"))!.status, 401, "sem chave");
      assert.equal((await pedirPonte(p2, "GET", "/api/estado", undefined, "0".repeat(64)))!.status, 401, "chave errada");
      assert.equal((await pedirPonte(p2, "POST", "/api/limite", { sessao: "x" }, "0".repeat(64)))!.status, 401, "nem força troca");
      assert.equal((await pedirPonte(p2, "GET", "/api/estado", undefined, k))!.status, 200);
    } finally {
      s2?.close();
      m2.limpar();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prova da chave da ponte (a chave nunca viaja)", () => {
  test("a CLI manda só a prova; quem estiver na porta no lugar do agente não aprende a chave", async () => {
    const { cabecalhosDaPonte, pedirPonte } = await import("../src/ponte.js");
    const k = "a".repeat(64);
    const vistos: http.IncomingHttpHeaders[] = [];
    const intruso = http.createServer((req, res) => {
      vistos.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => intruso.listen(0, "127.0.0.1", () => r()));
    const porta = (intruso.address() as AddressInfo).port;
    try {
      assert.equal(await pedirPonte(porta, "GET", "/api/estado", undefined, k), null, "resposta sem a prova do agente não vale");
      assert.equal(vistos.length, 1);
      const texto = JSON.stringify(vistos[0]);
      assert.ok(!texto.includes(k), "a chave não aparece em cabeçalho nenhum");
      assert.equal(vistos[0]!["x-reveza-chave"], undefined);
      assert.match(String(vistos[0]!["x-reveza-prova"]), /^[0-9a-f]{64}$/);
      assert.deepEqual(cabecalhosDaPonte(null, "GET", "/x"), {});
    } finally {
      intruso.close();
    }
  });

  test("prova repetida, vencida ou de outro caminho não passa; a chave antiga ainda vale (sessões já abertas)", async () => {
    const { criarPonte, provaDaPonte } = await import("../src/ponte.js");
    const k = "b".repeat(64);
    const m3 = await montar();
    const livre = http.createServer();
    await new Promise<void>((r) => livre.listen(0, "127.0.0.1", () => r()));
    const porta = (livre.address() as AddressInfo).port;
    await new Promise<void>((r) => livre.close(() => r()));
    const s3 = criarPonte(m3.agente.alvoPonte(), porta, k);
    await new Promise<void>((r) => s3.listen(porta, "127.0.0.1", () => r()));
    const pedirCom = async (cab: Record<string, string>, caminho = "/api/estado") =>
      (await fetch(`http://127.0.0.1:${porta}${caminho}`, { headers: { "X-Reveza": "1", ...cab } })).status;
    try {
      const tempo = String(Date.now());
      const prova = (caminho: string, t: string, n: string) => ({
        "X-Reveza-Tempo": t, "X-Reveza-Nonce": n, "X-Reveza-Prova": provaDaPonte(k, "GET", caminho, t, n),
      });
      assert.equal(await pedirCom(prova("/api/estado", tempo, "nonce-0001")), 200);
      assert.equal(await pedirCom(prova("/api/estado", tempo, "nonce-0001")), 401, "o mesmo nonce de novo");
      assert.equal(await pedirCom(prova("/api/estado", String(Date.now() - 120_000), "nonce-0002")), 401, "vencida");
      assert.equal(await pedirCom(prova("/api/ativa", tempo, "nonce-0003")), 401, "feita para outro caminho");
      assert.equal(await pedirCom({ "X-Reveza-Chave": k }), 200, "compatibilidade com o mod antigo");
      assert.equal(await pedirCom({ "X-Reveza-Chave": "0".repeat(64) }), 401);
    } finally {
      s3.close();
      m3.limpar();
    }
  });
});
