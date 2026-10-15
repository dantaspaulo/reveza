// `reveza doctor`: confere serviço, mod, credenciais, chaveiro, nuvem, relógio e a versão do assistente.
// Aqui só se lê: cada problema sai com o conserto seguro que existe para ele (`conserto`, da lista fechada de
// conserto.ts) ou com o que a pessoa faz (`fazer`, uma linha). Quem conserta é o `consertar()` de conserto.ts.
// Saída legível e `--json` (o mesmo resultado, só lido, vai à nuvem no `agente_ola`, para a tela Saúde do painel).

import * as fs from "node:fs";
import * as path from "node:path";
import type { ApiContas } from "./anthropic.js";
import type { Cli } from "./claudecli.js";
import { VERSAO, type Caminhos } from "./config.js";
import { expiraEm, oauth } from "./credenciais/blob.js";
import { PRINCIPAL, type Credenciais } from "./credenciais/tipos.js";
import type { Guarda } from "./cofre/guarda.js";
import { idiomaAtual, t } from "./i18n.js";
import { lerChave } from "./ligar.js";
import type { StatusServico } from "./servico.js";
import { carregarEstado } from "./estado.js";

export type Situacao = "ok" | "aviso" | "falha";

/** Os únicos consertos automáticos que existem (lista fechada; nada vindo da nuvem entra aqui). */
export type IdConserto = "servico" | "mod" | "credenciais";

export interface Conferencia {
  id: string;
  nome: string;
  situacao: Situacao;
  detalhe: string;
  /** Problema com conserto automático seguro: qual. */
  conserto?: IdConserto;
  /** Problema sem conserto automático: o que fazer, em uma linha. */
  fazer?: string;
  /** Depois de um conserto (`reveza doctor`, ou o Corrigir do painel): o que aconteceu com este problema. */
  consertado?: { resultado: "corrigido" | "nao_deu"; texto: string };
}

export interface DepsDoctor {
  c: Caminhos;
  cred: Credenciais;
  guarda: Guarda;
  cli: Cli;
  api: ApiContas;
  statusServico: () => Promise<StatusServico>;
  ponte: () => Promise<Record<string, unknown> | null>;
  nuvemConfigurada: () => Promise<{ url: string } | null>;
  horaNuvem: () => Promise<number | null>;
  agora: () => number;
  versaoNode?: string;
  /** Versão mínima do assistente com a qual o agente foi provado. */
  versaoMinimaCli?: string;
  /**
   * Onde a conferência roda: no terminal (`reveza doctor`, que pode reinstalar o serviço) ou dentro do próprio agente
   * (o Corrigir do painel: o agente não reinicia a si mesmo, então serviço, ponte e nuvem ficam só explicados).
   */
  onde?: "terminal" | "agente";
  /** Instalação em modo sombra: o mod fica de fora de propósito. */
  sombra?: boolean;
  /** Instalação feita com `--sem-servico`: o serviço não é instalado sozinho. */
  semServico?: boolean;
  /** Bytes livres no disco da pasta do usuário (testes); de fábrica, lido do sistema. */
  espacoLivre?: () => number;
}

/** Abaixo disto o disco vira aviso, e abaixo de DISCO_FALHA, falha: com o disco cheio nada do agente se grava. */
export const DISCO_AVISO = 5 * 1024 ** 3;
export const DISCO_FALHA = 2 * 1024 ** 3;

export function espacoLivreEm(pasta: string): number {
  const s = fs.statfsSync(pasta);
  return Number(s.bavail) * Number(s.bsize);
}

/** Vírgula decimal no português, ponto no inglês. */
function gb(bytes: number): string {
  const n = (bytes / 1024 ** 3).toFixed(1);
  return `${idiomaAtual() === "en" ? n : n.replace(".", ",")} GB`;
}

