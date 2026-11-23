// Trilhas (0.18.0): a empresa marcada "separar" no painel roda só com as contas marcadas para ela.
//
// Cada trilha é uma pasta de login própria (~/.reveza/trilhas/<empresa>), ao lado da principal. O lançador
// (~/.reveza/lancador/claude) pergunta à ponte de qual empresa é a pasta em que a sessão abre; quando é de uma empresa
// separada, ele abre o Claude Code com CLAUDE_SECURESTORAGE_CONFIG_DIR apontando para a trilha. Só o login muda de
// lugar: a configuração, as conversas e o resto ficam onde sempre ficaram. A nuvem escolhe a conta de cada trilha
// (agente_trilhas) entre as marcadas para a empresa e o transbordo dela; o agente põe o login na trilha com as mesmas
// regras da principal (Trocador.trocarTrilha):
// - nunca renovar pela cópia guardada de uma conta que está numa trilha (as sessões renovam lá; o token gira);
// - a conta que sai leva o login mais novo da trilha para a pasta dela e volta ao cofre depois da conferência;
// - os logins de MCP da principal não vão para a trilha (o token deles gira e a principal ficaria sem ele): na trilha, o
//   servidor MCP com login próprio pede para entrar uma vez.
// Sem empresa separada, nada disto roda e a ponte responde "principal" ao lançador.
//
// A empresa da sessão sai da mesma regra do painel (painel/src/lib/empresas.ts): a pasta é a raiz do git (ou a pasta do
// agente do OpenBot), relativa à pessoal; a regra de caminho mais comprida ganha, depois o nome de pasta mais fundo, e
// o título do agente do OpenBot cuja pasta a contém.

import * as fs from "node:fs";
import * as path from "node:path";
import { POSSE_S } from "./config.js";
import { hashToken } from "./credenciais/blob.js";
import type { Credenciais } from "./credenciais/tipos.js";
import type { ClaudeJson } from "./claudejson.js";
import type { EstadoLocal, TrilhaLocal } from "./estado.js";
import type { EmpresaSeparada, Nuvem, RegraEmpresa, TrilhaNuvem } from "./nuvem/tipos.js";
import type { PosseCofre } from "./posse.js";
import { ERRO_LOGIN_MORTO, type Trocador } from "./troca.js";
import type { Log } from "./util/log.js";
import type { Relogio } from "./util/tempo.js";

/** Sem processo vivo aberto pelo lançador, a trilha segue pedida por este tempo depois do último pedido. */
export const TRILHA_PEDIDA_S = 600;
/** As empresas e as regras são relidas da nuvem no máximo a cada minuto. */
export const EMPRESAS_LER_S = 60;
/**
 * Sem conseguir falar com a nuvem por este tempo, as empresas e as regras contam como vencidas: a última conhecida
 * CONTINUA valendo (decisão de 23/11/2026) e a resposta ao lançador diz que está vencida. Soltar a trilha e abrir na
 * principal seria pior: jogaria a sessão de uma empresa separada na conta compartilhada justamente durante uma falha
 * de rede, que é o contrário do que a separação existe para fazer. Quem desliga uma unidade no painel só passa a valer
 * naquele computador quando ele voltar a ler a nuvem.
 */
export const EMPRESAS_VENCIDAS_S = 600;
/** O lançador espera a conta de uma trilha nova por até este tempo. */
export const TRILHA_ESPERA_MS = 15_000;
/** O login que as sessões renovaram na trilha sobe ao cofre no máximo uma vez por este tempo. */
export const SUBIR_TRILHA_S = 60;
/** Sessão de trilha esquecida depois deste tempo sem notícia. */
export const SESSAO_TRILHA_S = 7 * 86400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O agente do OpenBot com a pasta como a nuvem guarda (relativa à pessoal). */
export interface AgentePasta {
  pasta: string;
  nome: string;
  titulo: string;
}

/** Caminho para comparar: barras normais, sem barra no fim, minúsculo (o mesmo do painel). */
export function normalizarPasta(p: string): string {
  const s = p.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const sem = s.length > 1 ? s.replace(/\/+$/, "") : s;
  return sem.toLowerCase();
}

/** A regra de pasta começa com ~, / ou a letra de um disco do Windows: é um caminho (prefixo). Sem isso, é um nome. */
export function ehCaminho(padrao: string): boolean {
  return /^([~/]|[A-Za-z]:(\/|\\|$))/.test(padrao.trim());
}

