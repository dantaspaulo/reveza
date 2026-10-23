// FonteSupabase: o painel contra o banco da instalação (nuvem/migracoes). Leitura direta nas tabelas, com a segurança
// de linha decidindo o que cada um vê (convites, alertas, webhooks e auditoria só para administrador; chaves de API
// sem a coluna do resumo). Escrita só pelas funções painel_* (parâmetros p_*), que conferem papel e aal2.
// Os testes desta fonte ficam para quando houver um banco de pé para o painel; a demonstração usa a FonteDemo.

import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js"

import { supabase } from "./cliente"
import { rotuloDestino } from "./rotulos"
import { codigoDeAcesso } from "../lib/ligacao"
import {
  ErroPainel,
  type CamposConta,
  type EstadoTempoReal,
  type Fonte,
  type Recursos,
  type ResultadoNuvem,
} from "./fonte"
import type {
  AcaoComando,
  Alerta,
  ChaveApi,
  Comando,
  ConfigTroca,
  Conta,
  Computador,
  Convite,
  EscopoChave,
  Eu,
  Evento,
  EventoAlerta,
  Idioma,
  Instantaneo,
  Intervalo,
  ItemDiagnostico,
  EstadoLigacao,
  Janela,
  LinhaUso,
  MotivoRecusaLigacao,
  Membro,
  AssistenteDoComputador,
  ModoAssistente,
  ModoAtualizar,
  NovoAlerta,
  Papel,
  PontoHistorico,
  RegistroAuditoria,
  SessaoAberta,
  SessaoUso,
  EstadoNuvem,
  VezAtualizacao,
  WebhookSaida,
} from "./tipos"

type Linha = Record<string, unknown>

const PAGINA = 1000

/** A configuração que o banco grava na instalação (0001_base.sql): troca automática começa DESLIGADA. */
export const CONFIG_PADRAO: ConfigTroca = {
  auto: false,
  modo: "limiar",
  aviso: 90,
  troca: 95,
  rodizioMinutos: 90,
  rodizioOrdem: "aleatoria",
  intervaloS: 5,
  retomarTerminal: false,
  esperaEntreTrocasS: 90,
  fuso: "America/Sao_Paulo",
  exigirDuasEtapas: false,
  atualizarSozinho: "desligada",
  assistenteAtualizar: "padrao",
  atualizacaoVez: null,
  nuvem: null,
  proximoRodizioEm: null,
}

type CampoGravavel = Exclude<keyof ConfigTroca, "proximoRodizioEm" | "atualizacaoVez" | "nuvem">

/** O jeito de atualizar sozinho a partir do valor do banco: false/true de antes da escolha, ou o nome (0020). */
export function modoAtualizar(valor: unknown): ModoAtualizar {
  if (valor === true || valor === "madrugada") return "madrugada"
  if (valor === "assim_que_sair") return "assim_que_sair"
  return "desligada"
}

/** O que o painel grava: false e true para os jeitos de antes (os agentes anteriores à 0.2.1 entendem), o nome no novo. */
/** A escolha do assistente gravada na nuvem; valor que não se conhece (ou nuvem de antes da 0.8.0) é o padrão. */
export function modoAssistente(valor: unknown): ModoAssistente {
  return valor === "sozinho" || valor === "manual" ? valor : "padrao"
}

export function valorDoModo(modo: ModoAtualizar): boolean | string {
  return modo === "madrugada" ? true : modo === "assim_que_sair" ? "assim_que_sair" : false
}

/** A vez de atualizar sozinho (config `atualizacao_vez`, escrita pelo banco): só o que a tela usa, conferido. */
export function paraVez(v: unknown): VezAtualizacao | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const x = v as Record<string, unknown>
  const semver = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
  if (typeof x.computador !== "string" || typeof x.para !== "string" || !semver.test(x.para)) return null
  if (x.estado !== "em_andamento" && x.estado !== "concluida" && x.estado !== "falhou") return null
  const desde = typeof x.desde === "string" ? Date.parse(x.desde) : NaN
  if (!Number.isFinite(desde)) return null
  return { computadorId: x.computador, para: x.para, estado: x.estado, desde: new Date(desde).toISOString() }
}

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const versaoOuNull = (v: unknown) => (typeof v === "string" && SEMVER.test(v) ? v : null)
const textoOuNull = (v: unknown, max = 300) => (typeof v === "string" && v ? v.slice(0, max) : null)
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * A nuvem e o painel (0021), a partir da configuração: só o que a tela usa, conferido. Nuvem de antes da 0.3.0 (sem
 * nada disso): versão null, e a tela diz o que fazer.
 */
export function paraNuvem(porChave: Map<string, unknown>): EstadoNuvem {
  const at = objeto(porChave.get("nuvem_atualizacao"))
  const pub = objeto(porChave.get("publicado"))
  const vez = objeto(porChave.get("publicacao_vez"))
  const estadoAt = at.estado === "atualizando" || at.estado === "atualizada" || at.estado === "falhou" ? at.estado : null
  const estadoVez = vez.estado === "em_andamento" || vez.estado === "concluida" || vez.estado === "falhou" ? vez.estado : null
  const impressoes: EstadoNuvem["impressoes"] = {}
  for (const [v, x] of Object.entries(objeto(porChave.get("impressoes")))) {
    if (!SEMVER.test(v)) continue
    const o = objeto(x)
    impressoes[v] = { funcoes: textoOuNull(o.funcoes, 80) ?? undefined, painel: textoOuNull(o.painel, 80) ?? undefined }
  }
  return {
    versao: versaoOuNull(porChave.get("nuvem_versao")),
    atualizacao: estadoAt
      ? { estado: estadoAt, de: versaoOuNull(at.de), para: versaoOuNull(at.para), desde: textoOuNull(at.desde, 40), motivo: textoOuNull(at.motivo) }
      : null,
    publicado: { funcoes: versaoOuNull(pub.funcoes), painel: versaoOuNull(pub.painel) },
    impressoes,
    completa: objeto(porChave.get("atualizacao_completa")).ligada === true,
    publicacao:
      estadoVez && versaoOuNull(vez.para)
        ? { computadorId: textoOuNull(vez.computador, 40), para: vez.para as string, estado: estadoVez, desde: textoOuNull(vez.desde, 40), motivo: textoOuNull(vez.motivo) }
        : null,
  }
}

