// Computador em que o Reveza roda, mas sem o instalacao.json (a instalação parou depois do serviço, como no WSL sem
// systemd, até a 0.6.0). O Atualizar do painel roda o instalador novo com `--atualizar --sim`, e ele tem de reconhecer a
// instalação no disco em vez de recusar para sempre. Vale para o agente de qualquer versão: quem reconhece é o instalador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSAO, SEM_SH, prepararCasa } from "./apoio-instalador.mjs";

const URL_NUVEM = `https://${"a".repeat(20)}.supabase.co`;

/** O que sobrou da instalação que parou: o agente rodou (ponte.json), o programa e o comando reveza estão no disco. */
function instalacaoQueParou(casa, { servico, identidade }) {
  writeFileSync(path.join(casa.base, "ponte.json"), JSON.stringify({ porta: 7788, pid: 1, sombra: false }));
  const app = path.join(casa.base, "app");
  mkdirSync(path.join(app, "agente", "dist", "src"), { recursive: true });
  writeFileSync(path.join(app, "agente", "dist", "src", "cli.js"), "");
  mkdirSync(path.join(casa.base, "bin"), { recursive: true });
  writeFileSync(path.join(casa.base, "bin", "reveza"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(app, "agente", "dist", "src", "cli.js")}" "$@"\n`);
  // o programa novo responde o que o instalacao.json diria
  writeFileSync(path.join(casa.tmp, "cli-falso.mjs"), `import { appendFileSync } from "node:fs";
const a = process.argv.slice(2);
appendFileSync(process.env.REVEZA_TESTE_CLI, a.join(" ") + "\\n");
if (a[0] === "status") console.log(JSON.stringify({ parado: true }));
if (a.join(" ") === "servico status --json") console.log(${JSON.stringify(JSON.stringify(servico))});
if (a.join(" ") === "nuvem identidade") console.log(${JSON.stringify(JSON.stringify(identidade))});
`);
}

test("--atualizar --sim sem instalacao.json: reconhece a instalação, segue sem serviço se o gerenciador não responde, e grava", { skip: SEM_SH }, () => {
  const casa = prepararCasa();
  try {
    instalacaoQueParou(casa, {
      servico: { instalado: true, rodando: false, detalhe: "desconhecido", gerenciador: false, sombra: false, porta: null },
      identidade: { url: URL_NUVEM, chavePublica: "chave-publica" },
    });
    const r = casa.rodar(["--atualizar", "--sim", "--sem-react-bits"]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.match(r.saida, /falta o instalacao\.json/);
    assert.match(r.saida, /gerenciador de serviços não responde/);
    assert.match(r.saida, new RegExp(`Pronto: Reveza AI ${VERSAO.replace(/\./g, "\\.")}`));
    assert.equal(casa.rede(), "", "nenhuma chamada de rede");
    const comandos = casa.comandos();
    assert.ok(!comandos.some((c) => c.startsWith("servico instalar")), `não instala o serviço que não roda: ${comandos.join(" | ")}`);
    const inst = casa.json("instalacao.json");
    assert.equal(inst.versao, VERSAO);
    assert.equal(inst.app, path.join(casa.base, "app"));
    assert.equal(inst.semServico, true);
    assert.equal(inst.sombra, false);
    assert.deepEqual(inst.nuvem, { url: URL_NUVEM, anon: "chave-publica" }, "ligado à nuvem, sem ref: a próxima atualização é só deste computador");
    assert.equal(inst.recuperada, undefined, "a marca de reconhecida não vai para o arquivo");
    assert.ok(existsSync(path.join(casa.base, "copias")) && readdirSync(path.join(casa.base, "copias")).length > 0, "cópia do estado antes de mexer");
  } finally {
    casa.limpar();
  }
});

test("--atualizar --sim sem instalacao.json e sem nuvem: atualiza só o programa, sem perguntar", { skip: SEM_SH }, () => {
  const casa = prepararCasa();
  try {
    instalacaoQueParou(casa, { servico: { instalado: false, rodando: false, gerenciador: true, sombra: false, porta: null }, identidade: null });
    const r = casa.rodar(["--atualizar", "--sim", "--sem-react-bits"]);
    assert.equal(r.status, 0, r.saida.slice(-1500));
    assert.equal(casa.rede(), "");
    assert.ok(!/Token do Supabase|Token da Vercel/.test(r.saida), "nenhuma pergunta de token");
    const inst = casa.json("instalacao.json");
    assert.equal(inst.versao, VERSAO);
    assert.equal(inst.semServico, true);
    assert.equal(inst.nuvem, null);
  } finally {
    casa.limpar();
  }
});

test("--atualizar sem instalacao.json e sem sinal de que o Reveza rodou aqui: a recusa de antes continua", { skip: SEM_SH }, () => {
  const casa = prepararCasa();
  try {
    const r = casa.rodar(["--atualizar", "--sim", "--sem-react-bits"]);
    assert.equal(r.status, 1, r.saida.slice(-800));
    assert.match(r.saida, /não há instalação para atualizar/);
    assert.ok(!existsSync(path.join(casa.base, "instalacao.json")));
  } finally {
    casa.limpar();
  }
});
