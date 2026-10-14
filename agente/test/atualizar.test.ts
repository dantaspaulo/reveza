// Atualizar o programa a pedido do painel: a nuvem só manda o número da versão; o agente só aceita versão publicada do
// repositório oficial e maior que a dele, baixa do endereço fixo, extrai com o Node e roda o instalador dela num
// processo separado. Nada aqui chama o GitHub de verdade nem roda instalador: tudo com dublês.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acharInstalador,
  EXECUTOR_DA_ATUALIZACAO,
  escolherVersao,
  extrairTarGz,
  faltamNaNuvem,
  GithubOficial,
  lerPedido,
  MAIS_NOVA,
  lerComLimite,
  migracoesDoPacote,
  resumosDoPacote,
  modoAtualizar,
  naMadrugada,
  rodarSeparado,
  TAREFA_ATUALIZAR,
  URL_VERSOES,
  urlDoPacote,
  versoesPublicadas,
  type FonteVersoes,
} from "../src/atualizar.js";
import { VERSAO } from "../src/config.js";
import { ErroNuvem } from "../src/nuvem/tipos.js";
import { ativaEm, BancoFalso, ExecutorFalso, MIGRACOES_DO_PACOTE, montar, NuvemFalsa, pastaTemporaria, RelogioFalso, type Montado } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria> | null = null;
let m: Montado | null = null;
afterEach(() => {
  m?.limpar();
  m = null;
  tmp?.limpar();
  tmp = null;
});

/** Uma versão acima (ou abaixo) da deste agente, sem fixar número nos testes. */
function versaoMais(passo: number): string {
  const [a, b, c] = VERSAO.split(".").map(Number) as [number, number, number];
  return `${a}.${b}.${Math.max(0, c + passo)}`;
}
const NOVA = versaoMais(2);
const MEIO = versaoMais(1);

// ------------------------------------------------------------------------------------------------ um .tar.gz à mão

function cabecalho(nome: string, tamanho: number, tipo = "0", modo = 0o644, link = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(nome.slice(0, 100), 0, "utf8");
  h.write(modo.toString(8).padStart(7, "0") + "\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(tamanho.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(tipo, 156);
  h.write(link, 157);
  h.write("ustar\0", 257);
  h.write("00", 263);
  const soma = h.reduce((s, b) => s + b, 0);
  h.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

function blocos(b: Buffer): Buffer {
  return Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
}

function registroPax(chave: string, valor: string): Buffer {
  let tam = 0;
  let linha = "";
  for (let n = 1; n < 6; n++) {
    linha = ` ${chave}=${valor}\n`;
    tam = Buffer.byteLength(linha) + String(tam || Buffer.byteLength(linha) + n).length;
  }
  return Buffer.from(`${tam}${linha}`);
}

interface Entrada {
  nome: string;
  conteudo?: string;
  tipo?: string;
  modo?: number;
  link?: string;
  pax?: boolean;
}

function tarGz(entradas: Entrada[]): Buffer {
  const partes: Buffer[] = [];
  for (const e of entradas) {
    const corpo = Buffer.from(e.conteudo ?? "");
    let nome = e.nome;
    if (e.pax) {
      const rec = registroPax("path", e.nome);
      partes.push(cabecalho("PaxHeader/x", rec.length, "x"), blocos(rec));
      nome = "nome-curto";
    }
    partes.push(cabecalho(nome, e.tipo === "5" || e.tipo === "2" ? 0 : corpo.length, e.tipo ?? "0", e.modo ?? 0o644, e.link ?? ""));
    if (e.tipo !== "5" && e.tipo !== "2") partes.push(blocos(corpo));
  }
  partes.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(partes));
}

/**
 * O pacote de uma versão, como o GitHub monta (pasta reveza-X.Y.Z com package.json, o instalador e as migrações da
 * nuvem). `migracoes` null: pacote sem a pasta nuvem/migracoes.
 */
function pacote(versao: string, extra: Entrada[] = [], migracoes: string[] | null = MIGRACOES_DO_PACOTE): Buffer {
  const raiz = `reveza-${versao}`;
  return tarGz([
    { nome: "pax_global_header", conteudo: registroPax("comment", "abc123").toString(), tipo: "g" },
    { nome: `${raiz}/`, tipo: "5", modo: 0o755 },
    { nome: `${raiz}/package.json`, conteudo: JSON.stringify({ name: "reveza", version: versao }) },
    { nome: `${raiz}/instalador/instalar.mjs`, conteudo: "#!/usr/bin/env node\n", modo: 0o755 },
    ...(migracoes ?? []).map((n) => ({ nome: `${raiz}/nuvem/migracoes/${n}`, conteudo: "-- migração\n" })),
    ...extra,
  ]);
}

class VersoesFalsas implements FonteVersoes {
  baixadas: string[] = [];
  falharDownload: string | null = null;
  falharLista = false;
  constructor(public lista: string[] = [NOVA, MEIO, VERSAO], public conteudo: (v: string) => Buffer = (v) => pacote(v)) {}
  async publicadas() {
    if (this.falharLista) throw new Error("o GitHub respondeu 403 à lista de versões");
    return [...this.lista];
  }
  async baixar(versao: string, arquivo: string) {
    this.baixadas.push(versao);
    if (this.falharDownload) throw new Error(this.falharDownload);
    fs.writeFileSync(arquivo, this.conteudo(versao));
  }
}

// ------------------------------------------------------------------------------------------------ o pedido e a escolha

describe("o que a nuvem pode pedir", () => {
  test("só a versão: X.Y.Z ou a mais nova; endereço, caminho ou qualquer outro campo é recusado", () => {
    assert.deepEqual(lerPedido({ versao: MAIS_NOVA }), { ok: true, versao: MAIS_NOVA });
    assert.deepEqual(lerPedido({ versao: "0.1.7" }), { ok: true, versao: "0.1.7" });
    for (const corpo of [
      { versao: "https://exemplo.com/reveza.tar.gz" },
      { versao: "../../tmp/x" },
      { versao: "/tmp/instalar.mjs" },
      { versao: "0.1.7; rm -rf ~" },
      { versao: "v0.1.7" },
      { versao: "0.1" },
      { versao: 7 },
      { versao: "0.1.7", url: "https://exemplo.com/x.tgz" },
      { versao: "0.1.7", caminho: "/tmp/x" },
      { url: "https://exemplo.com/x.tgz" },
      // o Verificar atualização leva só { conferir: true }
      { conferir: "sim" },
      { conferir: false },
      { conferir: true, versao: "0.1.7" },
      { conferir: true, url: "https://exemplo.com/x.tgz" },
    ]) {
      assert.equal(lerPedido(corpo as Record<string, unknown>).ok, false, JSON.stringify(corpo));
    }
    assert.deepEqual(lerPedido({ conferir: true }), { ok: true, conferir: true });
  });

  test("o jeito de atualizar sozinho: true (de antes da escolha) continua de madrugada; valor estranho é desligada", () => {
    assert.equal(modoAtualizar(true), "madrugada");
    assert.equal(modoAtualizar("madrugada"), "madrugada");
    assert.equal(modoAtualizar("assim_que_sair"), "assim_que_sair");
    for (const v of [false, undefined, null, "desligada", "sempre", 1, {}]) assert.equal(modoAtualizar(v), "desligada", JSON.stringify(v));
  });

  test("o endereço do pacote é fixo no código: só a versão entra nele", () => {
    assert.equal(urlDoPacote("0.1.7"), "https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.7.tar.gz");
    assert.throws(() => urlDoPacote("0.1.7/../../x"));
    assert.equal(URL_VERSOES, "https://api.github.com/repos/dantaspaulo/reveza/releases?per_page=30");
  });

  test("versões publicadas: sem rascunho, sem pré-lançamento, só X.Y.Z, da mais nova à mais velha", () => {
    const api = [
      { tag_name: "v0.1.6", draft: false, prerelease: false },
      { tag_name: "v0.2.0", draft: true, prerelease: false },
      { tag_name: "v0.1.10", draft: false, prerelease: false },
      { tag_name: "v0.1.9-beta", draft: false, prerelease: false },
      { tag_name: "v0.1.8", draft: false, prerelease: true },
      { tag_name: "lixo", draft: false, prerelease: false },
      null,
    ];
    assert.deepEqual(versoesPublicadas(api), ["0.1.10", "0.1.6"]);
    assert.deepEqual(versoesPublicadas({ message: "API rate limit exceeded" }), []);
  });

  test("só versão MAIOR que a atual e publicada: nada de voltar, nada de igual, nada fora da lista", () => {
    const pub = ["0.1.10", "0.1.7", "0.1.6"];
    assert.deepEqual(escolherVersao(MAIS_NOVA, "0.1.6", pub), { ok: true, versao: "0.1.10" });
    assert.deepEqual(escolherVersao("0.1.7", "0.1.6", pub), { ok: true, versao: "0.1.7" });
    assert.match((escolherVersao("0.1.6", "0.1.6", pub) as { erro: string }).erro, /não é mais nova/);
    assert.match((escolherVersao("0.1.6", "0.1.7", pub) as { erro: string }).erro, /não volta versão/);
    assert.match((escolherVersao("0.1.9", "0.1.6", pub) as { erro: string }).erro, /não é uma versão publicada/);
    assert.match((escolherVersao(MAIS_NOVA, "0.1.10", pub) as { erro: string }).erro, /já está na versão mais nova/);
    assert.equal(escolherVersao(MAIS_NOVA, "0.1.6", []).ok, false);
  });
});

describe("o GitHub oficial", () => {
  function fetchFalso(respostas: Record<string, Response | (() => Response)>) {
    const pedidos: string[] = [];
    const f = (async (url: string | URL) => {
      const u = String(url);
      pedidos.push(u);
      const r = respostas[u];
      if (!r) throw new Error(`endereço inesperado: ${u}`);
      return typeof r === "function" ? r() : r;
    }) as unknown as typeof fetch;
    return { f, pedidos };
  }

  test("a lista vem do endereço fixo da API", async () => {
    const { f, pedidos } = fetchFalso({ [URL_VERSOES]: new Response(JSON.stringify([{ tag_name: "v9.0.0", draft: false, prerelease: false }])) });
    assert.deepEqual(await new GithubOficial("0.1.0", f).publicadas(), ["9.0.0"]);
    assert.deepEqual(pedidos, [URL_VERSOES]);
  });

  test("o pacote vem do endereço fixo, seguindo o redirecionamento só para o codeload do GitHub", async () => {
    tmp = pastaTemporaria();
    const fixo = urlDoPacote("0.1.7");
    const codeload = "https://codeload.github.com/dantaspaulo/reveza/tar.gz/refs/tags/v0.1.7";
    const { f, pedidos } = fetchFalso({
      [fixo]: () => new Response(null, { status: 302, headers: { location: codeload } }),
      [codeload]: () => new Response(pacote("0.1.7")),
    });
    const arq = path.join(tmp.dir, "p.tgz");
    await new GithubOficial("0.1.0", f).baixar("0.1.7", arq);
    assert.deepEqual(pedidos, [fixo, codeload]);
    assert.ok(fs.statSync(arq).size > 0);
    const mau = fetchFalso({ [fixo]: () => new Response(null, { status: 302, headers: { location: "https://exemplo.com/mau.tgz" } }) });
    await assert.rejects(new GithubOficial("0.1.0", mau.f).baixar("0.1.7", arq), /para fora do GitHub/);
    const http = fetchFalso({ [fixo]: () => new Response(null, { status: 302, headers: { location: "http://codeload.github.com/x" } }) });
    await assert.rejects(new GithubOficial("0.1.0", http.f).baixar("0.1.7", arq), /para fora do GitHub/);
    // no GitHub, mas fora do repositório oficial (renomeado ou transferido): recusado
    const outro = fetchFalso({ [fixo]: () => new Response(null, { status: 302, headers: { location: "https://codeload.github.com/outra/reveza/tar.gz/v0.1.7" } }) });
    await assert.rejects(new GithubOficial("0.1.0", outro.f).baixar("0.1.7", arq), /fora do repositório oficial/);
  });

  test("o corpo do pacote para no limite enquanto chega (sem content-length)", async () => {
    const pedacos = (n: number, tam: number) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(tam));
          c.close();
        },
      });
    assert.equal((await lerComLimite(new Response(pedacos(3, 10)), 30)).length, 30);
    await assert.rejects(lerComLimite(new Response(pedacos(4, 10)), 30), /grande demais/);
  });
});

