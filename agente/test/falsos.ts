// Falsos dos testes: relógio, API das contas, programa do assistente, executor e nuvem. Nada aqui toca chaveiro,
// rede ou processo de verdade.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApiContas, Janela, Perfil } from "../src/anthropic.js";
import type { Cli } from "../src/claudecli.js";
import { caminhos, type Caminhos } from "../src/config.js";
import type { Blob } from "../src/credenciais/blob.js";
import { CredenciaisFalsas } from "../src/credenciais/falsa.js";
import { GuardaFalsa } from "../src/cofre/guarda.js";
import type { Executor, OpcoesIniciar, Processo, Resultado } from "../src/util/executor.js";
import { LogMemoria } from "../src/util/log.js";
import type { Relogio } from "../src/util/tempo.js";
import { ErroNuvem } from "../src/nuvem/tipos.js";
import type {
  ChavePublica,
  CofreNuvem,
  ComandoNuvem,
  EnvelopeChave,
  JanelaNuvem,
  LinhaTokens,
  MotivoPosse,
  MotivoRecusa,
  Nuvem,
  PedidoLigacao,
  PontoNuvem,
  RespostaReceber,
  SessaoNuvem,
  TokenNuvem,
} from "../src/nuvem/tipos.js";
import { Agente } from "../src/agente.js";
import { modoAtualizar } from "../src/atualizar.js";
import { pendenteDaPublicacao } from "../src/completa.js";
import type { Sistema } from "../src/config.js";
import { novaChave } from "../src/cofre/cifra.js";
import { SEGREDO_COFRE } from "../src/cofre/guarda.js";

export const T0 = 1_800_000_000;

/** Token falso: a primeira letra diz de quem é ("A1" é da conta A). */
export function blob(tok: string, refresh = true, expiraEmS = 3600, agora = T0): Blob {
  const o: Record<string, unknown> = {
    accessToken: tok,
    expiresAt: (agora + expiraEmS) * 1000,
    subscriptionType: "max",
    rateLimitTier: "default_max_5x",
    scopes: ["user:inference"],
  };
  if (refresh) o.refreshToken = "r-" + tok;
  return { claudeAiOauth: o, organizationUuid: "org" } as Blob;
}

export class RelogioFalso implements Relogio {
  t = T0;
  ms = 0;
  tarefas: { quando: number; fn: () => void; cancelada: boolean }[] = [];

  agora() {
    return this.t;
  }
  agoraMs() {
    return this.t * 1000 + this.ms;
  }
  agendar(fn: () => void, ms: number) {
    const tarefa = { quando: this.agoraMs() + ms, fn, cancelada: false };
    this.tarefas.push(tarefa);
    return { cancelar: () => void (tarefa.cancelada = true) };
  }
  /** Dormir no relógio falso faz o tempo passar (sem esperar de verdade). */
  async dormir(ms = 0): Promise<void> {
    const alvo = this.agoraMs() + ms;
    this.t = Math.floor(alvo / 1000);
    this.ms = alvo % 1000;
    await new Promise((r) => setImmediate(r));
  }
  /** Avança o relógio e roda o que venceu (uma rodada). */
  async avancar(ms: number): Promise<void> {
    const alvo = this.agoraMs() + ms;
    this.t = Math.floor(alvo / 1000);
    this.ms = alvo % 1000;
    const vencidas = this.tarefas.filter((x) => !x.cancelada && x.quando <= alvo);
    this.tarefas = this.tarefas.filter((x) => !vencidas.includes(x));
    for (const x of vencidas) x.fn();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }
}

export class ApiFalsa implements ApiContas {
  usos: Record<string, number> = {};
  statusUso: Record<string, number> = {};
  perfisPedidos = 0;
  usosPedidos: string[] = [];
  semRede = false;
  /** Tokens que a API recusa (login que não vale mais). */
  recusados = new Set<string>();

  async perfil(token: string) {
    this.perfisPedidos += 1;
    if (this.semRede) return { status: 0 };
    if (this.recusados.has(token)) return { status: 401 };
    const l = token[0]!;
    const perfil: Perfil = {
      accountUuid: `acc-${l}`,
      email: `${l.toLowerCase()}@exemplo.com`,
      orgUuid: `org-${l}`,
      org: `Org ${l}`,
      orgTipo: "x",
      tier: "default_max_5x",
    };
    return { status: 200, perfil };
  }

  async uso(token: string) {
    const l = token[0]!;
    this.usosPedidos.push(token);
    if (this.statusUso[l]) return { status: this.statusUso[l]! };
    const janelas: Janela[] = [{ tipo: "five_hour", pct: this.usos[l] ?? 10, resetEm: T0 + 3600 }];
    return { status: 200, janelas };
  }
}