/**
 * A unidade da pasta (empresa ou projeto, já no formato da nuvem); null quando nenhuma regra pega ou quando a que vence
 * é de uma unidade fora da lista das ligadas (0.19.0: a pasta de um projeto desligado dentro de uma empresa ligada vai
 * pela conta do computador). A regra que vence é escolhida entre todas, e só depois se olha a lista.
 */
export function criarClassificador(empresas: EmpresaSeparada[], regras: RegraEmpresa[], agentes: AgentePasta[]): (pasta: string) => string | null {
  const existe = new Set(empresas.map((e) => e.id));
  const validas = regras;
  const prefixos = validas.filter((r) => r.tipo === "pasta" && ehCaminho(r.padrao)).map((r) => ({ base: normalizarPasta(r.padrao), empresa: r.empresa }));
  const nomes = validas
    .filter((r) => r.tipo === "pasta" && !ehCaminho(r.padrao))
    .map((r) => ({ nome: normalizarPasta(r.padrao).replace(/^\/+|\/+$/g, ""), empresa: r.empresa }))
    .filter((r) => r.nome);
  const titulos = validas
    .filter((r) => r.tipo === "titulo")
    .map((r) => ({ texto: r.padrao.trim().toLowerCase(), empresa: r.empresa }))
    .filter((r) => r.texto)
    .sort((a, b) => b.texto.length - a.texto.length);
  const pastasAgentes = new Map<string, { nome: string; titulo: string }>();
  for (const a of agentes) {
    const p = normalizarPasta(a.pasta);
    if (p && !pastasAgentes.has(p)) pastasAgentes.set(p, { nome: a.nome.toLowerCase(), titulo: a.titulo.toLowerCase() });
  }
  const dentro = (p: string, base: string) => p === base || (base === "/" ? p.startsWith("/") : p.startsWith(base + "/"));
  return (pasta) => {
    const p = normalizarPasta(pasta);
    if (!p) return null;
    let melhor: { nota: number; empresa: string } | null = null;
    const propor = (nota: number, empresa: string) => {
      if (!melhor || nota > melhor.nota) melhor = { nota, empresa };
    };
    for (const r of prefixos) if (dentro(p, r.base)) propor(r.base.length, r.empresa);
    const partes = p.split("/");
    for (const r of nomes) {
      for (let i = partes.length - 1; i >= 0; i--) {
        if (partes[i] !== r.nome) continue;
        propor(partes.slice(0, i + 1).join("/").length - 0.25, r.empresa);
        break;
      }
    }
    if (titulos.length) {
      let pastaAgente: string | null = null;
      for (const a of pastasAgentes.keys()) if (dentro(p, a) && (!pastaAgente || a.length > pastaAgente.length)) pastaAgente = a;
      if (pastaAgente) {
        const ag = pastasAgentes.get(pastaAgente)!;
        const r = titulos.find((x) => ag.titulo.includes(x.texto) || ag.nome.includes(x.texto));
        if (r) propor(pastaAgente.length - 0.5, r.empresa);
      }
    }
    const vence = (melhor as { empresa: string } | null)?.empresa ?? null;
    return vence && existe.has(vence) ? vence : null;
  };
}

export interface DepsTrilhas {
  estado: () => EstadoLocal;
  trocador: Trocador;
  posse: () => PosseCofre | null;
  cred: Credenciais;
  cj: ClaudeJson;
  nuvem: () => Nuvem | null;
  /** ~/.reveza/trilhas */
  pastaTrilhas: string;
  /** ~/.claude.json */
  claudeJson: string;
  relogio: Relogio;
  log: Log;
  salvar: () => void;
  sombra: boolean;
  /** A pasta da sessão como a nuvem guarda (a raiz do git ou a pasta do agente do OpenBot, relativa à pessoal). */
  pastaDe: (cwd: string) => string;
  /** Os agentes do OpenBot deste computador, com a pasta relativa à pessoal. */
  agentes: () => AgentePasta[];
  /** O processo ainda roda? */
  vivo: (pid: number) => boolean;
  /** Renova o login de uma pasta pelo assistente (conta que chega do cofre com o token vencido). */
  renovar: (pasta: string) => Promise<void>;
  /** A conta da trilha mudou: as sessões sem tela dela que pararam no limite voltam. */
  aoTrocar: (empresa: string) => void;
  /** O login da conta morreu: a nuvem fica sabendo e manda outra. */
  loginMorto: (id: string) => Promise<void>;
}

