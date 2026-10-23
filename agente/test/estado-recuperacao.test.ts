// O estado depois de um desligamento brusco (relato de um usuário, Windows, 22/10/2026): o estado.json voltou ilegível e
// o agente subiu só com a conta em uso, sem aviso. A gravação vai ao disco antes da troca de nome, o estado ilegível fica
// guardado e volta a cópia boa, e a conta perdida volta pela pasta dela mesmo com o token vencido.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsPadrao from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { carregarEstadoDoAgente, copiaBoaDo, estadoInicial, novaConta } from "../src/estado.js";
import { gravarAtomico } from "../src/util/arquivos.js";
import { ativaEm, blob, contaEstacionada, montar, type Montado } from "./falsos.js";

let m: Montado | null = null;
let pastas: string[] = [];
afterEach(() => {
  m?.limpar();
  m = null;
  for (const p of pastas) fs.rmSync(p, { recursive: true, force: true });
  pastas = [];
});
const tmp = () => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-estado-"));
  pastas.push(p);
  return p;
};
const perfil = (l: string) => ({ accountUuid: `acc-${l}`, email: `${l.toLowerCase()}@exemplo.com`, orgUuid: `org-${l}`, org: `Org ${l}`, orgTipo: "x", tier: null });
function comContas(...letras: string[]) {
  const e = estadoInicial();
  for (const l of letras) e.contas[l.toLowerCase()] = novaConta(l.toLowerCase(), perfil(l), `/contas/${l.toLowerCase()}`, 1);
  e.ativa = letras[0]!.toLowerCase();
  return e;
}
const ESTRAGADO = Buffer.alloc(4096, 0); // o que o NTFS deixa depois da queda: bytes nulos

describe("gravação durável", () => {
  test("o conteúdo vai ao disco antes da troca de nome; o registro de uso (duravel: false) não espera", () => {
    const dir = tmp();
    const original = fsPadrao.fsyncSync;
    // conta só o fsync de arquivo (o da pasta, onde o sistema deixa, é à parte)
    let arquivos = 0;
    fsPadrao.fsyncSync = ((fd: number) => {
      if (fs.fstatSync(fd).isFile()) arquivos += 1;
      return original(fd);
    }) as typeof fsPadrao.fsyncSync;
    syncBuiltinESMExports();
    try {
      gravarAtomico(path.join(dir, "a.json"), "{}");
      assert.equal(arquivos, 1, "o conteúdo vai ao disco antes da troca de nome");
      gravarAtomico(path.join(dir, "b.json"), "{}", 0o600, { duravel: false });
      assert.equal(arquivos, 1, "o registro de uso não espera o disco");
    } finally {
      fsPadrao.fsyncSync = original;
      syncBuiltinESMExports();
    }
    assert.equal(fs.readFileSync(path.join(dir, "a.json"), "utf8"), "{}");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["a.json", "b.json"], "nenhum temporário fica para trás");
  });
});

describe("estado na partida do agente", () => {
  test("sem arquivo (instalação nova): estado em branco, sem recuperação", () => {
    const r = carregarEstadoDoAgente(path.join(tmp(), "estado.json"));
    assert.equal(r.recuperacao, null);
    assert.deepEqual(r.estado.contas, {});
  });

  test("arquivo bom: é o que vale, e vira a cópia boa", () => {
    const arq = path.join(tmp(), "estado.json");
    fs.writeFileSync(arq, JSON.stringify(comContas("A", "B")));
    const r = carregarEstadoDoAgente(arq);
    assert.equal(r.recuperacao, null);
    assert.deepEqual(Object.keys(r.estado.contas).sort(), ["a", "b"]);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(copiaBoaDo(arq), "utf8")).contas).sort(), ["a", "b"]);
  });

  test("arquivo com bytes nulos: fica guardado como estava e volta a cópia boa", () => {
    const dir = tmp();
    const arq = path.join(dir, "estado.json");
    fs.writeFileSync(copiaBoaDo(arq), JSON.stringify(comContas("A", "B")));
    fs.writeFileSync(arq, ESTRAGADO);
    const r = carregarEstadoDoAgente(arq, Date.UTC(2026, 9, 22, 14, 30));
    assert.deepEqual(Object.keys(r.estado.contas).sort(), ["a", "b"]);
    assert.ok(r.recuperacao && r.recuperacao.copiaDe !== null);
    assert.equal(path.basename(r.recuperacao.estragado!), "estado.json.estragado-2026-10-22T14-30-00-000Z");
    assert.deepEqual(fs.readFileSync(r.recuperacao.estragado!), ESTRAGADO, "o estragado é guardado inteiro, nunca apagado");
    assert.equal(fs.existsSync(arq), false);
  });

  test("arquivo vazio e sem cópia: começa em branco e diz que não havia cópia", () => {
    const arq = path.join(tmp(), "estado.json");
    fs.writeFileSync(arq, "");
    const r = carregarEstadoDoAgente(arq);
    assert.deepEqual(r.estado.contas, {});
    assert.deepEqual(r.recuperacao && { copia: r.recuperacao.copiaDe, guardou: !!r.recuperacao.estragado }, { copia: null, guardou: true });
  });

  test("o agente avisa o que voltou (evento de erro, que vai para o painel) e segue com as contas da cópia", async () => {
    m = await montar({
      antes: (c) => {
        fs.mkdirSync(path.dirname(c.estado), { recursive: true });
        fs.writeFileSync(copiaBoaDo(c.estado), JSON.stringify(comContas("A", "B")));
        fs.writeFileSync(c.estado, ESTRAGADO);
      },
    });
    assert.deepEqual(Object.keys(m.agente.estado.contas).sort(), ["a", "b"]);
    const ev = m.agente.estado.eventos[0]!;
    assert.equal(ev.tipo, "erro");
    assert.match(ev.texto, /estava ilegível \(desligamento brusco\?\) e voltou da cópia de/);
    assert.match(ev.texto, /estado\.json\.estragado-/);
    // e o estado bom já foi regravado no lugar
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(m.c.estado, "utf8")).contas).sort(), ["a", "b"]);
  });

  test("sem cópia: o aviso diz que as contas voltam pelas pastas", async () => {
    m = await montar({
      antes: (c) => {
        fs.mkdirSync(path.dirname(c.estado), { recursive: true });
        fs.writeFileSync(c.estado, ESTRAGADO);
      },
    });
    assert.match(m.agente.estado.eventos[0]!.texto, /não havia cópia: as contas voltam pelas pastas/);
  });

  test("a cópia boa acompanha a lista de contas", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    m.agente.salvar();
    contaEstacionada(m, "B", 3);
    m.agente.salvar();
    const copia = JSON.parse(fs.readFileSync(copiaBoaDo(m.c.estado), "utf8")) as { contas: Record<string, { email: string }> };
    assert.deepEqual(Object.values(copia.contas).map((c) => c.email).sort(), ["a@exemplo.com", "b@exemplo.com"]);
  });
});