export class ProcessoFalso implements Processo {
  vivo = true;
  escrito: string[] = [];
  linhas: ((l: string) => void)[] = [];
  fins: ((c: number) => void)[] = [];
  escrever(t: string) {
    this.escrito.push(t);
    return this.vivo;
  }
  aoLinha(fn: (l: string) => void) {
    this.linhas.push(fn);
  }
  aoFim(fn: (c: number) => void) {
    this.fins.push(fn);
  }
  terminar() {
    this.fim(0);
  }
  emitir(l: string) {
    for (const fn of this.linhas) fn(l);
  }
  fim(c = 0) {
    if (!this.vivo) return;
    this.vivo = false;
    for (const fn of this.fins) fn(c);
  }
}

export class CliFalsa implements Cli {
  renovacoes: string[] = [];
  aoRenovar: ((pasta: string, tentativa: number) => void) | null = null;
  logins: { pasta: string; email: string | null; proc: ProcessoFalso }[] = [];
  retomadas: { sessao: string; cwd: string }[] = [];
  /** A versão que o `--version` responde (null: programa não achado). */
  versaoAtual: string | null = "2.1.293";
  /** Cada `claude update`: o que ele responde e para qual versão o programa vai. */
  atualizacoes: number = 0;
  aoAtualizar: () => { codigo: number; saida: string; erro: string; para?: string } = () => ({
    codigo: 0,
    saida: "Successfully updated from 2.1.293 to version 2.1.301",
    erro: "",
    para: "2.1.301",
  });
  /** O `claude update` só termina quando isto resolver (para os testes verem o "atualizando"). */
  segurarAtualizacao: Promise<void> | null = null;
  binario() {
    return "/falso/assistente";
  }
  async versao() {
    return this.versaoAtual;
  }
  async atualizar() {
    this.atualizacoes++;
    if (this.segurarAtualizacao) await this.segurarAtualizacao;
    const { para, ...r } = this.aoAtualizar();
    if (para) this.versaoAtual = para;
    return r;
  }
  async renovar(pasta: string, tentativa: 0 | 1) {
    this.renovacoes.push(pasta);
    this.aoRenovar?.(pasta, tentativa);
  }
  login(pasta: string, email: string | null) {
    const proc = new ProcessoFalso();
    this.logins.push({ pasta, email, proc });
    return proc;
  }
  retomar(sessao: string, cwd: string) {
    this.retomadas.push({ sessao, cwd });
  }
}

export class ExecutorFalso implements Executor {
  chamadas: { argv: string[]; entrada?: string; arvore?: boolean }[] = [];
  /** Processos iniciados (soltos ou não), com as opções: nada roda de verdade. */
  iniciados: { argv: string[]; op: OpcoesIniciar }[] = [];
  responder: (argv: string[], entrada?: string) => Resultado = () => ({ codigo: 0, saida: "", erro: "" });
  async rodar(argv: string[], op: { entrada?: string; arvore?: boolean } = {}) {
    this.chamadas.push({ argv, entrada: op.entrada, ...(op.arvore ? { arvore: true } : {}) });
    return this.responder(argv, op.entrada);
  }
  iniciar(argv: string[] = [], op: OpcoesIniciar = {}): Processo {
    this.iniciados.push({ argv, op });
    return new ProcessoFalso();
  }
}

