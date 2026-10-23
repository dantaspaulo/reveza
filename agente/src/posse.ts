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
import { PRINCIPAL, type Credenciais } from "./credenciais/tipos.js";
import type { ContaLocal, EstadoLocal } from "./estado.js";
import type { CofreNuvem, MotivoPosse, Nuvem } from "./nuvem/tipos.js";
import type { Trocador } from "./troca.js";
import type { Log } from "./util/log.js";
import { epochParaIso, type Relogio } from "./util/tempo.js";
import type { ClaudeJson } from "./claudejson.js";
import { POSSE_CURTA_S, POSSE_S } from "./config.js";

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
   */
  async sincronizar(id: string, cofre: CofreNuvem | null, principalSemConta = false): Promise<void> {
    const c = this.conta(id);
    if (!c || !cofre) return;
    this.versaoServidor.set(id, cofre.versao);
    if (id === this.estado().ativa && !principalSemConta) return;
    const local = await this.cred.ler(c.pasta);
    if (c.versaoCofre !== null && cofre.versao <= c.versaoCofre && local) return;
    const k = this.chave();
    const aberto = k && c.contaId ? abrirCofreComOrigem(k, c.contaId, c.email, cofre) : null;
    if (!aberto) {
      this.abrir(c, cofre); // registra o erro de chave
      return;
    }
    const login = aberto.login;
    if (aberto.registro && local && expiraEm(local) >= expiraEm(login)) return;
    if (c.versaoCofre === null && local && expiraEm(local) > expiraEm(login)) {
      // A cópia local nunca foi ao cofre e é mais nova que a de lá (importada, ou login feito aqui): fica a local.
      return;
    }
    await this.cred.gravar(c.pasta, comLogin(local, login));
    c.versaoCofre = cofre.versao;
    c.precisaLogin = false;
    c.tokenExpiraEm = expiraEm(login) || null;
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
    const blob = await this.cred.ler(id === this.estado().ativa ? PRINCIPAL : c.pasta);
    if (!oauth(blob).refreshToken) return false;
    const anterior = this.versaoServidor.get(id) ?? c.versaoCofre ?? 0;
    const nova = anterior + 1;
    const { cifrado, nonce } = cifrarLogin(k, aadConta(c.contaId, nova), blob!);
    const exp = expiraEm(blob);
    const r = await this.nuvem.devolverCofre(c.contaId, cifrado, nonce, anterior, exp ? epochParaIso(exp) : null);
    if (!r.ok) {
      if (!(silencioso && /sem posse/.test(r.erro ?? ""))) this.log.erro(`o cofre recusou a versão nova de ${c.email}: ${r.erro ?? "sem motivo"}`);
      // "versão do cofre mudou": a nuvem diz qual é a atual; a próxima tentativa parte dela.
      if (r.versao !== null) this.versaoServidor.set(id, r.versao);
      return false;
    }
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
    const jaTinha = this.posses.has(id);
    if (!jaTinha) {
      const r = await this.pegar(id, motivo, POSSE_CURTA_S);
      if (!r.ok) return null;
      if (opcoes.sincronizar !== false) await this.sincronizar(id, r.cofre);
    }
    const c = this.conta(id)!;
    const antes = hashToken(await this.cred.ler(c.pasta));
    try {
      return await fn();
    } finally {
      if (!jaTinha) {
        const depois = hashToken(await this.cred.ler(c.pasta));
        let pode = true;
        if (opcoes.devolverSempre || antes !== depois) pode = await this.devolver(id).catch(() => false);
        if (pode) await this.soltar(id).catch(() => undefined);
        else this.soltarDepois.set(id, this.relogio.agora()); // tenta devolver de novo na próxima busca
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
    const blob = await this.cred.ler(ativa ? PRINCIPAL : c.pasta);
    if (!oauth(blob).refreshToken) return false;
    const { cifrado, nonce } = cifrarLogin(k, aadRegistro(c.email), blob!);
    const exp = expiraEm(blob);
    const r = await this.nuvem.registrarConta(c.email, c.org, c.plano, nivelDoTier(c.tier), cifrado, nonce, exp ? epochParaIso(exp) : null);
    if (!r.ok || !r.conta_id) {
      this.log.erro(`a nuvem não registrou ${c.email}: ${r.erro ?? "sem motivo"}`);
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
    for (const [id, desde] of [...this.soltarDepois]) {
      if (t < desde) continue;
      if (id === this.estado().ativa || !this.conta(id)?.contaId) {
        this.soltarDepois.delete(id);
        continue;
      }
      if (!this.posses.has(id)) {
        // Saiu de uso sem posse (a nuvem não a tinha atribuído aqui): posse curta só para devolver.
        const p = await this.pegar(id, "renovacao", 60).catch(() => null);
        if (!p?.ok) {
          this.log.erro(`${this.conta(id)!.email} saiu de uso sem posse e o cofre não aceitou a cópia daqui`);
          this.soltarDepois.delete(id);
          continue;
        }
      }
      if (await this.devolver(id).catch(() => false)) {
        await this.soltar(id).catch(() => undefined);
        this.soltarDepois.delete(id);
      }
    }
  }

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
