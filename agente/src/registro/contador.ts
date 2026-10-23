// Registro de uso das transcrições do assistente (~/.claude/projects/**/*.jsonl): tokens, custo equivalente,
// sessões e agentes, por hora, conta, modelo e projeto.
//
// - Leitura incremental: guarda até que byte leu cada arquivo; linha pela metade fica para a próxima.
// - A mesma resposta aparece em várias linhas (e em outra transcrição, quando a sessão é retomada): conta uma vez,
//   pelo id da resposta. A linha zerada (que vem depois da cheia) não conta nem marca o id, então não apaga a cheia.
// - Agente = arquivo `<sessão>/subagents/agent-<id>.jsonl`.
// - Projeto = só o nome da pasta final (nunca o caminho).
// - Conteúdo da conversa não é guardado em lugar nenhum, só os números.
//
// Estado em arquivos (sem SQLite): `estado.json` (fotografia atômica) e `vistos.txt` (ids já contados, um por
// linha). Os ids novos vão na fotografia até ela crescer; aí descem para o `vistos.txt` antes da fotografia nova,
// então um desligamento no meio nunca conta a mesma resposta duas vezes.

import * as fs from "node:fs";
import * as path from "node:path";
import { gravarJson, lerJson } from "../util/arquivos.js";
import { epochParaIso, isoParaEpoch } from "../util/tempo.js";
import type { LinhaTokens, SessaoNuvem } from "../nuvem/tipos.js";
import { custo, familia, tokens, type Usage } from "./precos.js";

export interface LinhaHora {
  hora: number;
  conta: string;
  modelo: string;
  projeto: string;
  msgs: number;
  ent: number;
  sai: number;
  c5: number;
  c1h: number;
  cl: number;
  usd: number;
}

export interface SessaoReg {
  sessao: string;
  projeto: string;
  inicio: number;
  fim: number;
  msgs: number;
  ent: number;
  sai: number;
  c5: number;
  c1h: number;
  cl: number;
  usd: number;
  contas: string[];
  modelos: string[];
  agentes: number;
  parada: boolean;
}

interface EstadoRegistro {
  formato: 1;
  arquivos: Record<string, number>;
  horas: Record<string, LinhaHora>;
  sessoes: Record<string, SessaoReg>;
  agentes: Record<string, { inicio: number; conta: string }>;
  pendentesHoras: string[];
  pendentesSessoes: string[];
  vistosRecentes: string[];
}

const VAZIO = (): EstadoRegistro => ({
  formato: 1,
  arquivos: {},
  horas: {},
  sessoes: {},
  agentes: {},
  pendentesHoras: [],
  pendentesSessoes: [],
  vistosRecentes: [],
});

const LIMITE_RECENTES = 20_000;
const BLOCO = 1 << 20;
const USAGE = Buffer.from('"usage"');
const ASSISTENTE = Buffer.from('"assistant"');

export function chaveHora(l: Pick<LinhaHora, "hora" | "conta" | "modelo" | "projeto">): string {
  return `${l.hora}|${l.conta}|${l.modelo}|${l.projeto}`;
}

export function projetoDe(cwd: unknown): string {
  if (typeof cwd !== "string" || !cwd) return "";
  return path.basename(cwd.replace(/[\\/]+$/, "").replace(/\\/g, "/"));
}

export class Contador {
  e: EstadoRegistro;
  vistos = new Set<string>();
  completo = false;
  private pendH = new Set<string>();
  private pendS = new Set<string>();

  constructor(
    private dir: string,
    private projetosDir: string,
    private contaEm: (ts: number) => string | null,
    private agora: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.e = { ...VAZIO(), ...(lerJson<EstadoRegistro>(path.join(dir, "estado.json")) ?? {}) };
    try {
      for (const id of fs.readFileSync(path.join(dir, "vistos.txt"), "utf8").split("\n")) if (id) this.vistos.add(id);
    } catch {
      // primeiro uso
    }
    for (const id of this.e.vistosRecentes) this.vistos.add(id);
    this.pendH = new Set(this.e.pendentesHoras);
    this.pendS = new Set(this.e.pendentesSessoes);
  }

  // ------------------------------------------------------------------------------------------------ persistência

