// O conserto do `reveza doctor` e do Corrigir do painel: cada problema sai com o conserto seguro dele (lista fechada) ou
// com o que fazer; cada conserto tem teste; o `--so-ver` e a conferência periódica só leem. Tudo com HOME temporária,
// executor falso e nuvem falsa: nada instala, troca ou chama rede de verdade.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import type * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { doctor, textoDoctor, type DepsDoctor } from "../src/doctor.js";
import { ambienteDoUsuario, consertar, instalarMod, ORDEM_CONSERTOS, pastaDoPrograma, resumoConserto } from "../src/conserto.js";
import * as servico from "../src/servico.js";
import { executarCli, type Ambiente } from "../src/cli.js";
import { chaveDaPonte, criarPonte } from "../src/ponte.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa, SEGREDO_COFRE } from "../src/cofre/guarda.js";
import { aadConta, cifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import type { Caminhos } from "../src/config.js";
import {
  ApiFalsa,
  ativaEm,
  BancoFalso,
  blob,
  CliFalsa,
  contaEstacionada,
  ExecutorFalso,
  montar,
  NuvemFalsa,
  pastaTemporaria,
  RelogioFalso,
  T0,
  type Montado,
} from "./falsos.js";

let tmp: ReturnType<typeof pastaTemporaria> | null = null;
let m: Montado | null = null;
let srv: http.Server | null = null;
afterEach(() => {
  srv?.close();
  srv = null;
  m?.limpar();
  m = null;
  tmp?.limpar();
  tmp = null;
});

const SO_MCP = { mcpOAuth: { servidor: { accessToken: "mcp-da-maquina" } } };

/** O mod carregado nas sessões (pelo CLAUDE_CODE_PLUGIN_DIRS do settings.json). */
function porMod(c: Caminhos): void {
  const mod = path.join(c.base, "mod-teste");
  fs.mkdirSync(path.join(mod, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(mod, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "reveza" }));
  fs.writeFileSync(path.join(c.principalDir, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: mod } }));
}

function deps(c: Caminhos, extra: Partial<DepsDoctor> = {}): DepsDoctor & { cred: CredenciaisFalsas; guarda: GuardaFalsa; cli: CliFalsa } {
  const cred = new CredenciaisFalsas();
  cred.d.set("principal", blob("A1"));
  return {
    c,
    cred,
    guarda: new GuardaFalsa(),
    cli: new CliFalsa(),
    api: new ApiFalsa(),
    statusServico: async () => ({ instalado: true, rodando: true, detalhe: "rodando" }),
    ponte: async () => ({ nuvem: { online: true }, cofre: true }),
    nuvemConfigurada: async () => ({ url: "https://exemplo.supabase.co" }),
    horaNuvem: async () => T0 + 5,
    agora: () => T0,
    ...extra,
  } as DepsDoctor & { cred: CredenciaisFalsas; guarda: GuardaFalsa; cli: CliFalsa };
}

const item = (r: { id: string }[], id: string) => r.find((x) => x.id === id) as ReturnType<typeof Object> & Awaited<ReturnType<typeof doctor>>[number];

// ------------------------------------------------------------------------------------------------ o que a conferência diz

