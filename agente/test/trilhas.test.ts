// Trilhas (0.18.0): a empresa separada roda só com as contas marcadas para ela, numa pasta de login própria.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { FILA_VALIDA_OPENBOT_S } from "../src/config.js";
import { carregarEstado } from "../src/estado.js";
import { lerChave } from "../src/ligar.js";
import { NuvemRpc } from "../src/nuvem/rpc.js";
import { fileURLToPath } from "node:url";
import type { RegraEmpresa } from "../src/nuvem/tipos.js";
import { criarClassificador, ehCaminho, EMPRESAS_LER_S, EMPRESAS_VENCIDAS_S, normalizarPasta, type AgentePasta } from "../src/trilhas.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, montar, NuvemFalsa, OpenBotFalso, type Montado } from "./falsos.js";

/** A tabela de casos da pasta do OpenBot, a mesma da nuvem (dist/test -> nuvem/testes). */
const CASOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "nuvem", "testes", "casos-pasta-openbot.json");

const E1 = "11111111-2222-4333-8444-555555555555";
const E2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("classificador das empresas separadas (o mesmo do painel)", () => {
  test("caminho e nome: o prefixo mais longo ganha, depois o nome de pasta mais fundo; maiúsculas não contam", () => {
    const c = criarClassificador(
      [{ id: E1, nome: "Um" }, { id: E2, nome: "Dois" }],
      [
        { tipo: "pasta", padrao: "~/Code", empresa: E1 },
        { tipo: "pasta", padrao: "~/Code/cliente-x/", empresa: E2 },
        { tipo: "pasta", padrao: "projeto-dois", empresa: E2 },
      ],
      [],
    );
    assert.equal(c("~/Code/qualquer"), E1);
    assert.equal(c("~/code/CLIENTE-X/api"), E2);
    assert.equal(c("~/Code/a/projeto-dois/b"), E2, "o nome mais fundo ganha do prefixo curto");
    assert.equal(c("~/Outro"), null);
    assert.equal(c("~/Codex"), null, "prefixo só pega a pasta inteira");
  });

  test("título do agente do OpenBot pega a pasta dele; empresa que não está na lista não vale", () => {
    const c = criarClassificador(
      [{ id: E1, nome: "Um" }],
      [
        { tipo: "titulo", padrao: "Exemplo", empresa: E1 },
        { tipo: "pasta", padrao: "~/x", empresa: E2 },
      ],
      [{ pasta: "~/OpenBot/Agents/agent-1", nome: "Agente Um", titulo: "Projeto Exemplo" }],
    );
    assert.equal(c("~/OpenBot/Agents/agent-1/trabalho"), E1);
    assert.equal(c("~/OpenBot/Agents/agent-2"), null);
    assert.equal(c("~/x/y"), null, "regra de empresa sem separar (fora da lista) não conta");
  });

  test("a regra de um projeto fora da lista vence a da empresa ligada e manda a pasta para a conta do computador", () => {
    const c = criarClassificador(
      [{ id: E1, nome: "Um" }],
      [
        { tipo: "pasta", padrao: "~/Code/um", empresa: E1 },
        { tipo: "pasta", padrao: "~/Code/um/site", empresa: E2 },
      ],
      [],
    );
    assert.equal(c("~/Code/um/api"), E1);
    assert.equal(c("~/Code/um/site/web"), null);
  });

  test("0.22.0: a tabela de casos comum com a nuvem e o painel (pasta do OpenBot)", () => {
    const tabela = JSON.parse(fs.readFileSync(CASOS, "utf8")) as {
      agentes: AgentePasta[];
      casos: { nome: string; regras: [string, string, string][]; perguntas: [string, string | null][] }[];
    };
    const id = (p: string) => `00000000-0000-4000-8000-${Buffer.from(p).toString("hex").padStart(12, "0")}`;
    assert.ok(tabela.casos.length >= 10);
    for (const caso of tabela.casos) {
      const projetos = [...new Set(caso.regras.map((r) => r[2]))];
      const c = criarClassificador(
        projetos.map((p) => ({ id: id(p), nome: p })),
        caso.regras.map(([tipo, padrao, p]) => ({ tipo: tipo as RegraEmpresa["tipo"], padrao, empresa: id(p) })),
        tabela.agentes,
      );
      for (const [p, espera] of caso.perguntas) assert.equal(c(p), espera ? id(espera) : null, `${caso.nome}: ${p}`);
    }
  });

  test("0.22.0: a pasta do OpenBot sem leitura (null) não pega a conversa; o título e o caminho seguem valendo", () => {
    const regras = [
      { tipo: "secao", padrao: "clientes", empresa: E1 },
      { tipo: "titulo", padrao: "Exemplo", empresa: E2 },
    ] as RegraEmpresa[];
    const empresas = [{ id: E1, nome: "Um" }, { id: E2, nome: "Dois" }];
    const ag = { pasta: "~/OpenBot/Agents/agent-1", nome: "Um", titulo: "Projeto Exemplo" };
    const com = (...l: object[]) => l as AgentePasta[];
    assert.equal(criarClassificador(empresas, regras, com({ ...ag, secoes: ["clientes"] }))("~/OpenBot/Agents/agent-1"), E1);
    assert.equal(criarClassificador(empresas, regras, com({ ...ag, secoes: null }))("~/OpenBot/Agents/agent-1"), E2);
    assert.equal(criarClassificador(empresas, regras, [ag])("~/OpenBot/Agents/agent-1"), E2, "agente sem pasta na barra");
    // um dos agentes da mesma pasta sem leitura: a parte comum não se sabe, a regra não pega
    const dois = com({ ...ag, secoes: ["clientes"] }, { ...ag, nome: "Outro", secoes: null });
    assert.equal(criarClassificador(empresas, regras, dois)("~/OpenBot/Agents/agent-1"), E2);
  });

  test("normalizar e reconhecer caminho", () => {
    assert.equal(normalizarPasta(" ~/A//B/ "), "~/a/b");
    assert.equal(normalizarPasta("C:\\Users\\X"), "c:/users/x");
    assert.equal(ehCaminho("~/a"), true);
    assert.equal(ehCaminho("/a"), true);
    assert.equal(ehCaminho("C:\\a"), true);
    assert.equal(ehCaminho("projeto"), false);
  });
});

let m: Montado;
let banco: BancoFalso;
let nuvemFalsa: NuvemFalsa;
afterEach(() => m?.limpar());
const fns = (fn: string) => banco.chamadas.filter((c) => c.fn === fn);

async function preparar() {
  banco = new BancoFalso();
  nuvemFalsa = new NuvemFalsa(banco, "pc-1");
  m = await montar({ nuvem: nuvemFalsa });
  banco.agora = () => m.relogio.agora();
}

