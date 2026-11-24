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
/** Teto de cada leitura e da confirmação da trava no pedido do lançador: somados à espera, ficam abaixo dos 20 s da ponte. */
const PEDIR_LEITURA_MS = 4_000;
const PEDIR_TRAVA_MS = 3_000;
/** A nuvem segura a conta por 3 min a cada aviso: a confirmação vale um pouco menos aqui. */
const TRAVA_CONFIRMADA_S = 150;
/** A pergunta de novo da espera aproveita a busca na nuvem que terminou há menos que isto (plano B versão 2, regra 5). */
const BUSCA_RECENTE_S = 10;
/** A chamada à trava da conta em uso que não volta segura a próxima até isto (a fila das chamadas, regra 5). */
const FILA_TRAVA_MS = 20_000;
const TRAVA_PEDIDA_S = 120;
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
  /** A última leitura dos agentes do OpenBot falhou (vale a lista anterior, que pode estar velha). */
  agentesFalhou?: () => boolean;
  /** O processo ainda roda? */
  vivo: (pid: number) => boolean;
  /** Renova o login de uma pasta pelo assistente (conta que chega do cofre com o token vencido). */
  renovar: (pasta: string) => Promise<void>;
  /** A conta da trilha mudou: as sessões sem tela dela que pararam no limite voltam. */
  aoTrocar: (empresa: string) => void;
  /** O login da conta morreu: a nuvem fica sabendo e manda outra. */
  loginMorto: (id: string) => Promise<void>;
  /** A conta que a nuvem atribuiu à principal (o id dela lá), que pode ser mais nova que a conta em uso aqui. */
  atribuida?: () => string | null | undefined;
  /** A hora em que um processo começou, ou null. */
  inicioDoProcesso?: (pid: number) => string | null;
}

/** Para onde volta uma sessão retomada: a trilha, o login da principal (com a trava) ou a fila. */
export type DestinoRetomada =
  | { espera: true; empresa?: string }
  | { trilha?: { pasta: string; empresa: string }; principalDe?: string };

/**
 * O que a ponte devolve ao lançador. `vencida`: a regra veio da última leitura, a nuvem não responde (fail-static).
 * `certa` (plano B versão 2, só na pergunta de novo): a sessão que esperava pode abrir na principal, porque o agente sabe
 * que é ela; sem a marca, o lançador segue esperando.
 */
