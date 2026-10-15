// Frase de ligação: como um computador novo recebe a chave do cofre sem a chave passar em claro pela nuvem.
//
// O computador que tem K sorteia 6 palavras, deriva uma chave com scrypt (sal aleatório de 16 bytes) e publica K
// embrulhado por 10 minutos. O novo digita as palavras e desembrulha. A frase nunca vai à nuvem.
// Com 6 palavras de uma lista de ~1.100, são uns 60 bits; o scrypt deixa cada tentativa cara, a janela é de 10 min e
// o embrulho só sai da nuvem para um computador já autenticado, uma vez.

import { randomBytes, randomInt, scryptSync } from "node:crypto";
import type { Idioma } from "../i18n.js";
import { cifrar, decifrar, TAMANHO_CHAVE } from "./cifra.js";
import { PALAVRAS_EN, PALAVRAS_PT } from "./palavras.js";

export const PALAVRAS_NA_FRASE = 6;
const AAD = "reveza-ligacao|1";
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type { Idioma };

export function listaDo(idioma: Idioma): readonly string[] {
  return idioma === "en" ? PALAVRAS_EN : PALAVRAS_PT;
}

export function gerarFrase(idioma: Idioma = "pt-BR", n = PALAVRAS_NA_FRASE): string {
  const lista = listaDo(idioma);
  const palavras: string[] = [];
  for (let i = 0; i < n; i++) palavras.push(lista[randomInt(lista.length)]!);
  return palavras.join(" ");
}

/** Minúsculas, sem acento, uma palavra por espaço (aceita hífen, vírgula e quebras de linha entre elas). */
export function normalizar(frase: string): string {
  return frase
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[\s,;.\-_]+/)
    .filter(Boolean)
    .join(" ");
}

/** Palavras que não estão em nenhuma lista (erro de digitação provável). */
export function palavrasDesconhecidas(frase: string): string[] {
  const todas = new Set<string>([...PALAVRAS_PT, ...PALAVRAS_EN]);
  return normalizar(frase)
    .split(" ")
    .filter((p) => p && !todas.has(p));
}

export function derivar(frase: string, sal: Buffer): Buffer {
  return scryptSync(normalizar(frase), sal, TAMANHO_CHAVE, SCRYPT);
}

/** Embrulho = nonce (12) + cifrado de K com a tag. */
export function embrulhar(chaveCofre: Buffer, frase: string): { embrulho: Buffer; sal: Buffer } {
  if (normalizar(frase).split(" ").length < PALAVRAS_NA_FRASE) throw new Error("a frase precisa de 6 palavras");
  const sal = randomBytes(16);
  const { cifrado, nonce } = cifrar(derivar(frase, sal), AAD, chaveCofre);
  return { embrulho: Buffer.concat([nonce, cifrado]), sal };
}

export function desembrulhar(embrulho: Buffer, sal: Buffer, frase: string): Buffer {
  const k = decifrar(derivar(frase, sal), AAD, embrulho.subarray(12), embrulho.subarray(0, 12));
  if (k.length !== TAMANHO_CHAVE) throw new Error("chave do cofre com tamanho errado");
  return k;
}
