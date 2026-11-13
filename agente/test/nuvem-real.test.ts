// O cliente da nuvem contra o banco DE VERDADE (nuvem/migracoes aplicadas num Postgres local, PGlite, pelo apoio de
// testes do próprio banco). Prova nomes e parâmetros p_* e o caminho inteiro: registro, posse, cofre, troca,
// relatos, comandos e limite. Sem o PGlite instalado em nuvem/ (npm install lá), estes testes são pulados.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NuvemRpc, type Rpc } from "../src/nuvem/rpc.js";
import { aadConta, decifrarLogin } from "../src/cofre/cifra.js";
import { lerChave } from "../src/ligar.js";
import { ativaEm, blob, contaEstacionada, montar, RelogioFalso, type Montado } from "./falsos.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const APOIO = path.resolve(aqui, "..", "..", "..", "nuvem", "testes", "apoio.mjs");
const PGLITE = path.resolve(aqui, "..", "..", "..", "nuvem", "node_modules", "@electric-sql", "pglite");

/** Rpc que grava os nomes e os argumentos (para conferir o contrato sem banco). */
class RpcGravador implements Rpc {
  chamadas: { fn: string; args: Record<string, unknown> }[] = [];
  resposta: unknown = { ok: true };
  async chamar(fn: string, args: Record<string, unknown>) {
    this.chamadas.push({ fn, args });
    return this.resposta;
  }
  async horaDoServidor() {
    return null;
  }
}

describe("contrato das funções agente_*", () => {
  test("nomes e parâmetros p_* exatos, binário em base64", async () => {
    const r = new RpcGravador();
    const n = new NuvemRpc(r);
    const b = Buffer.from([1, 2, 3]);
    await n.registrar("pc", "macos", "0.1.0");
    await n.ola("0.1.0", null, "a@exemplo.com", "00000000-0000-4000-8000-000000000001");
    await n.pegarPosse("c", "leitura", 60);
    await n.devolverCofre("c", b, b, 4, null);
    await n.soltarPosse("c");
    await n.registrarConta("a@exemplo.com", "Org", "max", "5x", b, b, null, "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002");
    await n.relatarUso([], []);
    await n.relatarTokens([], []);
    await n.limite("c", "s");
    await n.reservarComando(7);
    await n.responderComando(7, 200, { ok: true });
    await n.evento("info", "t", {});
    await n.marcarLogin("c", true);
    await n.ligacaoPublicar(b, b);
    await n.vezDeAtualizar("0.1.0", "0.1.1");
    await n.resultadoAtualizacao("0.1.1", "falhou", "voltou");
    r.resposta = { nomes: ["0001_base.sql"] };
    await n.migracoesAplicadas();
    r.resposta = { ok: true };
    const chave = { kty: "EC" as const, crv: "P-256" as const, x: "a".repeat(43), y: "b".repeat(43) };
    await n.ligacoesAbertas();
    await n.ligacaoEntregar("pc-novo", chave, { efemera: chave, iv: "A".repeat(16), cifrado: "B".repeat(64) });
    await n.ligacaoRecusar("pc-novo", "recusado_na_tela");
    r.resposta = { ok: true, computador_id: "pc-novo", expira_em: null };
    await n.ligacaoPedir(chave);
    r.resposta = { estado: "esperando" };
    await n.ligacaoReceber();
    r.resposta = { ok: false, erro: "nenhuma ligação aberta" };
    assert.equal(await n.ligacaoBuscar(), null);
    const assinaturas = r.chamadas.map((c) => `${c.fn}(${Object.keys(c.args).join(",")})`);
    assert.deepEqual(assinaturas, [
      "agente_registrar(p_nome,p_sistema,p_versao)",
      "agente_ola(p_versao,p_diagnostico,p_conta_local,p_organizacao_id)",
      "agente_pegar_posse(p_conta,p_motivo,p_segundos)",
      "agente_devolver_cofre(p_conta,p_cifrado,p_nonce,p_versao_anterior,p_expira_em)",
      "agente_soltar_posse(p_conta)",
      "agente_registrar_conta(p_email,p_organizacao,p_plano,p_nivel,p_cifrado,p_nonce,p_expira_em,p_organizacao_id,p_account_uuid)",
      "agente_relatar_uso(p_janelas,p_historico)",
      "agente_relatar_tokens(p_linhas,p_sessoes)",
      "agente_limite(p_conta,p_sessao)",
      "agente_reservar_comando(p_id)",
      "agente_responder_comando(p_id,p_http,p_resposta)",
      "agente_evento(p_tipo,p_texto,p_dados)",
      "agente_marcar_login(p_conta,p_precisa)",
      "agente_ligacao_publicar(p_embrulho,p_sal)",
      "agente_vez_de_atualizar(p_de,p_para)",
      "agente_atualizacao_resultado(p_para,p_estado,p_motivo)",
      "agente_migracoes()",
      "agente_ligacoes_abertas()",
      "agente_ligacao_entregar(p_computador,p_publica,p_envelope)",
      "agente_ligacao_recusar(p_computador,p_motivo)",
      "agente_ligacao_pedir(p_publica)",
      "agente_ligacao_receber()",
      "agente_ligacao_buscar()",
    ]);
    assert.equal(r.chamadas[3]!.args.p_cifrado, "AQID");
  });

  test("respostas: atribuição com e-mail, comandos completos, cofre em base64", async () => {
    const r = new RpcGravador();
    const n = new NuvemRpc(r);
    r.resposta = {
      computador_id: "pc",
      atribuicao: { conta_id: "c1", email: "a@exemplo.com", versao: 3, motivo: "x" },
      config: { auto: false },
      comandos: [{ id: 5, acao: "atualizar", corpo: {} }, { id: "lixo" }],
      ligacao_pendente: true,
      ligacoes: [
        { computador_id: "pc-novo", publica: { kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) }, para_mim: true, idioma: "en" },
        { computador_id: "pc-ruim", publica: { kty: "EC", crv: "P-256", x: "curta", y: "b".repeat(43) } },
      ],
    };
    const ola = await n.ola("v", null, null, null);
    assert.deepEqual(ola.atribuicao, { conta_id: "c1", email: "a@exemplo.com", versao: 3, motivo: "x" });
    assert.deepEqual(ola.comandos.map((c) => c.id), [5]);
    assert.equal(ola.ligacao_pendente, true);
    assert.deepEqual(ola.ligacoes.map((l) => [l.computador_id, l.para_mim, l.idioma]), [["pc-novo", true, "en"]], "chave fora do formato fica de fora");
    r.resposta = { ok: true, cofre: { cifrado: "AQID", nonce: "BAUG", versao: 2, expira_em: null } };
    const p = await n.pegarPosse("c", "uso", 120);
    assert.deepEqual([...p.cofre!.cifrado], [1, 2, 3]);
    assert.equal(p.cofre!.versao, 2);
  });
});

