#!/usr/bin/env node
// Roda os testes compilados (dist/test/*.test.js) com o node:test, em qualquer sistema (sem depender do glob do shell).
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "test");
const filtro = process.argv[2];
const arquivos = readdirSync(dir)
  .filter((n) => n.endsWith(".test.js") && (!filtro || n.includes(filtro)))
  .sort()
  .map((n) => path.join(dir, n));
// sem nenhum arquivo, o node --test procura sozinho na pasta e roda também os .ts da fonte, que falham todos
if (!arquivos.length) {
  console.error(`nenhum teste compilado em ${dir}${filtro ? ` com "${filtro}" no nome` : ""} (rode o tsc antes)`);
  process.exit(1);
}
// --test-timeout só existe a partir do Node 20.11; no 18 os testes rodam sem limite próprio.
const [maior, menor] = process.versions.node.split(".").map(Number);
const limite = maior > 20 || (maior === 20 && menor >= 11) ? ["--test-timeout=60000"] : [];
// Pasta temporária só da rodada: o que os testes (e o agente que eles sobem) criam com os.tmpdir() sai no fim, mesmo
// quando um teste não limpa o que criou. Antes ficavam centenas de pastas na pasta temporária do computador.
const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-testes-"));
const r = spawnSync(process.execPath, ["--test", ...limite, ...arquivos], { stdio: "inherit", env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
process.exit(r.status ?? 1);
