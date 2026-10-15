// Conectar conta pelo login oficial, numa pasta própria (~/.reveza/contas/<id> vira o CLAUDE_CONFIG_DIR dela).
// O login só vale se a conta que voltou é a pedida: o navegador já logado em outra conta autorizaria a errada.

import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import * as path from "node:path";
import type { Abertura } from "./abrir-login.js";
import type { Cli } from "./claudecli.js";
import { t } from "./i18n.js";
import { enderecoDoLogin } from "./navegador.js";
import type { Credenciais } from "./credenciais/tipos.js";
import type { Trocador } from "./troca.js";
import type { Processo } from "./util/executor.js";
import type { Relogio } from "./util/tempo.js";

export type EstadoLogin = "aguardando" | "ok" | "erro";

export interface Login {
  id: string;
  email: string | null;
  estado: EstadoLogin;
  /** O endereço para outro aparelho (o da página do código). O deste computador o agente nunca guarda. */
  url: string | null;
  /** Onde o login abriu neste computador (abrir-login.js), quando abriu. */
  janela: Abertura | null;
  mensagem: string;
  iniciadaEm: number;
  conta: string | null;
  pasta: string;
  saida: string[];
  proc: Processo;
  /** Resolve quando o login terminou e foi conferido. */
  concluido: Promise<void>;
}

// Só letras, números e . _ % + - (começando por letra ou número): um hífen na frente viraria opção na linha de comando
// do login, e nenhum caractere especial de shell chega ao programa, nem no Windows (auditoria de 11/10/2026).
export const EMAIL_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * O que dizer a quem conecta, com o endereço na mão, conforme o login abriu (ou não) neste computador. No computador,
 * entrar na conta basta: o retorno é pelo localhost e o login termina sozinho. O endereço mostrado é o de outro
 * aparelho (a página mostra um código, colado aqui); numa janela anônima não há conta aberta para entrar na errada
 * (vários perfis do Chrome, 12/10/2026).
 */
export const TEXTO_DO_LOGIN =
  "Abra o endereço do login (de preferência numa janela anônima, para não entrar com a conta que já está aberta no navegador), entre na conta e cole aqui o código que a página mostrar.";

const TEXTO_DO_LOGIN_EN =
  "Open the sign-in address (preferably in a private window, so you do not use the account already open in the browser), sign in to the account and paste the code the page shows here.";

export function textoDoLogin(janela: Abertura | null): string {
  const base = t(TEXTO_DO_LOGIN, TEXTO_DO_LOGIN_EN);
  if (!janela) return base;
  if (!janela.aberto) return t(`Não consegui abrir o navegador neste computador. ${TEXTO_DO_LOGIN}`, `I could not open the browser on this computer. ${TEXTO_DO_LOGIN_EN}`);
  const onde = janela.privado
    ? t(`numa janela anônima${janela.navegador ? ` do ${janela.navegador}` : ""}`, `in a private window${janela.navegador ? ` of ${janela.navegador}` : ""}`)
    : t("no navegador", "in the browser");
  return t(
    `Abri o login ${onde} neste computador: entre na conta e pronto, o login termina sozinho. ` +
      "Em outro aparelho? Abra o endereço, entre na conta e cole aqui o código que a página mostrar.",
    `I opened the sign-in ${onde} on this computer: sign in to the account and that's it: the sign-in finishes on its own. ` +
      "On another device? Open the address, sign in to the account and paste the code the page shows here.",
  );
}

/** O aviso que o abrir-login.js deixa na pasta: só os três campos, conferidos. */
export function lerAbertura(arquivo: string): Abertura | null {
  try {
    const a = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Record<string, unknown>;
    if (typeof a.aberto !== "boolean" || typeof a.privado !== "boolean") return null;
    const navegador = typeof a.navegador === "string" && /^[A-Za-z ]{1,40}$/.test(a.navegador) ? a.navegador : null;
    return { aberto: a.aberto, navegador, privado: a.privado };
  } catch {
    return null;
  }
}

export class Logins {
  mapa = new Map<string, Login>();

  constructor(
    private trocador: Trocador,
    private cred: Credenciais,
    private cli: Cli,
    private relogio: Relogio,
    private aoTerminar: (login: Login, id: string | null) => Promise<void>,
  ) {}

