// As peças do instalador com rede falsa: Vercel, Supabase, DNS, canais de alerta, arquivos locais e argumentos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vercel, listar } from "../lib/vercel.mjs";
import { criarProjeto, conferirToken, organizacoes, projetos, regiaoSugerida } from "../lib/supabase.mjs";
import { dnsPronto, dominioPedido, dominioValido, passosCloudflare, passosDns } from "../lib/dominio.mjs";
import { acharChatTelegram, testar } from "../lib/alertas.mjs";
import { copiarEstado, criarLancador, gravarConfigLocal, gravarInstalacao, lancadorWindows, lerInstalacao, linhaPath, voltarAtualizacao } from "../lib/programa.mjs";
import { emailValido, senhaForte, t } from "../lib/texto.mjs";
import { dadosDaInstalacao, lerArgs, soEsteComputador } from "../instalar.mjs";

function rede(rotas) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = typeof init.body === "string" ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body;
    chamadas.push({ url, metodo: init.method || "GET", corpo, headers: init.headers || {} });
    for (const [padrao, resp] of rotas) {
      if (typeof padrao === "string" ? url.includes(padrao) : padrao.test(url)) {
        const r = typeof resp === "function" ? resp(url, init, chamadas) : resp;
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? r), { status: r.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ error: { message: `não esperado ${url}` } }), { status: 500 });
  };
  return { f, chamadas };
}

function pasta() {
  const d = mkdtempSync(path.join(os.tmpdir(), "reveza-inst-"));
  return { d, limpar: () => rmSync(d, { recursive: true, force: true }) };
}

test("argumentos: valor obrigatório, opção desconhecida e flags", () => {
  assert.deepEqual(lerArgs(["--foo"]), { erro: "opção desconhecida: --foo" });
  assert.equal(lerArgs(["--importar"]).erro, "--importar pede um valor");
  const a = lerArgs(["--sem-nuvem", "--idioma", "en"]);
  assert.ok(a.flags.has("--sem-nuvem"));
  assert.equal(a.valores["--idioma"], "en");
});

test("senha forte, e-mail e idioma", () => {
  assert.equal(senhaForte("curta1A"), false);
  assert.equal(senhaForte("semnumeroAAAAAA"), false);
  assert.equal(senhaForte("TemTudo12345"), true);
  assert.equal(emailValido("a'b@c.d"), false);
  assert.equal(t("oi", "hi"), "oi");
});

test("Vercel: cria o projeto que falta, sobe os arquivos por hash e espera a produção", async () => {
  const { d, limpar } = pasta();
  try {
    mkdirSync(path.join(d, "assets"));
    writeFileSync(path.join(d, "index.html"), "<html></html>");
    writeFileSync(path.join(d, "assets", "app.js"), "console.log(1)");
    writeFileSync(path.join(d, "vercel.json"), "{}");
    let leituras = 0;
    const { f, chamadas } = rede([
      ["/v9/projects/reveza", { status: 404, body: { error: { code: "not_found" } } }],
      ["/v11/projects", { id: "prj_1", name: "reveza" }],
      ["/v2/files", {}],
      ["/v13/deployments/dpl_1", () => ({ readyState: ++leituras < 2 ? "BUILDING" : "READY", alias: leituras < 4 ? ["reveza-equipe.vercel.app"] : ["reveza-equipe.vercel.app", "reveza.vercel.app"], url: "reveza-abc.vercel.app" })],
      [/\/v13\/deployments(\?|$)/, { id: "dpl_1", url: "reveza-abc.vercel.app" }],
    ]);
    const v = new Vercel("tok", { fetch: f, equipe: "team_9", esperar: async () => {} });
    const p = await v.projeto("reveza");
    assert.deepEqual(p, { id: "prj_1", nome: "reveza", novo: true });
    const r = await v.publicar(p, d);
    assert.equal(r.url, "https://reveza.vercel.app");
    const arquivos = chamadas.filter((c) => c.url.includes("/v2/files"));
    assert.equal(arquivos.length, 3);
    assert.ok(chamadas.every((c) => c.url.includes("teamId=team_9")));
    assert.ok(arquivos.every((c) => /^[0-9a-f]{40}$/.test(c.headers["x-vercel-digest"])));
    const dep = chamadas.find((c) => /\/v13\/deployments\?/.test(c.url));
    assert.equal(dep.corpo.target, "production");
    assert.deepEqual(dep.corpo.files.map((x) => x.file).sort(), ["assets/app.js", "index.html", "vercel.json"]);
    assert.equal(dep.corpo.projectSettings.framework, null);
  } finally { limpar(); }
});

