#!/usr/bin/env node
// `reveza`: a linha de comando do agente. `reveza rodar` é o agente em si (o serviço chama este comando).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Agente } from "./agente.js";
import { lerJanela } from "./resumo.js";
import { ApiAnthropic, ROTULOS, type ApiContas } from "./anthropic.js";
import { ClaudeCli, type Cli } from "./claudecli.js";
import { caminhos, PORTA_PADRAO, PORTA_SOMBRA, sistemaAtual, VERSAO, type Caminhos, type Sistema } from "./config.js";
import { credenciaisDoSistema } from "./credenciais/index.js";
import type { Credenciais } from "./credenciais/tipos.js";
import { guardaDoSistema, SEGREDO_COFRE, type Guarda } from "./cofre/guarda.js";
import { doctor, textoDoctor, type DepsDoctor } from "./doctor.js";
import { ambienteDoUsuario, consertar, instalarMod, pastaDoPrograma, resumoConserto } from "./conserto.js";
import { GithubOficial } from "./atualizar.js";
import { abrirTokens, avisoCompleta, cifrarTokens, conferirTokens, refDaNuvem, tokenValido, type Tokens } from "./completa.js";
import { carregarEstado, type EstadoLocal } from "./estado.js";
import { importar } from "./importar.js";
import { iniciarCofre, lerChave, liberarComputadorNovo, pedirParaEntrar, publicarLigacao, receberLigacao, impressaoDaChave } from "./ligar.js";
import { letreiro } from "./letreiro.js";
import { NuvemRpc } from "./nuvem/rpc.js";
import { guardarIdentidade, lerIdentidade, rpcSupabase } from "./nuvem/supabase.js";
import type { Nuvem } from "./nuvem/tipos.js";
import { chaveDaPonte, pedirPonte } from "./ponte.js";
import { Contador } from "./registro/contador.js";
import * as servico from "./servico.js";
import { executorReal, type Executor } from "./util/executor.js";
import { gravarJson, lerJson } from "./util/arquivos.js";
import { logEmArquivo } from "./util/log.js";
import { relogioReal, type Relogio } from "./util/tempo.js";
import { idiomaAtual, resolverIdioma, t, usarIdioma } from "./i18n.js";

export interface Ambiente {
  c: Caminhos;
  sistema: Sistema;
  exec: Executor;
  relogio: Relogio;
  saida: (t: string) => void;
  erro: (t: string) => void;
  perguntar: (pergunta: string) => Promise<string>;
  env: NodeJS.ProcessEnv;
  script: string;
  /** Pergunta sem mostrar o que se digita (token). Sem terminal, devolve vazio. */
  perguntarSegredo?: (pergunta: string) => Promise<string>;
  /** Toda a entrada padrão (os tokens que o instalador manda com --stdin). */
  lerEntrada?: () => Promise<string>;
  /** Para conferir os tokens (os testes trocam). */
  fetch?: typeof fetch;
  /** Os testes trocam qualquer peça por um falso. */
  fabricas?: {
    cred?: () => Credenciais;
    guarda?: () => Promise<Guarda>;
    api?: () => ApiContas;
    cli?: () => Cli;
    nuvem?: () => Promise<Nuvem | null>;
  };
}

export function ambienteReal(): Ambiente {
  return {
    c: caminhos(),
    sistema: sistemaAtual(),
    exec: executorReal,
    relogio: relogioReal,
    saida: (t) => process.stdout.write(t + "\n"),
    erro: (t) => process.stderr.write(t + "\n"),
    perguntar: (pergunta) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(pergunta, (r) => {
          rl.close();
          resolve(r);
        });
      }),
    env: process.env,
    script: fileURLToPath(import.meta.url),
    perguntarSegredo: segredoDoTerminal,
    lerEntrada: () =>
      new Promise((resolve, reject) => {
        let d = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (x: string) => {
          d += x;
          if (d.length > 64 * 1024) reject(new Error(t("entrada grande demais", "input too large")));
        });
        process.stdin.on("end", () => resolve(d));
        process.stdin.on("error", reject);
      }),
  };
}

/** Lê um segredo do terminal em modo cru, mostrando só pontos (o readline ecoaria). Sem terminal: vazio. */
function segredoDoTerminal(pergunta: string): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve("");
  process.stderr.write(pergunta);
  return new Promise((resolve) => {
    let v = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const fim = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", ao);
      process.stderr.write("\n");
      resolve(v.trim());
    };
    const ao = (bloco: string) => {
      for (const ch of bloco) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return fim();
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") v = v.slice(0, -1);
        else {
          v += ch;
          process.stderr.write("•");
        }
      }
    };
    process.stdin.on("data", ao);
  });
}

interface Args {
  pos: string[];
  flags: Record<string, string | true>;
}