describe("conta perdida do estado volta pela pasta", () => {
  function pastaDe(c: { contas: string }, nome: string, email: string, letra: string) {
    const p = path.join(c.contas, nome);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: `acc-${letra}`, organizationUuid: `org-${letra}`, emailAddress: email, organizationName: `Org ${letra}` } }));
    return p;
  }

  test("token vencido (o perfil recusa): a conta volta pelo .claude.json da pasta", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const p = pastaDe(m.c, "perdida1", "b@exemplo.com", "B");
    m.cred.d.set(p, blob("B1", true, -60, m.relogio.agora()));
    m.api.recusados.add("B1");
    await m.agente.trocador.arrumarPastas(new Set());
    const volta = Object.values(m.agente.estado.contas).find((c) => c.email === "b@exemplo.com");
    assert.ok(volta, "a conta B voltou para a lista");
    assert.equal(volta.pasta, p);
    assert.equal(volta.accountUuid, "acc-B");
  });

  test("pasta de conta fora da lista e sem login: fica (é a única pista dela), com um aviso só", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const p = pastaDe(m.c, "perdida2", "b@exemplo.com", "B");
    const velho = (Date.now() - 2 * 3600_000) / 1000;
    fs.utimesSync(p, velho, velho);
    m.relogio.t = Math.floor(Date.now() / 1000);
    await m.agente.trocador.arrumarPastas(new Set());
    await m.agente.trocador.arrumarPastas(new Set());
    assert.ok(fs.existsSync(p));
    assert.equal(m.agente.estado.eventos.filter((x) => /sem o login dela/.test(x.texto)).length, 1);
  });

  test("a lista voltou de uma cópia de antes de um login refeito noutra pasta: a pasta com o login passa a ser a da conta", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    const b = contaEstacionada(m, "B", 3);
    const antiga = m.agente.estado.contas[b]!.pasta;
    m.cred.d.delete(antiga); // a pasta da lista ficou sem login
    const nova = pastaDe(m.c, "relogada", "b@exemplo.com", "B");
    m.cred.d.set(nova, blob("B2", true, 3600, m.relogio.agora()));
    await m.agente.trocador.arrumarPastas(new Set());
    assert.equal(m.agente.estado.contas[b]!.pasta, nova);
    assert.ok(fs.existsSync(nova), "a pasta com o login não vai embora");
    assert.equal(m.cred.token(nova), "B2");
  });

  test("pasta sem login de conta que já está na lista (login refeito noutra pasta): sai depois de 1 hora, como antes", async () => {
    m = await montar();
    await ativaEm(m, "A", 10);
    contaEstacionada(m, "B", 3);
    const p = pastaDe(m.c, "antiga", "b@exemplo.com", "B");
    const velho = (Date.now() - 2 * 3600_000) / 1000;
    fs.utimesSync(p, velho, velho);
    m.relogio.t = Math.floor(Date.now() / 1000);
    await m.agente.trocador.arrumarPastas(new Set());
    assert.equal(fs.existsSync(p), false);
  });
});
