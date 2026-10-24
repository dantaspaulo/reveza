// Troca na credencial local, leitura de uso, limite, conexão e pastas: as regras do roteador, uma por teste.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { cwdDaSessao } from "../src/agente.js";
import { EMAIL_VALIDO } from "../src/logins.js";
import { CONFERIR_TROCA_MS } from "../src/config.js";
import { PRINCIPAL_MORTA_APOS_S } from "../src/troca.js";
import { ativaEm, blob, contaEstacionada, montar, RelogioFalso, type Montado } from "./falsos.js";

let m: Montado;
afterEach(() => m?.limpar());
const e = () => m.agente.estado;
const tr = () => m.agente.trocador;
const pasta = (id: string) => e().contas[id]!.pasta;
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("troca", () => {
  test("guarda o token novo da que sai, põe a que entra e não mexe no mcpOAuth nem no resto do ~/.claude.json", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 96);
    const b = contaEstacionada(m, "B", 3);
    // uma sessão renovou A na principal depois da adoção; a principal tem os logins MCP da máquina
    const principal = { ...blob("A2"), mcpOAuth: { servidor: { accessToken: "mcp-da-maquina" } } };
    m.cred.d.set("principal", principal);
    const r = await tr().trocar(b, "teste");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "B1");
    assert.deepEqual(m.cred.agora("principal")!.mcpOAuth, { servidor: { accessToken: "mcp-da-maquina" } }, "o mcpOAuth é da máquina e fica");
    assert.equal(m.cred.agora(pasta(a))!.mcpOAuth, undefined, "o mcpOAuth não vai para a conta que sai");
    assert.equal(m.cred.token(pasta(a)), "A2");
    assert.equal(e().ativa, b);
    const cj = JSON.parse(fs.readFileSync(m.c.claudeJson, "utf8"));
    assert.equal(cj.oauthAccount.emailAddress, "b@exemplo.com");
    assert.equal(cj.outra, 1, "o resto do ~/.claude.json não pode sumir");
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta(a), ".claude.json"), "utf8")).oauthAccount.emailAddress, "a@exemplo.com");
    assert.equal(m.cli.renovacoes.length, 0);
  });

  test("só claudeAiOauth e organizationUuid mudam na principal", async () => {
    m = await montar();
    await ativaEm(m, "A", 96);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", { ...blob("A1"), outraChave: { x: 1 }, mcpOAuth: { s: 1 } });
    await tr().trocar(b, "teste");
    const p = m.cred.agora("principal")!;
    assert.deepEqual(Object.keys(p).sort(), ["claudeAiOauth", "mcpOAuth", "organizationUuid", "outraChave"]);
    assert.deepEqual(p.outraChave, { x: 1 });
  });

  test("conta desconhecida na principal é adotada antes de ser sobrescrita", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("C1")); // login à mão em outra conta
    const r = await tr().trocar(b, "teste");
    assert.ok(r.ok);
    const c = Object.values(e().contas).find((x) => x.email === "c@exemplo.com")!;
    assert.equal(m.cred.token(c.pasta), "C1");
  });

  test("destino sem token de renovação é recusado e a principal fica", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set(pasta(b), blob("B1", false));
    const r = await tr().trocar(b, "teste");
    assert.equal(r.ok, false);
    assert.equal(e().contas[b]!.precisaLogin, true);
    assert.equal(m.cred.token("principal"), "A1");
  });

  test("sem identificar a conta da principal (sem rede), não troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("A9"));
    m.api.semRede = true;
    const r = await tr().trocar(b, "teste");
    assert.equal(r.ok, false);
    assert.equal(m.cred.token("principal"), "A9");
  });

  test("computador novo: a principal sem login (só os logins MCP da máquina) recebe a conta da troca", async () => {
    m = await montar();
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", { mcpOAuth: { servidor: { accessToken: "mcp-da-maquina" } } });
    const r = await tr().trocar(b, "computador sem conta");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "B1");
    assert.deepEqual(m.cred.agora("principal")!.mcpOAuth, { servidor: { accessToken: "mcp-da-maquina" } });
    assert.equal(e().ativa, b);
  });

  test("o assistente saiu da conta em uso: a troca não apaga o login guardado dela", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set(pasta(a), blob("A0", true, 600, m.relogio.agora())); // a cópia guardada é mais velha que a da principal
    m.cred.d.set("principal", { mcpOAuth: { servidor: { accessToken: "mcp-da-maquina" } } });
    const r = await tr().trocar(b, "o assistente estava sem login");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "B1");
    assert.equal(m.cred.token(pasta(a)), "A1", "o login mais novo de A (o último visto na principal) fica guardado, nada de vazio por cima");
    assert.equal(r.de, a, "a conta que saiu ainda é devolvida (a posse dela é solta depois)");
  });

  test("o assistente saiu da conta em uso e a troca é para ela mesma: o login dela volta para a principal", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    m.cred.d.set("principal", { mcpOAuth: { servidor: { accessToken: "mcp-da-maquina" } } });
    const r = await tr().trocar(a, "o assistente estava sem login");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "A1", "antes, 'já está nela' encerrava a troca e a principal seguia sem login");
    assert.deepEqual(m.cred.agora("principal")!.mcpOAuth, { servidor: { accessToken: "mcp-da-maquina" } });
    assert.equal(e().ativa, a);
  });

  test("login de ninguém conhecido e morto na principal não vai para a pasta da conta em uso", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("X1", false, -60, m.relogio.agora()));
    m.api.recusados.add("X1");
    const r = await tr().trocar(b, "login morto");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token(pasta(a)), "A1");
    assert.equal(m.cred.token("principal"), "B1");
  });

  test("login vencido e sem renovação na principal: troca e guarda uma cópia do login antigo", async () => {
    m = await montar();
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("X1", false, -60, m.relogio.agora()));
    m.api.recusados.add("X1");
    const r = await tr().trocar(b, "computador sem conta");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "B1");
    const copias = fs.readdirSync(path.join(m.c.base, "copias"));
    assert.equal(copias.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(m.c.base, "copias", copias[0]!), "utf8")).claudeAiOauth.accessToken, "X1");
  });

  test("login vencido com renovação que a API recusa: espera 15 minutos parado antes de trocar", async () => {
    m = await montar();
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("X1", true, -60, m.relogio.agora()));
    m.api.recusados.add("X1");
    let r = await tr().trocar(b, "computador sem conta");
    assert.equal(r.ok, false, "pode ser só o assistente ainda não ter renovado");
    assert.equal(m.cred.token("principal"), "X1");
    await m.relogio.avancar(PRINCIPAL_MORTA_APOS_S * 1000);
    r = await tr().trocar(b, "computador sem conta");
    assert.ok(r.ok, r.erro);
    assert.equal(m.cred.token("principal"), "B1");
  });

  test("login válido mas a API fora do ar: continua adiando (pode ser a conta em uso)", async () => {
    m = await montar();
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", blob("X1", true, -60, m.relogio.agora()));
    m.api.semRede = true;
    await m.relogio.avancar(PRINCIPAL_MORTA_APOS_S * 2000);
    const r = await tr().trocar(b, "computador sem conta");
    assert.equal(r.ok, false);
    assert.equal(m.cred.token("principal"), "X1");
  });

  test("destino perto de vencer é renovado antes de ir para a principal", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set(pasta(b), blob("B1", true, 60));
    m.cli.aoRenovar = (p) => m.cred.d.set(p, blob("B2"));
    const r = await tr().trocar(b, "teste");
    assert.ok(r.ok);
    assert.deepEqual(m.cli.renovacoes, [pasta(b)]);
    assert.equal(m.cred.token("principal"), "B2");
  });

  test("a troca espera a renovação da mesma conta terminar (trava por conta)", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    let soltar!: () => void;
    const preso = new Promise<void>((r) => (soltar = r));
    const renovando = tr().travaConta(b).com(() => preso);
    let terminou = false;
    const troca = tr()
      .trocar(b, "teste")
      .then((r) => ((terminou = true), r));
    await tick();
    assert.equal(terminou, false, "a troca não pode copiar B enquanto ela é renovada");
    m.cred.d.set(pasta(b), blob("B7")); // a renovação girou o token
    soltar();
    await renovando;
    await troca;
    assert.equal(m.cred.token("principal"), "B7");
  });

  test("mudança feita por fora: guarda o último token visto da conta que saiu", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    await tr().trocar(b, "teste");
    m.cred.d.set("principal", blob("B5")); // as sessões renovaram B na principal
    await tr().conferirPrincipal();
    m.cred.d.set("principal", blob("A8")); // muito depois, algo regravou A por cima
    await tr().conferirPrincipal();
    assert.equal(m.cred.token(pasta(b)), "B5");
    assert.equal(e().ativa, Object.values(e().contas).find((c) => c.email === "a@exemplo.com")!.id);
  });

  test("conferência 5 s depois: sessão que regravou a conta antiga faz a troca ser refeita", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    await tr().trocar(b, "teste");
    const agendada = m.relogio.tarefas.find((x) => x.quando === m.relogio.agoraMs() + CONFERIR_TROCA_MS);
    assert.ok(agendada, "a conferência é agendada para 5 s depois");
    m.cred.d.set("principal", blob("A3")); // a sessão terminou de renovar A por cima
    await m.relogio.avancar(CONFERIR_TROCA_MS);
    await tr().geral.com(async () => undefined);
    assert.equal(m.cred.token("principal"), "B1");
    assert.equal(m.cred.token(pasta(a)), "A3", "o token que a sessão renovou fica guardado na conta A");
    assert.ok(m.relogio.tarefas.some((x) => !x.cancelada), "confere de novo depois de refazer");
  });

  test("a conferência desiste depois de 3 refeitas e avisa, com o motivo e os ids da nuvem para virar alerta", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3, { contaId: "nuvem-b" });
    e().contas[a]!.contaId = "nuvem-a";
    await tr().trocar(b, "teste");
    m.cred.d.set("principal", blob("A3"));
    await tr().conferirTroca(b, a, 4);
    assert.equal(m.cred.token("principal"), "A3");
    assert.match(e().eventos[0]!.texto, /3 tentativas/);
    assert.equal(e().eventos[0]!.tipo, "erro");
    assert.deepEqual(e().eventos[0]!.dados, { motivo: "troca_falhou", de: "nuvem-a", para: "nuvem-b" });
  });

  test("linha do tempo marca a troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    await tr().trocar(b, "teste");
    assert.equal(e().linhaContas[e().linhaContas.length - 1]![1], b);
    assert.equal(tr().contaEm(m.relogio.agora() + 1), b);
  });

  test("modo sombra: não troca, não grava e registra o que faria", async () => {
    m = await montar({ sombra: true });
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    const gravacoes = m.cred.gravacoes.length;
    const r = await tr().trocar(b, "teste");
    assert.equal(r.ok, false);
    assert.equal(m.cred.token("principal"), "A1");
    assert.equal(m.cred.gravacoes.length, gravacoes);
    assert.ok(m.log.linhas.some((l) => l.includes("faria: trocar para b@exemplo.com")));
  });
});

