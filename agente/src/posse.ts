// Posse das contas (uma conta, um computador de cada vez) e o vaivém com o cofre cifrado.
//
// O token de renovação gira a cada uso: dois computadores com a mesma cópia queimam o login um do outro. Por isso:
// - só quem tem a posse usa ou renova a conta; a nuvem renova as posses de uso deste computador a cada `agente_ola`;
// - ao pegar a posse, a cópia do cofre entra no lugar da local quando é mais nova;
// - antes de soltar, o login mais novo vai cifrado ao cofre, e só então a posse é solta;
// - a conta em uso também sobe ao cofre quando as sessões a renovam (se este computador cair, o próximo pega um
//   login ainda válido, e não uma cópia já girada).
//
// Dado associado do cofre: `conta_id|versao`, com a versão NOVA (anterior + 1), que o banco grava exatamente assim.
// No registro (`agente_registrar_conta`) o agente ainda não sabe o conta_id nem a versão: cifra com
// `<email>|registro` e, assim que a nuvem responde, regrava com `conta_id|versao` (posse curta + devolver).

import * as path from "node:path";
import { aadConta, aadRegistro, cifrarLogin, decifrarLogin } from "./cofre/cifra.js";
import { comLogin, expiraEm, hashToken, oauth, type Blob } from "./credenciais/blob.js";
import type { Credenciais } from "./credenciais/tipos.js";
import type { ContaLocal, EstadoLocal } from "./estado.js";
import type { CofreNuvem, MotivoPosse, Nuvem } from "./nuvem/tipos.js";
import type { Trocador } from "./troca.js";
import type { Log } from "./util/log.js";
import { epochParaIso, type Relogio } from "./util/tempo.js";
import type { ClaudeJson } from "./claudejson.js";
import { POSSE_CURTA_S, POSSE_S } from "./config.js";

/** Conta que saiu de uso e o cofre ainda não aceitou (outro computador está com ela): de quanto em quanto tentar. */
export const SAIDA_DE_NOVO_S = 300;
/**
 * Conta presa na saída há mais que isto deixa de segurar o momento calmo (atualização, publicação, conferência do
 * assistente). Ela segue na lista, tentando; no reinício, o login dela fica na pasta e a próxima posse sobe a cópia mais
 * nova. Antes, uma saída presa segurava a atualização para sempre (27/11/2026).
 */
export const SAIDA_SEGURA_CALMA_S = 1800;