test("Vercel: pasta sem index.html não publica; implantação com erro para", async () => {
  const { d, limpar } = pasta();
  try {
    const { f } = rede([]);
    await assert.rejects(new Vercel("t", { fetch: f }).publicar({ id: "p", nome: "x" }, d), /index\.html/);
    writeFileSync(path.join(d, "index.html"), "x");
    const r2 = rede([["/v2/files", {}], [/\/v13\/deployments$/, { id: "d" }], ["/v13/deployments/d", { readyState: "ERROR" }]]);
    await assert.rejects(new Vercel("t", { fetch: r2.f, esperar: async () => {} }).publicar({ id: "p", nome: "x" }, d), /ERROR/);
    assert.throws(() => listar(path.join(d, "nao-existe")));
  } finally { limpar(); }
});

test("Vercel: domínio próprio devolve o CNAME recomendado; apex usa A", async () => {
  const { f } = rede([
    ["/domains/contas.exemplo.com/config", { misconfigured: true, recommendedCNAME: [{ rank: 2, value: "b.vercel-dns.com." }, { rank: 1, value: "a.vercel-dns-017.com." }] }],
    ["/v10/projects/prj_1/domains", {}],
    ["/domains/exemplo.com/config", { misconfigured: true, recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }] }],
  ]);
  const v = new Vercel("t", { fetch: f });
  const r = await v.adicionarDominio({ id: "prj_1" }, "contas.exemplo.com");
  assert.deepEqual(r, { configurado: false, registro: { tipo: "CNAME", nome: "contas", valor: "a.vercel-dns-017.com" } });
  const apex = await v.registroDns("exemplo.com");
  assert.deepEqual(apex.registro, { tipo: "A", nome: "@", valor: "76.76.21.21" });
});

test("Vercel: domínio de outro projeto é recusado com mensagem clara", async () => {
  const { f } = rede([["/domains", { status: 409, body: { error: { code: "domain_already_in_use", message: "x" } } }]]);
  await assert.rejects(new Vercel("t", { fetch: f }).adicionarDominio({ id: "p" }, "a.exemplo.com"), /já está em outro projeto/);
});

test("Supabase: organizações, projetos, criação com região específica e token de organização", async () => {
  const { f, chamadas } = rede([
    ["/v1/organizations", [{ id: "x", slug: "minha-org", name: "Minha" }]],
    [/\/v1\/projects$/, (url, init) => (init.method === "POST" ? { id: "abcdefghijklmnopqrst" } : [{ ref: "abcdefghijklmnopqrst", name: "r", organization_slug: "minha-org", region: "sa-east-1", status: "ACTIVE_HEALTHY" }])],
  ]);
  const g = { pedir: async (m, c, corpo) => { const r = await f(`https://api.supabase.com${c}`, { method: m, body: corpo && JSON.stringify(corpo) }); if (!r.ok) { const e = new Error("x"); e.status = r.status; throw e; } return r.json(); } };
  assert.deepEqual(await organizacoes(g), [{ slug: "minha-org", nome: "Minha" }]);
  assert.equal((await projetos(g))[0].ref, "abcdefghijklmnopqrst");
  assert.equal(await criarProjeto(g, { org: "minha-org", regiao: "sa-east-1" }), "abcdefghijklmnopqrst");
  const criar = chamadas.find((c) => c.metodo === "POST");
  assert.equal(criar.corpo.organization_slug, "minha-org");
  assert.deepEqual(criar.corpo.region_selection, { type: "specific", code: "sa-east-1" });
  assert.ok(criar.corpo.db_pass.length >= 30);
  await assert.rejects(criarProjeto(g, { org: "x y", regiao: "sa-east-1" }), /organização inválida/);
  await assert.rejects(criarProjeto(g, { org: "x", regiao: "marte-1" }), /região desconhecida/);
  const g403 = { pedir: async () => { const e = new Error("x"); e.status = 403; throw e; } };
  assert.match((await conferirToken(g403)).erro, /token pessoal/);
});

