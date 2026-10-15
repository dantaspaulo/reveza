// Importação do roteador antigo (`reveza importar --de <pasta do roteador>`).
//
// Só COPIA: nada na pasta de origem, nas pastas das contas antigas ou nas entradas antigas de credencial é movido,
// apagado ou regravado. Copia o registro das contas (estado.json), a pasta e a credencial de cada conta (para
// ~/.reveza/contas/<id>), a configuração, os eventos, a linha do tempo e o histórico; o registro de uso (uso.db,
// SQLite) vira o estado inicial do registro de uso, lido de uma cópia temporária.
//
// Rodar de novo atualiza as credenciais copiadas (para pegar o login mais novo na hora da migração de verdade) e não
// soma o uso duas vezes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { TIPOS_JANELA, type Janela, type Perfil } from "./anthropic.js";
import type { Caminhos } from "./config.js";
import { servicoDaPasta } from "./credenciais/blob.js";
import type { Credenciais } from "./credenciais/tipos.js";
import { carregarEstado, novaConta, salvarEstado, type ContaLocal, type EstadoLocal, type ItemFila } from "./estado.js";
import { t } from "./i18n.js";
import { copiarPasta } from "./util/arquivos.js";
import type { Executor } from "./util/executor.js";
import { Contador, projetoDe, type LinhaHora, type SessaoReg } from "./registro/contador.js";

export interface DadosBanco {
  arquivos: { caminho: string; lido: number }[];
  vistos: string[];
  porHora: { hora: number; conta: string; modelo: string; msgs: number; ent: number; sai: number; c5: number; c1h: number; cl: number; usd: number }[];
  sessoes: {
    sessao: string;
    projeto: string | null;
    inicio: number | null;
    fim: number | null;
    msgs: number;
    ent: number;
    sai: number;
    c5: number;
    c1h: number;
    cl: number;
    usd: number;
    contas: string;
    modelos: string;
  }[];
  agentes: { sessao: string; agente: string; inicio: number | null; conta: string | null }[];
}

export interface RelatorioImportacao {
  contas: { email: string; id: string; credencial: "copiada" | "atualizada" | "sem credencial"; pasta: number }[];
  ativa: string | null;
  uso: { importado: boolean; linhas: number; sessoes: number; vistos: number; motivo?: string };
  avisos: string[];
}

const CONSULTAS: Record<keyof DadosBanco, string> = {
  arquivos: "select caminho, lido from arquivos",
  vistos: "select id from vistos",
  porHora: "select hora, conta, modelo, msgs, ent, sai, c5, c1h, cl, usd from por_hora",
  sessoes: "select sessao, projeto, inicio, fim, msgs, ent, sai, c5, c1h, cl, usd, contas, modelos from sessoes",
  agentes: "select sessao, agente, inicio, conta from agentes",
};

