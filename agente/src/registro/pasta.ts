// A pasta de um uso, para saber de quem ele é (0.17.0). O nome curto (o "projeto") não basta: "producao", "fonte" ou o
// nome de uma árvore de trabalho do git aparecem em vários projetos. A pasta é a raiz do git em que a conversa rodou
// (uma árvore de trabalho conta como o repositório principal dela), relativa à pasta pessoal: "~/Code/projeto". Sem git,
// a própria pasta. Sem pasta legível (apagada depois), a pasta como veio, também relativa à pessoal.
//
// Só caminho: nenhum conteúdo de arquivo sai do computador. A resposta de cada pasta fica guardada na memória do
// agente (o registro lê milhares de linhas da mesma conversa).

import * as fs from "node:fs";
import * as path from "node:path";

/** O máximo que a nuvem guarda (0036). */
export const PASTA_MAX = 300;

export interface LeitorPastas {
  /** O conteúdo de `<pasta>/.git` quando ele é arquivo (árvore de trabalho, submódulo); "" quando é pasta; null sem ele. */
  git(pasta: string): string | null;
}

export const LEITOR_DISCO: LeitorPastas = {
  git(pasta) {
    const g = path.join(pasta, ".git");
    try {
      const st = fs.statSync(g);
      if (st.isDirectory()) return "";
      if (st.isFile()) return fs.readFileSync(g, "utf8").slice(0, 4096);
    } catch {
      // sem .git aqui
    }
    return null;
  },
};

/** "/Users/x/Code/a" vira "~/Code/a" quando está dentro da pasta pessoal; barras do Windows viram "/". */
export function relativaAPessoal(p: string, casa: string): string {
  const limpa = p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const c = casa.replace(/\\/g, "/").replace(/\/+$/, "");
  if (c && limpa === c) return "~";
  if (c && limpa.startsWith(c + "/")) return "~" + limpa.slice(c.length);
  return limpa;
}

/**
 * A raiz do git de `cwd` (a do repositório principal, quando é uma árvore de trabalho), sem subir além da pasta pessoal
 * nem da raiz do disco. null quando não há git acima de `cwd`.
 */
export function raizDoGit(cwd: string, casa: string, leitor: LeitorPastas = LEITOR_DISCO): string | null {
  const c = path.resolve(casa);
  let atual = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    if (atual === c) return null; // a pasta pessoal nunca é "o projeto"
    const g = leitor.git(atual);
    if (g === "") return atual;
    if (g !== null) {
      // "gitdir: /repo/.git/worktrees/nome": a árvore de trabalho é do repositório /repo
      const m = /^gitdir:\s*(.+)$/m.exec(g);
      const destino = m ? path.resolve(atual, m[1]!.trim()) : null;
      const w = destino ? /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.exec(destino) : null;
      return w ? w[1]! : atual;
    }
    const acima = path.dirname(atual);
    if (acima === atual) return null;
    atual = acima;
  }
  return null;
}

/**
 * A pasta como a nuvem guarda (rvz_pasta, 0037): sem espaço nas pontas nem caractere de controle, até 300 caracteres,
 * e só caminho ("~", "~/...", "/..." ou, no Windows, "D:/..."); o resto vira "". O agente guarda já assim, para que duas
 * pastas daqui nunca virem a mesma linha lá (o lote com a mesma chave duas vezes seria recusado).
 */
export function pastaNaNuvem(p: string): string {
  const v = Array.from(p.replace(/^ +| +$/g, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
    .slice(0, PASTA_MAX)
    .join("");
  return /^(~|~\/.*|\/.*|[A-Za-z]:(\/.*)?)$/s.test(v) ? v : "";
}

/** `p` é `base` ou está dentro dela (caminhos já resolvidos). */
function dentroDe(p: string, base: string): boolean {
  if (p === base) return true;
  const b = /[\\/]$/.test(base) ? base : base + path.sep;
  return p.startsWith(b) || p.startsWith(base + "/");
}

const NENHUMA: readonly string[] = Object.freeze([]);

/** Resolve e guarda a pasta de cada cwd. */
export class Pastas {
  private cache = new Map<string, string>();
  private fixasVistas: readonly string[] | null = null;

  /**
   * @param fixas pastas que valem como projeto mesmo dentro de um repositório git (as dos agentes do OpenBot, em
   * caminho absoluto): sem isso, o uso de um agente cuja pasta fica num repositório iria para a raiz dele, e a regra
   * pelo título do agente nunca valeria. Um repositório dentro da pasta do agente continua sendo ele mesmo.
   */
  constructor(
    private casa: string,
    private leitor: LeitorPastas = LEITOR_DISCO,
    private fixas: () => readonly string[] = () => NENHUMA,
  ) {}

  de(cwd: unknown): string {
    if (typeof cwd !== "string" || !cwd || cwd.length > 4096) return "";
    // a lista é comparada pela referência: a mesma lista vazia sempre, para não limpar a memória a cada leitura
    let fixas: readonly string[] = NENHUMA;
    try {
      fixas = this.fixas();
    } catch {
      fixas = NENHUMA;
    }
    if (fixas !== this.fixasVistas) {
      // a lista mudou: as respostas guardadas podem ter mudado também
      this.fixasVistas = fixas;
      this.cache.clear();
    }
    const ja = this.cache.get(cwd);
    if (ja !== undefined) return ja;
    let r = "";
    try {
      const atual = path.resolve(cwd);
      const raiz = raizDoGit(cwd, this.casa, this.leitor);
      let fixa: string | null = null;
      for (const f of fixas) {
        const rf = path.resolve(f);
        if (dentroDe(atual, rf) && (!fixa || rf.length > fixa.length)) fixa = rf;
      }
      // a pasta do agente ganha da raiz do git que a contém; um repositório dentro dela ganha dela. Tudo resolvido do
      // mesmo jeito (também a pessoal): no Windows, "/Users/x" resolvido vira "D:\Users\x", e misturar os dois jeitos
      // deixaria a pasta fora da pessoal
      const base = fixa && (!raiz || dentroDe(fixa, raiz)) ? fixa : (raiz ?? atual);
      // sem pessoal conhecida, nada vira "~" (resolver "" daria a pasta em que o agente roda)
      r = pastaNaNuvem(relativaAPessoal(base, this.casa ? path.resolve(this.casa) : ""));
    } catch {
      r = "";
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(cwd, r);
    return r;
  }
}