async function semear(letra: string, versao = 2) {
  const c = banco.conta(`${letra.toLowerCase()}@exemplo.com`);
  const k = (await lerChave(m.guarda))!;
  const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, versao), blob(letra + "1", true, 3600, m.relogio.agora()));
  c.cofre = { cifrado, nonce, versao, expira_em: null };
  return c.id;
}

const token = (pasta: string) => (m.cred.d.get(pasta) as { claudeAiOauth?: { accessToken?: string } } | undefined)?.claudeAiOauth?.accessToken;

/** A conta A em uso na principal, adotada pela nuvem. */
async function comPrincipal(): Promise<string> {
  const a = await ativaEm(m, "A", 10);
  await m.agente.esperar();
  await m.agente.busca();
  return a;
}

/** Empresa E1 separada, com a regra da pasta ~/proj-e1 e a conta B escolhida pela nuvem para ela. */
async function comEmpresa(): Promise<{ b: string; cwd: string }> {
  const b = await semear("B");
  banco.empresas = [{ id: E1, nome: "Empresa Um" }];
  banco.regras = [{ tipo: "pasta", padrao: "~/proj-e1", empresa: E1 }];
  banco.trilhas.set("pc-1", new Map([[E1, { conta: b, versao: 1, motivo: "conta marcada para a empresa" }]]));
  await m.agente.busca();
  const cwd = path.join(m.c.home, "proj-e1", "sub");
  fs.mkdirSync(cwd, { recursive: true });
  return { b, cwd };
}

async function pedir(cwd: string, pid: number | null = process.pid) {
  const r = await m.agente.alvoPonte().trilha!({ cwd, pid });
  return r.corpo as { ok: boolean; trilha: { empresa: string; nome: string; pasta: string } | null; aviso?: string; bloqueio?: string };
}

/** O comando que não conversa (`reveza trilha --sem-conversa`, plano B versão 2, regra 4): vai sem o processo. */
async function semConversa(cwd: string) {
  const r = await m.agente.alvoPonte().trilha!({ cwd, pid: null, semConversa: true });
  return r.corpo as { ok: boolean; trilha: { empresa: string; nome: string; pasta: string } | null; bloqueio?: string };
}