/** Lê o uso.db de uma CÓPIA (o original pode estar aberto pelo roteador). node:sqlite quando existe; senão sqlite3. */
export async function lerBancoSqlite(arquivo: string, exec: Executor): Promise<DadosBanco> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reveza-importar-"));
  try {
    const copia = path.join(tmp, "uso.db");
    for (const sufixo of ["", "-wal", "-shm"]) {
      if (fs.existsSync(arquivo + sufixo)) fs.copyFileSync(arquivo + sufixo, copia + sufixo);
    }
    const consultas = Object.entries(CONSULTAS) as [keyof DadosBanco, string][];
    type Sqlite = { DatabaseSync: new (arq: string) => { prepare(sql: string): { all(): unknown[] }; close(): void } };
    let modulo: Sqlite | null = null;
    try {
      const nome = "node:" + "sqlite";
      modulo = (await import(nome)) as Sqlite;
    } catch {
      modulo = null;
    }
    const saida = {} as Record<keyof DadosBanco, unknown[]>;
    if (modulo) {
      const db = new modulo.DatabaseSync(copia);
      try {
        for (const [k, sql] of consultas) saida[k] = db.prepare(sql).all();
      } finally {
        db.close();
      }
    } else {
      for (const [k, sql] of consultas) {
        const r = await exec.rodar(["sqlite3", "-json", copia, sql], { timeoutMs: 120_000 });
        if (r.codigo !== 0) throw new Error(t(`sqlite3 falhou: ${r.erro.trim()}`, `sqlite3 failed: ${r.erro.trim()}`));
        saida[k] = r.saida.trim() ? (JSON.parse(r.saida) as unknown[]) : [];
      }
    }
    return {
      arquivos: saida.arquivos as DadosBanco["arquivos"],
      vistos: (saida.vistos as { id: string }[]).map((v) => v.id),
      porHora: saida.porHora as DadosBanco["porHora"],
      sessoes: saida.sessoes as DadosBanco["sessoes"],
      agentes: saida.agentes as DadosBanco["agentes"],
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

interface ContaAntiga {
  email?: string;
  org?: string | null;
  accountUuid?: string | null;
  orgUuid?: string | null;
  plano?: string | null;
  tier?: string | null;
  pasta?: string;
  servico?: string;
  pausada?: boolean;
  precisaLogin?: boolean;
  conectadaEm?: number;
  janelas?: { tipo: string; pct: number | null; resetEm: number | null }[];
  lidoEm?: number | null;
  fonte?: string | null;
  tokenExpiraEm?: number | null;
  erro?: string | null;
}

interface EstadoAntigo {
  auto?: boolean;
  aviso?: number;
  troca?: number;
  retomarHeadless?: boolean;
  modo?: string;
  rodizio?: { minutos?: number; ordem?: string };
  ativa?: string | null;
  versao?: number;
  trocadaEm?: number;
  contas?: Record<string, ContaAntiga>;
  eventos?: { em: number; tipo: string; texto: string }[];
  fila?: { sessao: string; cwd: string; tipo: string; em: number; estado: string; conta: string | null }[];
  identidades?: Record<string, Perfil>;
  historico?: Record<string, { t: number; p5: number | null; p7: number | null }[]>;
  linhaContas?: [number, string][];
}

export interface OpcoesImportar {
  de: string;
  c: Caminhos;
  cred: Credenciais;
  exec: Executor;
  agora: number;
  lerBanco?: (arquivo: string) => Promise<DadosBanco>;
  /** macOS: confere que o nome da entrada antiga bate com a pasta (o roteador usa a mesma regra). */
  conferirServico?: boolean;
}

function janelas(v: ContaAntiga["janelas"]): Janela[] {
  return (v ?? [])
    .filter((j) => (TIPOS_JANELA as readonly string[]).includes(j.tipo))
    .map((j) => ({ tipo: j.tipo as Janela["tipo"], pct: j.pct ?? null, resetEm: j.resetEm ?? null }));
}

export async function importar(o: OpcoesImportar): Promise<RelatorioImportacao> {
  const arqEstado = path.join(o.de, "estado.json");
  let antigo: EstadoAntigo;
  try {
    antigo = JSON.parse(fs.readFileSync(arqEstado, "utf8")) as EstadoAntigo;
  } catch {
    throw new Error(t(`não achei o registro do roteador em ${arqEstado}`, `I could not find the router record at ${arqEstado}`));
  }
  const estado: EstadoLocal = carregarEstado(o.c.estado);
  const rel: RelatorioImportacao = { contas: [], ativa: null, uso: { importado: false, linhas: 0, sessoes: 0, vistos: 0 }, avisos: [] };
  const mapa = new Map<string, string>();

  for (const [slug, ca] of Object.entries(antigo.contas ?? {})) {
    if (!ca.email || !ca.pasta) {
      rel.avisos.push(t(`conta ${slug} sem e-mail ou pasta: ficou de fora`, `account ${slug} without an email or folder: left out`));
      continue;
    }
    if (o.conferirServico && ca.servico && ca.servico !== servicoDaPasta(ca.pasta)) {
      rel.avisos.push(t(`${ca.email}: a entrada antiga (${ca.servico}) não bate com a pasta; credencial não copiada`, `${ca.email}: the old entry (${ca.servico}) does not match the folder; credential not copied`));
    }
    let conta: ContaLocal | undefined = Object.values(estado.contas).find(
      (c) => (c.accountUuid && c.accountUuid === ca.accountUuid && c.orgUuid === ca.orgUuid) || c.email === ca.email!.toLowerCase(),
    );
    const nova = !conta;
    if (!conta) {
      let id = randomBytes(4).toString("hex");
      while (estado.contas[id]) id = randomBytes(4).toString("hex");
      const pasta = path.join(o.c.contas, id);
      const perfil: Perfil = {
        accountUuid: ca.accountUuid ?? null,
        email: ca.email,
        orgUuid: ca.orgUuid ?? null,
        org: ca.org ?? null,
        orgTipo: null,
        tier: ca.tier ?? null,
      };
      conta = novaConta(id, perfil, pasta, ca.conectadaEm ?? o.agora);
      Object.assign(conta, {
        plano: ca.plano ?? null,
        pausada: !!ca.pausada,
        precisaLogin: !!ca.precisaLogin,
        janelas: janelas(ca.janelas),
        lidoEm: ca.lidoEm ?? null,
        fonte: ca.fonte === "sessao" || ca.fonte === "api" ? ca.fonte : null,
        tokenExpiraEm: ca.tokenExpiraEm ?? null,
        erro: ca.erro ?? null,
      });
      estado.contas[id] = conta;
    }
    mapa.set(slug, conta.id);
    fs.mkdirSync(conta.pasta, { recursive: true, mode: 0o700 });
    let copiados = 0;
    if (fs.existsSync(ca.pasta)) {
      // Os arquivos da pasta (o .claude.json com o oauthAccount, e no Linux/Windows o .credentials.json).
      copiados = copiarPasta(ca.pasta, conta.pasta);
    } else {
      rel.avisos.push(t(`${ca.email}: a pasta antiga ${ca.pasta} não existe`, `${ca.email}: the old folder ${ca.pasta} does not exist`));
    }
    let credencial: RelatorioImportacao["contas"][number]["credencial"] = "sem credencial";
    const servicoOk = !o.conferirServico || !ca.servico || ca.servico === servicoDaPasta(ca.pasta);
    const blob = servicoOk ? await o.cred.ler(ca.pasta) : null;
    if (blob) {
      await o.cred.gravar(conta.pasta, blob);
      credencial = nova ? "copiada" : "atualizada";
    }
    rel.contas.push({ email: conta.email, id: conta.id, credencial, pasta: copiados });
  }

  const cfg = estado.config;
  if (typeof antigo.auto === "boolean") cfg.auto = antigo.auto;
  if (typeof antigo.aviso === "number") cfg.aviso = antigo.aviso;
  if (typeof antigo.troca === "number") cfg.troca = antigo.troca;
  if (typeof antigo.retomarHeadless === "boolean") cfg.retomarHeadless = antigo.retomarHeadless;
  if (antigo.modo === "limiar" || antigo.modo === "limite" || antigo.modo === "rodizio") cfg.modo = antigo.modo;
  if (antigo.rodizio?.minutos) cfg.rodizio.minutos = antigo.rodizio.minutos;
  if (antigo.rodizio?.ordem === "aleatoria" || antigo.rodizio?.ordem === "menor_uso") cfg.rodizio.ordem = antigo.rodizio.ordem;

  const ativa = antigo.ativa ? (mapa.get(antigo.ativa) ?? null) : null;
  if (ativa) {
    estado.ativa = ativa;
    estado.versao = Math.max(estado.versao, antigo.versao ?? 0);
    estado.trocadaEm = antigo.trocadaEm ?? estado.trocadaEm;
  }
  rel.ativa = ativa ? estado.contas[ativa]!.email : null;

  const jaTinha = new Set(estado.eventos.map((e) => `${e.em}|${e.texto}`));
  for (const e of antigo.eventos ?? []) {
    if (jaTinha.has(`${e.em}|${e.texto}`)) continue;
    estado.eventos.push({ em: e.em, tipo: e.tipo as EstadoLocal["eventos"][number]["tipo"], texto: e.texto, dados: { importado: true } });
  }
  estado.eventos.sort((a, b) => b.em - a.em);
  estado.eventos.splice(100);

  for (const f of antigo.fila ?? []) {
    if (estado.fila.some((x) => x.sessao === f.sessao)) continue;
    estado.fila.push({
      sessao: f.sessao,
      cwd: f.cwd,
      tipo: f.tipo === "headless" ? "headless" : "interativa",
      em: f.em,
      estado: (["aguardando", "retomada", "descartada"].includes(f.estado) ? f.estado : "descartada") as ItemFila["estado"],
      conta: f.conta ? (mapa.get(f.conta) ?? null) : null,
    });
  }
  Object.assign(estado.identidades, antigo.identidades ?? {});
  for (const [slug, pontos] of Object.entries(antigo.historico ?? {})) {
    const id = mapa.get(slug);
    if (id && !estado.historico[id]?.length) estado.historico[id] = pontos;
  }
  if (!estado.linhaContas.length) {
    estado.linhaContas = (antigo.linhaContas ?? []).filter(([, s]) => mapa.has(s)).map(([t, s]) => [t, mapa.get(s)!]);
  }

  // Registro de uso: uma vez só (depois disso o agente segue contando sozinho, de onde a cópia parou).
  const marca = path.join(o.c.registro, "importado-do-roteador.json");
  const banco = path.join(o.de, "uso.db");
  if (fs.existsSync(marca)) {
    rel.uso.motivo = t("já importado antes", "already imported before");
  } else if (!fs.existsSync(banco)) {
    rel.uso.motivo = t("sem uso.db na origem", "no uso.db at the source");
  } else {
    const dados = await (o.lerBanco ?? ((a: string) => lerBancoSqlite(a, o.exec)))(banco);
    const conta = (slug: string | null | undefined) => (slug ? (mapa.get(slug) ?? "") : "");
    const contadorAgentes = new Map<string, number>();
    for (const a of dados.agentes) contadorAgentes.set(a.sessao, (contadorAgentes.get(a.sessao) ?? 0) + 1);
    const contador = new Contador(o.c.registro, o.c.projetos, () => null);
    const horas: LinhaHora[] = dados.porHora.map((h) => ({ ...h, conta: conta(h.conta), projeto: "" }));
    const sessoes: SessaoReg[] = dados.sessoes.map((s) => ({
      sessao: s.sessao,
      projeto: projetoDe(s.projeto),
      inicio: s.inicio ?? 0,
      fim: s.fim ?? 0,
      msgs: s.msgs,
      ent: s.ent,
      sai: s.sai,
      c5: s.c5,
      c1h: s.c1h,
      cl: s.cl,
      usd: s.usd,
      contas: [...new Set((JSON.parse(s.contas || "[]") as string[]).map(conta))].sort(),
      modelos: JSON.parse(s.modelos || "[]") as string[],
      agentes: contadorAgentes.get(s.sessao) ?? 0,
      parada: false,
    }));
    contador.importar({
      arquivos: Object.fromEntries(dados.arquivos.map((a) => [a.caminho, a.lido])),
      vistos: dados.vistos,
      horas,
      sessoes,
      agentes: dados.agentes.map((a) => ({ sessao: a.sessao, agente: a.agente, inicio: a.inicio ?? 0, conta: conta(a.conta) })),
    });
    fs.writeFileSync(marca, JSON.stringify({ de: banco, em: o.agora, linhas: horas.length }), { mode: 0o600 });
    rel.uso = { importado: true, linhas: horas.length, sessoes: sessoes.length, vistos: dados.vistos.length };
  }

  salvarEstado(o.c.estado, estado);
  return rel;
}