// ------------------------------------------------------------------------------------------------ o pacote

describe("extrair o pacote com o Node", () => {
  test("arquivos, pastas, nome longo (pax) e o bit de executável; o instalador é achado e a versão conferida", () => {
    tmp = pastaTemporaria();
    const arq = path.join(tmp.dir, "p.tgz");
    const longo = `reveza-0.1.7/${"pasta-com-nome-comprido/".repeat(6)}arquivo.txt`;
    fs.writeFileSync(arq, pacote("0.1.7", [{ nome: longo, conteudo: "longo", pax: true }]));
    const destino = path.join(tmp.dir, "x");
    const escritos = extrairTarGz(arq, destino);
    assert.ok(escritos.includes(longo));
    assert.equal(fs.readFileSync(path.join(destino, longo), "utf8"), "longo");
    const instalador = acharInstalador(destino, "0.1.7");
    assert.equal(instalador, path.join(destino, "reveza-0.1.7", "instalador", "instalar.mjs"));
    if (process.platform !== "win32") assert.ok((fs.statSync(instalador).mode & 0o111) !== 0);
    assert.throws(() => acharInstalador(destino, "0.1.8"), /não é o da 0\.1\.8/);
  });

  test("caminho para fora da pasta, absoluto, ou link: o pacote inteiro é recusado", () => {
    tmp = pastaTemporaria();
    for (const mau of [
      { nome: "reveza-0.1.7/../../fora.txt", conteudo: "x" },
      { nome: "reveza-0.1.7/a/../b.txt", conteudo: "x" },
      { nome: "/etc/fora.txt", conteudo: "x" },
      { nome: "C:/Windows/fora.txt", conteudo: "x" },
      { nome: "reveza-0.1.7/link", tipo: "2", link: "/etc/passwd" },
      { nome: "reveza-0.1.7/duro", tipo: "1", link: "/etc/passwd" },
    ]) {
      const arq = path.join(tmp.dir, "mau.tgz");
      fs.writeFileSync(arq, tarGz([mau]));
      assert.throws(() => extrairTarGz(arq, path.join(tmp!.dir, "y")), /inválido|link/, mau.nome);
    }
    assert.equal(fs.existsSync(path.join(tmp.dir, "fora.txt")), false);
    // tamanho negativo ou que não lê no cabeçalho: recusado (o negativo voltava ao mesmo cabeçalho para sempre)
    for (const tamanho of ["-0001000\0", "\x80\0\0\0\0\0\0\0\0\0\0\x10", "xyz\0"]) {
      const h = cabecalho("reveza-0.1.7/a.txt", 0);
      h.fill(0, 124, 136);
      h.write(tamanho, 124, "latin1");
      h.write("        ", 148);
      const soma = h.reduce((s, b) => s + b, 0);
      h.write(soma.toString(8).padStart(6, "0") + "\0 ", 148);
      const arq = path.join(tmp.dir, "tamanho.tgz");
      fs.writeFileSync(arq, zlib.gzipSync(Buffer.concat([h, Buffer.alloc(1024)])));
      assert.throws(() => extrairTarGz(arq, path.join(tmp!.dir, "z")), /tamanho no cabeçalho/, JSON.stringify(tamanho));
    }
  });

  test("o pacote de verdade (git archive do repositório, como o GitHub monta) se extrai inteiro", (t) => {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const r = spawnSync("git", ["archive", "--format=tar.gz", "--prefix=reveza-teste/", "HEAD"], { cwd: raiz, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) return t.skip("sem git aqui");
    tmp = pastaTemporaria();
    const arq = path.join(tmp.dir, "repo.tgz");
    fs.writeFileSync(arq, r.stdout);
    const escritos = extrairTarGz(arq, path.join(tmp.dir, "repo"));
    const versao = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8")).version;
    assert.ok(escritos.length > 50);
    assert.equal(acharInstalador(path.join(tmp.dir, "repo"), versao), path.join(tmp.dir, "repo", "reveza-teste", "instalador", "instalar.mjs"));
    // as migrações que o pacote traz são as de nuvem/migracoes, com o mesmo filtro do instalador
    const doRepo = fs.readdirSync(path.join(raiz, "nuvem", "migracoes")).filter((n) => n.endsWith(".sql")).sort();
    assert.deepEqual(migracoesDoPacote(path.join(tmp.dir, "repo", "reveza-teste")), doRepo);
    assert.ok(doRepo.includes("0020_atualizar_escolha.sql"));
  });

  test("as migrações do pacote e as que faltam na nuvem (pelo nome); pacote sem a pasta é recusado", () => {
    tmp = pastaTemporaria();
    const arq = path.join(tmp.dir, "p.tgz");
    fs.writeFileSync(arq, pacote("0.1.7", [], ["0002_b.sql", "0001_a.sql", ".oculta.sql", "LEIA.md"]));
    extrairTarGz(arq, path.join(tmp.dir, "x"));
    assert.deepEqual(migracoesDoPacote(path.join(tmp.dir, "x", "reveza-0.1.7")), ["0001_a.sql", "0002_b.sql"]);
    assert.deepEqual(faltamNaNuvem(["0001_a.sql", "0002_b.sql", "0003_c.sql"], ["0002_b.sql", "0001_a.sql", "0009_outra.sql"]), ["0003_c.sql"]);
    assert.deepEqual(faltamNaNuvem(["0001_a.sql"], ["0001_a.sql"]), []);
    // com os resumos: o mesmo nome com outro conteúdo também falta; o resumo com CRLF vale; nuvem sem resumo, só o nome
    const resumos = resumosDoPacote(path.join(tmp.dir, "x", "reveza-0.1.7"));
    const lf = createHash("sha256").update("-- migração\n").digest("hex");
    const crlf = createHash("sha256").update("-- migração\r\n").digest("hex");
    assert.deepEqual(resumos["0001_a.sql"], [lf, crlf]);
    const nomes = ["0001_a.sql", "0002_b.sql"];
    assert.deepEqual(faltamNaNuvem(nomes, { nomes, hashes: { "0001_a.sql": crlf, "0002_b.sql": "a".repeat(64) } }, resumos), ["0002_b.sql"]);
    assert.deepEqual(faltamNaNuvem(nomes, { nomes, hashes: { "0001_a.sql": lf, "0002_b.sql": lf } }, resumos), []);
    assert.deepEqual(faltamNaNuvem(nomes, { nomes, hashes: null }, resumos), []);
    assert.deepEqual(faltamNaNuvem(nomes, { nomes, hashes: { "0002_b.sql": "a".repeat(64) } }, null), [], "sem os resumos do pacote: só o nome");
    fs.writeFileSync(arq, pacote("0.1.8", [], null));
    extrairTarGz(arq, path.join(tmp.dir, "y"));
    assert.throws(() => migracoesDoPacote(path.join(tmp!.dir, "y", "reveza-0.1.8")), /não tem as migrações da nuvem/);
  });
});

// ------------------------------------------------------------------------------------------------ o processo separado

describe("o instalador roda num processo separado, que sobrevive à troca do agente", () => {
  const base = (sistema: "macos" | "linux" | "windows", exec: ExecutorFalso, env: NodeJS.ProcessEnv = {}) => ({
    sistema,
    exec,
    node: "/n/node",
    env,
    pasta: tmp!.dir,
    instalador: "/p/instalador/instalar.mjs",
    log: path.join(tmp!.dir, "a.log"),
    resultado: path.join(tmp!.dir, "r.json"),
    args: ["--atualizar", "--sim"],
  });

  test("macOS: destacado, com a saída no log, pelo executor que grava o resultado", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    await rodarSeparado(base("macos", exec));
    const executor = path.join(tmp.dir, "executar-atualizacao.mjs");
    assert.equal(fs.readFileSync(executor, "utf8"), EXECUTOR_DA_ATUALIZACAO);
    assert.deepEqual(exec.iniciados.map((x) => x.argv), [["/n/node", executor, "/p/instalador/instalar.mjs", path.join(tmp.dir, "a.log"), path.join(tmp.dir, "r.json"), "--atualizar", "--sim"]]);
    assert.ok(typeof exec.iniciados[0]!.op.solto?.saida === "number", "solto: sobrevive ao agente");
  });

  test("Linux com o agente no systemd: num escopo próprio (reiniciar o serviço não derruba o instalador); sem systemd, destacado", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    await rodarSeparado(base("linux", exec, { INVOCATION_ID: "abc" }));
    assert.deepEqual(exec.iniciados[0]!.argv.slice(0, 5), ["systemd-run", "--user", "--scope", "--quiet", "/n/node"]);
    const sem = new ExecutorFalso();
    await rodarSeparado(base("linux", sem));
    assert.equal(sem.iniciados[0]!.argv[0], "/n/node");
  });

  test("Windows: uma tarefa própria do Agendador, sem janela, rodando uma vez", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[0] === "whoami" ? { codigo: 0, saida: '"pc\\\\ana","S-1-5-21-9"\r\n', erro: "" } : { codigo: 0, saida: "", erro: "" });
    await rodarSeparado({ ...base("windows", exec, { SystemRoot: "C:\\Windows" }), node: "C:\\Program Files\\nodejs\\node.exe" });
    const comandos = exec.chamadas.map((c) => c.argv.slice(0, 4).join(" "));
    assert.deepEqual(comandos.filter((c) => c.startsWith("schtasks")), [`schtasks /Create /F /TN`, `schtasks /Run /TN ${TAREFA_ATUALIZAR}`]);
    const xml = fs.readFileSync(path.join(tmp.dir, "tarefa-atualizar.xml")).subarray(2).toString("utf16le");
    assert.match(xml, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command>/);
    assert.match(xml, /<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; .*executar-atualizacao\.mjs.* --atualizar --sim<\/Arguments>/);
    assert.match(xml, /<UserId>S-1-5-21-9<\/UserId>/);
    assert.ok(!/<Triggers>/.test(xml), "sem gatilho: roda só pelo /Run");
    assert.equal(exec.iniciados.length, 0);
  });
});

