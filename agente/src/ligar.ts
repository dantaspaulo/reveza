// Chave do cofre neste computador: criar (primeiro computador), ligar um computador novo e, em emergência, a frase.
//
// Computador novo (0.2.0; versão 3 do protocolo desde a 0.4.0): ele cria um par de chaves ECDH P-256 só em memória,
// registra a chave pública no pedido dele na nuvem e mostra um código de 12 caracteres, XXXX-XXXX-YYYY:
// - XXXX-XXXX sai da chave pública (SHA-256 esticado por scrypt): quem libera confere que vai entregar para a chave que
//   o computador novo mostrou, e trocar a chave no caminho pede achar outra com o mesmo código (2^40 scrypts em 10 min);
// - YYYY é sorteado e NÃO vai à nuvem: entra na cifra do envelope, e o computador novo só abre envelope feito com ele.
// A pessoa digita o código num computador que já tem a chave do cofre; ele confere a primeira parte, cifra a chave do
// cofre para a chave pública do computador novo (ECDH efêmero + HKDF-SHA256 com a segunda parte + AES-256-GCM) e
// entrega pela nuvem, que só vê texto cifrado. Nenhum segredo passa pela tela do painel.
//
// Por que a versão 3 (auditoria de segurança de 12/10/2026, rodada 3): na versão 2 o código inteiro saía da chave
// pública, que fica na nuvem. Quem escreve direto no banco (o dono do banco, quem tem a chave de serviço) podia montar um
// envelope com uma chave DELE para a chave pública do computador novo, trocar junto a impressão da instalação, e o
// computador novo adotava essa chave. Sem os 4 últimos, a chance de acertar é 1 em 2^20, numa tentativa só (o
// computador novo para no primeiro envelope que não abre). Os 4 últimos não ganham verificador na nuvem de propósito:
// com ele, 20 bits se achariam por força bruta; sem ele, nada fora do computador novo diz se um palpite está certo.
// (Um código todo sorteado, conferido por verificador, foi considerado e descartado: quem visse a tela E escrevesse no
// banco trocaria a chave pública e levaria a chave do cofre. Aqui, nem esse leva a chave do cofre.)

// Frase de 6 palavras: só o caminho manual de emergência, para um computador já ligado que perdeu a chave.

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, webcrypto, type ScryptOptions } from "node:crypto";

import { novaChave, TAMANHO_CHAVE } from "./cofre/cifra.js";
import { desembrulhar, embrulhar, gerarFrase, palavrasDesconhecidas, type Idioma } from "./cofre/frase.js";
import { SEGREDO_COFRE, type Guarda } from "./cofre/guarda.js";
import { t } from "./i18n.js";
import { ErroNuvem, type ChavePublica, type EnvelopeChave, type Nuvem, type PedidoLigacao } from "./nuvem/tipos.js";

export async function lerChave(guarda: Guarda): Promise<Buffer | null> {
  const t = await guarda.ler(SEGREDO_COFRE);
  if (!t) return null;
  const k = Buffer.from(t, "base64");
  return k.length === TAMANHO_CHAVE ? k : null;
}

/** Impressão da chave (HMAC, 128 bits): a nuvem guarda a da instalação, e só ela; não revela a chave. */
export function impressaoDaChave(k: Buffer): string {
  return createHmac("sha256", k).update("reveza-cofre-impressao-v1").digest("hex").slice(0, 32);
}

/** Cria a chave do cofre se este computador ainda não tem. Devolve se criou. */
export async function iniciarCofre(guarda: Guarda): Promise<boolean> {
  if (await lerChave(guarda)) return false;
  await guarda.gravar(SEGREDO_COFRE, novaChave().toString("base64"));
  return true;
}

export async function publicarLigacao(guarda: Guarda, nuvem: Nuvem, idioma: Idioma = "pt-BR"): Promise<{ frase: string; expiraEm: string | null }> {
  const k = await lerChave(guarda);
  if (!k) throw new Error(t("este computador não tem a chave do cofre; mostre a frase num que tenha (reveza ligar --mostrar-frase)", "this computer does not have the vault key; show the phrase on one that does (reveza ligar --mostrar-frase)"));
  const frase = gerarFrase(idioma);
  const { embrulho, sal } = embrulhar(k, frase);
  const r = await nuvem.ligacaoPublicar(embrulho, sal);
  if (!r.ok) throw new Error(t("a nuvem recusou a ligação", "the cloud refused the link"));
  return { frase, expiraEm: r.expira_em };
}