  /** Pastas com login em andamento: a arrumação de pastas não mexe nelas. */
  pastas(): Set<string> {
    return new Set([...this.mapa.values()].filter((l) => l.estado === "aguardando").map((l) => l.pasta));
  }

  publico(): Record<string, unknown>[] {
    const t = this.relogio.agora();
    return [...this.mapa.values()]
      .filter((l) => t - l.iniciadaEm < 3600)
      .map(({ id, email, estado, url, janela, mensagem, iniciadaEm }) => ({ id, email, estado, url, janela, mensagem, iniciadaEm }));
  }

  iniciar(email: string | null): Login {
    if (email !== null && !EMAIL_VALIDO.test(email)) throw new Error(t("e-mail inválido", "invalid email"));
    const id = randomBytes(16).toString("hex");
    const pasta = this.trocador.novaPasta();
    const proc = this.cli.login(pasta, email);
    const login: Login = {
      id,
      email: email ? email.toLowerCase() : null,
      estado: "aguardando",
      url: null,
      janela: null,
      mensagem: t("Abrindo o login oficial…", "Opening the official sign-in…"),
      iniciadaEm: this.relogio.agora(),
      conta: null,
      pasta,
      saida: [],
      proc,
      concluido: Promise.resolve(),
    };
    this.mapa.set(id, login);
    proc.aoLinha((linha) => {
      login.saida.push(linha.slice(0, 300));
      login.saida.splice(0, Math.max(0, login.saida.length - 40));
      // o primeiro endereço https da saída é o do login oficial para outro aparelho (o Claude Code 2.1.29x imprime "If
      // the browser didn't open, visit: https://claude.com/cai/oauth/authorize?..."); sem pontuação grudada no fim
      const m = /https:\/\/[^\s"'<>]+/.exec(linha);
      if (m && !login.url) {
        const url = enderecoDoLogin(m[0].replace(/[).,;]+$/, ""));
        if (url) {
          login.url = url;
          this.abertura(login);
          login.mensagem = textoDoLogin(login.janela);
        }
      }
    });
    login.concluido = new Promise<void>((resolve) => {
      proc.aoFim(() => void this.finalizar(login).catch(() => undefined).finally(resolve));
    });
    void this.vigiar(login);
    this.trocador.evento("conexao", `Login iniciado${email ? ` para ${email}` : ""}.`, { login: id });
    return login;
  }

  /**
   * Onde o login abriu neste computador (o aviso do abrir-login.js na pasta). O Claude Code imprime o endereço e logo
   * depois chama o navegador: o aviso chega um instante depois do endereço. Devolve se já chegou.
   */
  abertura(login: Login): boolean {
    if (login.janela) return true;
    const a = lerAbertura(path.join(login.pasta, ".login-aberto"));
    if (!a) return false;
    login.janela = a;
    if (login.url && login.estado === "aguardando") login.mensagem = textoDoLogin(a);
    return true;
  }

  /**
   * Espera o endereço para outro aparelho e, logo depois dele, o aviso de onde o login abriu neste computador (até 3 s:
   * no Windows, ou com um Claude Code que não chama o BROWSER, o aviso não vem). Desiste em `limiteS`.
   */
  async aguardarEndereco(login: Login, limiteS = 15): Promise<void> {
    const ate = this.relogio.agoraMs() + limiteS * 1000;
    let comUrl: number | null = null;
    while (login.estado === "aguardando" && this.relogio.agoraMs() < ate) {
      if (login.url) {
        if (this.abertura(login)) return;
        comUrl ??= this.relogio.agoraMs();
        if (this.relogio.agoraMs() - comUrl >= 3000) return;
      }
      await this.relogio.dormir(250);
    }
  }

  /** O login pode terminar pedindo Enter: quando a credencial aparece, confirma e encerra. Desiste em 15 min. */
  private async vigiar(login: Login): Promise<void> {
    const limite = this.relogio.agora() + 15 * 60;
    while (login.proc.vivo && login.estado === "aguardando") {
      this.abertura(login);
      if (this.relogio.agora() > limite) {
        login.proc.terminar();
        return;
      }
      if (await this.cred.ler(login.pasta)) {
        login.proc.escrever("\n");
        for (let i = 0; i < 20 && login.proc.vivo; i++) await this.relogio.dormir(500);
        if (login.proc.vivo) login.proc.terminar();
        return;
      }
      await this.relogio.dormir(2000);
    }
  }