describe("leitura de uso", () => {
  test("perto do gatilho a conta em uso é lida a cada ciclo, mesmo com medida fresca da sessão", async () => {
    const leituras = async (pct: number) => {
      m = await montar();
      await ativaEm(m, "A", pct);
      m.api.usos["A"] = pct;
      await m.relogio.dormir(200_000);
      await m.agente.ciclo();
      const antes = m.api.usosPedidos.length;
      for (let i = 0; i < 8; i++) {
        await m.relogio.dormir(15_000);
        await m.agente.ciclo();
      }
      const n = m.api.usosPedidos.length - antes;
      m.limpar();
      return n;
    };
    const longe = await leituras(40);
    const perto = await leituras(92);
    assert.ok(longe <= 2, `a 40% leu ${longe} vezes em 2 min`);
    assert.ok(perto >= 7, `a 92% leu ${perto} vezes em 2 min`);
    m = await montar();
  });

  test("na sombra a conta em uso é lida 5 vezes menos (não dobra o pedido do outro gestor)", async () => {
    const leituras = async (sombra: boolean) => {
      m = await montar({ sombra });
      await ativaEm(m, "A", 10);
      await m.relogio.dormir(200_000);
      const antes = m.api.usosPedidos.length;
      for (let i = 0; i < 40; i++) {
        await m.agente.ciclo();
        await m.relogio.dormir(15_000);
      }
      const n = m.api.usosPedidos.length - antes;
      m.limpar();
      return n;
    };
    const normal = await leituras(false);
    const sombra = await leituras(true);
    assert.ok(normal >= 9, `normal leu ${normal} vezes em 10 min`);
    assert.ok(sombra <= 2, `sombra leu ${sombra} vezes em 10 min`);
    m = await montar();
  });

  test("a ativa é lida da principal e nunca renovada pela cópia", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    m.cred.d.set("principal", blob("A1", true, 30));
    await tr().lerUso(a, true);
    assert.match(e().contas[a]!.erro!, /vencido/);
    assert.equal(m.cli.renovacoes.length, 0);
  });

  test("renovar recusa a conta ativa sem rodar nada", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    assert.equal(await tr().renovarSeguro(a), false);
    assert.equal(m.cli.renovacoes.length, 0);
  });

  test("a estacionada é lida da própria entrada", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.api.usos.B = 77;
    m.api.usos.A = 1;
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.janelas[0]!.pct, 77);
  });

  test("estacionada vencida é renovada (auth status) e lida", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    m.cli.aoRenovar = (p) => m.cred.d.set(p, blob("B2"));
    m.api.usos.B = 33;
    await tr().lerUso(b, true);
    assert.equal(m.cli.renovacoes.length, 1);
    assert.equal(e().contas[b]!.janelas[0]!.pct, 33);
  });

  test("se o auth status não renova, tenta o -p curto; se nada renova e o assistente diz que o login morreu, pede login", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    const tentativas: number[] = [];
    m.cli.aoRenovar = (_p, t) => {
      tentativas.push(t);
      return { codigo: 1, saida: "", erro: "OAuth token has expired · Please run /login" };
    };
    await tr().lerUso(b, true);
    assert.deepEqual(tentativas, [0, 1]);
    assert.equal(e().contas[b]!.precisaLogin, true);
  });

  test("a renovação tropeça sem o assistente dizer que o login morreu: não pede login, tenta de novo em 30 min; 3 h assim, pede", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    m.cli.aoRenovar = () => ({ codigo: 1, saida: "", erro: "API Error: Request rejected (429) · this may be a temporary capacity issue." });
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.precisaLogin, false);
    assert.match(String(e().contas[b]!.erro), /não renovou agora/);
    assert.equal(tr().ultimaLeitura[b], m.relogio.agora() + 1800 - 300, "a próxima leitura só daqui a 30 min");
    assert.ok(!e().eventos.some((x) => /entre de novo/.test(x.texto)), "sem aviso de entrar de novo");
    await m.relogio.avancar(2 * 3600 * 1000);
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.precisaLogin, false, "2 h tropeçando ainda não pede");
    await m.relogio.avancar(3600 * 1000 + 1000);
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.precisaLogin, true, "3 h tropeçando, pede login");
    assert.ok(e().eventos.some((x) => /entre de novo/.test(x.texto)));
  });

  test("o auth status diz que não há login (loggedIn false): pede login na hora", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    m.cli.aoRenovar = (_p, t) => (t === 0 ? { codigo: 0, saida: '{"loggedIn": false}', erro: "" } : undefined);
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.precisaLogin, true);
  });

  test("tropeçou e depois renovou: zera a contagem, e a próxima falha começa do zero", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.cred.d.set(pasta(b), blob("B1", true, 30));
    m.cli.aoRenovar = () => ({ codigo: 1, saida: "", erro: "rede fora" });
    await tr().lerUso(b, true);
    assert.ok(tr().tropecoDesde[b]);
    m.cli.aoRenovar = (p) => void m!.cred.d.set(p, blob("B2", true, 3600, m!.relogio.agora()));
    await m.relogio.avancar(1800 * 1000);
    await tr().lerUso(b, true);
    assert.equal(tr().tropecoDesde[b], undefined);
    assert.equal(e().contas[b]!.precisaLogin, false);
  });

  test("429 recua 10 minutos", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.api.statusUso.B = 429;
    await tr().lerUso(b, true);
    const pedidos = m.api.usosPedidos.length;
    await tr().lerUso(b);
    assert.equal(m.api.usosPedidos.length, pedidos);
  });

  test("401 da estacionada renova e lê de novo", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    m.api.statusUso.B = 401;
    m.cli.aoRenovar = (p) => {
      m.cred.d.set(p, blob("B2", true, 7200));
      delete m.api.statusUso.B;
    };
    await tr().lerUso(b, true);
    assert.equal(e().contas[b]!.lidoEm, m.relogio.agora());
  });

  test("medida logo depois da troca é ignorada", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    await tr().trocar(b, "teste");
    tr().medidaDaSessao({ janelas: [{ tipo: "five_hour", pct: 99, resetEm: m.relogio.agora() + 60 }] });
    assert.equal(e().ativa, b);
    assert.equal(e().contas[b]!.janelas[0]!.pct, 3);
  });

  test("medida de versão velha é ignorada", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    tr().medidaDaSessao({ versao: e().versao - 1, janelas: [{ tipo: "five_hour", pct: 50, resetEm: null }] });
    assert.equal(e().contas[a]!.janelas[0]!.pct, 10);
  });

  test("o limite da sessão troca na hora (furando a espera) e entra na fila", async () => {
    m = await montar();
    await ativaEm(m, "A", 80);
    const b = contaEstacionada(m, "B", 3);
    e().trocadaEm = m.relogio.agora();
    const r = await m.agente.alvoPonte().limite({ sessao: "s1", cwd: "/tmp", tipo: "interativa" });
    assert.equal(r.status, 200);
    await m.agente.esperar();
    assert.equal(e().ativa, b);
    assert.equal(e().fila[0]!.sessao, "s1");
  });

  test("limite de versão velha não esgota a conta nova", async () => {
    m = await montar();
    await ativaEm(m, "A", 99);
    const b = contaEstacionada(m, "B", 3);
    const v0 = e().versao;
    await tr().trocar(b, "teste");
    const r = tr().limiteDaSessao({ sessao: "s2", cwd: "/tmp", tipo: "interativa", versao: v0 });
    assert.equal(r.trocou, true);
    assert.equal(e().ativa, b);
    assert.equal(e().contas[b]!.janelas[0]!.pct, 3);
    assert.equal(e().fila[0]!.sessao, "s2");
  });

  const S9 = "99999999-0000-4000-8000-000000000009";
  function transcricao(sessao: string, cwd: string) {
    const dir = path.join(m.c.projetos, "-projeto");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), JSON.stringify({ type: "user", sessionId: sessao, cwd }) + "\n");
  }

  test("sessão de terminal parada é retomada depois da troca, na pasta da transcrição dela", async () => {
    m = await montar();
    await ativaEm(m, "A", 80);
    contaEstacionada(m, "B", 3);
    e().config.retomarHeadless = true;
    transcricao(S9, m.c.base);
    await m.agente.alvoPonte().limite({ sessao: S9, cwd: "/tmp/pasta-que-veio-pela-ponte", tipo: "headless" });
    await m.agente.esperar();
    assert.deepEqual(m.cli.retomadas, [{ sessao: S9, cwd: m.c.base }], "a pasta vem da transcrição, não da ponte");
    assert.equal(e().fila[0]!.estado, "retomada");
  });

  test("sessão de terminal na fila há mais de 2 h não roda sozinha na próxima troca", async () => {
    m = await montar();
    await ativaEm(m, "A", 80);
    contaEstacionada(m, "B", 3);
    transcricao(S9, m.c.base);
    e().fila.unshift({ sessao: S9, cwd: m.c.base, tipo: "headless", em: m.relogio.agora() - 3 * 3600, estado: "aguardando", conta: null });
    e().config.retomarHeadless = true;
    m.agente.retomarHeadless();
    assert.deepEqual(m.cli.retomadas, []);
    assert.equal(e().fila[0]!.estado, "descartada");
  });

  test("sessão sem transcrição neste computador não é retomada (a ponte não escolhe pasta)", async () => {
    m = await montar();
    await ativaEm(m, "A", 80);
    contaEstacionada(m, "B", 3);
    e().config.retomarHeadless = true;
    await m.agente.alvoPonte().limite({ sessao: "88888888-0000-4000-8000-000000000008", cwd: m.c.base, tipo: "headless" });
    await m.agente.esperar();
    assert.deepEqual(m.cli.retomadas, []);
    assert.equal(e().fila[0]!.estado, "descartada");
    assert.equal(cwdDaSessao(m.c.projetos, "../../etc/passwd"), null);
  });
});