describe("conferência: cada problema com o conserto seguro dele ou com o que fazer", () => {
  test("serviço parado, agente sem responder, mod ausente e assistente sem login: os quatro com conserto", async () => {
    tmp = pastaTemporaria();
    const d = deps(tmp.c, { statusServico: async () => ({ instalado: false, rodando: false, detalhe: "" }), ponte: async () => null });
    d.cred.d.set("principal", SO_MCP);
    const r = await doctor(d);
    assert.equal(item(r, "servico").conserto, "servico");
    assert.equal(item(r, "ponte").conserto, "servico");
    assert.equal(item(r, "mod").conserto, "mod");
    assert.equal(item(r, "credenciais").conserto, "credenciais", "com nuvem, a conta vem dela");
    for (const c of r) {
      assert.ok(!(c.conserto && c.fazer), `${c.id}: conserto e fazer ao mesmo tempo`);
      if (c.situacao === "ok") assert.ok(!c.conserto && !c.fazer, `${c.id}: ok não leva nada`);
      if (c.conserto) assert.ok(ORDEM_CONSERTOS.includes(c.conserto), `${c.id}: conserto fora da lista fechada`);
    }
  });

  test("a nuvem responde mas o agente está sem falar com ela: reiniciar o serviço", async () => {
    tmp = pastaTemporaria();
    const r = await doctor(deps(tmp.c, { ponte: async () => ({ nuvem: { online: false }, cofre: true }) }));
    assert.equal(item(r, "nuvem").situacao, "falha");
    assert.equal(item(r, "nuvem").conserto, "servico");
    const fora = await doctor(deps(tmp.c, { horaNuvem: async () => null }));
    assert.equal(item(fora, "nuvem").conserto, undefined, "a nuvem fora do ar não se conserta reiniciando o agente");
    assert.match(item(fora, "nuvem").fazer!, /internet/);
  });

  test("sem conserto automático, só o que fazer: relógio, chave do cofre, assistente e outro programa na porta", async () => {
    tmp = pastaTemporaria();
    const d = deps(tmp.c, { horaNuvem: async () => T0 + 600, ponte: async () => ({ ativa: "x", contas: [] }) });
    d.cli.versao = async () => null as unknown as string;
    fs.mkdirSync(tmp.c.base, { recursive: true });
    fs.writeFileSync(
      tmp.c.estado,
      JSON.stringify({ formato: 1, contas: { x: { id: "x", email: "x@exemplo.com", pasta: path.join(tmp.c.contas, "x"), precisaLogin: true, janelas: [] } } }),
    );
    const r = await doctor(d);
    const semConserto = (id: string, padrao: RegExp) => {
      const c = item(r, id);
      assert.notEqual(c.situacao, "ok", id);
      assert.equal(c.conserto, undefined, `${id} não tem conserto automático`);
      assert.match(c.fazer ?? "", padrao, id);
    };
    semConserto("relogio", /acerte a data e a hora.*não mexe/);
    semConserto("chaveiro", /painel.*Ligar computador novo|reveza ligar/);
    semConserto("assistente", /npm install -g @anthropic-ai\/claude-code/);
    semConserto("mod", /instale o assistente/);
    semConserto("ponte", /outro programa/);
  });

  test("conta pedindo login: com nuvem, o Corrigir traz o login do cofre (sem o que fazer junto); sem nuvem, só o que fazer", async () => {
    tmp = pastaTemporaria();
    fs.mkdirSync(tmp.c.base, { recursive: true });
    fs.writeFileSync(
      tmp.c.estado,
      JSON.stringify({ formato: 1, contas: { x: { id: "x", email: "x@exemplo.com", pasta: path.join(tmp.c.contas, "x"), precisaLogin: true, janelas: [] } } }),
    );
    const comNuvem = item(await doctor(deps(tmp.c)), "contas");
    assert.equal(comNuvem.situacao, "aviso");
    assert.equal(comNuvem.conserto, "contas");
    assert.equal(comNuvem.fazer, undefined, "o painel mostraria só o que fazer e esconderia o conserto");
    const semNuvem = item(await doctor(deps(tmp.c, { nuvemConfigurada: async () => null })), "contas");
    assert.equal(semNuvem.conserto, undefined, "sem nuvem não há cofre de onde trazer o login");
    assert.match(semNuvem.fazer ?? "", /entre de novo/);
  });

  test("dentro do agente (o Corrigir do painel) o serviço não se reinicia: só explica; sem serviço e em sombra também", async () => {
    tmp = pastaTemporaria();
    const parado = { statusServico: async () => ({ instalado: false, rodando: false, detalhe: "" }) };
    const dentro = await doctor(deps(tmp.c, { ...parado, onde: "agente" }));
    assert.equal(item(dentro, "servico").conserto, undefined);
    assert.match(item(dentro, "servico").fazer!, /terminal deste computador/);
    const semServico = await doctor(deps(tmp.c, { ...parado, semServico: true }));
    assert.equal(item(semServico, "servico").conserto, undefined);
    assert.match(item(semServico, "servico").fazer!, /--sem-servico/);
    const sombra = await doctor(deps(tmp.c, { sombra: true }));
    assert.equal(item(sombra, "mod").conserto, undefined, "no modo sombra o mod fica de fora de propósito");
    assert.match(item(sombra, "mod").fazer!, /sair-da-sombra/);
  });

  test("sem login com a conta que a nuvem mandou a caminho: aviso (não falha), e o conserto é pedir a troca agora", async () => {
    tmp = pastaTemporaria();
    const d = deps(tmp.c, { ponte: async () => ({ nuvem: { online: null }, cofre: true, credencial: { esperandoConta: true } }) });
    d.cred.d.set("principal", SO_MCP);
    const c = item(await doctor(d), "credenciais");
    assert.equal(c.situacao, "aviso");
    assert.match(c.detalhe, /esperando a conta que a nuvem mandou chegar/);
    assert.equal(c.conserto, "credenciais");
    const sem = deps(tmp.c, { ponte: async () => ({ nuvem: { online: true }, cofre: true, credencial: { esperandoConta: false } }) });
    sem.cred.d.set("principal", SO_MCP);
    assert.equal(item(await doctor(sem), "credenciais").situacao, "falha", "sem conta a caminho, é falha");
    let pedidos = 0;
    const r = await consertar(d, {
      credenciais: async () => {
        pedidos++;
        d.cred.d.set("principal", blob("B1"));
        return { ok: true, texto: "o assistente voltou a ter login: b@exemplo.com" };
      },
    });
    assert.equal(pedidos, 1, "no modo que conserta, a troca é pedida agora");
    assert.equal(item(r.depois, "credenciais").consertado!.resultado, "corrigido");
  });

  test("credencial: sem login e sem conta para pôr explica; login morto tem conserto; vencido com renovação e revogado não", async () => {
    tmp = pastaTemporaria();
    const semNuvem = { nuvemConfigurada: async () => null };
    const d1 = deps(tmp.c, semNuvem);
    d1.cred.d.clear();
    assert.match(item(await doctor(d1), "credenciais").fazer!, /reveza contas conectar/);

    const d2 = deps(tmp.c);
    d2.cred.d.set("principal", blob("X1", false, -60));
    const morto = item(await doctor(d2), "credenciais");
    assert.equal(morto.situacao, "falha");
    assert.equal(morto.conserto, "credenciais");

    const d3 = deps(tmp.c);
    d3.cred.d.set("principal", blob("X1", true, -60));
    const vencido = item(await doctor(d3), "credenciais");
    assert.equal(vencido.situacao, "aviso");
    assert.equal(vencido.conserto, undefined, "as sessões renovam sozinhas");

    const d4 = deps(tmp.c);
    (d4.api as ApiFalsa).recusados.add("A1");
    const revogado = item(await doctor(d4), "credenciais");
    assert.equal(revogado.situacao, "aviso");
    assert.match(revogado.fazer!, /entre de novo/);
  });
});