/** O que a ponte devolve ao lançador. `vencida`: a regra veio da última leitura, a nuvem não responde (fail-static). */
export type RespostaTrilha =
  | { ok: true; trilha: null; aviso?: string }
  | { ok: true; trilha: { empresa: string; nome: string; pasta: string }; vencida?: true };

export class Trilhas {
  private empresas: EmpresaSeparada[] = [];
  private regras: RegraEmpresa[] = [];
  private lidasEm = 0;
  private classificar: ((pasta: string) => string | null) | null = null;
  private agentesVistos: AgentePasta[] | null = null;
  /** A nuvem disse que há empresa separada (agente_ola). */
  ligadas = false;
  private emVoo: Promise<void> | null = null;
  private falhas = new Map<string, number>();
  private subidas = new Map<string, { hash: string | null; em: number }>();
  private faria = new Set<string>();
  private oauthAvisado = false;
  private avisadoSemConta = new Map<string, number>();
  private avisadoVencida = new Map<string, number>();

  constructor(private d: DepsTrilhas) {}

  private get trilhas(): Record<string, TrilhaLocal> {
    return (this.d.estado().trilhas ??= {});
  }

  private agora(): number {
    return this.d.relogio.agora();
  }

  /** A trilha da empresa, criada vazia na primeira vez. */
  trilha(empresa: string, nome?: string): TrilhaLocal {
    const t = (this.trilhas[empresa] ??= {
      empresa,
      nome: nome ?? "empresa",
      pasta: path.join(this.d.pastaTrilhas, empresa),
      conta: null,
      versao: 0,
      versaoNuvem: 0,
      trocadaEm: 0,
      linha: [],
      pids: [],
      pedidaEm: 0,
    });
    if (nome) t.nome = nome;
    return t;
  }

  /** As empresas e as regras, relidas da nuvem no máximo a cada minuto (ou já, com `forcar`). */
  private async lerEmpresas(forcar = false): Promise<void> {
    const nuvem = this.d.nuvem();
    if (!nuvem || (!forcar && this.agora() - this.lidasEm < EMPRESAS_LER_S)) return;
    const r = await nuvem.empresas();
    this.lidasEm = this.agora();
    this.empresas = r.empresas;
    this.regras = r.regras;
    this.classificar = null;
    for (const e of r.empresas) if (this.trilhas[e.id]) this.trilhas[e.id]!.nome = e.nome;
  }

  /** A última leitura das empresas e das regras passou do prazo (a nuvem não responde): valem assim mesmo. */
  private vencidas(): boolean {
    return this.lidasEm > 0 && this.agora() - this.lidasEm > EMPRESAS_VENCIDAS_S;
  }

  /** A empresa separada da pasta em que a sessão abre, ou null. */
  empresaDe(cwd: string): EmpresaSeparada | null {
    const agentes = this.d.agentes();
    if (!this.classificar || agentes !== this.agentesVistos) {
      this.agentesVistos = agentes;
      this.classificar = criarClassificador(this.empresas, this.regras, agentes);
    }
    const id = this.classificar(this.d.pastaDe(cwd));
    return id ? (this.empresas.find((e) => e.id === id) ?? null) : null;
  }