describe("entradas do login", () => {
  test("e-mail que começa com hífen não vira opção da linha de comando; código é uma linha só", async () => {
    m = await montar();
    assert.ok(!EMAIL_VALIDO.test("-x@exemplo.com"));
    assert.ok(EMAIL_VALIDO.test("a.b-c@exemplo.com"));
    assert.ok(EMAIL_VALIDO.test("nome+trabalho@empresa.com.br"));
    // nenhum caractere especial de shell (no Windows, um .cmd interpretaria & | < > ^ " % !)
    for (const ruim of ['a&calc@x.com', 'a|b@x.com', 'a"b@x.com', "a^b@x.com", "a!b@x.com", "a<b@x.com", "a@x.com&calc", "a@-x.com", "a@x", "a b@x.com"])
      assert.ok(!EMAIL_VALIDO.test(ruim), ruim);
    assert.throws(() => m.agente.logins.iniciar("--help@exemplo.com"), /e-mail inválido/);
    const l = m.agente.logins.iniciar("a@exemplo.com");
    assert.match(m.agente.logins.codigo(l.id, "abc\ndef").erro ?? "", /uma linha só/);
    // sem a parte depois do #, o login oficial diria "Invalid code" e seguiria esperando sem terminar
    for (const incompleto of ["abc", "abc#", "#def"]) assert.match(m.agente.logins.codigo(l.id, incompleto).erro ?? "", /incompleto/, incompleto);
    const proc = m.cli.logins[m.cli.logins.length - 1]!.proc;
    assert.deepEqual(proc.escrito, [], "nada do código incompleto chega ao login");
  });
});

