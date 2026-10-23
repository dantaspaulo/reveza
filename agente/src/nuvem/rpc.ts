// Cliente das funções `agente_*`: traduz cada chamada para o nome e os parâmetros `p_*` exatos do banco
// (nuvem/migracoes/0002_agente.sql). O transporte (`Rpc`) é o supabase-js na vida real e um falso nos testes.

import type { Sistema } from "../config.js";
import { deB64, paraB64 } from "./bytea.js";
import {
  chavePublicaValida,
  ErroNuvem,
  type Atribuicao,
  type ChavePublica,
  type EnvelopeChave,
  type MotivoRecusa,
  type PedidoLigacao,
  type RespostaReceber,
  type ComandoNuvem,
  type CofreNuvem,
  type JanelaNuvem,
  type LinhaTokens,
  type MotivoPosse,
  type Nuvem,
  type PontoNuvem,
  type RespostaOla,
  type SessaoNuvem,
  type TokenNuvem,
} from "./tipos.js";

export interface Rpc {
  chamar(funcao: string, args: Record<string, unknown>): Promise<unknown>;
  horaDoServidor(): Promise<number | null>;
}

function obj(v: unknown, funcao: string): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new ErroNuvem(`${funcao}: resposta fora do formato`, false, "formato");
}

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
/** O formato que a nuvem aceita (0025): o que vier fora dele vira "sem modelo". */
export function modeloValido(v: unknown): string | null {
  return typeof v === "string" && /^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$/.test(v) ? v : null;
}
const numero = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function cofreDe(v: unknown): CofreNuvem | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (c.cifrado == null || c.nonce == null) return null;
  return { cifrado: deB64(c.cifrado), nonce: deB64(c.nonce), versao: Number(c.versao ?? 0), expira_em: texto(c.expira_em) };
}

function atribuicaoDe(v: unknown): Atribuicao | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const r: Atribuicao = { conta_id: texto(a.conta_id), email: texto(a.email), motivo: String(a.motivo ?? ""), versao: Number(a.versao ?? 0) };
  if ("modelo" in a) r.modelo = modeloValido(a.modelo);
  return r;
}

function comandoDe(v: unknown): ComandoNuvem | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const id = Number(c.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    acao: String(c.acao ?? ""),
    corpo: c.corpo && typeof c.corpo === "object" && !Array.isArray(c.corpo) ? (c.corpo as Record<string, unknown>) : {},
    criado_em: texto(c.criado_em) ?? undefined,
  };
}

function pedidoDe(v: unknown): PedidoLigacao | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const publica = chavePublicaValida(p.publica);
  const id = texto(p.computador_id);
  if (!publica || !id) return null;
  return {
    computador_id: id,
    publica,
    pedido_em: texto(p.pedido_em),
    expira_em: texto(p.expira_em),
    para_mim: p.para_mim === true,
    aprovador_em: texto(p.aprovador_em),
    idioma: p.idioma === "en" ? "en" : "pt-BR",
  };
}

function pedidosDe(v: unknown): PedidoLigacao[] {
  return (Array.isArray(v) ? v : []).map(pedidoDe).filter((p): p is PedidoLigacao => !!p);
}

function envelopeDe(v: unknown): EnvelopeChave | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const efemera = chavePublicaValida(e.efemera);
  if (!efemera || typeof e.iv !== "string" || typeof e.cifrado !== "string") return null;
  return { efemera, iv: e.iv, cifrado: e.cifrado };
}

const ESTADOS_RECEBER = new Set(["sem_pedido", "esperando", "entregue", "recusado", "vencido", "lido"]);

export class NuvemRpc implements Nuvem {
  constructor(private rpc: Rpc) {}

  private async chamar(funcao: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return obj(await this.rpc.chamar(funcao, args), funcao);
  }

  async registrar(nome: string, sistema: Sistema, versao: string) {
    const r = await this.chamar("agente_registrar", { p_nome: nome, p_sistema: sistema, p_versao: versao });
    return { computador_id: String(r.computador_id) };
  }

  async ola(versao: string, diagnostico: Record<string, unknown> | null, contaLocal: string | null): Promise<RespostaOla> {
    const r = await this.chamar("agente_ola", { p_versao: versao, p_diagnostico: diagnostico, p_conta_local: contaLocal });
    return {
      computador_id: texto(r.computador_id),
      atribuicao: atribuicaoDe(r.atribuicao),
      config: r.config && typeof r.config === "object" ? (r.config as Record<string, unknown>) : {},
      comandos: (Array.isArray(r.comandos) ? r.comandos : []).map(comandoDe).filter((c): c is ComandoNuvem => !!c),
      ligacao_pendente: r.ligacao_pendente === true,
      ligacoes: pedidosDe(r.ligacoes),
      enxugar: r.enxugar === true,
    };
  }

