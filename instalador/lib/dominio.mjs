// Domínio próprio do painel: validação, o passo a passo do registro de DNS (em qualquer provedor) e a conferência do DNS
// (por DNS sobre HTTPS).

import { domainToASCII } from "node:url";
import { t } from "./texto.mjs";

/**
 * O subdomínio do painel, como a Vercel e o DNS entendem: minúsculas, sem esquema nem barra, sem o ponto final de nome
 * absoluto (contas.x.com.) e com acento em punycode (painel.ação.com.br → painel.xn--ao-siap.com.br).
 */
export function dominioValido(d) {
  let s = String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.$/, "");
  if (/[^\x00-\x7f]/.test(s)) s = domainToASCII(s);
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(s)) return null;
  return s;
}

/**
 * O registro que a Vercel pede, para criar onde o domínio estiver (registro.br, Cloudflare, GoDaddy, Hostinger, Route 53
 * ou qualquer outro DNS). A dica da Cloudflare (proxy desligado) vem por último, como observação.
 */
export function passosDns(registro, t) {
  const r = registro;
  return [
    t("No DNS de onde o domínio está (registro.br, Cloudflare, GoDaddy, Hostinger, Route 53 ou outro), crie este registro:",
      "In the DNS where the domain lives (Cloudflare, GoDaddy, Namecheap, Route 53 or any other), create this record:"),
    `    ${t("Tipo", "Type")}: ${r.tipo}    ${t("Nome", "Name")}: ${r.nome}    ${t("Valor", "Value")}: ${r.valor}`,
    t("    Salve. A Vercel confere o registro e emite o certificado HTTPS sozinha (pode levar alguns minutos).",
      "    Save it. Vercel checks the record and issues the HTTPS certificate by itself (it may take a few minutes)."),
    t("    Na Cloudflare: deixe o proxy desligado (nuvem cinza, \"DNS only\"); com a nuvem laranja o certificado não sai.",
      "    On Cloudflare: keep the proxy off (grey cloud, \"DNS only\"); with the orange cloud the certificate cannot be issued."),
  ];
}

/** O nome antigo (o passo a passo era só da Cloudflare). */
export const passosCloudflare = passosDns;

/**
 * O domínio pedido por --dominio (ou REVEZA_DOMINIO): undefined quando não pediu; null para voltar ao endereço da Vercel
 * (`--dominio vercel`); o subdomínio conferido. Inválido: erro (pela opção) ou nada (pela variável, como antes).
 */
export function dominioPedido(opcao, env = {}) {
  if (opcao !== undefined) {
    if (/^\s*vercel\s*$/i.test(String(opcao))) return null;
    const d = dominioValido(opcao);
    if (!d) throw new Error(t(`domínio inválido: ${opcao} (use um subdomínio, como contas.meudominio.com, ou vercel)`,
      `invalid domain: ${opcao} (use a subdomain, like accounts.mydomain.com, or vercel)`));
    return d;
  }
  const v = env.REVEZA_DOMINIO;
  if (!v) return undefined;
  if (/^\s*vercel\s*$/i.test(v)) return null;
  return dominioValido(v) ?? undefined;
}

/** O registro já responde como a Vercel pede? (consulta pública na Cloudflare, sem depender do DNS do computador) */
export async function dnsPronto(dominio, registro, { fetch: f = globalThis.fetch } = {}) {
  const tipo = registro.tipo === "A" ? "A" : "CNAME";
  try {
    const r = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dominio)}&type=${tipo}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) return false;
    const d = await r.json();
    const respostas = (d.Answer || []).map((a) => String(a.data).replace(/\.$/, "").toLowerCase());
    return respostas.includes(String(registro.valor).replace(/\.$/, "").toLowerCase());
  } catch {
    return false;
  }
}