  salvar(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (this.e.vistosRecentes.length > LIMITE_RECENTES) {
      fs.appendFileSync(path.join(this.dir, "vistos.txt"), this.e.vistosRecentes.join("\n") + "\n", { mode: 0o600 });
      this.e.vistosRecentes = [];
    }
    this.e.pendentesHoras = [...this.pendH];
    this.e.pendentesSessoes = [...this.pendS];
    // a cada 2 s numa varredura, e se refaz sozinho (os ids seguram a repetição): sem esperar o disco
    gravarJson(path.join(this.dir, "estado.json"), this.e, 0o600, { duravel: false });
  }

  // ------------------------------------------------------------------------------------------------ leitura

  private *arquivos(dir = this.projetosDir): Generator<string> {
    let nomes: fs.Dirent[];
    try {
      nomes = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of nomes) {
      const c = path.join(dir, n.name);
      if (n.isDirectory()) yield* this.arquivos(c);
      else if (n.isFile() && n.name.endsWith(".jsonl")) yield c;
    }
  }

  /**
   * Lê o que é novo em cada transcrição. Para no orçamento e continua de onde parou na próxima. Cede a vez ao resto do
   * agente a cada fatia de ~50 ms: a ponte do mod e a busca da nuvem não podem esperar uma varredura grande.
   */
  async varrer(orcamentoMs?: number): Promise<boolean> {
    const inicio = Date.now();
    this.fatiaDesde = Date.now();
    const fila: [number, string, number][] = [];
    for (const c of this.arquivos()) {
      let st: fs.Stats;
      try {
        st = fs.statSync(c);
      } catch {
        continue;
      }
      const lido = this.e.arquivos[c] ?? 0;
      if (st.size < lido) this.e.arquivos[c] = 0; // arquivo reescrito: relê do começo (os ids seguram a repetição)
      if (st.size > (this.e.arquivos[c] ?? 0)) fila.push([st.mtimeMs, c, st.size]);
    }
    fila.sort((a, b) => a[0] - b[0]);
    let mudou = false;
    let ultimaGravacao = Date.now();
    for (const [, caminho] of fila) {
      if (orcamentoMs && Date.now() - inicio > orcamentoMs) {
        if (mudou) this.salvar();
        return false;
      }
      await this.ler(caminho);
      mudou = true;
      if (Date.now() - ultimaGravacao > 2000) {
        this.salvar();
        ultimaGravacao = Date.now();
      }
    }
    if (mudou) this.salvar();
    this.completo = true;
    return true;
  }

  private fatiaDesde = 0;
  /** Quanto tempo de leitura seguida antes de ceder a vez (ms). */
  fatiaMs = 50;

  private async ceder(): Promise<void> {
    if (Date.now() - this.fatiaDesde < this.fatiaMs) return;
    await new Promise((r) => setImmediate(r));
    this.fatiaDesde = Date.now();
  }

  private async ler(caminho: string): Promise<void> {
    const partes = caminho.split(path.sep);
    const base = path.basename(caminho);
    const agente = partes.includes("subagents") && base.startsWith("agent-") ? base.slice("agent-".length, -".jsonl".length) : null;
    let pos = this.e.arquivos[caminho] ?? 0;
    let fd: number;
    try {
      fd = fs.openSync(caminho, "r");
    } catch {
      return;
    }
    try {
      let resto = Buffer.alloc(0);
      let lidoAte = pos;
      const buf = Buffer.alloc(BLOCO);
      for (;;) {
        const n = fs.readSync(fd, buf, 0, BLOCO, pos);
        if (n <= 0) break;
        pos += n;
        let dados = resto.length ? Buffer.concat([resto, buf.subarray(0, n)]) : Buffer.from(buf.subarray(0, n));
        let inicio = 0;
        for (;;) {
          const fim = dados.indexOf(10, inicio);
          if (fim < 0) break;
          const linha = dados.subarray(inicio, fim);
          lidoAte += fim + 1 - inicio;
          inicio = fim + 1;
          if (linha.indexOf(USAGE) < 0 || linha.indexOf(ASSISTENTE) < 0) continue;
          let d: unknown;
          try {
            d = JSON.parse(linha.toString("utf8"));
          } catch {
            continue;
          }
          this.registrar(d as Record<string, unknown>, agente, caminho);
        }
        resto = dados.subarray(inicio);
        dados = Buffer.alloc(0);
        await this.ceder();
      }
      // linha sem fim ainda sendo escrita: fica para a próxima (lidoAte para no último \n)
      this.e.arquivos[caminho] = lidoAte;
    } finally {
      fs.closeSync(fd);
    }
  }