export const CHAVES_CONFIG: Record<CampoGravavel, string> = {
  auto: "auto",
  modo: "modo",
  aviso: "aviso",
  troca: "troca",
  rodizioMinutos: "rodizio_minutos",
  rodizioOrdem: "rodizio_ordem",
  intervaloS: "intervalo_s",
  retomarTerminal: "retomar_terminal",
  esperaEntreTrocasS: "espera_entre_trocas_s",
  fuso: "fuso",
  exigirDuasEtapas: "exigir_duas_etapas",
  atualizarSozinho: "atualizar_sozinho",
  assistenteAtualizar: "assistente_atualizar",
}

const CAMPOS_CONTA: Record<keyof CamposConta, string> = {
  cor: "cor",
  prioridade: "prioridade",
  reserva: "reserva",
  pausada: "pausada",
  agenda: "agenda",
  tetoSemana: "teto_semana",
  modelo: "modelo",
}

// "posse" fica de fora: ela é renovada a cada busca dos computadores e vem junto na releitura.
const TABELAS_AO_VIVO = ["contas", "uso_janelas", "computadores", "atribuicao", "config", "eventos", "comandos"]
// contas_sem_modelo (0028) fica fora do tempo real: a marca nasce junto com a troca (atribuicao), que já recarrega

/** O que o canal do tempo real conta (SUBSCRIBED a cada entrada e reentrada) no estado que o painel mostra. */
export function estadoDoCanal(status: string): EstadoTempoReal | null {
  if (status === "SUBSCRIBED") return "ligado"
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") return "caiu"
  return null
}

/** Mensagens das funções do banco (0001 a 0004) → códigos que a tela traduz. */
const MENSAGENS: [RegExp, string][] = [
  [/dois pedidos de ligação ao mesmo tempo/i, "ligacao_dupla"],
  [/verificação em duas etapas/i, "precisa_aal2"],
  [/só administrador|só membro|permission denied/i, "sem_permissao"],
  [/aviso precisa ser menor/i, "aviso_maior_que_troca"],
  [/limiar entre/i, "limiar_fora"],
  [/rodízio de 15 a 480/i, "rodizio_fora"],
  [/intervalo de 3 a 60|tempo de atualização/i, "intervalo_fora"],
  [/espera de 30 a 3600/i, "espera_fora"],
  [/fuso desconhecido/i, "fuso_invalido"],
  [/^e-mail inválido$/i, "email_invalido"],
  [/último administrador/i, "ultimo_admin"],
  [/revogar a si mesmo/i, "nao_pode_voce"],
  [/escopo só para administrador/i, "escopo_admin"],
  [/em uso em outro computador|conta com outro computador/i, "conta_ocupada"],
  [/outro computador já prefere/i, "preferida_de_outro"],
  [/sem login guardado/i, "conta_precisa_login"],
  [/modelo inválido/i, "modelo_invalido"],
  [/computador novo desconhecido|computador desconhecido/i, "computador_revogado"],
  [/conta desconhecida/i, "nao_encontrado"],
  [/duplicate key|already exists|unique/i, "ja_existe"],
  [/failed to fetch|network/i, "sem_conexao"],
  [
    /chat do Telegram inválido|https e público|destino inválido|canal desconhecido/i,
    "destino_invalido",
  ],
  [/agenda inválida/i, "agenda_invalida"],
  [/ative as suas duas etapas antes/i, "exigir_sem_as_suas"],
  [/convite desconhecido, usado ou vencido/i, "convite_invalido"],
]

export function codigoDoErro(mensagem: string, codigoPg?: string): string {
  for (const [re, codigo] of MENSAGENS) if (re.test(mensagem)) return codigo
  if (codigoPg === "42501") return "sem_permissao"
  return "falha"
}

function erro(e: PostgrestError | Error | null): never {
  const msg = e?.message ?? ""
  throw new ErroPainel(codigoDoErro(msg, (e as PostgrestError | null)?.code), msg)
}

const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))
const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v))

async function tudo(
  consulta: (de: number, ate: number) => PromiseLike<{ data: Linha[] | null; error: PostgrestError | null }>
) {
  const linhas: Linha[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) erro(error)
    linhas.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return linhas
}