export function lerArgs(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  const comValor = new Set(["porta", "de", "dias", "frase", "idioma", "url", "chave-publica", "email", "painel"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (comValor.has(k) && i + 1 < argv.length) flags[k] = argv[++i]!;
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/** A ajuda: em português (o padrão) ou em inglês, já montada no idioma do processo. */
function ajuda(): string {
  return t(AJUDA_PT, AJUDA_EN);
}

const AJUDA_PT = `reveza ${VERSAO}: o agente do Reveza AI neste computador

Uso: reveza <comando> [opções]

  status [--json]                 o que está em uso, o estado de cada conta e os últimos eventos
  contas [--json]                 as contas deste computador
  contas conectar <email>         login oficial de uma conta nova, numa janela anônima deste computador (termina
                                 sozinho); mostra também o endereço para outro aparelho e aceita o código aqui
  contas adotar                   adota a conta que já está em uso
  trocar <email> [--local]        troca a conta em uso (com nuvem, quem decide é o painel)
  som [ligar|desligar|testar]     som do sistema quando este computador troca de conta (ligado de fábrica)
  resumo [180k|desligar]          perto de quantos tokens o assistente resume a conversa nas contas que não são 20x
                                 (de fábrica, 180k: evita sessão travada e faz a conta durar mais)
  uso [--dias N] [--csv|--json]   tokens e custo equivalente por dia, conta, modelo e projeto
  doctor [--so-ver] [--json]      confere serviço, mod, credenciais, chaveiro, nuvem, relógio e versões, e conserta o que
                                  tem conserto seguro (serviço, mod, conta em uso sem login); --so-ver só confere
  ligar                           no computador novo: pede para entrar e mostra um código de 12 caracteres
  ligar XXXX-XXXX-YYYY            no computador que já usa o Reveza: libera o computador novo que mostra este código
  ligar --mostrar-frase           emergência: 6 palavras para um computador já ligado que perdeu a chave do cofre
  ligar --frase "..."             emergência: recebe a chave do cofre pelas 6 palavras (só computador já ligado)
  servico instalar|remover|status [--sombra] [--json]
  importar --de <pasta>           copia contas, credenciais e histórico de outro gestor (nada é apagado)
  cofre iniciar                   cria a chave do cofre no primeiro computador
  nuvem entrar --url U --chave-publica K --email E    guarda a identidade deste computador (senha pelo stdin)
  nuvem identidade                o endereço da nuvem deste computador, em JSON (sem e-mail nem senha); null sem nuvem
  atualizacao-completa ligar|desligar|status [--stdin]
                                  funções da nuvem e painel novos vão ao ar sozinhos: os tokens do Supabase e da Vercel
                                  ficam na nuvem cifrados com a chave do cofre (desligada de fábrica; pede sem eco)
  rodar [--sombra] [--porta N] [--sem-nuvem]          o agente em si (o serviço chama este; no Windows, com --vigiar-pai)

  --idioma pt|en   o idioma do que o Reveza mostra (de fábrica, o da instalação)
  --sombra   lê e decide, mas não grava credencial, não pega posse e não responde comando; registra o que faria`;

const AJUDA_EN = `reveza ${VERSAO}: the Reveza AI agent on this computer

Usage: reveza <command> [options]

  status [--json]                 what is in use, the state of each account and the latest events
  contas [--json]                 the accounts on this computer
  contas conectar <email>         official sign-in for a new account, in a private window on this computer
                                 (it finishes on its own); it also shows the address for another device and
                                 accepts the code here
  contas adotar                   adopts the account already in use
  trocar <email> [--local]        switch accounts (with the cloud, the panel decides)
  som [ligar|desligar|testar]     system sound when this computer switches accounts (on by default)
  resumo [180k|desligar]          around how many tokens the coding assistant summarizes the conversation on
                                 accounts that are not 20x (default 180k: avoids a stuck session and makes the
                                 account last longer)
  uso [--dias N] [--csv|--json]   tokens and equivalent cost per day, account, model and project
  doctor [--so-ver] [--json]      checks service, mod, credentials, keychain, cloud, clock and versions, and fixes
                                  what has a safe fix (service, mod, account in use without a login); --so-ver only checks
  ligar                           on the new computer: asks to sign in and shows a 12-character code
  ligar XXXX-XXXX-YYYY            on the computer that already uses Reveza: lets in the new computer that shows this code
  ligar --mostrar-frase           emergency: 6 words for a computer already linked that lost the vault key
  ligar --frase "..."             emergency: receives the vault key through the 6 words (only a linked computer)
  servico instalar|remover|status [--sombra]
  importar --de <pasta>           copies accounts, credentials and history from another manager (nothing is erased)
  cofre iniciar                   creates the vault key on the first computer
  nuvem entrar --url U --chave-publica K --email E    stores this computer's identity (password from stdin)
  atualizacao-completa ligar|desligar|status [--stdin]
                                  new cloud functions and panel go live by themselves: the Supabase and Vercel
                                  tokens stay in the cloud encrypted with the vault key (off by default; asks
                                  without echo)
  rodar [--sombra] [--porta N] [--sem-nuvem]          the agent itself (the service calls this one; on Windows, with --vigiar-pai)

  --idioma pt|en   the language Reveza shows (by default, the installation's)
  --sombra   reads and decides, but does not write credentials, does not take ownership and does not respond
             commands; it logs what it would do`;

interface InfoPonte {
  porta: number;
  pid: number;
  sombra: boolean;
}

function arquivoPonte(c: Caminhos): string {
  return path.join(c.base, "ponte.json");
}

function portaDe(amb: Ambiente, a: Args): number {
  const f = a.flags.porta;
  if (typeof f === "string" && /^\d+$/.test(f)) return Number(f);
  if (amb.env.REVEZA_PORTA && /^\d+$/.test(amb.env.REVEZA_PORTA)) return Number(amb.env.REVEZA_PORTA);
  const info = lerJson<InfoPonte>(arquivoPonte(amb.c));
  if (info?.porta) return info.porta;
  return a.flags.sombra ? PORTA_SOMBRA : PORTA_PADRAO;
}

async function pecas(amb: Ambiente) {
  const cred = amb.fabricas?.cred?.() ?? credenciaisDoSistema(amb.sistema, amb.exec, amb.c);
  const guarda = (await amb.fabricas?.guarda?.()) ?? (await guardaDoSistema(amb.sistema, amb.exec, amb.c.segredos));
  const cli = amb.fabricas?.cli?.() ?? new ClaudeCli(amb.exec);
  const api = amb.fabricas?.api?.() ?? new ApiAnthropic((await cli.versao().catch(() => null)) ?? undefined);
  return { cred, guarda, cli, api };
}

async function nuvemDe(amb: Ambiente, guarda: Guarda, manter: boolean): Promise<Nuvem | null> {
  if (amb.fabricas?.nuvem) return amb.fabricas.nuvem();
  const id = await lerIdentidade(guarda);
  return id ? new NuvemRpc(await rpcSupabase(id, manter)) : null;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "?" : `${Math.round(v)}%`;
}

function hora(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** O estado da conta como a pessoa lê; o estado cru (chave) continua sendo o código que a ponte manda. */
function rotuloEstado(estado: string): string {
  const rotulos: Record<string, [string, string]> = {
    ativa: ["em uso", "in use"],
    proxima: ["próxima", "next"],
    livre: ["livre", "free"],
    esgotada: ["esgotada", "exhausted"],
    pausada: ["pausada", "paused"],
    precisa_login: ["precisa entrar de novo", "needs to sign in again"],
    sem_leitura: ["sem leitura", "no reading"],
  };
  const r = rotulos[estado];
  return r ? t(r[0], r[1]) : estado;
}

type ContaPublica = {
  email: string;
  org: string | null;
  estado: string;
  erro: string | null;
  janelas: { tipo: keyof typeof ROTULOS; pct: number | null; resetEm: number | null }[];
};

/** Os dias da semana do reset que está a mais de um dia, abreviados como no calendário do sistema. */
const DIAS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** O rótulo de uma janela: o que a pessoa lê aqui (o ROTULOS é dado enviado ao painel, que traduz por tipo). */
function rotuloJanela(tipo: string): string {
  const rotulos: Record<string, [string, string]> = {
    five_hour: [ROTULOS.five_hour, "5 hours"],
    seven_day: [ROTULOS.seven_day, "Week"],
    seven_day_opus: [ROTULOS.seven_day_opus, "Week, larger model"],
    seven_day_sonnet: [ROTULOS.seven_day_sonnet, "Week, medium model"],
  };
  const r = rotulos[tipo];
  return r ? t(r[0], r[1]) : tipo;
}

/** A janela como a pessoa entende: o reset que já passou mostra 0%, e o que está a mais de um dia leva o dia. */
export function textoJanela(x: { tipo: string; pct: number | null; resetEm: number | null }, agora: number): string {
  const rotulo = rotuloJanela(x.tipo);
  if (x.resetEm && x.resetEm <= agora) return t(`${rotulo} 0% (renovou ${hora(x.resetEm)})`, `${rotulo} 0% (reset ${hora(x.resetEm)})`);
  const dias = idiomaAtual() === "en" ? DIAS_EN : DIAS_PT;
  const quando = x.resetEm ? (x.resetEm - agora > 20 * 3600 ? `${dias[new Date(x.resetEm * 1000).getDay()]} ${hora(x.resetEm)}` : hora(x.resetEm)) : null;
  return t(`${rotulo} ${pct(x.pct)}${quando ? ` (renova ${quando})` : ""}`, `${rotulo} ${pct(x.pct)}${quando ? ` (resets ${quando})` : ""}`);
}

export function linhaConta(c: ContaPublica, agora: number = Math.floor(Date.now() / 1000)): string {
  const j = c.janelas
    .filter((x) => x.pct !== null)
    .map((x) => textoJanela(x, agora))
    .join(", ");
  return `${c.estado === "ativa" ? "*" : "-"} ${c.email}${c.org ? ` (${c.org})` : ""}: ${rotuloEstado(c.estado)}. ${j || t("sem leitura ainda", "no reading yet")}${c.erro ? ` [${c.erro}]` : ""}`;
}

function estadoOffline(amb: Ambiente): Record<string, unknown> {
  const e: EstadoLocal = carregarEstado(amb.c.estado);
  return {
    parado: true,
    auto: e.config.auto,
    modo: e.config.modo,
    limiares: { aviso: e.config.aviso, troca: e.config.troca },
    ativa: e.ativa,
    contas: Object.values(e.contas).map((c) => ({ ...c, estado: c.id === e.ativa ? "ativa" : c.precisaLogin ? "precisa_login" : c.pausada ? "pausada" : "livre" })),
    eventos: e.eventos.slice(0, 10),
  };
}

async function cmdStatus(amb: Ambiente, a: Args, soContas: boolean): Promise<number> {
  const porta = portaDe(amb, a);
  const r = await pedirPonte(porta, "GET", "/api/estado", undefined, chaveDaPonte(amb.c.ponteChave, false));
  const est = (r?.status === 200 ? r.corpo : estadoOffline(amb)) as Record<string, unknown>;
  if (a.flags.json) {
    amb.saida(JSON.stringify(soContas ? est.contas : est, null, 1));
    return 0;
  }
  const contas = (est.contas ?? []) as ContaPublica[];
  if (!soContas) {
    const nuvem = est.nuvem as { ligada?: boolean; online?: boolean | null } | undefined;
    const lim = est.limiares as { aviso: number; troca: number };
    amb.saida(
      t(
        `Agente: ${est.parado ? "parado (mostrando o último estado salvo)" : `rodando na porta ${porta}${est.sombra ? ", modo sombra" : ""}`}`,
        `Agent: ${est.parado ? "stopped (showing the last saved state)" : `running on port ${porta}${est.sombra ? ", shadow mode" : ""}`}`,
      ) +
        t(
          nuvem?.ligada
            ? ` · nuvem ${nuvem.online === false ? "fora do ar" : nuvem.online ? "online" : "conectando"}`
            : est.parado
              ? ""
              : " · sem nuvem",
          nuvem?.ligada
            ? ` · cloud ${nuvem.online === false ? "down" : nuvem.online ? "online" : "connecting"}`
            : est.parado
              ? ""
              : " · no cloud",
        ),
    );
    amb.saida(
      t(
        `Troca automática ${est.auto ? "ligada" : "desligada"} · modo ${est.modo === "limite" ? "só no limite" : est.modo === "rodizio" ? "rodízio" : `limiar (aviso ${lim?.aviso}%, troca ${lim?.troca}%)`}`,
        `Auto switch ${est.auto ? "on" : "off"} · mode ${est.modo === "limite" ? "only at the limit" : est.modo === "rodizio" ? "rotation" : `threshold (warning ${lim?.aviso}%, switch ${lim?.troca}%)`}`,
      ),
    );
  }
  if (!contas.length) amb.saida(t("Nenhuma conta conectada. Use: reveza contas conectar <email>", "No account connected. Run: reveza contas conectar <email>"));
  for (const c of contas) amb.saida(linhaConta(c));
  if (!soContas) {
    const eventos = ((est.eventos ?? []) as { em: number; texto: string }[]).slice(0, 5);
    if (eventos.length) {
      amb.saida(t("\nÚltimos eventos:", "\nLatest events:"));
      for (const e of eventos) amb.saida(`  ${new Date(e.em * 1000).toLocaleString(idiomaAtual())}  ${e.texto}`);
    }
  }
  return 0;
}

/** reveza som [ligar|desligar|testar]: o som do sistema quando este computador troca de conta. */
async function cmdSom(amb: Ambiente, a: Args): Promise<number> {
  const acao = a.pos[1] ?? "";
  if (acao && !["ligar", "desligar", "testar"].includes(acao)) {
    amb.erro(t("uso: reveza som [ligar|desligar|testar]", "usage: reveza som [ligar|desligar|testar]"));
    return 2;
  }
  const corpo = acao === "testar" ? { testar: true } : acao ? { ligado: acao === "ligar" } : {};
  const r = await pedirPonte(portaDe(amb, a), "POST", "/api/som", corpo, chaveDaPonte(amb.c.ponteChave, false));
  if (!r) {
    amb.erro(t("o agente não está rodando", "the agent is not running"));
    return 1;
  }
  const c = r.corpo as { ligado?: boolean; tocou?: boolean | null };
  amb.saida(
    t(
      `som na troca de conta: ${c.ligado ? "ligado" : "desligado"}${c.tocou === false ? " (este sistema não tem tocador de som)" : ""}`,
      `sound when switching accounts: ${c.ligado ? "on" : "off"}${c.tocou === false ? " (this system has no sound player)" : ""}`,
    ),
  );
  return 0;
}

/**
 * reveza resumo [180k|desligar]: perto de quantos tokens o assistente resume a conversa nas contas que não são 20x
 * (nas de 20x fica o automático dele). Ver resumo.ts.
 */
async function cmdResumo(amb: Ambiente, a: Args): Promise<number> {
  const acao = a.pos[1] ?? "";
  let corpo: Record<string, unknown> = {};
  if (acao === "desligar") corpo = { tokens: false };
  else if (acao) {
    const n = lerJanela(acao);
    if (n === null) {
      amb.erro(t("uso: reveza resumo [180k|desligar] (de 100k a 1m tokens)", "usage: reveza resumo [180k|desligar] (from 100k to 1m tokens)"));
      return 2;
    }
    corpo = { tokens: n };
  }
  const r = await pedirPonte(portaDe(amb, a), "POST", "/api/resumo", corpo, chaveDaPonte(amb.c.ponteChave, false));
  if (!r) {
    amb.erro(t("o agente não está rodando", "the agent is not running"));
    return 1;
  }
  const c = r.corpo as { ok?: boolean; erro?: string; tokens?: number | false; emUso?: number | null; contaGrande?: boolean; conta?: string | null };
  if (!c.ok) {
    amb.erro(c.erro ?? t("o agente recusou", "the agent refused"));
    return 1;
  }
  if (c.tokens === false) amb.saida(t("resumo da conversa: desligado (o assistente de código usa o automático dele)", "conversation summary: off (the coding assistant uses its own default)"));
  else {
    const mil = Math.round((c.tokens ?? 0) / 1000);
    amb.saida(t(`resumo da conversa: perto de ${mil} mil tokens nas contas que não são 20x`, `conversation summary: around ${mil}k tokens on accounts that are not 20x`));
  }
  if (c.conta) {
    amb.saida(
      c.emUso
        ? t(`agora (${c.conta}): perto de ${Math.round(c.emUso / 1000)} mil tokens`, `now (${c.conta}): around ${Math.round(c.emUso / 1000)}k tokens`)
        : t(
            `agora (${c.conta}): automático do assistente de código${c.contaGrande ? " (conta de 20x)" : ""}`,
            `now (${c.conta}): the coding assistant's default${c.contaGrande ? " (20x account)" : ""}`,
          ),
    );
  }
  return 0;
}

async function cmdTrocar(amb: Ambiente, a: Args): Promise<number> {
  const email = a.pos[1];
  if (!email) {
    amb.erro(t("uso: reveza trocar <email> [--local]", "usage: reveza trocar <email> [--local]"));
    return 2;
  }
  const r = await pedirPonte(portaDe(amb, a), "POST", "/api/trocar", { email, local: a.flags.local === true }, chaveDaPonte(amb.c.ponteChave, false));
  if (!r) {
    amb.erro(t("o agente não está rodando (reveza servico instalar, ou reveza rodar)", "the agent is not running (reveza servico instalar, or reveza rodar)"));
    return 1;
  }
  const corpo = r.corpo as { ok: boolean; erro?: string };
  if (corpo.ok) amb.saida(t(`Agora em ${email}.`, `Now on ${email}.`));
  else amb.erro(t(`Não troquei: ${corpo.erro}`, `Did not switch: ${corpo.erro}`));
  return corpo.ok ? 0 : 1;
}

interface ConexaoNoEstado {
  id: string;
  estado: string;
  url: string | null;
  janela?: { aberto: boolean; navegador: string | null; privado: boolean } | null;
  mensagem: string;
}

/**
 * O que o terminal diz quando o login está no ar. Neste computador, entrar na conta na janela que abriu basta (o login
 * termina sozinho); o endereço é para outro aparelho, ou para quando a janela não abriu: lá a página mostra um código,
 * que se cola aqui. Quem tem vários perfis no navegador caía na conta errada (12/10/2026): por isso a janela anônima.
 */
export function textoDoTerminal(janela: ConexaoNoEstado["janela"], url: string, email: string | null): string[] {
  const conta = email ? ` ${email}` : "";
  const linhas = [""];
  if (janela?.aberto && janela.privado) {
    linhas.push(
      t(
        `Abri o login numa janela anônima${janela.navegador ? ` do ${janela.navegador}` : ""}: entre na conta${conta} e pronto, o login termina sozinho.`,
        `I opened the sign-in in a private window${janela.navegador ? ` of ${janela.navegador}` : ""}: sign in to the account${conta} and that's it: the sign-in finishes on its own.`,
      ),
    );
  } else if (janela?.aberto) {
    linhas.push(
      t(
        `Abri o login no navegador: entre na conta${conta} e pronto, o login termina sozinho.`,
        `I opened the sign-in in the browser: sign in to the account${conta} and that's it: the sign-in finishes on its own.`,
      ),
    );
    linhas.push(t("Se ele abriu já logado em outra conta, use o endereço abaixo numa janela anônima.", "If it opened already signed in to another account, use the address below in a private window."));
  } else if (janela) {
    linhas.push(t("Não consegui abrir o navegador deste computador.", "I could not open the browser on this computer."));
  } else {
    linhas.push(
      t(
        `Se o navegador abriu, entre na conta${conta} e pronto, o login termina sozinho.`,
        `If the browser opened, sign in to the account${conta} and that's it: the sign-in finishes on its own.`,
      ),
    );
  }
  linhas.push("");
  linhas.push(
    t(
      `${janela?.aberto ? "Em outro aparelho, ou se a janela não aparecer" : "Ou"}: abra este endereço (de preferência numa janela anônima), entre na conta${conta} e cole aqui o código que a página mostrar.`,
      `${janela?.aberto ? "On another device, or if the window does not show up" : "Or"}: open this address (preferably in a private window), sign in to the account${conta} and paste the code the page shows here.`,
    ),
  );
  linhas.push(`  ${url}`);
  return linhas;
}

async function cmdConectar(amb: Ambiente, a: Args): Promise<number> {
  const porta = portaDe(amb, a);
  const email = a.pos[2] ?? null;
  const r = await pedirPonte(porta, "POST", "/api/contas/conectar", { email }, chaveDaPonte(amb.c.ponteChave, false));
  if (!r) {
    amb.erro(t("o agente não está rodando (reveza servico instalar, ou reveza rodar)", "the agent is not running (reveza servico instalar, or reveza rodar)"));
    return 1;
  }
  const corpo = r.corpo as { ok: boolean; id?: string; erro?: string };
  if (!corpo.ok) {
    amb.erro(corpo.erro ?? t("não consegui iniciar o login", "I could not start the sign-in"));
    return 1;
  }
  amb.saida(t("Abrindo o login oficial neste computador…", "Opening the official sign-in on this computer…"));
  let mostrouUrl = false;
  let esperas = 0;
  for (let i = 0; i < 600; i++) {
    await amb.relogio.dormir(1000);
    const e = await pedirPonte(porta, "GET", "/api/estado", undefined, chaveDaPonte(amb.c.ponteChave, false));
    const con = ((e?.corpo as Record<string, unknown>)?.conexoes as ConexaoNoEstado[] | undefined)?.find((x) => x.id === corpo.id);
    if (!con) continue;
    // o aviso de onde o login abriu chega um instante depois do endereço (no Windows, não chega)
    if (con.url && !mostrouUrl && (con.janela || ++esperas >= 3)) {
      mostrouUrl = true;
      for (const linha of textoDoTerminal(con.janela, con.url, email)) amb.saida(linha);
      void amb.perguntar(t("Código (ou só espere): ", "Code (or just wait): ")).then(async (codigo) => {
        if (!codigo.trim()) return;
        const r = await pedirPonte(porta, "POST", "/api/contas/codigo", { id: corpo.id, codigo: codigo.trim() }, chaveDaPonte(amb.c.ponteChave, false));
        const c = r?.corpo as { ok?: boolean; erro?: string } | undefined;
        if (!c?.ok) amb.erro(t(`o código não foi aceito: ${c?.erro ?? "o agente não respondeu"}`, `the code was not accepted: ${c?.erro ?? "the agent did not respond"}`));
      });
    }
    if (con.estado !== "aguardando") {
      (con.estado === "ok" ? amb.saida : amb.erro)(con.mensagem);
      return con.estado === "ok" ? 0 : 1;
    }
  }
  amb.erro(t("O login não terminou em 10 minutos.", "The sign-in did not finish in 10 minutes."));
  return 1;
}

function dia(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cmdUso(amb: Ambiente, a: Args): Promise<number> {
  const dias = Math.max(1, Math.min(3650, Number(a.flags.dias) || 30));
  const estado = carregarEstado(amb.c.estado);
  const email = (id: string) => (id ? (estado.contas[id]?.email ?? id) : "(sem conta)");
  const contador = new Contador(amb.c.registro, amb.c.projetos, () => null);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const desde = Math.floor(hoje.getTime() / 1000) - (dias - 1) * 86400;
  const linhas = contador.linhas(desde);
  if (a.flags.csv) {
    amb.saida("hora,conta,modelo,projeto,respostas,entrada,saida,cache_escrita,cache_leitura,usd");
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const h of linhas) {
      amb.saida(
        [new Date(h.hora * 1000).toISOString(), q(email(h.conta)), q(h.modelo), q(h.projeto), h.msgs, h.ent, h.sai, h.c5 + h.c1h, h.cl, h.usd.toFixed(4)].join(","),
      );
    }
    return 0;
  }
  const agrupar = (chave: (h: (typeof linhas)[number]) => string) => {
    const m = new Map<string, { usd: number; tokens: number; respostas: number }>();
    for (const h of linhas) {
      const k = chave(h);
      const v = m.get(k) ?? { usd: 0, tokens: 0, respostas: 0 };
      v.usd += h.usd;
      v.tokens += h.ent + h.sai + h.c5 + h.c1h + h.cl;
      v.respostas += h.msgs;
      m.set(k, v);
    }
    return [...m.entries()].sort((x, y) => y[1].usd - x[1].usd);
  };
  const porDia = agrupar((h) => dia(h.hora)).sort((x, y) => x[0].localeCompare(y[0]));
  const resultado = {
    dias,
    totais: contador.totais(desde, Math.floor(Date.now() / 1000) + 1),
    agentes: contador.agentesEntre(desde, Math.floor(Date.now() / 1000) + 1),
    sessoes: contador.sessoesEntre(desde, Math.floor(Date.now() / 1000) + 1),
    porDia,
    porConta: agrupar((h) => email(h.conta)),
    porModelo: agrupar((h) => h.modelo),
    porProjeto: agrupar((h) => h.projeto || "(sem projeto)"),
  };
  if (a.flags.json) {
    amb.saida(JSON.stringify(resultado, null, 1));
    return 0;
  }
  const mil = (n: number) =>
    idiomaAtual() === "en"
      ? n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)
      : n >= 1e9 ? `${(n / 1e9).toFixed(1)} bi` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n);
  const usd = (n: number) => `US$ ${n.toFixed(2)}`;
  amb.saida(
    t(
      `Últimos ${dias} dia(s): ${usd(resultado.totais.usd)} equivalentes pela tabela da API, ${mil(resultado.totais.tokens)} tokens, ` +
        `${resultado.totais.respostas} respostas, ${resultado.sessoes} sessões, ${resultado.agentes} agentes.`,
      `Last ${dias} day(s): ${usd(resultado.totais.usd)} equivalent at API prices, ${mil(resultado.totais.tokens)} tokens, ` +
        `${resultado.totais.respostas} responses, ${resultado.sessoes} sessions, ${resultado.agentes} agents.`,
    ),
  );
  amb.saida(t("Estimativa: na assinatura não se paga por token.\n", "Estimate: on a subscription you do not pay per token.\n"));
  const tabela = (titulo: string, itens: typeof porDia, n = 10) => {
    if (!itens.length) return;
    amb.saida(titulo);
    for (const [k, v] of itens.slice(0, n)) amb.saida(`  ${k.padEnd(34).slice(0, 34)} ${usd(v.usd).padStart(13)} ${mil(v.tokens).padStart(10)} tokens ${String(v.respostas).padStart(7)} resp.`);
    amb.saida("");
  };
  tabela(t("Por dia", "By day"), porDia, dias);
  tabela(t("Por conta", "By account"), resultado.porConta);
  tabela(t("Por modelo", "By model"), resultado.porModelo);
  tabela(t("Por projeto", "By project"), resultado.porProjeto);
  return 0;
}

/** O que a instalação lembra (instalacao.json, gravado pelo instalador): modo sombra e se foi sem serviço. */
function lerInstalacao(c: Caminhos): { sombra?: boolean; semServico?: boolean } | null {
  return lerJson<{ sombra?: boolean; semServico?: boolean }>(path.join(c.base, "instalacao.json"));
}

/** Depois de reinstalar o serviço: espera o agente responder na ponte e, com nuvem, a primeira conversa com ela. */
async function esperarAgente(amb: Ambiente, porta: number, comNuvem: boolean, segundos = 30): Promise<boolean> {
  let respondeu = false;
  for (let i = 0; i < segundos; i++) {
    const r = await pedirPonte(porta, "GET", "/api/estado", undefined, chaveDaPonte(amb.c.ponteChave, false));
    const corpo = (r?.status === 200 ? r.corpo : null) as { nuvem?: { online?: boolean | null } } | null;
    if (corpo) {
      respondeu = true;
      if (!comNuvem || (corpo.nuvem?.online ?? null) !== null) return true;
    }
    await amb.relogio.dormir(1000);
  }
  return respondeu;
}

async function cmdDoctor(amb: Ambiente, a: Args): Promise<number> {
  const p = await pecas(amb);
  const porta = portaDe(amb, a);
  const oServico = opcoesServico(amb, a);
  const instalado = servico.instalado(oServico);
  const instalacao = lerInstalacao(amb.c);
  const sombra = a.flags.sombra === true || !!instalado?.sombra || instalacao?.sombra === true || !!lerJson<InfoPonte>(arquivoPonte(amb.c))?.sombra;
  const identidade = async () => {
    const id = await lerIdentidade(p.guarda);
    return id ? { url: id.url } : null;
  };
  const deps: DepsDoctor = {
    c: amb.c,
    cred: p.cred,
    guarda: p.guarda,
    cli: p.cli,
    api: p.api,
    statusServico: () => servico.status(oServico),
    ponte: async () => {
      const x = await pedirPonte(porta, "GET", "/api/estado", undefined, chaveDaPonte(amb.c.ponteChave, false));
      return x?.status === 200 ? (x.corpo as Record<string, unknown>) : null;
    },
    nuvemConfigurada: identidade,
    horaNuvem: async () => {
      const n = await nuvemDe(amb, p.guarda, false);
      return n ? n.horaDoServidor() : null;
    },
    agora: () => amb.relogio.agora(),
    onde: "terminal",
    sombra,
    semServico: instalacao?.semServico === true,
  };
  if (a.flags["so-ver"]) {
    const r = await doctor(deps);
    amb.saida(a.flags.json ? JSON.stringify(r, null, 1) : textoDoctor(r));
    return r.some((c) => c.situacao === "falha") ? 1 : 0;
  }
  const r = await consertar(deps, {
    // o mesmo caminho de `reveza servico instalar`, sem tirar nem pôr o modo sombra e a porta de quem já estava instalado
    servico: async () => {
      const o = { ...oServico, sombra: instalado ? instalado.sombra : sombra, porta: instalado ? instalado.porta : oServico.porta };
      await servico.instalar(o);
      const voltou = await esperarAgente(amb, porta, !!(await identidade().catch(() => null)));
      return voltou
        ? { ok: true, texto: t(`reinstalei o serviço${o.sombra ? " (em modo sombra, como estava)" : ""} e o agente respondeu`, `I reinstalled the service${o.sombra ? " (in shadow mode, as it was)" : ""} and the agent responded`) }
        : { ok: false, texto: t(`reinstalei o serviço, mas o agente não respondeu em 30 s: veja o log em ${amb.c.log}`, `I reinstalled the service, but the agent did not respond in 30 s: see the log at ${amb.c.log}`) };
    },
    // o mesmo caminho do instalador: o marketplace é a pasta do programa
    mod: async () => {
      const app = pastaDoPrograma(amb.script);
      if (!app) return { ok: false, texto: t("não achei a pasta do programa com o mod: rode o instalador com --atualizar", "I could not find the program folder with the mod: run the installer with --atualizar") };
      return instalarMod({ exec: amb.exec, assistente: p.cli.binario(), app, porta: instalado?.porta ?? PORTA_PADRAO, env: ambienteDoUsuario(amb.env) });
    },
    // a troca é do agente que está rodando (o trocador dele): pedida pela ponte
    credenciais: async () => {
      const x = await pedirPonte(porta, "POST", "/api/consertar", { item: "credenciais" }, chaveDaPonte(amb.c.ponteChave, false), 150_000);
      if (!x) return { ok: false, texto: t("o agente não está rodando: rode reveza servico instalar (ou reveza rodar) e corrija de novo", "the agent is not running: run reveza servico instalar (or reveza rodar) and fix again") };
      const c = x.corpo as { ok?: unknown; texto?: unknown; erro?: unknown };
      return { ok: c.ok === true, texto: String(c.texto ?? c.erro ?? t(`o agente respondeu ${x.status}`, `the agent responded ${x.status}`)) };
    },
  });
  amb.saida(a.flags.json ? JSON.stringify(r.depois, null, 1) : textoDoctor(r.depois));
  if (r.feitos.length) logEmArquivo(amb.c.log, false).info(`reveza doctor consertou: ${resumoConserto(r.depois)}`);
  return r.depois.some((c) => c.situacao === "falha") ? 1 : 0;
}

/** Nome que vem da nuvem, antes de ir ao terminal: só letras, números, espaço e - _ ( ) (nada de sequência de controle). */
function nomeSeguro(nome: string): string {
  return nome.replace(/[^\p{L}\p{N} _()-]/gu, "").slice(0, 60);
}

/** O que o computador novo mostra: o código em letras grandes, a instrução e o código em texto comum. */
export function textoDoCodigo(codigo: string, idioma: "pt-BR" | "en"): string {
  const en = idioma === "en";
  return [
    "",
    en
      ? "On the computer that already uses Reveza, type this code in the window that opens"
      : "No computador que já usa o Reveza, digite este código na janela que vai abrir",
    en ? `(no screen there: reveza ligar ${codigo}):` : `(sem tela: reveza ligar ${codigo}):`,
    "",
    // em letras grandes, XXXX-XXXX numa linha e YYYY na outra: as 14 posições juntas não cabem em 80 colunas
    ...(codigo.length > 9 ? [codigo.slice(0, 9), codigo.slice(10)] : [codigo]).flatMap((parte, i) => [...(i ? [""] : []), ...letreiro(parte).map((l) => `    ${l}`)]),
    "",
    `    ${codigo}`,
    "",
    en
      ? "Type it only on your own computer and do not send a picture of it to anyone: the last 4 are a secret that never leaves this screen. Valid for 10 minutes."
      : "Digite só no seu computador e não mande foto dele para ninguém: os 4 últimos são um segredo que não sai desta tela. Vale 10 minutos.",
  ].join("\n");
}

async function cmdLigar(amb: Ambiente, a: Args): Promise<number> {
  if (a.flags.painel === "ligar" || a.flags.painel === "desligar") {
    // a liberação sem perguntar (0.1.x) deixava a nuvem autorizar sozinha: saiu na 0.2.0
    fs.rmSync(amb.c.ligarPeloPainel, { force: true });
    amb.erro(
      t(
        "A liberação pelo painel sem perguntar saiu na 0.2.0: o computador novo mostra um código de 12 caracteres; libere aqui com reveza ligar XXXX-XXXX-YYYY (ou na janela que abre).",
        "Letting a computer in from the panel without asking was removed in 0.2.0: the new computer shows a 12-character code; let it in here with reveza ligar XXXX-XXXX-YYYY (or in the window that opens).",
      ),
    );
    return a.flags.painel === "desligar" ? 0 : 2;
  }
  const idioma = idiomaAtual();
  const p = await pecas(amb);
  const nuvem = await nuvemDe(amb, p.guarda, false);
  if (!nuvem) {
    amb.erro(t("este computador ainda não tem a nuvem configurada (reveza nuvem entrar ...)", "this computer does not have the cloud set up yet (reveza nuvem entrar ...)"));
    return 1;
  }
  const temChave = !!(await lerChave(p.guarda));
  const frase = typeof a.flags.frase === "string" ? a.flags.frase : amb.env.REVEZA_FRASE;

  // Emergência (computador já ligado que perdeu a chave): a frase de 6 palavras, pelo terminal dos dois.
  if (a.flags["mostrar-frase"]) {
    if (!temChave) throw new Error(t("este computador não tem a chave do cofre: mostre a frase num que tenha", "this computer does not have the vault key: show the phrase on one that does"));
    await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO);
    const r = await publicarLigacao(p.guarda, nuvem, idioma);
    amb.saida(t("Emergência: digite estas 6 palavras no computador que perdeu a chave (reveza ligar --frase), em até 10 minutos:\n", "Emergency: type these 6 words on the computer that lost the key (reveza ligar --frase), within 10 minutes:\n"));
    amb.saida(`    ${r.frase}\n`);
    amb.saida(
      t(
        "A frase abre o cofre por 10 minutos: não mande por chat nem e-mail. Computador novo não usa a frase: ele entra pelo código que aparece nele.",
        "The phrase opens the vault for 10 minutes: do not send it by chat or email. A new computer does not use the phrase: it joins with the code it shows.",
      ),
    );
    return 0;
  }
  if (frase || a.flags.frase === true) {
    // só computador já ligado: a nuvem recusa registrar identidade pendente que não recebeu a chave pelo pedido
    await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO);
    await receberLigacao(p.guarda, nuvem, frase || (await amb.perguntar(t("As 6 palavras mostradas no outro computador: ", "The 6 words shown on the other computer: "))));
    amb.saida(t("Pronto: este computador recebeu a chave do cofre.", "Done: this computer received the vault key."));
    return 0;
  }

  // Quem tem a chave libera o computador novo pelo código que aparece nele.
  if (temChave) {
    await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO);
    const digitado = a.pos[1] ?? (await amb.perguntar(t("O código de 12 caracteres que aparece no computador novo: ", "The 12-character code shown on the new computer: ")));
    await liberarComputadorNovo(p.guarda, nuvem, digitado);
    amb.saida(t("Pronto: a chave do cofre foi entregue cifrada só para o computador novo. Ele termina sozinho.", "Done: the vault key was delivered, encrypted, only to the new computer. It finishes by itself."));
    return 0;
  }

  // Computador novo: pede para entrar (a identidade pendente veio do código de acesso do painel).
  if (a.pos[1]) throw new Error(t("este computador não tem a chave do cofre: o código se digita num computador que já usa o Reveza", "this computer does not have the vault key: the code is typed on a computer that already uses Reveza"));
  let esperando = false;
  const r = await pedirParaEntrar(p.guarda, nuvem, {
    aoMostrarCodigo: (codigo) => amb.saida(textoDoCodigo(codigo, idioma)),
    aoEsperar: (aprovador) => {
      const nome = aprovador ? nomeSeguro(aprovador) : "";
      if (nome) amb.saida(t(`\nEsperando você digitar o código em ${nome}...`, `\nWaiting for you to type the code on ${nome}...`));
      else if (!esperando) amb.saida(t("\nEsperando o código ser digitado no outro computador...", "\nWaiting for the code to be typed on the other computer..."));
      esperando = true;
    },
    dormir: (ms) => amb.relogio.dormir(ms),
  });
  // com a chave na mão, a identidade vira computador (a nuvem só deixa depois de ele ler a chave entregue)
  await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO);
  if (!r.impressao) {
    const k = await lerChave(p.guarda);
    if (k) await nuvem.cofreImpressao(impressaoDaChave(k)).catch(() => undefined);
  }
  amb.saida(t("Pronto: este computador recebeu a chave do cofre.", "Done: this computer received the vault key."));
  return 0;
}

