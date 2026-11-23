#!/usr/bin/env node
// Ensaio antes de publicar: nenhuma execução vermelha no GitHub depois do envio. Pedido do Paulo (12/10/2026): "não pode
// ter falha ali... corrija sempre... mas não desligue os testes".
//
//   node scripts/ensaio.mjs
//
// 1. Roda aqui, primeiro, tudo o que dá para rodar no Mac: os testes da raiz, do agente, da nuvem e do painel (tsc e
//    vitest). Falhou aqui, nada vai ao GitHub.
// 2. Leva a mudança ainda não publicada (git diff origin/main) para os três testes do GitHub que este Mac não roda
//    (instalação nos três sistemas, Windows de verdade e ponta a ponta): pequena, no próprio disparo; grande, por um
//    gist secreto do dono, apagado no fim. Cada disparo leva um id, e o fluxo dá à execução o nome "ensaio <id>".
// 3. Tudo verde: anota a árvore do HEAD em .git/reveza-ensaio. O `lancar` e o pre-push da main só aceitam envio de
//    código com o ensaio verde da mesma árvore (ou da árvore de antes do commit de versão).
//
// A 0.2.0 saiu sem o ensaio no Windows e o teste da janela ficou vermelho depois do lançamento; a 762aa80 subiu sem
// passar no Windows. Este roteiro existe para isso não repetir.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FLUXOS = ["instalar.yml", "windows.yml", "e2e.yml"];
/** O disparo manual aceita até 65.535 caracteres no total dos campos: o resto da margem fica para o id. */
export const CABE_NO_DISPARO = 60_000;

