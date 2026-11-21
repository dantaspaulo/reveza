// Trilhas (0.18.0): a empresa separada roda só com as contas marcadas para ela, numa pasta de login própria.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import { criarClassificador, ehCaminho, normalizarPasta } from "../src/trilhas.js";
import { ativaEm, BancoFalso, blob, montar, NuvemFalsa, type Montado } from "./falsos.js";

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
afterEach(() => m?.limpar());
const fns = (fn: string) => banco.chamadas.filter((c) => c.fn === fn);

async function preparar() {
  banco = new BancoFalso();
  m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1") });
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
  return r.corpo as { ok: boolean; trilha: { empresa: string; nome: string; pasta: string } | null; aviso?: string };
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
