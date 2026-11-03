// Registro de uso das transcrições: custo por modelo, deduplicação, agentes, leitura incremental, projeto,
// persistência em arquivo e envio idempotente à nuvem. Transcrições falsas numa pasta temporária.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { custo, familia } from "../src/registro/precos.js";
import { Contador } from "../src/registro/contador.js";

const T = 1_800_000_000;

function resposta(mid: string, ts: number, o: { modelo?: string; ent?: number; sai?: number; c1h?: number; c5?: number; cl?: number; sessao?: string; speed?: string; cwd?: string } = {}) {
  const { modelo = "claude-opus-5-5", ent = 10, sai = 100, c1h = 0, c5 = 0, cl = 0, sessao = "s1", speed = "standard", cwd = "/Users/x/Code/projeto" } = o;
  return {
    type: "assistant",
    sessionId: sessao,
    cwd,
    timestamp: new Date(ts * 1000).toISOString(),
    message: {
      id: mid,
      model: modelo,
      usage: {
        input_tokens: ent,
        output_tokens: sai,
        cache_read_input_tokens: cl,
        cache_creation_input_tokens: c1h + c5,
        speed,
        cache_creation: { ephemeral_1h_input_tokens: c1h, ephemeral_5m_input_tokens: c5 },
      },
    },
  };
}

describe("custo", () => {
  test("opus 5.5 com cache", async () => {
    const u = resposta("m", 0, { ent: 1e6, sai: 1e6, c1h: 1e6, c5: 1e6, cl: 1e6 }).message.usage;
    const { usd, estimado } = custo(u, "claude-opus-5-5");
    assert.ok(Math.abs(usd - (4 + 20 + 4 * 2 + 4 * 1.25 + 0.2)) < 1e-9);
    assert.equal(estimado, false);
  });

  test("fable 5.1 lê cache a 0,25; fable 5 a 1,00", async () => {
    assert.ok(Math.abs(custo({ cache_read_input_tokens: 1e6 }, "claude-fable-5-1").usd - 0.25) < 1e-9);
    assert.ok(Math.abs(custo({ cache_read_input_tokens: 1e6 }, "claude-fable-5").usd - 1.0) < 1e-9);
  });

  test("haiku 5.5: acima de 100 mil tokens no pedido vale a faixa mais cara", async () => {
    const pequeno = resposta("m", 0, { ent: 50_000, sai: 1e6, modelo: "claude-haiku-5-5" }).message.usage;
    assert.ok(Math.abs(custo(pequeno, "claude-haiku-5-5").usd - (0.05 * 0.1 + 0.5)) < 1e-9);
    const grande = resposta("m", 0, { ent: 10_000, cl: 200_000, sai: 1e6, modelo: "claude-haiku-5-5" }).message.usage;
    assert.ok(Math.abs(custo(grande, "claude-haiku-5-5").usd - (0.01 * 0.5 + 0.2 * 0.05 + 2.5)) < 1e-9);
  });

  test("nome com sufixo e modelo desconhecido", async () => {
    assert.equal(familia("claude-opus-5-5[1m]"), "claude-opus-5-5");
    assert.equal(familia("claude-sonnet-5-5-20261001"), "claude-sonnet-5-5");
    assert.equal(familia("claude-sonnet-5"), "claude-sonnet-5");
    const { usd, estimado } = custo({ output_tokens: 1e6 }, "modelo-novo");
    assert.equal(estimado, true);
    assert.ok(Math.abs(usd - 20) < 1e-9);
  });

  test("modo rápido dobra", async () => {
    assert.ok(Math.abs(custo({ output_tokens: 1e6, speed: "fast" }, "claude-opus-5-5").usd - 40) < 1e-9);
  });

  test("cache sem o detalhe de 5 min/1 h conta como 5 min", async () => {
    assert.ok(Math.abs(custo({ cache_creation_input_tokens: 1e6 }, "claude-opus-5-5").usd - 5) < 1e-9);
  });
});

