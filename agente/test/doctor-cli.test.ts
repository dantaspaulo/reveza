// `reveza doctor`, a linha de comando e o oauthAccount do ~/.claude.json.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { doctor, textoDoctor, compararVersao, acharMod } from "../src/doctor.js";
import { executarCli, lerArgs, linhaConta, textoJanela, type Ambiente } from "../src/cli.js";
import { ClaudeJson } from "../src/claudejson.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa, SEGREDO_COFRE } from "../src/cofre/guarda.js";
import { Contador } from "../src/registro/contador.js";
import { ApiFalsa, BancoFalso, blob, CliFalsa, ExecutorFalso, NuvemFalsa, pastaTemporaria, RelogioFalso, T0 } from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria>;
afterEach(() => tmp?.limpar());

describe("doctor", () => {
  function deps(extra: Partial<Parameters<typeof doctor>[0]> = {}) {
    const cred = new CredenciaisFalsas();
    cred.d.set("principal", blob("A1"));
    const guarda = new GuardaFalsa();
    return {
      c: tmp.c,
      cred,
      guarda,
      cli: new CliFalsa(),
      api: new ApiFalsa(),
      statusServico: async () => ({ instalado: true, rodando: true, detalhe: "rodando" }),
      ponte: async () => ({ nuvem: { online: true }, cofre: true }),
      nuvemConfigurada: async () => ({ url: "https://exemplo.supabase.co" }),
      horaNuvem: async () => T0 + 5,
      agora: () => T0,
      espacoLivre: () => 50 * 1024 ** 3,
      ...extra,
    };
  }

  test("tudo funcionando: conferências na ordem, com o e-mail da conta em uso", async () => {
    tmp = pastaTemporaria();
    const d = deps();
    await d.guarda.gravar(SEGREDO_COFRE, Buffer.alloc(32, 1).toString("base64"));
    const r = await doctor(d);
    assert.deepEqual(r.map((x) => x.id), ["agente", "disco", "servico", "ponte", "mod", "credenciais", "contas", "chaveiro", "nuvem", "relogio", "assistente"]);
    assert.equal(r.find((x) => x.id === "credenciais")!.situacao, "ok");
    assert.match(r.find((x) => x.id === "credenciais")!.detalhe, /a@exemplo\.com/);
    assert.equal(r.find((x) => x.id === "relogio")!.situacao, "ok");
    assert.ok(!JSON.stringify(r).includes("A1"), "nada de token no diagnóstico");
  });

  test("relógio fora, serviço parado, sem credencial e sem chave do cofre aparecem", async () => {
    tmp = pastaTemporaria();
    const d = deps({
      horaNuvem: async () => T0 + 600,
      statusServico: async () => ({ instalado: false, rodando: false, detalhe: "" }),
      ponte: async () => null,
    });
    (d.cred as CredenciaisFalsas).d.clear();
    const r = await doctor(d);
    const s = (id: string) => r.find((x) => x.id === id)!.situacao;
    assert.equal(s("relogio"), "falha");
    assert.equal(s("servico"), "falha");
    assert.equal(s("credenciais"), "falha");
    assert.equal(s("chaveiro"), "aviso");
    assert.match(textoDoctor(r), /falha\(s\)/);
  });

  test("outro programa na porta do agente não passa por agente", async () => {
    tmp = pastaTemporaria();
    const r = await doctor(deps({ ponte: async () => ({ ativa: "x", contas: [] }) }));
    const p = r.find((x) => x.id === "ponte")!;
    assert.equal(p.situacao, "falha");
    assert.match(p.detalhe, /outro programa/);
  });

  test("mod achado pelo CLAUDE_CODE_PLUGIN_DIRS do settings.json", () => {
    tmp = pastaTemporaria();
    const mod = path.join(tmp.dir, "mod");
    fs.mkdirSync(path.join(mod, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(mod, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "reveza" }));
    assert.equal(acharMod(tmp.c.home), null);
    fs.writeFileSync(path.join(tmp.c.principalDir, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: mod } }));
    assert.equal(acharMod(tmp.c.home), mod);
  });

  test("comparar versões", () => {
    assert.ok(compararVersao("2.1.293", "2.1.0") > 0);
    assert.ok(compararVersao("18.16.0", "18.17.0") < 0);
    assert.equal(compararVersao("1.0.0", "1.0.0"), 0);
  });
});