// ------------------------------------------------------------------------------------------------ o agente

describe("o agente atualiza o próprio programa a pedido do painel", () => {
  let banco: BancoFalso;
  let exec: ExecutorFalso;
  async function preparar(versoes = new VersoesFalsas()) {
    banco = new BancoFalso();
    exec = new ExecutorFalso();
    m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), exec, versoes });
    banco.agora = () => m!.relogio.agora();
    await m.agente.busca();
    return versoes;
  }
  async function pedir(id: number, corpo: Record<string, unknown>) {
    banco.comandos.push({ id, acao: "atualizar", corpo, pc: "pc-1", estado: "pendente" });
    await m!.agente.busca();
    return banco.comandos.find((c) => c.id === id)! as { estado: string; http?: number; resposta?: Record<string, unknown> };
  }
  const pendente = () => JSON.parse(fs.readFileSync(path.join(m!.c.base, "atualizacao.json"), "utf8"));

  test("a mais nova publicada: baixa pelo endereço da versão, roda o instalador dela com --atualizar --sim e registra quem pediu", async () => {
    const v = await preparar();
    const cmd = await pedir(1, { versao: MAIS_NOVA });
    assert.equal(cmd.estado, "feito", JSON.stringify(cmd.resposta));
    assert.deepEqual(cmd.resposta, { ok: true, atualizando: true, de: VERSAO, para: NOVA });
    assert.deepEqual(v.baixadas, [NOVA]);
    const p = pendente();
    assert.equal(p.para, NOVA);
    assert.equal(p.comando, 1);
    const [iniciado] = exec.iniciados;
    assert.equal(iniciado!.argv[0], "/falso/node");
    assert.match(iniciado!.argv[2]!, new RegExp(`reveza-${NOVA.replace(/\./g, "\\.")}[\\\\/]instalador[\\\\/]instalar\\.mjs$`));
    assert.deepEqual(iniciado!.argv.slice(5), ["--atualizar", "--sim"], "sem token: só este computador");
    assert.deepEqual(iniciado!.op.env, { PATH: "/falso/bin" });
    const ev = banco.eventos.find((e) => (e.dados as { atualizacao?: string }).atualizacao === "pedida");
    assert.ok(ev, "a nuvem fica sabendo (e a auditoria tem quem criou o comando 1)");
    assert.deepEqual({ ...(ev!.dados as object) }, { atualizacao: "pedida", de: VERSAO, para: NOVA, comando: 1, sozinho: false });
    // outra enquanto esta não termina: recusada
    const outra = await pedir(2, { versao: MAIS_NOVA });
    assert.equal(outra.estado, "recusado");
    assert.match(String(outra.resposta?.erro), /já há uma atualização em andamento/);
  });

  test("versão menor, igual, não publicada, ou pedido com endereço: recusado sem baixar nada", async () => {
    const v = await preparar();
    for (const [id, corpo, erro] of [
      [1, { versao: versaoMais(-1) === VERSAO ? "0.0.0" : versaoMais(-1) }, /não|publicada/],
      [2, { versao: VERSAO }, /não é mais nova/],
      [3, { versao: "9.9.9" }, /não é uma versão publicada/],
      [4, { versao: NOVA, url: "https://exemplo.com/mau.tgz" }, /só leva a versão/],
      [5, { url: "https://exemplo.com/mau.tgz" }, /só leva a versão/],
      [6, { versao: "https://exemplo.com/mau.tgz" }, /versão inválida/],
    ] as const) {
      const cmd = await pedir(id, corpo);
      assert.equal(cmd.estado, "recusado", JSON.stringify(corpo));
      assert.match(String(cmd.resposta?.erro), erro, JSON.stringify(corpo));
    }
    assert.deepEqual(v.baixadas, []);
    assert.equal(exec.iniciados.length, 0);
  });

  test("sem corpo, o 'atualizar' segue sendo reler as contas (painel antigo)", async () => {
    const v = await preparar();
    const cmd = await pedir(1, {});
    assert.equal(cmd.estado, "feito");
    assert.deepEqual(cmd.resposta, { ok: true });
    assert.deepEqual(v.baixadas, []);
  });

  test("falha no download ou pacote estranho vira evento de falha na nuvem, e nada roda", async () => {
    const v = new VersoesFalsas();
    v.falharDownload = "o GitHub respondeu 503 ao pacote";
    await preparar(v);
    const cmd = await pedir(1, { versao: NOVA });
    assert.equal(cmd.estado, "recusado");
    assert.match(String(cmd.resposta?.erro), /não começou: o GitHub respondeu 503/);
    const ev = banco.eventos.find((e) => e.tipo === "erro" && (e.dados as { atualizacao?: string }).atualizacao === "falhou");
    assert.ok(ev);
    assert.match(ev!.texto, /não começou/);
    assert.equal(exec.iniciados.length, 0);
    assert.equal(fs.existsSync(path.join(m!.c.base, "atualizacao.json")), false);
    // o pacote que diz ser de outra versão também não roda
    v.falharDownload = null;
    v.conteudo = () => pacote("9.9.9");
    const c2 = await pedir(2, { versao: NOVA });
    assert.match(String(c2.resposta?.erro), /não é o da/);
    assert.equal(exec.iniciados.length, 0);
    // sem conseguir ler a lista de versões: não começa
    v.falharLista = true;
    const c3 = await pedir(3, { versao: NOVA });
    assert.match(String(c3.resposta?.erro), /não consegui ler as versões publicadas/);
  });

  test("o instalador falhou e este agente segue na versão antiga: vira evento de falha com o motivo do log, e libera outra", async () => {
    await preparar();
    await pedir(1, { versao: NOVA });
    const p = pendente();
    fs.writeFileSync(p.log, "\u001b[32m✓\u001b[0m cópia do estado\n  Parei: npm install do agente falhou: ETIMEDOUT\n");
    await m!.agente.busca();
    assert.ok(!banco.eventos.some((e) => (e.dados as { atualizacao?: string }).atualizacao === "falhou"), "sem o resultado, ainda em andamento");
    fs.writeFileSync(p.resultado, JSON.stringify({ codigo: 1 }));
    await m!.agente.busca();
    const ev = banco.eventos.find((e) => (e.dados as { atualizacao?: string }).atualizacao === "falhou")!;
    assert.equal((ev.dados as { motivo: string }).motivo, "Parei: npm install do agente falhou: ETIMEDOUT");
    assert.match(ev.texto, new RegExp(`segue na ${VERSAO.replace(/\./g, "\\.")}`));
    assert.equal(fs.existsSync(path.join(m!.c.base, "atualizacao.json")), false);
    assert.equal(fs.existsSync(p.pasta), false, "a pasta temporária sai");
  });

  test("o agente novo subiu na versão pedida: conta que atualizou (a pasta só sai quando o instalador terminou)", async () => {
    await preparar();
    tmp = pastaTemporaria();
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-atualizar-"));
    fs.writeFileSync(
      path.join(m!.c.base, "atualizacao.json"),
      JSON.stringify({ de: "0.0.1", para: VERSAO, comando: 7, em: m!.relogio.agora(), pasta, log: path.join(pasta, "a.log"), resultado: path.join(pasta, "r.json") }),
    );
    await m!.agente.busca();
    const ev = banco.eventos.filter((e) => (e.dados as { atualizacao?: string }).atualizacao === "concluida");
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.texto, `Atualizado de 0.0.1 para ${VERSAO}.`);
    assert.ok(fs.existsSync(pasta), "o instalador ainda roda dali");
    fs.writeFileSync(path.join(pasta, "r.json"), JSON.stringify({ codigo: 0 }));
    await m!.agente.busca();
    assert.equal(banco.eventos.filter((e) => (e.dados as { atualizacao?: string }).atualizacao === "concluida").length, 1, "conta uma vez só");
    assert.equal(fs.existsSync(pasta), false);
  });

  test("a versão mais nova publicada é lida no máximo a cada 6 h, e fica guardada para depois do reinício", async () => {
    const v = await preparar();
    let leituras = 0;
    const lista = v.publicadas.bind(v);
    v.publicadas = async () => (leituras++, lista());
    await m!.agente.conferirVersaoNova();
    assert.equal(m!.agente.versaoNova, NOVA);
    await m!.relogio.avancar(5 * 3600 * 1000);
    await m!.agente.conferirVersaoNova();
    const antes = leituras;
    await m!.relogio.avancar(2 * 3600 * 1000);
    await m!.agente.conferirVersaoNova();
    assert.equal(leituras, antes + 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m!.c.base, "versoes.json"), "utf8")).maisNova, NOVA);
  });
});