  /**
   * O lançador pergunta antes de abrir o Claude Code: em qual trilha a sessão roda. Anota o processo (o lançador troca
   * de programa sem mudar de número) para a trilha seguir pedida enquanto ele viver. Trilha sem conta ainda: espera a
   * nuvem decidir, por até 15 s; sem conta mesmo assim, a sessão abre na principal e o painel recebe um aviso.
   */
  async pedir(cwd: string, pid: number | null): Promise<RespostaTrilha> {
    if (!this.d.nuvem() || (!this.ligadas && !Object.values(this.trilhas).some((t) => t.conta))) return { ok: true, trilha: null };
    try {
      await this.lerEmpresas(this.lidasEm === 0);
    } catch (e) {
      this.d.log.erro(`ler as empresas separadas: ${(e as Error).message}`);
    }
    const emp = this.empresaDe(cwd);
    if (!emp) return { ok: true, trilha: null };
    const t = this.trilha(emp.id, emp.nome);
    if (pid !== null && Number.isInteger(pid) && pid > 1 && !t.pids.includes(pid)) {
      t.pids.push(pid);
      t.pids.splice(0, Math.max(0, t.pids.length - 200));
    }
    t.pedidaEm = this.agora();
    this.d.salvar();
    if (!t.conta) {
      let fim: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.busca().catch(() => undefined),
        new Promise<void>((ok) => {
          fim = setTimeout(ok, TRILHA_ESPERA_MS);
        }),
      ]);
      if (fim) clearTimeout(fim);
    }
    if (!t.conta) {
      // decisão de 21/11 (DECISAO.md): sem conta para a empresa agora, a sessão abre na principal e o painel avisa;
      // travar o lançador pararia o trabalho por uma falta que a nuvem costuma resolver em minutos
      const aviso = `${emp.nome}: nenhuma conta livre para a empresa agora; a sessão abriu na conta em uso deste computador (veja no painel as contas marcadas para ela e o transbordo).`;
      // o processo fica na principal até o fim: não segura a conta que a trilha receber depois
      t.pids = t.pids.filter((p) => p !== pid);
      if ((this.avisadoSemConta.get(emp.id) ?? 0) <= this.agora()) {
        this.avisadoSemConta.set(emp.id, this.agora() + TRILHA_PEDIDA_S);
        this.d.trocador.evento("aviso", aviso, { empresa: emp.id });
      }
      return { ok: true, trilha: null, aviso };
    }
    if (this.vencidas()) {
      if ((this.avisadoVencida.get(emp.id) ?? 0) <= this.agora()) {
        this.avisadoVencida.set(emp.id, this.agora() + EMPRESAS_VENCIDAS_S);
        this.d.log.info(
          `${emp.nome}: a nuvem não responde há mais de ${Math.round(EMPRESAS_VENCIDAS_S / 60)} min; a sessão abriu pela última regra conhecida.`,
        );
      }
      return { ok: true, trilha: { empresa: emp.id, nome: emp.nome, pasta: t.pasta }, vencida: true };
    }
    return { ok: true, trilha: { empresa: emp.id, nome: emp.nome, pasta: t.pasta } };
  }

  /** A trilha de uma sessão, pelo REVEZA_TRILHA que o mod manda; null quando não é de trilha conhecida. */
  daSessao(corpo: Record<string, unknown>): TrilhaLocal | null {
    const e = corpo.trilha;
    if (typeof e !== "string" || !UUID.test(e)) return null;
    const t = this.trilhas[e];
    if (!t) return null;
    const sessao = corpo.sessao;
    if (typeof sessao === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(sessao)) {
      const marcas = (this.d.estado().sessoesTrilha ??= {});
      if (marcas[sessao]?.empresa !== e) {
        marcas[sessao] = { empresa: e, em: this.agora() };
        this.d.salvar();
      } else marcas[sessao].em = this.agora();
    }
    return t;
  }

  /** Uma busca por vez: a do ciclo e a do lançador esperam a mesma. */
  busca(): Promise<void> {
    if (!this.emVoo) {
      this.emVoo = this.buscaDentro().finally(() => {
        this.emVoo = null;
      });
    }
    return this.emVoo;
  }

  /** As trilhas que têm sessão: processo do lançador vivo, pedido há menos de 10 min, ou sessão sem tela na fila. */
  private pedidas(): TrilhaLocal[] {
    const t0 = this.agora();
    const naFila = new Set(this.d.estado().fila.filter((f) => f.trilha && f.estado === "aguardando").map((f) => f.trilha!));
    const r: TrilhaLocal[] = [];
    for (const t of Object.values(this.trilhas)) {
      t.pids = t.pids.filter((p) => this.d.vivo(p));
      if (t.pids.length || t0 - t.pedidaEm < TRILHA_PEDIDA_S || naFila.has(t.empresa)) r.push(t);
    }
    return r.slice(0, 50);
  }

  /**
   * A marca ~/.reveza/trilhas/ligadas: o lançador só pergunta ao agente quando ela existe (sem empresa separada, ele não
   * gasta nada). Some quando o painel desliga todas e nenhuma trilha daqui tem conta.
   */
  private marcar(ligada: boolean): void {
    if (this.d.sombra) return;
    const marca = path.join(this.d.pastaTrilhas, "ligadas");
    try {
      if (ligada && !fs.existsSync(marca)) {
        fs.mkdirSync(this.d.pastaTrilhas, { recursive: true, mode: 0o700 });
        fs.writeFileSync(marca, "o painel tem empresa separada: o lançador ~/.reveza/lancador/claude pergunta a trilha ao agente\n", { mode: 0o600 });
      } else if (!ligada && fs.existsSync(marca)) fs.unlinkSync(marca);
    } catch (e) {
      this.d.log.erro(`marca das trilhas: ${(e as Error).message}`);
    }
  }

  private async buscaDentro(): Promise<void> {
    const nuvem = this.d.nuvem();
    const posse = this.d.posse();
    if (!nuvem || !posse) return;
    const locais = Object.values(this.trilhas);
    this.marcar(this.ligadas || locais.some((t) => t.conta));
    if (!this.ligadas && !locais.length) return;
    if (this.ligadas) await this.lerEmpresas();
    const pedidas = this.pedidas();
    if (!pedidas.length && !locais.some((t) => t.conta)) {
      this.limparSessoes();
      return;
    }
    const r = await nuvem.trilhas(pedidas.map((t) => t.empresa));
    if (!r.ok) return;
    const daNuvem = new Map(r.trilhas.map((x) => [x.empresa, x]));
    // primeiro as que a nuvem soltou: a conta delas pode ser a que outra trilha recebe agora
    for (const t of locais) {
      const x = daNuvem.get(t.empresa);
      if (t.conta && !x) {
        const saiu = await this.d.trocador.liberarTrilha(t, "nenhuma sessão dela há 10 minutos, ou a nuvem tirou a conta");
        if (saiu) posse.soltarDepois.set(saiu, this.agora() + 20);
      }
    }
    for (const x of r.trilhas) {
      const nome = this.empresas.find((e) => e.id === x.empresa)?.nome;
      await this.aplicar(this.trilha(x.empresa, nome), x);
    }
    await this.subirRenovadas();
    await this.guardarOauthAccount();
    this.limparSessoes();
  }

  /** Põe na trilha a conta que a nuvem escolheu para ela. */
  private async aplicar(t: TrilhaLocal, x: TrilhaNuvem): Promise<void> {
    const posse = this.d.posse()!;
    const nuvem = this.d.nuvem()!;
    const est = this.d.estado();
    const destino = posse.porContaId(x.conta_id);
    if (destino && destino === t.conta) {
      t.versaoNuvem = Math.max(t.versaoNuvem, x.versao);
      if (posse.posses.get(destino) === "uso") return; // a nuvem renovou a posse de uso dela agora (agente_trilhas)
      // Depois de o agente religar, a posse dela não está mais na mão (o mapa vive na memória): sem posse na nuvem, o
      // login que as sessões da empresa renovam não subiria ao cofre, e a próxima máquina pegaria um login morto. Retoma a
      // posse de uso; o cofre que volta não é aplicado (o login vivo é o da trilha).
      if (this.d.sombra || (this.falhas.get(`posse#${destino}`) ?? 0) > this.agora()) return;
      const r = await nuvem.pegarPosse(x.conta_id, "uso", POSSE_S);
      if (r.ok) {
        posse.posses.set(destino, "uso");
        this.falhas.delete(`posse#${destino}`);
      } else {
        this.falhas.set(`posse#${destino}`, this.agora() + 60);
        this.d.log.info(`a posse da conta da trilha de ${t.nome} não voltou: ${r.erro ?? "sem motivo"}; tento de novo em 1 min`);
      }
      return;
    }
    const chave = `${t.empresa}#${x.conta_id}#${x.versao}`;
    if (this.d.sombra) {
      if (!this.faria.has(chave)) {
        this.faria.add(chave);
        this.d.log.faria(`pôr ${x.email ?? x.conta_id} na trilha de ${t.nome} (${x.motivo || "decisão da nuvem"})`);
      }
      return;
    }
    if ((this.falhas.get(chave) ?? 0) > this.agora()) return;
    // a principal (ou outra trilha daqui) ainda está nela: espera a troca de lá, na busca seguinte
    if (destino && (destino === est.ativa || this.d.trocador.trilhaDe(destino))) return;
    const r = await nuvem.pegarPosse(x.conta_id, "uso", POSSE_S);
    if (!r.ok) {
      this.d.log.info(`a conta da trilha de ${t.nome} (${x.email ?? x.conta_id}) não veio: ${r.erro ?? "sem motivo"}; espero a nuvem`);
      this.falhas.set(chave, this.agora() + 60);
      return;
    }
    let id = destino;
    if (!id) {
      id = await posse.materializar(x.conta_id, x.email, r.cofre, this.d.renovar);
      if (!id) {
        await nuvem.soltarPosse(x.conta_id).catch(() => undefined);
        this.d.trocador.evento("erro", `${t.nome}: o login da conta escolhida para a empresa não abriu do cofre; entre de novo nela pelo painel.`, { empresa: t.empresa });
        this.falhas.set(chave, this.agora() + 60);
        return;
      }
    } else {
      await posse.sincronizar(id, r.cofre);
    }
    const ja = posse.posses.get(id);
    posse.posses.set(id, "uso");
    const res = await this.d.trocador.trocarTrilha(t, id, x.motivo || "decisão da nuvem");
    if (!res.ok) {
      this.falhas.set(chave, this.agora() + 60);
      if (res.erro === ERRO_LOGIN_MORTO) await this.d.loginMorto(id).catch(() => undefined);
      if (ja !== "uso") {
        await posse.devolver(id).catch(() => false);
        await posse.soltar(id).catch(() => undefined);
      }
      return;
    }
    this.falhas.delete(chave);
    t.versaoNuvem = x.versao;
    // a que saiu volta ao cofre depois da conferência da troca (5 s, até 3 refeitas)
    if (res.de && res.de !== id) posse.soltarDepois.set(res.de, this.agora() + 20);
    this.subidas.set(t.empresa, { hash: hashToken(await this.d.cred.ler(t.pasta).catch(() => null)), em: this.agora() });
    this.d.salvar();
    this.d.aoTrocar(t.empresa);
  }

  /** As sessões renovaram o login numa trilha: a cópia nova sobe ao cofre (no máximo uma vez por minuto). */
  private async subirRenovadas(): Promise<void> {
    const posse = this.d.posse()!;
    for (const t of Object.values(this.trilhas)) {
      if (!t.conta || posse.posses.get(t.conta) !== "uso") continue;
      const antes = this.subidas.get(t.empresa);
      if (antes && this.agora() - antes.em < SUBIR_TRILHA_S) continue;
      const h = hashToken(await this.d.cred.ler(t.pasta).catch(() => null));
      if (!h || h === antes?.hash) continue;
      if (await posse.devolver(t.conta).catch(() => false)) this.subidas.set(t.empresa, { hash: h, em: this.agora() });
    }
  }

  /**
   * O assistente relê o perfil da conta a cada 24 h e grava o `oauthAccount` no ~/.claude.json, que todas as sessões
   * dividem. Uma sessão de trilha grava ali a conta da empresa: ele volta a ser o da conta em uso na principal, com a
   * leitura marcada como de agora (para ninguém reler logo e gravar de novo). Só desfaz o que veio de uma trilha daqui.
   */
  private async guardarOauthAccount(): Promise<void> {
    const est = this.d.estado();
    const daTrilha = Object.values(this.trilhas)
      .map((t) => (t.conta ? est.contas[t.conta] : undefined))
      .filter((c) => !!c?.accountUuid);
    const ativa = est.ativa ? est.contas[est.ativa] : undefined;
    if (!daTrilha.length || !ativa?.accountUuid) return;
    const o = this.d.cj.lerConta(this.d.claudeJson);
    if (!o || (o.accountUuid === ativa.accountUuid && o.organizationUuid === ativa.orgUuid)) return;
    if (!daTrilha.some((c) => c!.accountUuid === o.accountUuid && c!.orgUuid === o.organizationUuid)) return;
    const certa = this.d.cj.lerConta(path.join(ativa.pasta, ".claude.json"));
    if (!certa || certa.accountUuid !== ativa.accountUuid) return;
    if (this.d.sombra) {
      this.d.log.faria(`devolver o oauthAccount de ${ativa.email} ao .claude.json`);
      return;
    }
    await this.d.cj.gravarConta(this.d.claudeJson, { ...certa, profileFetchedAt: this.d.relogio.agoraMs() });
    if (!this.oauthAvisado) {
      this.oauthAvisado = true;
      this.d.log.info(`uma sessão de trilha gravou a conta dela no .claude.json; voltei para ${ativa.email}`);
    }
  }

  /** Esquece as sessões de trilha antigas (o contador e a ponte só precisam das recentes). */
  private limparSessoes(): void {
    const marcas = this.d.estado().sessoesTrilha;
    if (!marcas) return;
    const t0 = this.agora();
    const vivas = Object.entries(marcas).filter(([, m]) => t0 - m.em < SESSAO_TRILHA_S && this.trilhas[m.empresa]);
    if (vivas.length === Object.keys(marcas).length && vivas.length <= 500) return;
    vivas.sort((a, b) => b[1].em - a[1].em);
    this.d.estado().sessoesTrilha = Object.fromEntries(vivas.slice(0, 500));
  }

  /** As trilhas deste computador para o `reveza status` e a ponte (sem login nem token). */
  publico(): Record<string, unknown>[] {
    const est = this.d.estado();
    return Object.values(this.trilhas).map((t) => ({
      empresa: t.empresa,
      nome: t.nome,
      conta: t.conta,
      email: t.conta ? (est.contas[t.conta]?.email ?? null) : null,
      versao: t.versao,
      trocadaEm: t.trocadaEm,
      processos: t.pids.length,
    }));
  }

  /** O que a ponte devolve ao mod de uma sessão de trilha (no lugar da conta em uso na principal). */
  ativa(t: TrilhaLocal): Record<string, unknown> {
    const c = t.conta ? this.d.estado().contas[t.conta] : undefined;
    return { slug: t.conta, email: c?.email ?? null, versao: t.versao, trocadaEm: t.trocadaEm, trilha: t.empresa };
  }

  /** O uso que uma sessão de trilha mediu entra na conta da trilha (nunca na da principal). */
  medida(t: TrilhaLocal, corpo: Record<string, unknown>): boolean {
    if (!t.conta || this.agora() - t.trocadaEm < 30) return false;
    const v = corpo.versao;
    if (v !== null && v !== undefined && v !== t.versao) return false;
    const conta = this.d.trocador.contaDoCorpo(corpo);
    if (conta && conta !== t.conta) return false;
    return this.d.trocador.medidaNaConta(t.conta, corpo);
  }

  /**
   * Uma sessão de trilha bateu o limite (ou a conta dela não roda o modelo): entra na fila da trilha e, no limite, a
   * conta dela fica cheia e a nuvem troca a conta da trilha (agente_limite). Devolve o que a ponte responde ao mod e se
   * a nuvem precisa saber.
   */
  limite(t: TrilhaLocal, corpo: Record<string, unknown>): { resposta: Record<string, unknown>; avisar: string | null } {
    const est = this.d.estado();
    const sessao = String(corpo.sessao ?? "").slice(0, 80);
    const modelo = corpo.erro === "modelo";
    const item = this.d.trocador.enfileirar(corpo, sessao, t);
    const v = corpo.versao;
    if (typeof v === "number" && Number.isInteger(v) && v < t.versao) {
      // a trilha já trocou de conta depois que a sessão mandou o pedido
      return { resposta: { ok: true, versao: t.versao, trocou: true }, avisar: null };
    }
    const conta = this.d.trocador.contaDoCorpo(corpo);
    if (conta && conta !== t.conta && est.contas[conta]) {
      // a sessão ainda estava na conta que saiu da trilha: ela relê o login e volta na de agora
      if (!modelo) this.d.trocador.encherCinco(est.contas[conta]!);
      return { resposta: { ok: true, versao: t.versao, trocou: true, aguardarS: 35 }, avisar: null };
    }
    if (modelo || !t.conta || !est.contas[t.conta]) {
      // sem troca por modelo na trilha: em 2 minutos a sessão segue no modelo padrão (o mod cuida)
      return { resposta: { ok: true, versao: t.versao, trocou: false }, avisar: null };
    }
    const c = est.contas[t.conta]!;
    this.d.trocador.encherCinco(c);
    const volta = c.janelas
      .filter((j) => (j.tipo === "five_hour" || j.tipo === "seven_day") && (j.pct ?? 0) >= 100 && j.resetEm)
      .reduce<number | null>((m, j) => Math.max(m ?? 0, j.resetEm!), null);
    if (item && volta !== null) item.voltaEm = volta;
    this.d.trocador.evento("limite", `${t.nome}: uma sessão bateu o limite em ${c.email}.`, { conta: t.conta, sessao, empresa: t.empresa });
    return { resposta: { ok: true, versao: t.versao, trocou: false }, avisar: c.contaId ?? null };
  }
}