export async function receberLigacao(guarda: Guarda, nuvem: Nuvem, frase: string): Promise<void> {
  const erradas = palavrasDesconhecidas(frase);
  if (erradas.length) throw new Error(t(`palavra fora da lista: ${erradas.join(", ")} (confira a digitação)`, `word not in the list: ${erradas.join(", ")} (check what you typed)`));
  if (await lerChave(guarda)) throw new Error(t("este computador já tem a chave do cofre", "this computer already has the vault key"));
  const pacote = await nuvem.ligacaoBuscar();
  if (!pacote) {
    throw new Error(
      t(
        "nenhuma frase aberta (vale 10 minutos; mostre outra com reveza ligar --mostrar-frase no computador que tem a chave)",
        "no open phrase (it is valid for 10 minutes; show another with reveza ligar --mostrar-frase on the computer that has the key)",
      ),
    );
  }
  let k: Buffer;
  try {
    k = desembrulhar(pacote.embrulho, pacote.sal, frase);
  } catch {
    throw new Error(t("a frase não abriu a chave; confira as 6 palavras e a ordem", "the phrase did not open the key; check the 6 words and their order"));
  }
  // a chave precisa ser a desta instalação (a nuvem guarda a impressão da primeira); outra chave dividiria o cofre
  const daInstalacao = await nuvem.cofreImpressao(null);
  if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
    throw new Error(t("a chave recebida não é a desta instalação: gere a frase num computador que já usa o Reveza", "the key received is not from this installation: generate the phrase on a computer that already uses Reveza"));
  }
  await guarda.gravar(SEGREDO_COFRE, k.toString("base64"));
  if (!daInstalacao) await nuvem.cofreImpressao(impressaoDaChave(k));
}

// ------------------------------------------------------------------------------------------------ computador novo
// Os rótulos do envelope são da versão 3 (a 1 era a frase cifrada para o navegador, que saiu na 0.2.0; a 2, o envelope
// sem a parte sorteada do código, que saiu na 0.4.0). A primeira parte do código segue a da versão 2.

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const V3 = "reveza-ligacao-computador-v3";
const aad = (computadorId: string) => new TextEncoder().encode(`${V3}|${computadorId}`);

/** Pedido de um computador novo com o Reveza anterior à 0.4.0 (código de 8): não se libera. */
export const ANTIGO =
  "o código tem 12 letras e números (XXXX-XXXX-YYYY); se o computador novo mostra só 8, ele está com uma versão antiga do Reveza: instale de novo nele (a versão mais nova) e gere outro código no painel";
const ANTIGO_EN =
  "the code has 12 letters and numbers (XXXX-XXXX-YYYY); if the new computer shows only 8, it runs an old version of Reveza: install it again there (the newest version) and generate another code in the panel";

/** Dois pedidos ao mesmo tempo: todos recusados (falha fechada; revisão de segurança de 11/10/2026). */
export const LIGACAO_DUPLA = "dois pedidos de ligação ao mesmo tempo: recusei os dois; gere de novo no painel";
const LIGACAO_DUPLA_EN = "two link requests at the same time: I refused both; generate a new code in the panel";

/** A parte do código que sai da chave pública: 8 símbolos de 32 (40 bits). */
export const TAMANHO_LIGACAO = 8;
/** A parte sorteada, que não vai à nuvem: 4 símbolos de 32 (20 bits). */
export const TAMANHO_SEGREDO = 4;
/** O código inteiro, como a pessoa digita: XXXX-XXXX-YYYY. */
export const TAMANHO_CODIGO = TAMANHO_LIGACAO + TAMANHO_SEGREDO;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I, que se confundem na tela

/**
 * Esticamento da primeira parte (scrypt, 32 MiB, ~40 ms aqui). A chave pública fica legível na nuvem; quem escreve
 * direto no banco poderia trocá-la por uma chave dele com a MESMA primeira parte e receber a chave do cofre. Achar essa
 * chave pede 2^40 tentativas, e cada uma custa um scrypt: muitos anos de máquina, para um pedido que vence em 10 minutos.
 */
const ESTICAR: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function esticar(dado: Buffer): Promise<Buffer> {
  return new Promise((ok, falhou) => scryptCb(dado, "reveza-ligar-codigo-v2", TAMANHO_LIGACAO, ESTICAR, (e, b) => (e ? falhou(e) : ok(b))));
}

const simbolos = (bytes: Buffer, n: number) => {
  let r = "";
  for (let i = 0; i < n; i++) r += ALFABETO[bytes[i]! % ALFABETO.length]; // 256/32 = 8: sem viés
  return r;
};