describe("conexão de conta", () => {
  async function loginQueEntrouComo(letra: string, pedido: string) {
    const l = m.agente.logins.iniciar(pedido);
    const proc = m.cli.logins[m.cli.logins.length - 1]!.proc;
    proc.emitir("Abrindo https://claude.com/cai/oauth/authorize?x=1");
    m.cred.d.set(l.pasta, blob(letra + "1"));
    proc.fim(0);
    await l.concluido;
    return l;
  }

  test("login que entrou em outra conta é descartado", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const l = await loginQueEntrouComo("C", "b@exemplo.com");
    assert.equal(l.estado, "erro");
    assert.match(l.mensagem, /c@exemplo\.com/);
    assert.equal(m.cred.agora(l.pasta), undefined);
    assert.ok(!Object.values(e().contas).some((c) => c.email === "c@exemplo.com"));
    assert.equal(fs.existsSync(l.pasta), false);
  });

  test("login certo entra no rodízio (e-mail sem diferença de maiúsculas)", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const l = await loginQueEntrouComo("B", "B@exemplo.com");
    assert.equal(l.estado, "ok");
    assert.equal(l.url, "https://claude.com/cai/oauth/authorize?x=1");
    const b = Object.values(e().contas).find((c) => c.email === "b@exemplo.com")!;
    assert.equal(b.pasta, l.pasta);
    assert.equal(path.dirname(l.pasta), m.c.contas);
  });

  test("o endereço do login vem da saída do Claude Code 2.1.29x (claude.com, código colado), com o texto de janela anônima", async () => {
    m = await montar();
    const l = m.agente.logins.iniciar("b@exemplo.com");
    assert.equal(l.mensagem, "Abrindo o login oficial…", "não diz que o navegador abriu antes de saber");
    const proc = m.cli.logins[m.cli.logins.length - 1]!.proc;
    // a saída de verdade (12/10/2026), com o endereço depois do "If the browser didn't open"
    proc.emitir("Opening browser to sign in…");
    proc.emitir("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y.");
    proc.emitir("Paste code here if prompted >");
    assert.equal(l.url, "https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y");
    assert.match(l.mensagem, /janela anônima/);
    // o código colado no painel ou no terminal vai para o login aberto
    assert.deepEqual(m.agente.logins.codigo(l.id, "  codigo#estado  "), { ok: true });
    assert.deepEqual(proc.escrito, ["codigo#estado\n"]);
  });

  test("login que pede Enter no fim: quando a credencial aparece, confirma", async () => {
    m = await montar();
    const l = m.agente.logins.iniciar("b@exemplo.com");
    const proc = m.cli.logins[0]!.proc;
    m.cred.d.set(l.pasta, blob("B1"));
    await tick(40);
    assert.ok(proc.escrito.includes("\n"));
  });

  test("e-mail inválido nem começa", async () => {
    m = await montar();
    assert.throws(() => m.agente.logins.iniciar("nao-e-email"));
  });
});