// ------------------------------------------------------------------------------------------------ o conserto em si

describe("consertar: só a lista fechada, na ordem, e cada problema diz se foi corrigido", () => {
  test("roda os consertos dos problemas achados, confere de novo e marca corrigido ou não deu", async () => {
    tmp = pastaTemporaria();
    let servicoNoAr = false;
    const d = deps(tmp.c, {
      statusServico: async () => ({ instalado: servicoNoAr, rodando: servicoNoAr, detalhe: servicoNoAr ? "rodando" : "" }),
      ponte: async () => (servicoNoAr ? { nuvem: { online: true }, cofre: true } : null),
      horaNuvem: async () => T0 + 600,
    });
    d.cred.d.set("principal", SO_MCP);
    const chamados: string[] = [];
    const r = await consertar(d, {
      servico: async () => {
        chamados.push("servico");
        servicoNoAr = true;
        return { ok: true, texto: "reinstalei o serviço e o agente respondeu" };
      },
      mod: async () => {
        chamados.push("mod");
        porMod(tmp!.c);
        return { ok: true, texto: "mod reinstalado" };
      },
      credenciais: async () => {
        chamados.push("credenciais");
        return { ok: false, texto: "a nuvem ainda não mandou conta para este computador" };
      },
    });
    assert.deepEqual(chamados, ["servico", "mod", "credenciais"], "na ordem, um de cada");
    const de = (id: string) => item(r.depois, id).consertado;
    assert.deepEqual(de("servico"), { resultado: "corrigido", texto: "reinstalei o serviço e o agente respondeu" });
    assert.equal(de("ponte")!.resultado, "corrigido", "a ponte volta com o serviço");
    assert.equal(de("mod")!.resultado, "corrigido");
    assert.deepEqual(de("credenciais"), { resultado: "nao_deu", texto: "a nuvem ainda não mandou conta para este computador" });
    assert.equal(de("relogio"), undefined, "o relógio não tem conserto: segue só com o que fazer");
    assert.match(item(r.depois, "relogio").fazer!, /acerte/);
    const texto = textoDoctor(r.depois);
    assert.match(texto, /Serviço .*→ corrigido: reinstalei o serviço/);
    assert.match(texto, /Credencial em uso .*→ não deu: a nuvem ainda não mandou conta/);
    assert.match(texto, /Relógio .*→ o que fazer: acerte/);
    assert.match(texto, /Conserto: 3 corrigido\(s\), 1 não deu\./);
    assert.equal(resumoConserto(r.depois), "corrigido: Serviço, Ponte local, Mod das sessões; não deu: Credencial em uso");
  });

  test("tudo funcionando: nenhum conserto roda e a conferência roda uma vez só", async () => {
    tmp = pastaTemporaria();
    porMod(tmp.c);
    let conferencias = 0;
    const d = deps(tmp.c, { horaNuvem: async () => (conferencias++, T0) });
    await d.guarda.gravar(SEGREDO_COFRE, Buffer.alloc(32, 1).toString("base64"));
    const r = await consertar(d, {
      servico: async () => assert.fail("não devia rodar"),
      mod: async () => assert.fail("não devia rodar"),
      credenciais: async () => assert.fail("não devia rodar"),
    });
    assert.equal(r.feitos.length, 0);
    assert.equal(conferencias, 1);
    assert.ok(r.depois.every((c) => !c.consertado));
  });

  test("conserto que não roda neste lugar, que falha ou que estoura vira não deu com o motivo", async () => {
    tmp = pastaTemporaria();
    const d = deps(tmp.c, { statusServico: async () => ({ instalado: false, rodando: false, detalhe: "" }) });
    d.cred.d.set("principal", SO_MCP);
    const r = await consertar(d, {
      mod: async () => {
        throw new Error("assistente travou");
      },
      credenciais: async () => ({ ok: true, texto: "dizia que deu" }),
    });
    assert.match(item(r.depois, "servico").consertado!.texto, /não roda daqui.*reveza doctor/);
    assert.equal(item(r.depois, "mod").consertado!.texto, "o conserto falhou: assistente travou");
    assert.equal(item(r.depois, "credenciais").consertado!.resultado, "nao_deu", "quem decide é a conferência de depois, não o conserto");
  });
});

