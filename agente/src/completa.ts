// A atualização completa (0.3.0): os tokens do Supabase e da Vercel, que publicam as funções da nuvem e o painel, ficam
// na nuvem CIFRADOS com a chave do cofre (K, a mesma dos logins). A nuvem guarda um texto que não lê; só um computador
// da instalação, que tem K, abre. Desligada de fábrica: liga com `reveza atualizacao-completa ligar` (ou na oferta do
// fim da instalação, padrão não) e desliga pelo comando ou pelo painel.
//
// Os tokens nunca vão para o disco, o log, um evento, um argumento ou o ambiente de outro programa: ficam na memória
// enquanto servem e chegam ao instalador da versão nova pela entrada padrão.

import { cifrar, decifrar } from "./cofre/cifra.js";
import { compararVersao } from "./doctor.js";
import { idiomaAtual, t as traduzir } from "./i18n.js";

export type NomeToken = "supabase" | "vercel";
export interface Tokens {
  supabase: string;
  vercel: string;
}
export interface TokenCifrado {
  cifrado: Buffer;
  nonce: Buffer;
}

/** O dado associado de cada token: o cifrado de um não serve no lugar do outro, nem no lugar de um login do cofre. */
export function aadToken(nome: NomeToken): string {
  return `reveza-atualizacao|${nome}`;
}

export function cifrarTokens(k: Buffer, t: Tokens): Record<NomeToken, TokenCifrado> {
  return {
    supabase: cifrar(k, aadToken("supabase"), Buffer.from(t.supabase, "utf8")),
    vercel: cifrar(k, aadToken("vercel"), Buffer.from(t.vercel, "utf8")),
  };
}

/** Abre os dois tokens com K. Sem os dois, ou com outra chave, para com uma mensagem que não leva nada deles. */
export function abrirTokens(k: Buffer, lidos: Partial<Record<NomeToken, TokenCifrado | null>>): Tokens {
  const abrir = (nome: NomeToken) => {
    const c = lidos[nome];
    if (!c) throw new Error("a atualização completa está desligada (faltam os tokens cifrados)");
    try {
      return decifrar(k, aadToken(nome), c.cifrado, c.nonce).toString("utf8");
    } catch {
      throw new Error("os tokens cifrados não abrem com a chave do cofre deste computador");
    }
  };
  return { supabase: abrir("supabase"), vercel: abrir("vercel") };
}

/** Tira do texto (saída do instalador, motivo de erro) qualquer pedaço dos tokens, antes de ir para log ou evento. */
export function semSegredos(texto: string, segredos: string[]): string {
  let r = texto;
  for (const s of segredos) if (s && s.length >= 6) r = r.split(s).join("[token]");
  return r;
}

/** Token com cara de token: uma linha, sem espaço, de 20 a 400 caracteres. */
export function tokenValido(t: unknown): t is string {
  return typeof t === "string" && /^[\x21-\x7e]{20,400}$/.test(t);
}

/** O projeto do Supabase pelo endereço da nuvem (https://<ref>.supabase.co). */
export function refDaNuvem(url: string | null | undefined): string | null {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url ?? "");
  return m ? m[1]! : null;
}

/**
 * Os tokens alcançam o que a publicação precisa? O do Supabase, o projeto desta instalação; o da Vercel, o projeto do
 * painel (na equipe dele), quando a nuvem já sabe qual é, ou a conta. Recusado volta com o que fazer (sem nada do token).
 * Pelo projeto, e não pela conta, porque o token de escopo só no time (o recomendado) pode não ler a conta.
 */
