// Alertas do Reveza: o pg_cron chama a cada minuto ({acao: "enviar"}) e à meia-noite UTC ({acao: "resumo"}), com o
// segredo do cron. O administrador chama {acao: "testar", alerta_id} para mandar uma mensagem de teste.
// Canais: telegram, e-mail (Resend), webhook (assinado) e notificação no celular (Web Push com VAPID e o texto cifrado
// para cada aparelho, RFC 8291). O ntfy saiu em 12/10/2026 (migração 0017).
import { ambiente, bearer, comCors, duasEtapasOk, hex, iguais, resposta, rpc, urlExterna, usuario, type Ambiente } from "../_comum/comum.ts";
import { idiomaDe, textoDoEvento, textos } from "../_comum/i18n.ts";

export interface Evento { id: number; tipo: string; texto: string; dados: Record<string, any> }
export interface Canal { id: string; canal: string; destino: Record<string, any>; tem_segredo: boolean; eventos: string[] }

export function chaveDoEvento(e: Evento): string {
  if (e.tipo === "alerta") return String(e.dados?.motivo ?? "alerta");
  return e.tipo; // troca, limite
}

export async function assinatura(corpo: string, segredo: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)));
}

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(texto: string): Uint8Array {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
}

function juntar(...partes: Uint8Array[]): Uint8Array {
  const r = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { r.set(p, i); i += p.length; }
  return r;
}

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, k, bytes * 8));
}

/** Tamanho do registro cifrado (rs): o texto inteiro cabe num registro só. */
const REGISTRO = 4096;
/** O que vai no aviso cabe com folga nos 4 KB que os serviços de push aceitam. */
export const MAX_AVISO = 3000;

/**
 * O aviso cifrado para um aparelho (Web Push, RFC 8291, "aes128gcm"): só o navegador que se inscreveu (chave p256dh e
 * segredo auth da inscrição) consegue ler. O serviço de push (Google, Apple, Mozilla, Microsoft) só vê bytes.
 * `fixo` existe para o teste com o exemplo da RFC (par de chaves e sal conhecidos).
 */
export async function cifrarPush(
  texto: string, p256dh: string, auth: string,
  fixo: { privada?: CryptoKey; publica?: Uint8Array; sal?: Uint8Array } = {},
): Promise<Uint8Array> {
  const uaPublica = deB64url(p256dh);
  const segredo = deB64url(auth);
  if (uaPublica.length !== 65 || segredo.length !== 16) throw new Error("inscrição de push inválida");
  let privada = fixo.privada;
  let asPublica = fixo.publica;
  if (!privada || !asPublica) {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    privada = par.privateKey;
    asPublica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  }
  const chaveUa = await crypto.subtle.importKey("raw", uaPublica, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: chaveUa }, privada, 256));
  const enc = (t: string) => new TextEncoder().encode(t);
  const ikm = await hkdf(segredo, ecdh, juntar(enc("WebPush: info\0"), uaPublica, asPublica), 32);
  const sal = fixo.sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, enc("Content-Encoding: nonce\0"), 12);
  const chave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // um registro só: o texto e o delimitador do último registro (2), sem enchimento
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, chave, juntar(enc(texto), new Uint8Array([2]))));
  const cab = new Uint8Array(16 + 4 + 1 + asPublica.length);
  cab.set(sal, 0);
  new DataView(cab.buffer).setUint32(16, REGISTRO);
  cab[20] = asPublica.length;
  cab.set(asPublica, 21);
  return juntar(cab, cifrado);
}

/** O aviso que o service worker do painel mostra ({titulo, corpo, url, tag}), cortado para caber. */
export function avisoPush(titulo: string, texto: string): string {
  let corpo = texto;
  const montar = () => JSON.stringify({ titulo, corpo, url: "/" });
  while (new TextEncoder().encode(montar()).length > MAX_AVISO && corpo.length > 0) corpo = corpo.slice(0, Math.floor(corpo.length * 0.8)) + "…";
  return montar();
}

// JWT ES256 do VAPID (a chave privada vem como JWK em VAPID_PRIVADA).
export async function vapidJwt(endpoint: string, jwkPrivada: JsonWebKey, contato: string): Promise<string> {
  const chave = await crypto.subtle.importKey("jwk", jwkPrivada, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cab = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const carga = b64url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato,
  })));
  const assin = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, new TextEncoder().encode(`${cab}.${carga}`));
  return `${cab}.${carga}.${b64url(assin)}`;
}

async function segredo(amb: Ambiente, c: Canal): Promise<string> {
  return c.tem_segredo ? String(await rpc(amb, "servico_segredo_alerta", { p_alerta: c.id }) ?? "") : "";
}

// Um destino que cai (DNS, conexão recusada, demora) não derruba os outros nem o resto do lote: o cursor dos alertas já
// andou quando o lote sai do banco, então um erro solto aqui perdia todos os eventos seguintes (auditoria, 11/10/2026).
export const ESPERA_ENVIO_MS = 10_000;
const prazo = () => AbortSignal.timeout(ESPERA_ENVIO_MS);