// ------------------------------------------------------------------------------------------------ conserto da credencial

describe("conserto da credencial: a troca pedida ao trocador", () => {
  test("sem nuvem: o assistente saiu da conta em uso e ela volta, com os logins MCP da máquina", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", SO_MCP);
    const r = await m.agente.consertarCredencial();
    assert.deepEqual(r, { ok: true, texto: "o assistente voltou a ter login: a@exemplo.com" });
    assert.equal(m.cred.token("principal"), "A1");
    assert.deepEqual(m.cred.agora("principal")!.mcpOAuth, SO_MCP.mcpOAuth);
    assert.equal(m.agente.estado.ativa, a);
  });

  test("sem nuvem: a conta em uso precisa de login, então entra a melhor livre, e o login da que saiu fica guardado", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    contaEstacionada(m, "C", 40);
    const b = contaEstacionada(m, "B", 3);
    m.cred.d.set("principal", SO_MCP);
    m.agente.estado.contas[a]!.precisaLogin = true;
    const r = await m.agente.consertarCredencial();
    assert.ok(r.ok, r.texto);
    assert.equal(m.cred.token("principal"), "B1", "a menos usada das livres");
    assert.equal(m.agente.estado.ativa, b);
    assert.equal(m.cred.token(m.agente.estado.contas[a]!.pasta), "A1", "o último login visto de A não se perde");
  });

  test("sem nuvem e sem conta livre: não deu, com o que fazer", async () => {
    m = await montar();
    const a = await ativaEm(m, "A", 10);
    m.cred.d.set("principal", SO_MCP);
    m.agente.estado.contas[a]!.precisaLogin = true;
    const r = await m.agente.consertarCredencial();
    assert.equal(r.ok, false);
    assert.match(r.texto, /nenhuma conta livre.*entre de novo/);
    assert.equal(m.cred.token("principal"), undefined);
  });

  test("assistente já com login: nada é trocado", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    contaEstacionada(m, "B", 3);
    const r = await m.agente.consertarCredencial();
    assert.deepEqual(r, { ok: true, texto: "o assistente já está com login (a@exemplo.com)" });
    assert.ok(!m.agente.estado.eventos.some((x) => x.tipo === "troca"));
  });

  test("modo sombra: não troca", async () => {
    m = await montar({ sombra: true });
    contaEstacionada(m, "B", 3);
    const r = await m.agente.consertarCredencial();
    assert.equal(r.ok, false);
    assert.match(r.texto, /modo sombra/);
    assert.equal(m.cred.token("principal"), undefined);
  });

  describe("com nuvem", () => {
    let banco: BancoFalso;
    async function preparar(o: Parameters<typeof montar>[0] = {}) {
      banco = new BancoFalso();
      m = await montar({ nuvem: new NuvemFalsa(banco, "pc-1"), ...o });
      banco.agora = () => m!.relogio.agora();
    }

    test("o assistente saiu da conta atribuída: uma busca normal não põe de volta; o conserto põe, com o login mais novo do cofre", async () => {
      await preparar();
      const a = await ativaEm(m!, "A", 10);
      await m!.agente.esperar();
      await m!.agente.busca();
      const contaId = m!.agente.estado.contas[a]!.contaId!;
      assert.equal(banco.atribuicao.get("pc-1")!.conta, contaId);
      m!.cred.d.set("principal", SO_MCP);
      await m!.agente.busca();
      assert.equal(m!.cred.token("principal"), undefined, "a conta 'já está em uso': a busca não refaz (por isso o conserto)");
      // o cofre tem um login mais novo de A (o que a principal subiu antes de o assistente sair)
      const k = (await lerChave(m!.guarda))!;
      const novo = blob("A2", true, 7200, m!.relogio.agora());
      const { cifrado, nonce } = cifrarLogin(k, aadConta(contaId, 3), novo);
      banco.contas.get(contaId)!.cofre = { cifrado, nonce, versao: 3, expira_em: null };
      const r = await m!.agente.consertarCredencial();
      assert.deepEqual(r, { ok: true, texto: "o assistente voltou a ter login: a@exemplo.com" });
      assert.equal(m!.cred.token("principal"), "A2");
      assert.deepEqual(m!.cred.agora("principal")!.mcpOAuth, SO_MCP.mcpOAuth);
    });

    test("conta a caminho: só com o assistente sem login, a nuvem ainda por responder ou outra conta atribuída, e por 2 minutos", async () => {
      await preparar();
      const a = m!.agente;
      m!.cred.d.set("principal", SO_MCP);
      assert.equal(a.esperandoConta(), true, "recém-ligado, antes da primeira busca: a atribuição pode estar vindo");
      assert.deepEqual(a.publico().credencial, { esperandoConta: true }, "vai na ponte (o instalador e o doctor leem)");
      // a nuvem respondeu sem conta para este computador: nada a caminho
      await a.busca();
      assert.equal(a.esperandoConta(), false);
      // a nuvem atribuiu uma conta que ainda não chegou (a busca seguinte troca)
      const c = banco.conta("b@exemplo.com");
      const k = (await lerChave(m!.guarda))!;
      const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, 2), blob("B1", true, 3600, m!.relogio.agora()));
      c.cofre = { cifrado, nonce, versao: 2, expira_em: null };
      banco.atribuir("pc-1", c.id);
      a.ultimaAtribuicao = { conta_id: c.id, email: "b@exemplo.com", versao: 1, motivo: "teste" };
      await a.ciclo();
      assert.equal(a.esperandoConta(), true);
      await m!.relogio.avancar(121_000);
      assert.equal(a.esperandoConta(), false, "passados 2 minutos, algo travou: o doctor acusa falha");
      // a busca pôs a conta: com login, nada a esperar
      await a.busca();
      assert.equal(m!.cred.token("principal"), "B1");
      assert.equal(a.esperandoConta(), false);
      // o assistente saiu da conta que já consta em uso: a busca não põe de volta, então não é "a caminho"
      m!.cred.d.set("principal", SO_MCP);
      await a.ciclo();
      assert.equal(a.esperandoConta(), false);
    });

    test("sem nuvem nunca há conta a caminho (nada põe conta sozinho)", async () => {
      m = await montar();
      contaEstacionada(m, "B", 3);
      m.cred.d.set("principal", SO_MCP);
      assert.equal(m.agente.esperandoConta(), false);
    });

    test("computador novo sem conta e sem atribuição: não deu, e diz onde escolher a conta", async () => {
      await preparar();
      const r = await m!.agente.consertarCredencial();
      assert.equal(r.ok, false);
      assert.match(r.texto, /a nuvem ainda não mandou conta.*Trocar conta agora/);
    });

    test("computador novo com a conta atribuída no cofre: ela entra", async () => {
      await preparar();
      m!.cred.d.set("principal", SO_MCP);
      const c = banco.conta("b@exemplo.com");
      const k = (await lerChave(m!.guarda))!;
      const { cifrado, nonce } = cifrarLogin(k, aadConta(c.id, 2), blob("B1", true, 3600, m!.relogio.agora()));
      c.cofre = { cifrado, nonce, versao: 2, expira_em: null };
      banco.atribuir("pc-1", c.id);
      const r = await m!.agente.consertarCredencial();
      assert.ok(r.ok, r.texto);
      assert.equal(m!.cred.token("principal"), "B1");
    });

    test("Corrigir do painel: só o corrigir === true conserta; registra evento na nuvem; a busca periódica nunca conserta", async () => {
      let consertos = 0;
      let diagnosticos = 0;
      await preparar({
        diagnostico: async () => (diagnosticos++, { conferencias: [], em: "x" }),
        consertar: async () => {
          consertos++;
          return {
            diagnostico: { conferencias: [{ id: "mod", situacao: "ok", consertado: { resultado: "corrigido", texto: "mod reinstalado" } }] },
            resumo: "corrigido: Mod das sessões",
            corrigidos: 1,
            naoDeu: 0,
          };
        },
      });
      await m!.agente.busca();
      await m!.relogio.avancar(700_000);
      await m!.agente.busca();
      assert.equal(diagnosticos, 2, "a conferência periódica vai no agente_ola");
      assert.equal(consertos, 0, "e nunca conserta sozinha");
      banco.comandos.push({ id: 1, acao: "diagnostico", corpo: {}, pc: "pc-1", estado: "pendente" });
      banco.comandos.push({ id: 2, acao: "diagnostico", corpo: { corrigir: "true", item: "rm -rf /" }, pc: "pc-1", estado: "pendente" });
      await m!.agente.busca();
      assert.equal(consertos, 0, "sem o sim exato (true), é só o diagnóstico");
      banco.comandos.push({ id: 3, acao: "diagnostico", corpo: { corrigir: true }, pc: "pc-1", estado: "pendente" });
      await m!.agente.busca();
      assert.equal(consertos, 1);
      const cmd = banco.comandos.find((c) => c.id === 3)!;
      assert.equal(cmd.estado, "feito");
      assert.deepEqual((cmd.resposta as { corrigir: boolean }).corrigir, true);
      assert.equal(((cmd.resposta as { diagnostico: { conferencias: { id: string }[] } }).diagnostico.conferencias[0]!).id, "mod");
      const ev = banco.eventos.find((x) => (x.dados as { conserto?: boolean }).conserto);
      assert.ok(ev, "o conserto fica registrado na nuvem");
      assert.equal(ev!.tipo, "info");
      assert.equal(ev!.texto, "Conserto pedido pelo painel: corrigido: Mod das sessões.");
      assert.deepEqual(ev!.dados, { conserto: true, comando: 3, corrigidos: 1, nao_deu: 0 }, "o painel mostra o resumo pelos números, no idioma de quem vê");
      const antes = diagnosticos;
      await m!.agente.busca();
      const ola = banco.chamadas.filter((x) => x.fn === "ola");
      assert.deepEqual(ola[ola.length - 1]!.args[1], (cmd.resposta as { diagnostico: unknown }).diagnostico, "o próximo agente_ola leva o diagnóstico de depois do conserto");
      assert.equal(diagnosticos, antes, "o mesmo que o painel viu, sem rodar outro");
      await m!.agente.busca();
      assert.equal(banco.chamadas.filter((x) => x.fn === "ola").pop()!.args[1], null, "e só uma vez");
    });

    test("Rodar agora: o diagnóstico que voltou ao painel vai também no próximo agente_ola (o guardado fica novo)", async () => {
      let n = 0;
      await preparar({ diagnostico: async () => ({ conferencias: [], em: `rodada-${++n}` }) });
      await m!.agente.busca();
      const olas = () => banco.chamadas.filter((x) => x.fn === "ola").map((x) => (x.args[1] as { em?: string } | null)?.em ?? null);
      assert.deepEqual(olas(), ["rodada-1"]);
      banco.comandos.push({ id: 5, acao: "diagnostico", corpo: {}, pc: "pc-1", estado: "pendente" });
      await m!.agente.busca();
      const cmd = banco.comandos.find((c) => c.id === 5)!;
      assert.equal((cmd.resposta as { diagnostico: { em: string } }).diagnostico.em, "rodada-2");
      banco.foraDoAr = true;
      await m!.agente.busca();
      banco.foraDoAr = false;
      await m!.agente.busca();
      assert.deepEqual(olas(), ["rodada-1", null, "rodada-2"], "antes ficava só na resposta: o guardado esperava até 10 min; sem rede, vai na seguinte");
      await m!.agente.busca();
      assert.deepEqual(olas(), ["rodada-1", null, "rodada-2", null]);
    });

    test("agente sem conserto (versão de antes) responde que não conserta", async () => {
      await preparar();
      banco.comandos.push({ id: 9, acao: "diagnostico", corpo: { corrigir: true }, pc: "pc-1", estado: "pendente" });
      await m!.agente.busca();
      const cmd = banco.comandos.find((c) => c.id === 9)!;
      assert.equal(cmd.estado, "recusado");
    });
  });
});

