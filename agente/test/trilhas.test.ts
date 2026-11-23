// Trilhas (0.18.0): a empresa separada roda só com as contas marcadas para ela, numa pasta de login própria.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { FILA_VALIDA_OPENBOT_S } from "../src/config.js";
import { lerChave } from "../src/ligar.js";
import { NuvemRpc } from "../src/nuvem/rpc.js";
import { criarClassificador, ehCaminho, EMPRESAS_LER_S, EMPRESAS_VENCIDAS_S, normalizarPasta } from "../src/trilhas.js";
import { ativaEm, BancoFalso, blob, contaEstacionada, montar, NuvemFalsa, OpenBotFalso, type Montado } from "./falsos.js";

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
    assert.match(r.erro ?? "", /sessão de empresa ou projeto/);
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
    assert.match(String((troca.corpo as { erro?: string }).erro), /sessão de empresa ou projeto/);
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