// ------------------------------------------------------------------------------------------------ sozinho de madrugada

describe("atualizar sozinho de madrugada", () => {
  /** 13/10/2026, 03:30 em São Paulo (UTC-3, sem horário de verão). */
  const MADRUGADA_SP = Date.UTC(2026, 9, 13, 6, 30) / 1000;

  test("a janela é das 3h às 5h no fuso da instalação; fuso desconhecido cai no do banco", () => {
    assert.equal(naMadrugada(MADRUGADA_SP, "America/Sao_Paulo"), true);
    assert.equal(naMadrugada(Date.UTC(2026, 9, 13, 5, 59) / 1000, "America/Sao_Paulo"), false, "02:59");
    assert.equal(naMadrugada(Date.UTC(2026, 9, 13, 6, 0) / 1000, "America/Sao_Paulo"), true, "03:00");
    assert.equal(naMadrugada(Date.UTC(2026, 9, 13, 8, 0) / 1000, "America/Sao_Paulo"), false, "05:00");
    assert.equal(naMadrugada(MADRUGADA_SP, "Asia/Tokyo"), false, "15:30 em Tóquio");
    assert.equal(naMadrugada(Date.UTC(2026, 9, 12, 18, 30) / 1000, "Asia/Tokyo"), true, "03:30 em Tóquio");
    assert.equal(naMadrugada(MADRUGADA_SP, "Fuso/Inventado"), true);
    assert.equal(naMadrugada(MADRUGADA_SP, null), true);
  });

  const montados: Montado[] = [];
  afterEach(() => {
    while (montados.length) montados.pop()!.limpar();
  });

  async function computador(banco: BancoFalso, pc: string, versoes = new VersoesFalsas()) {
    const relogio = new RelogioFalso();
    relogio.t = MADRUGADA_SP;
    const exec = new ExecutorFalso();
    const mm = await montar({ nuvem: new NuvemFalsa(banco, pc), exec, versoes, relogio });
    montados.push(mm);
    mm.agente.estado.trocadaEm = 0;
    await mm.agente.conferirVersaoNova();
    return { m: mm, exec, versoes };
  }
  function bancoLigado(fuso = "America/Sao_Paulo") {
    const banco = new BancoFalso();
    banco.config = { ...banco.config, atualizar_sozinho: true, fuso };
    banco.agora = () => MADRUGADA_SP;
    return banco;
  }

  test("desligada de fábrica: nem pede a vez", async () => {
    const banco = new BancoFalso();
    banco.agora = () => MADRUGADA_SP;
    const a = await computador(banco, "pc-1");
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0);
    assert.ok(!banco.chamadas.some((c) => c.fn === "vezDeAtualizar"));
  });

  test("ligada, de madrugada e com versão nova: atualiza pelo mesmo caminho do botão (oficial, maior, --atualizar --sim)", async () => {
    const banco = bancoLigado();
    const a = await computador(banco, "pc-1");
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1);
    assert.deepEqual(a.exec.iniciados[0]!.argv.slice(5), ["--atualizar", "--sim"]);
    assert.deepEqual(a.versoes.baixadas, [NOVA]);
    assert.equal(banco.vez?.pc, "pc-1");
    const ev = banco.eventos.find((e) => (e.dados as { atualizacao?: string }).atualizacao === "pedida")!;
    assert.equal((ev.dados as { sozinho: boolean }).sozinho, true);
    assert.match(ev.texto, /sozinho, de madrugada/);
  });

  test("fora da janela (no fuso da instalação) não atualiza", async () => {
    const banco = bancoLigado("Asia/Tokyo");
    const a = await computador(banco, "pc-1");
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0);
  });

  test("com troca de conta em andamento ou sessão no limite, espera um momento calmo", async () => {
    const banco = bancoLigado();
    const a = await computador(banco, "pc-1");
    a.m.agente.estado.trocadaEm = MADRUGADA_SP - 60;
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0, "trocou de conta há 1 minuto");
    a.m.agente.estado.trocadaEm = 0;
    a.m.agente.estado.fila.unshift({ sessao: "s1", cwd: "/x", tipo: "interativa", em: MADRUGADA_SP - 30, estado: "aguardando", conta: null });
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0, "uma sessão parou no limite agora");
    a.m.agente.estado.fila = [];
    await ativaEm(a.m, "A", 100);
    a.m.agente.estado.trocadaEm = 0;
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0, "a conta em uso está no limite");
    assert.equal(a.m.agente.momentoCalmo(), false);
  });

  test("um computador por vez: o segundo só começa quando o primeiro voltou na versão nova", async () => {
    const banco = bancoLigado();
    const a = await computador(banco, "pc-1");
    const b = await computador(banco, "pc-2");
    await a.m.agente.busca();
    await b.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1);
    assert.equal(b.exec.iniciados.length, 0, "o primeiro ainda não voltou");
    // o primeiro voltou na versão nova (o agente novo manda a versão no agente_ola)
    banco.versoes.set("pc-1", NOVA);
    await b.m.relogio.avancar(301_000);
    await b.m.agente.busca();
    assert.equal(b.exec.iniciados.length, 1);
    assert.equal(banco.vez?.pc, "pc-2");
  });

  test("o primeiro voltou para a anterior: conta à nuvem, vira alerta, e os outros não atualizam", async () => {
    const banco = bancoLigado();
    const a = await computador(banco, "pc-1");
    const b = await computador(banco, "pc-2");
    await a.m.agente.busca();
    const p = JSON.parse(fs.readFileSync(path.join(a.m.c.base, "atualizacao.json"), "utf8"));
    fs.writeFileSync(p.log, "  o agente novo não respondeu em 30 s: voltando para a versão anterior\n");
    fs.writeFileSync(p.resultado, JSON.stringify({ codigo: 1 }));
    await a.m.agente.busca(); // o agente antigo, de volta, conta como terminou
    assert.equal(banco.vez?.estado, "falhou");
    assert.equal(banco.alertas.length, 1);
    assert.match(String(banco.alertas[0]!.texto), /voltando para a versão anterior/);
    await b.m.agente.busca();
    assert.equal(b.exec.iniciados.length, 0, "os outros param");
    // e o primeiro também não tenta de novo sozinho
    await a.m.relogio.avancar(301_000);
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1);
  });

  test("o pacote nem baixou: libera a vez sem alerta e só tenta de novo na noite seguinte", async () => {
    const banco = bancoLigado();
    const v = new VersoesFalsas();
    v.falharDownload = "o GitHub respondeu 503 ao pacote";
    const a = await computador(banco, "pc-1", v);
    await a.m.agente.busca();
    assert.equal(banco.vez, null, "a vez ficou livre");
    assert.equal(banco.alertas.length, 0);
    v.falharDownload = null;
    await a.m.relogio.avancar(301_000);
    await a.m.agente.busca();
    assert.deepEqual(v.baixadas, [NOVA], "não tenta de novo na mesma noite");
  });
});