  async pegarPosse(contaId: string, motivo: MotivoPosse, segundos: number) {
    const r = await this.chamar("agente_pegar_posse", { p_conta: contaId, p_motivo: motivo, p_segundos: segundos });
    return { ok: r.ok === true, erro: texto(r.erro), cofre: cofreDe(r.cofre) };
  }

  async devolverCofre(contaId: string, cifrado: Buffer, nonce: Buffer, versaoAnterior: number, expiraEm: string | null) {
    const r = await this.chamar("agente_devolver_cofre", {
      p_conta: contaId,
      p_cifrado: paraB64(cifrado),
      p_nonce: paraB64(nonce),
      p_versao_anterior: versaoAnterior,
      p_expira_em: expiraEm,
    });
    return { ok: r.ok === true, versao: numero(r.versao), erro: texto(r.erro) };
  }

  async soltarPosse(contaId: string) {
    const r = await this.chamar("agente_soltar_posse", { p_conta: contaId });
    return { ok: r.ok === true };
  }

  async registrarConta(
    email: string,
    organizacao: string | null,
    plano: string | null,
    nivel: string | null,
    cifrado: Buffer,
    nonce: Buffer,
    expiraEm: string | null,
  ) {
    const r = await this.chamar("agente_registrar_conta", {
      p_email: email,
      p_organizacao: organizacao,
      p_plano: plano,
      p_nivel: nivel,
      p_cifrado: paraB64(cifrado),
      p_nonce: paraB64(nonce),
      p_expira_em: expiraEm,
    });
    return { ok: r.ok === true, conta_id: texto(r.conta_id), versao: numero(r.versao), erro: texto(r.erro) };
  }

  async relatarUso(janelas: JanelaNuvem[], historico: PontoNuvem[]) {
    const r = await this.chamar("agente_relatar_uso", { p_janelas: janelas, p_historico: historico });
    return { ok: r.ok === true };
  }

  async relatarTokens(linhas: LinhaTokens[], sessoes: SessaoNuvem[]) {
    const r = await this.chamar("agente_relatar_tokens", { p_linhas: linhas, p_sessoes: sessoes });
    return { ok: r.ok === true };
  }

  async limite(contaId: string, sessao: string | null) {
    const r = await this.chamar("agente_limite", { p_conta: contaId, p_sessao: sessao });
    return { ok: r.ok === true, trocou: r.trocou === true, versao: numero(r.versao) };
  }

  async semModelo(contaId: string, modelo: string, sessao: string | null) {
    const r = await this.chamar("agente_sem_modelo", { p_conta: contaId, p_modelo: modelo, p_sessao: sessao });
    return { ok: r.ok === true, trocou: r.trocou === true, versao: numero(r.versao) };
  }

  async reservarComando(id: number) {
    const r = await this.chamar("agente_reservar_comando", { p_id: id });
    return { ok: r.ok === true, comando: comandoDe(r.comando) };
  }

  async responderComando(id: number, http: number, resposta: Record<string, unknown>) {
    const r = await this.chamar("agente_responder_comando", { p_id: id, p_http: http, p_resposta: resposta });
    return { ok: r.ok === true };
  }

  async evento(tipo: string, texto: string, dados: Record<string, unknown>) {
    const r = await this.chamar("agente_evento", { p_tipo: tipo, p_texto: texto, p_dados: dados });
    return { ok: r.ok === true };
  }

  async marcarLogin(contaId: string, precisa: boolean) {
    const r = await this.chamar("agente_marcar_login", { p_conta: contaId, p_precisa: precisa });
    return { ok: r.ok === true };
  }

  async ligacaoPublicar(embrulho: Buffer, sal: Buffer) {
    const r = await this.chamar("agente_ligacao_publicar", { p_embrulho: paraB64(embrulho), p_sal: paraB64(sal) });
    return { ok: r.ok === true, expira_em: texto(r.expira_em) };
  }

  async ligacaoBuscar() {
    const r = await this.chamar("agente_ligacao_buscar", {});
    if (r.ok !== true || r.embrulho == null || r.sal == null) return null;
    return { embrulho: deB64(r.embrulho), sal: deB64(r.sal) };
  }

  async ligacaoPedir(publica: ChavePublica) {
    const r = await this.chamar("agente_ligacao_pedir", { p_publica: publica });
    const id = texto(r.computador_id);
    if (r.ok !== true || !id) throw new ErroNuvem("agente_ligacao_pedir: resposta fora do formato", false, "formato");
    return { computador_id: id, expira_em: texto(r.expira_em) };
  }

  async ligacaoReceber(): Promise<RespostaReceber> {
    const r = await this.chamar("agente_ligacao_receber", {});
    const estado = String(r.estado ?? "");
    if (!ESTADOS_RECEBER.has(estado)) throw new ErroNuvem("agente_ligacao_receber: resposta fora do formato", false, "formato");
    return {
      estado: estado as RespostaReceber["estado"],
      envelope: envelopeDe(r.envelope),
      impressao: texto(r.impressao),
      motivo: texto(r.motivo),
      expira_em: texto(r.expira_em),
      aprovador: texto(r.aprovador),
    };
  }

