// A troca de conta neste computador e tudo o que mexe na credencial local, com as regras do roteador que já roda:
//
// - trocar mexe só em `claudeAiOauth` e `organizationUuid`; o `mcpOAuth` é da máquina e fica na principal;
// - nunca renovar pela cópia guardada da conta ATIVA: as sessões renovam na principal e o token de renovação gira;
// - renovar e trocar a mesma conta nunca ao mesmo tempo (trava por conta); destino perto de vencer é renovado antes;
// - conferir a principal 5 s depois da troca e refazer se uma sessão regravou a conta antiga (até 3 vezes);
// - mudança feita por fora (um login à mão) é aceita, mas antes o último token visto da conta que saiu é guardado;
// - o `oauthAccount` do ~/.claude.json acompanha a troca, com a trava de diretório do assistente;
// - sem saber de quem é o token da principal, não troca (guardar na conta errada perderia o login certo).

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { ROTULOS, janelaDaConta, type ApiContas, type Janela, type Perfil, type TipoJanela } from "./anthropic.js";
import type { Cli } from "./claudecli.js";
import type { ClaudeJson } from "./claudejson.js";
import {
  CONFERIR_TROCA_MS,
  HISTORICO_JANELA_S,
  HISTORICO_PASSO_S,
  IGNORAR_MEDIDA_APOS_TROCA_S,
  LEITURA_VALIDA_S,
  LER_ESTACIONADA_S,
  RECUO_429_S,
  RENOVAR_ANTES_S,
  RITMO_JANELA_S,
  VENCIDO_EM_S,
  type Caminhos,
} from "./config.js";
import type { Resultado } from "./util/executor.js";
import { comLogin, expiraEm, hashToken, oauth, soLogin, temRenovacao, type Blob } from "./credenciais/blob.js";
import { PRINCIPAL, type Credenciais } from "./credenciais/tipos.js";
import { estadoDaConta, gatilhoDeTroca, pctEfetivo } from "./decisao.js";
import { novaConta, type ContaLocal, type EstadoLocal, type TipoEvento } from "./estado.js";
import type { Log } from "./util/log.js";
import type { Relogio } from "./util/tempo.js";
import { isoParaEpoch } from "./util/tempo.js";
import { Trava, Travas } from "./util/trava.js";

/** Login vencido, com renovação, recusado pela API e parado há tanto tempo: o assistente não consegue usá-lo. */
export const PRINCIPAL_MORTA_APOS_S = 15 * 60;

export interface Ganchos {
  /** Pode renovar esta conta agora? (sem nuvem: sempre; com nuvem: só com a posse; modo sombra: nunca) */
  podeRenovar(id: string): boolean;
  /** Conta nova apareceu na principal ou numa pasta (para registrar na nuvem). */
  aoConectar?(id: string): void;
  aoEvento?(tipo: TipoEvento, texto: string, dados: Record<string, unknown>): void;
  /** O token da conta em uso mudou na principal (as sessões renovaram). */
  aoRenovarPrincipal?(id: string): void;
}

/**
 * `false`: o assistente disse que o login não vale mais (pede /login, token revogado). `"momentaneo"`: não renovou, mas
 * sem o assistente dizer isso (rede, serviço fora, limite): a conta não é marcada na hora (relato do Paulo, 22/10/2026:
 * o MacBook marcou "precisa entrar de novo" numa conta que funcionava pelo cofre, depois de uma renovação que tropeçou).
 */
export type ResultadoRenovar = true | false | "bloqueado" | "momentaneo";
/** O que o assistente diz quando o login morreu de fato. */
export const LOGIN_MORTO = /\/login\b|invalid_grant|revoked|not logged in|"loggedIn"\s*:\s*false|invalid authentication|authentication_error/i;
/** Depois de uma renovação que tropeçou, a próxima tentativa. */
export const RECUO_RENOVAR_S = 1800;
/** Tropeçando sem parar por este tempo, a conta passa a pedir login. */
export const PEDIR_LOGIN_APOS_S = 3 * 3600;

/** Quanto tempo a conta fica fora da escolha deste computador depois de não rodar o modelo de uma sessão. */
export const SEM_MODELO_S = 6 * 3600;

export class Trocador {
  readonly geral = new Trava();
  private travasConta = new Travas();
  /** [conta, blob] da última leitura da principal: o token mais novo da conta em uso. */
  ultimaPrincipal: [string, Blob] | null = null;
  recuo: Record<string, number> = {};
  ultimaLeitura: Record<string, number> = {};
  /** Desde quando a renovação de cada conta tropeça sem o assistente dizer que o login morreu (epoch em segundos). */
  tropecoDesde: Record<string, number> = {};
  sombra = false;
  private ultimoFaria = "";
  /** A principal já foi lida desde que o agente subiu? */
  principalLida = false;
  /** Desde quando a principal está sem login de conta (null: com login, ou ainda não lida). */
  principalSemLoginDesde: number | null = null;