// ------------------------------------------------------------------------------------------------ verificar agora

/** 13/10/2026, 15:30 em São Paulo: fora da madrugada. */
const TARDE_SP = Date.UTC(2026, 9, 13, 18, 30) / 1000;
const NOVA_MIGRACAO = "0021_nova.sql";
const comNovaMigracao = (v: string) => pacote(v, [], [...MIGRACOES_DO_PACOTE, NOVA_MIGRACAO]);
const doTipo = (banco: BancoFalso, atualizacao: string) => banco.eventos.filter((e) => (e.dados as { atualizacao?: string }).atualizacao === atualizacao);

describe("Verificar atualização: o painel pede que cada computador confira agora", () => {
  let banco: BancoFalso;
  let exec: ExecutorFalso;
  let nuvem: NuvemFalsa;
  async function preparar(versoes = new VersoesFalsas(), config: Record<string, unknown> = {}, t = TARDE_SP) {
    banco = new BancoFalso();
    banco.config = { ...banco.config, ...config };
    exec = new ExecutorFalso();
    nuvem = new NuvemFalsa(banco, "pc-1");
    const relogio = new RelogioFalso();
    relogio.t = t;
    m = await montar({ nuvem, exec, versoes, relogio, diagnostico: async () => ({ conferencias: [] }) });
    banco.agora = () => m!.relogio.agora();
    m.agente.estado.trocadaEm = 0;
    await m.agente.busca();
    return versoes;
  }
  let ids = 100;
  async function pedir(corpo: Record<string, unknown>) {
    const id = ++ids;
    banco.comandos.push({ id, acao: "atualizar", corpo, pc: "pc-1", estado: "pendente" });
    await m!.agente.busca();
    return banco.comandos.find((c) => c.id === id)! as { estado: string; http?: number; resposta?: Record<string, unknown> };
  }
  const olasComDiagnostico = () => banco.chamadas.filter((c) => c.fn === "ola" && c.args[1] !== null).length;

  test("lê a versão publicada agora (sem esperar as 6 horas), conta o que achou e o cartão do computador recebe", async () => {
    const v = await preparar(new VersoesFalsas([VERSAO]));
    let leituras = 0;
    const lista = v.publicadas.bind(v);
    v.publicadas = async () => (leituras++, lista());
    await m!.agente.conferirVersaoNova();
    assert.equal(m!.agente.versaoNova, VERSAO);
    // saiu uma versão nova uma hora depois: o ciclo normal só veria em 6 horas
    v.lista = [NOVA, VERSAO];
    await m!.relogio.avancar(3600 * 1000);
    await m!.agente.conferirVersaoNova();
    assert.equal(m!.agente.versaoNova, VERSAO);
    const antes = leituras;
    const cmd = await pedir({ conferir: true });
    assert.equal(cmd.estado, "feito", JSON.stringify(cmd.resposta));
    assert.deepEqual(cmd.resposta, { ok: true, conferido: true, atual: VERSAO, mais_nova: NOVA, nova: true, atualizando: null, precisa_nuvem: false });
    assert.equal(leituras, antes + 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m!.c.base, "versoes.json"), "utf8")).maisNova, NOVA);
    // a próxima busca leva o diagnóstico novo (com a versão nova) para o cartão do computador, sem esperar os 10 minutos
    const diagAntes = olasComDiagnostico();
    await m!.agente.busca();
    assert.equal(olasComDiagnostico(), diagAntes + 1);
    // desligada: só conferiu, nada baixou nem rodou
    assert.deepEqual(v.baixadas, []);
    assert.equal(exec.iniciados.length, 0);
    // dois cliques seguidos: uma leitura só por minuto (a API do GitHub dá 60 por hora)
    await pedir({ conferir: true });
    assert.equal(leituras, antes + 1);
    await m!.relogio.avancar(61_000);
    await pedir({ conferir: true });
    assert.equal(leituras, antes + 2);
  });

  test("já na mais nova: diz que está em dia; sem conseguir ler o GitHub, recusa com o motivo", async () => {
    const v = await preparar(new VersoesFalsas([VERSAO, MEIO.replace(/\d+$/, "0")]));
    const cmd = await pedir({ conferir: true });
    assert.equal(cmd.estado, "feito");
    assert.equal(cmd.resposta?.nova, false);
    assert.equal(cmd.resposta?.mais_nova, VERSAO);
    v.falharLista = true;
    await m!.relogio.avancar(61_000);
    const falha = await pedir({ conferir: true });
    assert.equal(falha.estado, "recusado");
    assert.match(String(falha.resposta?.erro), /não consegui ler as versões publicadas/);
  });

  test("com 'assim que sair', o computador acha a versão nova no Verificar e já começa sozinho", async () => {
    const v = await preparar(new VersoesFalsas([VERSAO]), { atualizar_sozinho: "assim_que_sair" });
    await m!.agente.conferirVersaoNova();
    v.lista = [NOVA, VERSAO];
    await m!.agente.busca();
    assert.equal(exec.iniciados.length, 0, "ainda não sabe da versão nova");
    await m!.relogio.avancar(61_000);
    const cmd = await pedir({ conferir: true });
    assert.equal(cmd.resposta?.nova, true);
    await m!.agente.busca();
    assert.equal(exec.iniciados.length, 1, "achou e começou, com a vez da nuvem");
    assert.equal(banco.vez?.pc, "pc-1");
    const [ev] = doTipo(banco, "pedida");
    assert.match(ev!.texto, /sozinho, assim que saiu/);
    assert.deepEqual({ ...(ev!.dados as object) }, { atualizacao: "pedida", de: VERSAO, para: NOVA, comando: null, sozinho: true, modo: "assim_que_sair" });
    // e o Verificar de novo conta que está atualizando
    await m!.relogio.avancar(61_000);
    assert.equal((await pedir({ conferir: true })).resposta?.atualizando, NOVA);
  });

  test("com 'de madrugada', o Verificar acha a versão nova mas a atualização espera a janela das 3h às 5h", async () => {
    await preparar(new VersoesFalsas(), { atualizar_sozinho: true });
    const cmd = await pedir({ conferir: true });
    assert.equal(cmd.resposta?.nova, true);
    await m!.agente.busca();
    assert.equal(exec.iniciados.length, 0);
    assert.ok(!banco.chamadas.some((c) => c.fn === "vezDeAtualizar"), "fora da janela nem pede a vez");
  });
});

