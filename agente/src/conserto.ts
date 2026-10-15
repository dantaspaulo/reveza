// O conserto do `reveza doctor` e do Corrigir do painel: confere, roda só os consertos seguros da lista fechada para os
// problemas achados, confere de novo e diz, em cada problema, "corrigido" ou o que fazer.
//
// Lista fechada (IdConserto): reinstalar/reiniciar o serviço (só pelo terminal), reinstalar o mod das sessões e pedir a
// troca para a conta atribuída quando o assistente está sem login. Nada aqui recebe texto, caminho ou comando de fora:
// quem chama só diz "conserte". Login de conta, chave do cofre, relógio e instalação do assistente ficam explicados
// (`fazer`), nunca mexidos.

import * as fs from "node:fs";
import * as path from "node:path";
import { doctor, type Conferencia, type DepsDoctor, type IdConserto } from "./doctor.js";
import { t } from "./i18n.js";
import type { Executor } from "./util/executor.js";

export interface Resultado {
  ok: boolean;
  /** O que foi feito (deu certo) ou o que fazer (não deu), em uma linha. */
  texto: string;
}

/** Como cada conserto roda neste lugar; o que falta aqui não roda (vira "não deu" com o motivo). */
export type Consertos = Partial<Record<IdConserto, () => Promise<Resultado>>>;

/** Na ordem: o serviço primeiro (a ponte e a nuvem dependem dele), o mod, e a troca de conta por último (pede o agente). */
export const ORDEM_CONSERTOS: readonly IdConserto[] = ["servico", "mod", "credenciais"];

export interface Conserto {
  antes: Conferencia[];
  /** A conferência de novo, com `consertado` em cada problema que tinha conserto. */
  depois: Conferencia[];
  feitos: (Resultado & { id: IdConserto })[];
}

export async function consertar(d: DepsDoctor, k: Consertos): Promise<Conserto> {
  const antes = await doctor(d);
  const pedidos = new Set(antes.filter((c) => c.situacao !== "ok" && c.conserto).map((c) => c.conserto!));
  const feitos: Conserto["feitos"] = [];
  for (const id of ORDEM_CONSERTOS) {
    if (!pedidos.has(id)) continue;
    const fazer = k[id];
    if (!fazer) {
      feitos.push({ id, ok: false, texto: t("este conserto não roda daqui: no terminal deste computador, rode reveza doctor", "this fix does not run from here: in this computer's terminal, run reveza doctor") });
      continue;
    }
    try {
      const r = await fazer();
      feitos.push({ id, ok: !!r.ok, texto: String(r.texto || (r.ok ? t("feito", "done") : t("o conserto não terminou", "the fix did not finish"))).slice(0, 300) });
    } catch (e) {
      feitos.push({ id, ok: false, texto: t(`o conserto falhou: ${(e as Error).message}`, `the fix failed: ${(e as Error).message}`).slice(0, 300) });
    }
  }
  const depois = feitos.length ? await doctor(d) : antes.map((c) => ({ ...c }));
  for (const a of antes) {
    if (a.situacao === "ok" || !a.conserto) continue;
    const agora = depois.find((x) => x.id === a.id);
    if (!agora) continue;
    const f = feitos.find((x) => x.id === a.conserto);
    // a falha virou só um aviso que o conserto não cobre (o login novo vencido, que as sessões renovam): corrigido
    const sobrouAviso = a.situacao === "falha" && agora.situacao === "aviso" && !agora.conserto && !!f?.ok;
    if (agora.situacao === "ok" || sobrouAviso) {
      const texto = f?.ok ? f.texto : t("voltou a funcionar", "it works again");
      agora.consertado = { resultado: "corrigido", texto: sobrouAviso ? t(`${texto} (fica o aviso: ${agora.detalhe})`, `${texto} (the warning stays: ${agora.detalhe})`) : texto };
    } else {
      const motivo = f && !f.ok ? f.texto : agora.fazer ?? t(`o conserto rodou, mas o problema continua (${agora.detalhe})`, `the fix ran, but the problem remains (${agora.detalhe})`);
      agora.consertado = { resultado: "nao_deu", texto: motivo };
    }
  }
  return { antes, depois, feitos };
}