function opcoesServico(amb: Ambiente, a: Args): servico.OpcoesServico {
  return {
    sistema: amb.sistema,
    home: amb.c.home,
    exec: amb.exec,
    node: process.execPath,
    script: amb.script,
    logs: amb.c.logs,
    sombra: a.flags.sombra === true,
    porta: typeof a.flags.porta === "string" ? Number(a.flags.porta) : undefined,
  };
}

async function cmdServico(amb: Ambiente, a: Args): Promise<number> {
  const acao = a.pos[1];
  const o = opcoesServico(amb, a);
  if (acao === "instalar") amb.saida(await servico.instalar(o));
  else if (acao === "remover") amb.saida(await servico.remover(o));
  else if (acao === "status") {
    const s = await servico.status(o);
    if (a.flags.json) {
      // o instalador lê isto para reconhecer uma instalação que não tem instalacao.json: modo sombra e porta saem do serviço
      const i = servico.instalado(o);
      const sombra = i ? i.sombra : !!lerJson<InfoPonte>(arquivoPonte(amb.c))?.sombra;
      amb.saida(JSON.stringify({ instalado: s.instalado, rodando: s.rodando, detalhe: s.detalhe, gerenciador: s.gerenciador !== false, sombra, porta: i?.porta ?? null }));
    } else amb.saida(s.instalado ? t(`instalado, ${s.detalhe}`, `installed, ${s.detalhe}`) : t("não instalado", "not installed"));
    return s.rodando ? 0 : 1;
  } else {
    amb.erro(t("uso: reveza servico instalar|remover|status", "usage: reveza servico instalar|remover|status"));
    return 2;
  }
  return 0;
}

