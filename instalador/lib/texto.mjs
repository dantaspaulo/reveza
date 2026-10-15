// Saída do instalador (cores só em terminal), idioma (pt-BR ou en) e perguntas, com segredo digitado sem eco.
import { createInterface } from "node:readline/promises";

let idioma = "pt";
// aceita "en", "en-US", "pt", "pt-BR"; qualquer outra coisa fica no português (o padrão)
export const usarIdioma = (i) => { idioma = /^en\b/i.test(String(i ?? "")) ? "en" : "pt"; };
export const t = (pt, en) => (idioma === "en" ? en : pt);
/** O idioma como vai para o instalacao.json e para o agente (o mesmo código do painel e da nuvem). */
export const idiomaGravado = () => (idioma === "en" ? "en" : "pt-BR");
/** O --idioma da linha de comando, lido antes de conferir as opções: assim os erros delas já saem no idioma. */
export function idiomaDoArgv(argv) {
  const i = argv.indexOf("--idioma");
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
/**
 * O idioma sugerido na pergunta inicial, pelo LANG/LC_ALL do terminal. Só sugere: sem terminal (ou com --sim) o idioma
 * nunca vem do ambiente, porque o LANG das máquinas de CI é inglês e a saída sem --idioma tem de seguir em português.
 */
export const idiomaDoTerminal = (env = process.env) => (/^en/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || "") ? "en" : "pt");

const cor = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
export const verde = (s) => cor("32", s);
export const laranja = (s) => cor("33", s);
export const fraco = (s) => cor("2", s);
export const negrito = (s) => cor("1", s);
export const ok = (s) => console.log(`  ${verde("✓")} ${s}`);
export const nao = (s) => console.log(`  ${laranja("·")} ${s}`);
export const info = (s) => console.log(fraco(`    ${s}`));
// O número da etapa vem de fora (lib/etapas.mjs): quem roda a etapa anuncia o número, e o primeiro título dela sai
// com ele na frente ("3/5 Serviço"). Assim cada etapa guarda só o próprio nome, inclusive a de ligar computador.
let numeroPendente = "";
export const numerarProximoTitulo = (numero) => { numeroPendente = numero ? `${numero} ` : ""; };
export const titulo = (s) => {
  console.log(`\n${negrito(numeroPendente + s)}`);
  numeroPendente = "";
};

/** Perguntas: com terminal, pergunta; sem terminal (ou --sim), devolve o padrão. */
export function perguntador({ semPerguntas }) {
  let rl = null;
  const abrir = () => {
    if (!rl && !semPerguntas) rl = createInterface({ input: process.stdin, output: process.stdout });
    return rl;
  };
  const fechar = () => { rl?.close(); rl = null; };
  const perguntar = async (q, padrao = "") => {
    if (semPerguntas || !process.stdin.isTTY) return padrao;
    const r = (await abrir().question(`  ${q}${padrao !== "" ? ` ${fraco(`[${padrao}]`)}` : ""} `)).trim();
    return r || padrao;
  };
  const sim = async (q, padrao = true) => {
    const r = await perguntar(`${q} ${t("(s/n)", "(y/n)")}`, padrao ? t("s", "y") : "n");
    return /^[sy]/i.test(r);
  };
  const escolha = async (q, opcoes, padrao = 1) => {
    if (!semPerguntas && process.stdin.isTTY) opcoes.forEach((o, i) => console.log(`    ${i + 1}) ${o}`));
    const n = Number(await perguntar(q, String(padrao)));
    return (n >= 1 && n <= opcoes.length ? n : padrao) - 1;
  };
  // segredo: fecha o readline (ele ecoaria) e lê em modo cru, mostrando só pontos
  const segredo = async (q, env) => {
    if (env && process.env[env]) return process.env[env];
    if (semPerguntas || !process.stdin.isTTY) return "";
    fechar();
    process.stdout.write(`  ${q} `);
    return new Promise((res) => {
      let v = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const fim = () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", ao);
        process.stdout.write("\n");
        res(v.trim());
      };
      const ao = (bloco) => {
        for (const ch of bloco) {
          if (ch === "\r" || ch === "\n" || ch === "\u0004") return fim();
          if (ch === "\u0003") process.exit(130);
          if (ch === "\u007f" || ch === "\b") v = v.slice(0, -1);
          else { v += ch; process.stdout.write("•"); }
        }
      };
      process.stdin.on("data", ao);
    });
  };
  return { perguntar, sim, escolha, segredo, fechar };
}

/** Senha do administrador: 12+ caracteres, com maiúscula, minúscula e número (a regra que o login também cobra). */
export function senhaForte(s) {
  return typeof s === "string" && s.length >= 12 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

export const emailValido = (e) => /^[^@\s'"]+@[^@\s'"]+\.[^@\s'"]+$/.test(String(e || ""));

/** Só o começo de um segredo, para a pessoa reconhecer sem expor. */
export const mascara = (s) => (s ? `${String(s).slice(0, 6)}…` : "");