export async function tentar(envio: () => Promise<boolean>): Promise<boolean> {
  try {
    return await envio();
  } catch {
    return false;
  }
}

export async function enviarCanal(amb: Ambiente, c: Canal, titulo: string, texto: string, f: typeof fetch = fetch): Promise<boolean> {
  const s = await segredo(amb, c);
  let r: Response | null = null;
  if (c.canal === "telegram") {
    r = await f(`https://api.telegram.org/bot${s}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c.destino.chat_id, text: `${titulo}\n${texto}` }), signal: prazo(),
    });
  } else if (c.canal === "email") {
    r = await f("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${s}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.destino.de, to: [c.destino.para], subject: titulo, text: texto }), signal: prazo(),
    });
  } else if (c.canal === "webhook") {
    if (!urlExterna(String(c.destino.url ?? ""))) return false;
    const corpo = JSON.stringify({ titulo, texto, em: new Date().toISOString() });
    r = await f(String(c.destino.url), {
      method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(corpo, s) }, body: corpo,
      redirect: "manual", signal: prazo(),
    });
  } else if (c.canal === "push") {
    return (await enviarPush(amb, f, titulo, texto)) > 0;
  }
  // canal desconhecido (o ntfy que saiu em 12/10/2026, por exemplo): não manda nada
  return !!r && r.ok;
}

/**
 * Manda o aviso para todo aparelho inscrito (push_inscricoes) e devolve quantos o serviço de push aceitou. Inscrição
 * que o serviço diz que acabou (404/410) sai da tabela.
 */
export async function enviarPush(amb: Ambiente, f: typeof fetch = fetch, titulo = "Reveza AI", texto = ""): Promise<number> {
  const env = (globalThis as any).Deno?.env;
  const publica = env?.get("VAPID_PUBLICA");
  const privada = env?.get("VAPID_PRIVADA");
  if (!publica || !privada) return 0;
  const q = await f(`${amb.url}/rest/v1/push_inscricoes?select=id,endpoint,p256dh,auth`, {
    headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}` },
  });
  const lista: { id: string; endpoint: string; p256dh?: string | null; auth?: string | null }[] = await q.json();
  const aviso = avisoPush(titulo, texto);
  let aceitos = 0;
  for (const i of lista) {
    if (!urlExterna(i.endpoint)) continue;
    const ok = await tentar(async () => {
      const jwt = await vapidJwt(i.endpoint, JSON.parse(privada), env.get("REVEZA_SITE") ?? "mailto:reveza@exemplo.invalid");
      const cab: Record<string, string> = { TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${publica}` };
      // sem as chaves da inscrição, vai sem texto (o service worker mostra um aviso genérico)
      let corpo: Uint8Array | undefined;
      if (i.p256dh && i.auth) {
        corpo = await cifrarPush(aviso, i.p256dh, i.auth);
        cab["Content-Encoding"] = "aes128gcm";
        cab["Content-Type"] = "application/octet-stream";
      }
      const r = await f(i.endpoint, { method: "POST", headers: cab, body: corpo, redirect: "manual", signal: prazo() });
      if (r.status === 404 || r.status === 410) {
        await f(`${amb.url}/rest/v1/push_inscricoes?id=eq.${encodeURIComponent(i.id)}`, {
          method: "DELETE", headers: { apikey: amb.servico, Authorization: `Bearer ${amb.servico}` },
        });
      }
      return r.ok;
    });
    if (ok) aceitos++;
  }
  return aceitos;
}

export async function enviarPendentes(amb: Ambiente, f: typeof fetch = fetch): Promise<{ eventos: number; envios: number }> {
  const p = await rpc(amb, "alertas_pendentes", { p_limite: 50 });
  // a língua do alerta é a da instalação (a nuvem antiga não devolve: português)
  const idioma = idiomaDe(p.idioma);
  let envios = 0;
  for (const e of p.eventos as Evento[]) {
    const chave = chaveDoEvento(e);
    const texto = textoDoEvento(e, idioma);
    for (const c of p.canais as Canal[]) {
      if (c.eventos.includes(chave) && (await tentar(() => enviarCanal(amb, c, "Reveza AI", texto, f)))) envios++;
    }
    for (const w of p.webhooks as { id: string; url: string; eventos: string[] }[]) {
      if (!w.eventos.includes(chave) && !w.eventos.includes("*")) continue;
      if (!urlExterna(w.url)) continue;
      const enviado = await tentar(async () => {
        const s = String(await rpc(amb, "servico_segredo_webhook", { p_webhook: w.id }) ?? "");
        const corpo = JSON.stringify({ evento: chave, tipo: e.tipo, texto, dados: e.dados, id: e.id });
        const r = await f(w.url, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(corpo, s) }, body: corpo,
          redirect: "manual", signal: prazo(),
        });
        return r.ok;
      });
      if (enviado) envios++;
    }
  }
  return { eventos: p.eventos.length, envios };
}

export function textoResumo(r: any, idioma: unknown = "pt-BR"): string {
  const x = textos(idioma);
  const usd = Number(r.usd ?? 0).toLocaleString(x.local, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const contas = (r.contas ?? []).map((c: any) => `${c.email}: ${c.pct == null ? x.semLeitura : Math.round(c.pct) + "%"}`).join("\n");
  return x.resumo(usd, r.trocas ?? 0, r.agentes ?? 0, contas);
}

// O idioma da instalação, para as ações que não leem alertas pendentes (consulta sem marcar nada como enviado).
async function idiomaDaInstalacao(amb: Ambiente): Promise<string> {
  const p = await rpc(amb, "alertas_pendentes", { p_limite: 0 }).catch(() => null);
  return idiomaDe(p?.idioma);
}

export async function tratar(req: Request, amb: Ambiente, segredoCron: string): Promise<Response> {
  if (req.method !== "POST") return resposta({ ok: false, erro: "use POST" }, 405);
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const doCron = await iguais(req.headers.get("x-reveza-cron") ?? "", segredoCron);

  if (doCron && corpo.acao === "enviar") {
    await rpc(amb, "vigiar", {});
    return resposta({ ok: true, ...(await enviarPendentes(amb, amb.fetch ?? fetch)) });
  }
  if (doCron && corpo.acao === "resumo") {
    const r = await rpc(amb, "resumo_dia", {});
    const p = await rpc(amb, "alertas_pendentes", { p_limite: 0 });
    const idioma = idiomaDe(p.idioma);
    let envios = 0;
    for (const c of p.canais as Canal[]) {
      if (c.eventos.includes("resumo_dia") && (await tentar(() => enviarCanal(amb, c, textos(idioma).tituloResumo, textoResumo(r, idioma), amb.fetch ?? fetch)))) envios++;
    }
    return resposta({ ok: true, envios });
  }
  if (corpo.acao === "testar_webhook") {
    const quem = await usuario(amb, bearer(req));
    if (!quem || !(await duasEtapasOk(amb, quem)) || (await rpc(amb, "servico_papel", { p_user: quem.id })) !== "admin") {
      return resposta({ ok: false, erro: "só administrador com duas etapas" }, 403);
    }
    const w = await rpc(amb, "servico_webhook", { p_id: String(corpo.webhook_id ?? "") }).catch(() => null);
    if (!w || !w.ativo || !w.tem_segredo) return resposta({ ok: false, erro: "webhook desconhecido, desligado ou sem segredo" }, 404);
    if (!urlExterna(w.url)) return resposta({ ok: false, erro: "o endereço precisa ser https e público" }, 400);
    const s = String(await rpc(amb, "servico_segredo_webhook", { p_webhook: w.id }) ?? "");
    const texto = JSON.stringify({ evento: "teste", tipo: "teste", texto: textos(await idiomaDaInstalacao(amb)).testeWebhook, dados: {}, id: 0 });
    const r = await (amb.fetch ?? fetch)(w.url, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Reveza-Assinatura": await assinatura(texto, s) }, body: texto,
      redirect: "manual",
    }).catch(() => null);
    return resposta({ ok: !!r && r.ok, status: r ? r.status : null }, r && r.ok ? 200 : 502);
  }
  if (corpo.acao === "testar") {
    const quem = await usuario(amb, bearer(req));
    if (!quem || !(await duasEtapasOk(amb, quem)) || (await rpc(amb, "servico_papel", { p_user: quem.id })) !== "admin") {
      return resposta({ ok: false, erro: "só administrador com duas etapas" }, 403);
    }
    const p = await rpc(amb, "alertas_pendentes", { p_limite: 0 });
    const c = (p.canais as Canal[]).find((x) => x.id === corpo.alerta_id);
    if (!c) return resposta({ ok: false, erro: "alerta desconhecido ou desligado" }, 404);
    const x = textos(p.idioma);
    if (c.canal === "push") {
      const aceitos = await enviarPush(amb, amb.fetch ?? fetch, x.tituloTeste, x.testePush);
      return aceitos > 0
        ? resposta({ ok: true, aparelhos: aceitos })
        : resposta({ ok: false, erro: "nenhum aparelho recebeu: ative a notificação neste aparelho e teste de novo" }, 502);
    }
    const ok = await enviarCanal(amb, c, x.tituloTeste, x.testeCanal, amb.fetch ?? fetch);
    return resposta({ ok }, ok ? 200 : 502);
  }
  return resposta({ ok: false, erro: "não autorizado" }, 401);
}

if ((globalThis as any).Deno) {
  const env = (globalThis as any).Deno.env;
  (globalThis as any).Deno.serve(comCors((req: Request) => tratar(req, ambiente(), env.get("REVEZA_CRON") ?? "")));
}