test("região sugerida pelo fuso", () => {
  assert.equal(regiaoSugerida("America/Fortaleza"), "sa-east-1");
  assert.equal(regiaoSugerida("America/New_York"), "us-east-1");
  assert.equal(regiaoSugerida("Europe/Lisbon"), "eu-west-2");
  assert.equal(regiaoSugerida("Asia/Tokyo"), "ap-northeast-1");
  assert.equal(regiaoSugerida(""), "us-east-1");
});

test("domínio: validação, o passo a passo do DNS (qualquer provedor, a Cloudflare como observação) e DNS conferido de fora", async () => {
  assert.equal(dominioValido("https://Contas.Exemplo.com/"), "contas.exemplo.com");
  assert.equal(dominioValido("sem ponto"), null);
  assert.equal(dominioValido("a..b.com"), null);
  // nome absoluto (ponto final) e acento (punycode, inclusive no fim)
  assert.equal(dominioValido("contas.exemplo.com."), "contas.exemplo.com");
  assert.equal(dominioValido("painel.ação.com.br"), "painel.xn--ao-siap.com.br");
  assert.equal(dominioValido("contas.exemplo.xn--p1ai"), "contas.exemplo.xn--p1ai");
  assert.equal(dominioValido("contas.exemplo.com:8080"), null, "porta não");
  assert.equal(dominioValido("contas.exemplo.com/caminho"), null, "caminho não");
  const linhas = passosDns({ tipo: "CNAME", nome: "contas", valor: "cname.vercel-dns.com" }, t);
  assert.match(linhas[0], /No DNS de onde o domínio está \(registro\.br, Cloudflare, GoDaddy, Hostinger, Route 53 ou outro\)/, "neutro de provedor primeiro");
  assert.match(linhas[1], /Tipo: CNAME {4}Nome: contas {4}Valor: cname\.vercel-dns\.com/);
  assert.match(linhas[2], /certificado HTTPS/);
  assert.match(linhas.at(-1), /Na Cloudflare: .*DNS only/, "a Cloudflare vem por último, como observação");
  assert.equal(passosCloudflare, passosDns, "o nome antigo segue valendo");
  assert.match(passosDns({ tipo: "A", nome: "@", valor: "76.76.21.21" }, t)[1], /Tipo: A {4}Nome: @/);
  const ok = rede([["cloudflare-dns.com", { Answer: [{ data: "cname.vercel-dns.com." }] }]]);
  assert.equal(await dnsPronto("contas.exemplo.com", { tipo: "CNAME", valor: "cname.vercel-dns.com" }, { fetch: ok.f }), true);
  const nao = rede([["cloudflare-dns.com", { Answer: [{ data: "outro.com." }] }]]);
  assert.equal(await dnsPronto("contas.exemplo.com", { tipo: "CNAME", valor: "cname.vercel-dns.com" }, { fetch: nao.f }), false);
  assert.equal(await dnsPronto("x.com", { tipo: "A", valor: "1.1.1.1" }, { fetch: async () => { throw new Error("sem rede"); } }), false);
});