/** A primeira parte do código (XXXX-XXXX): SHA-256 da chave pública, esticado. Quem libera calcula igual. */
export async function codigoDaChave(publica: ChavePublica): Promise<string> {
  const h = createHash("sha256").update(`reveza-ligar-v2.${publica.x}.${publica.y}`).digest();
  const r = simbolos(await esticar(h), TAMANHO_LIGACAO);
  return `${r.slice(0, 4)}-${r.slice(4)}`;
}

/** A parte sorteada (YYYY), que só aparece na tela do computador novo. */
export function novoSegredo(): string {
  return simbolos(randomBytes(TAMANHO_SEGREDO), TAMANHO_SEGREDO);
}

/** O que a pessoa digitou, sem espaço, hífen nem caixa. */
export function normalizarCodigo(t: string): string {
  return t.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** O código inteiro, como aparece no computador novo. */
export function codigoCompleto(ligacao: string, segredo: string): string {
  return `${ligacao}-${segredo}`;
}

/**
 * Quem tem a chave do cofre: confere a primeira parte do que se digitou contra a chave pública do pedido e devolve a
 * parte sorteada (para a cifra do envelope), ou null. Código de 8 (o da versão 2) não confere.
 */
export async function conferirCodigo(digitado: string, publica: ChavePublica): Promise<string | null> {
  const c = normalizarCodigo(digitado);
  if (c.length !== TAMANHO_CODIGO || ![...c].every((ch) => ALFABETO.includes(ch))) return null;
  const esperado = normalizarCodigo(await codigoDaChave(publica));
  const ok = timingSafeEqual(Buffer.from(c.slice(0, TAMANHO_LIGACAO)), Buffer.from(esperado));
  return ok ? c.slice(TAMANHO_LIGACAO) : null;
}

async function chaveSimetrica(privada: webcrypto.CryptoKey, publica: ChavePublica, segredo: string, computadorId: string): Promise<webcrypto.CryptoKey> {
  const s = webcrypto.subtle;
  const pub = await s.importKey("jwk", { ...publica, ext: true }, ECDH, false, []);
  const ecdh = await s.deriveBits({ name: "ECDH", public: pub }, privada, 256);
  const base = await s.importKey("raw", ecdh, "HKDF", false, ["deriveKey"]);
  // a parte sorteada do código entra no sal: sem ela, nem quem monta um envelope para a chave pública abre ou é aberto
  const sal = createHash("sha256").update(`${V3}.segredo.${normalizarCodigo(segredo)}`).digest();
  return s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: sal, info: new TextEncoder().encode(`${V3}|${computadorId}`) }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function publicaDe(jwk: webcrypto.JsonWebKey): ChavePublica {
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y! };
}

