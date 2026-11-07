// Ponte local com o mod de cada sessão e com a CLI: HTTP só em 127.0.0.1.
//
// Travas: o Host precisa ser 127.0.0.1:<porta> ou localhost:<porta> (contra DNS rebinding) e toda rota exige o
// cabeçalho `X-Reveza: 1` (o navegador não manda cabeçalho próprio de outro site sem preflight, e a ponte não responde
// preflight) e a prova da chave local, que mora em ~/.reveza/ponte.chave (só o dono do computador lê): outro usuário
// do mesmo computador, que alcança 127.0.0.1, não lê e-mails nem força troca. Corpo de até 64 KB, sempre um objeto
// JSON. Nenhuma resposta traz token ou segredo.
//
// A chave nunca viaja: quem pede manda X-Reveza-Tempo, X-Reveza-Nonce e X-Reveza-Prova = HMAC-SHA256(chave,
// "MÉTODO\ncaminho\ntempo\nnonce"). Assim, se outro programa estiver na porta no lugar do agente, ele não aprende a
// chave (auditoria de segurança de 11/10/2026). Prova vale 60 s e cada nonce, uma vez.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

/** A chave local da ponte: criada uma vez (64 hex, arquivo 600) e lida pelo mod e pela linha de comando. */
export function chaveDaPonte(arquivo: string, criar = true): string | null {
  try {
    const t = fs.readFileSync(arquivo, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch {
    /* ainda não existe */
  }
  if (!criar) return null;
  const nova = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  const tmp = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, nova + "\n", { mode: 0o600 });
  fs.renameSync(tmp, arquivo);
  return nova;
}

function chaveConfere(recebida: unknown, certa: string): boolean {
  if (typeof recebida !== "string" || recebida.length !== certa.length) return false;
  return timingSafeEqual(Buffer.from(recebida), Buffer.from(certa));
}

export function provaDaPonte(chave: string, metodo: string, caminho: string, tempo: string, nonce: string): string {
  return createHmac("sha256", Buffer.from(chave, "hex")).update(`${metodo}\n${caminho}\n${tempo}\n${nonce}`).digest("hex");
}

/** Prova do agente na resposta: quem pediu confere que falou com o agente de verdade, não com outro programa na porta. */
export function provaDoServidor(chave: string, nonce: string): string {
  return createHmac("sha256", Buffer.from(chave, "hex")).update(`servidor\n${nonce}`).digest("hex");
}

/** Cabeçalhos de quem pede: a prova da chave, nunca a chave. */
export function cabecalhosDaPonte(chave: string | null, metodo: string, caminho: string): Record<string, string> {
  if (!chave) return {};
  const tempo = String(Date.now());
  const nonce = randomUUID();
  return { "X-Reveza-Tempo": tempo, "X-Reveza-Nonce": nonce, "X-Reveza-Prova": provaDaPonte(chave, metodo, caminho, tempo, nonce) };
}

const JANELA_PROVA_MS = 60_000;

export interface Resposta {
  status: number;
  corpo: unknown;
}

export interface AlvoPonte {
  ativa(): unknown;
  estado(): unknown;
  medida(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  limite(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  fila(sessao: string, acao: string): Resposta | Promise<Resposta>;
  trocar(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  atualizar(): Resposta | Promise<Resposta>;
  conectar(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  /** O código que a página do login mostrou, para o login aberto por `conectar` (o `reveza contas conectar` manda). */
  codigoLogin(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  adotar(): Resposta | Promise<Resposta>;
  som(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  /** O resumo da conversa (autoCompactWindow do Claude Code) nas contas que não são 20x (`reveza resumo`). */
  resumo(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  /** A sessão que parou com "Prompt is too long" (o mod manda o tamanho da conversa). */
  sessaoErro(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  /** Conserto do `reveza doctor` que precisa do agente rodando (só os da lista fechada, pelo nome). */
  consertar(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
  /**
   * Sessões críticas (0.15.0): `{ sessao }` lê a marca da sessão; `{ sessao, critica }` marca ou desmarca; `{}` lista
   * (a linha de comando).
   */
  critica(corpo: Record<string, unknown>): Resposta | Promise<Resposta>;
}

const SESSAO = /^[A-Za-z0-9_-]{1,80}$/;

export function criarPonte(alvo: AlvoPonte, porta: number, chave: string | null = null): http.Server {
  const hosts = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);
  const nonces = new Map<string, number>();

  const autorizado = (req: http.IncomingMessage, caminho: string, k: string): string | boolean => {
    const tempo = req.headers["x-reveza-tempo"];
    const nonce = req.headers["x-reveza-nonce"];
    const prova = req.headers["x-reveza-prova"];
    if (typeof tempo === "string" && typeof nonce === "string" && typeof prova === "string") {
      const t = Number(tempo);
      const agora = Date.now();
      if (!/^\d{1,16}$/.test(tempo) || Math.abs(agora - t) > JANELA_PROVA_MS) return false;
      if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce) || nonces.has(nonce)) return false;
      if (!chaveConfere(prova, provaDaPonte(k, req.method ?? "", caminho, tempo, nonce))) return false;
      if (nonces.size > 5000) for (const [n, ate] of nonces) if (ate < agora) nonces.delete(n);
      nonces.set(nonce, agora + 2 * JANELA_PROVA_MS);
      return nonce;
    }
    // compatibilidade: sessões abertas antes desta versão ainda mandam a chave; sai na próxima versão
    return chaveConfere(req.headers["x-reveza-chave"], k);
  };

  const responder = (res: http.ServerResponse, status: number, dados: unknown) => {
    const corpo = Buffer.from(JSON.stringify(dados));
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(corpo.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(corpo);
  };

  return http.createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (!hosts.has(host)) return responder(res, 403, { ok: false, erro: "host recusado" });
    if (req.method === "OPTIONS") {
      res.writeHead(405);
      return res.end();
    }
    if (req.headers["x-reveza"] !== "1") return responder(res, 403, { ok: false, erro: "cabeçalho X-Reveza ausente" });
    const caminho = (req.url ?? "").split("?")[0] ?? "";
    if (chave) {
      const ok = autorizado(req, caminho, chave);
      if (!ok) return responder(res, 401, { ok: false, erro: "prova da chave local da ponte ausente, vencida ou errada" });
      if (typeof ok === "string") res.setHeader("X-Reveza-Servidor", provaDoServidor(chave, ok));
    }

    if (req.method === "GET") {
      if (caminho === "/api/ativa") return responder(res, 200, alvo.ativa());
      if (caminho === "/api/estado") return responder(res, 200, alvo.estado());
      return responder(res, 404, { ok: false, erro: "rota desconhecida" });
    }
    if (req.method !== "POST") return responder(res, 405, { ok: false, erro: "método não aceito" });

    const partes: Buffer[] = [];
    let tamanho = 0;
    let estourou = false;
    req.on("data", (d: Buffer) => {
      tamanho += d.length;
      if (tamanho > 65536) {
        estourou = true;
        req.destroy();
      } else partes.push(d);
    });
    req.on("end", () => {
      if (estourou) return;
      let corpo: unknown;
      try {
        corpo = JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
      } catch {
        return responder(res, 400, { ok: false, erro: "JSON inválido" });
      }
      if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
        return responder(res, 400, { ok: false, erro: "o corpo precisa ser um objeto" });
      }
      const c = corpo as Record<string, unknown>;
      const rodar = async (): Promise<Resposta> => {
        if (caminho === "/api/medida") return alvo.medida(c);
        if (caminho === "/api/limite") return alvo.limite(c);
        if (caminho === "/api/trocar") return alvo.trocar(c);
        if (caminho === "/api/atualizar") return alvo.atualizar();
        if (caminho === "/api/contas/conectar") return alvo.conectar(c);
        if (caminho === "/api/contas/codigo") return alvo.codigoLogin(c);
        if (caminho === "/api/contas/adotar") return alvo.adotar();
        if (caminho === "/api/som") return alvo.som(c);
        if (caminho === "/api/resumo") return alvo.resumo(c);
        if (caminho === "/api/sessao/erro") return alvo.sessaoErro(c);
        if (caminho === "/api/consertar") return alvo.consertar(c);
        if (caminho === "/api/critica") return alvo.critica(c);
        const m = /^\/api\/fila\/([^/]+)\/(retomada|descartar)$/.exec(caminho);
        if (m) {
          const sessao = decodeURIComponent(m[1]!);
          if (!SESSAO.test(sessao)) return { status: 400, corpo: { ok: false, erro: "sessão inválida" } };
          return alvo.fila(sessao, m[2]!);
        }
        return { status: 404, corpo: { ok: false, erro: "rota desconhecida" } };
      };
      rodar().then(
        (r) => responder(res, r.status, r.corpo),
        () => responder(res, 500, { ok: false, erro: "falha interna; veja o log do agente" }),
      );
    });
  });
}

/** Cliente da ponte, para a CLI falar com o agente que está rodando. */
export async function pedirPonte(
  porta: number,
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown,
  chave: string | null = null,
  /** Quanto esperar a resposta (o conserto da credencial pode renovar um login, que leva mais). */
  esperaMs = 30_000,
): Promise<Resposta | null> {
  try {
    const cab = cabecalhosDaPonte(chave, metodo, caminho.split("?")[0] ?? "");
    const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", "X-Reveza": "1", ...cab },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(esperaMs),
    });
    // resposta de sucesso só vale com a prova do agente (outro programa na porta não sabe a chave)
    if (chave && r.ok) {
      const certa = provaDoServidor(chave, cab["X-Reveza-Nonce"]!);
      if (!chaveConfere(r.headers.get("x-reveza-servidor"), certa)) return null;
    }
    return { status: r.status, corpo: await r.json() };
  } catch {
    return null;
  }
}