export function nivelDoTier(tier: string | null | undefined): string | null {
  const m = /(\d+x)\b/i.exec(tier ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

/** Abre um login do cofre: primeiro com `conta_id|versao`, depois (cofre ainda na gravação de registro) com o e-mail. */
export function abrirCofre(chave: Buffer, contaId: string, email: string | null, cofre: CofreNuvem): Blob | null {
  return abrirCofreComOrigem(chave, contaId, email, cofre)?.login ?? null;
}

/**
 * Como `abrirCofre`, dizendo se abriu pela gravação de registro. Essa gravação não leva a versão no dado associado:
 * quem grava no banco poderia repor uma antiga com versão nova, então ela nunca substitui uma cópia local mais nova.
 */
export function abrirCofreComOrigem(chave: Buffer, contaId: string, email: string | null, cofre: CofreNuvem): { login: Blob; registro: boolean } | null {
  try {
    return { login: decifrarLogin(chave, aadConta(contaId, cofre.versao), cofre.cifrado, cofre.nonce), registro: false };
  } catch {
    if (!email) return null;
    try {
      return { login: decifrarLogin(chave, aadRegistro(email), cofre.cifrado, cofre.nonce), registro: true };
    } catch {
      return null;
    }
  }
}

export class PosseCofre {
  /**
   * Quando não cifrar nada para o cofre (o motivo), mesmo com a chave: o agente diz que a chave deste computador não é a
   * da instalação. Cifrar assim mandaria o login para quem plantou a chave (auditoria de segurança run-3).
   */
  semEscrita: () => string | null = () => null;
  private semEscritaAvisado = false;

  private recusarEscrita(): boolean {
    const motivo = this.semEscrita();
    if (!motivo) {
      this.semEscritaAvisado = false;
      return false;
    }
    if (!this.semEscritaAvisado) this.log.erro(`não mando login para o cofre: ${motivo}`);
    this.semEscritaAvisado = true;
    return true;
  }

  /** Contas (id local) cuja posse este computador tem, com o motivo. */
  posses = new Map<string, MotivoPosse>();
  /** Contas que saíram de uso e voltam ao cofre a partir de um horário (depois da conferência da troca). */
  soltarDepois = new Map<string, number>();
  /** Versão do cofre na nuvem, como a última posse mostrou. */
  versaoServidor = new Map<string, number>();
  subirAtiva = false;
  ultimaSubidaAtiva = 0;
  /** Contas cuja devolução ao cofre já foi recusada e avisada no log (sai quando uma devolução dá certo). */
  private recusaAvisada = new Set<string>();
  /** Contas que saíram de uso e o cofre ainda não aceitou porque outro computador está com elas (avisadas no log). */
  private saidaPresaAvisada = new Set<string>();
  /** Contas cuja cópia daqui saiu de uso sem login renovável (avisadas no log uma vez; sai quando uma devolução dá certo). */
  private semLoginAvisada = new Set<string>();
  /** Contas cuja saída deu erro (avisadas no log uma vez; sai quando a conta sai da lista). */
  private erroSaidaAvisado = new Set<string>();
  /** Posses curtas (`com`) rodando agora, por conta. */
  private emCom = new Map<string, number>();

  constructor(
    private estado: () => EstadoLocal,
    private trocador: Trocador,
    private cred: Credenciais,
    private nuvem: Nuvem,
    private chave: () => Buffer | null,
    private cj: ClaudeJson,
    private relogio: Relogio,
    private log: Log,
    private salvar: () => void,
  ) {}

  conta(id: string): ContaLocal | undefined {
    return this.estado().contas[id];
  }

  /** A conta saiu deste computador (removida pelo painel): nada dela fica para devolver ou soltar. */
  esquecer(id: string): void {
    this.posses.delete(id);
    this.tirarDaSaida(id);
    this.semLoginAvisada.delete(id);
    this.versaoServidor.delete(id);
  }

  /**
   * Quando cada conta da lista de saída foi vista pela primeira vez. Fica no estado, e não só na memória, para a lista
   * se refazer depois de um reinício (`retomarSaidas`).
   */
  private get saidas(): Record<string, number> {
    const e = this.estado();
    return (e.saidasPendentes ??= {});
  }

  private marcarSaida(id: string, t: number): boolean {
    const s = this.saidas;
    if (s[id] !== undefined) return false;
    s[id] = t;
    return true;
  }

  /**
   * A conta saiu de uso agora (troca, trilha, posse curta que não devolveu): entra na lista a partir de `quando`, com o
   * horário de entrada de agora (uma saída nova segura a calma, mesmo de uma conta que já estava na lista) gravado no
   * estado na hora, para sobreviver a uma queda antes da busca seguinte.
   */
  marcarParaSair(id: string, quando = this.relogio.agora(), { novaSaida = true }: { novaSaida?: boolean } = {}): void {
    this.soltarDepois.set(id, quando);
    // a posse curta que não devolveu (de 5 em 5 min, na leitura das paradas) não é uma saída nova: mantém o horário de
    // entrada, senão a conta seguraria a calma para sempre
    if (novaSaida || this.saidas[id] === undefined) this.saidas[id] = this.relogio.agora();
    this.salvar();
  }

  private tirarDaSaida(id: string): void {
    this.soltarDepois.delete(id);
    this.saidaPresaAvisada.delete(id);
    this.erroSaidaAvisado.delete(id);
    const s = this.saidas;
    if (s[id] !== undefined) {
      delete s[id];
      this.salvar();
    }
  }

  /**
   * Quantas contas da lista de saída seguram o momento calmo agora: as recém-marcadas (uma troca de agora) seguram; a
   * presa há mais de `SAIDA_SEGURA_CALMA_S` já não. A primeira vez que uma conta é vista aqui conta como a entrada dela,
   * mesmo que o ciclo de saída ainda não tenha passado por ela. Conta também as do estado que a partida ainda não pôs de
   * volta na lista (`retomarSaidas` roda na primeira conversa com a nuvem, depois do portão).
   */
  saidasSegurandoCalma(t = this.relogio.agora()): number {
    let mudou = false;
    for (const id of this.soltarDepois.keys()) mudou = this.marcarSaida(id, t) || mudou;
    if (mudou) this.salvar();
    let n = 0;
    for (const [id, desde] of Object.entries(this.saidas)) {
      // horário à frente do relógio (a hora do computador foi acertada para trás): conta a partir de agora
      if (desde > t) {
        this.saidas[id] = t;
        this.salvar();
      }
      if (t - Math.min(desde, t) < SAIDA_SEGURA_CALMA_S) n++;
    }
    return n;
  }

  /**
   * Na partida: as contas que estavam saindo quando o agente parou voltam à lista, com o horário de entrada de antes, e
   * o ciclo de saída pede a posse de verdade para devolver. Devolve quem voltou (a faxina da partida não mexe nelas).
   */
  retomarSaidas(): Set<string> {
    const s = this.saidas;
    const voltaram = new Set<string>();
    let mudou = false;
    for (const id of Object.keys(s)) {
      if (!this.conta(id)) {
        delete s[id];
        mudou = true;
        continue;
      }
      if (!this.soltarDepois.has(id)) this.soltarDepois.set(id, this.relogio.agora());
      voltaram.add(id);
    }
    if (mudou) this.salvar();
    return voltaram;
  }

  /** A cópia do login que esta conta tem aqui; undefined quando a leitura falhou (chaveiro sem resposta). */
  private async lerCopia(id: string): Promise<Blob | null | undefined> {
    const entrada = this.trocador.entradaDe(id);
    try {
      return this.cred.lerEstrito ? await this.cred.lerEstrito(entrada) : await this.cred.ler(entrada);
    } catch {
      return undefined;
    }
  }

  porContaId(contaId: string): string | null {
    return Object.values(this.estado().contas).find((c) => c.contaId === contaId)?.id ?? null;
  }

  temPosse(id: string): boolean {
    return this.posses.has(id);
  }

  /** Lê o login do cofre; null quando não dá (sem chave, cifrado de outra conta, chave errada). */
  abrir(c: ContaLocal, cofre: CofreNuvem): Blob | null {
    const k = this.chave();
    if (!k) {
      this.log.erro("sem a chave do cofre neste computador: rode `reveza ligar`");
      return null;
    }
    const login = abrirCofre(k, c.contaId!, c.email, cofre);
    if (!login) this.trocador.evento("erro", `O login de ${c.email} no cofre não abriu (chave do cofre diferente?).`, { conta: c.id });
    return login;
  }

  /**
   * A cópia do cofre entra no lugar da local quando é mais nova. Nunca para a conta em uso (a principal é a fonte),
   * a não ser com `principalSemConta`: o assistente saiu da conta, e a principal deixou de ser a fonte de nada.
   *
   * "Mais nova" é a que vence depois, não a de versão maior (0.16.4). O token de renovação gira: o login emitido por
   * último (login feito agora ou renovação) é o único que ainda renova, e o de versão maior pode ser só uma cópia
   * velha que outro computador devolveu ao sair dela. Caso de 16/11/2026: uma conta entrou de novo num computador, o
   * login novo não chegou ao cofre, e o outro computador seguia devolvendo a cópia morta com versão maior; a próxima
   * sincronização trocaria o login vivo pelo morto. Devolve true quando a cópia local é a mais nova e precisa subir.
   */
  async sincronizar(id: string, cofre: CofreNuvem | null, principalSemConta = false): Promise<boolean> {
    const c = this.conta(id);
    if (!c || !cofre) return false;
    this.versaoServidor.set(id, cofre.versao);
    if (id === this.estado().ativa && !principalSemConta) return false;
    // na trilha de uma empresa (0.18.0) o login vivo é o da trilha, como o da principal
    if (this.trocador.trilhaDe(id)) return false;
    const local = await this.cred.ler(c.pasta);
    if (c.versaoCofre !== null && cofre.versao <= c.versaoCofre && local) return false;
    const k = this.chave();
    const aberto = k && c.contaId ? abrirCofreComOrigem(k, c.contaId, c.email, cofre) : null;
    if (!aberto) {
      this.abrir(c, cofre); // registra o erro de chave
      return false;
    }
    const login = aberto.login;
    if (aberto.registro && local && expiraEm(local) >= expiraEm(login)) return false;
    if (local && oauth(local).refreshToken && expiraEm(local) > expiraEm(login)) {
      // A cópia local foi emitida depois da do cofre (login feito aqui, renovação daqui, ou importada): fica a local,
      // e ela sobe na devolução seguinte.
      return true;
    }
    await this.cred.gravar(c.pasta, comLogin(local, login));
    c.versaoCofre = cofre.versao;
    c.precisaLogin = false;
    c.tokenExpiraEm = expiraEm(login) || null;
    return false;
  }

  async pegar(id: string, motivo: MotivoPosse, segundos = POSSE_S): Promise<{ ok: boolean; erro: string | null; cofre: CofreNuvem | null }> {
    const c = this.conta(id);
    if (!c?.contaId) return { ok: false, erro: "conta fora da nuvem", cofre: null };
    const r = await this.nuvem.pegarPosse(c.contaId, motivo, segundos);
    if (r.ok) {
      if (this.posses.get(id) !== "uso") this.posses.set(id, motivo);
      if (r.cofre) this.versaoServidor.set(id, r.cofre.versao);
    }
    return r;
  }

  /** Cifra o login mais novo da conta e devolve ao cofre (exige a posse). */
  /** `silencioso`: na faxina da partida, "sem posse" é o esperado (a posse de antes já venceu) e não é erro. */
  async devolver(id: string, { silencioso = false }: { silencioso?: boolean } = {}): Promise<boolean> {
    const c = this.conta(id);
    const k = this.chave();
    if (!c?.contaId || !k || !this.posses.has(id) || this.recusarEscrita()) return false;
    // o login vivo: o da principal, o da trilha em que a conta está, ou o da pasta dela
    const blob = await this.cred.ler(this.trocador.entradaDe(id));
    if (!oauth(blob).refreshToken) return false;
    const anterior = this.versaoServidor.get(id) ?? c.versaoCofre ?? 0;
    const nova = anterior + 1;
    const { cifrado, nonce } = cifrarLogin(k, aadConta(c.contaId, nova), blob!);
    const exp = expiraEm(blob);
    const r = await this.nuvem.devolverCofre(c.contaId, cifrado, nonce, anterior, exp ? epochParaIso(exp) : null);
    if (!r.ok) {
      const semPosse = /sem posse/.test(r.erro ?? "");
      // Uma vez por episódio: antes, a mesma recusa saía a cada ciclo de 15 s, o dia todo (16/11/2026: 2.274 vezes).
      if (!(silencioso && semPosse) && !this.recusaAvisada.has(id)) {
        this.log.erro(`o cofre recusou a versão nova de ${c.email}: ${r.erro ?? "sem motivo"}`);
        this.recusaAvisada.add(id);
      }
      // A posse que este computador achava ter já venceu na nuvem: sai da lista, para a próxima tentativa pedir uma
      // nova em vez de repetir a devolução sem posse para sempre (o login novo da conta nunca chegava ao cofre).
      if (semPosse) this.posses.delete(id);
      // "versão do cofre mudou": a nuvem diz qual é a atual; a próxima tentativa parte dela.
      if (r.versao !== null) this.versaoServidor.set(id, r.versao);
      return false;
    }
    this.recusaAvisada.delete(id);
    this.semLoginAvisada.delete(id);
    if (r.versao !== nova) this.log.erro(`o cofre gravou ${c.email} na versão ${r.versao}, e não ${nova}: o cifrado não vai abrir`);
    c.versaoCofre = r.versao ?? nova;
    this.versaoServidor.set(id, c.versaoCofre);
    this.salvar();
    return true;
  }

  async soltar(id: string): Promise<void> {
    const c = this.conta(id);
    if (!c?.contaId) return;
    await this.nuvem.soltarPosse(c.contaId);
    this.posses.delete(id);
  }

  /** Posse curta: pega, sincroniza, faz o trabalho, devolve ao cofre se o login mudou, solta. null = sem posse. */
  async com<T>(
    id: string,
    motivo: MotivoPosse,
    fn: () => Promise<T>,
    opcoes: { sincronizar?: boolean; devolverSempre?: boolean } = {},
  ): Promise<T | null> {
    // enquanto uma posse curta roda, a saída da mesma conta não solta a posse dela (processarSaida)
    this.emCom.set(id, (this.emCom.get(id) ?? 0) + 1);
    try {
      return await this.comDentro(id, motivo, fn, opcoes);
    } finally {
      const n = (this.emCom.get(id) ?? 1) - 1;
      if (n > 0) this.emCom.set(id, n);
      else this.emCom.delete(id);
    }
  }

  private async comDentro<T>(
    id: string,
    motivo: MotivoPosse,
    fn: () => Promise<T>,
    opcoes: { sincronizar?: boolean; devolverSempre?: boolean },
  ): Promise<T | null> {
    const jaTinha = this.posses.has(id);
    let subir = false;
    if (!jaTinha) {
      const r = await this.pegar(id, motivo, POSSE_CURTA_S);
      if (!r.ok) return null;
      if (opcoes.sincronizar !== false) subir = await this.sincronizar(id, r.cofre);
    }
    const c = this.conta(id)!;
    const antes = hashToken(await this.cred.ler(c.pasta));
    try {
      return await fn();
    } finally {
      if (!jaTinha) {
        const depois = hashToken(await this.cred.ler(c.pasta));
        let pode = true;
        // a cópia daqui é mais nova que a do cofre: sobe já, mesmo sem mudar agora
        if (opcoes.devolverSempre || subir || antes !== depois) pode = await this.devolver(id).catch(() => false);
        if (pode) await this.soltar(id).catch(() => undefined);
        else this.marcarParaSair(id, this.relogio.agora(), { novaSaida: false }); // tenta devolver de novo na próxima busca
      }
    }
  }

  /** Conta que a nuvem conhece e este computador não: monta a pasta dela a partir do cofre (com a posse já pega). */
  async materializar(contaId: string, email: string | null, cofre: CofreNuvem | null, renovar: (pasta: string) => Promise<void>): Promise<string | null> {
    const k = this.chave();
    if (!k || !cofre) return null;
    const login = abrirCofre(k, contaId, email, cofre);
    if (!login) {
      this.trocador.evento("erro", `O login de ${email ?? "uma conta"} no cofre não abriu (chave do cofre diferente?).`, { contaId });
      return null;
    }
    const id = this.trocador.novoId();
    const pasta = this.trocador.novaPasta(id);
    await this.cred.gravar(pasta, login);
    let perfil = await this.trocador.identidade(login);
    if (!perfil) {
      await renovar(pasta).catch(() => undefined);
      perfil = await this.trocador.identidade(await this.cred.ler(pasta));
    }
    if (!perfil) {
      await this.cred.apagar(pasta);
      return null;
    }
    const existente = this.trocador.contaDoPerfil(perfil);
    const final = existente ?? this.trocador.registrar(perfil, pasta, login, id);
    const c = this.conta(final)!;
    if (existente) {
      await this.cred.gravar(c.pasta, comLogin(await this.cred.ler(c.pasta), (await this.cred.ler(pasta)) ?? login));
      await this.cred.apagar(pasta);
    }
    c.contaId = contaId;
    c.versaoCofre = cofre.versao;
    this.versaoServidor.set(final, cofre.versao);
    if (!existente) {
      await this.cj
        .gravarConta(path.join(pasta, ".claude.json"), {
          accountUuid: perfil.accountUuid,
          emailAddress: perfil.email,
          organizationUuid: perfil.orgUuid,
          organizationName: perfil.org,
        })
        .catch(() => undefined);
    }
    this.trocador.evento("conexao", `${perfil.email} chegou do cofre.`, { conta: final });
    this.salvar();
    return final;
  }

  /** Conta conectada aqui entra na nuvem (registro com `<email>|registro`) e é regravada com `conta_id|versao`. */
  async registrarNaNuvem(id: string): Promise<boolean> {
    const c = this.conta(id);
    const k = this.chave();
    if (!c || !k || this.recusarEscrita()) return false;
    const ativa = id === this.estado().ativa;
    const blob = await this.cred.ler(this.trocador.entradaDe(id));
    if (!oauth(blob).refreshToken) return false;
    const { cifrado, nonce } = cifrarLogin(k, aadRegistro(c.email), blob!);
    const exp = expiraEm(blob);
    const r = await this.nuvem.registrarConta(c.email, c.org, c.plano, nivelDoTier(c.tier), cifrado, nonce, exp ? epochParaIso(exp) : null, c.orgUuid, c.accountUuid);
    if (!r.ok || !r.conta_id) {
      // conta em uso em outro computador é rotina na conferência de identidade: não é erro deste computador
      if (r.erro !== "conta com outro computador agora; tente de novo em instantes") {
        this.log.erro(`a nuvem não registrou ${c.email}: ${r.erro ?? "sem motivo"}`);
      }
      return false;
    }
    c.contaId = r.conta_id;
    c.versaoCofre = r.versao;
    if (r.versao !== null) this.versaoServidor.set(id, r.versao);
    this.salvar();
    // Regrava com o dado associado definitivo. A conta em uso fica com a posse de uso (se a nuvem a atribuiu aqui).
    if (ativa) {
      let p = await this.pegar(id, "uso");
      if (!p.ok) p = await this.pegar(id, "login", 60);
      if (!p.ok) return true;
      const ok = await this.devolver(id).catch(() => false);
      if (this.posses.get(id) !== "uso") await this.soltar(id).catch(() => undefined);
      return ok;
    }
    const ok = await this.com(id, "login", async () => true, { sincronizar: false, devolverSempre: true });
    return ok === true;
  }

  /** Contas que saíram de uso: devolve ao cofre e solta, quando passou a hora (e se não voltaram a ser a ativa). */
  async processarSaidas(): Promise<void> {
    const t = this.relogio.agora();
    const s = this.saidas;
    let mudou = false;
    for (const id of Object.keys(s)) {
      if (this.soltarDepois.has(id)) continue;
      delete s[id];
      mudou = true;
    }
    for (const id of this.soltarDepois.keys()) mudou = this.marcarSaida(id, t) || mudou;
    if (mudou) this.salvar();
    for (const [id, desde] of [...this.soltarDepois]) {
      // a que voltou a ser a ativa (ou foi para uma trilha) sai da lista já, sem esperar a hora da próxima tentativa
      const c = this.conta(id);
      if (id === this.estado().ativa || this.trocador.trilhaDe(id) || !c?.contaId) {
        this.tirarDaSaida(id);
        continue;
      }
      if (t < desde) continue;
      try {
        await this.processarSaida(id, t);
      } catch (e) {
        // uma conta com erro (o chaveiro recusou gravar, por exemplo) não segura as outras: tenta na próxima busca
        if (!this.erroSaidaAvisado.has(id)) {
          this.log.erro(`a saída de ${this.conta(id)?.email ?? id} falhou: ${(e as Error).message}; tento de novo na próxima busca`);
          this.erroSaidaAvisado.add(id);
        }
      }
    }
  }

  private async processarSaida(id: string, t: number): Promise<void> {
    const c = this.conta(id)!;
    // uma posse curta da mesma conta rodando agora: a posse e o login são dela; tenta na próxima busca
    if (this.emCom.has(id)) return;
    const copia = await this.lerCopia(id);
    if (copia === undefined) return; // a leitura falhou: tenta na próxima busca, sem mexer no cofre
    // a posse curta pode ter começado durante a leitura (e trazido o login do cofre): a cópia lida já não vale
    if (this.emCom.has(id)) return;
    if (!oauth(copia).refreshToken) {
      // A cópia daqui não tem login renovável (a renovação foi recusada e o assistente esvaziou o login): não há o que
      // devolver. Antes, a devolução saía calada a cada busca e a conta ficava na lista para sempre, segurando a
      // atualização deste computador (27/11/2026). O cofre segue com a cópia dele.
      if (!this.semLoginAvisada.has(id)) {
        this.log.info(`${c.email} saiu de uso sem login renovável aqui: nada a devolver ao cofre`);
        this.semLoginAvisada.add(id);
      }
      // a posse segue na mão se a nuvem não respondeu: fica na lista e solta na próxima busca
      if (this.posses.has(id)) await this.soltar(id);
      this.tirarDaSaida(id);
      return;
    }
    if (!this.posses.has(id)) {
      // Saiu de uso sem posse (a nuvem não a tinha atribuído aqui, ou a posse curta venceu): posse curta só para
      // devolver. Com outro computador usando a conta, tenta de novo daqui a pouco, sem desistir: a cópia daqui pode
      // ser a única viva (um login feito agora), e desistir a deixava fora do cofre para sempre (16/11/2026).
      const p = await this.pegar(id, "renovacao", 60).catch(() => null);
      if (!p?.ok) {
        if (!this.saidaPresaAvisada.has(id)) {
          this.log.erro(`${c.email} saiu de uso sem posse e o cofre não aceitou a cópia daqui (${p?.erro ?? "sem resposta"}); tento de novo a cada ${SAIDA_DE_NOVO_S / 60} min`);
          this.saidaPresaAvisada.add(id);
        }
        this.soltarDepois.set(id, t + SAIDA_DE_NOVO_S);
        return;
      }
      // Com a posse de novo, vale a mais nova: se a do cofre é a mais nova (outro computador entrou de novo nela
      // ou a renovou), ela fica aqui e não há o que devolver.
      const versao = c.versaoCofre;
      const subir = await this.sincronizar(id, p.cofre);
      if (!subir && c.versaoCofre !== versao) {
        await this.soltar(id).catch(() => undefined);
        this.tirarDaSaida(id);
        return;
      }
    }
    if (await this.devolver(id).catch(() => false)) {
      // ainda com a posse: a nuvem só aceita a marca de login de quem está com a conta
      await this.aposDevolver(id).catch(() => undefined);
      await this.soltar(id).catch(() => undefined);
      this.tirarDaSaida(id);
      this.semLoginAvisada.delete(id);
    }
    // devolução recusada: fica na lista; sem posse (venceu na nuvem), a próxima volta pede outra
  }

  /** Depois que uma conta parada subiu ao cofre (o agente usa para dizer à nuvem que o login dela voltou a valer). */
  aposDevolver: (id: string) => Promise<void> = async () => undefined;

  /** As sessões renovaram a conta em uso: sobe a cópia nova ao cofre (no máximo uma vez por minuto). */
  async subirAtivaSePreciso(): Promise<void> {
    const ativa = this.estado().ativa;
    if (!this.subirAtiva || !ativa || this.posses.get(ativa) !== "uso") return;
    if (this.relogio.agora() - this.ultimaSubidaAtiva < 60) return;
    this.subirAtiva = false;
    this.ultimaSubidaAtiva = this.relogio.agora();
    await this.devolver(ativa).catch(() => false);
  }
}