/** O corpo JSON da resposta de uma Edge Function que respondeu com erro (o supabase-js guarda em error.context). */
async function lerCorpoDoErro(error: unknown): Promise<Record<string, unknown> | null> {
  const contexto = (error as { context?: unknown } | null)?.context
  if (!(contexto instanceof Response)) return null
  try {
    return (await contexto.clone().json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Chama uma função painel_*. Elas devolvem {ok, erro?}: ok falso vira erro com o código traduzível. */
async function rpc<T extends Linha = Linha>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(nome, args)
  if (error) erro(error)
  const r = (data ?? {}) as T
  if (r && r.ok === false) {
    const msg = String(r.erro ?? "")
    throw new ErroPainel(msg ? codigoDoErro(msg) : "falha", msg)
  }
  return r
}

/**
 * O diagnóstico como o agente manda ({ em: epoch em segundos, conferencias: [{ id, nome, situacao, detalhe }] }) no
 * formato das telas ({ em: ISO, itens: [{ id, ok, detalhe }] }). Aceita também o formato das telas, já pronto.
 */
export function paraDiagnostico(bruto: unknown, versao: string): Computador["diagnostico"] {
  if (!bruto || typeof bruto !== "object") return null
  const d = bruto as Record<string, unknown>
  const emBruto = d.em
  // Quem escreve o diagnóstico é um computador: valor fora do calendário não pode derrubar o painel de ninguém.
  const ms =
    typeof emBruto === "number" && Number.isFinite(emBruto)
      ? emBruto < 1e12
        ? emBruto * 1000
        : emBruto
      : typeof emBruto === "string"
        ? Date.parse(emBruto)
        : NaN
  if (!Number.isFinite(ms) || ms < 0 || ms > 8.64e15) return null
  const em = new Date(ms).toISOString()
  const lista = Array.isArray(d.itens) ? d.itens : Array.isArray(d.conferencias) ? d.conferencias : []
  const objetos = (lista as unknown[]).filter(
    (i): i is Record<string, unknown> => !!i && typeof i === "object" && !Array.isArray(i)
  )
  // texto escrito por um computador: só texto, curto (a tela nunca interpreta nada daqui)
  const curto = (v: unknown, max = 400) => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined)
  const itens = objetos.slice(0, 50).map((i) => {
    const situacao = typeof i.situacao === "string" ? i.situacao : null
    const ok = typeof i.ok === "boolean" ? i.ok : situacao === "ok" ? true : situacao === "falha" ? false : null
    const nome = curto(i.nome, 80)
    const item: ItemDiagnostico = { id: String(i.id ?? nome ?? "?").slice(0, 40), ok, nome, detalhe: curto(i.detalhe) }
    if (ok !== true && (i.conserto === true || (typeof i.conserto === "string" && i.conserto))) item.conserto = true
    const fazer = ok !== true ? curto(i.fazer) : undefined
    if (fazer) item.fazer = fazer
    const c = i.consertado as Record<string, unknown> | null | undefined
    if (c && typeof c === "object" && (c.resultado === "corrigido" || c.resultado === "nao_deu")) {
      item.consertado = { resultado: c.resultado, texto: curto(c.texto) ?? "" }
    }
    return item
  })
  const atraso = typeof d.atrasoBuscaMs === "number" ? d.atrasoBuscaMs : null
  // só X.Y.Z: o painel compara e mostra; nada daqui vai para o pedido de atualização (que leva "mais_nova")
  const semver = (v: unknown) => (typeof v === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? v : null)
  const at = d.atualizacao as Record<string, unknown> | null | undefined
  const atualizacao =
    at && typeof at === "object" && semver(at.para) && typeof at.desde === "string" && Number.isFinite(Date.parse(at.desde))
      ? { para: semver(at.para)!, desde: new Date(Date.parse(at.desde)).toISOString() }
      : null
  const pn = d.precisaNuvem as Record<string, unknown> | null | undefined
  const precisaNuvem = pn && typeof pn === "object" && semver(pn.para) ? { para: semver(pn.para)! } : null
  const as = d.assistente as Record<string, unknown> | null | undefined
  const ul = as && typeof as === "object" ? (as.ultima as Record<string, unknown> | null | undefined) : null
  const assistente: AssistenteDoComputador | null =
    as && typeof as === "object"
      ? {
          versao: semver(as.versao),
          autoDesligado: as.autoDesligado === "reveza" || as.autoDesligado === "pessoa" ? as.autoDesligado : null,
          atualizando: as.atualizando === true,
          ultima:
            ul && typeof ul === "object" && typeof ul.em === "string" && Number.isFinite(Date.parse(ul.em))
              ? {
                  em: new Date(Date.parse(ul.em)).toISOString(),
                  ok: ul.ok === true,
                  de: semver(ul.de),
                  para: semver(ul.para),
                  sozinho: ul.sozinho === true,
                  ...(curto(ul.erro, 200) ? { erro: curto(ul.erro, 200) } : {}),
                }
              : null,
        }
      : null
  return {
    em,
    versao: typeof d.versao === "string" ? d.versao : versao,
    atrasoBuscaMs: atraso,
    itens,
    versaoNova: semver(d.versaoNova),
    atualizacao,
    precisaNuvem,
    assimQueSair: d.assimQueSair === true,
    assistente,
  }
}

function paraConta(l: Linha, janelas: Linha[], posse: Linha | undefined, validade: string | null = null, semModelo: Linha[] = []): Conta {
  const lidoEm =
    janelas
      .map((j) => String(j.lido_em))
      .sort()
      .pop() ?? null
  const fonte = (janelas.find((j) => String(j.lido_em) === lidoEm)?.fonte as Conta["fonte"]) ?? null
  return {
    id: String(l.id),
    email: String(l.email),
    organizacao: texto(l.organizacao),
    plano: texto(l.plano),
    nivel: texto(l.nivel),
    cor: Number(l.cor ?? 0),
    prioridade: Number(l.prioridade ?? 100),
    reserva: Boolean(l.reserva),
    pausada: Boolean(l.pausada),
    agenda: Array.isArray(l.agenda) ? (l.agenda as Conta["agenda"]) : [],
    tetoSemana: numero(l.teto_semana),
    modelo: texto(l.modelo),
    precisaLogin: Boolean(l.precisa_login),
    criadaEm: String(l.criado_em),
    janelas: janelas.map((j): Janela => ({
      tipo: j.tipo as Janela["tipo"],
      pct: numero(j.pct),
      resetEm: texto(j.reset_em),
    })),
    lidoEm,
    fonte,
    // só a data de validade do login (painel_validade_logins); o login continua cifrado no cofre
    loginExpiraEm: validade,
    semModelo: semModelo
      .filter((s) => typeof s.ate === "string" && Date.parse(s.ate) > Date.now())
      .map((s) => ({ computadorId: String(s.computador_id), modelo: String(s.modelo).slice(0, 60), ate: String(s.ate) })),
    posse:
      posse && new Date(String(posse.expira_em)).getTime() > Date.now()
        ? {
            computadorId: String(posse.computador_id),
            motivo: posse.motivo as NonNullable<Conta["posse"]>["motivo"],
            expiraEm: String(posse.expira_em),
          }
        : null,
  }
}

function paraComando(c: Linha): Comando {
  return {
    id: Number(c.id),
    computadorId: String(c.computador_id),
    acao: c.acao as AcaoComando,
    estado: (c.estado as Comando["estado"]) ?? "pendente",
    criadoEm: String(c.criado_em ?? new Date().toISOString()),
    resposta: (c.resposta as Comando["resposta"]) ?? null,
  }
}

/** O andamento da ligação a partir da linha do pedido (0019) e da do computador novo. */
export function faseDaLigacao(p: Linha | null, c: Linha | null, agora: Date): EstadoLigacao {
  const base = { aprovadorId: texto(p?.aprovador), expiraEm: texto(p?.expira_em), motivo: null }
  if (c && c.sistema !== "pendente" && !c.revogado) return { ...base, fase: "ligado" }
  if (p?.recusado) return { ...base, fase: "recusado", motivo: String(p.recusado) as MotivoRecusaLigacao }
  if (p?.lido_em || p?.entregue_em) return { ...base, fase: "entregue" }
  if (!p?.pedido_em) return { ...base, fase: "esperando_pedido" }
  if (p.expira_em && new Date(String(p.expira_em)).getTime() <= agora.getTime()) return { ...base, fase: "vencido" }
  return { ...base, fase: "esperando_codigo" }
}

export class FonteSupabase implements Fonte {
  readonly demo = false
  readonly recursos: Recursos = {
    testarAlerta: true,
    testarWebhook: true,
    cancelarConvite: true,
    listarSessoes: true,
    push: Boolean(import.meta.env.VITE_VAPID_PUBLICA),
  }
  private assinaturas = 0

  private async eu(): Promise<Eu> {
    const sb = supabase()
    const { data: u, error } = await sb.auth.getUser()
    if (error || !u.user) throw new ErroPainel("sem_sessao")
    const { data: m, error: em } = await sb
      .from("membros")
      .select("papel,nome,idioma")
      .eq("user_id", u.user.id)
      .maybeSingle()
    if (em) erro(em)
    if (!m || (m.papel !== "admin" && m.papel !== "leitura")) throw new ErroPainel("nao_membro")
    const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    const { data: fatores } = await sb.auth.mfa.listFactors()
    const totp = fatores?.totp.find((f) => f.status === "verified")
    return {
      userId: u.user.id,
      email: u.user.email ?? "",
      nome: (m.nome as string | null) ?? null,
      papel: m.papel as Papel,
      idioma: m.idioma === "en" ? "en" : "pt-BR",
      aal: nivel?.currentLevel === "aal2" ? "aal2" : "aal1",
      totp: totp ? { fatorId: totp.id, criadoEm: totp.created_at } : null,
    }
  }

  async carregar(): Promise<Instantaneo> {
    const sb = supabase()
    const sel = async (q: PromiseLike<{ data: unknown; error: PostgrestError | null }>) => {
      const { data, error } = await q
      if (error) erro(error)
      return (data ?? []) as Linha[]
    }
    const eu = await this.eu()
    const admin = eu.papel === "admin"
    const nada = Promise.resolve([] as Linha[])
    const [
      contas,
      janelas,
      posses,
      computadores,
      atribs,
      config,
      eventos,
      membros,
      comandos,
      chaves,
      convites,
      alertas,
      webhooks,
    ] = await Promise.all([
      sel(sb.from("contas").select("*").order("prioridade")),
      sel(sb.from("uso_janelas").select("conta_id,tipo,pct,reset_em,lido_em,fonte")),
      sel(sb.from("posse").select("conta_id,computador_id,motivo,expira_em")),
      sel(
        sb
          .from("computadores")
          // "*": a conta_preferida (0024) só existe depois de a nuvem se atualizar; nuvem antiga não derruba a tela
          .select("*")
          .order("criado_em")
      ),
      sel(sb.from("atribuicao").select("computador_id,conta_id,motivo,decidido_em")),
      sel(sb.from("config").select("chave,valor")),
      sel(sb.from("eventos").select("id,em,tipo,texto,dados").order("em", { ascending: false }).limit(100)),
      sel(sb.from("membros").select("user_id,papel,nome,criado_em").in("papel", ["admin", "leitura"])),
      sel(
        sb
          .from("comandos")
          .select("id,computador_id,acao,estado,criado_em,resposta")
          .order("criado_em", { ascending: false })
          .limit(30)
      ),
      sel(
        sb
          .from("chaves_api")
          .select("id,nome,prefixo,escopos,criada_em,usada_em,revogada")
          .order("criada_em", { ascending: false })
      ),
      admin
        ? sel(
            sb
              .from("convites")
              .select("id,email,papel,expira_em,usado_em")
              .is("usado_em", null)
              .gt("expira_em", new Date().toISOString())
          )
        : nada,
      admin ? sel(sb.from("alertas").select("id,canal,destino,eventos,ativo")) : nada,
      admin ? sel(sb.from("webhooks_saida").select("id,url,eventos,ativo")) : nada,
    ])

    // extras que só existem a partir da migração 0008: se o banco ainda não tem, o painel segue sem eles
    const extra = async <T>(nome: string, vale: boolean): Promise<T[]> => {
      if (!vale) return []
      const { data, error } = await sb.rpc(nome)
      return error || !Array.isArray(data) ? [] : (data as T[])
    }
    const [validades, membrosComEmail] = await Promise.all([
      extra<{ conta_id: string; expira_em: string | null }>("painel_validade_logins", true),
      extra<{ user_id: string; email: string }>("painel_membros", admin && eu.aal === "aal2"),
    ])
    const validadeDe = new Map(validades.map((v) => [String(v.conta_id), v.expira_em ? String(v.expira_em) : null]))
    // a conta que não roda o modelo de um computador (0028): nuvem de antes da 0.9.0 não tem a tabela, e segue sem
    const { data: dadosSemModelo, error: erroSemModelo } = await sb
      .from("contas_sem_modelo")
      .select("conta_id,computador_id,modelo,ate")
      .gt("ate", new Date().toISOString())
    const semModelo = erroSemModelo || !Array.isArray(dadosSemModelo) ? [] : (dadosSemModelo as Linha[])
    const emailDe = new Map(membrosComEmail.map((m) => [String(m.user_id), String(m.email)]))

    const cfg: ConfigTroca = { ...CONFIG_PADRAO }
    const porChave = new Map(config.map((c) => [String(c.chave), c.valor]))
    for (const [campo, chave] of Object.entries(CHAVES_CONFIG) as [CampoGravavel, string][]) {
      if (porChave.has(chave)) (cfg as unknown as Record<string, unknown>)[campo] = porChave.get(chave)
    }
    const prox = porChave.get("proximo_rodizio_em")
    cfg.proximoRodizioEm = typeof prox === "string" ? prox : null
    cfg.atualizarSozinho = modoAtualizar(porChave.get("atualizar_sozinho"))
    cfg.assistenteAtualizar = modoAssistente(porChave.get("assistente_atualizar"))
    cfg.atualizacaoVez = paraVez(porChave.get("atualizacao_vez"))
    cfg.nuvem = paraNuvem(porChave)

    return {
      agora: new Date().toISOString(),
      eu,
      contas: contas.map((c) =>
        paraConta(
          c,
          janelas.filter((j) => j.conta_id === c.id),
          posses.find((p) => p.conta_id === c.id),
          validadeDe.get(String(c.id)) ?? null,
          semModelo.filter((s) => s.conta_id === c.id)
        )
      ),
      computadores: computadores.map((c): Computador => {
        const a = atribs.find((x) => x.computador_id === c.id)
        return {
          id: String(c.id),
          nome: String(c.nome),
          sistema: c.sistema as Computador["sistema"],
          versao: String(c.versao),
          vistoEm: texto(c.visto_em),
          revogado: Boolean(c.revogado),
          criadoEm: String(c.criado_em),
          diagnostico: paraDiagnostico(c.diagnostico, String(c.versao)),
          atribuicao: a
            ? { contaId: texto(a.conta_id), motivo: String(a.motivo), decididoEm: String(a.decidido_em) }
            : null,
          contaPreferidaId: texto(c.conta_preferida),
          enxugar: c.enxugar === true,
        }
      }),
      config: cfg,
      eventos: eventos.map((e): Evento => ({
        id: Number(e.id),
        em: String(e.em),
        tipo: e.tipo as Evento["tipo"],
        texto: String(e.texto),
        dados: (e.dados as Evento["dados"]) ?? {},
      })),
      alertas: alertas.map((a): Alerta => {
        const destino = (a.destino as Record<string, unknown> | null) ?? {}
        return {
          id: String(a.id),
          canal: a.canal as Alerta["canal"],
          destino: rotuloDestino(String(a.canal), destino),
          destinoBruto: destino,
          eventos: (a.eventos as EventoAlerta[]) ?? [],
          ativo: Boolean(a.ativo),
        }
      }),
      chaves: chaves.map((c): ChaveApi => ({
        id: String(c.id),
        nome: String(c.nome),
        prefixo: String(c.prefixo),
        escopos: (c.escopos as EscopoChave[]) ?? [],
        criadaEm: String(c.criada_em),
        usadaEm: texto(c.usada_em),
        revogada: Boolean(c.revogada),
      })),
      webhooks: webhooks.map((w): WebhookSaida => ({
        id: String(w.id),
        url: String(w.url),
        eventos: (w.eventos as string[]) ?? [],
        ativo: Boolean(w.ativo),
      })),
      membros: membros.map((m): Membro => ({
        userId: String(m.user_id),
        email: m.user_id === eu.userId ? eu.email : (emailDe.get(String(m.user_id)) ?? null),
        nome: texto(m.nome),
        papel: m.papel as Papel,
        criadoEm: String(m.criado_em),
      })),
      convites: convites.map((c): Convite => ({
        id: String(c.id),
        email: String(c.email),
        papel: c.papel as Papel,
        expiraEm: String(c.expira_em),
        usadoEm: texto(c.usado_em),
      })),
      comandos: comandos.map(paraComando),
    }
  }

  async uso({ de, ate }: Intervalo): Promise<LinhaUso[]> {
    const linhas = await tudo((a, b) =>
      supabase()
        .from("uso_tokens")
        .select("hora,conta_id,computador_id,projeto,modelo,respostas,entrada,saida,cache_escrita,cache_leitura,usd")
        .gte("hora", de.toISOString())
        .lt("hora", ate.toISOString())
        .order("hora")
        .range(a, b)
    )
    return linhas.map((l) => ({
      hora: String(l.hora),
      contaId: texto(l.conta_id),
      computadorId: String(l.computador_id),
      projeto: String(l.projeto ?? ""),
      modelo: String(l.modelo),
      respostas: Number(l.respostas),
      entrada: Number(l.entrada),
      saida: Number(l.saida),
      cacheEscrita: Number(l.cache_escrita),
      cacheLeitura: Number(l.cache_leitura),
      usd: Number(l.usd),
    }))
  }

  async sessoes({ de, ate }: Intervalo): Promise<SessaoUso[]> {
    const linhas = await tudo((a, b) =>
      supabase()
        .from("sessoes")
        .select("*")
        .gte("inicio", de.toISOString())
        .lt("inicio", ate.toISOString())
        .order("inicio", { ascending: false })
        .range(a, b)
    )
    return linhas.map((s) => ({
      id: String(s.id),
      computadorId: String(s.computador_id),
      projeto: String(s.projeto ?? ""),
      inicio: String(s.inicio),
      fim: texto(s.fim),
      respostas: Number(s.respostas),
      tokens: Number(s.tokens),
      usd: Number(s.usd),
      agentes: Number(s.agentes),
      contas: (s.contas as string[]) ?? [],
      modelos: (s.modelos as string[]) ?? [],
      paradaNoLimite: Boolean(s.parada_no_limite),
    }))
  }

  async historico(desde: Date): Promise<PontoHistorico[]> {
    const linhas = await tudo((a, b) =>
      supabase()
        .from("uso_historico")
        .select("conta_id,em,p5,p7")
        .gte("em", desde.toISOString())
        .order("em")
        .range(a, b)
    )
    return linhas.map((p) => ({ contaId: String(p.conta_id), em: String(p.em), p5: numero(p.p5), p7: numero(p.p7) }))
  }

  async auditoria(limite: number): Promise<RegistroAuditoria[]> {
    const sb = supabase()
    const [{ data, error }, { data: membros }, { data: pcs }] = await Promise.all([
      sb.from("auditoria").select("id,em,user_id,acao,alvo").order("em", { ascending: false }).limit(limite),
      sb.from("membros").select("user_id,nome"),
      sb.from("computadores").select("user_id,nome"),
    ])
    if (error) erro(error)
    const nomes = new Map<string, string>()
    for (const p of pcs ?? []) nomes.set(String(p.user_id), String(p.nome))
    for (const m of membros ?? []) if (m.nome) nomes.set(String(m.user_id), String(m.nome))
    return (data ?? []).map((a) => ({
      id: Number(a.id),
      em: String(a.em),
      quem: a.user_id ? (nomes.get(String(a.user_id)) ?? String(a.user_id).slice(0, 8)) : "sistema",
      acao: String(a.acao),
      alvo: texto(a.alvo),
    }))
  }

  async minhasSessoes(): Promise<SessaoAberta[]> {
    const lista = (await rpc("painel_minhas_sessoes")) as unknown as Linha[]
    return (Array.isArray(lista) ? lista : []).map((s) => ({
      id: String(s.id),
      criadaEm: String(s.criada_em),
      ultimaVez: String(s.ultima_vez),
      aparelho: String(s.aparelho ?? ""),
      atual: Boolean(s.atual),
    }))
  }

  assinar(aoMudar: () => void, aoEstado?: (estado: EstadoTempoReal) => void): () => void {
    const sb = supabase()
    // Um tópico novo a cada assinatura: o cliente devolve o canal que já existe com o mesmo nome, e o de uma aba que
    // voltou de congelada pode estar morto. Cada assinatura cancela só o canal dela.
    let canal: RealtimeChannel = sb.channel(`painel-${++this.assinaturas}`)
    for (const tabela of TABELAS_AO_VIVO)
      canal = canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, () => aoMudar())
    let viva = true
    aoEstado?.("conectando")
    canal.subscribe((status) => {
      const estado = estadoDoCanal(status)
      if (viva && estado) aoEstado?.(estado)
    })
    return () => {
      viva = false
      void sb.removeChannel(canal)
    }
  }

  async salvarConfig(campos: Partial<ConfigTroca>) {
    const lista = (Object.entries(campos) as [CampoGravavel, unknown][]).filter(([k]) => k in CHAVES_CONFIG)
    // Aviso e troca juntos: o banco confere "aviso menor que troca" a cada gravação. Se a troca sobe, grava a troca
    // primeiro; se desce, grava o aviso primeiro. Assim nenhum passo do meio é recusado.
    if (campos.aviso !== undefined && campos.troca !== undefined) {
      const { data } = await supabase().from("config").select("valor").eq("chave", "troca").maybeSingle()
      const trocaAtual = Number(data?.valor ?? CONFIG_PADRAO.troca)
      const trocaPrimeiro = campos.troca > trocaAtual
      lista.sort(([a], [b]) => {
        const peso = (k: string) =>
          k === "troca" ? (trocaPrimeiro ? 0 : 1) : k === "aviso" ? (trocaPrimeiro ? 1 : 0) : 2
        return peso(a) - peso(b)
      })
    }
    for (const [campo, valor] of lista) {
      const gravar = campo === "atualizarSozinho" ? valorDoModo(valor as ModoAtualizar) : valor
      await rpc("painel_config", { p_chave: CHAVES_CONFIG[campo], p_valor: gravar })
    }
  }

  async salvarConta(id: string, campos: CamposConta) {
    const p_campos: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(campos)) p_campos[CAMPOS_CONTA[k as keyof CamposConta]] = v
    await rpc("painel_conta", { p_conta: id, p_campos })
  }

  async ordenarContas(ids: string[]) {
    for (const [i, id] of ids.entries())
      await rpc("painel_conta", { p_conta: id, p_campos: { prioridade: (i + 1) * 10 } })
  }

  async trocarAgora(computadorId: string, contaId: string) {
    await rpc("painel_trocar_agora", { p_computador: computadorId, p_conta: contaId })
  }

  async preferirConta(computadorId: string, contaId: string | null) {
    await rpc("painel_computador_preferida", { p_computador: computadorId, p_conta: contaId })
  }

  async enxugarComputador(computadorId: string, ligado: boolean) {
    await rpc("painel_computador_enxugar", { p_computador: computadorId, p_ligado: ligado })
  }

  async comando(computadorId: string, acao: AcaoComando, corpo: Record<string, unknown> = {}): Promise<Comando> {
    const r = await rpc("painel_comando", { p_computador: computadorId, p_acao: acao, p_corpo: corpo })
    return {
      id: Number(r.id),
      computadorId,
      acao,
      estado: "pendente",
      criadoEm: new Date().toISOString(),
      resposta: null,
    }
  }

  async lerComando(id: number): Promise<Comando | null> {
    const { data, error } = await supabase()
      .from("comandos")
      .select("id,computador_id,acao,estado,criado_em,resposta")
      .eq("id", id)
      .maybeSingle()
    if (error) erro(error)
    return data ? paraComando(data) : null
  }

  async atualizarNuvem(): Promise<ResultadoNuvem> {
    // a função confere o administrador (com a regra das duas etapas) e só aceita a versão oficial mais nova
    const { data, error } = await supabase().functions.invoke<ResultadoNuvem & { erro?: string }>("atualizar-nuvem", {
      body: { acao: "atualizar" },
    })
    if (error || !data || typeof data.estado !== "string") {
      // a função responde 401/403 com o motivo no corpo ("confirme a verificação em duas etapas", "só administrador")
      const corpo = error ? await lerCorpoDoErro(error) : null
      const msg = String(data?.erro ?? corpo?.erro ?? error?.message ?? "")
      throw new ErroPainel(/duas etapas/.test(msg) ? "precisa_aal2" : codigoDoErro(msg), msg)
    }
    return { ok: data.ok === true, estado: data.estado, para: data.para ?? null, motivo: data.motivo ?? null }
  }

  async desligarAtualizacaoCompleta() {
    await rpc("painel_credenciais_apagar", {})
  }

  async criarAcessoComputador(): Promise<{ codigo: string; computadorId: string | null }> {
    const { data, error } = await supabase().functions.invoke<{
      ok?: boolean
      email?: string
      senha?: string
      computador_id?: string | null
      erro?: string
    }>("computador-novo", { body: {} })
    if (error || !data?.ok || !data.email || !data.senha) {
      const msg = String(data?.erro ?? error?.message ?? "")
      throw new ErroPainel(/duas etapas/.test(msg) ? "precisa_aal2" : codigoDoErro(msg), msg)
    }
    return {
      codigo: codigoDeAcesso({
        u: import.meta.env.VITE_SUPABASE_URL ?? "",
        k: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        e: data.email,
        s: data.senha,
      }),
      computadorId: data.computador_id ?? null,
    }
  }

  async escolherAprovador(computadorNovoId: string, aprovadorId: string) {
    // a janela abre na língua deste painel (o texto dela é fixo no agente)
    const idioma = document.documentElement.lang === "en" ? "en" : "pt-BR"
    await rpc("painel_ligacao_aprovador", { p_computador: computadorNovoId, p_aprovador: aprovadorId, p_idioma: idioma })
  }

  async estadoLigacao(computadorNovoId: string): Promise<EstadoLigacao> {
    // o painel lê o andamento, sem a chave pública e sem o envelope (a nuvem nem deixa ler essas colunas)
    const sb = supabase()
    const [p, c] = await Promise.all([
      sb
        .from("ligacao_pedidos")
        .select("aprovador,pedido_em,expira_em,entregue_em,lido_em,recusado")
        .eq("computador_id", computadorNovoId)
        .maybeSingle(),
      sb.from("computadores").select("sistema,revogado").eq("id", computadorNovoId).maybeSingle(),
    ])
    if (p.error) erro(p.error)
    if (c.error) erro(c.error)
    return faseDaLigacao(p.data as Linha | null, c.data as Linha | null, new Date())
  }

  async revogarComputador(id: string) {
    await rpc("painel_revogar_computador", { p_computador: id })
  }

  async criarAlerta(a: NovoAlerta) {
    const r = await rpc("painel_alerta", {
      p_canal: a.canal,
      p_destino: a.destino,
      p_eventos: a.eventos,
      p_ativo: true,
      p_id: null,
    })
    // O segredo do canal vai só para o Vault (a tabela guarda o id dele, nunca o valor).
    if (a.segredo) await rpc("painel_alerta_segredo", { p_id: r.id, p_segredo: a.segredo })
  }

  async mudarAlerta(a: Alerta, campos: { ativo?: boolean; eventos?: EventoAlerta[] }) {
    // Só o destino sem segredo; o banco mantém o segredo do canal (no Vault) quando o canal não muda.
    const destino = Object.fromEntries(Object.entries(a.destinoBruto).filter(([k]) => k !== "vault_id"))
    await rpc("painel_alerta", {
      p_canal: a.canal,
      p_destino: destino,
      p_eventos: campos.eventos ?? a.eventos,
      p_ativo: campos.ativo ?? a.ativo,
      p_id: a.id,
    })
  }

  async removerAlerta(id: string) {
    await rpc("painel_alerta_apagar", { p_id: id })
  }

  async testarAlerta(id: string) {
    // A Edge Function "alertas" manda a mensagem de teste (confere admin e duas etapas pelo token de quem chama).
    const { data, error } = await supabase().functions.invoke<{ ok?: boolean; erro?: string }>("alertas", {
      body: { acao: "testar", alerta_id: id },
    })
    if (error || !data?.ok) {
      // a função responde 502 com o motivo no corpo; o supabase-js põe a resposta em error.context
      const corpo = await lerCorpoDoErro(error)
      const msg = String(data?.erro ?? corpo?.erro ?? error?.message ?? "")
      const codigo = /duas etapas/.test(msg) ? "precisa_aal2" : /nenhum aparelho/.test(msg) ? "push_sem_aparelho" : "teste_falhou"
      throw new ErroPainel(codigo, msg)
    }
  }

  async criarChave(nome: string, escopos: EscopoChave[]) {
    const r = await rpc("painel_chave_api_criar", { p_nome: nome.trim(), p_escopos: escopos })
    return { chave: String(r.chave) }
  }

  async revogarChave(id: string) {
    await rpc("painel_chave_api_revogar", { p_id: id })
  }

  async criarWebhook(url: string, eventos: string[]) {
    const r = await rpc("painel_webhook", { p_url: url.trim(), p_eventos: eventos, p_ativo: true, p_id: null })
    // A assinatura (HMAC no cabeçalho X-Reveza-Assinatura) nasce no Vault e aparece aqui uma vez só.
    const s = await rpc("painel_webhook_segredo", { p_id: r.id })
    return { segredo: typeof s.segredo === "string" ? s.segredo : null }
  }

  async mudarWebhook(w: WebhookSaida, campos: { ativo?: boolean; eventos?: string[] }) {
    await rpc("painel_webhook", {
      p_url: w.url,
      p_eventos: campos.eventos ?? w.eventos,
      p_ativo: campos.ativo ?? w.ativo,
      p_id: w.id,
    })
  }

  async testarWebhook(id: string): Promise<void> {
    // A Edge Function "alertas" assina e manda um evento de teste (confere admin e duas etapas pelo token de quem chama).
    const { data, error } = await supabase().functions.invoke<{ ok?: boolean; erro?: string; status?: number }>(
      "alertas",
      {
        body: { acao: "testar_webhook", webhook_id: id },
      }
    )
    if (error || !data?.ok) {
      const msg = String(data?.erro ?? error?.message ?? (data?.status ? `o endereço respondeu ${data.status}` : ""))
      throw new ErroPainel(/duas etapas/.test(msg) ? "precisa_aal2" : "teste_falhou", msg)
    }
  }

  async convidar(email: string, papel: Papel) {
    // A Edge Function "convite" gera o token, grava o resumo (painel_convidar) e manda o e-mail pelo Auth; o link
    // volta para /aceitar?convite=<token>.
    const { data, error } = await supabase().functions.invoke<{ ok?: boolean; link?: string | null; erro?: string }>(
      "convite",
      { body: { acao: "enviar", email: email.trim().toLowerCase(), papel } }
    )
    if (error) throw new ErroPainel(codigoDoErro(error.message), error.message)
    if (data && data.ok === false) throw new ErroPainel(codigoDoErro(String(data.erro ?? "")), String(data.erro ?? ""))
    return { link: data?.link ?? null }
  }

  async cancelarConvite(id: string) {
    await rpc("painel_convite_cancelar", { p_id: id })
  }

  async mudarPapel(userId: string, papel: Papel) {
    await rpc("painel_mudar_papel", { p_user: userId, p_papel: papel })
  }

  async revogarMembro(userId: string) {
    await rpc("painel_revogar_membro", { p_user: userId })
  }

  async meuIdioma(idioma: Idioma) {
    await rpc("painel_meu_idioma", { p_idioma: idioma })
  }

  async chavePushPublica() {
    return import.meta.env.VITE_VAPID_PUBLICA ?? null
  }

  async pushRegistrado(endpoint: string) {
    // a segurança de linha só deixa cada um ler as próprias inscrições
    const { data, error } = await supabase().from("push_inscricoes").select("id").eq("endpoint", endpoint).limit(1)
    if (error) erro(error)
    return Boolean(data?.length)
  }

  async inscreverPush(inscricao: PushSubscriptionJSON) {
    await rpc("painel_push_inscrever", {
      p_endpoint: inscricao.endpoint,
      p_p256dh: inscricao.keys?.p256dh,
      p_auth: inscricao.keys?.auth,
    })
  }
}