// ------------------------------------------------------------------------------------------------ mod e serviço

describe("conserto do mod: o mesmo caminho do instalador", () => {
  test("instala pelo assistente com o marketplace na pasta do programa e a porta do agente, sem variáveis de sessão nem segredo", async () => {
    const exec = new ExecutorFalso();
    const env = ambienteDoUsuario({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/conta", CLAUDE_CODE_ENTRYPOINT: "x", ANTHROPIC_API_KEY: "k", REVEZA_SENHA: "s", HOME: "/h" });
    assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
    const r = await instalarMod({ exec, assistente: "/bin/assistente", app: "/app", porta: 7788, env });
    assert.equal(r.ok, true);
    assert.deepEqual(exec.chamadas.map((c) => c.argv), [
      ["/bin/assistente", "plugin", "install", "reveza", "--marketplace", "/app", "--scope", "user", "--config", "porta=7788", "--json", "-y"],
    ]);
  });

  test("já instalado: atualiza o marketplace e o mod; falha vira o que fazer", async () => {
    const exec = new ExecutorFalso();
    exec.responder = (argv) => (argv[2] === "install" ? { codigo: 1, saida: "", erro: "Plugin already installed" } : { codigo: 0, saida: "", erro: "" });
    const r = await instalarMod({ exec, assistente: "a", app: "/app", porta: 7788, env: {} });
    assert.deepEqual(r, { ok: true, texto: "mod atualizado (vale nas sessões novas)" });
    assert.deepEqual(exec.chamadas.slice(1).map((c) => c.argv.slice(1).join(" ")), ["plugin marketplace update reveza", "plugin update reveza@reveza"]);
    exec.responder = () => ({ codigo: 2, saida: "", erro: "sem rede" });
    const f = await instalarMod({ exec, assistente: "a", app: "/app", porta: 7788, env: {} });
    assert.equal(f.ok, false);
    assert.match(f.texto, /sem rede.*--atualizar/);
  });

  test("a pasta do programa é a de cima do agente instalado, e só quando ela tem o mod", () => {
    tmp = pastaTemporaria();
    const app = path.join(tmp.dir, "app");
    const cli = path.join(app, "agente", "dist", "src", "cli.js");
    assert.equal(pastaDoPrograma(cli), null);
    fs.mkdirSync(path.join(app, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(app, "mod", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(app, ".claude-plugin", "marketplace.json"), "{}");
    fs.writeFileSync(path.join(app, "mod", ".claude-plugin", "plugin.json"), "{}");
    assert.equal(pastaDoPrograma(cli), app);
  });
});

describe("serviço instalado: o conserto não tira nem põe o modo sombra", () => {
  const op = (sistema: "macos" | "linux" | "windows", extra: Partial<servico.OpcoesServico> = {}): servico.OpcoesServico => ({
    sistema,
    home: tmp!.c.home,
    exec: new ExecutorFalso(),
    node: "/n/node",
    script: "/a/cli.js",
    logs: tmp!.c.logs,
    uid: 501,
    dormir: async () => undefined,
    portaOcupada: async () => false,
    ...extra,
  });

  test("lê sombra e porta do plist, da unidade e da tarefa do Windows", async () => {
    tmp = pastaTemporaria();
    for (const s of ["macos", "linux", "windows"] as const) {
      assert.equal(servico.instalado(op(s)), null, `${s}: nada instalado`);
      await servico.instalar(op(s, { sombra: true, porta: 7799 }));
      assert.deepEqual(servico.instalado(op(s)), { sombra: true, porta: 7799 }, s);
      await servico.instalar(op(s));
      assert.deepEqual(servico.instalado(op(s)), { sombra: false, porta: undefined }, s);
    }
  });
});

// ------------------------------------------------------------------------------------------------ linha de comando

describe("reveza doctor na linha de comando", () => {
  function ambiente(c: Caminhos, exec: ExecutorFalso, extra: Partial<Ambiente> = {}): Ambiente & { saidas: string[] } {
    const saidas: string[] = [];
    const guarda = new GuardaFalsa();
    return {
      c,
      sistema: "macos",
      exec,
      relogio: new RelogioFalso(),
      saida: (t) => saidas.push(t),
      erro: (t) => saidas.push(t),
      perguntar: async () => "",
      env: { REVEZA_PORTA: "1" },
      script: "/app/cli.js",
      fabricas: { cred: () => new CredenciaisFalsas(), guarda: async () => guarda, api: () => new ApiFalsa(), cli: () => new CliFalsa(), nuvem: async () => null },
      saidas,
      ...extra,
    };
  }
  /** launchctl falso: nada carregado antes; depois do bootstrap, "rodando". */
  function launchctl(): ExecutorFalso {
    const exec = new ExecutorFalso();
    let carregado = false;
    exec.responder = (argv) => {
      if (argv[1] === "bootout") return { codigo: 3, saida: "", erro: "" };
      if (argv[1] === "bootstrap") carregado = true;
      if (argv[1] === "print") return carregado ? { codigo: 0, saida: "state = running", erro: "" } : { codigo: 113, saida: "", erro: "" };
      return { codigo: 0, saida: "", erro: "" };
    };
    return exec;
  }
  const mudancas = (exec: ExecutorFalso) => exec.chamadas.filter((c) => c.argv[1] !== "print" && c.argv[1] !== "--version").map((c) => c.argv.slice(0, 3).join(" "));

  test("--so-ver só lê: nenhum serviço instalado, nenhum mod, e diz que tem conserto", async () => {
    tmp = pastaTemporaria();
    const exec = launchctl();
    const a = ambiente(tmp.c, exec);
    assert.equal(await executarCli(["doctor", "--so-ver"], a), 1);
    assert.deepEqual(mudancas(exec), []);
    assert.equal(fs.existsSync(servico.arquivoPlist({ sistema: "macos", home: tmp.c.home } as servico.OpcoesServico)), false);
    assert.match(a.saidas.join("\n"), /Serviço .*→ tem conserto: rode reveza doctor/);
    const js = ambiente(tmp.c, launchctl());
    await executarCli(["doctor", "--so-ver", "--json"], js);
    assert.ok(Array.isArray(JSON.parse(js.saidas.join(""))), "o --json segue sendo a lista de conferências");
  });

  test("serviço não instalado: reinstala pelo caminho do `servico instalar`, sem modo sombra, e diz o que deu", async () => {
    tmp = pastaTemporaria();
    const exec = launchctl();
    const a = ambiente(tmp.c, exec);
    await executarCli(["doctor"], a);
    assert.deepEqual(mudancas(exec), ["launchctl bootout " + exec.chamadas.find((c) => c.argv[1] === "bootout")!.argv[2], "launchctl bootstrap " + exec.chamadas.find((c) => c.argv[1] === "bootstrap")!.argv[2]]);
    const plist = fs.readFileSync(path.join(tmp.c.home, "Library", "LaunchAgents", "ai.reveza.agente.plist"), "utf8");
    assert.ok(!plist.includes("--sombra"));
    assert.match(plist, /<string>\/app\/cli\.js<\/string>\s*<string>rodar<\/string>/);
    const texto = a.saidas.join("\n");
    assert.match(texto, /Serviço .*→ corrigido/);
    // a porta 1 nunca responde: a ponte segue fora, e diz o porquê
    assert.match(texto, /Ponte local .*→ não deu: reinstalei o serviço, mas o agente não respondeu em 30 s/);
  });

  test("instalação em sombra: a reinstalação segue em sombra, na porta dela", async () => {
    tmp = pastaTemporaria();
    const exec = launchctl();
    const o = { sistema: "macos", home: tmp.c.home, exec: new ExecutorFalso(), node: "/n", script: "/app/cli.js", logs: tmp.c.logs, uid: 501, dormir: async () => undefined } as servico.OpcoesServico;
    await servico.instalar({ ...o, sombra: true, porta: 7799 });
    await executarCli(["doctor"], ambiente(tmp.c, exec));
    assert.ok(mudancas(exec).some((x) => x.startsWith("launchctl bootstrap")));
    assert.deepEqual(servico.instalado(o), { sombra: true, porta: 7799 });
  });

  test("instalação sem serviço (--sem-servico): o doctor não instala o serviço", async () => {
    tmp = pastaTemporaria();
    fs.mkdirSync(tmp.c.base, { recursive: true });
    fs.writeFileSync(path.join(tmp.c.base, "instalacao.json"), JSON.stringify({ semServico: true }));
    const exec = launchctl();
    const a = ambiente(tmp.c, exec);
    await executarCli(["doctor"], a);
    assert.deepEqual(mudancas(exec), []);
    assert.match(a.saidas.join("\n"), /Serviço .*→ o que fazer: esta instalação roda sem serviço/);
  });

  test("mod ausente: reinstala pelo assistente com a pasta do programa e confere de novo", async () => {
    tmp = pastaTemporaria();
    const app = path.join(tmp.dir, "app");
    fs.mkdirSync(path.join(app, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(app, "mod", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(app, ".claude-plugin", "marketplace.json"), "{}");
    fs.writeFileSync(path.join(app, "mod", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "reveza" }));
    const exec = launchctl();
    const antes = exec.responder;
    exec.responder = (argv, entrada) => {
      // o assistente instala: o mod passa a aparecer nas sessões
      if (argv[1] === "plugin") porMod(tmp!.c);
      return antes(argv, entrada);
    };
    const a = ambiente(tmp.c, exec, { script: path.join(app, "agente", "dist", "src", "cli.js") });
    await executarCli(["doctor"], a);
    const plugin = exec.chamadas.find((c) => c.argv[1] === "plugin")!;
    assert.deepEqual(plugin.argv, ["/falso/assistente", "plugin", "install", "reveza", "--marketplace", app, "--scope", "user", "--config", "porta=7788", "--json", "-y"]);
    assert.match(a.saidas.join("\n"), /Mod das sessões .*→ corrigido: mod reinstalado/);
  });

  test("assistente sem login: a troca é pedida ao agente que está rodando, pela ponte, e a conta volta", async () => {
    m = await montar();
    const conta = await ativaEm(m, "A", 10);
    m.cred.d.set("principal", SO_MCP);
    m.agente.salvar(); // o doctor do terminal lê o estado que o agente grava
    porMod(m.c);
    srv = criarPonte(m.agente.alvoPonte(), 0, chaveDaPonte(m.c.ponteChave));
    await new Promise<void>((r) => srv!.listen(0, "127.0.0.1", () => r()));
    const porta = (srv.address() as AddressInfo).port;
    srv.close();
    srv = criarPonte(m.agente.alvoPonte(), porta, chaveDaPonte(m.c.ponteChave));
    await new Promise<void>((r) => srv!.listen(porta, "127.0.0.1", () => r()));
    const exec = launchctl();
    exec.responder = (argv) => (argv[1] === "print" ? { codigo: 0, saida: "state = running", erro: "" } : { codigo: 0, saida: "", erro: "" });
    fs.mkdirSync(path.join(m.c.home, "Library", "LaunchAgents"), { recursive: true });
    fs.writeFileSync(path.join(m.c.home, "Library", "LaunchAgents", "ai.reveza.agente.plist"), "<plist/>");
    const a = ambiente(m.c, exec, {
      env: { REVEZA_PORTA: String(porta) },
      fabricas: { cred: () => m!.cred, guarda: async () => m!.guarda, api: () => m!.api, cli: () => m!.cli, nuvem: async () => null },
    });
    await executarCli(["doctor"], a);
    const texto = a.saidas.join("\n");
    assert.match(texto, /Credencial em uso .*a@exemplo\.com.*→ corrigido: o assistente voltou a ter login: a@exemplo\.com/);
    assert.equal(m.cred.token("principal"), "A1");
    assert.equal(m.agente.estado.ativa, conta);
    assert.deepEqual(mudancas(exec), [], "nada além da troca: o serviço estava de pé");
    assert.ok(m.agente.estado.eventos.some((x) => x.texto === "Conserto pelo terminal: o assistente voltou a ter login: a@exemplo.com."));
  });

  test("assistente sem login e o agente fora do ar: não deu, e diz para subir o agente", async () => {
    tmp = pastaTemporaria();
    const cred = new CredenciaisFalsas();
    cred.d.set("principal", SO_MCP);
    fs.mkdirSync(tmp.c.base, { recursive: true });
    fs.writeFileSync(path.join(tmp.c.base, "instalacao.json"), JSON.stringify({ semServico: true }));
    fs.writeFileSync(
      tmp.c.estado,
      JSON.stringify({ formato: 1, ativa: "a", contas: { a: { id: "a", email: "a@exemplo.com", pasta: path.join(tmp.c.contas, "a"), precisaLogin: false, janelas: [] } } }),
    );
    const a = ambiente(tmp.c, launchctl());
    a.fabricas!.cred = () => cred;
    await executarCli(["doctor"], a);
    assert.match(a.saidas.join("\n"), /Credencial em uso .*→ não deu: o agente não está rodando/);
  });
});