describe("linha de comando", () => {
  function ambiente(extra: Partial<Ambiente> = {}): Ambiente & { saidas: string[]; erros: string[] } {
    const saidas: string[] = [];
    const erros: string[] = [];
    const guarda = new GuardaFalsa();
    return {
      c: tmp.c,
      sistema: "macos",
      exec: new ExecutorFalso(),
      relogio: new RelogioFalso(),
      saida: (t) => saidas.push(t),
      erro: (t) => erros.push(t),
      perguntar: async () => "",
      env: { REVEZA_PORTA: "1" },
      script: "/app/cli.js",
      fabricas: { cred: () => new CredenciaisFalsas(), guarda: async () => guarda, api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => null },
      saidas,
      erros,
      ...extra,
    };
  }

  test("argumentos", () => {
    assert.deepEqual(lerArgs(["uso", "--dias", "7", "--csv"]), { pos: ["uso"], flags: { dias: "7", csv: true } });
    assert.deepEqual(lerArgs(["importar", "--de=/x"]), { pos: ["importar"], flags: { de: "/x" } });
  });

  test("ajuda sem marca de terceiros", async () => {
    tmp = pastaTemporaria();
    const a = ambiente();
    assert.equal(await executarCli([], a), 0);
    assert.match(a.saidas.join("\n"), /reveza/);
    assert.ok(!/claude/i.test(a.saidas.join("\n")));
  });

  test("uso --csv e --json leem o registro local", async () => {
    tmp = pastaTemporaria();
    const proj = path.join(tmp.c.projetos, "-x-proj");
    fs.mkdirSync(proj, { recursive: true });
    const ts = Math.floor(Date.now() / 1000) - 60;
    const linha = { type: "assistant", sessionId: "s", cwd: "/x/proj", timestamp: new Date(ts * 1000).toISOString(), message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 0, output_tokens: 1_000_000 } } };
    fs.writeFileSync(path.join(proj, "s.jsonl"), JSON.stringify(linha) + "\n");
    await new Contador(tmp.c.registro, tmp.c.projetos, () => null).varrer();
    const csv = ambiente();
    assert.equal(await executarCli(["uso", "--csv", "--dias", "2"], csv), 0);
    assert.equal(csv.saidas[0], "hora,conta,modelo,projeto,respostas,entrada,saida,cache_escrita,cache_leitura,usd");
    assert.match(csv.saidas[1]!, /,\(sem conta\),claude-opus-5-5,proj,1,0,1000000,0,0,20\.0000$/);
    const js = ambiente();
    await executarCli(["uso", "--json"], js);
    assert.equal(JSON.parse(js.saidas.join("")).totais.usd, 20);
    const txt = ambiente();
    await executarCli(["uso"], txt);
    assert.match(txt.saidas[0]!, /US\$ 20\.00/);
  });

  test("status com o agente parado mostra o último estado salvo", async () => {
    tmp = pastaTemporaria();
    const a = ambiente();
    assert.equal(await executarCli(["status"], a), 0);
    assert.match(a.saidas.join("\n"), /parado/);
  });

  test("trocar sem agente rodando avisa", async () => {
    tmp = pastaTemporaria();
    const a = ambiente();
    assert.equal(await executarCli(["trocar", "b@exemplo.com"], a), 1);
    assert.match(a.erros.join("\n"), /não está rodando/);
  });

  test("cofre iniciar cria a chave uma vez", async () => {
    tmp = pastaTemporaria();
    const a = ambiente();
    await executarCli(["cofre", "iniciar"], a);
    await executarCli(["cofre", "iniciar"], a);
    assert.deepEqual(a.saidas, ["Chave do cofre criada neste computador.", "Este computador já tem a chave do cofre."]);
  });

  test("cofre iniciar que perde a corrida (outro computador gravou a impressão primeiro) apaga a chave nova e recusa", async () => {
    tmp = pastaTemporaria();
    const banco = new BancoFalso();
    const guarda = new GuardaFalsa();
    const a = ambiente();
    a.fabricas!.guarda = async () => guarda;
    a.fabricas!.nuvem = async () => {
      const n = new NuvemFalsa(banco, "pc-1");
      let vez = 0;
      // na conferência antes de criar, ainda não há impressão; na gravação depois, a do outro já está lá
      n.cofreImpressao = async () => (vez++ === 0 ? null : "f".repeat(32));
      return n;
    };
    assert.equal(await executarCli(["cofre", "iniciar"], a), 1);
    assert.match(a.erros.join("\n"), /outro computador criou a chave do cofre desta instalação primeiro/);
    assert.equal(await guarda.ler(SEGREDO_COFRE), null, "a chave que perdeu sai");
  });

  test("nuvem entrar guarda a identidade (senha pelo ambiente, nunca no argv)", async () => {
    tmp = pastaTemporaria();
    const guarda = new GuardaFalsa();
    const a = ambiente({ env: { REVEZA_SENHA: "s".repeat(64) } });
    a.fabricas!.guarda = async () => guarda;
    assert.equal(await executarCli(["nuvem", "entrar", "--url", "https://exemplo.supabase.co", "--chave-publica", "chave-anon", "--email", "pc@exemplo.com"], a), 0);
    assert.equal(JSON.parse((await guarda.ler("computador"))!).email, "pc@exemplo.com");
    const curta = ambiente({ env: { REVEZA_SENHA: "curta" } });
    assert.equal(await executarCli(["nuvem", "entrar", "--url", "https://x.supabase.co", "--chave-publica", "k", "--email", "e@x.com"], curta), 1);
  });

  test("nuvem identidade mostra só o endereço e a chave pública, nunca o e-mail nem a senha", async () => {
    tmp = pastaTemporaria();
    const a = ambiente({ env: { REVEZA_SENHA: "s".repeat(64) } });
    assert.equal(await executarCli(["nuvem", "identidade"], a), 0);
    assert.equal(a.saidas.at(-1), "null");
    assert.equal(await executarCli(["nuvem", "entrar", "--url", "https://exemplo.supabase.co", "--chave-publica", "chave-anon", "--email", "pc@exemplo.com"], a), 0);
    assert.equal(await executarCli(["nuvem", "identidade"], a), 0);
    const saida = a.saidas.at(-1)!;
    assert.deepEqual(JSON.parse(saida), { url: "https://exemplo.supabase.co", chavePublica: "chave-anon" });
    assert.ok(!saida.includes("pc@exemplo.com") && !saida.includes("s".repeat(64)));
  });

  test("servico status --json: instalado, rodando, modo sombra e porta do serviço; sem serviço, a sombra da ponte", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[0] === "launchctl" ? { codigo: 0, saida: "state = running", erro: "" } : { codigo: 0, saida: "", erro: "" });
    const a = ambiente({ exec });
    assert.equal(await executarCli(["servico", "status", "--json"], a), 0);
    assert.deepEqual(JSON.parse(a.saidas.at(-1)!), { instalado: false, rodando: true, detalhe: "rodando", gerenciador: true, sombra: false, porta: null });
    fs.mkdirSync(tmp.c.base, { recursive: true });
    fs.writeFileSync(path.join(tmp.c.base, "ponte.json"), JSON.stringify({ porta: 7789, pid: 1, sombra: true }));
    await executarCli(["servico", "status", "--json"], a);
    assert.equal(JSON.parse(a.saidas.at(-1)!).sombra, true, "sem serviço instalado, vale o que o agente gravou ao subir");
    const plist = path.join(tmp.c.home, "Library", "LaunchAgents", "ai.reveza.agente.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "<string>rodar</string>\n<string>--porta</string>\n<string>7799</string>");
    await executarCli(["servico", "status", "--json"], a);
    assert.deepEqual(JSON.parse(a.saidas.at(-1)!), { instalado: true, rodando: true, detalhe: "rodando", gerenciador: true, sombra: false, porta: 7799 }, "o serviço instalado vence a ponte");
    exec.responder = () => ({ codigo: 113, saida: "", erro: "" });
    assert.equal(await executarCli(["servico", "status", "--json"], a), 1, "parado: o mesmo código de saída do status de texto");
  });

  test("servico status --json no Linux sem systemd (WSL, contêiner): a unidade existe, mas o gerenciador não respondeu", async () => {
    tmp = pastaTemporaria();
    const exec = new ExecutorFalso();
    exec.responder = () => ({ codigo: 1, saida: "", erro: "System has not been booted with systemd as init system (PID 1). Can't operate." });
    const a = ambiente({ exec, sistema: "linux" });
    const unidade = path.join(tmp.c.home, ".config", "systemd", "user", "reveza-agente.service");
    fs.mkdirSync(path.dirname(unidade), { recursive: true });
    fs.writeFileSync(unidade, 'ExecStart="/usr/bin/node" "/app/cli.js" "rodar" "--sombra"\n');
    assert.equal(await executarCli(["servico", "status", "--json"], a), 1);
    assert.deepEqual(JSON.parse(a.saidas.at(-1)!), { instalado: true, rodando: false, detalhe: "desconhecido", gerenciador: false, sombra: true, porta: null });
    exec.responder = () => ({ codigo: 3, saida: "inactive\n", erro: "" });
    await executarCli(["servico", "status", "--json"], a);
    assert.equal(JSON.parse(a.saidas.at(-1)!).gerenciador, true, "systemd respondeu (parado): o serviço existe de verdade");
  });

  test("ligar: o computador novo mostra o código em letras grandes; reveza ligar XXXX-XXXX-YYYY no que tem a chave entrega", async () => {
    tmp = pastaTemporaria();
    const banco = new BancoFalso();
    const velha = new GuardaFalsa();
    await velha.gravar(SEGREDO_COFRE, Buffer.alloc(32, 7).toString("base64"));
    banco.pendentes.add("pc-novo");
    const nova = new GuardaFalsa();
    let liberar: () => void = () => undefined;
    const podeLiberar = new Promise<void>((r) => (liberar = r));
    const b = ambiente();
    b.fabricas!.guarda = async () => nova;
    b.fabricas!.nuvem = async () => new NuvemFalsa(banco, "pc-novo");
    // a espera do computador novo: a cada volta, a pessoa pode ter digitado no outro computador
    b.relogio = { ...new RelogioFalso(), dormir: async () => { liberar(); await new Promise((r) => setImmediate(r)); } } as unknown as Ambiente["relogio"];
    const pedindo = executarCli(["ligar"], b);
    await podeLiberar;
    const texto = b.saidas.join("\n");
    const codigo = /^ {4}([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/m.exec(texto)?.[1];
    assert.ok(codigo, texto);
    assert.match(texto, /█/, "letras grandes");
    assert.match(texto, new RegExp(`sem tela: reveza ligar ${codigo}`));
    assert.equal(await nova.ler(SEGREDO_COFRE), null, "ainda não chegou");
    const a = ambiente();
    a.fabricas!.guarda = async () => velha;
    a.fabricas!.nuvem = async () => new NuvemFalsa(banco, "pc-velho");
    assert.equal(await executarCli(["ligar", "AAAA-AAAA"], a), 1, "o código de 8 (versão 2) não entrega");
    assert.match(a.erros.join("\n"), /versão antiga do Reveza/);
    assert.equal(await executarCli(["ligar", codigo!.startsWith("AAAA") ? "BBBB-BBBB-CCCC" : "AAAA-AAAA-CCCC"], a), 1, "código errado não entrega");
    assert.match(a.erros.join("\n"), /não confere/);
    assert.equal(await executarCli(["ligar", codigo!.toLowerCase()], a), 0, a.erros.join("\n"));
    assert.equal(await pedindo, 0, b.erros.join("\n"));
    assert.equal(await nova.ler(SEGREDO_COFRE), await velha.ler(SEGREDO_COFRE));
    assert.match(b.saidas.join("\n"), /recebeu a chave do cofre/);
    assert.ok(!banco.pendentes.has("pc-novo"), "com a chave, o computador novo entrou");
    // a liberação sem perguntar saiu
    assert.equal(await executarCli(["ligar", "--painel", "ligar"], a), 2);
    assert.match(a.erros.join("\n"), /saiu na 0\.2\.0/);
  });

  test("ligar --mostrar-frase / --frase: a frase de emergência ainda liga um computador já ligado que perdeu a chave", async () => {
    tmp = pastaTemporaria();
    const banco = new BancoFalso();
    const velha = new GuardaFalsa();
    await velha.gravar(SEGREDO_COFRE, Buffer.alloc(32, 7).toString("base64"));
    const a = ambiente();
    a.fabricas!.guarda = async () => velha;
    a.fabricas!.nuvem = async () => new NuvemFalsa(banco, "pc-velho");
    assert.equal(await executarCli(["ligar", "--mostrar-frase"], a), 0);
    const frase = a.saidas.find((l) => /^\s{4}\S/.test(l))!.trim();
    const nova = new GuardaFalsa();
    const b = ambiente({ perguntar: async () => frase });
    b.fabricas!.guarda = async () => nova;
    b.fabricas!.nuvem = async () => new NuvemFalsa(banco, "pc-perdeu");
    assert.equal(await executarCli(["ligar", "--frase"], b), 0, b.erros.join("\n"));
    assert.equal(await nova.ler(SEGREDO_COFRE), await velha.ler(SEGREDO_COFRE));
    // identidade pendente (computador novo) não entra pela frase
    banco.pendentes.add("pc-novo");
    banco.cofreImpressao = "c".repeat(32);
    const c = ambiente();
    c.fabricas!.guarda = async () => new GuardaFalsa();
    c.fabricas!.nuvem = async () => new NuvemFalsa(banco, "pc-novo");
    assert.equal(await executarCli(["ligar", "--frase", frase], c), 1);
    assert.match(c.erros.join("\n"), /ainda não recebeu a chave/);
  });

  test("linha de uma conta", () => {
    const t = linhaConta({ email: "a@exemplo.com", org: "Org", estado: "ativa", erro: null, janelas: [{ tipo: "five_hour", pct: 42, resetEm: null }] });
    assert.equal(t, "* a@exemplo.com (Org): em uso. 5 horas 42%");
  });
});