  /** Anota o que a leitura da principal mostrou: com login, ou desde quando está sem. */
  private anotarPrincipal(blob: Blob | null): void {
    this.principalLida = true;
    if (hashToken(blob)) this.principalSemLoginDesde = null;
    else this.principalSemLoginDesde ??= this.agora();
  }

  constructor(
    public estado: EstadoLocal,
    private cred: Credenciais,
    private api: ApiContas,
    private cli: Cli,
    private cj: ClaudeJson,
    private c: Caminhos,
    private relogio: Relogio,
    private log: Log,
    private ganchos: Ganchos,
    private salvar: () => void,
  ) {}

  // ------------------------------------------------------------------------------------------------ apoio

  agora(): number {
    return this.relogio.agora();
  }

  evento(tipo: TipoEvento, texto: string, dados: Record<string, unknown> = {}): void {
    this.estado.eventos.unshift({ em: this.agora(), tipo, texto, dados });
    this.estado.eventos.splice(100);
    (tipo === "erro" ? this.log.erro : this.log.info).call(this.log, `[${tipo}] ${texto}`);
    this.ganchos.aoEvento?.(tipo, texto, dados);
  }

  travaConta(id: string): Trava {
    return this.travasConta.de(id);
  }

  async identidade(blob: Blob | null): Promise<Perfil | null> {
    const h = hashToken(blob);
    if (!h) return null;
    const cache = this.estado.identidades;
    if (!cache[h]) {
      const { perfil } = await this.api.perfil(oauth(blob).accessToken!);
      if (!perfil) return null;
      cache[h] = perfil;
      const chaves = Object.keys(cache);
      for (const k of chaves.slice(0, Math.max(0, chaves.length - 50))) delete cache[k];
    }
    return cache[h]!;
  }

  contaDoPerfil(perfil: Perfil): string | null {
    for (const [id, c] of Object.entries(this.estado.contas)) {
      if (c.accountUuid === perfil.accountUuid && c.orgUuid === perfil.orgUuid) return id;
    }
    return null;
  }

  contaPorEmail(email: string): string | null {
    const e = email.trim().toLowerCase();
    return Object.values(this.estado.contas).find((c) => c.email === e)?.id ?? null;
  }

  novoId(): string {
    let id = randomBytes(4).toString("hex");
    while (this.estado.contas[id]) id = randomBytes(4).toString("hex");
    return id;
  }

  novaPasta(id = this.novoId()): string {
    const pasta = path.join(this.c.contas, id);
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    return pasta;
  }

  registrar(perfil: Perfil, pasta: string, blob: Blob | null, id = path.basename(pasta)): string {
    const conta = novaConta(id, perfil, pasta, this.agora());
    const o = oauth(blob);
    conta.plano = typeof o.subscriptionType === "string" ? o.subscriptionType : null;
    conta.tier = (typeof o.rateLimitTier === "string" ? o.rateLimitTier : null) ?? perfil.tier;
    this.estado.contas[id] = conta;
    return id;
  }

  marcarLinha(id: string, t: number): void {
    const linha = this.estado.linhaContas;
    if (!linha.length || linha[linha.length - 1]![1] !== id) {
      linha.push([t, id]);
      linha.splice(0, Math.max(0, linha.length - 2000));
    }
  }

  contaEm(ts: number): string | null {
    let conta: string | null = null;
    for (const [desde, id] of this.estado.linhaContas) {
      if (desde > ts) break;
      conta = id;
    }
    return conta;
  }

  private claudeJsonDa(conta: ContaLocal): string {
    return path.join(conta.pasta, ".claude.json");
  }