/** O comando de instalar o assistente de código (a única menção ao nome fica na instalação e nos requisitos). */
export const INSTALAR_ASSISTENTE = "npm install -g @anthropic-ai/claude-code (ou https://claude.com/claude-code)";
const INSTALAR_ASSISTENTE_CMD = "npm install -g @anthropic-ai/claude-code";
const INSTALAR_ASSISTENTE_URL = "https://claude.com/claude-code";
/** O mesmo texto em inglês, com o "or" no lugar do "ou" (avaliado na hora do uso). */
function instalarAssistenteEn(): string {
  return `${INSTALAR_ASSISTENTE_CMD} (or ${INSTALAR_ASSISTENTE_URL})`;
}

export function compararVersao(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** O mod está carregado? Por CLAUDE_CODE_PLUGIN_DIRS no settings.json ou instalado como plugin. */
export function acharMod(home: string): string | null {
  const nomeDoMod = (pasta: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pasta, ".claude-plugin", "plugin.json"), "utf8")).name === "reveza";
    } catch {
      return false;
    }
  };
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    const dirs = String(s?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? "")
      .split(path.delimiter)
      .map((d) => d.replace(/^~/, home))
      .filter(Boolean);
    const achado = dirs.find(nomeDoMod);
    if (achado) return achado;
  } catch {
    // sem settings
  }
  try {
    const inst = JSON.parse(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    const chaves = Object.keys(inst?.plugins ?? inst ?? {});
    const k = chaves.find((x) => x === "reveza" || x.startsWith("reveza@"));
    if (k) return t(`plugin instalado (${k})`, `plugin installed (${k})`);
  } catch {
    // nenhum plugin instalado
  }
  return null;
}