  private registrar(d: Record<string, unknown>, agente: string | null, caminho: string): void {
    if (d.type !== "assistant") return;
    const m = (d.message ?? {}) as Record<string, unknown>;
    const u = (m.usage ?? {}) as Usage;
    const mid = typeof m.id === "string" ? m.id : null;
    const t = tokens(u);
    if (!mid || t.ent + t.sai + t.c5 + t.c1h + t.cl === 0) return;
    if (this.vistos.has(mid)) return;
    this.vistos.add(mid);
    this.e.vistosRecentes.push(mid);
    const modeloBruto = typeof m.model === "string" ? m.model : null;
    const modelo = familia(modeloBruto) ?? modeloBruto ?? "desconhecido";
    if (modelo === "<synthetic>") return;
    const ts = isoParaEpoch(d.timestamp) ?? this.agora();
    const { usd } = custo(u, modeloBruto);
    const conta = this.contaEm(ts) ?? "";
    const projeto = projetoDe(d.cwd);
    const hora = ts - (ts % 3600);
    const k = chaveHora({ hora, conta, modelo, projeto });
    const h = (this.e.horas[k] ??= { hora, conta, modelo, projeto, msgs: 0, ent: 0, sai: 0, c5: 0, c1h: 0, cl: 0, usd: 0 });
    h.msgs += 1;
    h.ent += t.ent;
    h.sai += t.sai;
    h.c5 += t.c5;
    h.c1h += t.c1h;
    h.cl += t.cl;
    h.usd += usd;
    this.pendH.add(k);

    const sessao = typeof d.sessionId === "string" && d.sessionId ? d.sessionId : path.basename(caminho).slice(0, -".jsonl".length);
    const s = (this.e.sessoes[sessao] ??= {
      sessao,
      projeto,
      inicio: ts,
      fim: ts,
      msgs: 0,
      ent: 0,
      sai: 0,
      c5: 0,
      c1h: 0,
      cl: 0,
      usd: 0,
      contas: [],
      modelos: [],
      agentes: 0,
      parada: false,
    });
    if (!s.projeto) s.projeto = projeto;
    s.inicio = Math.min(s.inicio, ts);
    s.fim = Math.max(s.fim, ts);
    s.msgs += 1;
    s.ent += t.ent;
    s.sai += t.sai;
    s.c5 += t.c5;
    s.c1h += t.c1h;
    s.cl += t.cl;
    s.usd += usd;
    if (!s.contas.includes(conta)) s.contas = [...s.contas, conta].sort();
    if (!s.modelos.includes(modelo)) s.modelos = [...s.modelos, modelo].sort();
    if (agente) {
      const ka = `${sessao}/${agente}`;
      if (!this.e.agentes[ka]) {
        this.e.agentes[ka] = { inicio: ts, conta };
        s.agentes += 1;
      }
    }
    this.pendS.add(sessao);
  }

  marcarParada(sessao: string): void {
    const s = this.e.sessoes[sessao];
    if (s && !s.parada) {
      s.parada = true;
      this.pendS.add(sessao);
    }
  }

  // ------------------------------------------------------------------------------------------------ nuvem

  /** Linhas e sessões que mudaram desde o último envio, com os totais (não a diferença): reenviar não duplica. */
  paraNuvem(contaNuvem: (idLocal: string) => string | null, max = 500, maxSessoes = 200): {
    linhas: LinhaTokens[];
    sessoes: SessaoNuvem[];
    chaves: string[];
    ids: string[];
  } {
    const linhas: LinhaTokens[] = [];
    const chaves: string[] = [];
    for (const k of this.pendH) {
      const h = this.e.horas[k];
      if (!h) {
        this.pendH.delete(k);
        continue;
      }
      // Sem conta (uso de antes do agente) vai sem conta; conta que ainda não está na nuvem espera ela entrar.
      const contaId = h.conta ? contaNuvem(h.conta) : null;
      if (h.conta && !contaId) continue;
      linhas.push({
        hora: epochParaIso(h.hora),
        conta_id: contaId,
        projeto: h.projeto,
        modelo: h.modelo,
        respostas: h.msgs,
        entrada: h.ent,
        saida: h.sai,
        cache_escrita: h.c5 + h.c1h,
        cache_leitura: h.cl,
        usd: Math.round(h.usd * 10_000) / 10_000,
      });
      chaves.push(k);
      if (linhas.length >= max) break;
    }
    const sessoes: SessaoNuvem[] = [];
    const ids: string[] = [];
    for (const id of this.pendS) {
      const s = this.e.sessoes[id];
      if (!s) {
        this.pendS.delete(id);
        continue;
      }
      sessoes.push({
        id: s.sessao,
        projeto: s.projeto,
        inicio: s.inicio ? epochParaIso(s.inicio) : null,
        fim: s.fim ? epochParaIso(s.fim) : null,
        respostas: s.msgs,
        tokens: s.ent + s.sai + s.c5 + s.c1h + s.cl,
        usd: Math.round(s.usd * 10_000) / 10_000,
        agentes: s.agentes,
        contas: s.contas.map((c) => (c ? contaNuvem(c) : null)).filter((x): x is string => !!x),
        modelos: s.modelos,
      });
      ids.push(id);
      if (sessoes.length >= maxSessoes) break;
    }
    return { linhas, sessoes, chaves, ids };
  }