export function pastaTemporaria(): { dir: string; c: Caminhos; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-teste-"));
  const c = caminhos(path.join(dir, "home"), { REVEZA_HOME: path.join(dir, "home", ".reveza") });
  fs.mkdirSync(c.principalDir, { recursive: true });
  fs.writeFileSync(c.claudeJson, JSON.stringify({ oauthAccount: { emailAddress: "a@exemplo.com" }, outra: 1 }));
  return { dir, c, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------------------------------------ nuvem falsa

interface ContaNuvemF {
  id: string;
  email: string;
  cofre: { cifrado: Buffer; nonce: Buffer; versao: number; expira_em: string | null } | null;
  precisaLogin?: boolean;
  /** O modelo da conta (0025); undefined imita a nuvem de antes, que não manda a chave. */
  modelo?: string | null;
}

/** As migrações que os pacotes de teste trazem (nuvem/migracoes) e que o banco falso já tem aplicadas. */
export const MIGRACOES_DO_PACOTE = ["0001_base.sql", "0099_permissoes.sql"];

/** O banco em memória, com as mesmas regras das funções agente_* (posse, atribuição, versão do cofre, comandos). */
export class BancoFalso {
  contas = new Map<string, ContaNuvemF>();
  posse = new Map<string, { pc: string; motivo: MotivoPosse; expira: number }>();
  atribuicao = new Map<string, { conta: string | null; versao: number; motivo: string }>();
  computadores = new Map<string, { nome: string; enxugar?: boolean }>();
  comandos: (ComandoNuvem & { pc: string; estado: string; http?: number; resposta?: unknown })[] = [];
  eventos: { tipo: string; texto: string; dados: unknown; pc: string }[] = [];
  janelas: (JanelaNuvem & { pc: string })[] = [];
  tokens = new Map<string, LinhaTokens>();
  sessoes = new Map<string, SessaoNuvem>();
  ligacoes: { embrulho: Buffer; sal: Buffer; por: string; usada: boolean; expira: number }[] = [];
  /** Pedidos de computador novo (0019), por computador novo. */
  pedidos = new Map<string, PedidoFalso>();
  /** Computadores ainda pendentes (identidade criada pelo painel, sem a chave do cofre). */
  pendentes = new Set<string>();
  cofreImpressao: string | null = null;
  /** A vez de atualizar sozinho (config `atualizacao_vez` do banco). */
  vez: { pc: string; de: string; para: string; desde: number; estado: string } | null = null;
  versoes = new Map<string, string>();
  alertas: { texto: string; dados: Record<string, unknown> }[] = [];
  /** O registro das migrações aplicadas (reveza_migracoes): null = sem registro; o agente_migracoes devolve os nomes. */
  migracoes: string[] | null = [...MIGRACOES_DO_PACOTE];
  /** O resumo de cada uma (0.3.1); null = nuvem de antes, que só devolve os nomes. */
  hashesMigracoes: Record<string, string> | null = null;
  /** Nuvem de antes da 0.2.1: sem a função agente_migracoes. */
  semFuncaoMigracoes = false;
  config: Record<string, unknown> = { auto: false, modo: "limiar", aviso: 90, troca: 95, intervalo_s: 5, retomar_terminal: false };
  /** Os tokens cifrados da atualização completa (0021), como o banco guarda (o falso só confere o formato). */
  credenciais: { supabase?: TokenNuvem & { gravadoEm: string }; vercel?: TokenNuvem & { gravadoEm: string } } = {};
  /** A vez de publicar funções e painel (config `publicacao_vez`). */
  publicacaoVez: { pc: string; para: string; estado: string; desde: number; motivo?: string | null } | null = null;
  chamadas: { pc: string; fn: string; args: unknown[] }[] = [];
  agora = () => T0;
  foraDoAr = false;

  conta(email: string): ContaNuvemF {
    let c = [...this.contas.values()].find((x) => x.email === email);
    if (!c) {
      c = { id: randomUUID(), email, cofre: null };
      this.contas.set(c.id, c);
    }
    return c;
  }

  atribuir(pc: string, conta: string | null, motivo = "teste") {
    const a = this.atribuicao.get(pc);
    this.atribuicao.set(pc, { conta, versao: (a?.versao ?? 0) + 1, motivo });
  }

  donoDaPosse(conta: string): string | null {
    const p = this.posse.get(conta);
    return p && p.expira > this.agora() ? p.pc : null;
  }
}

export interface PedidoFalso {
  publica: ChavePublica | null;
  aprovador: string | null;
  aprovadorEm: number | null;
  idioma?: "pt-BR" | "en";
  pedidoEm: number | null;
  expira: number;
  envelope: EnvelopeChave | null;
  entreguePor: string | null;
  lido: boolean;
  recusado: MotivoRecusa | null;
}

const mesmaChave = (a: ChavePublica | null, b: ChavePublica | null) => !!a && !!b && a.x === b.x && a.y === b.y;

export class NuvemFalsa implements Nuvem {
  constructor(
    public banco: BancoFalso,
    public pc: string = randomUUID(),
  ) {}

  private registrarChamada(fn: string, ...args: unknown[]) {
    if (this.banco.foraDoAr) throw new ErroNuvem("fetch failed", true);
    this.banco.chamadas.push({ pc: this.pc, fn, args });
  }

  async registrar(nome: string) {
    this.registrarChamada("registrar", nome);
    // as regras do agente_registrar (0019): pendente só entra depois de ler a chave entregue (menos a primeira)
    if (this.banco.pendentes.has(this.pc) && this.banco.cofreImpressao && !this.banco.pedidos.get(this.pc)?.lido) {
      throw new ErroNuvem("agente_registrar: este computador ainda não recebeu a chave do cofre", false, "42501");
    }
    this.banco.pendentes.delete(this.pc);
    this.banco.computadores.set(this.pc, { ...this.banco.computadores.get(this.pc), nome });
    return { computador_id: this.pc };
  }

  async ola(versao: string, diagnostico: Record<string, unknown> | null, contaLocal: string | null) {
    this.registrarChamada("ola", versao, diagnostico, contaLocal);
    const b = this.banco;
    b.versoes.set(this.pc, versao);
    for (const p of b.posse.values()) if (p.pc === this.pc && p.motivo === "uso") p.expira = b.agora() + 120;
    if (!b.atribuicao.has(this.pc) && contaLocal) {
      const c = [...b.contas.values()].find((x) => x.email === contaLocal.toLowerCase());
      if (c && ![...b.atribuicao.values()].some((a) => a.conta === c.id)) b.atribuicao.set(this.pc, { conta: c.id, versao: 1, motivo: "conta que já estava no computador" });
    }
    const a = b.atribuicao.get(this.pc);
    return {
      computador_id: this.pc,
      atribuicao: a && a.conta ? this.atribuicaoDe(a.conta, a.versao, a.motivo) : null,
      config: { ...b.config },
      comandos: b.comandos.filter((c) => c.pc === this.pc && c.estado === "pendente").map(({ id, acao, corpo }) => ({ id, acao, corpo })),
      ligacao_pendente: b.ligacoes.some((l) => !l.usada && l.expira > b.agora()),
      ligacoes: this.abertos(),
      enxugar: b.computadores.get(this.pc)?.enxugar === true,
    };
  }

  private atribuicaoDe(conta: string, versao: number, motivo: string) {
    const c = this.banco.contas.get(conta);
    const r: { conta_id: string; email: string | null; versao: number; motivo: string; modelo?: string | null } =
      { conta_id: conta, email: c?.email ?? null, versao, motivo };
    if (c && c.modelo !== undefined) r.modelo = c.modelo;
    return r;
  }

  private abertos(): PedidoLigacao[] {
    const b = this.banco;
    return [...b.pedidos.entries()]
      .filter(([id, p]) => id !== this.pc && b.pendentes.has(id) && p.publica && !p.entreguePor && !p.recusado && p.expira > b.agora())
      .map(([id, p]) => ({
        computador_id: id,
        publica: p.publica!,
        pedido_em: new Date(p.pedidoEm! * 1000).toISOString(),
        expira_em: new Date(p.expira * 1000).toISOString(),
        para_mim: p.aprovador === this.pc,
        aprovador_em: p.aprovadorEm ? new Date(p.aprovadorEm * 1000).toISOString() : null,
        idioma: p.idioma ?? "pt-BR",
      }));
  }

  /** O painel escolhe onde a janela abre (painel_ligacao_aprovador). */
  escolherAprovador(novo: string, aprovador: string, idioma: "pt-BR" | "en" = "pt-BR") {
    const b = this.banco;
    const p = b.pedidos.get(novo) ?? { publica: null, aprovador: null, aprovadorEm: null, pedidoEm: null, expira: 0, envelope: null, entreguePor: null, lido: false, recusado: null };
    p.aprovador = aprovador;
    p.aprovadorEm = b.agora();
    p.idioma = idioma;
    b.pedidos.set(novo, p);
  }

  async ligacaoPedir(publica: ChavePublica) {
    this.registrarChamada("ligacaoPedir");
    const b = this.banco;
    if (!b.pendentes.has(this.pc)) throw new ErroNuvem("agente_ligacao_pedir: este computador já entrou na instalação", false, "42501");
    const p = b.pedidos.get(this.pc) ?? { publica: null, aprovador: null, aprovadorEm: null, pedidoEm: null, expira: 0, envelope: null, entreguePor: null, lido: false, recusado: null };
    if (!p.publica && !p.recusado && !p.entreguePor) Object.assign(p, { publica, pedidoEm: b.agora(), expira: b.agora() + 600 });
    else if (!mesmaChave(p.publica, publica)) throw new ErroNuvem("agente_ligacao_pedir: este código de acesso já pediu para entrar uma vez: gere outro no painel", false, "42501");
    b.pedidos.set(this.pc, p);
    return { computador_id: this.pc, expira_em: new Date(p.expira * 1000).toISOString() };
  }

  async ligacaoReceber(): Promise<RespostaReceber> {
    this.registrarChamada("ligacaoReceber");
    const b = this.banco;
    const p = b.pedidos.get(this.pc);
    const r: RespostaReceber = { estado: "sem_pedido", envelope: null, impressao: null, motivo: null, expira_em: null, aprovador: null };
    if (!p?.publica) return r;
    if (p.recusado) return { ...r, estado: "recusado", motivo: p.recusado };
    if (p.lido) return { ...r, estado: "lido" };
    if (p.envelope) {
      const envelope = p.envelope;
      p.envelope = null;
      p.lido = true;
      return { ...r, estado: "entregue", envelope, impressao: b.cofreImpressao };
    }
    if (p.expira <= b.agora()) return { ...r, estado: "vencido" };
    const aprovador = p.aprovador ? (b.computadores.get(p.aprovador)?.nome ?? null) : null;
    return { ...r, estado: "esperando", expira_em: new Date(p.expira * 1000).toISOString(), aprovador };
  }

  async ligacoesAbertas() {
    this.registrarChamada("ligacoesAbertas");
    return this.abertos();
  }

  async ligacaoEntregar(computadorId: string, publica: ChavePublica, envelope: EnvelopeChave) {
    this.registrarChamada("ligacaoEntregar", computadorId);
    const b = this.banco;
    const abertos = this.abertos();
    if (abertos.length > 1) {
      for (const a of abertos) b.pedidos.get(a.computador_id)!.recusado = "dois_pedidos";
      return { ok: false, erro: "dois pedidos de ligação ao mesmo tempo: recusei os dois; gere de novo no painel" };
    }
    const p = b.pedidos.get(computadorId);
    if (!p?.publica || computadorId === this.pc) return { ok: false, erro: "pedido desconhecido" };
    if (!mesmaChave(p.publica, publica)) return { ok: false, erro: "a chave do pedido não é a que foi conferida" };
    if (p.entreguePor || p.recusado) return { ok: false, erro: "pedido já fechado" };
    if (p.expira <= b.agora()) return { ok: false, erro: "pedido vencido" };
    Object.assign(p, { envelope, entreguePor: this.pc });
    return { ok: true, erro: null };
  }

  async ligacaoRecusar(computadorId: string, motivo: MotivoRecusa) {
    this.registrarChamada("ligacaoRecusar", computadorId, motivo);
    const p = this.banco.pedidos.get(computadorId);
    if (!p?.publica || p.entreguePor || p.recusado || computadorId === this.pc) return { ok: false };
    Object.assign(p, { recusado: motivo, envelope: null });
    return { ok: true };
  }

  async pegarPosse(contaId: string, motivo: MotivoPosse, segundos: number) {
    this.registrarChamada("pegarPosse", contaId, motivo, segundos);
    const b = this.banco;
    if (motivo === "uso" && b.atribuicao.get(this.pc)?.conta !== contaId) {
      return { ok: false, erro: "a nuvem não atribuiu esta conta a este computador", cofre: null };
    }
    if (motivo !== "uso" && [...b.atribuicao.entries()].some(([pc, a]) => pc !== this.pc && a.conta === contaId)) {
      return { ok: false, erro: "conta em uso por outro computador", cofre: null };
    }
    const dono = b.donoDaPosse(contaId);
    if (dono && dono !== this.pc) return { ok: false, erro: "conta com outro computador", cofre: null };
    b.posse.set(contaId, { pc: this.pc, motivo, expira: b.agora() + segundos });
    const c = b.contas.get(contaId);
    const cofre: CofreNuvem | null = c?.cofre ? { ...c.cofre } : null;
    return { ok: true, erro: null, cofre };
  }

  async devolverCofre(contaId: string, cifrado: Buffer, nonce: Buffer, versaoAnterior: number, expiraEm: string | null) {
    this.registrarChamada("devolverCofre", contaId, versaoAnterior);
    const b = this.banco;
    if (b.donoDaPosse(contaId) !== this.pc) return { ok: false, versao: null, erro: "sem posse da conta" };
    const c = b.contas.get(contaId)!;
    const atual = c.cofre?.versao ?? 0;
    if (atual !== versaoAnterior) return { ok: false, versao: atual, erro: "versão do cofre mudou" };
    c.cofre = { cifrado, nonce, versao: versaoAnterior + 1, expira_em: expiraEm };
    return { ok: true, versao: versaoAnterior + 1, erro: null };
  }

  async soltarPosse(contaId: string) {
    this.registrarChamada("soltarPosse", contaId);
    if (this.banco.posse.get(contaId)?.pc === this.pc) this.banco.posse.delete(contaId);
    return { ok: true };
  }

  async registrarConta(email: string, _o: string | null, _p: string | null, _n: string | null, cifrado: Buffer, nonce: Buffer, expiraEm: string | null) {
    this.registrarChamada("registrarConta", email);
    const b = this.banco;
    const c = b.conta(email.toLowerCase());
    const dono = b.donoDaPosse(c.id);
    if (dono && dono !== this.pc) return { ok: false, conta_id: null, versao: null, erro: "conta com outro computador agora" };
    const versao = (c.cofre?.versao ?? 0) + 1;
    c.cofre = { cifrado, nonce, versao, expira_em: expiraEm };
    return { ok: true, conta_id: c.id, versao, erro: null };
  }

  async relatarUso(janelas: JanelaNuvem[], _historico: PontoNuvem[]) {
    this.registrarChamada("relatarUso", janelas);
    for (const j of janelas) {
      const p = this.banco.posse.get(j.conta_id);
      if (p?.pc === this.pc && p.expira > this.banco.agora() - 60) this.banco.janelas.push({ ...j, pc: this.pc });
    }
    return { ok: true };
  }

  async relatarTokens(linhas: LinhaTokens[], sessoes: SessaoNuvem[]) {
    this.registrarChamada("relatarTokens", linhas.length, sessoes.length);
    for (const l of linhas) this.banco.tokens.set(`${l.hora}|${l.conta_id}|${this.pc}|${l.projeto}|${l.modelo}`, l);
    for (const s of sessoes) this.banco.sessoes.set(s.id, s);
    return { ok: true };
  }

  async limite(contaId: string, sessao: string | null) {
    this.registrarChamada("limite", contaId, sessao);
    const a = this.banco.atribuicao.get(this.pc);
    return { ok: true, trocou: a?.conta !== contaId, versao: a?.versao ?? null };
  }

  async reservarComando(id: number) {
    this.registrarChamada("reservarComando", id);
    const c = this.banco.comandos.find((x) => x.id === id && x.pc === this.pc && x.estado === "pendente");
    if (!c) return { ok: false, comando: null };
    c.estado = "reservado";
    return { ok: true, comando: { id: c.id, acao: c.acao, corpo: c.corpo } };
  }

  async responderComando(id: number, http: number, resposta: Record<string, unknown>) {
    this.registrarChamada("responderComando", id, http);
    const c = this.banco.comandos.find((x) => x.id === id && x.estado === "reservado");
    if (!c) return { ok: false };
    Object.assign(c, { estado: http >= 200 && http < 300 ? "feito" : "recusado", http, resposta });
    return { ok: true };
  }

  async evento(tipo: string, texto: string, dados: Record<string, unknown>) {
    this.registrarChamada("evento", tipo);
    if (!["troca", "aviso", "limite", "retomada", "conexao", "erro", "info", "alerta"].includes(tipo)) throw new Error("tipo inválido");
    this.banco.eventos.push({ tipo, texto, dados, pc: this.pc });
    return { ok: true };
  }

  async marcarLogin(contaId: string, precisa: boolean) {
    this.registrarChamada("marcarLogin", contaId, precisa);
    const b = this.banco;
    const naMao = b.donoDaPosse(contaId) === this.pc || b.atribuicao.get(this.pc)?.conta === contaId;
    const c = b.contas.get(contaId);
    if (!naMao || !c) return { ok: false };
    c.precisaLogin = precisa;
    return { ok: true };
  }

  async ligacaoPublicar(embrulho: Buffer, sal: Buffer) {
    this.registrarChamada("ligacaoPublicar");
    for (const l of this.banco.ligacoes) l.usada = true;
    this.banco.ligacoes.push({ embrulho, sal, por: this.pc, usada: false, expira: this.banco.agora() + 600 });
    return { ok: true, expira_em: new Date((this.banco.agora() + 600) * 1000).toISOString() };
  }

  async cofreImpressao(impressao: string | null) {
    this.registrarChamada("cofreImpressao");
    if (impressao && !this.banco.cofreImpressao) this.banco.cofreImpressao = impressao;
    return this.banco.cofreImpressao ?? null;
  }

  async ligacaoBuscar() {
    this.registrarChamada("ligacaoBuscar");
    const l = this.banco.ligacoes.find((x) => !x.usada && x.expira > this.banco.agora() && x.por !== this.pc);
    if (!l) return null;
    l.usada = true;
    return { embrulho: l.embrulho, sal: l.sal };
  }

  async horaDoServidor() {
    return this.banco.agora();
  }

  /** As mesmas regras do agente_vez_de_atualizar (0018; desde a 0020, nos dois jeitos ligados). */
  async vezDeAtualizar(de: string, para: string) {
    this.registrarChamada("vezDeAtualizar", de, para);
    const b = this.banco;
    if (modoAtualizar(b.config.atualizar_sozinho) === "desligada") return { pode: false, motivo: "desligado" };
    const v = b.vez;
    if (v?.estado === "falhou") return { pode: false, motivo: "falhou" };
    if (v?.estado === "em_andamento") {
      if (v.pc === this.pc) return { pode: false, motivo: "em_andamento" };
      if (b.versoes.get(v.pc) !== v.para) {
        if (b.agora() - v.desde <= 45 * 60) return { pode: false, motivo: "outro" };
        v.estado = "falhou";
        b.alertas.push({ texto: "não voltou na versão nova em 45 minutos", dados: { motivo: "atualizacao_falhou", computador: v.pc, para: v.para } });
        return { pode: false, motivo: "falhou" };
      }
    }
    b.vez = { pc: this.pc, de, para, desde: b.agora(), estado: "em_andamento" };
    return { pode: true, motivo: null };
  }

  /** O agente_migracoes (0020): nomes e resumos; nuvem antiga não tem a função (o PostgREST responde PGRST202). */
  async migracoesAplicadas() {
    this.registrarChamada("migracoesAplicadas");
    if (this.banco.semFuncaoMigracoes) throw new ErroNuvem("agente_migracoes: Could not find the function public.agente_migracoes", false, "PGRST202");
    return this.banco.migracoes ? { nomes: [...this.banco.migracoes], hashes: this.banco.hashesMigracoes ? { ...this.banco.hashesMigracoes } : null } : null;
  }

  async credenciaisGuardar(supabase: TokenNuvem, vercel: TokenNuvem, impressao: string) {
    this.registrarChamada("credenciaisGuardar", supabase, vercel, impressao);
    const b = this.banco;
    if (b.cofreImpressao !== impressao) throw new ErroNuvem("agente_credenciais_guardar: a chave do cofre deste computador não é a da instalação", false, "P0001");
    const em = new Date(b.agora() * 1000).toISOString();
    b.credenciais = { supabase: { ...supabase, gravadoEm: em }, vercel: { ...vercel, gravadoEm: em } };
    b.config.atualizacao_completa = { ligada: true, em, computador: this.pc };
    b.publicacaoVez = null;
    return { ok: true };
  }

  async credenciaisLer() {
    this.registrarChamada("credenciaisLer");
    const c = this.banco.credenciais;
    return { supabase: c.supabase ? { ...c.supabase } : null, vercel: c.vercel ? { ...c.vercel } : null };
  }

  async painelPublicacao() {
    this.registrarChamada("painelPublicacao");
    const p = this.banco.config.painel_publicacao as { projeto?: string; equipe?: string | null } | undefined;
    return p?.projeto ? { projeto: p.projeto, equipe: p.equipe ?? null } : null;
  }

  async credenciaisApagar() {
    this.registrarChamada("credenciaisApagar");
    this.banco.credenciais = {};
    this.banco.config.atualizacao_completa = { ligada: false, computador: this.pc };
    this.banco.publicacaoVez = null;
    return { ok: true };
  }

  /** As regras do agente_vez_de_publicar (0021). */
  async vezDePublicar(para: string) {
    this.registrarChamada("vezDePublicar", para);
    const b = this.banco;
    const nao = (motivo: string) => ({ pode: false, motivo, funcoes: false, painel: false });
    if (!b.credenciais.supabase || !b.credenciais.vercel) return nao("desligada");
    const p = pendenteDaPublicacao(b.config);
    if (p.versao !== para) return nao("nuvem");
    if (!p.funcoes && !p.painel) return nao("em_dia");
    const v = b.publicacaoVez;
    if (v && v.para === para && v.estado === "falhou") return nao("falhou");
    if (v && v.estado === "em_andamento" && v.pc !== this.pc) {
      if (b.agora() - v.desde <= 45 * 60) return nao("outro");
      v.estado = "falhou";
      return nao("falhou");
    }
    b.publicacaoVez = { pc: this.pc, para, estado: "em_andamento", desde: b.agora() };
    b.config.publicacao_vez = { computador: this.pc, para, estado: "em_andamento" };
    return { pode: true, motivo: null, funcoes: p.funcoes, painel: p.painel };
  }

  async resultadoPublicacao(para: string, estado: "concluida" | "falhou", motivo: string | null) {
    this.registrarChamada("resultadoPublicacao", para, estado, motivo);
    const b = this.banco;
    const v = b.publicacaoVez;
    if (!v || v.pc !== this.pc || v.para !== para || v.estado !== "em_andamento") return { ok: false };
    v.estado = estado;
    v.motivo = motivo;
    b.config.publicacao_vez = { computador: this.pc, para, estado, motivo };
    if (estado === "concluida") b.config.publicado = { funcoes: para, painel: para };
    else b.alertas.push({ texto: motivo ?? "", dados: { motivo: "atualizacao_falhou", parte: "publicacao", computador: this.pc, para } });
    return { ok: true };
  }

  async resultadoAtualizacao(para: string, estado: "concluida" | "falhou" | "nao_comecou", motivo: string | null) {
    this.registrarChamada("resultadoAtualizacao", para, estado, motivo);
    const b = this.banco;
    if (!b.vez || b.vez.pc !== this.pc || b.vez.para !== para || b.vez.estado !== "em_andamento") return { ok: false };
    if (estado === "nao_comecou") b.vez = null;
    else b.vez.estado = estado;
    if (estado === "falhou") b.alertas.push({ texto: motivo ?? "", dados: { motivo: "atualizacao_falhou", computador: this.pc, para } });
    return { ok: true };
  }
}

// ------------------------------------------------------------------------------------------------ agente montado

export interface Montado {
  agente: Agente;
  cred: CredenciaisFalsas;
  api: ApiFalsa;
  cli: CliFalsa;
  relogio: RelogioFalso;
  log: LogMemoria;
  guarda: GuardaFalsa;
  c: Caminhos;
  limpar: () => void;
}

export async function montar(
  opcoes: {
    nuvem?: Nuvem | null;
    sombra?: boolean;
    chave?: Buffer | null;
    cred?: CredenciaisFalsas;
    sistema?: Sistema;
    relogio?: RelogioFalso;
    exec?: Executor;
    diagnostico?: () => Promise<Record<string, unknown>>;
    consertar?: () => Promise<{ diagnostico: Record<string, unknown>; resumo: string; corrigidos?: number; naoDeu?: number }>;
    versoes?: import("../src/atualizar.js").FonteVersoes;
    /** O projeto do Supabase (do endereço da nuvem): sem ele, o agente não publica funções e painel. */
    refNuvem?: string | null;
  } = {},
): Promise<Montado> {
  const tmp = pastaTemporaria();
  const cred = opcoes.cred ?? new CredenciaisFalsas();
  const api = new ApiFalsa();
  const cli = new CliFalsa();
  const relogio = opcoes.relogio ?? new RelogioFalso();
  const log = new LogMemoria();
  const guarda = new GuardaFalsa();
  const chave = opcoes.chave === undefined ? novaChave() : opcoes.chave;
  if (chave) await guarda.gravar(SEGREDO_COFRE, chave.toString("base64"));
  const agente = new Agente({
    c: tmp.c,
    sistema: opcoes.sistema ?? "macos",
    cred,
    api,
    cli,
    relogio,
    log,
    guarda,
    nuvem: opcoes.nuvem ?? null,
    sombra: !!opcoes.sombra,
    porta: 0,
    sorteio: (xs) => xs[xs.length - 1]!,
    aleatorio: () => 0.5,
    exec: opcoes.exec,
    diagnostico: opcoes.diagnostico,
    consertar: opcoes.consertar,
    versoes: opcoes.versoes,
    node: "/falso/node",
    ambienteDoInstalador: { PATH: "/falso/bin" },
    refNuvem: opcoes.refNuvem ?? null,
  });
  await agente.iniciar({ laços: false, ponte: false });
  const limpar = () => {
    agente.parar();
    tmp.limpar();
  };
  return { agente, cred, api, cli, relogio, log, guarda, c: tmp.c, limpar };
}

/** Conta estacionada pronta: pasta, credencial guardada e leitura de uso. */
export function contaEstacionada(m: Montado, letra: string, pct = 10, opcoes: { contaId?: string } = {}): string {
  const t = m.agente.trocador;
  const pasta = t.novaPasta();
  fs.writeFileSync(path.join(pasta, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${letra.toLowerCase()}@exemplo.com` } }));
  const b = blob(letra + "1", true, 3600, m.relogio.agora());
  const perfil: Perfil = {
    accountUuid: `acc-${letra}`,
    email: `${letra.toLowerCase()}@exemplo.com`,
    orgUuid: `org-${letra}`,
    org: `Org ${letra}`,
    orgTipo: "x",
    tier: "default_max_5x",
  };
  const id = t.registrar(perfil, pasta, b);
  m.cred.d.set(pasta, b);
  Object.assign(m.agente.estado.contas[id]!, {
    janelas: [{ tipo: "five_hour", pct, resetEm: m.relogio.agora() + 3600 }],
    lidoEm: m.relogio.agora(),
    fonte: "api",
    contaId: opcoes.contaId ?? null,
  });
  return id;
}

/** A conta em uso: principal com o login dela, adotada pelo agente. */
export async function ativaEm(m: Montado, letra: string, pct: number, contaId?: string): Promise<string> {
  m.cred.d.set("principal", blob(letra + "1", true, 3600, m.relogio.agora()));
  const id = (await m.agente.trocador.conferirPrincipal())!;
  Object.assign(m.agente.estado.contas[id]!, {
    janelas: [{ tipo: "five_hour", pct, resetEm: m.relogio.agora() + 3600 }],
    lidoEm: m.relogio.agora(),
    fonte: "sessao",
    contaId: contaId ?? m.agente.estado.contas[id]!.contaId,
  });
  m.agente.estado.trocadaEm = 0;
  return id;
}