// ------------------------------------------------------------------------------------------------ assim que sair

describe("atualizar sozinho assim que sair", () => {
  const montados: Montado[] = [];
  afterEach(() => {
    while (montados.length) montados.pop()!.limpar();
  });

  async function computador(banco: BancoFalso, pc: string, versoes = new VersoesFalsas()) {
    const relogio = new RelogioFalso();
    relogio.t = TARDE_SP;
    const exec = new ExecutorFalso();
    const mm = await montar({ nuvem: new NuvemFalsa(banco, pc), exec, versoes, relogio });
    montados.push(mm);
    mm.agente.estado.trocadaEm = 0;
    await mm.agente.conferirVersaoNova();
    return { m: mm, exec, versoes };
  }
  function bancoCom(valor: unknown) {
    const banco = new BancoFalso();
    banco.config = { ...banco.config, atualizar_sozinho: valor };
    banco.agora = () => TARDE_SP;
    return banco;
  }

  test("atualiza a qualquer hora, assim que acha a versão nova, pelo mesmo caminho do botão (oficial, maior, --atualizar --sim)", async () => {
    const banco = bancoCom("assim_que_sair");
    const a = await computador(banco, "pc-1");
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1);
    assert.deepEqual(a.exec.iniciados[0]!.argv.slice(5), ["--atualizar", "--sim"]);
    assert.deepEqual(a.versoes.baixadas, [NOVA]);
    const p = JSON.parse(fs.readFileSync(path.join(a.m.c.base, "atualizacao.json"), "utf8"));
    assert.equal(p.modo, "assim_que_sair");
  });

  test("de madrugada (o true de antes ou o nome) não atualiza à tarde, e desligada nem pede a vez", async () => {
    for (const valor of [true, "madrugada", false, "desligada", "qualquer"]) {
      const banco = bancoCom(valor);
      const a = await computador(banco, "pc-1");
      await a.m.agente.busca();
      assert.equal(a.exec.iniciados.length, 0, JSON.stringify(valor));
      assert.ok(!banco.chamadas.some((c) => c.fn === "vezDeAtualizar"), JSON.stringify(valor));
    }
  });

  test("só com o computador calmo: troca de conta em andamento ou sessão no limite fazem esperar", async () => {
    const banco = bancoCom("assim_que_sair");
    const a = await computador(banco, "pc-1");
    a.m.agente.estado.trocadaEm = TARDE_SP - 60;
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0, "trocou de conta há 1 minuto");
    a.m.agente.estado.trocadaEm = 0;
    a.m.agente.estado.fila.unshift({ sessao: "s1", cwd: "/x", tipo: "interativa", em: TARDE_SP - 30, estado: "aguardando", conta: null });
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 0, "uma sessão parou no limite agora");
    a.m.agente.estado.fila = [];
    await a.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1, "calmo: segue");
  });

  test("um computador por vez: o segundo só começa quando o primeiro voltou na versão nova", async () => {
    const banco = bancoCom("assim_que_sair");
    const a = await computador(banco, "pc-1");
    const b = await computador(banco, "pc-2");
    await a.m.agente.busca();
    await b.m.agente.busca();
    assert.equal(a.exec.iniciados.length, 1);
    assert.equal(b.exec.iniciados.length, 0, "o primeiro ainda não voltou");
    banco.versoes.set("pc-1", NOVA);
    await b.m.relogio.avancar(301_000);
    await b.m.agente.busca();
    assert.equal(b.exec.iniciados.length, 1);
  });

  test("o pacote nem baixou: libera a vez e tenta de novo em uma hora (não na noite seguinte)", async () => {
    const banco = bancoCom("assim_que_sair");
    const v = new VersoesFalsas();
    v.falharDownload = "o GitHub respondeu 503 ao pacote";
    const a = await computador(banco, "pc-1", v);
    await a.m.agente.busca();
    assert.equal(banco.vez, null);
    v.falharDownload = null;
    await a.m.relogio.avancar(30 * 60_000);
    await a.m.agente.busca();
    assert.deepEqual(v.baixadas, [NOVA], "meia hora depois, ainda não");
    await a.m.relogio.avancar(31 * 60_000);
    await a.m.agente.busca();
    assert.deepEqual(v.baixadas, [NOVA, NOVA]);
    assert.equal(a.exec.iniciados.length, 1);
  });
});