export async function doctor(d: DepsDoctor): Promise<Conferencia[]> {
  const r: Conferencia[] = [];
  const add = (id: string, nome: string, situacao: Situacao, detalhe: string, extra: { conserto?: IdConserto; fazer?: string } = {}) => {
    const c: Conferencia = { id, nome, situacao, detalhe };
    // ok não precisa de conserto nem de explicação
    if (situacao !== "ok") {
      if (extra.conserto) c.conserto = extra.conserto;
      else if (extra.fazer) c.fazer = extra.fazer;
    }
    r.push(c);
  };
  const noTerminal = (d.onde ?? "terminal") === "terminal";
  // serviço, ponte e nuvem se consertam reiniciando o serviço: só pelo terminal, e nunca numa instalação sem serviço
  const peloServico = (fazerSemServico: string): { conserto?: IdConserto; fazer?: string } =>
    d.semServico
      ? {
          fazer: t(
            "esta instalação roda sem serviço (--sem-servico): rode reveza rodar, ou reveza servico instalar para o agente subir sozinho",
            "this installation runs without a service (--sem-servico): run reveza rodar, or reveza servico instalar so the agent starts by itself",
          ),
        }
      : noTerminal
        ? { conserto: "servico" }
        : { fazer: fazerSemServico };

  const node = d.versaoNode ?? process.versions.node;
  add("agente", t("Agente", "Agent"), compararVersao(node, "18.17.0") >= 0 ? "ok" : "falha", t(`versão ${VERSAO}, Node ${node}`, `version ${VERSAO}, Node ${node}`), {
    fazer: t(
      "instale um Node mais novo (20.19 ou depois, https://nodejs.org) e rode o instalador com --atualizar",
      "install a newer Node (20.19 or later, https://nodejs.org) and run the installer with --atualizar",
    ),
  });

  try {
    const livre = d.espacoLivre ? d.espacoLivre() : espacoLivreEm(d.c.home);
    add("disco", t("Disco", "Disk"), livre < DISCO_FALHA ? "falha" : livre < DISCO_AVISO ? "aviso" : "ok", t(`${gb(livre)} livres`, `${gb(livre)} free`), {
      fazer: t(
        "libere espaço neste computador: com o disco cheio, o agente não grava o estado nem o uso das contas, e o assistente de código também para",
        "free up space on this computer: with a full disk, the agent cannot save the state or the accounts' usage, and the coding assistant stops too",
      ),
    });
  } catch (e) {
    add("disco", t("Disco", "Disk"), "aviso", t(`não consegui conferir: ${(e as Error).message}`, `I could not check: ${(e as Error).message}`), {
      fazer: t("confira o espaço livre do disco deste computador", "check the free disk space on this computer"),
    });
  }

  try {
    const s = await d.statusServico();
    add(
      "servico",
      t("Serviço", "Service"),
      s.rodando ? "ok" : s.instalado ? "aviso" : "falha",
      s.instalado ? s.detalhe : t("não instalado (reveza servico instalar)", "not installed (reveza servico instalar)"),
      peloServico(
        t(
          "o agente roda fora do serviço: no terminal deste computador, rode reveza doctor (ou reveza servico instalar)",
          "the agent runs outside the service: in this computer's terminal, run reveza doctor (or reveza servico instalar)",
        ),
      ),
    );
  } catch (e) {
    add(
      "servico",
      t("Serviço", "Service"),
      "aviso",
      t(`não consegui conferir: ${(e as Error).message}`, `I could not check: ${(e as Error).message}`),
      peloServico(t("no terminal deste computador, rode reveza doctor", "in this computer's terminal, run reveza doctor")),
    );
  }

  const resposta = await d.ponte().catch(() => null);
  // outro programa na mesma porta (um gestor de contas antigo, por exemplo) responde, mas não é o agente
  const ehAgente = !!resposta && "cofre" in resposta && "nuvem" in resposta;
  const ponte = ehAgente ? resposta : null;
  add(
    "ponte",
    t("Ponte local", "Local bridge"),
    ponte ? "ok" : "falha",
    ponte
      ? t("o agente responde na porta local", "the agent responds on the local port")
      : resposta
        ? t("outro programa responde na porta do agente (use --porta, ou o modo sombra)", "another program responds on the agent's port (use --porta, or shadow mode)")
        : t("o agente não responde (está rodando?)", "the agent is not responding (is it running?)"),
    resposta
      ? { fazer: t("pare o outro programa que usa a porta do agente, ou instale o Reveza em modo sombra (--sombra)", "stop the other program that uses the agent's port, or install Reveza in shadow mode (--sombra)") }
      : peloServico(t("no terminal deste computador, rode reveza doctor", "in this computer's terminal, run reveza doctor")),
  );

  const mod = acharMod(d.c.home);
  const assistente = await d.cli.versao().catch(() => null);
  add(
    "mod",
    t("Mod das sessões", "Session mod"),
    mod ? "ok" : "aviso",
    mod
      ? mod
      : d.sombra
        ? t("fora no modo sombra (dois mods nas mesmas sessões disputariam a linha de status)", "off in shadow mode (two mods in the same sessions would fight over the status line)")
        : t("o mod não está carregado nas sessões (uso ao vivo e retomada ficam sem)", "the mod is not loaded in the sessions (live usage and resume are missing)"),
    d.sombra
      ? { fazer: t("o mod entra quando sair do modo sombra: rode o instalador com --atualizar --sair-da-sombra", "the mod comes in when you leave shadow mode: run the installer with --atualizar --sair-da-sombra") }
      : !assistente
        ? { fazer: t(`instale o assistente de código primeiro: ${INSTALAR_ASSISTENTE}`, `install the coding assistant first: ${instalarAssistenteEn()}`) }
        : { conserto: "mod" },
  );

  const estado = carregarEstado(d.c.estado);
  const contas = Object.values(estado.contas);
  const nuvem = await d.nuvemConfigurada().catch(() => null);
  // tem para onde trocar: com nuvem, a conta que ela atribuir (vem do cofre); sem nuvem, uma conta daqui com login
  const temConta = !!nuvem || contas.some((c) => !c.precisaLogin && !c.pausada);
  const credencialConserto: { conserto?: IdConserto; fazer?: string } = temConta
    ? { conserto: "credenciais" }
    : contas.length
      ? { fazer: t("nenhuma conta com login neste computador: entre de novo numa delas (reveza contas conectar <email>)", "no account signed in on this computer: sign in again on one of them (reveza contas conectar <email>)") }
      : { fazer: t("conecte uma conta neste computador: reveza contas conectar <email>", "connect an account on this computer: reveza contas conectar <email>") };
  try {
    const blob = await d.cred.ler(PRINCIPAL);
    const o = oauth(blob);
    // a conta que a nuvem mandou está para chegar (o agente acabou de subir, ou a troca vem na próxima busca): aviso,
    // não falha; o conserto (pedir a troca agora) segue valendo
    const esperando = (ponte?.credencial as { esperandoConta?: unknown } | undefined)?.esperandoConta === true;
    if (!o.accessToken && esperando) {
      add(
        "credenciais",
        t("Credencial em uso", "Credential in use"),
        "aviso",
        t(`nenhum login em ${d.cred.nome(PRINCIPAL)}; esperando a conta que a nuvem mandou chegar`, `no login in ${d.cred.nome(PRINCIPAL)}; waiting for the account the cloud sent to arrive`),
        credencialConserto,
      );
    } else if (!o.accessToken) {
      add("credenciais", t("Credencial em uso", "Credential in use"), "falha", t(`nenhum login em ${d.cred.nome(PRINCIPAL)}`, `no login in ${d.cred.nome(PRINCIPAL)}`), credencialConserto);
    }
    else {
      const falta = expiraEm(blob) - d.agora();
      const perfil = await d.api.perfil(o.accessToken);
      const quem = perfil.perfil?.email ?? (perfil.status ? t(`perfil respondeu ${perfil.status}`, `profile responded ${perfil.status}`) : t("sem rede para conferir o perfil", "no network to check the profile"));
      // dentro da validade e recusado: o login foi revogado (vencido, a API recusa sempre: não diz nada)
      const recusado = falta > 0 && (perfil.status === 401 || perfil.status === 403);
      // vencido e sem renovação: o assistente não consegue usá-lo de jeito nenhum
      const morto = falta <= 0 && !o.refreshToken;
      add(
        "credenciais",
        t("Credencial em uso", "Credential in use"),
        morto ? "falha" : falta > 0 && !recusado ? "ok" : "aviso",
        t(
          `${quem}; token ${falta > 0 ? `vence em ${Math.round(falta / 60)} min` : morto ? "vencido e sem conserto pelas sessões" : "vencido (as sessões renovam na próxima chamada)"}`,
          `${quem}; token ${falta > 0 ? `expires in ${Math.round(falta / 60)} min` : morto ? "expired and the sessions cannot fix it" : "expired (the sessions renew it on the next call)"}`,
        ),
        morto
          ? credencialConserto
          : recusado
            ? { fazer: t("o login em uso foi recusado: entre de novo nessa conta pelo painel (Contas, Entrar de novo)", "the login in use was refused: sign in again to that account from the panel (Accounts, Sign in again)") }
            : { fazer: t("nada a fazer agora: a próxima chamada das sessões renova o login", "nothing to do right now: the sessions' next call renews the login") },
      );
    }
  } catch (e) {
    add("credenciais", t("Credencial em uso", "Credential in use"), "falha", t(`não consegui ler: ${(e as Error).message}`, `I could not read: ${(e as Error).message}`), {
      fazer: t(
        "o chaveiro do sistema não respondeu: destrave-o (ou reinicie a sessão do usuário) e confira de novo",
        "the system keychain did not respond: unlock it (or restart the user session) and check again",
      ),
    });
  }

  const semLogin: string[] = [];
  for (const c of contas) if (!(await d.cred.ler(c.pasta).catch(() => null)) && c.id !== estado.ativa) semLogin.push(c.email);
  const precisam = contas.filter((c) => c.precisaLogin).map((c) => c.email);
  add(
    "contas",
    t("Contas", "Accounts"),
    !contas.length ? "aviso" : semLogin.length || precisam.length ? "aviso" : "ok",
    !contas.length
      ? t("nenhuma conta conectada", "no account connected")
      : t(`${contas.length} conta(s)`, `${contas.length} account(s)`) +
          (precisam.length ? t(`; precisam entrar de novo: ${precisam.join(", ")}`, `; need to sign in again: ${precisam.join(", ")}`) : "") +
          (semLogin.length ? t(`; sem login guardado: ${semLogin.join(", ")}`, `; no login stored: ${semLogin.join(", ")}`) : ""),
    {
      fazer: !contas.length
        ? nuvem
          ? t(
              "as contas chegam pela nuvem quando ela atribuir uma a este computador; para uma nova: Contas, Conectar, no painel",
              "the accounts arrive through the cloud when it assigns one to this computer; for a new one: Accounts, Connect account, in the panel",
            )
          : t("conecte uma conta: reveza contas conectar <email>", "connect an account: reveza contas conectar <email>")
        : t(
            "entre de novo nessas contas pelo painel (Contas, Entrar de novo) ou com reveza contas conectar <email>",
            "sign in again to these accounts from the panel (Accounts, Sign in again) or with reveza contas conectar <email>",
          ),
    },
  );

  try {
    const k = await lerChave(d.guarda);
    add(
      "chaveiro",
      t("Chaveiro e cofre", "Keychain and vault"),
      d.guarda.aviso ? "aviso" : k ? "ok" : "aviso",
      t(
        `${d.guarda.tipo}${k ? ", chave do cofre presente" : ", sem a chave do cofre (reveza ligar)"}${d.guarda.aviso ? `. ${d.guarda.aviso}` : ""}`,
        `${d.guarda.tipo}${k ? ", vault key present" : ", no vault key (reveza ligar)"}${d.guarda.aviso ? `. ${d.guarda.aviso}` : ""}`,
      ),
      {
        fazer: !k
          ? t(
              "ligue este computador ao cofre pelo painel (Computadores, Ligar computador novo) ou com reveza ligar",
              "link this computer to the vault from the panel (Computers, Link new computer) or with reveza ligar",
            )
          : (d.guarda.aviso ?? undefined),
      },
    );
  } catch (e) {
    add("chaveiro", t("Chaveiro e cofre", "Keychain and vault"), "falha", t(`não consegui ler: ${(e as Error).message}`, `I could not read: ${(e as Error).message}`), {
      fazer: t(
        "o chaveiro do sistema não respondeu: destrave-o (ou reinicie a sessão do usuário) e confira de novo",
        "the system keychain did not respond: unlock it (or restart the user session) and check again",
      ),
    });
  }

  let horaServidor: number | null = null;
  if (!nuvem) {
    add("nuvem", t("Nuvem", "Cloud"), "aviso", t("sem nuvem configurada: o agente decide sozinho neste computador", "no cloud set up: the agent decides by itself on this computer"), {
      fazer: t(
        "para ter o painel: rode o instalador com --com-nuvem (ou --ligar, para entrar numa instalação que já existe)",
        "to have the panel: run the installer with --com-nuvem (or --ligar, to join an installation that already exists)",
      ),
    });
  } else {
    horaServidor = await d.horaNuvem().catch(() => null);
    const online = (ponte?.nuvem as Record<string, unknown> | undefined)?.online;
    add(
      "nuvem",
      t("Nuvem", "Cloud"),
      horaServidor !== null && online !== false ? "ok" : "falha",
      t(
        `${nuvem.url}${horaServidor === null ? " não responde" : " responde"}${online === false ? "; o agente está sem falar com ela" : ""}`,
        `${nuvem.url}${horaServidor === null ? " is not responding" : " is responding"}${online === false ? "; the agent is not talking to it" : ""}`,
      ),
      horaServidor === null
        ? { fazer: t("confira a internet deste computador; com ela funcionando, veja se o projeto no Supabase está ativo", "check this computer's internet; with it working, see whether the project on Supabase is active") }
        : peloServico(t("no terminal deste computador, rode reveza doctor", "in this computer's terminal, run reveza doctor")),
    );
  }

  if (horaServidor !== null) {
    const desvio = Math.abs(horaServidor - d.agora());
    add(
      "relogio",
      t("Relógio", "Clock"),
      desvio <= 120 ? "ok" : "falha",
      t(
        `diferença de ${desvio} s para o servidor${desvio > 120 ? " (acerte o relógio: comandos expiram e o login confere a hora)" : ""}`,
        `${desvio} s off from the server${desvio > 120 ? " (fix the clock: commands expire and the login checks the time)" : ""}`,
      ),
      {
        fazer: t(
          "acerte a data e a hora do sistema (ligue o acerto automático pela internet); o Reveza não mexe nisso",
          "set the system date and time (turn on automatic time from the internet); Reveza does not touch this",
        ),
      },
    );
  } else {
    add("relogio", t("Relógio", "Clock"), "aviso", t("sem servidor para comparar", "no server to compare with"), {
      fazer: t("confere quando a nuvem responder", "checked once the cloud responds"),
    });
  }

  const minima = d.versaoMinimaCli ?? "2.1.0";
  const v = assistente;
  add(
    "assistente",
    t("Assistente de código", "Coding assistant"),
    !v ? "falha" : compararVersao(v, minima) >= 0 ? "ok" : "aviso",
    v
      ? t(
          `versão ${v}${compararVersao(v, minima) < 0 ? ` (o agente foi provado a partir da ${minima})` : ""}`,
          `version ${v}${compararVersao(v, minima) < 0 ? ` (the agent was tested from ${minima} on)` : ""}`,
        )
      : t(`não achei o programa em ${d.cli.binario()}`, `I could not find the program at ${d.cli.binario()}`),
    {
      fazer: v
        ? t(`atualize o assistente de código: claude update (ou ${INSTALAR_ASSISTENTE})`, `update the coding assistant: claude update (or ${instalarAssistenteEn()})`)
        : t(`instale o assistente de código: ${INSTALAR_ASSISTENTE}`, `install the coding assistant: ${instalarAssistenteEn()}`),
    },
  );
  return r;
}