  codigo(id: string, codigo: string): { ok: boolean; erro?: string } {
    const l = this.mapa.get(id);
    if (!l) return { ok: false, erro: t("login desconhecido", "unknown sign-in") };
    const c = codigo.trim();
    if (!c || c.length > 4000) return { ok: false, erro: t("código vazio", "empty code") };
    if (/[\r\n\0]/.test(c)) return { ok: false, erro: t("o código é uma linha só", "the code must be a single line") };
    if (!l.proc.vivo || !l.proc.escrever(c + "\n")) return { ok: false, erro: t("o login já terminou", "the sign-in has already finished") };
    return { ok: true };
  }

  /** Desligamento do agente: encerra os logins em andamento. */
  encerrar(): void {
    for (const l of this.mapa.values()) if (l.proc.vivo) l.proc.terminar();
  }

  cancelar(id: string): { ok: boolean; erro?: string } {
    const l = this.mapa.get(id);
    if (!l) return { ok: false, erro: t("login desconhecido", "unknown sign-in") };
    if (l.proc.vivo) l.proc.terminar();
    l.estado = "erro";
    l.mensagem = t("Cancelado.", "Canceled.");
    return { ok: true };
  }

  async finalizar(login: Login): Promise<void> {
    // o "navegador" e o endereço do login saem da pasta da conta (ela vira o CLAUDE_CONFIG_DIR dela)
    for (const f of [".abrir-login", ".login-aberto"]) fs.rmSync(path.join(login.pasta, f), { force: true });
    const blob = await this.cred.ler(login.pasta);
    if (!blob) {
      if (login.estado === "aguardando") {
        login.estado = "erro";
        const ultimo = [...login.saida].reverse().find((l) => l.trim()) ?? "";
        login.mensagem = t(`O login não terminou. ${ultimo}`, `The sign-in did not finish. ${ultimo}`).trim();
      }
      fs.rmSync(login.pasta, { recursive: true, force: true });
      return;
    }
    const perfil = await this.trocador.identidade(blob);
    if (!perfil) {
      login.estado = "erro";
      login.mensagem = t("Login feito, mas não consegui ler o perfil da conta.", "Signed in, but I could not read the account profile.");
      return;
    }
    const pedido = (login.email ?? "").toLowerCase();
    const entrou = (perfil.email ?? "").toLowerCase();
    if (pedido && entrou !== pedido) {
      await this.cred.apagar(login.pasta);
      fs.rmSync(login.pasta, { recursive: true, force: true });
      login.estado = "erro";
      login.mensagem = login.janela?.privado
        ? t(
            `O login entrou como ${perfil.email}, não como ${login.email}. Tente de novo e, na janela que abrir, entre com ${login.email}.`,
            `The sign-in came in as ${perfil.email}, not as ${login.email}. Try again and, in the window that opens, sign in with ${login.email}.`,
          )
        : t(
            `O navegador entrou como ${perfil.email}, não como ${login.email}. Saia da conta no navegador ` + "(ou abra o link numa janela anônima) e tente de novo.",
            `The browser signed in as ${perfil.email}, not as ${login.email}. Sign out of the account in the browser ` + "(or open the link in a private window) and try again.",
          );
      this.trocador.evento("erro", `Login pedido para ${login.email} entrou como ${perfil.email}; descartado.`, { login: login.id });
      await this.aoTerminar(login, null);
      return;
    }
    const id = await this.trocador.geral.com(async () => {
      const existente = this.trocador.contaDoPerfil(perfil);
      let id: string;
      let texto: string;
      if (existente) {
        const c = this.trocador.estado.contas[existente]!;
        const antiga = c.pasta;
        Object.assign(c, { pasta: login.pasta, precisaLogin: false, erro: null, versaoCofre: c.versaoCofre });
        if (antiga !== login.pasta) await this.cred.apagar(antiga);
        id = existente;
        texto = t(`${perfil.email} entrou de novo.`, `${perfil.email} signed in again.`);
      } else {
        id = this.trocador.registrar(perfil, login.pasta, blob);
        texto = t(`${perfil.email} (${perfil.org ?? "sem organização"}) conectada.`, `${perfil.email} (${perfil.org ?? "no organization"}) connected.`);
      }
      login.estado = "ok";
      login.mensagem = texto;
      login.conta = id;
      this.trocador.evento("conexao", texto, { conta: id, login: login.id });
      return id;
    });
    await this.aoTerminar(login, id);
  }
}