  async ligacoesAbertas() {
    const r = await this.chamar("agente_ligacoes_abertas", {});
    return pedidosDe(r.pedidos);
  }

  async ligacaoEntregar(computadorId: string, publica: ChavePublica, envelope: EnvelopeChave) {
    const r = await this.chamar("agente_ligacao_entregar", { p_computador: computadorId, p_publica: publica, p_envelope: envelope });
    return { ok: r.ok === true, erro: texto(r.erro) };
  }

  async ligacaoRecusar(computadorId: string, motivo: MotivoRecusa) {
    const r = await this.chamar("agente_ligacao_recusar", { p_computador: computadorId, p_motivo: motivo });
    return { ok: r.ok === true };
  }

  async cofreImpressao(impressao: string | null) {
    const r = await this.chamar("agente_cofre_impressao", { p_impressao: impressao });
    return typeof r.impressao === "string" ? r.impressao : null;
  }

  horaDoServidor() {
    return this.rpc.horaDoServidor();
  }

  async vezDeAtualizar(de: string, para: string) {
    const r = await this.chamar("agente_vez_de_atualizar", { p_de: de, p_para: para });
    return { pode: r.pode === true, motivo: texto(r.motivo) };
  }

  async resultadoAtualizacao(para: string, estado: "concluida" | "falhou" | "nao_comecou", motivo: string | null) {
    const r = await this.chamar("agente_atualizacao_resultado", { p_para: para, p_estado: estado, p_motivo: motivo });
    return { ok: r.ok === true };
  }

  async migracoesAplicadas() {
    const r = await this.chamar("agente_migracoes", {});
    if (r.nomes === null || r.nomes === undefined) return null;
    if (!Array.isArray(r.nomes)) throw new ErroNuvem("agente_migracoes: resposta fora do formato", false, "formato");
    // só nome de arquivo de migração (como o registro do instalador aceita) e resumo sha256
    const nome = (n: unknown): n is string => typeof n === "string" && /^[0-9a-z_.]{1,120}$/.test(n);
    const nomes = r.nomes.filter(nome);
    let hashes: Record<string, string> | null = null;
    if (r.hashes && typeof r.hashes === "object" && !Array.isArray(r.hashes)) {
      hashes = {};
      for (const [n, h] of Object.entries(r.hashes as Record<string, unknown>)) {
        if (nome(n) && typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) hashes[n] = h;
      }
    }
    return { nomes, hashes };
  }

  async credenciaisGuardar(supabase: TokenNuvem, vercel: TokenNuvem, impressao: string) {
    const r = await this.chamar("agente_credenciais_guardar", {
      p_supabase: paraB64(supabase.cifrado),
      p_supabase_nonce: paraB64(supabase.nonce),
      p_vercel: paraB64(vercel.cifrado),
      p_vercel_nonce: paraB64(vercel.nonce),
      p_impressao: impressao,
    });
    return { ok: r.ok === true };
  }

  async credenciaisLer() {
    const r = await this.chamar("agente_credenciais_atualizacao", {});
    const um = (v: unknown) => {
      if (!v || typeof v !== "object") return null;
      const c = v as Record<string, unknown>;
      if (typeof c.cifrado !== "string" || typeof c.nonce !== "string") return null;
      return { cifrado: deB64(c.cifrado), nonce: deB64(c.nonce), gravadoEm: texto(c.gravado_em) };
    };
    return { supabase: um(r.supabase), vercel: um(r.vercel) };
  }

  async painelPublicacao() {
    const r = await this.chamar("agente_painel_publicacao", {});
    const p = r.painel && typeof r.painel === "object" ? (r.painel as Record<string, unknown>) : null;
    if (!p || typeof p.projeto !== "string" || !/^[a-z0-9][a-z0-9-]{0,98}$/.test(p.projeto)) return null;
    const equipe = typeof p.equipe === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(p.equipe) ? p.equipe : null;
    return { projeto: p.projeto, equipe };
  }

  async credenciaisApagar() {
    const r = await this.chamar("agente_credenciais_apagar", {});
    return { ok: r.ok === true };
  }

  async vezDePublicar(para: string) {
    const r = await this.chamar("agente_vez_de_publicar", { p_para: para });
    return { pode: r.pode === true, motivo: texto(r.motivo), funcoes: r.funcoes === true, painel: r.painel === true };
  }

  async resultadoPublicacao(para: string, estado: "concluida" | "falhou", motivo: string | null) {
    const r = await this.chamar("agente_publicacao_resultado", { p_para: para, p_estado: estado, p_motivo: motivo });
    return { ok: r.ok === true };
  }
}