/** Uma linha para o evento e o log: o que foi consertado e o que não deu. */
export function resumoConserto(depois: Conferencia[]): string {
  const corrigidos = depois.filter((c) => c.consertado?.resultado === "corrigido").map((c) => c.nome);
  const naoDeu = depois.filter((c) => c.consertado?.resultado === "nao_deu").map((c) => c.nome);
  if (!corrigidos.length && !naoDeu.length) return t("nada com conserto automático para fazer", "nothing to fix automatically");
  return [
    corrigidos.length ? t(`corrigido: ${corrigidos.join(", ")}`, `fixed: ${corrigidos.join(", ")}`) : "",
    naoDeu.length ? t(`não deu: ${naoDeu.join(", ")}`, `not fixed: ${naoDeu.join(", ")}`) : "",
  ]
    .filter(Boolean)
    .join("; ");
}

// ------------------------------------------------------------------------------------------------ o mod

/**
 * A pasta do programa instalado (a que o instalador usa como marketplace do mod): o agente roda de
 * `<pasta>/agente/dist/src/cli.js`. Null quando a pasta não tem o mod (agente rodando de outro lugar).
 */
export function pastaDoPrograma(script: string): string | null {
  const app = path.resolve(path.dirname(script), "..", "..", "..");
  const tem = (...p: string[]) => fs.existsSync(path.join(app, ...p));
  return tem(".claude-plugin", "marketplace.json") && tem("mod", ".claude-plugin", "plugin.json") ? app : null;
}

/** O ambiente do usuário para o assistente: sem as variáveis de uma sessão (nem a pasta de uma conta) e sem segredo. */
export function ambienteDoUsuario(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith("CLAUDE_CODE_") || k.startsWith("ANTHROPIC_") || k === "CLAUDE_CONFIG_DIR") continue;
    if (/^(REVEZA_(SENHA|FRASE|CODIGO|ADMIN_SENHA|TELEGRAM_TOKEN|RESEND_CHAVE)|SUPABASE_ACCESS_TOKEN|VERCEL_TOKEN)$/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/**
 * Reinstala o mod nas sessões pelo mesmo caminho do instalador (instalador/lib/programa.mjs, `instalarMod`): o
 * marketplace é a pasta do programa e a porta é a do agente. Já instalado, atualiza o marketplace e o mod.
 */
export async function instalarMod(o: { exec: Executor; assistente: string; app: string; porta: number; env?: NodeJS.ProcessEnv }): Promise<Resultado> {
  const rodar = (args: string[]) => o.exec.rodar([o.assistente, ...args], { env: o.env ?? ambienteDoUsuario(), timeoutMs: 180_000 });
  const r = await rodar(["plugin", "install", "reveza", "--marketplace", o.app, "--scope", "user", "--config", `porta=${o.porta}`, "--json", "-y"]);
  if (r.codigo === 0) return { ok: true, texto: t("mod reinstalado (vale nas sessões novas)", "mod reinstalled (applies to new sessions)") };
  if (/already installed|já instalad/i.test(r.saida + r.erro)) {
    const u = await rodar(["plugin", "marketplace", "update", "reveza"]);
    const p = await rodar(["plugin", "update", "reveza@reveza"]);
    if (u.codigo === 0 && p.codigo === 0) return { ok: true, texto: t("mod atualizado (vale nas sessões novas)", "mod updated (applies to new sessions)") };
    const motivo = (u.erro + p.erro).trim().slice(-200);
    return {
      ok: false,
      texto: t(
        `o assistente não atualizou o mod (${motivo || "sem mensagem"}); rode o instalador com --atualizar`,
        `the assistant did not update the mod (${motivo || "no message"}); run the installer with --atualizar`,
      ),
    };
  }
  const motivo = (r.saida + r.erro).trim().slice(-200);
  return {
    ok: false,
    texto: t(
      `o assistente não instalou o mod (${motivo || `código ${r.codigo}`}); rode o instalador com --atualizar`,
      `the assistant did not install the mod (${motivo || `code ${r.codigo}`}); run the installer with --atualizar`,
    ),
  };
}