async function cmdImportar(amb: Ambiente, a: Args): Promise<number> {
  const de = typeof a.flags.de === "string" ? a.flags.de.replace(/^~(?=$|\/)/, amb.c.home) : null;
  if (!de) {
    amb.erro(t("uso: reveza importar --de <pasta do gestor anterior>", "usage: reveza importar --de <folder of the previous manager>"));
    return 2;
  }
  if (await pedirPonte(portaDe(amb, a), "GET", "/api/ativa", undefined, chaveDaPonte(amb.c.ponteChave, false))) {
    amb.erro(t("pare o agente antes de importar (reveza servico remover, ou feche o reveza rodar)", "stop the agent before importing (reveza servico remover, or close reveza rodar)"));
    return 1;
  }
  const p = await pecas(amb);
  const rel = await importar({ de, c: amb.c, cred: p.cred, exec: amb.exec, agora: amb.relogio.agora(), conferirServico: amb.sistema === "macos" });
  for (const c of rel.contas) {
    const credencial = { copiada: t("copiada", "copied"), atualizada: t("atualizada", "updated"), "sem credencial": t("sem credencial", "no credential") }[c.credencial];
    amb.saida(t(`- ${c.email}: credencial ${credencial}, ${c.pasta} arquivo(s) da pasta copiados`, `- ${c.email}: credential ${credencial}, ${c.pasta} file(s) from the folder copied`));
  }
  amb.saida(t(`Conta em uso no gestor anterior: ${rel.ativa ?? "nenhuma"}`, `Account in use on the previous manager: ${rel.ativa ?? "none"}`));
  amb.saida(
    rel.uso.importado
      ? t(
          `Registro de uso: ${rel.uso.linhas} linhas por hora, ${rel.uso.sessoes} sessões e ${rel.uso.vistos} respostas já contadas.`,
          `Usage log: ${rel.uso.linhas} hourly rows, ${rel.uso.sessoes} sessions and ${rel.uso.vistos} responses already counted.`,
        )
      : t(`Registro de uso não importado: ${rel.uso.motivo}.`, `Usage log not imported: ${rel.uso.motivo}.`),
  );
  for (const av of rel.avisos) amb.erro(t(`aviso: ${av}`, `warning: ${av}`));
  amb.saida(t("Nada foi apagado nem movido na origem.", "Nothing was erased or moved at the source."));
  return 0;
}