export function textoDoctor(r: Conferencia[]): string {
  // as marcas têm a mesma largura nos dois idiomas, para as colunas seguirem alinhadas
  const marca: Record<Situacao, string> = idiomaAtual() === "en" ? { ok: "ok   ", aviso: "warn ", falha: "FAIL " } : { ok: "ok   ", aviso: "aviso", falha: "FALHA" };
  const linhas = r.map((c) => {
    const depois = c.consertado
      ? c.consertado.resultado === "corrigido"
        ? t(` → corrigido: ${c.consertado.texto}`, ` → fixed: ${c.consertado.texto}`)
        : t(` → não deu: ${c.consertado.texto}`, ` → not fixed: ${c.consertado.texto}`)
      : c.situacao !== "ok" && c.fazer
        ? t(` → o que fazer: ${c.fazer}`, ` → what to do: ${c.fazer}`)
        : c.situacao !== "ok" && c.conserto
          ? t(" → tem conserto: rode reveza doctor (sem --so-ver)", " → has a fix: run reveza doctor (without --so-ver)")
          : "";
    return `${marca[c.situacao]}  ${c.nome.padEnd(22)} ${c.detalhe}${depois}`;
  });
  const falhas = r.filter((c) => c.situacao === "falha").length;
  const avisos = r.filter((c) => c.situacao === "aviso").length;
  const corrigidos = r.filter((c) => c.consertado?.resultado === "corrigido").length;
  const naoDeu = r.filter((c) => c.consertado?.resultado === "nao_deu").length;
  linhas.push(
    "",
    falhas
      ? t(`${falhas} falha(s), ${avisos} aviso(s).`, `${falhas} failure(s), ${avisos} warning(s).`)
      : avisos
        ? t(`Tudo funcionando, com ${avisos} aviso(s).`, `Everything works, with ${avisos} warning(s).`)
        : t("Tudo certo.", "All good."),
  );
  if (corrigidos || naoDeu) linhas.push(t(`Conserto: ${corrigidos} corrigido(s), ${naoDeu} não deu.`, `Fix: ${corrigidos} fixed, ${naoDeu} not fixed.`));
  return linhas.join("\n");
}