test("alertas: telegram acha a conversa, teste de cada canal e assinatura do webhook", async () => {
  const token = "123456:" + "A".repeat(35);
  const tg = rede([
    ["/getUpdates", { ok: true, result: [{ message: { chat: { id: 42, first_name: "Ana" } } }, { message: { chat: { id: 42, first_name: "Ana" } } }] }],
    ["/sendMessage", { ok: true }],
  ]);
  assert.deepEqual(await acharChatTelegram(token, { fetch: tg.f }), [{ id: "42", nome: "Ana" }]);
  await assert.rejects(acharChatTelegram("errado", { fetch: tg.f }), /formato estranho/);
  assert.deepEqual(await testar("telegram", { chat_id: "42" }, token, { fetch: tg.f }), { ok: true });

  // o ntfy saiu dos canais: o teste de envio recusa
  assert.deepEqual(await testar("ntfy", {}, "reveza-qualquer", { fetch: tg.f }), { ok: false, erro: "canal desconhecido" });

  const w = rede([["hook.exemplo.com", {}]]);
  assert.deepEqual(await testar("webhook", { url: "https://hook.exemplo.com/x" }, "segredo123", { fetch: w.f }), { ok: true });
  const c = w.chamadas[0];
  assert.equal(c.headers["X-Reveza-Assinatura"], "sha256=" + createHmac("sha256", "segredo123").update(JSON.stringify(c.corpo)).digest("hex"));
  assert.equal((await testar("webhook", { url: "http://x" }, "s", { fetch: w.f })).ok, false);

  const e = rede([["api.resend.com", { status: 403, body: "domínio não verificado" }]]);
  const r = await testar("email", { de: "a@b.com", para: "c@d.com" }, "re_x", { fetch: e.f });
  assert.equal(r.ok, false);
  assert.match(r.erro, /403/);
});

test("arquivos locais: configuração mescla no estado, instalação não guarda segredo, lançador executável", () => {
  const { d, limpar } = pasta();
  try {
    const est = path.join(d, "estado.json");
    writeFileSync(est, JSON.stringify({ formato: 1, ativa: "x", config: { intervaloS: 7 } }));
    gravarConfigLocal(est, { auto: false, modo: "limite" });
    const e = JSON.parse(readFileSync(est, "utf8"));
    assert.equal(e.ativa, "x");
    assert.deepEqual(e.config, { intervaloS: 7, auto: false, modo: "limite" });
    const inst = path.join(d, "instalacao.json");
    gravarInstalacao(inst, { nuvem: { url: "https://x.supabase.co", anon: "eyJpublica" } });
    assert.equal(lerInstalacao(inst).nuvem.url, "https://x.supabase.co");
    if (process.platform !== "win32") assert.equal(statSync(inst).mode & 0o777, 0o600);
    assert.throws(() => gravarInstalacao(inst, { nuvem: { token: "x" } }), /não guarda segredo/);
    assert.throws(() => gravarInstalacao(inst, { x: "sbp_" + "a".repeat(40) }), /não guarda segredo/);
    assert.equal(lerInstalacao(path.join(d, "nada.json")), null);
    const l = criarLancador(path.join(d, "bin"), "/app/cli.js", "/usr/bin/node");
    if (process.platform !== "win32") {
      assert.equal(readFileSync(l, "utf8"), '#!/bin/sh\nexec "/usr/bin/node" "/app/cli.js" "$@"\n');
      assert.ok(statSync(l).mode & 0o100);
    }
  } finally { limpar(); }
});

test("Windows: o reveza.cmd roda em UTF-8 (caminho com acento), volta à página de código e devolve a saída do agente", () => {
  const t = lancadorWindows("C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\João Silva\\.reveza\\app\\agente\\dist\\src\\cli.js");
  const linhas = t.split("\r\n");
  assert.ok(!t.replace(/\r\n/g, "").includes("\n"), "linhas do Windows");
  const utf8 = linhas.indexOf("chcp 65001 >nul");
  const node = linhas.findIndex((l) => l.includes("João Silva"));
  assert.ok(utf8 > 0 && node > utf8, "o caminho com acento só é lido depois de passar para UTF-8");
  assert.ok(linhas.slice(0, utf8).every((l) => /^[\x20-\x7e]*$/.test(l)), "antes do chcp, só ASCII");
  assert.equal(linhas[node], '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\João Silva\\.reveza\\app\\agente\\dist\\src\\cli.js" %*');
  assert.ok(linhas.includes("if defined REVEZA_CP chcp %REVEZA_CP% >nul") && linhas.includes("exit /b %REVEZA_SAIDA%"));
  // no Windows o PATH vai para o Path do usuário (o instalador pergunta antes); sem isso, mostra o caminho do reveza.cmd
  assert.deepEqual(linhaPath("C:\\Users\\x\\.reveza\\bin", "", true), { arquivo: "HKCU\\Environment", linha: "C:\\Users\\x\\.reveza\\bin\\reveza.cmd" });
});