/** dono/repositório do `origin` (o projeto oficial ou um fork: o ensaio roda no repositório de quem publica). */
export function repositorioDoOrigin(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Arquivos que não mudam o que os testes provam: só documentação e imagens. */
export function soDocumentacao(arquivos) {
  return arquivos.length > 0 && arquivos.every((f) => /\.(md|png|jpe?g|webp|gif|svg)$/i.test(f) || f.startsWith("docs/"));
}

/** O ensaio anotado vale para esta árvore? Vale para a própria e para a de antes do commit de versão do `lancar`. */
export function ensaioVale(anotado, arvores) {
  if (!anotado) return false;
  const a = String(anotado).split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(a) && arvores.includes(a);
}

/** O arquivo do ensaio dentro do .git (numa worktree, o .git é um arquivo: quem diz onde fica é o próprio git). */
export function arquivoDoEnsaio(raiz = RAIZ) {
  try {
    return path.resolve(raiz, execFileSync("git", ["rev-parse", "--git-path", "reveza-ensaio"], { cwd: raiz, encoding: "utf8" }).trim());
  } catch {
    return path.join(raiz, ".git", "reveza-ensaio");
  }
}

/**
 * O script foi chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: `import.meta.url` vem codificado
 * (espaço vira %20, acento vira %C3%B3, no Windows a barra muda), e a comparação ingênua com `file://${argv[1]}` falhava
 * calada em pasta com espaço ou acento e em todo Windows: o script saía com sucesso sem fazer nada.
 */
export function chamadoDireto(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

/** O patch que o GitHub aplica: binário incluso e sem nada da configuração de git da pessoa (cor, prefixo, diff externo). */
export const ARGS_DO_DIFF = ["diff", "--binary", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];

/** A execução do ensaio, pelo nome que o fluxo dá a ela (run-name "ensaio <id>"). */
export function execucaoDoEnsaio(lista, id) {
  const r = (Array.isArray(lista) ? lista : []).find((x) => x && x.displayTitle === `ensaio ${id}`);
  return r ? r.databaseId : null;
}

export function lerEnsaio(raiz = RAIZ) {
  const f = arquivoDoEnsaio(raiz);
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
}

const git = (...a) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8" }).trim();
const gh = (...a) => execFileSync("gh", a, { cwd: RAIZ, encoding: "utf8" }).trim();
// o Node da pessoa; num Mac com o Node 22 do Homebrew ao lado de um mais novo, usa o 22 (o projeto é provado nele)
const NODE22 = ["/opt/homebrew/opt/node@22/bin", "/usr/local/opt/node@22/bin"].find((d) => existsSync(d)) ?? null;

function rodarAqui(nome, cmd, args, cwd) {
  process.stdout.write(`· ${nome}... `);
  const env = NODE22 ? { ...process.env, PATH: `${NODE22}${path.delimiter}${process.env.PATH}` } : process.env;
  const r = spawnSync(cmd, args, { cwd: path.join(RAIZ, cwd), env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.status !== 0) {
    const tudo = (r.stdout || "") + (r.stderr || "");
    console.log("FALHOU");
    // a tela leva só o fim; a saída inteira fica num arquivo, senão achar a falha custa rodar a bateria de novo
    const arquivo = path.join(RAIZ, `ensaio-falhou-${nome.replace(/[^a-z0-9]+/gi, "-")}.log`);
    try {
      writeFileSync(arquivo, tudo);
      console.error(`saída inteira em ${arquivo}`);
    } catch {
      console.error("não deu para gravar a saída inteira; segue só o fim dela");
    }
    console.error(tudo.slice(-3000));
    throw new Error(`${nome} falhou aqui: nada foi ao GitHub`);
  }
  console.log("ok");
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function principal() {
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("há mudança sem commit: commite (com pathspec) antes do ensaio");
  // o commit fica fixo do começo ao fim: outra sessão pode commitar no meio, e a prova tem de ser desta árvore
  const commit = git("rev-parse", "HEAD");
  const arvore = git("rev-parse", `${commit}^{tree}`);
  const REPO = repositorioDoOrigin(git("remote", "get-url", "origin"));
  if (!REPO) throw new Error("o origin não é um repositório do GitHub: o ensaio roda nos testes do GitHub do projeto");
  // 1. aqui
  rodarAqui("testes da raiz", "npm", ["test"], ".");
  rodarAqui("testes do agente", "npm", ["test"], "agente");
  rodarAqui("testes da nuvem", "npm", ["test"], "nuvem");
  rodarAqui("painel: tipos", "npx", ["tsc", "-b", "--noEmit"], "painel");
  rodarAqui("painel: testes", "npx", ["vitest", "run"], "painel");
  // 2. no GitHub
  git("fetch", "-q", "origin");
  const diff = execFileSync("git", [...ARGS_DO_DIFF, "origin/main", commit], { cwd: RAIZ, maxBuffer: 256 * 1024 * 1024 });
  let gist = null;
  // o campo `ensaio` do disparo: "-f ensaio=" (a main como está), o endereço do gist, ou o arquivo (`-F ensaio=@arq`)
  let campo = ["-f", "ensaio="];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "reveza-ensaio-"));
  // o try começa logo depois da pasta: um gist que falhava ao ser criado deixava a pasta para trás
  try {
    const arq = path.join(tmp, "ensaio.txt");
    const b64 = diff.length ? gzipSync(diff, { level: 9 }).toString("base64") : "";
    writeFileSync(arq, b64);
    // mudança pequena vai no próprio disparo, lida de um arquivo (sem gist: serve também a fork de organização, que não
    // tem gist; e sem passar do limite de linha de comando do Windows); grande, num gist secreto de quem roda
    if (b64.length && b64.length <= CABE_NO_DISPARO) campo = ["-F", `ensaio=@${arq}`];
    else if (b64.length) {
      const url = gh("gist", "create", "--desc", "Reveza: ensaio antes de publicar (apagado no fim)", arq).split(/\s+/).pop();
      gist = url.split("/").pop();
      campo = ["-f", `ensaio=${gh("api", `gists/${gist}`, "--jq", ".files | to_entries[0].value.raw_url")}`];
    }
    // cada disparo leva um id, e o fluxo dá à execução o nome "ensaio <id>": acha a dele mesmo com outro ensaio em
    // paralelo e sem depender do relógio deste computador
    const id = randomBytes(6).toString("hex");
    for (const f of FLUXOS) gh("workflow", "run", f, "-R", REPO, "-f", `id=${id}`, ...campo);
    const ids = {};
    for (let i = 0; i < 30 && Object.keys(ids).length < FLUXOS.length; i++) {
      await esperar(4000);
      for (const f of FLUXOS) {
        if (ids[f]) continue;
        const l = JSON.parse(gh("run", "list", "-R", REPO, "-w", f, "-e", "workflow_dispatch", "-L", "20", "--json", "databaseId,displayTitle"));
        const r = execucaoDoEnsaio(l, id);
        if (r) ids[f] = r;
      }
    }
    if (Object.keys(ids).length < FLUXOS.length) throw new Error("não achei as execuções do ensaio no GitHub");
    console.log(`· GitHub: ${FLUXOS.map((f) => `${f} #${ids[f]}`).join(", ")} (uns 10 minutos)`);
    const falhas = [];
    for (const f of FLUXOS) {
      const r = spawnSync("gh", ["run", "watch", String(ids[f]), "-R", REPO, "--exit-status", "--interval", "30"], { cwd: RAIZ, stdio: "ignore" });
      if (r.status !== 0) falhas.push(`${f}: https://github.com/${REPO}/actions/runs/${ids[f]}`);
    }
    if (falhas.length) throw new Error(`o ensaio ficou vermelho no GitHub (nada foi publicado):\n  ${falhas.join("\n  ")}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    // o gist secreto leva a mudança ainda não publicada: se não sair, quem rodou fica sabendo e apaga à mão
    if (gist && spawnSync("gh", ["gist", "delete", gist, "--yes"], { cwd: RAIZ, stdio: "ignore" }).status !== 0) {
      console.error(`ATENÇÃO: não consegui apagar o gist do ensaio; apague à mão: gh gist delete ${gist}`);
    }
  }
  // 3. anota (a árvore do commit do começo, que foi a provada)
  writeFileSync(arquivoDoEnsaio(), `${arvore} ${new Date().toISOString()} ${commit}\n`);
  console.log(`ok: ensaio verde aqui e no GitHub para a árvore ${arvore.slice(0, 12)}; pode publicar`);
}

if (chamadoDireto(import.meta.url)) {
  process.once("SIGINT", () => {
    console.error("\ninterrompido: confira se ficou gist do ensaio (gh gist list) e apague");
    process.exit(130);
  });
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