async function cmdNuvem(amb: Ambiente, a: Args): Promise<number> {
  if (a.pos[1] === "identidade") {
    // só o que já é público (endereço e chave anon): o e-mail e a senha do computador não saem do chaveiro
    const guarda = (await amb.fabricas?.guarda?.()) ?? (await guardaDoSistema(amb.sistema, amb.exec, amb.c.segredos));
    const id = await lerIdentidade(guarda).catch(() => null);
    amb.saida(JSON.stringify(id ? { url: id.url, chavePublica: id.chavePublica } : null));
    return 0;
  }
  if (a.pos[1] !== "entrar") {
    amb.erro(t("uso: reveza nuvem entrar --url <https://...supabase.co> --chave-publica <chave anon> --email <e-mail do computador> | reveza nuvem identidade", "usage: reveza nuvem entrar --url <https://...supabase.co> --chave-publica <anon key> --email <computer email> | reveza nuvem identidade"));
    return 2;
  }
  const { url, email } = a.flags;
  const chavePublica = a.flags["chave-publica"];
  if (typeof url !== "string" || typeof email !== "string" || typeof chavePublica !== "string") {
    amb.erro(t("faltam --url, --chave-publica e --email", "missing --url, --chave-publica and --email"));
    return 2;
  }
  const senha = (amb.env.REVEZA_SENHA ?? (await amb.perguntar(t("Senha do computador: ", "Computer password: ")))).trim();
  // a senha não segue para os programas que este comando abre (assistente, chaveiro)
  delete amb.env.REVEZA_SENHA;
  if (amb.env !== process.env) delete process.env.REVEZA_SENHA;
  const p = await pecas(amb);
  await guardarIdentidade(p.guarda, { url, chavePublica, email, senha });
  amb.saida(t(`Identidade guardada em ${p.guarda.tipo}.`, `Identity stored in ${p.guarda.tipo}.`));
  return 0;
}