// ------------------------------------------------------------------------------------------------ a trava

describe("a trava de compatibilidade: sem as migrações da versão nova na nuvem, o programa não troca", () => {
  let banco: BancoFalso;
  let exec: ExecutorFalso;
  let nuvem: NuvemFalsa;
  async function preparar(versoes = new VersoesFalsas(undefined, comNovaMigracao)) {
    banco = new BancoFalso();
    exec = new ExecutorFalso();
    nuvem = new NuvemFalsa(banco, "pc-1");
    m = await montar({ nuvem, exec, versoes });
    banco.agora = () => m!.relogio.agora();
    await m.agente.busca();
    return versoes;
  }
  let ids = 200;
  async function pedir(corpo: Record<string, unknown>) {
    const id = ++ids;
    banco.comandos.push({ id, acao: "atualizar", corpo, pc: "pc-1", estado: "pendente" });
    await m!.agente.busca();
    return banco.comandos.find((c) => c.id === id)! as { estado: string; http?: number; resposta?: Record<string, unknown> };
  }
  const restos = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("reveza-atualizar-"));

  test("faltando migração, o botão recusa com o aviso de atualizar a nuvem, sem rodar nada e sem deixar o pacote", async () => {
    const v = await preparar();
    const antes = new Set(restos());
    const cmd = await pedir({ versao: MAIS_NOVA });
    assert.equal(cmd.estado, "recusado");
    assert.equal(cmd.http, 409);
    assert.deepEqual(cmd.resposta, {
      ok: false,
      erro: `a versão ${NOVA} precisa da nuvem atualizada primeiro: use Atualizar a nuvem, no painel (Computadores)`,
      precisa_nuvem: true,
      para: NOVA,
      faltam: [NOVA_MIGRACAO],
    });
    assert.equal(exec.iniciados.length, 0, "o instalador não roda");
    assert.equal(fs.existsSync(path.join(m!.c.base, "atualizacao.json")), false);
    assert.deepEqual(restos().filter((n) => !antes.has(n)), [], "a pasta do pacote sai");
    const [ev] = doTipo(banco, "precisa_nuvem");
    assert.match(ev!.texto, /precisa da nuvem atualizada primeiro: use Atualizar a nuvem, no painel/);
    assert.deepEqual((ev!.dados as { faltam: string[] }).faltam, [NOVA_MIGRACAO]);
    assert.equal(m!.agente.travaNuvem?.para, NOVA);
    // de novo: confere a nuvem antes de baixar outra vez, e o aviso não se repete
    const outra = await pedir({ versao: MAIS_NOVA });
    assert.equal(outra.resposta?.precisa_nuvem, true);
    assert.deepEqual(v.baixadas, [NOVA]);
    assert.equal(doTipo(banco, "precisa_nuvem").length, 1);
    // e o Verificar conta que a mais nova precisa da nuvem
    const conferida = await pedir({ conferir: true });
    assert.equal(conferida.resposta?.mais_nova, NOVA);
    assert.equal(conferida.resposta?.precisa_nuvem, true);
  });

  test("a nuvem foi atualizada: o mesmo pedido agora atualiza", async () => {
    await preparar();
    assert.equal((await pedir({ versao: MAIS_NOVA })).resposta?.precisa_nuvem, true);
    banco.migracoes!.push(NOVA_MIGRACAO);
    const cmd = await pedir({ versao: MAIS_NOVA });
    assert.equal(cmd.estado, "feito", JSON.stringify(cmd.resposta));
    assert.equal(cmd.resposta?.atualizando, true);
    assert.equal(exec.iniciados.length, 1);
    assert.equal(m!.agente.travaNuvem, null);
  });

  test("o mesmo nome com outro conteúdo (reaplicável que mudou) falta até a nuvem chegar nesta versão; adiante, basta o nome", async () => {
    await preparar();
    banco.migracoes!.push(NOVA_MIGRACAO);
    const lf = createHash("sha256").update("-- migração\n").digest("hex");
    const crlf = createHash("sha256").update("-- migração\r\n").digest("hex");
    banco.hashesMigracoes = { "0001_base.sql": crlf, "0099_permissoes.sql": "a".repeat(64), [NOVA_MIGRACAO]: lf };
    const cmd = await pedir({ versao: MAIS_NOVA });
    assert.equal(cmd.http, 409, JSON.stringify(cmd.resposta));
    assert.deepEqual(cmd.resposta?.faltam, ["0099_permissoes.sql"], "o resumo registrado com CRLF vale; o da 0099 é de outra versão");
    assert.equal(exec.iniciados.length, 0);
    // a nuvem já está nesta versão (ou adiante): a 0099 dela pode ser mais nova que a do pacote
    banco.config = { ...banco.config, nuvem_versao: NOVA };
    const depois = await pedir({ versao: MAIS_NOVA });
    assert.equal(depois.estado, "feito", JSON.stringify(depois.resposta));
    assert.equal(exec.iniciados.length, 1);
  });

  test("nuvem de antes da 0.2.1 (sem a função) ou sem o registro conta como desatualizada; sem rede, não atualiza e não trava", async () => {
    await preparar(new VersoesFalsas());
    banco.semFuncaoMigracoes = true;
    const semFuncao = await pedir({ versao: MAIS_NOVA });
    assert.equal(semFuncao.http, 409);
    assert.equal(semFuncao.resposta?.precisa_nuvem, true);
    assert.equal(semFuncao.resposta?.faltam, null);
    banco.semFuncaoMigracoes = false;
    banco.migracoes = null;
    const semRegistro = await pedir({ versao: MAIS_NOVA });
    assert.equal(semRegistro.resposta?.precisa_nuvem, true);
    assert.equal(exec.iniciados.length, 0);
    // sem rede na hora de conferir: não se sabe, então não atualiza, mas também não fica travado
    banco.migracoes = [...MIGRACOES_DO_PACOTE];
    m!.agente.travaNuvem = null;
    nuvem.migracoesAplicadas = async () => {
      throw new ErroNuvem("fetch failed", true);
    };
    const semRede = await pedir({ versao: MAIS_NOVA });
    assert.equal(semRede.estado, "recusado");
    assert.equal(semRede.http, 503);
    assert.match(String(semRede.resposta?.erro), /não consegui conferir as migrações da nuvem/);
    assert.equal(semRede.resposta?.precisa_nuvem, undefined);
    assert.equal(m!.agente.travaNuvem, null);
    assert.equal(exec.iniciados.length, 0);
    // a nuvem respondeu: atualiza
    nuvem.migracoesAplicadas = NuvemFalsa.prototype.migracoesAplicadas.bind(nuvem);
    assert.equal((await pedir({ versao: MAIS_NOVA })).estado, "feito");
    assert.equal(exec.iniciados.length, 1);
  });

  test("pacote sem as migrações da nuvem: recusado, nada roda", async () => {
    await preparar(new VersoesFalsas(undefined, (v) => pacote(v, [], null)));
    const cmd = await pedir({ versao: MAIS_NOVA });
    assert.equal(cmd.estado, "recusado");
    assert.match(String(cmd.resposta?.erro), /não tem as migrações da nuvem/);
    assert.equal(exec.iniciados.length, 0);
  });

  test("sozinho: a trava devolve a vez sem alerta, espera a nuvem sem baixar de novo, e segue quando a migração chega", async () => {
    const MADRUGADA_SP = Date.UTC(2026, 9, 13, 6, 30) / 1000;
    for (const [valor, t] of [["assim_que_sair", TARDE_SP], [true, MADRUGADA_SP]] as const) {
      banco = new BancoFalso();
      banco.config = { ...banco.config, atualizar_sozinho: valor };
      exec = new ExecutorFalso();
      const relogio = new RelogioFalso();
      relogio.t = t;
      const v = new VersoesFalsas(undefined, comNovaMigracao);
      m?.limpar();
      m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), exec, versoes: v, relogio });
      banco.agora = () => m!.relogio.agora();
      m.agente.estado.trocadaEm = 0;
      await m.agente.conferirVersaoNova();
      await m.agente.busca();
      assert.deepEqual(v.baixadas, [NOVA], String(valor));
      assert.equal(exec.iniciados.length, 0);
      assert.equal(banco.vez, null, "a vez volta livre para os outros");
      assert.equal(banco.alertas.length, 0, "não é falha: é a nuvem atrás");
      assert.equal(doTipo(banco, "precisa_nuvem").length, 1);
      const vezes = () => banco.chamadas.filter((c) => c.fn === "vezDeAtualizar").length;
      const pedidas = vezes();
      // a nuvem ainda sem a migração: confere de 5 em 5 minutos, sem pedir a vez nem baixar
      for (let i = 0; i < 3; i++) {
        await m.relogio.avancar(301_000);
        await m.agente.busca();
      }
      assert.equal(vezes(), pedidas);
      assert.deepEqual(v.baixadas, [NOVA]);
      // a nuvem foi atualizada: na conferência seguinte, pede a vez e atualiza
      banco.migracoes!.push(NOVA_MIGRACAO);
      await m.relogio.avancar(301_000);
      await m.agente.busca();
      assert.equal(exec.iniciados.length, 1, String(valor));
      assert.deepEqual(v.baixadas, [NOVA, NOVA]);
      assert.equal((banco.vez as BancoFalso["vez"])?.pc, "pc-1");
    }
  });
});