  private async copiarConta(de: string, para: string): Promise<void> {
    try {
      await this.cj.copiar(de, para);
    } catch (e) {
      this.log.erro(`oauthAccount não copiado de ${de} para ${para}: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------------ principal

  conferirPrincipal(): Promise<string | null> {
    return this.geral.com(() => this.conferirPrincipalDentro());
  }

  /** Quem está na principal? Adota conta nova e corrige `ativa` se alguém trocou por fora. Chamar com `geral`. */
  async conferirPrincipalDentro(): Promise<string | null> {
    const blob = await this.cred.ler(PRINCIPAL);
    this.anotarPrincipal(blob);
    if (!blob) return null;
    const perfil = await this.identidade(blob);
    if (!perfil) return this.estado.ativa;
    let id = this.contaDoPerfil(perfil);
    const nova = !id;
    if (!id) {
      const pasta = this.novaPasta();
      id = this.registrar(perfil, pasta, blob);
      await this.copiarConta(this.c.claudeJson, this.claudeJsonDa(this.estado.contas[id]!));
      this.evento("conexao", `${perfil.email} (${perfil.org ?? "sem organização"}) estava em uso e entrou no rodízio.`, {
        conta: id,
        email: perfil.email,
      });
    }
    if (this.estado.ativa !== id) {
      const anterior = this.estado.ativa;
      if (anterior && this.ultimaPrincipal && this.ultimaPrincipal[0] === anterior && this.estado.contas[anterior]) {
        // A principal tinha o token mais novo da conta que saiu; sem isto ele se perderia.
        const pasta = this.estado.contas[anterior]!.pasta;
        await this.cred.gravar(pasta, comLogin(await this.cred.ler(pasta), soLogin(this.ultimaPrincipal[1])));
      }
      if (anterior) {
        this.evento("info", `A conta em uso mudou por fora do agente: agora é ${this.estado.contas[id]!.email}.`, {
          de: anterior,
          para: id,
        });
      }
      this.estado.ativa = id;
      this.marcarLinha(id, this.agora());
      this.estado.versao += 1;
      this.estado.trocadaEm = this.agora();
    }
    const antes = this.ultimaPrincipal;
    this.ultimaPrincipal = [id, blob];
    if (antes && antes[0] === id && hashToken(antes[1]) !== hashToken(blob)) this.ganchos.aoRenovarPrincipal?.(id);
    const c = this.estado.contas[id]!;
    c.precisaLogin = false;
    c.tokenExpiraEm = expiraEm(blob) || null;
    if (nova) this.ganchos.aoConectar?.(id);
    return id;
  }

  // ------------------------------------------------------------------------------------------------ troca

  trocar(destino: string, motivo: string): Promise<{ ok: boolean; erro?: string; de?: string | null }> {
    return this.geral.com(() => this.trocarDentro(destino, motivo));
  }

  async trocarDentro(destino: string, motivo: string): Promise<{ ok: boolean; erro?: string; de?: string | null }> {
    if (this.sombra) {
      const chave = `${destino}|${motivo}`;
      if (this.ultimoFaria !== chave) {
        this.ultimoFaria = chave;
        this.log.faria(`trocar para ${this.estado.contas[destino]?.email ?? destino} (${motivo})`);
      }
      return { ok: false, erro: "modo sombra" };
    }
    const contas = this.estado.contas;
    const alvo = contas[destino];
    if (!alvo) return { ok: false, erro: "conta desconhecida" };
    let atual = await this.cred.ler(PRINCIPAL);
    // A principal não tem login de conta nenhuma (vazia, só os logins MCP, ou um login morto de ninguém conhecido).
    let semConta = !hashToken(atual);
    if (atual && !(await this.identidade(atual))) {
      // Sem login nenhum na principal (computador novo, ou o assistente saiu da conta) ou com um login que não vale
      // mais, não há conta em uso a proteger: a troca segue. Antes ela era adiada para sempre, e o computador novo
      // nunca recebia a conta que a nuvem mandou (12/10/2026).
      const motivo = await this.principalSemConta(atual);
      if (!motivo) {
        this.evento("erro", "Não consegui identificar a conta em uso (sem rede?); troca adiada.");
        return { ok: false, erro: "não consegui identificar a conta em uso" };
      }
      semConta = true;
      if (hashToken(atual)) this.guardarCopiaDaPrincipal(atual);
      this.evento("info", `O assistente estava ${motivo}; a conta da troca entra no lugar.`);
    }
    // Principal sem conta: o que está nela não é login de ninguém daqui, então não vai para a pasta da conta que consta
    // em uso (antes ia, e apagava o login guardado dela), e "já está nela" não vale (a principal seguia vazia). O último
    // login visto dessa conta na principal, se for mais novo que o guardado, fica guardado (12/10/2026).
    const anterior = this.estado.ativa;
    if (semConta) await this.guardarUltimaPrincipal(anterior);
    const de = semConta ? null : await this.conferirPrincipalDentro();
    if (de === destino) return { ok: true, de };
    const r = await this.travaConta(destino).com(async () => {
      let blobAlvo = await this.cred.ler(alvo.pasta);
      if (blobAlvo && expiraEm(blobAlvo) < this.agora() + RENOVAR_ANTES_S && (await this.renovarDentro(destino)) === true) {
        // Token perto de vencer: renova antes de pôr na principal, ainda com a conta travada.
        blobAlvo = await this.cred.ler(alvo.pasta);
      }
      if (!temRenovacao(blobAlvo)) {
        alvo.precisaLogin = true;
        this.evento("erro", `${alvo.email} está sem login guardado; entre de novo pelo painel.`, { conta: destino });
        return { ok: false, erro: "conta sem login guardado" };
      }
      // Leitura estrita: se o chaveiro não respondeu, não dá para tratar a principal como vazia (perderia os logins
      // de MCP desta máquina e o token mais novo da conta que sai). Troca adiada.
      try {
        atual = this.cred.lerEstrito ? await this.cred.lerEstrito(PRINCIPAL) : await this.cred.ler(PRINCIPAL);
      } catch {
        this.evento("erro", "Não consegui ler a conta em uso no chaveiro; troca adiada.");
        return { ok: false, erro: "não consegui ler a conta em uso" };
      }
      if (atual && de && contas[de]) {
        const guardada = await this.cred.ler(contas[de]!.pasta);
        await this.cred.gravar(contas[de]!.pasta, comLogin(guardada, soLogin(atual)));
        await this.copiarConta(this.c.claudeJson, this.claudeJsonDa(contas[de]!));
      }
      const nova = comLogin(atual, soLogin(blobAlvo!));
      await this.cred.gravar(PRINCIPAL, nova);
      this.ultimaPrincipal = [destino, nova];
      this.anotarPrincipal(nova);
      return { ok: true };
    });
    if (!r.ok) return r;
    await this.copiarConta(this.claudeJsonDa(alvo), this.c.claudeJson);
    const t = this.agora();
    this.estado.ativa = destino;
    this.marcarLinha(destino, t);
    this.estado.proxima = null;
    this.estado.versao += 1;
    this.estado.trocadaEm = t;
    const p = de ? pctEfetivo(contas[de]!, t) : null;
    const p2 = pctEfetivo(alvo, t);
    const textoDe = de ? `${contas[de]!.email}${p !== null ? ` (${p.toFixed(0)}%)` : ""}` : "conta desconhecida";
    const textoPara = `${alvo.email}${p2 !== null ? ` (${p2.toFixed(0)}%)` : ""}`;
    this.evento(
      "troca",
      semConta ? `Pus ${textoPara} no assistente, que estava sem login. Motivo: ${motivo}.` : `Troquei de ${textoDe} para ${textoPara}. Motivo: ${motivo}.`,
      { de: de ?? anterior, para: destino, motivo },
    );
    this.salvar();
    this.relogio.agendar(() => void this.conferirTroca(destino, de, 1), CONFERIR_TROCA_MS);
    // a conta que constava em uso saiu (a posse dela é solta depois), mesmo com a principal sem login
    return { ok: true, de: de ?? (anterior !== destino ? anterior : null) };
  }

  /**
   * A principal não tem conta que valha a pena guardar? Devolve o motivo (para o evento) ou null quando pode ser só
   * falta de rede. Sem login: nada a guardar. Login vencido sem renovação: morto. Login vencido com renovação que a API
   * recusa e que ninguém renovou em 15 minutos: o assistente não está conseguindo usá-lo (é quando ele pede login).
   */
  async principalSemConta(atual: Blob): Promise<string | null> {
    const tok = oauth(atual).accessToken;
    if (!tok) return "sem login";
    const vence = expiraEm(atual);
    if (!vence || vence > this.agora()) return null;
    if (!temRenovacao(atual)) return "com um login vencido e sem renovação";
    const { status } = await this.api.perfil(tok);
    if (status !== 401 && status !== 403) return null;
    const h = hashToken(atual)!;
    const desde = (this.principalRecusadaDesde[h] ??= this.agora());
    return this.agora() - desde >= PRINCIPAL_MORTA_APOS_S ? "com um login que não abre mais" : null;
  }

  private principalRecusadaDesde: Record<string, number> = {};

  /**
   * A principal ficou sem a conta `id` (o assistente saiu dela): o último login dela visto na principal vai para a pasta
   * dela quando é mais novo que o guardado, a mesma regra de quando a conta muda por fora. Sem isso ele se perderia.
   */
  private async guardarUltimaPrincipal(id: string | null): Promise<void> {
    if (!id || !this.estado.contas[id] || !this.ultimaPrincipal || this.ultimaPrincipal[0] !== id) return;
    const pasta = this.estado.contas[id]!.pasta;
    const guardada = await this.cred.ler(pasta);
    const visto = this.ultimaPrincipal[1];
    if (hashToken(visto) === hashToken(guardada) || expiraEm(visto) <= expiraEm(guardada)) return;
    await this.cred.gravar(pasta, comLogin(guardada, soLogin(visto)));
  }

  /** Cópia do login que sai da principal sem ter dono no Reveza: nada se perde, mesmo login morto. */
  private guardarCopiaDaPrincipal(atual: Blob): void {
    try {
      const pasta = path.join(this.c.base, "copias");
      fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
      const arq = path.join(pasta, `principal-${this.agora()}.json`);
      fs.writeFileSync(arq, JSON.stringify(soLogin(atual)), { mode: 0o600 });
      this.log.info(`login antigo da principal guardado em ${arq}`);
    } catch (e) {
      this.log.erro(`cópia do login antigo da principal: ${(e as Error).message}`);
    }
  }

  /** Corrida com uma sessão que renovava o token da conta que saiu: se a principal voltou para ela, refaz. */
  conferirTroca(destino: string, de: string | null, tentativa: number): Promise<void> {
    return this.geral.com(async () => {
      try {
        const blob = await this.cred.ler(PRINCIPAL);
        const perfil = blob ? await this.identidade(blob) : null;
        const id = perfil ? this.contaDoPerfil(perfil) : null;
        if (id === destino || this.estado.ativa !== destino) return;
        if (id && id === de && tentativa <= 3) {
          const pastaDe = this.estado.contas[de]!.pasta;
          await this.cred.gravar(pastaDe, comLogin(await this.cred.ler(pastaDe), soLogin(blob)));
          const alvo = await this.cred.ler(this.estado.contas[destino]!.pasta);
          await this.cred.gravar(PRINCIPAL, comLogin(blob, soLogin(alvo)));
          this.ultimaPrincipal = [destino, comLogin(blob, soLogin(alvo))];
          this.evento("info", "Uma sessão renovou o login antigo no meio da troca; refiz a troca.");
          this.relogio.agendar(() => void this.conferirTroca(destino, de, tentativa + 1), CONFERIR_TROCA_MS);
        } else if (tentativa > 3) {
          // o motivo e os ids das contas (os da nuvem) fazem a nuvem mandar o alerta pelos canais (0023)
          const nuvemDe = id ? this.estado.contas[id]?.contaId ?? null : null;
          this.evento("erro", "A troca não firmou depois de 3 tentativas; a principal continua em outra conta.",
            { motivo: "troca_falhou", de: nuvemDe, para: this.estado.contas[destino]?.contaId ?? null });
        }
      } catch (e) {
        this.log.erro(`conferir a troca: ${(e as Error).message}`);
      } finally {
        this.salvar();
      }
    });
  }

  // ------------------------------------------------------------------------------------------------ renovação

  renovarSeguro(id: string): Promise<ResultadoRenovar> {
    return this.travaConta(id).com(() => this.renovarDentro(id));
  }

  /** Renova o login de uma conta ESTACIONADA pelo próprio assistente, na pasta dela. Chamar com a trava da conta. */
  async renovarDentro(id: string): Promise<ResultadoRenovar> {
    const c = this.estado.contas[id];
    if (!c || id === this.estado.ativa) return false;
    if (this.sombra) {
      this.log.faria(`renovar o login de ${c.email}`);
      return "bloqueado";
    }
    if (!this.ganchos.podeRenovar(id)) return "bloqueado";
    const antes = expiraEm(await this.cred.ler(c.pasta));
    let morto = false;
    for (const tentativa of [0, 1] as const) {
      let r: Resultado | void;
      try {
        r = await this.cli.renovar(c.pasta, tentativa);
      } catch {
        continue;
      }
      const depois = expiraEm(await this.cred.ler(c.pasta));
      if (depois > antes && depois > this.agora() + RENOVAR_ANTES_S) {
        delete this.tropecoDesde[id];
        return true;
      }
      if (r && LOGIN_MORTO.test(`${r.saida}\n${r.erro}`)) morto = true;
    }
    return morto ? false : "momentaneo";
  }

  /**
   * A renovação tropeçou (sem o assistente dizer que o login morreu): tenta de novo em 30 minutos e só pede login depois
   * de 3 horas tropeçando. Devolve true quando chegou a hora de pedir.
   */
  private tropecou(id: string, c: ContaLocal, t: number): boolean {
    const desde = (this.tropecoDesde[id] ??= t);
    if (t - desde >= PEDIR_LOGIN_APOS_S) {
      delete this.tropecoDesde[id];
      return true;
    }
    this.ultimaLeitura[id] = t + RECUO_RENOVAR_S - LER_ESTACIONADA_S;
    c.erro = "o login não renovou agora (sem o assistente dizer que ele venceu); tento de novo em 30 min";
    return false;
  }

  // ------------------------------------------------------------------------------------------------ leitura de uso

  async lerUso(id: string, forcar = false): Promise<void> {
    const t = this.agora();
    const c = this.estado.contas[id];
    if (!c) return;
    if ((this.recuo[id] ?? 0) > t && !forcar) return;
    const ativa = id === this.estado.ativa;
    const blob = await this.cred.ler(ativa ? PRINCIPAL : c.pasta);
    let o = oauth(blob);
    if (!o.accessToken) {
      if (!ativa) {
        c.precisaLogin = true;
        c.erro = "sem login guardado";
      }
      return;
    }
    let exp = expiraEm(blob);
    if (exp && exp < t + VENCIDO_EM_S) {
      if (ativa) {
        c.erro = "token da conta em uso vencido; as sessões renovam na próxima chamada";
        return;
      }
      const r = await this.renovarSeguro(id);
      if (r === "bloqueado") {
        c.erro = this.sombra ? "modo sombra: o login precisaria ser renovado" : "o login venceu; renova quem tiver a posse";
        return;
      }
      if (r === "momentaneo" && !this.tropecou(id, c, t)) return;
      if (r !== true) {
        c.precisaLogin = true;
        c.erro = "não consegui renovar o login";
        this.evento("erro", `${c.email}: o login venceu e não renovou; entre de novo pelo painel.`, { conta: id });
        return;
      }
      const novo = await this.cred.ler(c.pasta);
      o = oauth(novo);
      exp = expiraEm(novo);
    }
    const { status, janelas } = await this.api.uso(o.accessToken!);
    this.ultimaLeitura[id] = t;
    if (id === this.estado.ativa && !ativa) return; // virou a ativa durante a leitura; o número é de antes da troca
    if (status === 200 && janelas) {
      delete this.tropecoDesde[id];
      Object.assign(c, { janelas, lidoEm: t, fonte: "api", erro: null, precisaLogin: false, tokenExpiraEm: exp || null });
    } else if (status === 429) {
      this.recuo[id] = t + RECUO_429_S;
      c.erro = "leitura de uso limitada pelo provedor; tento de novo em 10 min";
    } else if ((status === 401 || status === 403) && !ativa) {
      const r = await this.renovarSeguro(id);
      if (r === true) return this.lerUso(id, true);
      if (r === "bloqueado") {
        c.erro = `login recusado (${status}); renova quem tiver a posse`;
        return;
      }
      if (r === "momentaneo" && !this.tropecou(id, c, t)) return;
      c.precisaLogin = true;
      c.erro = `login recusado (${status})`;
    } else {
      c.erro = `leitura falhou (${status || "rede"})`;
    }
  }

  /** Uso que uma sessão mandou (de graça, ao vivo). Devolve true quando entrou. */
  medidaDaSessao(corpo: Record<string, unknown>): boolean {
    const t = this.agora();
    const ativa = this.estado.ativa;
    if (!ativa || !this.estado.contas[ativa] || t - (this.estado.trocadaEm || 0) < IGNORAR_MEDIDA_APOS_TROCA_S) return false;
    const versao = corpo.versao;
    if (versao !== null && versao !== undefined && versao !== this.estado.versao) return false;
    const janelas: Janela[] = [];
    for (const j of Array.isArray(corpo.janelas) ? corpo.janelas : []) {
      const tipo = (j as Record<string, unknown>)?.tipo;
      const pct = (j as Record<string, unknown>)?.pct;
      if (janelaDaConta(tipo) && typeof pct === "number" && Number.isFinite(pct)) {
        janelas.push({ tipo, pct: Math.round(pct * 10) / 10, resetEm: isoParaEpoch((j as Record<string, unknown>).resetEm) });
      }
    }
    if (!janelas.length) return false;
    const c = this.estado.contas[ativa]!;
    const antigas = new Map(c.janelas.map((j) => [j.tipo, j]));
    for (const j of janelas) antigas.set(j.tipo, j);
    Object.assign(c, { janelas: [...antigas.values()], lidoEm: t, fonte: "sessao", erro: null });
    this.ultimaLeitura[ativa] = t;
    return true;
  }

  /**
   * Uma sessão parou porque a conta em uso não roda o modelo dela sem créditos de uso (o Fable 5.1 numa conta Team, 22/10/2026).
   * Não marca a janela como cheia (para quem usa outro modelo a conta segue boa): marca a conta fora da escolha deste
   * computador por 6 horas e põe a sessão na fila, como no limite. Devolve a versão e se a troca já tinha acontecido.
   */
  modeloDaSessao(corpo: Record<string, unknown>): { ok: true; trocou: boolean; versao: number; anotado: boolean; modelo: string } {
    const sessao = String(corpo.sessao ?? "").slice(0, 80);
    const modelo = String(corpo.modelo ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || "?";
    const ativa = this.estado.ativa;
    if (sessao && !this.estado.fila.some((f) => f.sessao === sessao && f.estado === "aguardando")) {
      this.estado.fila.unshift({
        sessao,
        cwd: String(corpo.cwd ?? "").slice(0, 500),
        tipo: corpo.tipo === "headless" ? "headless" : "interativa",
        em: this.agora(),
        estado: "aguardando",
        conta: ativa,
      });
      this.estado.fila.splice(50);
    }
    const v = corpo.versao;
    if (typeof v === "number" && Number.isInteger(v) && v < this.estado.versao) {
      return { ok: true, trocou: true, versao: this.estado.versao, anotado: false, modelo };
    }
    if (ativa && this.estado.contas[ativa]) {
      (this.estado.semModelo ??= {})[ativa] = { modelo, ate: this.agora() + SEM_MODELO_S };
      this.evento("limite", `Uma sessão parou: ${this.estado.contas[ativa]!.email} não roda o ${modelo} sem créditos de uso.`, {
        conta: ativa,
        sessao,
        modelo,
      });
    }
    return { ok: true, trocou: false, versao: this.estado.versao, anotado: true, modelo };
  }

  /** Uma sessão bateu o limite. Devolve a versão do momento e se a troca já tinha acontecido. */
  limiteDaSessao(corpo: Record<string, unknown>): { ok: true; trocou: boolean; versao: number; anotado: boolean } {
    const sessao = String(corpo.sessao ?? "").slice(0, 80);
    const ativa = this.estado.ativa;
    if (sessao && !this.estado.fila.some((f) => f.sessao === sessao && f.estado === "aguardando")) {
      this.estado.fila.unshift({
        sessao,
        cwd: String(corpo.cwd ?? "").slice(0, 500),
        tipo: corpo.tipo === "headless" ? "headless" : "interativa",
        em: this.agora(),
        estado: "aguardando",
        conta: ativa,
      });
      this.estado.fila.splice(50);
    }
    const v = corpo.versao;
    if (typeof v === "number" && Number.isInteger(v) && v < this.estado.versao) {
      // A troca já aconteceu depois que a sessão mandou o pedido: o limite foi da conta que saiu.
      return { ok: true, trocou: true, versao: this.estado.versao, anotado: false };
    }
    if (ativa && this.estado.contas[ativa]) {
      const c = this.estado.contas[ativa]!;
      const mapa = new Map(c.janelas.map((j) => [j.tipo, j]));
      const cinco = mapa.get("five_hour") ?? { tipo: "five_hour" as const, pct: null, resetEm: null };
      mapa.set("five_hour", { ...cinco, pct: 100 });
      c.janelas = [...mapa.values()];
      c.lidoEm = this.agora();
      this.evento("limite", `Uma sessão bateu o limite em ${c.email}.`, { conta: ativa, sessao });
    }
    return { ok: true, trocou: false, versao: this.estado.versao, anotado: true };
  }

  // ------------------------------------------------------------------------------------------------ pastas

  /** Pasta de conta que ninguém acompanha: login terminado sem ninguém olhando, ou login largado. */
  async arrumarPastas(acompanhadas: Set<string>): Promise<void> {
    if (!fs.existsSync(this.c.contas)) return;
    const usadas = new Set(Object.values(this.estado.contas).map((c) => c.pasta));
    for (const nome of fs.readdirSync(this.c.contas).sort()) {
      const pasta = path.join(this.c.contas, nome);
      if (usadas.has(pasta) || acompanhadas.has(pasta)) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(pasta);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const blob = await this.cred.ler(pasta);
      if (!blob) {
        if (this.relogio.agoraMs() - st.mtimeMs > 3600_000) {
          if (this.sombra) this.log.faria(`apagar a pasta largada ${pasta}`);
          else fs.rmSync(pasta, { recursive: true, force: true });
        }
        continue;
      }
      const perfil = await this.identidade(blob);
      if (!perfil) continue;
      const existente = this.contaDoPerfil(perfil);
      if (!existente) {
        const id = this.registrar(perfil, pasta, blob, nome);
        this.evento("conexao", `${perfil.email} (${perfil.org ?? "sem organização"}) conectada.`, { conta: id });
        this.ganchos.aoConectar?.(id);
      } else if (this.estado.contas[existente]!.precisaLogin && existente !== this.estado.ativa) {
        const c = this.estado.contas[existente]!;
        if (this.sombra) {
          this.log.faria(`trocar a pasta de ${c.email} pela do login novo`);
          continue;
        }
        await this.cred.apagar(c.pasta);
        Object.assign(c, { pasta, precisaLogin: false, erro: null });
        this.evento("conexao", `${perfil.email} entrou de novo.`, { conta: existente });
      } else if (this.sombra) {
        this.log.faria(`apagar a pasta repetida ${pasta}`);
      } else {
        await this.cred.apagar(pasta);
        fs.rmSync(pasta, { recursive: true, force: true });
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ histórico

  registrarHistorico(t: number): void {
    const hist = this.estado.historico;
    for (const id of Object.keys(hist)) if (!this.estado.contas[id]) delete hist[id];
    for (const [id, c] of Object.entries(this.estado.contas)) {
      const pontos = (hist[id] ??= []);
      if (pontos.length && t - pontos[pontos.length - 1]!.t < HISTORICO_PASSO_S) continue;
      if (!c.lidoEm || t - c.lidoEm > LEITURA_VALIDA_S) continue;
      const janela = (tipo: TipoJanela) => {
        const j = c.janelas.find((x) => x.tipo === tipo);
        if (!j || j.pct === null) return null;
        return j.resetEm && j.resetEm <= t ? 0 : j.pct;
      };
      pontos.push({ t, p5: janela("five_hour"), p7: janela("seven_day") });
      while (pontos.length && t - pontos[0]!.t > HISTORICO_JANELA_S) pontos.shift();
    }
  }

  ritmo(t: number): { pctPorHora: number | null; estimativaTrocaEm: number | null } {
    const vazio = { pctPorHora: null, estimativaTrocaEm: null };
    const ativa = this.estado.ativa;
    if (!ativa || !this.estado.contas[ativa]) return vazio;
    let pontos: [number, number][] = (this.estado.historico[ativa] ?? [])
      .filter((x) => x.p5 !== null && t - x.t <= RITMO_JANELA_S)
      .map((x) => [x.t, x.p5!]);
    const c = this.estado.contas[ativa]!;
    const atual = c.janelas.find((j) => j.tipo === "five_hour");
    if (atual && atual.pct !== null && c.lidoEm && (!pontos.length || c.lidoEm > pontos[pontos.length - 1]![0])) {
      pontos.push([c.lidoEm, atual.pct]);
    }
    // depois de um reset o % cai: conta só o trecho desde a última queda
    for (let i = pontos.length - 1; i > 0; i--) {
      if (pontos[i]![1] < pontos[i - 1]![1] - 1) {
        pontos = pontos.slice(i);
        break;
      }
    }
    if (pontos.length < 2 || pontos[pontos.length - 1]![0] - pontos[0]![0] < 600) return vazio;
    const ultimo = pontos[pontos.length - 1]!;
    const horas = (ultimo[0] - pontos[0]![0]) / 3600;
    const porHora = Math.max(0, (ultimo[1] - pontos[0]![1]) / horas);
    const falta = gatilhoDeTroca(this.estado) - ultimo[1];
    const estimativa = porHora > 0.1 && falta > 0 ? Math.floor(ultimo[0] + (falta / porHora) * 3600) : null;
    return { pctPorHora: Math.round(porHora * 10) / 10, estimativaTrocaEm: estimativa };
  }

  // ------------------------------------------------------------------------------------------------ visão pública

  /** O que a ponte, a CLI e o mod mostram. Nada de segredo. */
  publico(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const t = this.agora();
    const ordem: Record<string, number> = { ativa: 0, proxima: 1, livre: 2, sem_leitura: 3, esgotada: 4, pausada: 5, precisa_login: 6 };
    const contas = Object.values(this.estado.contas)
      .map((c) => ({
        id: c.id,
        contaId: c.contaId,
        email: c.email,
        org: c.org,
        plano: c.plano,
        tier: c.tier,
        estado: estadoDaConta(this.estado, c.id, t),
        pausada: c.pausada,
        janelas: c.janelas.map((j) => ({ ...j, rotulo: ROTULOS[j.tipo] ?? j.tipo })),
        lidoEm: c.lidoEm,
        fonte: c.fonte,
        tokenExpiraEm: c.tokenExpiraEm,
        erro: c.erro,
        conectadaEm: c.conectadaEm,
      }))
      .sort((a, b) => (ordem[a.estado] ?? 9) - (ordem[b.estado] ?? 9) || a.email.localeCompare(b.email));
    return {
      agora: t,
      auto: this.estado.config.auto,
      limiares: { aviso: this.estado.config.aviso, troca: this.estado.config.troca },
      modo: this.estado.config.modo,
      rodizio: this.estado.config.rodizio,
      proximoRodizioEm: this.estado.proximoRodizioEm,
      retomarHeadless: this.estado.config.retomarHeadless,
      ativa: this.estado.ativa,
      proxima: this.estado.proxima,
      versao: this.estado.versao,
      ritmo: this.ritmo(t),
      contas,
      eventos: this.estado.eventos.slice(0, 50).map(({ em, tipo, texto }) => ({ em, tipo, texto })),
      fila: this.estado.fila.slice(0, 50).map((f) => ({ ...f, cwd: path.basename(f.cwd.replace(/[\\/]+$/, "")) })),
      ...extra,
    };
  }
}