test("erro do build mostra o começo, não o fim da pilha", async () => {
  const { trechoDoErro } = await import("../lib/painel.mjs");
  const t = trechoDoErro("vite v8\ntransforming...\nerror during build:\nError: faltou react-is\n    at x (a.js:1)\n    at y (b.js:2)");
  assert.match(t, /^error during build:\nError: faltou react-is$/);
});

test("filhos do instalador não herdam token nem senha", async () => {
  const { ambienteLimpo } = await import("../lib/programa.mjs");
  process.env.VERCEL_TOKEN = "v";
  process.env.REVEZA_ADMIN_SENHA = "SenhaForte123";
  try {
    const e = ambienteLimpo({ REVEZA_SENHA: "so-para-este" });
    assert.equal(e.VERCEL_TOKEN, undefined);
    assert.equal(e.REVEZA_ADMIN_SENHA, undefined);
    assert.equal(e.REVEZA_SENHA, "so-para-este");
    assert.equal(e.PATH, process.env.PATH);
  } finally {
    delete process.env.VERCEL_TOKEN;
    delete process.env.REVEZA_ADMIN_SENHA;
  }
});

test("Vercel: conexão que cai no meio é tentada de novo; erro que não é de rede não", async () => {
  let n = 0;
  const f = async () => {
    if (++n < 3) { const e = new TypeError("fetch failed"); e.cause = { message: "other side closed" }; throw e; }
    return new Response(JSON.stringify({ user: { username: "x" } }), { status: 200 });
  };
  const v = new Vercel("t", { fetch: f, esperar: async () => {} });
  assert.deepEqual(await v.pedir("GET", "/v2/user"), { user: { username: "x" } });
  assert.equal(n, 3);
  const v2 = new Vercel("t", { fetch: async () => { throw new Error("certificado inválido"); }, esperar: async () => {} });
  await assert.rejects(v2.pedir("GET", "/v2/user"), /certificado/);
});

test("conta os componentes do React Bits pela saída do script do painel", async () => {
  const { contarComponentes } = await import("../lib/painel.mjs");
  assert.equal(contarComponentes("baixados: CountUp, Aurora\njá estavam: BlurText  (use --forcar para baixar de novo)\npronto: /x"), 3);
  assert.equal(contarComponentes("pronto: /x"), 0);
});

test("a troca que valia no computador vai para a nuvem nova", async () => {
  const { trocaLocal } = await import("../instalar.mjs");
  const { d, limpar } = pasta();
  try {
    const arq = path.join(d, "estado.json");
    writeFileSync(arq, JSON.stringify({ config: { auto: true, modo: "limite", aviso: 90, troca: 95, intervaloS: 5 } }));
    assert.deepEqual(trocaLocal(arq), { auto: true, modo: "limite", aviso: 90, troca: 95 });
    writeFileSync(arq, JSON.stringify({ config: { auto: false, modo: "limiar", aviso: 97, troca: 95 } }));
    assert.deepEqual(trocaLocal(arq), { auto: false, modo: "limiar", aviso: 90, troca: 95 }, "limiares invertidos voltam ao padrão");
    assert.equal(trocaLocal(path.join(d, "nada.json")), null);
  } finally { limpar(); }
});