/** O par do computador novo: a chave privada não sai da memória (não exportável). */
export async function novoParDeChaves(): Promise<{ publica: ChavePublica; privada: webcrypto.CryptoKey }> {
  const par = (await webcrypto.subtle.generateKey(ECDH, false, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  return { publica: publicaDe(await webcrypto.subtle.exportKey("jwk", par.publicKey)), privada: par.privateKey };
}

/** O pedido do computador novo: o par de chaves, a parte sorteada e o código inteiro (só na tela dele). */
export async function prepararPedido(segredo = novoSegredo()) {
  const par = await novoParDeChaves();
  return { ...par, segredo, codigo: codigoCompleto(await codigoDaChave(par.publica), segredo) };
}

/** Quem tem a chave do cofre: cifra a chave para a chave pública do pedido, com a parte sorteada do código digitado. */
export async function cifrarChaveParaComputadorNovo(publica: ChavePublica, k: Buffer, computadorId: string, segredo: string): Promise<EnvelopeChave> {
  const s = webcrypto.subtle;
  const par = (await s.generateKey(ECDH, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const chave = await chaveSimetrica(par.privateKey, publica, segredo, computadorId);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cifrado = await s.encrypt({ name: "AES-GCM", iv, additionalData: aad(computadorId) }, chave, k);
  return {
    efemera: publicaDe(await s.exportKey("jwk", par.publicKey)),
    iv: Buffer.from(iv).toString("base64"),
    cifrado: Buffer.from(cifrado).toString("base64"),
  };
}

/** O computador novo abre o envelope com a chave privada e a parte sorteada que só ele tem. */
export async function abrirChaveDoEnvelope(privada: webcrypto.CryptoKey, env: EnvelopeChave, computadorId: string, segredo: string): Promise<Buffer> {
  const chave = await chaveSimetrica(privada, env.efemera, segredo, computadorId);
  const claro = Buffer.from(
    await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(env.iv, "base64"), additionalData: aad(computadorId) }, chave, Buffer.from(env.cifrado, "base64")),
  );
  if (claro.length !== TAMANHO_CHAVE) throw new Error(t("a chave entregue não tem o tamanho de uma chave do cofre", "the key delivered is not the size of a vault key"));
  return claro;
}

export interface OpcoesPedir {
  /** Mostra o código (o computador novo escreve em letras grandes). */
  aoMostrarCodigo: (codigo: string, expiraEm: string | null) => void;
  /** O computador onde a janela abriu (quando a nuvem souber). */
  aoEsperar?: (aprovador: string | null) => void;
  dormir: (ms: number) => Promise<void>;
  /** Agora, em ms (os testes trocam). */
  agoraMs?: () => number;
  intervaloMs?: number;
}

/** Por que a nuvem recusou o pedido (a chave é o código do motivo, que não muda; o texto sai no idioma do processo). */
function motivoDaRecusa(motivo: string | null | undefined): string {
  const motivos: Record<string, [string, string]> = {
    recusado_na_tela: ["o pedido foi recusado na tela do computador que já usa o Reveza", "the request was refused on the screen of the computer that already uses Reveza"],
    dois_pedidos: ["chegaram dois pedidos ao mesmo tempo e os dois foram recusados, por segurança", "two requests arrived at the same time and both were refused, for safety"],
    codigo_errado: ["o código digitado não conferiu três vezes e o pedido foi recusado", "the code typed did not match three times and the request was refused"],
  };
  const m = motivos[motivo ?? ""];
  return m ? t(m[0], m[1]) : t("o pedido foi recusado", "the request was refused");
}

/**
 * O computador novo pede para entrar: registra a chave pública, mostra o código e espera a chave do cofre chegar
 * (até o pedido vencer). Confere a impressão contra a da instalação antes de guardar. Devolve a impressão da instalação.
 */
export async function pedirParaEntrar(guarda: Guarda, nuvem: Nuvem, o: OpcoesPedir): Promise<{ impressao: string | null }> {
  if (await lerChave(guarda)) throw new Error(t("este computador já tem a chave do cofre", "this computer already has the vault key"));
  const agora = o.agoraMs ?? (() => Date.now());
  const par = await prepararPedido();
  const pedido = await nuvem.ligacaoPedir(par.publica);
  o.aoMostrarCodigo(par.codigo, pedido.expira_em);
  const vence = (pedido.expira_em ? Date.parse(pedido.expira_em) : agora() + 10 * 60_000) + 30_000;
  let aprovador: string | null | undefined;
  for (;;) {
    let r;
    try {
      r = await nuvem.ligacaoReceber();
    } catch (e) {
      // sem rede por um instante: tenta de novo até o pedido vencer
      if (!(e instanceof ErroNuvem && e.semRede) || agora() > vence) throw e;
      await o.dormir(o.intervaloMs ?? 2000);
      continue;
    }
    if (r.estado === "entregue") {
      if (!r.envelope) throw new Error(t("a nuvem não trouxe a chave do cofre: gere outro código no painel", "the cloud did not bring the vault key: generate another code in the panel"));
      let k: Buffer;
      try {
        k = await abrirChaveDoEnvelope(par.privada, r.envelope, pedido.computador_id, par.segredo);
      } catch {
        // só abre o envelope de quem digitou o código desta tela: um erro nos 4 últimos, ou um envelope montado sem ele
        throw new Error(
          t(
            "a chave entregue não abriu com o código deste computador: confira os 4 últimos caracteres ao digitar e gere outro código no painel",
            "the key delivered did not open with the code of this computer: check the last 4 characters when typing and generate another code in the panel",
          ),
        );
      }
      // a chave precisa ser a desta instalação; outra dividiria o cofre. Sem a impressão na nuvem, recusa: um pedido só
      // é liberado por um computador que já tem a chave, e ele grava a impressão ao subir (revisão de código da 0.2.0,
      // 12/10/2026). Desde a versão 3 o envelope já só abre com o código; a impressão segue como segunda conferência.
      if (!r.impressao) {
        throw new Error(
          t(
            "a nuvem não tem a impressão da chave do cofre desta instalação: abra o Reveza num computador que já o usa (ele grava a impressão) e gere outro código no painel",
            "the cloud does not have the vault key fingerprint of this installation: open Reveza on a computer that already uses it (it stores the fingerprint) and generate another code in the panel",
          ),
        );
      }
      if (r.impressao !== impressaoDaChave(k)) {
        throw new Error(t("a chave recebida não é a desta instalação: libere num computador que já usa o Reveza nesta instalação", "the key received is not from this installation: let it in from a computer that already uses Reveza in this installation"));
      }
      await guarda.gravar(SEGREDO_COFRE, k.toString("base64"));
      return { impressao: r.impressao };
    }
    if (r.estado === "recusado") throw new Error(t(`${motivoDaRecusa(r.motivo)}: gere outro código no painel`, `${motivoDaRecusa(r.motivo)}: generate another code in the panel`));
    if (r.estado === "vencido") throw new Error(t("o pedido venceu (10 minutos): gere outro código no painel", "the request expired (10 minutes): generate another code in the panel"));
    if (r.estado === "lido") throw new Error(t("a chave deste pedido já foi lida: gere outro código no painel", "this request's key was already read: generate another code in the panel"));
    if (r.estado === "sem_pedido") throw new Error(t("a nuvem não achou o pedido deste computador: gere outro código no painel", "the cloud could not find this computer's request: generate another code in the panel"));
    if (r.aprovador !== aprovador) {
      aprovador = r.aprovador;
      o.aoEsperar?.(aprovador);
    }
    if (agora() > vence) throw new Error(t("o pedido venceu (10 minutos): gere outro código no painel", "the request expired (10 minutes): generate another code in the panel"));
    await o.dormir(o.intervaloMs ?? 2000);
  }
}

/** Quem tem a chave do cofre: entrega para um pedido já conferido (a parte sorteada vem de `conferirCodigo`). */
export async function entregarChave(nuvem: Nuvem, k: Buffer, pedido: PedidoLigacao, segredo: string): Promise<void> {
  // quem entrega garante a impressão da chave na nuvem (grava se faltar): o computador novo recusa chave sem impressão
  const daInstalacao = await nuvem.cofreImpressao(impressaoDaChave(k));
  if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
    throw new Error(t("a chave do cofre deste computador não é a da instalação: libere em outro computador", "this computer's vault key is not the installation's: let it in from another computer"));
  }
  const env = await cifrarChaveParaComputadorNovo(pedido.publica, k, pedido.computador_id, segredo);
  const r = await nuvem.ligacaoEntregar(pedido.computador_id, pedido.publica, env);
  if (!r.ok) throw new Error(r.erro ?? t("a nuvem recusou a entrega", "the cloud refused the delivery"));
}

/**
 * `reveza ligar XXXX-XXXX-YYYY` no computador que já tem a chave (sem janela: servidor, VPS, SSH): confere o código digitado
 * contra o do único pedido aberto e entrega. Dois pedidos abertos: recusa os dois.
 */
export async function liberarComputadorNovo(guarda: Guarda, nuvem: Nuvem, digitado: string): Promise<PedidoLigacao> {
  const k = await lerChave(guarda);
  if (!k) throw new Error(t("este computador não tem a chave do cofre: libere num computador que já usa o Reveza", "this computer does not have the vault key: let it in from a computer that already uses Reveza"));
  const daInstalacao = await nuvem.cofreImpressao(null);
  if (daInstalacao && daInstalacao !== impressaoDaChave(k)) {
    throw new Error(t("a chave do cofre deste computador não é a da instalação: libere em outro computador", "this computer's vault key is not the installation's: let it in from another computer"));
  }
  const n = normalizarCodigo(digitado).length;
  if (n === TAMANHO_LIGACAO) throw new Error(t(ANTIGO, ANTIGO_EN));
  if (n !== TAMANHO_CODIGO) throw new Error(t("o código tem 12 letras e números (XXXX-XXXX-YYYY), como aparece no computador novo", "the code has 12 letters and numbers (XXXX-XXXX-YYYY), as shown on the new computer"));
  const pedidos = await nuvem.ligacoesAbertas();
  if (!pedidos.length) throw new Error(t("nenhum computador novo pedindo para entrar agora (o pedido vale 10 minutos)", "no new computer asking to join right now (the request is valid for 10 minutes)"));
  if (pedidos.length > 1) {
    for (const p of pedidos) await nuvem.ligacaoRecusar(p.computador_id, "dois_pedidos").catch(() => undefined);
    throw new Error(t(LIGACAO_DUPLA, LIGACAO_DUPLA_EN));
  }
  const p = pedidos[0]!;
  const segredo = await conferirCodigo(digitado, p.publica);
  if (!segredo) throw new Error(t("o código não confere com o do computador novo: confira as 12 letras e números na tela dele", "the code does not match the one on the new computer: check the 12 letters and numbers on its screen"));
  await entregarChave(nuvem, k, p, segredo);
  return p;
}