describe("contador", () => {
  let tmp: string;
  let proj: string;
  let c: Contador;
  const novo = () => new Contador(path.join(tmp, "registro"), path.join(tmp, "projects"), (ts) => (ts < T + 1800 ? "conta-a" : "conta-b"), () => T + 7200);

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-reg-"));
    proj = path.join(tmp, "projects", "-Users-x-Code-projeto");
    fs.mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });
    c = novo();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function escrever(nome: string, linhas: unknown[], semFim = false) {
    const texto = linhas.map((l) => JSON.stringify(l)).join("\n") + (semFim ? "" : "\n");
    fs.appendFileSync(path.join(proj, nome), texto);
  }
  const total = (x = c) => x.totais(0, T + 999999);

  test("resposta repetida conta uma vez; linha de usuário é ignorada", async () => {
    const cheia = resposta("m1", T, { sai: 100 });
    const vazia = resposta("m1", T, { ent: 0, sai: 0 });
    escrever("s1.jsonl", [cheia, cheia, vazia, { type: "user", message: { content: "oi" } }]);
    await c.varrer();
    assert.equal(total().respostas, 1);
    assert.equal(total().saida, 100);
  });

  test("a linha zerada antes da cheia não apaga a cheia", async () => {
    escrever("s1.jsonl", [resposta("m1", T, { ent: 0, sai: 0 }), resposta("m1", T, { sai: 300 })]);
    await c.varrer();
    assert.equal(total().saida, 300);
  });

  test("a mesma resposta em outra transcrição (sessão retomada) não duplica", async () => {
    escrever("s1.jsonl", [resposta("m1", T)]);
    escrever("s2.jsonl", [resposta("m1", T, { sessao: "s2" }), resposta("m2", T, { sessao: "s2" })]);
    await c.varrer();
    assert.equal(total().respostas, 2);
  });

  test("agentes por sessão e por conta (arquivos subagents/agent-*.jsonl)", async () => {
    escrever("s1.jsonl", [resposta("m1", T)]);
    escrever(path.join("s1", "subagents", "agent-aaa.jsonl"), [resposta("m2", T + 10), resposta("m3", T + 20)]);
    escrever(path.join("s1", "subagents", "agent-bbb.jsonl"), [resposta("m4", T + 2000)]);
    await c.varrer();
    assert.equal(c.agentesEntre(0, T + 99999), 2);
    const s = c.e.sessoes.s1!;
    assert.equal(s.agentes, 2);
    assert.equal(s.msgs, 4);
    assert.equal(c.agentesEntre(0, T + 99999, "conta-a"), 1);
    assert.equal(c.totais(0, T + 99999, (h) => h.conta === "conta-b").respostas, 1);
    assert.deepEqual(s.contas, ["conta-a", "conta-b"]);
  });

  // Relato do Paulo (03/11/2026): o painel somava os agentes das sessões que começaram no período, e as sessões de
  // editor ficam abertas por semanas. Cada linha por hora leva os agentes que começaram nela.
  test("agentes contados na linha da hora em que começaram, e enviados à nuvem", async () => {
    escrever("s1.jsonl", [resposta("m1", T)]);
    escrever(path.join("s1", "subagents", "agent-aaa.jsonl"), [resposta("m2", T + 10), resposta("m3", T + 4000)]);
    escrever(path.join("s1", "subagents", "agent-bbb.jsonl"), [resposta("m4", T + 4000, { modelo: "claude-fable-5-1" })]);
    await c.varrer();
    const linhas = c.paraNuvem(() => "uuid").linhas;
    const ag = (hora: number, modelo = "claude-opus-5-5") =>
      linhas.find((l) => l.hora === new Date((hora - (hora % 3600)) * 1000).toISOString() && l.modelo === modelo)?.agentes;
    assert.equal(ag(T), 1, "o aaa começou na hora de T");
    assert.equal(ag(T + 4000), 0, "a segunda resposta do aaa não conta outro agente");
    assert.equal(ag(T + 4000, "claude-fable-5-1"), 1, "o bbb começou depois, no modelo dele");
    assert.equal(linhas.reduce((s, l) => s + l.agentes, 0), c.agentesEntre(0, T + 99999));
  });

  test("registro de antes (formato 1): os agentes já vistos vão para as linhas por hora e voltam a ser enviados", async () => {
    escrever("s1.jsonl", [resposta("m1", T), resposta("m5", T + 30, { modelo: "claude-fable-5-1" })]);
    escrever(path.join("s1", "subagents", "agent-aaa.jsonl"), [resposta("m2", T + 10), resposta("m3", T + 20)]);
    escrever(path.join("s1", "subagents", "agent-bbb.jsonl"), [resposta("m4", T + 4000)]);
    await c.varrer();
    c.confirmarEnvio(c.paraNuvem(() => "uuid").chaves, []);
    // como o registro de antes ficava: sem `ag` nas linhas e no formato 1
    for (const h of Object.values(c.e.horas)) delete h.ag;
    c.e.formato = 1;
    c.salvar();
    const depois = novo();
    assert.equal(depois.e.formato, 2);
    const linhas = depois.paraNuvem(() => "uuid").linhas;
    assert.equal(linhas.length, 2, "só as linhas com agente voltam a ser enviadas");
    assert.equal(linhas.reduce((s, l) => s + l.agentes, 0), 2);
    const daHora = linhas.find((l) => l.hora === new Date((T - (T % 3600)) * 1000).toISOString())!;
    assert.equal(daHora.modelo, "claude-opus-5-5", "vai para a linha da hora com mais respostas");
    assert.equal(daHora.agentes, 1);
  });

  test("leitura incremental e linha pela metade fica para depois", async () => {
    escrever("s1.jsonl", [resposta("m1", T), resposta("m2", T)], true);
    await c.varrer();
    assert.equal(total().respostas, 1);
    fs.appendFileSync(path.join(proj, "s1.jsonl"), "\n");
    escrever("s1.jsonl", [resposta("m3", T)]);
    await c.varrer();
    assert.equal(total().respostas, 3);
    await c.varrer();
    assert.equal(total().respostas, 3);
  });

  test("custo em dólar e modelo", async () => {
    escrever("s1.jsonl", [resposta("m1", T, { ent: 0, sai: 1_000_000 })]);
    await c.varrer();
    assert.equal(total().usd, 20);
    assert.equal(c.linhas()[0]!.modelo, "claude-opus-5-5");
  });

  test("projeto é só o nome da pasta final, nunca o caminho", async () => {
    escrever("s1.jsonl", [resposta("m1", T, { cwd: "/Users/fulano/segredo/meu-projeto/" })]);
    await c.varrer();
    assert.equal(c.linhas()[0]!.projeto, "meu-projeto");
    assert.ok(!JSON.stringify(c.e).includes("fulano"));
  });

  test("agrega por hora, conta, modelo e projeto", async () => {
    escrever("s1.jsonl", [
      resposta("m1", T + 10),
      resposta("m2", T + 20, { modelo: "claude-sonnet-5-5" }),
      resposta("m3", T + 30, { cwd: "/x/outro" }),
      resposta("m4", T + 3600 + 5),
    ]);
    await c.varrer();
    assert.equal(c.linhas().length, 4);
  });

  test("o estado fica em arquivo: outro contador continua de onde parou, sem contar de novo", async () => {
    escrever("s1.jsonl", [resposta("m1", T)]);
    await c.varrer();
    const outro = novo();
    await outro.varrer();
    assert.equal(total(outro).respostas, 1);
    escrever("s1.jsonl", [resposta("m2", T)]);
    await outro.varrer();
    assert.equal(total(outro).respostas, 2);
    assert.ok(fs.existsSync(path.join(tmp, "registro", "estado.json")));
    assert.ok(!fs.readdirSync(path.join(tmp, "registro")).some((n) => n.endsWith(".db")), "nada de SQLite");
  });

  test("ids descem para o vistos.txt e seguem valendo", async () => {
    escrever("s1.jsonl", [resposta("m1", T)]);
    await c.varrer();
    c.e.vistosRecentes.push(...Array.from({ length: 20_001 }, (_, i) => `x${i}`));
    c.salvar();
    assert.equal(c.e.vistosRecentes.length, 0);
    const outro = novo();
    assert.ok(outro.vistos.has("m1"));
    fs.writeFileSync(path.join(proj, "s3.jsonl"), JSON.stringify(resposta("m1", T, { sessao: "s3" })) + "\n");
    await outro.varrer();
    assert.equal(total(outro).respostas, 1);
  });

  test("varredura grande cede a vez ao resto do agente (a ponte não fica esperando)", async () => {
    const linhas = Array.from({ length: 6000 }, (_, i) => ({ ...resposta(`m${i}`, T), recheio: "x".repeat(400) }));
    escrever("s1.jsonl", linhas);
    c.fatiaMs = 0;
    let terminou = false;
    let outroRodou = false;
    const p = c.varrer().then(() => (terminou = true));
    setImmediate(() => (outroRodou = !terminou));
    await p;
    assert.equal(outroRodou, true);
    assert.equal(total().respostas, 6000);
  });

  test("arquivo reescrito (menor que o lido) é relido do começo, sem duplicar", async () => {
    escrever("s1.jsonl", [resposta("m1", T), resposta("m2", T)]);
    await c.varrer();
    fs.writeFileSync(path.join(proj, "s1.jsonl"), JSON.stringify(resposta("m3", T)) + "\n");
    await c.varrer();
    assert.equal(total().respostas, 3);
  });

  test("para a nuvem: totais (não diferença), conta da nuvem, sem conta vai sem conta, e confirma", async () => {
    escrever("s1.jsonl", [resposta("m1", T), resposta("m2", T + 2000)]);
    await c.varrer();
    const mapa: Record<string, string | null> = { "conta-a": "uuid-a", "conta-b": null };
    let lote = c.paraNuvem((id) => mapa[id] ?? null);
    assert.equal(lote.linhas.length, 1, "a conta B ainda não está na nuvem: espera");
    assert.equal(lote.linhas[0]!.conta_id, "uuid-a");
    assert.equal(lote.linhas[0]!.respostas, 1);
    assert.deepEqual(Object.keys(lote.sessoes[0]!).sort(), ["agentes", "contas", "fim", "id", "inicio", "modelos", "projeto", "respostas", "tokens", "usd"]);
    c.confirmarEnvio(lote.chaves, lote.ids);
    escrever("s1.jsonl", [resposta("m3", T + 5)]);
    await c.varrer();
    lote = c.paraNuvem((id) => mapa[id] ?? null);
    assert.equal(lote.linhas[0]!.respostas, 2, "manda o total da hora: reenviar não duplica");
    mapa["conta-b"] = "uuid-b";
    c.confirmarEnvio(lote.chaves, lote.ids);
    lote = c.paraNuvem((id) => mapa[id] ?? null);
    assert.equal(lote.linhas.length, 1);
    assert.equal(lote.linhas[0]!.conta_id, "uuid-b");
    const semConta = new Contador(path.join(tmp, "r2"), path.join(tmp, "projects"), () => null, () => T);
    await semConta.varrer();
    assert.equal(semConta.paraNuvem(() => "x").linhas[0]!.conta_id, null);
  });

  test("respeita os limites de lote da nuvem (1000 linhas, 200 sessões)", async () => {
    const linhas = Array.from({ length: 450 }, (_, i) => resposta(`m${i}`, T + i * 3600, { sessao: `s${i}` }));
    escrever("s1.jsonl", linhas);
    await c.varrer();
    const lote = c.paraNuvem(() => "u");
    assert.ok(lote.linhas.length <= 1000);
    assert.equal(lote.sessoes.length, 200);
  });
});