  confirmarEnvio(chaves: string[], ids: string[]): void {
    for (const k of chaves) this.pendH.delete(k);
    for (const id of ids) this.pendS.delete(id);
  }

  get pendentes(): number {
    return this.pendH.size + this.pendS.size;
  }

  // ------------------------------------------------------------------------------------------------ importação

  /** Estado inicial vindo de outro registro (o roteador antigo). Soma ao que já existe. */
  importar(dados: {
    arquivos: Record<string, number>;
    vistos: Iterable<string>;
    horas: LinhaHora[];
    sessoes: SessaoReg[];
    agentes: { sessao: string; agente: string; inicio: number; conta: string }[];
  }): void {
    for (const [c, lido] of Object.entries(dados.arquivos)) this.e.arquivos[c] = Math.max(this.e.arquivos[c] ?? 0, lido);
    const novos: string[] = [];
    for (const id of dados.vistos) {
      if (!this.vistos.has(id)) {
        this.vistos.add(id);
        novos.push(id);
      }
    }
    if (novos.length) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(this.dir, "vistos.txt"), novos.join("\n") + "\n", { mode: 0o600 });
    }
    for (const l of dados.horas) {
      const k = chaveHora(l);
      const h = (this.e.horas[k] ??= { ...l, msgs: 0, ent: 0, sai: 0, c5: 0, c1h: 0, cl: 0, usd: 0 });
      h.msgs += l.msgs;
      h.ent += l.ent;
      h.sai += l.sai;
      h.c5 += l.c5;
      h.c1h += l.c1h;
      h.cl += l.cl;
      h.usd += l.usd;
      if (l.conta) this.pendH.add(k);
    }
    for (const s of dados.sessoes) {
      if (!this.e.sessoes[s.sessao]) this.e.sessoes[s.sessao] = { ...s };
      this.pendS.add(s.sessao);
    }
    for (const a of dados.agentes) this.e.agentes[`${a.sessao}/${a.agente}`] ??= { inicio: a.inicio, conta: a.conta };
    this.salvar();
  }

  // ------------------------------------------------------------------------------------------------ relatórios

  linhas(desde = 0): LinhaHora[] {
    return Object.values(this.e.horas)
      .filter((h) => h.hora >= desde)
      .sort((a, b) => a.hora - b.hora || a.conta.localeCompare(b.conta) || a.modelo.localeCompare(b.modelo));
  }

  agentesEntre(a: number, b: number, conta?: string): number {
    let n = 0;
    for (const x of Object.values(this.e.agentes)) if (x.inicio >= a && x.inicio < b && (conta === undefined || x.conta === conta)) n += 1;
    return n;
  }

  sessoesEntre(a: number, b: number): number {
    let n = 0;
    for (const s of Object.values(this.e.sessoes)) if (s.fim >= a && s.inicio < b) n += 1;
    return n;
  }

  /** Totais de um período, para a CLI e o painel. */
  totais(a: number, b: number, filtro: (h: LinhaHora) => boolean = () => true) {
    const t = { respostas: 0, entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0, tokens: 0, usd: 0 };
    for (const h of Object.values(this.e.horas)) {
      if (h.hora < a - (a % 3600) || h.hora >= b || !filtro(h)) continue;
      t.respostas += h.msgs;
      t.entrada += h.ent;
      t.saida += h.sai;
      t.cacheEscrita += h.c5 + h.c1h;
      t.cacheLeitura += h.cl;
      t.tokens += h.ent + h.sai + h.c5 + h.c1h + h.cl;
      t.usd += h.usd;
    }
    t.usd = Math.round(t.usd * 100) / 100;
    return t;
  }

  sessoesRecentes(n = 40): SessaoReg[] {
    return Object.values(this.e.sessoes)
      .sort((a, b) => b.fim - a.fim)
      .slice(0, n);
  }
}