describe("trilhas no agente", () => {
  test("sem empresa separada nada muda: nem empresas, nem trilhas, nem a marca do lançador", async () => {
    await preparar();
    await comPrincipal();
    await m.agente.busca();
    assert.equal(fns("empresas").length, 0);
    assert.equal(fns("trilhas").length, 0);
    assert.equal(fs.existsSync(path.join(m.c.trilhas, "ligadas")), false);
    assert.deepEqual(await pedir(path.join(m.c.home, "proj")), { ok: true, trilha: null });
  });

  test("a sessão da pasta da empresa abre na trilha com a conta dela; a principal segue na dela", async () => {
    await preparar();
    const a = await comPrincipal();
    const { b, cwd } = await comEmpresa();
    assert.ok(fs.existsSync(path.join(m.c.trilhas, "ligadas")), "a marca liga o lançador");
    const r = await pedir(cwd);
    assert.equal(r.trilha?.empresa, E1);
    const pastaTrilha = path.join(m.c.trilhas, E1);
    assert.equal(r.trilha?.pasta, pastaTrilha);
    assert.deepEqual(banco.trilhasPedidas.get("pc-1"), [E1]);
    // o login de B na trilha; a principal continua em A
    assert.equal(token(pastaTrilha), "B1");
    assert.equal(token("principal"), "A1");
    assert.equal(m.agente.estado.ativa, a);
    const t = m.agente.estado.trilhas![E1]!;
    const idB = t.conta!;
    assert.equal(m.agente.estado.contas[idB]!.contaId, b);
    assert.equal(banco.posse.get(b)?.pc, "pc-1");
    assert.equal(banco.posse.get(b)?.motivo, "uso");
    assert.ok(t.pids.includes(process.pid));
    const troca = banco.eventos.find((x) => x.tipo === "troca");
    assert.equal((troca?.dados as Record<string, unknown>)?.empresa, E1, "a troca na trilha leva a empresa");
    // a principal não pode pegar a conta da trilha (dois lugares renovariam o mesmo login)
    const outra = await m.agente.trocador.trocar(idB, "teste");
    assert.equal(outra.ok, false);
    // pasta fora da empresa: principal
    assert.deepEqual(await pedir(path.join(m.c.home, "outra")), { ok: true, trilha: null });
  });

  test("com a nuvem fora do ar, a última regra conhecida continua valendo e a resposta diz que está vencida", async () => {
    // Decisão de 23/11/2026 (fail-static, ver EMPRESAS_VENCIDAS_S em src/trilhas.ts): sem notícia da nuvem, a sessão
    // de uma empresa separada abre na trilha que o computador já conhece. Soltar a trilha e cair na principal durante
    // uma falha de rede poria o trabalho da empresa na conta compartilhada, o contrário do que a separação faz.
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const anterior = await pedir(cwd);
    assert.equal(anterior.trilha?.empresa, E1);
    assert.equal((anterior as { vencida?: true }).vencida, undefined, "com a nuvem no ar a regra não está vencida");
    const contaTrilha = m.agente.estado.trilhas![E1]!.conta;
    banco.foraDoAr = true;
    await m.relogio.dormir((EMPRESAS_VENCIDAS_S + 1) * 1000);
    const nova = await pedir(cwd, null);
    assert.equal(nova.trilha?.empresa, E1, "a regra conhecida segue valendo");
    assert.equal((nova as { vencida?: true }).vencida, true, "e a resposta ao lançador marca que está vencida");
    assert.equal(m.agente.estado.trilhas![E1]!.conta, contaTrilha, "a sessão em curso conserva a conta");
    assert.equal(m.agente.estado.ativa, a, "a conta principal não muda");
  });

  test("medida e limite de uma sessão da trilha vão para a conta da trilha, nunca para a da principal", async () => {
    await preparar();
    const a = await comPrincipal();
    const { b, cwd } = await comEmpresa();
    await pedir(cwd);
    const t = m.agente.estado.trilhas![E1]!;
    const idB = t.conta!;
    await m.relogio.dormir(31_000);
    const pctA = m.agente.estado.contas[a]!.janelas.find((j) => j.tipo === "five_hour")?.pct;
    const reset = new Date((m.relogio.agora() + 3600) * 1000).toISOString();
    m.agente.alvoPonte().medida({ sessao: "sessao-trilha", versao: t.versao, trilha: E1, janelas: [{ tipo: "five_hour", pct: 77, resetEm: reset }] });
    assert.equal(m.agente.estado.contas[idB]!.janelas.find((j) => j.tipo === "five_hour")?.pct, 77);
    assert.equal(m.agente.estado.contas[a]!.janelas.find((j) => j.tipo === "five_hour")?.pct, pctA);
    // o contador põe o uso desta sessão na conta da trilha
    assert.equal(m.agente.trocador.contaEm(m.relogio.agora(), "sessao-trilha"), idB);
    assert.equal(m.agente.trocador.contaEm(m.relogio.agora(), "sessao-principal"), a);
    const ativa = m.agente.alvoPonte().trilhaAtiva!({ trilha: E1, sessao: "sessao-trilha" });
    assert.equal((ativa.corpo as { slug: string }).slug, idB);
    const lim = m.agente.alvoPonte().limite({ sessao: "sessao-trilha", tipo: "interativa", erro: "rate_limit", versao: t.versao, trilha: E1 }) as { corpo: { trocou: boolean } };
    assert.equal(lim.corpo.trocou, false);
    await m.agente.esperar();
    const avisos = fns("limite");
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.args[0], b, "a nuvem fica sabendo que a conta da trilha encheu");
    assert.equal(m.agente.estado.ativa, a);
    assert.equal(m.agente.estado.fila[0]?.trilha, E1);
    assert.equal(m.agente.estado.fila[0]?.conta, idB);
  });

  test("a sessão sem tela da trilha volta só com a troca da trilha, e volta nela", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    await pedir(cwd);
    m.agente.estado.config.retomarHeadless = true; // desligada de fábrica
    const t = m.agente.estado.trilhas![E1]!;
    m.agente.alvoPonte().limite({ sessao: "s-sem-tela", tipo: "headless", erro: "rate_limit", versao: t.versao, trilha: E1 });
    await m.agente.esperar();
    const item = m.agente.estado.fila.find((f) => f.sessao === "s-sem-tela")!;
    assert.equal(item.trilha, E1);
    m.agente.retomarHeadless();
    assert.equal(item.liberadaEm, undefined, "a troca da principal não solta a sessão da trilha");
    m.agente.retomarHeadless(undefined, false, E1);
    assert.notEqual(item.liberadaEm, undefined);
  });

  test("a nuvem tira a conta da trilha: o login mais novo volta à pasta da conta e a trilha fica vazia", async () => {
    await preparar();
    await comPrincipal();
    const { b, cwd } = await comEmpresa();
    const r = await pedir(cwd);
    const pastaTrilha = r.trilha!.pasta;
    const idB = m.agente.estado.trilhas![E1]!.conta!;
    // as sessões renovaram o login na trilha
    m.cred.d.set(pastaTrilha, blob("B2", true, 7200, m.relogio.agora()));
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.agente.busca();
    const t = m.agente.estado.trilhas![E1]!;
    assert.equal(t.conta, null);
    assert.equal(m.cred.d.has(pastaTrilha), false, "a trilha fica sem login");
    assert.equal(token(m.agente.estado.contas[idB]!.pasta), "B2", "a pasta da conta leva o login mais novo");
    assert.ok(m.agente.posse!.soltarDepois.has(idB), "a conta volta ao cofre depois da conferência");
    assert.equal(token("principal"), "A1");
    void b;
  });

  test("a posse da conta da trilha fica no desligar e volta depois de o agente religar", async () => {
    await preparar();
    await comPrincipal();
    const { b, cwd } = await comEmpresa();
    await pedir(cwd);
    const idB = m.agente.estado.trilhas![E1]!.conta!;
    // desligar: a conta da trilha segue com as sessões da empresa, a posse não se solta
    await m.agente.desligar();
    assert.equal(banco.posse.get(b)?.pc, "pc-1", "o desligar não solta a conta da trilha");
    // religar logo: o mapa das posses some (vive na memória) e a limpeza do começo roda de novo
    m.agente.posse!.posses.clear();
    (m.agente as unknown as { possesLimpas: boolean }).possesLimpas = false;
    await m.agente.busca();
    assert.equal(banco.posse.get(b)?.pc, "pc-1", "a limpeza do começo não solta a conta da trilha");
    assert.equal(m.agente.posse!.posses.get(idB), "uso");
    // religar depois de a posse vencer na nuvem: a busca das trilhas retoma a posse de uso
    m.agente.posse!.posses.clear();
    banco.posse.delete(b);
    await m.agente.busca();
    assert.equal(banco.posse.get(b)?.pc, "pc-1");
    assert.equal(banco.posse.get(b)?.motivo, "uso");
    assert.equal(m.agente.posse!.posses.get(idB), "uso");
    assert.equal(token(path.join(m.c.trilhas, E1)), "B1", "o login vivo da trilha fica como está");
  });

  test("sem conta para a empresa agora: a sessão abre na principal e o painel recebe um aviso", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    banco.trilhas.get("pc-1")!.delete(E1);
    const r = await pedir(cwd);
    assert.equal(r.trilha, null);
    assert.match(r.aviso ?? "", /Empresa Um/);
    await m.agente.esperar();
    assert.ok(banco.eventos.some((x) => x.tipo === "aviso" && (x.dados as Record<string, unknown>)?.empresa === E1));
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pids, [], "o processo que abriu na principal não segura a trilha");
  });

  test("empresa só nas contas dela, sem conta agora: a sessão não abre na principal e diz por quê", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const r = await pedir(cwd);
    assert.equal(r.trilha, null);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
    assert.equal(r.aviso, undefined, "não diz que abriu na conta em uso");
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pids, [], "a sessão que não abriu não segura a trilha");
    assert.ok(m.agente.estado.trilhas![E1]!.pedidaEm > 0, "segue pedida: a nuvem dá a conta quando ela soltar");
  });

  test("plano B: o pedido de novo da espera, ainda sem conta, não grava o estado e não segura a trilha", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/);
    const antes = m.agente.estado.trilhas![E1]!.pedidaEm;
    await m.relogio.dormir(15_000);
    const gravar = m.agente.salvar.bind(m.agente);
    let gravou = 0;
    m.agente.salvar = () => {
      gravou++;
      gravar();
    };
    const r = await m.agente.alvoPonte().trilha!({ cwd, pid: process.pid, deNovo: true });
    const c = r.corpo as { trilha: unknown; bloqueio?: string };
    assert.equal(c.trilha, null);
    assert.match(c.bloqueio ?? "", /Empresa Um/);
    assert.equal(gravou, 0, "a espera pergunta a cada 15 s: regravar o estado a cada pergunta desfaria o ganho no disco");
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pids, [], "quem espera não segura a trilha");
    assert.ok(m.agente.estado.trilhas![E1]!.pedidaEm > antes, "segue pedida: a nuvem dá a conta quando ela soltar");
  });

  test("plano B: o pedido de novo que ganha a conta abre na trilha e grava o processo no disco", async () => {
    await preparar();
    await comPrincipal();
    const { b, cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [b] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "começa sem conta livre");
    banco.trilhas.get("pc-1")!.set(E1, { conta: b, versao: 2, motivo: "conta marcada para a empresa" });
    // o caso comum: a conta chega pelo ciclo do agente (de 5 em 5 s), entre duas perguntas da espera
    await m.relogio.dormir(5_000);
    await m.agente.busca();
    assert.ok(m.agente.estado.trilhas![E1]!.conta, "a conta chegou pelo ciclo");
    assert.equal(m.agente.estado.trilhas![E1]!.pids.includes(process.pid), false);
    await m.relogio.dormir(10_000);
    const r = await m.agente.alvoPonte().trilha!({ cwd, pid: process.pid, deNovo: true });
    assert.equal((r.corpo as { trilha: { empresa: string } | null }).trilha?.empresa, E1);
    assert.ok(m.agente.estado.trilhas![E1]!.pids.includes(process.pid));
    const noDisco = carregarEstado(m.c.estado).trilhas?.[E1];
    assert.ok(noDisco?.pids.includes(process.pid), "a sessão que abriu precisa estar no disco: numa queda, a trilha não solta a conta dela");
  });

  // plano B versão 2 (regra 1): a espera só sai pela principal quando o agente sabe que é ela
  const deNovo = async (cwd: string) =>
    (await m.agente.alvoPonte().trilha!({ cwd, pid: process.pid, deNovo: true })).corpo as {
      ok: boolean;
      trilha: { empresa: string } | null;
      bloqueio?: string;
      aviso?: string;
      certa?: boolean;
    };

  /** Projeto E1 só nas contas dele, sem conta livre: o primeiro pedido manda o lançador esperar. */
  async function esperando(): Promise<string> {
    await comPrincipal();
    const { cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "começa esperando a conta do projeto");
    return cwd;
  }

  test("plano B versão 2: o projeto desligado durante a espera, a pergunta de novo diz com certeza que é a principal", async () => {
    await preparar();
    const cwd = await esperando();
    banco.empresas = [];
    banco.regras = [];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null, certa: true });
    assert.deepEqual(await pedir(cwd), { ok: true, trilha: null }, "o primeiro pedido segue sem a marca, como o lançador antigo espera");
  });

  test("plano B versão 2: o projeto que passou a usar outras contas durante a espera também sai com certeza", async () => {
    await preparar();
    const cwd = await esperando();
    banco.empresas = [{ id: E1, nome: "Empresa Um" }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    const r = await deNovo(cwd);
    assert.equal(r.trilha, null);
    assert.equal(r.certa, true);
    assert.match(r.aviso ?? "", /Empresa Um/, "o painel fica sabendo que abriu na conta em uso");
  });

  test("plano B versão 2: sem ler a nuvem há mais de 2 min, a pergunta de novo não tem certeza e o lançador segue esperando", async () => {
    await preparar();
    const cwd = await esperando();
    banco.empresas = [];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.equal((await deNovo(cwd)).certa, true, "a leitura com o projeto desligado chegou");
    nuvemFalsa.empresas = async () => {
      throw new Error("a nuvem não responde");
    };
    await m.relogio.dormir((2 * EMPRESAS_LER_S + 1) * 1000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null });
  });

  test("plano B versão 2: depois de religar, com as regras só do disco, a pergunta de novo não tem certeza", async () => {
    await preparar();
    const cwd = await esperando();
    banco.empresas = [];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.equal((await deNovo(cwd)).certa, true);
    // religa sem nuvem que responda: as regras guardadas no disco valem, mas não dão certeza
    const tr = m.agente.trilhas! as unknown as { lidasEm: number; empresas: unknown[]; regras: unknown[]; guardadasLidas: boolean };
    tr.lidasEm = 0;
    tr.empresas = [];
    tr.regras = [];
    tr.guardadasLidas = false;
    nuvemFalsa.empresas = async () => {
      throw new Error("a nuvem não responde");
    };
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null });
  });

  test("plano B versão 2: a principal que serve ao projeto só tira da espera com a trava confirmada pela nuvem", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/);
    // o painel marca a conta em uso para o projeto, mas a nuvem não responde à trava
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    const segurar = nuvemFalsa.segurarPrincipal.bind(nuvemFalsa);
    nuvemFalsa.segurarPrincipal = async () => {
      throw new Error("a nuvem não responde");
    };
    const r = await deNovo(cwd);
    assert.equal(r.certa, undefined, "sem a trava confirmada, a conta em uso pode trocar com a sessão aberta");
    assert.equal(r.trilha, null);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal ?? [], [], "quem segue esperando não segura a conta em uso");
    nuvemFalsa.segurarPrincipal = segurar;
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null, certa: true });
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid], "a sessão que sai da espera nesse login segura a conta");
  });

  test("plano B versão 2: a leitura dos agentes do OpenBot que falha não tira a pasta do agente do projeto, nem dá certeza", async () => {
    banco = new BancoFalso();
    nuvemFalsa = new NuvemFalsa(banco, "pc-1");
    const ob = new OpenBotFalso();
    m = await montar({ nuvem: nuvemFalsa, openbot: ob });
    banco.agora = () => m.relogio.agora();
    const pastaAgente = path.join(m.c.home, "OpenBot", "Agents", "agent-1");
    const cwd = path.join(pastaAgente, "trabalho");
    fs.mkdirSync(cwd, { recursive: true });
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Projeto Exemplo" }];
    await comPrincipal();
    await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.regras = [{ tipo: "titulo", padrao: "Exemplo", empresa: E1 }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "a pasta do agente é do projeto pelo título dele");
    // o banco do OpenBot para de responder (trancado, ou o OpenBot atualizando)
    const ler = ob.agentes.bind(ob);
    ob.agentes = () => {
      throw new Error("banco do OpenBot trancado");
    };
    await m.relogio.dormir(301_000);
    assert.match((await deNovo(cwd)).bloqueio ?? "", /Empresa Um/, "a última lista lida segue valendo");
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "também no primeiro pedido: a sessão não abre na conta em uso");
    banco.empresas = [];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null }, "com a lista sem ler, o projeto desligado não dá certeza");
    ob.agentes = ler;
    await m.relogio.dormir(31_000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null, certa: true }, "a lista volta a ser lida logo, sem esperar 5 min");
  });

  test("empresa só nas contas dela, com a conta livre: abre normal na trilha", async () => {
    await preparar();
    await comPrincipal();
    const { b, cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [b] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const r = await pedir(cwd);
    assert.equal(r.trilha?.empresa, E1);
    assert.equal(r.bloqueio, undefined);
  });

  test("a conta saiu da lista da empresa: sessão nova não entra, mesmo com a trilha ainda nela", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    assert.equal((await pedir(cwd)).trilha?.empresa, E1, "a trilha já está na conta antes de ela sair da lista");
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const antes = m.agente.estado.trilhas![E1]!.pedidaEm;
    const r = await pedir(cwd);
    assert.equal(r.trilha, null);
    assert.match(r.bloqueio ?? "", /não abre em outra conta/);
    assert.equal(m.agente.estado.trilhas![E1]!.pedidaEm, antes, "o pedido negado não renova a trilha");
  });

  test("as regras da empresa passam pela chamada real à nuvem: só as contas dela e a lista delas", async () => {
    const conta = "99999999-2222-4333-8444-555555555555";
    const n = new NuvemRpc({
      chamar: async () => ({ ok: true, empresas: [{ id: E1, nome: "Um", estrita: true, contas: [conta, "lixo"] }, { id: E2, nome: "Dois" }], regras: [] }),
      horaDoServidor: async () => null,
    });
    const r = await n.empresas();
    assert.deepEqual(r.empresas, [{ id: E1, nome: "Um", estrita: true, contas: [conta] }, { id: E2, nome: "Dois" }]);
  });

  test("0.22.0: a regra de pasta do OpenBot passa pela chamada real; tipo desconhecido continua de fora", async () => {
    const n = new NuvemRpc({
      chamar: async () => ({
        ok: true,
        empresas: [{ id: E1, nome: "Um" }],
        regras: [
          { tipo: "secao", padrao: "clientes", empresa: E1 },
          { tipo: "pasta", padrao: "~/x", empresa: E1 },
          { tipo: "outro", padrao: "y", empresa: E1 },
        ],
      }),
      horaDoServidor: async () => null,
    });
    const r = await n.empresas();
    assert.deepEqual(r.regras, [
      { tipo: "secao", padrao: "clientes", empresa: E1 },
      { tipo: "pasta", padrao: "~/x", empresa: E1 },
    ]);
  });

  test("0.22.0: a pasta do OpenBot leva a sessão do agente ao projeto; sem leitura da barra, a pergunta de novo não tem certeza", async () => {
    banco = new BancoFalso();
    nuvemFalsa = new NuvemFalsa(banco, "pc-1");
    const ob = new OpenBotFalso();
    ob.barraEstado = () => "ok";
    m = await montar({ nuvem: nuvemFalsa, openbot: ob });
    banco.agora = () => m.relogio.agora();
    const pastaAgente = path.join(m.c.home, "OpenBot", "Agents", "agent-1");
    const cwd = path.join(pastaAgente, "trabalho");
    fs.mkdirSync(cwd, { recursive: true });
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Sem regra", secoes: ["clientes"] }];
    await comPrincipal();
    await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.regras = [{ tipo: "secao", padrao: "clientes", empresa: E1 }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "a pasta do agente é do projeto pela pasta do OpenBot");
    // a barra nunca foi lida (estragada desde que o agente ligou): o agente fica sem pasta e não há certeza
    ob.barraEstado = () => "sem_leitura";
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Sem regra" }];
    await m.relogio.dormir(301_000);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null }, "com regra de pasta do OpenBot e a barra sem leitura, sem certeza");
    // sem regra de pasta do OpenBot, quem não usa pastas não fica sem certeza por causa da barra
    banco.regras = [{ tipo: "titulo", padrao: "Nenhum", empresa: E1 }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null, certa: true });
  });

  test("0.22.0 (revisão): barra sem leitura e pasta do OpenBot de projeto estrito: a conversa do agente espera; fora das pastas dos agentes, nada muda", async () => {
    banco = new BancoFalso();
    nuvemFalsa = new NuvemFalsa(banco, "pc-1");
    const ob = new OpenBotFalso();
    // como no OpenBot de verdade, o estado da barra só muda numa leitura
    let estado: "ok" | "sem_leitura" = "sem_leitura";
    let proximo: "ok" | "sem_leitura" = "sem_leitura";
    ob.barraEstado = () => estado;
    const ler = ob.agentes.bind(ob);
    ob.agentes = () => {
      estado = proximo;
      return ler();
    };
    m = await montar({ nuvem: nuvemFalsa, openbot: ob });
    banco.agora = () => m.relogio.agora();
    const pastaAgente = path.join(m.c.home, "OpenBot", "Agents", "agent-1");
    const cwd = path.join(pastaAgente, "trabalho");
    const fora = path.join(m.c.home, "outro-projeto");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(fora, { recursive: true });
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Sem regra" }];
    await comPrincipal();
    await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true }];
    banco.regras = [{ tipo: "secao", padrao: "clientes", empresa: E1 }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    // a pasta do agente pode ser do projeto estrito pela pasta do OpenBot e a barra não foi lida: a primeira pergunta
    // não abre na conta em uso, espera (a pergunta de novo segue sem certeza até a barra ser lida)
    assert.match((await pedir(cwd)).bloqueio ?? "", /pastas do OpenBot/);
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null });
    // a sessão fora das pastas dos agentes não depende da barra
    assert.deepEqual(await pedir(fora), { ok: true, trilha: null });
    assert.deepEqual(await deNovo(fora), { ok: true, trilha: null, certa: true });
    // a barra que não está boa faz ler de novo em 30 s, não em 5 min
    await m.relogio.dormir(301_000);
    await pedir(fora);
    const lidas = ob.leituras;
    await m.relogio.dormir(31_000);
    await pedir(fora);
    assert.equal(ob.leituras, lidas + 1, "barra sem leitura: lê de novo em 30 s");
    proximo = "ok";
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Sem regra", secoes: ["clientes"] }];
    await m.relogio.dormir(31_000);
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "lida a barra, a pasta é do projeto");
    const depois = ob.leituras;
    await m.relogio.dormir(31_000);
    await pedir(fora);
    assert.equal(ob.leituras, depois, "barra boa: de volta aos 5 min");
    // projeto que não é estrito: a barra sem leitura não segura a conversa do agente
    proximo = "sem_leitura";
    ob.lista = [{ pasta: pastaAgente, nome: "Agente Um", titulo: "Sem regra" }];
    banco.empresas = [{ id: E1, nome: "Empresa Um" }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.relogio.dormir(301_000);
    assert.equal((await pedir(cwd)).bloqueio, undefined);
  });

  /** A conta A em uso na principal é a única da empresa, sem trilha própria. */
  async function naPrincipalDaEmpresa(): Promise<{ cwd: string; idNuvem: string }> {
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    return { cwd, idNuvem };
  }

  test("a nuvem recusa segurar a conta: a sessão não abre no login da principal", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    nuvemFalsa.recusarTrava = true;
    const r = await pedir(cwd);
    assert.equal(r.trilha, null);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [], "quem não abriu não segura a conta");
  });

  test("a nuvem já mandou outra conta para a principal: a conta local atrasada não serve", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    m.agente.ultimaAtribuicao = { ...m.agente.ultimaAtribuicao!, conta_id: "77777777-2222-4333-8444-555555555555" };
    const r = await pedir(cwd);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
  });

  test("no modo de teste a regra só registra: nenhuma sessão é barrada", async () => {
    banco = new BancoFalso();
    nuvemFalsa = new NuvemFalsa(banco, "pc-1");
    m = await montar({ nuvem: nuvemFalsa, sombra: true });
    banco.agora = () => m.relogio.agora();
    const { cwd } = await naPrincipalDaEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const r = await pedir(cwd);
    assert.equal(r.bloqueio, undefined);
  });

  test("sessão retomada segue a regra da pasta, mesmo tendo parado no login da principal", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    const tr = m.agente.trilhas!;
    assert.deepEqual(tr.retomada(cwd), { espera: true, empresa: E1 }, "a trava vem antes de o processo abrir");
    assert.deepEqual(await tr.segurarPrincipal(), [E1], "o pedido da retomada vai à nuvem");
    assert.deepEqual(tr.retomada(cwd), { principalDe: E1 }, "a conta em uso é dela: volta nesse login, com a trava");
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.deepEqual(tr.retomada(cwd), { espera: true, empresa: E1 }, "sem conta dela: espera na fila");
  });

  test("processo retomado na principal entra na trava da conta em uso", async () => {
    await preparar();
    await naPrincipalDaEmpresa();
    m.agente.trilhas!.anotarPrincipal(E1, process.pid);
    assert.deepEqual(await m.agente.trilhas!.segurarPrincipal(), [E1]);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid]);
  });

  test("depois de religar, um número de processo reaproveitado não prende a conta", async () => {
    await preparar();
    await naPrincipalDaEmpresa();
    const tr = m.agente.trilhas!;
    tr.anotarPrincipal(E1, process.pid);
    assert.equal(tr.segurandoPrincipal(), true);
    m.agente.estado.trilhas![E1]!.iniciosPrincipal = { [String(process.pid)]: "outra hora" };
    (tr as unknown as { pidsConferidos: boolean }).pidsConferidos = false;
    assert.equal(tr.segurandoPrincipal(), false);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, []);
  });

  test("a trava venceu com o computador fora e a nuvem mandou outra conta: a conta em uso fica", async () => {
    await preparar();
    await naPrincipalDaEmpresa();
    m.agente.trilhas!.anotarPrincipal(E1, process.pid);
    const ativa = m.agente.estado.ativa;
    const c = await semear("C");
    const r = await m.agente.aplicarAtribuicao({ ...m.agente.ultimaAtribuicao!, conta_id: c, versao: 99 });
    assert.equal(r.ok, false);
    assert.match(r.erro ?? "", /sessão de projeto/);
    assert.equal(m.agente.estado.ativa, ativa);
  });

  test("a unidade deixou de ser a representante da trilha: a sessão aberta segue prendendo a conta", async () => {
    await preparar();
    await naPrincipalDaEmpresa();
    const tr = m.agente.trilhas!;
    tr.anotarPrincipal(E1, process.pid);
    banco.empresas = [{ id: E2, nome: "Empresa Dois", estrita: true, contas: [m.agente.estado.contas[m.agente.estado.ativa!]!.contaId!] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.equal(tr.segurandoPrincipal(), true);
  });

  test("a nuvem olhou a conta em uso e disse que não é da unidade: o processo solta a trava", async () => {
    await preparar();
    const { idNuvem } = await naPrincipalDaEmpresa();
    const tr = m.agente.trilhas!;
    tr.anotarPrincipal(E1, process.pid);
    nuvemFalsa.recusarTrava = true;
    nuvemFalsa.contaDaTrava = "77777777-2222-4333-8444-555555555555";
    await tr.segurarPrincipal();
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid], "a nuvem olhou outra conta: segue preso");
    nuvemFalsa.contaDaTrava = idNuvem;
    await tr.segurarPrincipal();
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, []);
  });

  test("depois de religar com a nuvem fora, as últimas regras seguem valendo", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: ["77777777-2222-4333-8444-555555555555"] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.ok(m.agente.estado.regrasEmpresas?.empresas.length, "as regras ficam guardadas");
    const tr = m.agente.trilhas! as unknown as { lidasEm: number; empresas: unknown[]; regras: unknown[]; guardadasLidas: boolean };
    tr.lidasEm = 0;
    tr.empresas = [];
    tr.regras = [];
    tr.guardadasLidas = false;
    nuvemFalsa.empresas = async () => {
      throw new Error("nuvem fora");
    };
    const r = await pedir(cwd);
    assert.match(r.bloqueio ?? "", /Empresa Um/, "sem as regras guardadas, abriria em qualquer conta");
  });

  test("a nuvem não confirma a trava a tempo: a sessão não abre", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    nuvemFalsa.segurarPrincipal = () => new Promise(() => undefined);
    const r = await pedir(cwd);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, []);
  });

  test("conversa do OpenBot sem a conta da empresa agora: espera na fila e não continua em outra", async () => {
    banco = new BancoFalso();
    nuvemFalsa = new NuvemFalsa(banco, "pc-1");
    const ob = new OpenBotFalso();
    m = await montar({ nuvem: nuvemFalsa, openbot: ob });
    banco.agora = () => m.relogio.agora();
    await comPrincipal();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: ["77777777-2222-4333-8444-555555555555"] }];
    banco.regras = [{ tipo: "pasta", padrao: "~/OpenBot/Agents/agent-0000", empresa: E1 }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const sessao = "99999999-0000-4000-8000-000000000009";
    const cwd = path.join(m.c.home, "OpenBot", "Agents", "agent-0000");
    const dir = path.join(m.c.projetos, "-openbot");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const linhas = [
      { type: "user", sessionId: sessao, cwd, entrypoint: "openbot", message: { content: [{ type: "text", text: "Faça o relatório" }] } },
      { type: "assistant", sessionId: sessao, cwd, isApiErrorMessage: true, error: "rate_limit", message: { content: [{ type: "text", text: "limite" }] } },
    ];
    fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    ob.principais.set(sessao, "agent-0000");
    m.agente.estado.config.retomarHeadless = true;
    m.agente.estado.fila.push({ sessao, tipo: "headless", estado: "aguardando", em: m.relogio.agora() } as never);
    m.agente.retomarHeadless(sessao);
    await m.agente.esperar();
    assert.equal(ob.enviadas.length, 0);
    const f = m.agente.estado.fila.at(-1)!;
    assert.equal(f.estado, "aguardando");
    assert.equal(f.trilha, E1);
    // a conta não voltou dentro do prazo: a conversa não reabre sozinha dias depois
    await m.relogio.dormir((FILA_VALIDA_OPENBOT_S + 1) * 1000);
    m.agente.retomarHeadless(sessao);
    await m.agente.esperar();
    assert.equal(f.estado, "descartada");
    assert.equal(ob.enviadas.length, 0);
  });

  test("sessão retomada na trilha fica registrada nela: a nuvem não solta a conta com o processo rodando", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    await pedir(cwd, null);
    const sessao = "99999999-0000-4000-8000-00000000000a";
    const dir = path.join(m.c.projetos, "-proj-e1");
    fs.mkdirSync(dir, { recursive: true });
    const linhas = [
      { type: "user", sessionId: sessao, cwd, entrypoint: "sdk-cli", message: { content: [{ type: "text", text: "Faça o relatório" }] } },
      { type: "assistant", sessionId: sessao, cwd, isApiErrorMessage: true, error: "rate_limit", message: { content: [{ type: "text", text: "limite" }] } },
    ];
    fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    m.agente.estado.config.retomarHeadless = true;
    m.cli.pidRetomada = process.pid;
    m.agente.estado.fila.push({ sessao, tipo: "headless", estado: "aguardando", em: m.relogio.agora(), trilha: E1 } as never);
    const antes = m.agente.estado.trilhas![E1]!.pedidaEm;
    await m.relogio.dormir(5000);
    m.agente.retomarHeadless(sessao);
    await m.agente.esperar();
    assert.equal(m.cli.retomadas.at(-1)?.trilha?.empresa, E1);
    const t = m.agente.estado.trilhas![E1]!;
    assert.ok(t.pids.includes(process.pid));
    assert.ok(t.pedidaEm > antes);
  });

  test("a trilha já tem a conta e a unidade sumiu da lista: a sessão nova não abre nesse login", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    await pedir(cwd, null);
    assert.ok(m.agente.estado.trilhas![E1]!.conta);
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: ["77777777-2222-4333-8444-555555555555"] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.trilhas!.busca();
    banco.empresas = [];
    const r = await pedir(cwd);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pids, []);
  });

  test("a nuvem devolve uma conta que saiu da lista: a sessão nova não abre nesse login", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: ["77777777-2222-4333-8444-555555555555"] }];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    const tr = m.agente.trilhas!;
    await tr.busca();
    assert.equal(tr.empresaDe(cwd)?.estrita, true, "a regra estrita chegou ao agente");
    banco.empresas = [];
    const r = await pedir(cwd);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
  });

  test("desligaram a última unidade: a fila não fica presa na lista velha", async () => {
    await preparar();
    const { cwd } = await naPrincipalDaEmpresa();
    const tr = m.agente.trilhas!;
    tr.ligadas = false;
    banco.empresas = [];
    banco.regras = [];
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await tr.busca();
    assert.deepEqual(tr.retomada(cwd), {});
  });

  test("empresa só nas contas dela, com a conta dela na principal: abre nesse login, sem bloqueio", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    assert.ok(idNuvem, "a principal foi adotada pela nuvem");
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const r = await pedir(cwd);
    assert.deepEqual(r, { ok: true, trilha: null });
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pids, [], "a sessão na principal não segura a trilha");
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid]);
    assert.deepEqual(fns("segurarPrincipal").at(-1)?.args, [[E1]], "a nuvem sabe antes de a sessão abrir");
    const antes = fns("segurarPrincipal").length;
    await m.agente.busca();
    assert.ok(fns("segurarPrincipal").length > antes, "a trava se renova enquanto a sessão vive");
    contaEstacionada(m, "C");
    const troca = await m.agente.alvoPonte().trocar!({ email: "c@exemplo.com", local: true });
    assert.equal(troca.status, 409);
    assert.match(String((troca.corpo as { erro?: string }).erro), /sessão de projeto/);
  });

  test("plano B versão 2 (regra 4): a conversa que segurava a conta em uso fechou, e a trava na nuvem acaba na hora", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const filho = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      assert.deepEqual(await pedir(cwd, filho.pid!), { ok: true, trilha: null });
      assert.deepEqual(fns("segurarPrincipal").at(-1)?.args, [[E1]], "a nuvem segura a conta em uso para a conversa");
    } finally {
      const saiu = new Promise((ok) => filho.on("exit", ok));
      filho.kill("SIGKILL");
      await saiu;
    }
    await m.agente.busca();
    assert.deepEqual(fns("segurarPrincipal").at(-1)?.args, [[]], "a nuvem fica sabendo na hora que ninguém segura mais");
    const n = fns("segurarPrincipal").length;
    await m.agente.busca();
    await m.agente.busca();
    assert.equal(fns("segurarPrincipal").length, n, "uma vez só: sem nada a segurar, não chama a nuvem a cada volta");
  });

  test("plano B versão 2 (regra 4): comando que não conversa pergunta sem o processo, e nada fica anotado nem seguro", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const pedida = m.agente.estado.trilhas?.[E1]?.pedidaEm;
    const buscas = fns("trilhas").length;
    await m.relogio.dormir(5_000);
    assert.deepEqual(await semConversa(cwd), { ok: true, trilha: null });
    assert.deepEqual(m.agente.estado.trilhas?.[E1]?.pidsPrincipal ?? [], [], "o lançador não mandou processo: nada a anotar");
    assert.equal(m.agente.estado.trilhas?.[E1]?.pedidaEm, pedida, "a trilha não fica pedida por um claude --version");
    assert.equal(fns("trilhas").length, buscas, "nem a nuvem é perguntada pela conta: ele não espera nada");
    assert.equal(fns("segurarPrincipal").length, 0, "a nuvem não segura a conta em uso para um claude --version");
    await m.agente.busca();
    assert.equal(fns("segurarPrincipal").length, 0);
  });

  test("plano B versão 2 (regra 4): comando que não conversa, com a trilha que já tem conta, abre nela sem anotar nada", async () => {
    await preparar();
    await comPrincipal();
    const { cwd } = await comEmpresa();
    await pedir(cwd, null);
    const t = m.agente.estado.trilhas![E1]!;
    assert.ok(t.conta, "a trilha já tem a conta");
    const pedida = t.pedidaEm;
    const buscas = fns("trilhas").length;
    await m.relogio.dormir(5_000);
    const r = await semConversa(cwd);
    assert.equal(r.trilha?.empresa, E1);
    assert.equal(r.trilha?.pasta, t.pasta, "a mesma pasta de login da conversa do projeto");
    assert.deepEqual(t.pids, [], "o processo não fica na trilha");
    assert.equal(t.pedidaEm, pedida);
    assert.equal(fns("trilhas").length, buscas);
  });

  test("revisão da 0.21.0: a mesma sessão pergunta de novo (a resposta passou do prazo da ponte) e abre na trilha: solta a conta em uso", async () => {
    await preparar();
    const a = await comPrincipal();
    const { b, cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem, b] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    // a primeira resposta (a conta em uso, com a trava) se perde no prazo da ponte; o lançador pergunta de novo 1 s depois
    assert.deepEqual(await pedir(cwd), { ok: true, trilha: null });
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid]);
    banco.trilhas.get("pc-1")!.set(E1, { conta: b, versao: 2, motivo: "conta marcada para a empresa" });
    await m.relogio.dormir(1_000);
    const r = await pedir(cwd);
    assert.equal(r.trilha?.empresa, E1, "a busca atrasada deu a conta à trilha, e a sessão abre nela");
    const t = m.agente.estado.trilhas![E1]!;
    assert.deepEqual(t.pidsPrincipal ?? [], [], "a sessão da trilha não segura a conta em uso");
    assert.equal(t.iniciosPrincipal?.[String(process.pid)], undefined);
    assert.deepEqual(carregarEstado(m.c.estado).trilhas?.[E1]?.pidsPrincipal ?? [], [], "e o disco também já não tem o processo");
    await m.agente.busca();
    assert.deepEqual(fns("segurarPrincipal").at(-1)?.args, [[]], "a nuvem fica sabendo que ninguém segura mais a conta em uso");
  });

  test("plano B versão 2 (regra 5): com a trava recusada, a pergunta de novo não anota o processo nem grava", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    nuvemFalsa.recusarTrava = true;
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/, "a nuvem recusou a trava: a sessão espera");
    await m.relogio.dormir(15_000);
    const gravar = m.agente.salvar.bind(m.agente);
    let gravou = 0;
    m.agente.salvar = () => {
      gravou++;
      gravar();
    };
    const r = await deNovo(cwd);
    assert.equal(r.certa, undefined);
    assert.match(r.bloqueio ?? "", /Empresa Um/);
    assert.deepEqual(fns("segurarPrincipal").at(-1)?.args, [[E1]], "a nuvem é perguntada pela trava");
    assert.equal(gravou, 0, "a cada 15 s: anotar e tirar o processo regravaria o estado à toa");
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal ?? [], []);
    nuvemFalsa.recusarTrava = false;
    assert.deepEqual(await deNovo(cwd), { ok: true, trilha: null, certa: true });
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, [process.pid], "confirmada a trava, a sessão segura a conta");
    assert.equal(gravou, 1, "uma gravação, a do processo anotado");
    // revisão da 0.21.0: a resposta com a trava se perdeu no prazo da ponte, e a pergunta seguinte é a espera de novo
    nuvemFalsa.recusarTrava = true;
    await m.relogio.dormir(15_000);
    assert.match((await deNovo(cwd)).bloqueio ?? "", /Empresa Um/);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal ?? [], [], "quem segue esperando não segura a conta em uso");
  });

  test("plano B versão 2: a renovação do ciclo no meio da pergunta de novo não apaga a trava que ela pediu", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    nuvemFalsa.recusarTrava = true;
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/);
    nuvemFalsa.recusarTrava = false;
    await m.agente.busca();
    // a nuvem grava a lista da trava da pergunta de novo, e a resposta demora a voltar
    const segurar = nuvemFalsa.segurarPrincipal.bind(nuvemFalsa);
    let soltar: (() => void) | null = null;
    let segurando = false;
    nuvemFalsa.segurarPrincipal = async (empresas: string[]) => {
      const r = await segurar(empresas);
      if (empresas.includes(E1) && !segurando) {
        segurando = true;
        await new Promise<void>((ok) => (soltar = ok));
      }
      return r;
    };
    const pergunta = deNovo(cwd);
    for (let i = 0; i < 200 && !soltar; i++) await new Promise((ok) => setImmediate(ok));
    assert.ok(soltar, "a pergunta de novo pediu a trava");
    // o ciclo de 5 s renova a trava enquanto a resposta não volta
    const ciclo = m.agente.trilhas!.segurarPrincipal();
    for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
    (soltar as unknown as () => void)();
    assert.equal((await pergunta).certa, true);
    await ciclo;
    const ultima = fns("segurarPrincipal").at(-1)?.args as string[][];
    assert.ok(ultima[0]!.includes(E1), `a última lista que chegou à nuvem segura o projeto: ${JSON.stringify(ultima)}`);
  });

  test("plano B versão 2: a chamada à nuvem que não volta segura a fila da trava por 20 s, não para sempre", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    nuvemFalsa.recusarTrava = true;
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    assert.match((await pedir(cwd)).bloqueio ?? "", /Empresa Um/);
    nuvemFalsa.recusarTrava = false;
    await m.agente.busca();
    assert.equal((await deNovo(cwd)).certa, true, "a sessão segura a conta em uso");
    // a próxima chamada à nuvem nunca volta (a conexão ficou pendurada)
    const segurar = nuvemFalsa.segurarPrincipal.bind(nuvemFalsa);
    let chamadas = 0;
    nuvemFalsa.segurarPrincipal = async (empresas: string[]) => {
      if (chamadas++ === 0) return new Promise<never>(() => undefined);
      return segurar(empresas);
    };
    const tr = m.agente.trilhas!;
    void tr.segurarPrincipal();
    const segunda = tr.segurarPrincipal();
    for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
    assert.equal(chamadas, 1, "uma chamada por vez: a segunda espera a primeira");
    await m.relogio.avancar(20_000);
    const r = await Promise.race([segunda, new Promise((ok) => setTimeout(() => ok("presa"), 2_000))]);
    assert.deepEqual(r, [E1], "passados 20 s, a segunda vai à nuvem e renova a trava");
  });

  test("plano B versão 2 (regra 5): a pergunta de novo aproveita a busca na nuvem de menos de 10 s", async () => {
    await preparar();
    const cwd = await esperando();
    await m.relogio.dormir(11_000);
    await m.agente.busca();
    const n = fns("trilhas").length;
    assert.match((await deNovo(cwd)).bloqueio ?? "", /Empresa Um/);
    assert.equal(fns("trilhas").length, n, "a busca de agora há pouco vale: não pergunta à nuvem a cada 15 s");
    await m.relogio.dormir(11_000);
    assert.match((await deNovo(cwd)).bloqueio ?? "", /Empresa Um/);
    assert.equal(fns("trilhas").length, n + 1, "passados 10 s, busca de novo");
  });

  test("sessão que já fechou não segura a conta em uso", async () => {
    await preparar();
    const a = await comPrincipal();
    const { cwd } = await comEmpresa();
    const idNuvem = m.agente.estado.contas[a]!.contaId!;
    banco.empresas = [{ id: E1, nome: "Empresa Um", estrita: true, contas: [idNuvem] }];
    banco.trilhas.get("pc-1")!.delete(E1);
    await m.relogio.dormir((EMPRESAS_LER_S + 1) * 1000);
    await m.agente.busca();
    const r = await pedir(cwd, 999_999);
    assert.deepEqual(r, { ok: true, trilha: null });
    assert.equal(fns("segurarPrincipal").length, 0);
    assert.deepEqual(m.agente.estado.trilhas![E1]!.pidsPrincipal, []);
  });

  test("o painel desliga a última empresa: a marca do lançador some", async () => {
    await preparar();
    await comPrincipal();
    await comEmpresa();
    assert.ok(fs.existsSync(path.join(m.c.trilhas, "ligadas")));
    banco.empresas = [];
    banco.trilhas.delete("pc-1");
    await m.agente.busca();
    assert.equal(fs.existsSync(path.join(m.c.trilhas, "ligadas")), false);
  });
});