describe("pastas de conta", () => {
  const agoraReal = () => {
    const r = new RelogioFalso();
    r.t = Math.floor(Date.now() / 1000);
    return r;
  };

  test("login terminado sem ninguém acompanhando entra no rodízio", async () => {
    m = await montar({ relogio: agoraReal() });
    await ativaEm(m, "A", 10);
    const p = tr().novaPasta();
    m.cred.d.set(p, blob("D1"));
    await tr().arrumarPastas(new Set());
    assert.ok(Object.values(e().contas).some((c) => c.email === "d@exemplo.com" && c.pasta === p));
  });

  test("pasta sem login velha sai e a nova fica", async () => {
    m = await montar({ relogio: agoraReal() });
    await ativaEm(m, "A", 10);
    const velha = tr().novaPasta();
    const nova = tr().novaPasta();
    const antes = Date.now() / 1000 - 7200;
    fs.utimesSync(velha, antes, antes);
    await tr().arrumarPastas(new Set());
    assert.equal(fs.existsSync(velha), false);
    assert.equal(fs.existsSync(nova), true);
  });

  test("pasta de conta registrada não é tocada", async () => {
    m = await montar({ relogio: agoraReal() });
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B");
    const antes = Date.now() / 1000 - 7200;
    fs.utimesSync(pasta(b), antes, antes);
    await tr().arrumarPastas(new Set());
    assert.ok(fs.existsSync(pasta(b)));
    assert.ok(m.cred.agora(pasta(b)));
  });

  test("pasta de login em andamento não é tocada", async () => {
    m = await montar({ relogio: agoraReal() });
    const p = tr().novaPasta();
    const antes = Date.now() / 1000 - 7200;
    fs.utimesSync(p, antes, antes);
    await tr().arrumarPastas(new Set([p]));
    assert.ok(fs.existsSync(p));
  });
});