export type RespostaTrilha =
  | { ok: true; trilha: null; aviso?: string; bloqueio?: string; certa?: true }
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
  private guardadasLidas = false;
  private pidsConferidos = false;
  /** Unidades com sessão para retomar no login da principal: a trava vem antes de o processo abrir. */
  private travaPedida = new Map<string, number>();
  /** O que a nuvem confirmou por último: até quando, e em qual conta local. */
  private confirmadas = new Map<string, { ate: number; conta: string | null }>();
  /** Este agente pediu à nuvem para segurar a conta em uso e ainda não soltou (plano B versão 2, regra 4). */
  private seguraNaNuvem = false;
  /** Quando terminou a última busca na nuvem (plano B versão 2, regra 5). */
  private buscaFimEm = 0;
  /** A chamada à trava da conta em uso que está em voo: a próxima espera ela terminar. */
  private filaTrava: Promise<unknown> = Promise.resolve();

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
      nome: nome ?? "projeto",
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
    const est = this.d.estado();
    const guardar = { empresas: r.empresas, regras: r.regras };
    if (JSON.stringify(est.regrasEmpresas ?? null) !== JSON.stringify(guardar)) {
      est.regrasEmpresas = guardar;
      this.d.salvar();
    }
  }

  /** Depois de religar: as últimas regras lidas valem até a nuvem responder. */
  private carregarGuardadas(): void {
    if (this.guardadasLidas) return;
    this.guardadasLidas = true;
    const g = this.d.estado().regrasEmpresas;
    if (!g || this.lidasEm !== 0) return;
    this.empresas = Array.isArray(g.empresas) ? g.empresas : [];
    this.regras = Array.isArray(g.regras) ? g.regras : [];
    this.classificar = null;
  }

  /** Espera a promessa até o prazo; passou, segue sem ela (e o erro tardio dela não derruba o agente). */
  private async noPrazo<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
    p.catch(() => undefined);
    let fim: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<undefined>((ok) => {
          fim = setTimeout(() => ok(undefined), ms);
        }),
      ]);
    } finally {
      if (fim) clearTimeout(fim);
    }
  }

  /** A última leitura das empresas e das regras passou do prazo (a nuvem não responde): valem assim mesmo. */
  private vencidas(): boolean {
    return this.lidasEm > 0 && this.agora() - this.lidasEm > EMPRESAS_VENCIDAS_S;
  }

  /**
   * Plano B versão 2 (regra 1): a sessão que espera a conta do projeto só sai pela principal quando o agente sabe que
   * é ela. As regras vieram da nuvem há pouco (não só do disco, depois de religar) e a lista dos agentes do OpenBot foi
   * lida sem erro (a regra pelo título depende dela). Sem isso, o lançador segue esperando: abrir na conta
   * compartilhada a sessão de um projeto que só usa as contas dele é o erro que a separação existe para evitar.
   */
  private certeza(): boolean {
    return !!this.d.nuvem() && this.lidasEm > 0 && this.agora() - this.lidasEm <= 2 * EMPRESAS_LER_S && !this.d.agentesFalhou?.();
  }

  /** A resposta "abre na principal"; na pergunta de novo, com a marca de certeza quando o agente a tem. */
  private naPrincipalCom(deNovo: boolean, aviso?: string): RespostaTrilha {
    const certa = deNovo && this.certeza();
    if (aviso) return certa ? { ok: true, trilha: null, aviso, certa: true } : { ok: true, trilha: null, aviso };
    return certa ? { ok: true, trilha: null, certa: true } : { ok: true, trilha: null };
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
   *
   * `deNovo` (plano B, 0.21.0): a pergunta que o lançador repete a cada 15 s enquanto espera a conta do projeto. Ela não
   * regrava o estado antes da busca (só a hora do pedido mudou, e o ciclo do agente grava); grava só quando a sessão
   * abre na trilha, para o processo dela estar no disco numa queda.
   *
   * Plano B versão 2 (regra 1): a resposta sem trilha da pergunta de novo só tira a sessão da espera com a marca
   * `certa` (veja `certeza`). Por isso ela não sai pelo atalho do começo: o projeto desligado durante a espera também
   * desliga a separação, e o atalho responderia sem ler as regras.
   */
  async pedir(cwd: string, pid: number | null, opcoes: { deNovo?: boolean } = {}): Promise<RespostaTrilha> {
    this.carregarGuardadas();
    const deNovo = opcoes.deNovo === true;
    const conhecida = this.empresas.some((e) => e.estrita);
    if (!this.d.nuvem() || (!deNovo && !this.ligadas && !conhecida && !Object.values(this.trilhas).some((t) => t.conta))) {
      return { ok: true, trilha: null };
    }
    // a ponte espera 20 s: tudo aqui fecha antes, para a sessão ser recusada em vez de abrir em outra conta sem resposta
    const inicio = Date.now();
    try {
      await this.noPrazo(this.lerEmpresas(this.lidasEm === 0), PEDIR_LEITURA_MS);
    } catch (e) {
      this.d.log.erro(`ler os projetos separados: ${(e as Error).message}`);
    }
    const emp = this.empresaDe(cwd);
    if (!emp) return this.naPrincipalCom(deNovo);
    // no modo sombra o agente só registra: a regra das contas não impede sessão nenhuma de abrir
    const estrita = emp.estrita === true && !this.d.sombra;
    const t = this.trilha(emp.id, emp.nome);
    // a conta saiu da lista e a sessão antiga segue nela até fechar: sessão nova não entra, e a trilha não se renova
    if (estrita && t.conta && !(await this.contaAindaServe(emp, t.conta))) return this.bloquear(emp);
    let novo = false;
    if (pid !== null && Number.isInteger(pid) && pid > 1 && !t.pids.includes(pid)) {
      t.pids.push(pid);
      t.pids.splice(0, Math.max(0, t.pids.length - 200));
      novo = true;
    }
    t.pedidaEm = this.agora();
    if (!deNovo) this.d.salvar();
    if (!t.conta) {
      // a busca em voo pode ter lido as trilhas antes deste pedido: sem conta depois dela, uma segunda já o leva
      const havia = this.emVoo !== null;
      // plano B versão 2 (regra 5): a pergunta de novo vem a cada 15 s com a trilha já pedida, e a busca em voo ou a de
      // menos de 10 s já levou o pedido à nuvem
      const recente = deNovo && !havia && this.agora() - this.buscaFimEm < BUSCA_RECENTE_S;
      let fim: ReturnType<typeof setTimeout> | undefined;
      if (!recente) {
        await Promise.race([
          (async () => {
            await this.busca().catch(() => undefined);
            if (havia && !deNovo && !t.conta) await this.busca().catch(() => undefined);
          })(),
          new Promise<void>((ok) => {
            fim = setTimeout(ok, Math.max(0, TRILHA_ESPERA_MS - (Date.now() - inicio)));
          }),
        ]);
      }
      if (fim) clearTimeout(fim);
      // a nuvem pode devolver a conta antiga, que saiu da lista e ainda não soltou: sessão nova não entra nela
      if (estrita && t.conta && !(await this.contaAindaServe(emp, t.conta, PEDIR_TRAVA_MS))) {
        t.pids = t.pids.filter((p) => p !== pid);
        this.d.salvar();
        return this.bloquear(emp);
      }
    }
    if (!t.conta && estrita) {
      // sem outra conta para a principal, a conta dela fica lá: a sessão abre nesse login, que já é o certo
      t.pids = t.pids.filter((p) => p !== pid);
      if (this.principalServe(emp.id) && deNovo) {
        // plano B versão 2 (regras 1 e 5): na pergunta de novo, só a trava confirmada tira da espera, e só ela anota o
        // processo (e grava). Recusada, ou sem resposta a tempo, nada muda: a próxima pergunta vem em 15 s. A unidade
        // entra na trava pedida antes da chamada: a renovação do ciclo que rodar junto também a leva, e a nuvem, que
        // guarda a última lista que chega, não perde a trava
        const tinha = this.travaPedida.has(emp.id);
        if (!tinha) this.travaPedida.set(emp.id, this.agora() + TRAVA_PEDIDA_S);
        let certa = false;
        try {
          const seguras = await this.noPrazo(this.segurarPrincipal(), PEDIR_TRAVA_MS);
          certa = !!seguras?.includes(emp.id);
          if (certa && pid !== null) this.anotarPrincipal(emp.id, pid);
        } finally {
          if (!tinha) this.travaPedida.delete(emp.id);
        }
        if (certa) return { ok: true, trilha: null, certa: true };
      } else if (this.principalServe(emp.id)) {
        // a sessão vai seguir este login: a nuvem precisa confirmar antes, para a principal não trocar com ela aberta
        if (pid !== null) this.anotarPrincipal(emp.id, pid);
        const seguras = await this.noPrazo(this.segurarPrincipal(), PEDIR_TRAVA_MS);
        // a nuvem confirmou a trava: a conta em uso não troca com a sessão aberta
        if (seguras?.includes(emp.id)) return { ok: true, trilha: null };
        // nuvem fora (null) no primeiro pedido: nenhuma troca chega aqui. Disse que não, ou não respondeu a tempo: não dá
        // para garantir a conta
        if (seguras === null) return { ok: true, trilha: null };
        t.pidsPrincipal = (t.pidsPrincipal ?? []).filter((p) => p !== pid);
        this.d.salvar();
      }
      // só as contas dela: não abre em outra. A trilha segue pedida, e a nuvem dá a conta assim que ela soltar.
      return this.bloquear(emp);
    }
    if (!t.conta) {
      // decisão de 21/11 (DECISAO.md): sem conta para a empresa agora, a sessão abre na principal e o painel avisa;
      // travar o lançador pararia o trabalho por uma falta que a nuvem costuma resolver em minutos
      const aviso = `${emp.nome}: nenhuma conta livre para o projeto agora; a sessão abriu na conta em uso deste computador (veja no painel as contas marcadas para ele e o transbordo).`;
      // o processo fica na principal até o fim: não segura a conta que a trilha receber depois
      t.pids = t.pids.filter((p) => p !== pid);
      if ((this.avisadoSemConta.get(emp.id) ?? 0) <= this.agora()) {
        this.avisadoSemConta.set(emp.id, this.agora() + TRILHA_PEDIDA_S);
        this.d.trocador.evento("aviso", aviso, { empresa: emp.id });
      }
      // na pergunta de novo, o projeto deixou de usar só as contas dele durante a espera
      return this.naPrincipalCom(deNovo, aviso);
    }
    // a sessão abre na trilha: o processo dela vai ao disco, senão numa queda a trilha soltaria a conta com ela aberta
    if (deNovo && novo) this.d.salvar();
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

  private bloquear(emp: EmpresaSeparada): RespostaTrilha {
    const bloqueio = `${emp.nome}: a conta deste projeto não está livre agora. A sessão não abre em outra conta; tente de novo em instantes.`;
    if ((this.avisadoSemConta.get(emp.id) ?? 0) <= this.agora()) {
      this.avisadoSemConta.set(emp.id, this.agora() + TRILHA_PEDIDA_S);
      this.d.trocador.evento("aviso", bloqueio, { empresa: emp.id });
    }
    return { ok: true, trilha: null, bloqueio };
  }

  /** A conta local é uma das contas marcadas para esta empresa ou projeto. */
  private contaServe(emp: EmpresaSeparada, conta: string | null): boolean {
    const posse = this.d.posse();
    return !!conta && !!posse && (emp.contas ?? []).some((c) => posse.porContaId(c) === conta);
  }

  /** Confere com a lista mais nova: quem acabou de ganhar uma conta no painel não fica de fora por até 1 min. */
  private async contaAindaServe(emp: EmpresaSeparada, conta: string, prazo = PEDIR_LEITURA_MS): Promise<boolean> {
    if (this.contaServe(emp, conta)) return true;
    try {
      await this.noPrazo(this.lerEmpresas(true), prazo);
    } catch (e) {
      this.d.log.erro(`ler os projetos separados: ${(e as Error).message}`);
    }
    const nova = this.empresas.find((e) => e.id === emp.id);
    // sumiu da lista (desligada ou agora representada por outra): não dá para dizer que a conta ainda é dela
    return !!nova && (!nova.estrita || this.contaServe(nova, conta));
  }

  /** As contas da unidade: as da lista, ou as guardadas quando ela deixou de ser a representante da trilha. */
  private contasDaUnidade(id: string): string[] | undefined {
    const emp = this.empresas.find((e) => e.id === id);
    const t = this.trilhas[id];
    if (emp) {
      if (t?.pidsPrincipal?.length) t.contasPrincipal = emp.contas ?? [];
      return emp.contas ?? [];
    }
    return t?.contasPrincipal;
  }

  /** A conta em uso aqui é uma das desta unidade. */
  private ativaServe(id: string): boolean {
    const contas = this.contasDaUnidade(id);
    const posse = this.d.posse();
    const ativa = this.d.estado().ativa;
    return !!contas && !!ativa && !!posse && contas.some((c) => posse.porContaId(c) === ativa);
  }

  /**
   * A conta em uso na principal é uma das desta empresa ou projeto, e a nuvem não mandou outra para cá: a conta local
   * atrasa um pouco em relação à decisão dela.
   */
  private principalServe(id: string): boolean {
    if (!this.ativaServe(id)) return false;
    const atribuida = this.d.atribuida?.();
    return !atribuida || (this.contasDaUnidade(id) ?? []).includes(atribuida);
  }

  /** A conta serve a todas as unidades com sessão presa no login da principal. */
  serveAsPresas(contaId: string): boolean {
    return this.naPrincipal().every((id) => (this.contasDaUnidade(id) ?? []).includes(contaId));
  }

  private travaValida(id: string): boolean {
    const c = this.confirmadas.get(id);
    return !!c && c.ate > this.agora() && c.conta === this.d.estado().ativa;
  }

  /** Pede à nuvem a trava que a retomada registrou; true: a sessão já pode abrir neste login. */
  async confirmarTrava(id: string): Promise<boolean> {
    if (!this.travaPedida.has(id)) return false;
    await this.segurarPrincipal();
    return this.principalServe(id) && this.travaValida(id);
  }

  /** Uma sessão da fila passou a esperar esta unidade: a trilha precisa existir aqui para a nuvem dar a conta dela. */
  manterPedida(id: string): void {
    this.trilha(id, this.empresas.find((e) => e.id === id)?.nome);
    this.d.salvar();
  }

  /** A sessão foi retomada dentro da trilha: conta como sessão dela, e a nuvem não solta a conta com o processo rodando. */
  anotarRetomada(id: string, pid: number): void {
    if (!Number.isInteger(pid) || pid <= 1) return;
    const t = this.trilha(id);
    if (!t.pids.includes(pid)) t.pids.push(pid);
    t.pids.splice(0, Math.max(0, t.pids.length - 200));
    t.pedidaEm = this.agora();
    this.d.salvar();
  }

  /** Um processo desta unidade roda no login da principal: enquanto ele viver, a conta em uso não sai. */
  anotarPrincipal(id: string, pid: number): void {
    if (!Number.isInteger(pid) || pid <= 1) return;
    const t = this.trilha(id);
    const lista = (t.pidsPrincipal ??= []);
    if (!lista.includes(pid)) lista.push(pid);
    lista.splice(0, Math.max(0, lista.length - 200));
    const contas = this.empresas.find((e) => e.id === id)?.contas;
    if (contas) t.contasPrincipal = contas;
    const inicio = this.d.inicioDoProcesso?.(pid);
    if (inicio) (t.iniciosPrincipal ??= {})[String(pid)] = inicio;
    this.d.salvar();
  }

  /** Só depois de religar: o número guardado pode ser de outro programa agora, e ele prenderia a conta para sempre. */
  private conferirPidsGuardados(): void {
    if (this.pidsConferidos) return;
    this.pidsConferidos = true;
    const inicio = this.d.inicioDoProcesso;
    if (!inicio) return;
    for (const t of Object.values(this.trilhas)) {
      if (!t.pidsPrincipal?.length) continue;
      t.pidsPrincipal = t.pidsPrincipal.filter((p) => {
        const salvo = t.iniciosPrincipal?.[String(p)];
        // processo morto sai logo depois, em naPrincipal: não vale abrir uma leitura para ele
        if (!salvo || !this.d.vivo(p)) return true;
        const atual = inicio(p);
        return !atual || atual === salvo;
      });
    }
  }

  /** As unidades com processo vivo no login da principal, enquanto a conta em uso ainda é uma das delas. */
  private naPrincipal(): string[] {
    this.conferirPidsGuardados();
    const r: string[] = [];
    for (const t of Object.values(this.trilhas)) {
      if (!t.pidsPrincipal?.length) continue;
      const vivos = t.pidsPrincipal.filter((p) => this.d.vivo(p));
      t.pidsPrincipal = vivos;
      if (t.iniciosPrincipal) {
        for (const p of Object.keys(t.iniciosPrincipal)) if (!vivos.includes(Number(p))) delete t.iniciosPrincipal[p];
      }
      if (vivos.length && this.ativaServe(t.empresa)) r.push(t.empresa);
    }
    return r.slice(0, 50);
  }

  /** Há sessão que só pode rodar na conta em uso: trocar a principal à mão a levaria para outra conta. */
  segurandoPrincipal(): boolean {
    return this.naPrincipal().length > 0;
  }

  /**
   * Renova na nuvem a trava da conta em uso e devolve as unidades que ela confirmou. Null: nada a pedir ou sem resposta
   * (a trava antiga vale até vencer, e a busca seguinte tenta de novo). Uma chamada por vez: a nuvem guarda a última
   * lista que chega, e duas em voo, montadas em momentos diferentes, podiam se desfazer.
   */
  segurarPrincipal(): Promise<string[] | null> {
    const antes = this.filaTrava;
    // a chamada que não volta (conexão pendurada) segura a fila só até o prazo: depois, a próxima vai assim mesmo
    const vez = new Promise<void>((ok) => {
      const prazo = this.d.relogio.agendar(ok, FILA_TRAVA_MS);
      void antes.then(() => {
        prazo.cancelar();
        ok();
      });
    }).then(() => this.segurarAgora());
    this.filaTrava = vez.catch(() => undefined);
    return vez;
  }

  private async segurarAgora(): Promise<string[] | null> {
    const agora = this.agora();
    for (const [id, ate] of this.travaPedida) if (ate <= agora) this.travaPedida.delete(id);
    const presas = this.naPrincipal();
    const ids = [...new Set([...presas, ...this.travaPedida.keys()])].slice(0, 50);
    const nuvem = this.d.nuvem();
    if (!nuvem || this.d.sombra) return null;
    if (!ids.length) {
      // plano B versão 2 (regra 4): a última sessão presa fechou. A lista vazia solta a trava na nuvem agora, em vez de a
      // conta em uso ficar segura até vencer; uma vez só, e de novo só depois de outra trava
      if (!this.seguraNaNuvem) return null;
      try {
        if ((await nuvem.segurarPrincipal([])).ok) this.seguraNaNuvem = false;
      } catch (e) {
        this.d.log.erro(`soltar a conta em uso das sessões do projeto: ${(e as Error).message}`);
      }
      return null;
    }
    const ativa = this.d.estado().ativa;
    // antes da chamada: sem resposta, a nuvem pode ter gravado a trava mesmo assim, e a lista vazia a solta depois
    this.seguraNaNuvem = true;
    try {
      const r = await nuvem.segurarPrincipal(ids);
      if (!r.ok) return null;
      for (const id of ids) {
        if (r.unidades.includes(id)) this.confirmadas.set(id, { ate: agora + TRAVA_CONFIRMADA_S, conta: ativa });
        else this.confirmadas.delete(id);
      }
      // a nuvem olhou a conta que está mesmo em uso aqui e disse que não é da unidade (desligada, ou a conta saiu da
      // lista): o processo não prende mais nada. Se ela olhou outra conta, a trava só venceu, e ele segue preso.
      const posse = this.d.posse();
      if (r.conta && posse?.porContaId(r.conta) === ativa) {
        for (const id of presas) {
          if (r.unidades.includes(id)) continue;
          const t = this.trilhas[id];
          if (t) {
            t.pidsPrincipal = [];
            delete t.iniciosPrincipal;
            delete t.contasPrincipal;
          }
        }
      }
      return r.unidades;
    } catch (e) {
      this.d.log.erro(`segurar a conta em uso para a sessão do projeto: ${(e as Error).message}`);
      return null;
    }
  }

  /** Depois de religar, com trilhas guardadas: as regras ainda não chegaram, e retomar agora poderia errar a conta. */
  private aguardandoRegras(): boolean {
    return !!this.d.nuvem() && this.lidasEm === 0 && !this.empresas.length && (this.ligadas || Object.keys(this.trilhas).length > 0);
  }

  /**
   * Para onde volta uma sessão retomada. A regra "só nas contas dela" vale pela pasta, mesmo para a sessão que parou no
   * login da principal: volta na trilha, na principal se a conta em uso é dela, ou espera na fila.
   */
  retomada(cwd: string, empresa?: string): DestinoRetomada {
    const t0 = empresa ? this.trilhas[empresa] : undefined;
    const comum: DestinoRetomada = t0?.conta ? { trilha: { pasta: t0.pasta, empresa: t0.empresa } } : {};
    if (this.d.sombra) return comum;
    this.carregarGuardadas();
    if (this.aguardandoRegras()) return { espera: true };
    const marcada = empresa ? this.empresas.find((e) => e.id === empresa) : undefined;
    const emp = marcada && !marcada.estrita ? null : (marcada ?? this.empresaDe(cwd));
    if (!emp?.estrita) return comum;
    const t = this.trilhas[emp.id];
    if (t?.conta && this.contaServe(emp, t.conta)) return { trilha: { pasta: t.pasta, empresa: t.empresa } };
    if (this.principalServe(emp.id)) {
      // a nuvem confirma a trava antes de o processo abrir: a próxima volta da fila já o abre
      if (this.travaValida(emp.id)) {
        this.travaPedida.delete(emp.id);
        return { principalDe: emp.id };
      }
      this.travaPedida.set(emp.id, this.agora() + TRAVA_PEDIDA_S);
    }
    return { espera: true, empresa: emp.id };
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
        this.buscaFimEm = this.agora();
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
    this.carregarGuardadas();
    const locais = Object.values(this.trilhas);
    this.marcar(this.ligadas || locais.some((t) => t.conta));
    const conhecida = this.empresas.some((e) => e.estrita);
    if (!this.ligadas && !locais.length && !conhecida) return;
    if (this.ligadas) await this.lerEmpresas();
    // desligaram a última: a lista velha ainda diz "só as contas dela" e seguraria a fila até o agente reiniciar
    else if ((this.lidasEm === 0 && locais.length) || conhecida) await this.lerEmpresas().catch(() => undefined);
    await this.segurarPrincipal();
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
        this.d.trocador.evento("erro", `${t.nome}: o login da conta escolhida para o projeto não abriu do cofre; entre de novo nela pelo painel.`, { empresa: t.empresa });
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
