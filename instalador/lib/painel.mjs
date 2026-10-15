// O painel compilado nesta máquina, com a nuvem da pessoa: dependências, React Bits grátis baixado do site oficial
// (o repositório não traz código do React Bits), cabeçalhos de segurança e build. A Vercel recebe só o resultado.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ambienteLimpo, npm, rodar } from "./programa.mjs";
import { t } from "./texto.mjs";

const FORA = ["node_modules", "dist", "capturas", path.join("src", "components", "react-bits"), ".vercel", ".env", ".env.local"];

export function prepararPasta(raiz, build) {
  const origem = path.join(raiz, "painel");
  if (!existsSync(path.join(origem, "package.json"))) throw new Error(t("o repositório não tem o painel (painel/package.json)", "the repository has no panel (painel/package.json)"));
  mkdirSync(build, { recursive: true });
  // node_modules fica entre uma atualização e outra; src, public e scripts vêm de novo (o React Bits é baixado de novo)
  // a trava do npm vem sempre do repositório (uma antiga, gerada na primeira instalação, não pode ficar valendo)
  for (const p of ["src", "public", "scripts", "package-lock.json"]) rmSync(path.join(build, p), { recursive: true, force: true });
  cpSync(origem, build, {
    recursive: true,
    filter: (f) => {
      const rel = path.relative(origem, f);
      return !FORA.some((x) => rel === x || rel.startsWith(x + path.sep));
    },
  });
}

/** Compila e devolve a pasta pronta para publicar (com o vercel.json dentro). */
export function construir(build, { supabaseUrl, anon, dominio, vercelHost, repo = "", versao = "", vapid = "", reactBits = true, log = () => {} }) {
  // Versões travadas (package-lock.json, com o resumo de cada pacote) e sem script de instalação de terceiros: o
  // pacote do painel roda com a sessão do administrador (auditoria de segurança de 11/10/2026).
  if (!existsSync(path.join(build, "package-lock.json"))) throw new Error(t("painel/package-lock.json ausente: a instalação só usa versões travadas",
    "painel/package-lock.json is missing: the installation only uses locked versions"));
  log(t("instalando as dependências do painel (versões travadas)", "installing the panel dependencies (locked versions)"));
  let r = rodar(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps"], { cwd: build });
  if (!r.ok) throw new Error(t(`npm install do painel falhou: ${r.erro.slice(-400)}`, `the panel npm install failed: ${r.erro.slice(-400)}`));
  let componentes = 0;
  if (reactBits) {
    log(t("baixando os componentes grátis do React Bits", "downloading the free React Bits components"));
    r = rodar(process.execPath, ["scripts/baixar-react-bits.mjs"], { cwd: build });
    if (!r.ok) log(t(`React Bits não baixou (o painel funciona sem ele): ${r.erro.slice(-200)}`,
      `React Bits did not download (the panel works without it): ${r.erro.slice(-200)}`));
    else componentes = contarComponentes(r.saida);
  }
  const args = ["scripts/vercel-json.mjs", "--supabase", supabaseUrl];
  if (dominio) args.push("--dominio", dominio);
  if (dominio && vercelHost) args.push("--vercel", vercelHost);
  r = rodar(process.execPath, args, { cwd: build });
  if (!r.ok) throw new Error(t(`cabeçalhos do painel (vercel.json): ${(r.saida + r.erro).slice(-300)}`,
    `panel headers (vercel.json): ${(r.saida + r.erro).slice(-300)}`));
  log(t("compilando o painel", "building the panel"));
  r = rodar(npm, ["run", "build"], {
    cwd: build,
    env: ambienteLimpo({ VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: anon, VITE_REVEZA_REPO: repo, VITE_REVEZA_VERSAO: versao || "", VITE_VAPID_PUBLICA: vapid || "" }),
  });
  if (!r.ok) throw new Error(t(`build do painel falhou: ${trechoDoErro(r.saida + r.erro)}`, `the panel build failed: ${trechoDoErro(r.saida + r.erro)}`));
  const dist = path.join(build, "dist");
  copyFileSync(path.join(build, "vercel.json"), path.join(dist, "vercel.json"));
  return { dist, componentes };
}

/** O começo do erro (não o fim da pilha), que é o que diz o que faltou. */
export function trechoDoErro(texto) {
  const linhas = texto.split("\n").filter((l) => !/^\s+at /.test(l));
  const i = linhas.findIndex((l) => /error|erro|failed/i.test(l));
  return linhas.slice(Math.max(0, i), Math.max(0, i) + 8).join("\n").slice(0, 800);
}

/** Quantos componentes o script do painel deixou na máquina (as linhas "baixados:" e "já estavam:"). */
export function contarComponentes(saida) {
  return saida.split("\n")
    .filter((l) => /^(baixados|já estavam): /.test(l))
    .flatMap((l) => l.replace(/^[^:]+:\s*/, "").split("  ")[0].split(","))
    .filter((x) => x.trim()).length;
}