describe("programa do assistente sem shell", () => {
  test("script de lote nunca roda; programa JavaScript roda com o próprio Node", async () => {
    const { semShell } = await import("../src/util/executor.js");
    assert.equal(semShell(["C:\\npm\\claude.cmd", "auth", "login"]), null);
    assert.equal(semShell(["x.BAT"]), null);
    assert.deepEqual(semShell(["/x/cli.js", "--resume", "1"]), [process.execPath, "/x/cli.js", "--resume", "1"]);
    assert.deepEqual(semShell(["/usr/local/bin/claude", "-p"]), ["/usr/local/bin/claude", "-p"]);
  });

  test("no Windows, o claude.cmd do npm vira o cli.js que ele chama", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { acharBinario } = await import("../src/claudecli.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-cmd-"));
    try {
      const js = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
      fs.mkdirSync(path.dirname(js), { recursive: true });
      fs.writeFileSync(js, "");
      fs.writeFileSync(path.join(dir, "claude.cmd"), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
      assert.equal(acharBinario({ PATH: dir }, "/home/x", "win32"), js);
      fs.writeFileSync(path.join(dir, "claude.cmd"), "@echo off\r\nalgo estranho %*\r\n");
      assert.ok(!acharBinario({ PATH: dir }, "/home/x", "win32").endsWith(".cmd"), "sem o cli.js, não usa o .cmd");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