test("código de acesso do painel: o instalador lê o rvzc_ (só pede para entrar) e recusa os antigos, que levavam a frase", async () => {
  const { lerCodigoDeAcesso } = await import("../instalar.mjs");
  const a = { u: "https://abcdefghijklmnopqrst.supabase.co", k: "chave-publica", e: "pc-1@computadores.reveza.invalid", s: "s".repeat(48) };
  const codigo = "rvzc_" + Buffer.from(JSON.stringify(a)).toString("base64url");
  assert.deepEqual(lerCodigoDeAcesso(codigo), { url: a.u, anon: a.k, email: a.e, senha: a.s });
  assert.deepEqual(lerCodigoDeAcesso(`  ${codigo}\n`), { url: a.u, anon: a.k, email: a.e, senha: a.s }, "colado com espaço");
  assert.equal(lerCodigoDeAcesso("rvzc_" + Buffer.from("{}").toString("base64url")), null);
  assert.equal(lerCodigoDeAcesso("rvzc_!!"), null);
  assert.equal(lerCodigoDeAcesso("qualquer coisa"), null);
  // o de um passo só (rvzl_, com a frase do cofre) e o de antes (rvzpc_) não valem mais: o instalador pede um código novo
  const rvzl = "rvzl_" + Buffer.from(JSON.stringify({ ...a, f: "abacate bola casa dado elefante faca" })).toString("base64url");
  assert.deepEqual(lerCodigoDeAcesso(rvzl), { antigo: true });
  assert.deepEqual(lerCodigoDeAcesso("rvzpc_" + Buffer.from(JSON.stringify(a)).toString("base64url")), { antigo: true });
  // e a mensagem é clara
  const fonte = (await import("node:fs")).readFileSync(new URL("../instalar.mjs", import.meta.url), "utf8");
  assert.match(fonte, /gere um código novo no painel/);
});