async function cmdRodar(amb: Ambiente, a: Args): Promise<number> {
  const sombra = a.flags.sombra === true;
  const porta = typeof a.flags.porta === "string" ? Number(a.flags.porta) : sombra ? PORTA_SOMBRA : PORTA_PADRAO;
  const p = await pecas(amb);
  const nuvem = a.flags["sem-nuvem"] ? null : await nuvemDe(amb, p.guarda, true).catch((e) => {
    amb.erro(t(`nuvem indisponível agora (${(e as Error).message}); sigo sem ela`, `cloud unavailable right now (${(e as Error).message}); carrying on without it`));
    return null;
  });
  const log = logEmArquivo(amb.c.log, !!amb.env.REVEZA_ECO);
  const identidade = await lerIdentidade(p.guarda).catch(() => null);
  const agente = new Agente({
    c: amb.c,
    sistema: amb.sistema,
    cred: p.cred,
    api: p.api,
    cli: p.cli,
    relogio: amb.relogio,
    log,
    guarda: p.guarda,
    nuvem,
    sombra,
    porta,
    exec: amb.exec,
    // atualizar o programa a pedido do painel: versões e pacote só do repositório oficial (atualizar.ts)
    versoes: new GithubOficial(VERSAO),
    node: process.execPath,
    ambienteDoInstalador: ambienteDoUsuario(amb.env),
    refNuvem: refDaNuvem(identidade?.url),
    diagnostico: async (): Promise<Record<string, unknown>> => {
      // a conferência periódica (agente_ola) só lê: nunca conserta sozinha
      const r = await doctor(depsDentro());
      return paraPainel(r);
    },
    consertar: async () => {
      // o Corrigir do painel: a lista fechada, rodando dentro do agente (o serviço não se reinicia daqui)
      const r = await consertar(depsDentro(), {
        mod: async () => {
          const app = pastaDoPrograma(amb.script);
          if (!app) return { ok: false, texto: t("não achei a pasta do programa com o mod: rode o instalador com --atualizar neste computador", "I could not find the program folder with the mod: run the installer with --atualizar on this computer") };
          return instalarMod({ exec: amb.exec, assistente: p.cli.binario(), app, porta, env: ambienteDoUsuario(amb.env) });
        },
        credenciais: () => agente.consertarCredencial(),
      });
      const contar = (x: "corrigido" | "nao_deu") => r.depois.filter((c) => c.consertado?.resultado === x).length;
      return { diagnostico: paraPainel(r.depois), resumo: resumoConserto(r.depois), corrigidos: contar("corrigido"), naoDeu: contar("nao_deu") };
    },
  });
  // erro escrito no log (disco cheio, arquivo que não se grava) também vai ao painel, com limite (agente.erroDoLog)
  log.aoErro = (t) => agente.erroDoLog(t);
  const instalacao = lerInstalacao(amb.c);
  const depsDentro = (): DepsDoctor => ({
    c: amb.c,
    cred: agente.cred,
    guarda: p.guarda,
    cli: p.cli,
    api: p.api,
    statusServico: () => servico.status(opcoesServico(amb, a)),
    ponte: async () => agente.publico(),
    nuvemConfigurada: async () => {
      const id = await lerIdentidade(p.guarda);
      return id ? { url: id.url } : null;
    },
    horaNuvem: async () => (nuvem ? nuvem.horaDoServidor() : null),
    agora: () => amb.relogio.agora(),
    onde: "agente",
    sombra,
    semServico: instalacao?.semServico === true,
  });
  // o formato que o painel lê: hora em ISO, versão e o tempo da última conversa com a nuvem
  const paraPainel = (r: Awaited<ReturnType<typeof doctor>>): Record<string, unknown> => {
    const pendente = agente.atualizacaoPendente();
    return {
      conferencias: r,
      em: new Date(amb.relogio.agora() * 1000).toISOString(),
      versao: VERSAO,
      atrasoBuscaMs: agente.ultimaBuscaMs,
      // a versão mais nova publicada (o painel mostra "Versão X disponível") e a atualização em andamento
      versaoNova: agente.versaoNova,
      atualizacao: pendente && !pendente.relatado ? { para: pendente.para, desde: new Date(pendente.em * 1000).toISOString() } : null,
      // a versão nova que a trava recusou: a nuvem precisa ser atualizada primeiro
      precisaNuvem: agente.travaNuvem ? { para: agente.travaNuvem.para } : null,
      // este agente entende o "assim que sair" (0.2.1); os de antes só o de madrugada (true)
      assimQueSair: true,
      // publicando agora as funções e o painel da versão da nuvem (atualização completa, 0.3.0)
      publicando: agente.publicando,
    };
  };
  await agente.iniciar();
  gravarJson(arquivoPonte(amb.c), { porta, pid: process.pid, sombra });
  amb.saida(t(`agente rodando${sombra ? " em modo sombra" : ""} na porta ${porta}; log em ${amb.c.log}`, `agent running${sombra ? " in shadow mode" : ""} on port ${porta}; log at ${amb.c.log}`));
  const manter = setInterval(() => undefined, 1 << 30);
  await new Promise<void>((resolve) => {
    let saindo = false;
    let vigia: ReturnType<typeof setInterval> | null = null;
    const sair = () => {
      if (saindo) return;
      saindo = true;
      if (vigia) clearInterval(vigia);
      void agente.desligar().finally(() => {
        clearInterval(manter);
        resolve();
      });
    };
    process.once("SIGTERM", sair);
    process.once("SIGINT", sair);
    // No Windows o serviço roda pelo conhost sem janela (servico.ts): quando a tarefa para (schtasks /End), o conhost
    // sai e o agente sai junto, senão ficaria órfão segurando a porta.
    if (a.flags["vigiar-pai"]) {
      const pai = process.ppid;
      vigia = setInterval(() => {
        if (!processoVivo(pai)) {
          log.info("o processo que chamou o agente saiu (a tarefa parou): saindo também");
          sair();
        }
      }, 1000);
    }
  });
  return 0;
}