describe("~/.claude.json", () => {
  test("troca só o oauthAccount, com a trava de diretório, e solta a trava", async () => {
    tmp = pastaTemporaria();
    const cj = new ClaudeJson(new RelogioFalso());
    await cj.gravarConta(tmp.c.claudeJson, { emailAddress: "b@exemplo.com" });
    const d = JSON.parse(fs.readFileSync(tmp.c.claudeJson, "utf8"));
    assert.deepEqual(d, { oauthAccount: { emailAddress: "b@exemplo.com" }, outra: 1 });
    assert.equal(fs.existsSync(tmp.c.claudeJson + ".lock"), false);
  });

  test("espera a trava de outro processo e não regrava arquivo ilegível", async () => {
    tmp = pastaTemporaria();
    const relogio = new RelogioFalso();
    relogio.t = Math.floor(Date.now() / 1000);
    const cj = new ClaudeJson(relogio);
    fs.mkdirSync(tmp.c.claudeJson + ".lock");
    let terminou = false;
    const p = cj.gravarConta(tmp.c.claudeJson, { emailAddress: "c@exemplo.com" }).then(() => (terminou = true));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(terminou, false, "espera a trava");
    fs.rmdirSync(tmp.c.claudeJson + ".lock");
    await p;
    assert.equal(JSON.parse(fs.readFileSync(tmp.c.claudeJson, "utf8")).oauthAccount.emailAddress, "c@exemplo.com");
    fs.writeFileSync(tmp.c.claudeJson, '{"cortado": ');
    await assert.rejects(cj.gravarConta(tmp.c.claudeJson, { emailAddress: "d@exemplo.com" }));
    assert.equal(fs.readFileSync(tmp.c.claudeJson, "utf8"), '{"cortado": ', "o arquivo do assistente não foi sobrescrito");
  });

  test("trava abandonada (mais de 10 s) é removida", async () => {
    tmp = pastaTemporaria();
    const relogio = new RelogioFalso();
    relogio.t = Math.floor(Date.now() / 1000) + 60;
    fs.mkdirSync(tmp.c.claudeJson + ".lock");
    await new ClaudeJson(relogio).gravarConta(tmp.c.claudeJson, { emailAddress: "e@exemplo.com" });
    assert.equal(JSON.parse(fs.readFileSync(tmp.c.claudeJson, "utf8")).oauthAccount.emailAddress, "e@exemplo.com");
  });

  test("modo sombra não grava", async () => {
    tmp = pastaTemporaria();
    const antes = fs.readFileSync(tmp.c.claudeJson, "utf8");
    await new ClaudeJson(new RelogioFalso(), true).gravarConta(tmp.c.claudeJson, { emailAddress: "x@exemplo.com" });
    assert.equal(fs.readFileSync(tmp.c.claudeJson, "utf8"), antes);
  });
});

test("janela no status: reset que já passou mostra 0%, e reset a mais de um dia leva o dia da semana", () => {
  const agora = Math.floor(new Date(2026, 9, 11, 6, 33).getTime() / 1000); // domingo, 06:33 local
  const passou = agora - 180;
  assert.match(textoJanela({ tipo: "five_hour", pct: 98, resetEm: passou }, agora), /^5 horas 0% \(renovou \d\d:\d\d\)$/);
  const semana = Math.floor(new Date(2026, 9, 14, 5, 59).getTime() / 1000);
  assert.equal(textoJanela({ tipo: "seven_day", pct: 100, resetEm: semana }, agora), "Semana 100% (renova qua 05:59)");
  const logo = agora + 3600;
  assert.match(textoJanela({ tipo: "five_hour", pct: 40, resetEm: logo }, agora), /^5 horas 40% \(renova \d\d:\d\d\)$/);
});