test("dependências só pelas versões travadas: npm ci, sem script de terceiros, com package-lock.json no repositório", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const raiz = new URL("../../", import.meta.url).pathname;
  for (const p of ["agente", "painel"]) assert.ok(existsSync(`${raiz}${p}/package-lock.json`), `${p}/package-lock.json`);
  for (const f of ["instalador/lib/programa.mjs", "instalador/lib/painel.mjs", "instalador/instalar.mjs"]) {
    const fonte = readFileSync(`${raiz}${f}`, "utf8");
    assert.ok(!/rodar\(npm, \["install"/.test(fonte), `${f} ainda usa npm install`);
    for (const m of fonte.matchAll(/rodar\(npm, \["ci"([^\]]*)\]/g)) assert.match(m[1], /--ignore-scripts/, `${f}: npm ci sem --ignore-scripts`);
  }
});

test("programa: copia mesmo quando o repositório vem de dentro de node_modules (npx github:...), sem levar node_modules e dist", async () => {
  const { copiarPrograma } = await import("../lib/programa.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const base = mkdtempSync(path.join(os.tmpdir(), "reveza-copia-"));
  try {
    // como o npx deixa: ~/.npm/_npx/<hash>/node_modules/reveza
    const raiz = path.join(base, "_npx", "abc", "node_modules", "reveza");
    for (const f of ["agente/package.json", "agente/package-lock.json", "agente/src/cli.ts", "agente/node_modules/x/index.js", "agente/dist/src/cli.js", "mod/hooks/register.ts", "LICENSE"]) {
      mkdirSync(path.dirname(path.join(raiz, f)), { recursive: true });
      writeFileSync(path.join(raiz, f), "x");
    }
    const destino = path.join(base, "app.novo");
    copiarPrograma(raiz, destino);
    for (const f of ["agente/package.json", "agente/package-lock.json", "agente/src/cli.ts", "mod/hooks/register.ts", "LICENSE"]) assert.ok(existsSync(path.join(destino, f)), f);
    for (const f of ["agente/node_modules", "agente/dist"]) assert.ok(!existsSync(path.join(destino, f)), f);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("atualizar um computador ligado (sem ref da nuvem) não pede token: só o programa dele", () => {
  const ligado = { nuvem: { url: "https://abcdefghijklmnopqrst.supabase.co", anon: "x" }, painel: null };
  const principal = { nuvem: { ref: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", anon: "x", adminId: "a" } };
  assert.equal(soEsteComputador(ligado, true), true);
  assert.equal(soEsteComputador(principal, true), false, "o computador que criou a instalação ainda pode atualizar a nuvem");
  assert.equal(soEsteComputador(ligado, false), false, "sem --atualizar não vale");
  assert.equal(soEsteComputador({ nuvem: null }, true), false);
  assert.equal(soEsteComputador(null, true), false);
});

test("o instalacao.json sai logo depois do serviço, com o que já se sabe, e de novo no fim (instalação que parou antes do fim)", () => {
  // depois da nuvem e do serviço, antes do painel: a nuvem inteira, o painel ainda não
  const ctx = { app: "/x/app", sombra: false, semServico: false, url: "https://abcdefghijklmnopqrst.supabase.co", ref: "abcdefghijklmnopqrst", anon: "a", adminId: "ad", vapidPublica: "v" };
  const antes = dadosDaInstalacao(ctx, null);
  assert.deepEqual(antes.nuvem, { ref: "abcdefghijklmnopqrst", url: ctx.url, anon: "a", adminId: "ad", vapidPublica: "v" });
  assert.equal(antes.painel, null);
  // computador ligado pelo código do painel: só url e chave pública, sem ref (o --atualizar dele é só do programa)
  const ligado = dadosDaInstalacao({ app: "/x/app", ligado: { url: ctx.url, anon: "a" } }, null);
  assert.equal(soEsteComputador(ligado, true), true);
  // atualização: o que a instalação já tinha fica
  const inst = { instaladoEm: "2026-10-01T00:00:00.000Z", nuvem: { url: ctx.url, anon: "a" }, painel: { url: "https://p" } };
  const depois = dadosDaInstalacao({ app: "/x/app" }, inst);
  assert.equal(depois.instaladoEm, inst.instaladoEm);
  assert.deepEqual(depois.painel, inst.painel);
  // a ordem no instalador: gravado logo depois do serviço, antes do painel, das contas e dos alertas
  const fonte = readFileSync(new URL("../instalar.mjs", import.meta.url), "utf8");
  const servico = fonte.indexOf("await servico(ctx);");
  const gravado = fonte.indexOf("gravarInstalacao(ARQ_INST, dadosDaInstalacao(ctx, inst));", servico);
  assert.ok(servico > 0 && gravado > servico && gravado < fonte.indexOf('etapa("painel")', servico), "gravado logo depois do serviço");
});

test("antes de atualizar: cópia conferida do estado, sem o programa, e só as 5 cópias mais novas ficam", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "reveza-copia-"));
  try {
    writeFileSync(path.join(base, "estado.json"), '{"versao":1}');
    writeFileSync(path.join(base, "instalacao.json"), '{"versao":"0.1.5"}');
    mkdirSync(path.join(base, "contas", "a1"), { recursive: true });
    writeFileSync(path.join(base, "contas", "a1", ".credentials.json"), '{"claudeAiOauth":{}}');
    mkdirSync(path.join(base, "app", "agente"), { recursive: true });
    writeFileSync(path.join(base, "app", "agente", "x.js"), "programa");
    mkdirSync(path.join(base, "logs"), { recursive: true });
    mkdirSync(path.join(base, "copias"), { recursive: true });
    writeFileSync(path.join(base, "copias", "principal-123.json"), "{}");
    const c = copiarEstado(base, "antes-0.1.6", { agora: new Date("2026-10-12T03:00:00Z") });
    assert.equal(readFileSync(path.join(c, "contas", "a1", ".credentials.json"), "utf8"), '{"claudeAiOauth":{}}');
    assert.equal(readFileSync(path.join(c, "estado.json"), "utf8"), '{"versao":1}');
    assert.ok(!existsSync(path.join(c, "app")), "o programa não entra na cópia");
    assert.ok(!existsSync(path.join(c, "logs")));
    for (let i = 1; i <= 6; i++) copiarEstado(base, "antes-x", { agora: new Date(Date.UTC(2026, 9, 12, 4, i)) });
    const datadas = readdirSync(path.join(base, "copias")).filter((n) => /^\d{8}-/.test(n));
    assert.equal(datadas.length, 5, "só as 5 mais novas");
    assert.ok(!datadas.some((n) => n.startsWith("20261012-030000")), "a mais velha saiu");
    assert.ok(existsSync(path.join(base, "copias", "principal-123.json")), "a cópia de login antigo da principal fica");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("atualização que não subiu: o programa anterior volta, a configuração volta da cópia e os logins ficam os mais novos", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "reveza-volta-"));
  try {
    const app = path.join(base, "app");
    mkdirSync(path.join(base, "app.anterior"), { recursive: true });
    writeFileSync(path.join(base, "app.anterior", "v"), "0.1.5");
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(app, "v"), "0.1.6");
    writeFileSync(path.join(base, "estado.json"), '{"formato":"novo"}');
    mkdirSync(path.join(base, "contas", "a1"), { recursive: true });
    writeFileSync(path.join(base, "contas", "a1", ".credentials.json"), "token-antigo");
    const copia = copiarEstado(base, "antes-0.1.6");
    writeFileSync(path.join(base, "estado.json"), '{"formato":"escrito-pela-nova"}');
    writeFileSync(path.join(base, "contas", "a1", ".credentials.json"), "token-renovado");
    assert.equal(voltarAtualizacao(app, base, copia), true);
    assert.equal(readFileSync(path.join(app, "v"), "utf8"), "0.1.5");
    assert.equal(readFileSync(path.join(base, "app.falhou", "v"), "utf8"), "0.1.6", "a versão que falhou fica para olhar");
    assert.equal(readFileSync(path.join(base, "estado.json"), "utf8"), '{"formato":"novo"}');
    assert.equal(readFileSync(path.join(base, "contas", "a1", ".credentials.json"), "utf8"), "token-renovado", "login renovado não volta para o antigo");
    assert.equal(voltarAtualizacao(app, base, copia), false, "sem anterior, não há para onde voltar");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("--dominio: subdomínio conferido, 'vercel' volta ao endereço da Vercel, e REVEZA_DOMINIO segue valendo", () => {
  assert.equal(dominioPedido(undefined, {}), undefined, "sem pedir: fica o que já está");
  assert.equal(dominioPedido("Contas.Exemplo.com", {}), "contas.exemplo.com");
  assert.equal(dominioPedido("vercel", { REVEZA_DOMINIO: "outro.exemplo.com" }), null, "a opção vence a variável");
  assert.equal(dominioPedido(" VERCEL ", {}), null);
  assert.throws(() => dominioPedido("sem ponto", {}), /domínio inválido: sem ponto/);
  assert.equal(dominioPedido(undefined, { REVEZA_DOMINIO: "painel.exemplo.com" }), "painel.exemplo.com");
  assert.equal(dominioPedido(undefined, { REVEZA_DOMINIO: "vercel" }), null);
  assert.equal(dominioPedido(undefined, { REVEZA_DOMINIO: "inválido" }), undefined, "variável inválida é ignorada, como antes");
  const a = lerArgs(["--atualizar", "--dominio", "contas.exemplo.com"]);
  assert.equal(a.valores["--dominio"], "contas.exemplo.com");
  assert.equal(lerArgs(["--dominio"]).erro, "--dominio pede um valor");
});

test("trava da publicação: a segunda espera a primeira viva; morta, vencida ou do mesmo processo, a vez é desta", async () => {
  const { travarPublicacao, PUBLICACAO_TRAVA_MS } = await import("../lib/programa.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "reveza-trava-"));
  try {
    const arq = path.join(dir, "base", "publicando.json");
    const soltar = travarPublicacao(arq, { agora: 1_000_000, pid: 111 });
    assert.ok(soltar);
    assert.deepEqual(JSON.parse(readFileSync(arq, "utf8")), { pid: 111, desde: 1_000_000 });
    assert.equal(travarPublicacao(arq, { agora: 1_000_000 + 60_000, pid: 222, vivo: () => true }), null, "a primeira está viva");
    assert.ok(travarPublicacao(arq, { agora: 1_000_000 + 60_000, pid: 111, vivo: () => true }), "o mesmo processo");
    const morta = travarPublicacao(arq, { agora: 1_000_000 + 60_000, pid: 222, vivo: () => false });
    assert.ok(morta, "a primeira morreu: a vez é da segunda");
    assert.equal(JSON.parse(readFileSync(arq, "utf8")).pid, 222);
    soltar(); // a primeira, ao terminar, não apaga a trava da segunda
    assert.ok(existsSync(arq));
    assert.ok(travarPublicacao(arq, { agora: 1_000_000 + 60_000 + PUBLICACAO_TRAVA_MS, pid: 333, vivo: () => true }), "vencida");
    writeFileSync(arq, "{lixo");
    const nova = travarPublicacao(arq, { agora: 5, pid: 444 });
    assert.ok(nova, "ilegível: a vez é desta");
    nova();
    assert.equal(existsSync(arq), false, "solta ao terminar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