/**
 * `reveza atualizacao-completa ligar|desligar|status`: os tokens que publicam funções e painel, cifrados com a chave
 * do cofre deste computador. Ligar pede os dois sem eco (ou lê --stdin, como o instalador manda), confere que eles
 * alcançam o projeto e a conta, cifra e guarda. Nada dos tokens vai para a tela, o disco, o log ou um evento.
 */
async function cmdCompleta(amb: Ambiente, a: Args): Promise<number> {
  const acao = a.pos[1];
  if (acao !== "ligar" && acao !== "desligar" && acao !== "status") {
    amb.erro(t("uso: reveza atualizacao-completa ligar|desligar|status", "usage: reveza atualizacao-completa ligar|desligar|status"));
    return 2;
  }
  // só a guarda (chave do cofre e identidade): nada de assistente nem credencial de conta aqui
  const p = { guarda: (await amb.fabricas?.guarda?.()) ?? (await guardaDoSistema(amb.sistema, amb.exec, amb.c.segredos)) };
  const nuvem = await nuvemDe(amb, p.guarda, false);
  if (!nuvem) {
    amb.erro(t("este computador não está ligado a uma nuvem (instalação só local): não há o que atualizar", "this computer is not linked to a cloud (local-only installation): there is nothing to update"));
    return 1;
  }
  const k = await lerChave(p.guarda);
  if (acao === "desligar") {
    await nuvem.credenciaisApagar();
    amb.saida(t("Atualização completa desligada: os tokens cifrados saíram da nuvem.", "Full update off: the encrypted tokens left the cloud."));
    amb.saida(
      t(
        "Para tirar o acesso de vez, apague os tokens em https://supabase.com/dashboard/account/tokens e https://vercel.com/account/tokens.",
        "To remove the access for good, delete the tokens at https://supabase.com/dashboard/account/tokens and https://vercel.com/account/tokens.",
      ),
    );
    return 0;
  }
  if (acao === "status") {
    const c = await nuvem.credenciaisLer();
    const ligada = !!(c.supabase && c.vercel);
    let abre = false;
    if (ligada && k) {
      try {
        abrirTokens(k, c);
        abre = true;
      } catch {
        abre = false;
      }
    }
    const r = { ligada, gravadaEm: c.supabase?.gravadoEm ?? null, abreAqui: abre };
    if (a.flags.json) amb.saida(JSON.stringify(r));
    else if (!ligada) amb.saida(t("Atualização completa desligada. Para ligar: reveza atualizacao-completa ligar", "Full update off. To turn it on: reveza atualizacao-completa ligar"));
    else {
      amb.saida(
        t(
          `Atualização completa ligada desde ${r.gravadaEm ?? "?"}; ${abre ? "este computador abre os tokens" : "este computador NÃO abre os tokens (outra chave do cofre)"}.`,
          `Full update on since ${r.gravadaEm ?? "?"}; ${abre ? "this computer opens the tokens" : "this computer does NOT open the tokens (another vault key)"}.`,
        ),
      );
    }
    return 0;
  }
  if (!k) {
    amb.erro(t("este computador não tem a chave do cofre: ligue-o com `reveza ligar` antes", "this computer does not have the vault key: join it with `reveza ligar` first"));
    return 1;
  }
  const id = await lerIdentidade(p.guarda);
  const ref = refDaNuvem(id?.url);
  if (!ref) {
    amb.erro(t("não achei o projeto do Supabase desta instalação no endereço da nuvem", "I could not find this installation's Supabase project in the cloud address"));
    return 1;
  }
  let tokens: Tokens;
  if (a.flags.stdin) {
    try {
      const j = JSON.parse((await amb.lerEntrada?.()) ?? "") as Record<string, unknown>;
      tokens = { supabase: String(j.supabase ?? ""), vercel: String(j.vercel ?? "") };
    } catch {
      amb.erro(t("os tokens não chegaram pela entrada padrão (JSON com supabase e vercel)", "the tokens did not arrive on standard input (JSON with supabase and vercel)"));
      return 2;
    }
  } else {
    for (const l of avisoCompleta()) amb.saida(l);
    const pedir = amb.perguntarSegredo ?? (async () => "");
    tokens = {
      supabase: (await pedir(t("Token do Supabase (não aparece na tela): ", "Supabase token (not shown on screen): "))).trim(),
      vercel: (await pedir(t("Token da Vercel (não aparece na tela): ", "Vercel token (not shown on screen): "))).trim(),
    };
  }
  if (!tokenValido(tokens.supabase) || !tokenValido(tokens.vercel)) {
    amb.erro(t("faltam os dois tokens (o do Supabase e o da Vercel), cada um numa linha só", "both tokens are needed (the Supabase one and the Vercel one), each on a single line"));
    return 2;
  }
  // o computador da instalação nova pode ainda não ter feito a primeira busca: registra (o mesmo que o agente faz)
  await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO).catch(() => undefined);
  const painel = await nuvem.painelPublicacao().catch(() => null);
  const conferido = await conferirTokens(tokens, ref, amb.fetch ?? fetch, painel);
  if (!conferido.ok) {
    amb.erro(t(`não liguei: ${conferido.erro}`, `I did not turn it on: ${conferido.erro}`));
    return 1;
  }
  const c = cifrarTokens(k, tokens);
  await nuvem.credenciaisGuardar(c.supabase, c.vercel, impressaoDaChave(k));
  amb.saida(t("Atualização completa ligada: os tokens estão na nuvem cifrados com a chave do cofre.", "Full update on: the tokens are in the cloud, encrypted with the vault key."));
  amb.saida(
    t(
      "Quando a nuvem chegar a uma versão nova, um computador ligado e calmo publica as funções e o painel dela; depois, os computadores.",
      "When the cloud reaches a new version, a computer that is on and idle publishes its functions and panel; then the computers.",
    ),
  );
  amb.saida(t("Para desligar: reveza atualizacao-completa desligar (ou Desligar, no painel).", "To turn it off: reveza atualizacao-completa desligar (or Turn off, in the panel)."));
  return 0;
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function executarCli(argv: string[], amb: Ambiente = ambienteReal()): Promise<number> {
  const a = lerArgs(argv);
  usarIdioma(resolverIdioma(a.flags.idioma, amb.env, amb.c));
  const cmd = a.pos[0];
  try {
    switch (cmd) {
      case "status":
        return await cmdStatus(amb, a, false);
      case "contas":
        if (a.pos[1] === "conectar") return await cmdConectar(amb, a);
        if (a.pos[1] === "adotar") {
          const r = await pedirPonte(portaDe(amb, a), "POST", "/api/contas/adotar", {}, chaveDaPonte(amb.c.ponteChave, false));
          amb.saida(r ? JSON.stringify(r.corpo) : t("o agente não está rodando", "the agent is not running"));
          return r ? 0 : 1;
        }
        return await cmdStatus(amb, a, true);
      case "trocar":
        return await cmdTrocar(amb, a);
      case "som":
        return await cmdSom(amb, a);
      case "resumo":
        return await cmdResumo(amb, a);
      case "uso":
        return await cmdUso(amb, a);
      case "doctor":
        return await cmdDoctor(amb, a);
      case "ligar":
        return await cmdLigar(amb, a);
      case "servico":
        return await cmdServico(amb, a);
      case "importar":
        return await cmdImportar(amb, a);
      case "cofre":
        if (a.pos[1] === "iniciar") {
          const p = await pecas(amb);
          // instalação que já tem chave: uma segunda dividiria o cofre (o computador novo recebe a dela com `reveza ligar`)
          const nuvem = await nuvemDe(amb, p.guarda, false).catch(() => null);
          if (nuvem && !(await lerChave(p.guarda))) {
            const recusou = await nuvem.registrar(os.hostname().slice(0, 60), amb.sistema, VERSAO).then(
              () => null,
              (e: Error) => (/ainda não recebeu a chave/.test(e.message) ? e : null),
            );
            // identidade de computador novo (a nuvem já tem chave): uma segunda dividiria o cofre
            if (recusou) {
              amb.erro(
                t(
                  "esta instalação já tem a chave do cofre: este computador a recebe com `reveza ligar` (o código aparece aqui e é digitado num computador que já usa o Reveza)",
                  "this installation already has the vault key: this computer receives it with `reveza ligar` (the code shows up here and is typed on a computer that already uses Reveza)",
                ),
              );
              return 1;
            }
            if (await nuvem.cofreImpressao(null).catch(() => null)) {
              amb.erro(
                t(
                  "esta instalação já tem a chave do cofre: receba-a com `reveza ligar` (o código aparece aqui e é digitado num computador que já usa o Reveza)",
                  "this installation already has the vault key: receive it with `reveza ligar` (the code shows up here and is typed on a computer that already uses Reveza)",
                ),
              );
              return 1;
            }
          }
          const criou = await iniciarCofre(p.guarda);
          const k = await lerChave(p.guarda);
          if (criou && nuvem && k) {
            const daInstalacao = await nuvem.cofreImpressao(impressaoDaChave(k)).catch(() => undefined);
            // outro computador criou a chave no mesmo instante e a impressão dele ficou: esta, recém-criada e sem nada
            // cifrado com ela, sai (ficar com ela dividiria o cofre)
            if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
              await p.guarda.apagar(SEGREDO_COFRE);
              amb.erro(t("outro computador criou a chave do cofre desta instalação primeiro: receba-a com `reveza ligar`", "another computer created this installation's vault key first: receive it with `reveza ligar`"));
              return 1;
            }
          }
          amb.saida(criou ? t("Chave do cofre criada neste computador.", "Vault key created on this computer.") : t("Este computador já tem a chave do cofre.", "This computer already has the vault key."));
          return 0;
        }
        amb.erro(t("uso: reveza cofre iniciar", "usage: reveza cofre iniciar"));
        return 2;
      case "nuvem":
        return await cmdNuvem(amb, a);
      case "atualizacao-completa":
        return await cmdCompleta(amb, a);
      case "rodar":
        return await cmdRodar(amb, a);
      case "versao":
      case "--versao":
      case "--version":
        amb.saida(VERSAO);
        return 0;
      case undefined:
      case "ajuda":
      case "--ajuda":
      case "--help":
        amb.saida(ajuda());
        return 0;
      default:
        amb.erro(`${t(`comando desconhecido: ${cmd}`, `unknown command: ${cmd}`)}\n\n${ajuda()}`);
        return 2;
    }
  } catch (e) {
    amb.erro(t(`erro: ${(e as Error).message}`, `error: ${(e as Error).message}`));
    return 1;
  }
}

const principal = fs.realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (principal) {
  executarCli(process.argv.slice(2)).then((codigo) => process.exit(codigo));
}