export async function conferirTokens(
  t: Tokens,
  ref: string,
  f: typeof fetch = fetch,
  painel: { projeto: string; equipe: string | null } | null = null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const pedir = async (url: string, token: string) => {
    try {
      const r = await f(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
      return r.status;
    } catch {
      return 0;
    }
  };
  const s = await pedir(`https://api.supabase.com/v1/projects/${ref}`, t.supabase);
  if (s === 0) return { ok: false, erro: traduzir("não consegui falar com o Supabase agora (rede?)", "I could not reach Supabase right now (network?)") };
  if (s !== 200) {
    return {
      ok: false,
      erro: traduzir(
        `o token do Supabase não alcança o projeto ${ref} (resposta ${s}): confira se é um token pessoal da conta dona da organização do projeto`,
        `the Supabase token does not reach project ${ref} (response ${s}): check that it is a personal token of the account that owns the project's organization`,
      ),
    };
  }
  const urlVercel = painel
    ? `https://api.vercel.com/v9/projects/${encodeURIComponent(painel.projeto)}${painel.equipe ? `?teamId=${encodeURIComponent(painel.equipe)}` : ""}`
    : "https://api.vercel.com/v2/user";
  const v = await pedir(urlVercel, t.vercel);
  if (v === 0) return { ok: false, erro: traduzir("não consegui falar com a Vercel agora (rede?)", "I could not reach Vercel right now (network?)") };
  if (v !== 200) {
    return {
      ok: false,
      erro: painel
        ? traduzir(
            `o token da Vercel não alcança o projeto ${painel.projeto} do painel (resposta ${v}): crie o token com escopo no time dele`,
            `the Vercel token does not reach the panel project ${painel.projeto} (response ${v}): create the token scoped to its team`,
          )
        : traduzir(`o token da Vercel foi recusado (resposta ${v})`, `the Vercel token was refused (response ${v})`),
    };
  }
  return { ok: true };
}

/** O texto de ligar: o que é, o que custa em segurança e como reduzir o alcance dos tokens (o mesmo do instalador). */
const AVISO_COMPLETA_PT = [
  "Atualização completa: as funções da nuvem e o painel novos vão ao ar sozinhos, por um computador da instalação.",
  "Os tokens do Supabase e da Vercel ficam na nuvem CIFRADOS com a chave do cofre: a nuvem guarda um texto que não lê, e só um computador seu abre.",
  "Atenção: quem tiver um computador desta instalação passa a ter esses tokens. Prefira tokens de alcance curto e com validade:",
  "  Vercel (https://vercel.com/account/tokens): escopo só no time do painel e com validade;",
  "  Supabase (https://supabase.com/dashboard/account/tokens): com validade, se a página oferecer, e de uma conta que só tenha a organização do Reveza (o token alcança tudo o que a conta alcança).",
  "Para desligar: reveza atualizacao-completa desligar (ou Desligar, no painel). Desligar tira os tokens da nuvem; para tirar o acesso de vez, apague os tokens no Supabase e na Vercel.",
];

const AVISO_COMPLETA_EN = [
  "Full update: the new cloud functions and panel go live by themselves, through a computer of the installation.",
  "The Supabase and Vercel tokens stay in the cloud ENCRYPTED with the vault key: the cloud stores text it cannot read, and only your computers can open it.",
  "Warning: anyone with a computer of this installation gets these tokens. Prefer short-scope tokens with an expiry:",
  "  Vercel (https://vercel.com/account/tokens): scope only on the panel's team, with an expiry;",
  "  Supabase (https://supabase.com/dashboard/account/tokens): with an expiry, if the page offers it, and from an account that only has the Reveza organization (the token reaches everything the account reaches).",
  "To turn it off: reveza atualizacao-completa desligar (or Turn off, in the panel). Turning off removes the tokens from the cloud; to remove the access for good, delete the tokens on Supabase and Vercel.",
];

/** O texto de ligar, no idioma do processo (escolhido na hora do uso, não ao carregar o módulo). */
export function avisoCompleta(): string[] {
  return idiomaAtual() === "en" ? AVISO_COMPLETA_EN : AVISO_COMPLETA_PT;
}

const VERSAO = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A primeira versão cujo instalador sabe publicar (--publicar-nuvem). */
export const PUBLICA_DESDE = "0.3.0";

/**
 * O que falta publicar para a versão da nuvem (a mesma regra do banco, rvz_publicacao_pendente): uma parte está em dia
 * quando a versão no ar já é a da nuvem (ou mais nova), ou quando a nuvem calculou o mesmo resumo das duas.
 */
export function pendenteDaPublicacao(config: Record<string, unknown>): { versao: string | null; funcoes: boolean; painel: boolean } {
  const nuvem = typeof config.nuvem_versao === "string" && VERSAO.test(config.nuvem_versao) ? config.nuvem_versao : null;
  if (!nuvem) return { versao: null, funcoes: false, painel: false };
  const pub = objeto(config.publicado);
  const imp = objeto(config.impressoes);
  const falta = (parte: "funcoes" | "painel") => {
    const v = pub[parte];
    if (typeof v !== "string" || !VERSAO.test(v)) return true;
    if (compararVersao(v, nuvem) >= 0) return false;
    const a = objeto(imp[nuvem])[parte];
    const b = objeto(imp[v])[parte];
    return !(typeof a === "string" && a && a === b);
  };
  return { versao: nuvem, funcoes: falta("funcoes"), painel: falta("painel") };
}

/** A atualização completa está ligada na instalação (o banco diz; os tokens mesmo, só cifrados)? */
export function completaLigada(config: Record<string, unknown>): boolean {
  return objeto(config.atualizacao_completa).ligada === true;
}