describe("contra o banco de verdade (PGlite)", { skip: !fs.existsSync(APOIO) || !fs.existsSync(PGLITE) ? "sem o PGlite em nuvem/node_modules" : false }, () => {
  async function preparar() {
    const apoio = (await import(pathToFileURL(APOIO).href)) as { banco: () => Promise<any> };
    const db = await apoio.banco();
    const pc = await db.computador("pc-teste");
    const nuvem = new NuvemRpc({ chamar: (fn, args) => db.rpc(pc, fn, args), horaDoServidor: async () => null });
    const relogio = new RelogioFalso();
    relogio.t = Math.floor(Date.now() / 1000);
    const m = await montar({ nuvem, relogio });
    return { db, pc, m };
  }

  async function cofreDe(db: any, m: Montado, contaId: string) {
    const [k] = await db.sql("select encode(cifrado, 'base64') c, encode(nonce, 'base64') n, versao from public.cofre where conta_id = $1", [contaId]);
    const chave = (await lerChave(m.guarda))!;
    return {
      versao: Number(k.versao),
      login: decifrarLogin(chave, aadConta(contaId, Number(k.versao)), Buffer.from(k.c, "base64"), Buffer.from(k.n, "base64")),
    };
  }

  test("caminho inteiro: adoção, cofre com conta_id|versão, posse de uso, troca pela nuvem, devolução e soltura", async () => {
    const { db, pc, m } = await preparar();
    try {
      // 1. a conta que já está no computador entra na nuvem e no cofre (registro + regravação definitiva)
      const a = await ativaEm(m, "A", 10);
      await m.agente.esperar();
      const aId = m.agente.estado.contas[a]!.contaId!;
      assert.ok(aId);
      const ca = await cofreDe(db, m, aId);
      assert.equal(ca.versao, 2);
      assert.equal(ca.login.claudeAiOauth?.accessToken, "A1");

      // 2. a primeira busca: a nuvem atribui a conta local e o agente pega a posse de uso
      await m.agente.busca();
      assert.equal(m.agente.online, true, m.log.linhas.join("\n"));
      assert.equal(await db.atribuida(pc), aId);
      const [posseA] = await db.sql("select motivo from public.posse where conta_id = $1", [aId]);
      assert.equal(posseA.motivo, "uso");

      // 3. uma segunda conta conectada aqui vai ao cofre, e é lida com posse curta
      const b = contaEstacionada(m, "B", 3);
      assert.equal(await m.agente.posse!.registrarNaNuvem(b), true);
      const bId = m.agente.estado.contas[b]!.contaId!;
      assert.equal((await cofreDe(db, m, bId)).login.claudeAiOauth?.accessToken, "B1");
      m.api.usos.B = 4;
      m.agente.trocador.ultimaLeitura[b] = 0;
      await m.agente.lerUsoConta(b, true);
      const [jb] = await db.sql("select pct from public.uso_janelas where conta_id = $1 and tipo = 'five_hour'", [bId]);
      assert.equal(Number(jb.pct), 4, "a nuvem aceitou o número da conta lida com posse");
      assert.equal((await db.sql("select 1 from public.posse where conta_id = $1", [bId])).length, 0, "posse curta solta");

      // 4. troca automática ligada, a conta em uso chega a 96%: a nuvem decide e o agente troca
      await db.config("auto", true);
      await db.config("espera_entre_trocas_s", 0); // a atribuição de A acabou de ser feita
      m.agente.estado.trocadaEm = 0;
      m.agente.trocador.medidaDaSessao({ versao: m.agente.estado.versao, janelas: [{ tipo: "five_hour", pct: 96, resetEm: null }] });
      m.cred.d.set("principal", blob("A5", true, 3600, m.relogio.agora())); // as sessões renovaram A
      await m.agente.trocador.conferirPrincipal();
      await m.agente.relatarUso(true);
      assert.equal(await db.atribuida(pc), bId, "a nuvem atribuiu B");
      await m.agente.busca();
      assert.equal(m.agente.estado.ativa, b);
      assert.equal(m.cred.token("principal"), "B1");

      // 5. depois da conferência da troca, A volta ao cofre com o login mais novo e só então é solta
      m.relogio.t += 25;
      await m.agente.busca();
      const ca2 = await cofreDe(db, m, aId);
      assert.equal(ca2.login.claudeAiOauth?.accessToken, "A5");
      assert.equal((await db.sql("select 1 from public.posse where conta_id = $1", [aId])).length, 0);

      // 6. tokens das transcrições vão para uso_tokens com a conta da nuvem
      const dir = path.join(m.c.projetos, "-x-proj");
      fs.mkdirSync(dir, { recursive: true });
      const linha = { type: "assistant", sessionId: "sessao-1", cwd: "/x/proj", timestamp: new Date().toISOString(), message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 5, output_tokens: 7 } } };
      fs.writeFileSync(path.join(dir, "s.jsonl"), JSON.stringify(linha) + "\n");
      await m.agente.registro();
      const [tk] = await db.sql("select conta_id, projeto, respostas from public.uso_tokens");
      assert.equal(tk.conta_id, bId);
      assert.equal(tk.projeto, "proj");

      // 7. comando do painel: reservado, rodado e respondido
      const [{ id: userAdmin }] = await db.sql("insert into auth.users (email) values ('adm@exemplo.com') returning id");
      await db.sql("insert into public.comandos (criado_por, computador_id, acao, corpo) values ($1, $2, 'atualizar', '{}')", [userAdmin, pc.pc]);
      await m.agente.busca();
      const [cmd] = await db.sql("select estado, http from public.comandos");
      assert.equal(cmd.estado, "feito");
      assert.equal(cmd.http, 200);

      // 8. limite de uma sessão vai na hora
      const r = await m.agente.alvoPonte().limite({ sessao: "sessao-1", cwd: "/tmp", tipo: "interativa" });
      assert.equal(r.status, 200);
      await m.agente.esperar();
      const [lim] = await db.sql("select count(*)::int n from public.eventos where tipo = 'limite'");
      assert.ok(lim.n >= 1);
    } finally {
      m.limpar();
    }
  });

  test("atualizar sozinho pelo banco: a vez de um computador por vez e o fim que libera", async () => {
    const apoio = (await import(pathToFileURL(APOIO).href)) as { banco: () => Promise<any> };
    const db = await apoio.banco();
    const p1 = await db.computador("p1");
    const p2 = await db.computador("p2");
    const n1 = new NuvemRpc({ chamar: (fn, args) => db.rpc(p1, fn, args), horaDoServidor: async () => null });
    const n2 = new NuvemRpc({ chamar: (fn, args) => db.rpc(p2, fn, args), horaDoServidor: async () => null });
    assert.deepEqual(await n1.vezDeAtualizar("1.0.0", "1.0.1"), { pode: false, motivo: "desligado" });
    await db.config("atualizar_sozinho", true);
    assert.deepEqual(await n1.vezDeAtualizar("1.0.0", "1.0.1"), { pode: true, motivo: null });
    assert.deepEqual(await n2.vezDeAtualizar("1.0.0", "1.0.1"), { pode: false, motivo: "outro" });
    assert.deepEqual(await n1.resultadoAtualizacao("1.0.1", "concluida", null), { ok: true });
    assert.deepEqual(await n2.vezDeAtualizar("1.0.0", "1.0.1"), { pode: true, motivo: null });
  });

  test("a trava pelo banco: o agente lê os nomes e os resumos das migrações e compara com os do pacote de verdade", async () => {
    const apoio = (await import(pathToFileURL(APOIO).href)) as { banco: () => Promise<any> };
    const prov = (await import(pathToFileURL(path.resolve(aqui, "..", "..", "..", "nuvem", "provisionar.mjs")).href)) as {
      migracoes: () => { nome: string; sql: string }[];
      SQL_REGISTRO: string;
      sqlRegistrar: (nome: string, hash: string) => string;
      hashesAceitos: (sql: string) => string[];
    };
    const { faltamNaNuvem, migracoesDoPacote, resumosDoPacote } = await import("../src/atualizar.js");
    const { createHash } = await import("node:crypto");
    const db = await apoio.banco();
    const p1 = await db.computador("p1");
    const n1 = new NuvemRpc({ chamar: (fn, args) => db.rpc(p1, fn, args), horaDoServidor: async () => null });
    assert.equal(await n1.migracoesAplicadas(), null, "sem o registro do instalador: não se sabe");
    await db.db.exec(prov.SQL_REGISTRO);
    const todas = prov.migracoes();
    // a nuvem sem a 0020: o pacote desta versão é recusado
    const raiz = path.resolve(aqui, "..", "..", "..");
    const doPacote = migracoesDoPacote(raiz);
    assert.deepEqual(doPacote, todas.map((m) => m.nome).sort());
    for (const m of todas.filter((x) => x.nome !== "0020_atualizar_escolha.sql")) {
      await db.sql(prov.sqlRegistrar(m.nome, createHash("sha256").update(m.sql).digest("hex")));
    }
    assert.deepEqual(faltamNaNuvem(doPacote, (await n1.migracoesAplicadas())!), ["0020_atualizar_escolha.sql"]);
    await db.sql(prov.sqlRegistrar("0020_atualizar_escolha.sql", "0".repeat(64)));
    assert.deepEqual(faltamNaNuvem(doPacote, (await n1.migracoesAplicadas())!), []);
    // com os resumos: o do agente é o mesmo do instalador (hashesAceitos), e a 0020 registrada com outro conteúdo falta
    const resumos = resumosDoPacote(raiz);
    for (const m of todas) assert.deepEqual(resumos[m.nome], prov.hashesAceitos(m.sql), m.nome);
    assert.deepEqual(faltamNaNuvem(doPacote, (await n1.migracoesAplicadas())!, resumos), ["0020_atualizar_escolha.sql"]);
    await db.sql(prov.sqlRegistrar("0020_atualizar_escolha.sql", prov.hashesAceitos(todas.find((m) => m.nome === "0020_atualizar_escolha.sql")!.sql)[0]!));
    assert.deepEqual(faltamNaNuvem(doPacote, (await n1.migracoesAplicadas())!, resumos), []);
  });

  test("computador novo pelo banco: pede, o velho libera pelo código, a chave chega igual, uma vez, e só então ele entra", async () => {
    const apoio = (await import(pathToFileURL(APOIO).href)) as { banco: () => Promise<any> };
    const db = await apoio.banco();
    const velho = await db.computador("velho");
    const { GuardaFalsa } = await import("../src/cofre/guarda.js");
    const { codigoDaChave, iniciarCofre, impressaoDaChave, liberarComputadorNovo, pedirParaEntrar } = await import("../src/ligar.js");
    const gv = new GuardaFalsa();
    await iniciarCofre(gv);
    const nv = new NuvemRpc({ chamar: (fn, args) => db.rpc(velho, fn, args), horaDoServidor: async () => null });
    await nv.cofreImpressao(impressaoDaChave((await lerChave(gv))!));
    // a identidade pendente, como o painel cria
    const [{ id: admin }] = await db.sql("insert into auth.users (email) values ('adm@exemplo.com') returning id");
    await db.sql("insert into public.membros (user_id, papel) values ($1, 'admin')", [admin]);
    const novo = { id: await db.usuario(null) };
    await db.como("servico", "select public.servico_registrar_computador($1, $2)", [novo.id, admin]);
    const nn = new NuvemRpc({ chamar: (fn, args) => db.rpc(novo, fn, args), horaDoServidor: async () => null });
    await assert.rejects(nn.registrar("novo", "linux", "0.2.0"), /ainda não recebeu a chave/);
    const gn = new GuardaFalsa();
    let codigo = "";
    let liberou = false;
    const r = await pedirParaEntrar(gn, nn, {
      aoMostrarCodigo: (c) => (codigo = c),
      dormir: async () => {
        if (liberou) return;
        liberou = true;
        await assert.rejects(liberarComputadorNovo(gv, nv, "AAAA-AAAA-AAAA"), /não confere/);
        await liberarComputadorNovo(gv, nv, codigo);
      },
      intervaloMs: 0,
    });
    assert.equal(r.impressao, impressaoDaChave((await lerChave(gv))!));
    assert.deepEqual(await lerChave(gn), await lerChave(gv));
    const [linha] = await db.sql("select envelope, lido_em from public.ligacao_pedidos");
    assert.equal(linha.envelope, null, "a nuvem não guarda o envelope depois de lido");
    assert.ok(linha.lido_em);
    assert.ok((await nn.registrar("novo", "linux", "0.2.0")).computador_id);
    assert.equal(await codigoDaChave({ kty: "EC", crv: "P-256", x: "a".repeat(43), y: "b".repeat(43) }) === codigo, false);
  });

  test("frase de emergência pelo banco (computador já ligado que perdeu a chave): a chave chega igual, uma vez", async () => {
    const apoio = (await import(pathToFileURL(APOIO).href)) as { banco: () => Promise<any> };
    const db = await apoio.banco();
    const velho = await db.computador("velho");
    const perdeu = await db.computador("perdeu");
    const { GuardaFalsa } = await import("../src/cofre/guarda.js");
    const { iniciarCofre, publicarLigacao, receberLigacao } = await import("../src/ligar.js");
    const gv = new GuardaFalsa();
    const gn = new GuardaFalsa();
    await iniciarCofre(gv);
    const nv = new NuvemRpc({ chamar: (fn, args) => db.rpc(velho, fn, args), horaDoServidor: async () => null });
    const nn = new NuvemRpc({ chamar: (fn, args) => db.rpc(perdeu, fn, args), horaDoServidor: async () => null });
    const { frase } = await publicarLigacao(gv, nv);
    await receberLigacao(gn, nn, frase);
    assert.deepEqual(await lerChave(gn), await lerChave(gv));
    await assert.rejects(receberLigacao(new GuardaFalsa(), nn, frase), /nenhuma frase aberta/);
  });
});
