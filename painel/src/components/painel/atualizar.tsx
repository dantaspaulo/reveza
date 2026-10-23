// Atualizações pelo painel: a linha "Nuvem e painel" (a versão de cada um, o Atualizar a nuvem e o andamento: a nuvem
// aplica as próprias migrações sem token; funções e painel vão pelo instalador ou, com a atualização completa ligada,
// por um computador), o botão por computador ("Versão X disponível · Atualizar"), o "Verificar atualização" (cada
// computador ligado confere agora), o "Atualizar todos", a escolha de como tudo se atualiza sozinho (desligada, de
// madrugada, assim que sair; na ordem nuvem, funções e painel, computadores) e o andamento. Só administrador pede.

import * as React from "react"
import {
  CircleCheckIcon,
  CirclePauseIcon,
  CircleXIcon,
  ClockIcon,
  CloudAlertIcon,
  CloudIcon,
  CloudUploadIcon,
  DownloadIcon,
  MoonIcon,
  PowerOffIcon,
  RefreshCwIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Codigo } from "@/components/painel/copiar"
import { useComando } from "@/components/painel/dialogo-login"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { estadoComputador, versaoMaisNova } from "@/dados/derivados"
import { ErroPainel } from "@/dados/fonte"
import type { Computador, ModoAtualizar } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  andamentoDaAtualizacao,
  andamentoDeTodos,
  faseDaNuvem,
  assinarConferencia,
  assinarPedidos,
  comecarConferencia,
  conferenciaAtual,
  entendeAssimQueSair,
  guardarLeitura,
  guardarPedido,
  mudancasDosPedidos,
  pedidoDe,
  pedidoRecente,
  pedidosEmAberto,
  PEDIDO_ATUALIZAR,
  PEDIDO_CONFERIR,
  resultadoDaConferencia,
  versaoDisponivel,
  type AndamentoAtualizacao,
  type Conferencia,
  type EstadoNaAtualizacao,
} from "@/lib/atualizar"
import { cn } from "@/lib/utils"

/** O comando que publica as funções e o painel (no computador que criou a instalação, com os tokens). */
export const COMANDO_ATUALIZAR_PAINEL = "npx github:dantaspaulo/reveza --atualizar"
/** O comando que liga a atualização completa (num computador da instalação: só ele tem a chave do cofre). */
export const COMANDO_COMPLETA = "reveza atualizacao-completa ligar"

/**
 * Como levar funções e painel novos sem a atualização completa: ligá-la (uma vez, em qualquer computador, e as próximas
 * vão sozinhas) ou, só desta vez, o instalador no computador que criou a instalação. A ligada vem primeiro: um usuário
 * (22/10/2026) atualizou a nuvem pelo painel e procurou o botão que levasse o painel junto.
 */
export function PassosDoPainel({ className }: { className?: string }) {
  const { t } = useT()
  const k = "computadores.atualizacao.nuvem.passo"
  return (
    <div className={cn("flex flex-col gap-1.5 text-xs text-muted-foreground", className)}>
      <span>{t(`${k}.completa`)}</span>
      <Codigo texto={COMANDO_COMPLETA} />
      <span className="mt-1">{t(`${k}.umaVez`)}</span>
      <Codigo texto={COMANDO_ATUALIZAR_PAINEL} />
    </div>
  )
}

export function useAtualizar(pc: Computador) {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const cmdId = React.useSyncExternalStore(assinarPedidos, () => pedidoDe(pc.id), () => pedidoDe(pc.id))
  const cmd = useComando(cmdId)
  const outros = versaoMaisNova(estado.computadores.filter((c) => !c.revogado).map((c) => c.versao))
  const andamento = andamentoDaAtualizacao(pc, cmd, estado.eventos, agora)
  const ocupado = andamento?.fase === "pedido" || andamento?.fase === "atualizando"
  const pedir = async () => {
    const [ok, c] = await acao(
      () => fonte.comando(pc.id, "atualizar", { ...PEDIDO_ATUALIZAR }),
      t("computadores.atualizacao.pedido", { computador: pc.nome })
    )
    if (ok) guardarPedido(pc.id, c.id)
    return ok
  }
  return { pode, pedir, andamento, ocupado, disponivel: versaoDisponivel(pc, outros) }
}

export function BotaoAtualizar({ atualizar, className }: { atualizar: ReturnType<typeof useAtualizar>; className?: string }) {
  const { t } = useT()
  if (!atualizar.disponivel && !atualizar.ocupado) return null
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={!atualizar.pode || atualizar.ocupado}
      title={atualizar.pode ? t("computadores.atualizacao.dica") : t("computadores.atualizacao.soAdmin")}
      onClick={() => void atualizar.pedir()}
    >
      {atualizar.ocupado ? <Spinner /> : <DownloadIcon />}
      {atualizar.ocupado
        ? t("computadores.atualizacao.atualizando")
        : t("computadores.atualizacao.botao", { versao: atualizar.disponivel ?? "" })}
    </Button>
  )
}

/** O andamento numa linha: pedido, atualizando, voltou na versão nova, ou falhou com o motivo. */
export function LinhaAtualizacao({ andamento, className }: { andamento: AndamentoAtualizacao | null; className?: string }) {
  const { t } = useT()
  if (!andamento) return null
  const texto =
    andamento.fase === "pedido"
      ? t("computadores.atualizacao.fase.pedido")
      : andamento.fase === "atualizando"
        ? andamento.para
          ? t("computadores.atualizacao.fase.atualizandoPara", { versao: andamento.para })
          : t("computadores.atualizacao.fase.atualizando")
        : andamento.fase === "concluida"
          ? t("computadores.atualizacao.fase.concluida", { versao: andamento.para })
          : andamento.fase === "sem_suporte"
            ? t("computadores.atualizacao.fase.semSuporte", { comando: COMANDO_ATUALIZAR_PAINEL })
            : andamento.fase === "precisa_nuvem"
              ? t("computadores.atualizacao.fase.precisaNuvem", { versao: andamento.para })
              : t("computadores.atualizacao.fase.falhou", { motivo: andamento.motivo || "?" })
  const cor =
    andamento.fase === "concluida"
      ? "text-ok"
      : andamento.fase === "falhou" || andamento.fase === "sem_suporte" || andamento.fase === "precisa_nuvem"
        ? "text-atencao"
        : "text-muted-foreground"
  return (
    <p className={cn("flex items-start gap-1.5 text-xs break-words", cor, className)} role="status">
      {andamento.fase === "pedido" || andamento.fase === "atualizando" ? <Spinner className="mt-px size-3" /> : null}
      <span>{texto}</span>
    </p>
  )
}

/** Os três jeitos de atualizar sozinho, na ordem da tela. */
export const MODOS_ATUALIZAR: ModoAtualizar[] = ["desligada", "madrugada", "assim_que_sair"]
const ICONE_DO_MODO: Record<ModoAtualizar, typeof MoonIcon> = { desligada: PowerOffIcon, madrugada: MoonIcon, assim_que_sair: ZapIcon }

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

/** Lê de 1,5 em 1,5 s os pedidos da rodada que ainda podem responder (até o prazo da nuvem). */
function useAcompanharConferencia(c: Conferencia | null) {
  const { fonte } = useDados()
  const id = c?.id ?? null
  React.useEffect(() => {
    if (id === null) return
    let vivo = true
    const ler = async () => {
      const atual = conferenciaAtual()
      if (!vivo || !atual || atual.id !== id) return
      const abertos = pedidosEmAberto(atual)
      if (!abertos.length) return
      const lidos = await Promise.all(abertos.map((x) => fonte.lerComando(x).catch(() => null)))
      if (!vivo) return
      for (const l of lidos) if (l) guardarLeitura(l)
      setTimeout(() => void ler(), 1500)
    }
    void ler()
    return () => {
      vivo = false
    }
  }, [fonte, id])
}

const ICONE_DO_ESTADO: Record<EstadoNaAtualizacao, typeof MoonIcon | null> = {
  em_dia: CircleCheckIcon,
  atualizando: null,
  na_fila: ClockIcon,
  parada: CirclePauseIcon,
  falhou: CircleXIcon,
  precisa_nuvem: CloudAlertIcon,
  disponivel: DownloadIcon,
}

const codigo = "w-fit max-w-full rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-words"

/** A linha "Nuvem e painel": a versão de cada um, o Atualizar a nuvem (administrador) e em que pé está. */
export function LinhaNuvem() {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const [pedindo, setPedindo] = React.useState(false)
  const n = estado.config.nuvem ?? null
  const f = faseDaNuvem(n, agora)
  const nomeDe = (id: string | null) =>
    estado.computadores.find((c) => c.id === id)?.nome ?? t("computadores.atualizacao.nuvem.computadorDesconhecido")
  const ocupado = pedindo || f.fase === "atualizando" || f.fase === "publicando"
  const k = "computadores.atualizacao.nuvem"

  const atualizar = async () => {
    setPedindo(true)
    const [ok, r] = await acao(() => fonte.atualizarNuvem())
    setPedindo(false)
    if (!ok || !r) return
    if (r.estado === "em_dia") toast.success(t(`${k}.resultado.emDia`, { versao: r.para ?? "?" }))
    else if (r.estado === "atualizada") toast.success(t(`${k}.resultado.atualizada`, { versao: r.para ?? "?" }))
    else if (r.estado === "atualizando") toast.info(t(`${k}.resultado.atualizando`))
    else toast.error(t(`${k}.resultado.falhou`, { motivo: r.motivo || r.estado }))
  }
  const desligar = () => void acao(() => fonte.desligarAtualizacaoCompleta(), t(`${k}.completa.desligou`))

  const partes =
    f.fase === "passo_manual"
      ? t(`${k}.partes.${f.funcoes && f.painel ? "ambas" : f.funcoes ? "funcoes" : "painel"}`)
      : ""
  const texto =
    f.fase === "desconhecida"
      ? t(`${k}.fase.desconhecida`)
      : f.fase === "atualizando"
        ? t(`${k}.fase.atualizando`, { versao: f.versao ?? "?" })
        : f.fase === "interrompida"
        ? t(`${k}.fase.interrompida`, { versao: f.versao ?? "?" })
        : f.fase === "falhou"
          ? t(`${k}.fase.falhou`, { versao: f.versao ?? "?", motivo: f.motivo || "?" })
          : f.fase === "publicando"
            ? t(`${k}.fase.publicando`, { versao: f.versao, computador: nomeDe(f.computadorId) })
            : f.fase === "publicacao_falhou"
              ? t(`${k}.fase.publicacaoFalhou`, { versao: f.versao, motivo: f.motivo || "?" })
              : f.fase === "passo_manual"
                ? t(`${k}.fase.passoManual`, { versao: f.versao, partes })
                : f.fase === "esperando_publicacao"
                  ? t(`${k}.fase.esperandoPublicacao`, { versao: f.versao })
                  : t(`${k}.fase.atualizada`, { versao: f.versao })
  const atencao =
    f.fase === "falhou" || f.fase === "interrompida" || f.fase === "publicacao_falhou" || f.fase === "passo_manual" || f.fase === "desconhecida"
  const Icone = atencao ? CloudAlertIcon : f.fase === "atualizada" ? CircleCheckIcon : null
  const cor = atencao ? "text-atencao" : f.fase === "atualizada" ? "text-ok" : "text-muted-foreground"

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            <CloudIcon className="size-4 text-muted-foreground" aria-hidden />
            {t(`${k}.titulo`)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t(`${k}.versoes`, {
              nuvem: n?.versao ?? "?",
              funcoes: n?.publicado.funcoes ?? "?",
              painel: n?.publicado.painel ?? __VERSAO_PAINEL__,
            })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!pode || ocupado}
          title={pode ? t(`${k}.dica`) : t("computadores.atualizacao.soAdmin")}
          onClick={() => void atualizar()}
        >
          {ocupado ? <Spinner /> : <CloudUploadIcon />}
          {t(`${k}.botao`)}
        </Button>
      </div>
      <p className={cn("flex items-start gap-1.5 text-xs break-words", cor)} role="status" aria-live="polite">
        {Icone ? <Icone className="mt-px size-3.5 shrink-0" aria-hidden /> : ocupado ? <Spinner className="mt-px size-3 shrink-0" /> : null}
        <span>{texto}</span>
      </p>
      {f.fase === "desconhecida" ? <code className={codigo}>{COMANDO_ATUALIZAR_PAINEL}</code> : null}
      {f.fase === "passo_manual" ? <PassosDoPainel /> : null}
      {n?.versao && (n.completa || f.fase !== "passo_manual") ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {n.completa ? (
            <span>
              {t(`${k}.completa.ligada`)}{" "}
              {pode ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={desligar}>
                  {t(`${k}.completa.desligar`)}
                </Button>
              ) : null}
            </span>
          ) : (
            <>
              <span>{t(`${k}.completa.desligada`)}</span>
              <code className={codigo}>{COMANDO_COMPLETA}</code>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** O cartão de cima da tela Computadores: verificar, atualizar todos, como atualizar sozinho e o andamento. */
export function CartaoAtualizacoes() {
  const { t } = useT()
  const { fonte, atualizadoEm } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const [enviando, setEnviando] = React.useState(false)
  const [pedindoConferencia, setPedindoConferencia] = React.useState(false)
  React.useSyncExternalStore(assinarPedidos, mudancasDosPedidos, mudancasDosPedidos)
  const conferencia = React.useSyncExternalStore(assinarConferencia, conferenciaAtual, conferenciaAtual)
  useAcompanharConferencia(conferencia)
  // a identidade pendente (código de acesso ainda sem uso) não tem programa para atualizar
  const ativos = estado.computadores.filter((c) => !c.revogado && c.sistema !== "pendente")
  const modo = estado.config.atualizarSozinho
  const resultado = conferencia ? resultadoDaConferencia(conferencia, ativos, agora.getTime()) : null
  const achada = resultado?.fase === "disponivel" || resultado?.fase === "em_dia" ? resultado.versao : null
  const outros = versaoMaisNova([...ativos.map((c) => c.versao), ...(achada ? [achada] : [])])
  // quem já está atualizando (pedido desta aba, ou o computador contou que está) não entra de novo
  const comAtualizacao = ativos.filter((pc) => versaoDisponivel(pc, outros) && !pedidoRecente(pc.id) && !pc.diagnostico?.atualizacao)
  // a versão para onde todos vão: a mais nova que alguém conhece (a achada agora, a lida antes, a de outro na frente)
  const alvo = versaoMaisNova(
    [achada, outros, estado.config.atualizacaoVez?.para, ...ativos.map((c) => c.diagnostico?.versaoNova)].filter(
      (v): v is string => typeof v === "string" && SEMVER.test(v)
    )
  )
  const linhas = alvo ? andamentoDeTodos(ativos, alvo, estado.eventos, estado.config.atualizacaoVez, modo, agora) : []
  const feitos = linhas.filter((l) => l.estado === "em_dia").length
  const algumAtras = linhas.some((l) => l.estado !== "em_dia")
  const mostrarAndamento =
    algumAtras && (modo !== "desligada" || linhas.some((l) => l.estado === "atualizando" || l.estado === "falhou"))
  const precisaNuvem = !!alvo && (linhas.some((l) => l.estado === "precisa_nuvem") || (resultado?.fase === "disponivel" && resultado.precisaNuvem))
  const ligados = ativos.filter((pc) => estadoComputador(pc, agora, atualizadoEm) !== "parado")
  const conferindo = pedindoConferencia || resultado?.fase === "conferindo"

  const verificar = async () => {
    if (!ligados.length) {
      toast.info(t("computadores.atualizacao.verificarSemLigado"))
      return
    }
    setPedindoConferencia(true)
    const [ok, pedidos] = await acao(async () => {
      const feitosAgora: Record<string, number> = {}
      let primeiro: unknown = null
      for (const pc of ligados) {
        try {
          feitosAgora[pc.id] = (await fonte.comando(pc.id, "atualizar", { ...PEDIDO_CONFERIR })).id
        } catch (e) {
          primeiro ??= e
        }
      }
      if (!Object.keys(feitosAgora).length) throw primeiro ?? new ErroPainel("falha")
      return feitosAgora
    })
    setPedindoConferencia(false)
    if (ok) comecarConferencia(pedidos)
  }

  // com "assim que sair", quem entende vai sozinho, um por vez: o Atualizar todos fica só para os de versão anterior
  const manuais = comAtualizacao.filter((pc) => modo !== "assim_que_sair" || !entendeAssimQueSair(pc))
  const atualizarTodos = async () => {
    setEnviando(true)
    let pedidos = 0
    for (const pc of manuais) {
      try {
        const c = await fonte.comando(pc.id, "atualizar", { ...PEDIDO_ATUALIZAR })
        guardarPedido(pc.id, c.id)
        pedidos++
      } catch {
        // segue para os outros; o aviso diz quantos foram
      }
    }
    setEnviando(false)
    if (pedidos) toast.success(t("computadores.atualizacao.todosPedido", { n: pedidos }))
    else toast.error(t("computadores.atualizacao.todosFalhou"))
  }

  // um voltou para a anterior: a vez parou para todos; retomar grava o mesmo jeito (o banco solta a vez parada)
  const parada = estado.config.atualizacaoVez?.estado === "falhou" && modo !== "desligada"
  const retomar = () =>
    void acao(() => fonte.salvarConfig({ atualizarSozinho: modo }), t("computadores.atualizacao.parada.retomada"))

  const escolher = (v: string) => {
    const novo = v as ModoAtualizar
    if (!MODOS_ATUALIZAR.includes(novo) || novo === modo) return
    void acao(
      () => fonte.salvarConfig({ atualizarSozinho: novo }),
      t("computadores.atualizacao.modo.salvo", { modo: t(`computadores.atualizacao.modo.${novo}.titulo`) })
    )
  }

  // o que dizer na linha de cima: o resultado do Verificar (se houver), senão o que já se sabe
  const textoDoEstado =
    resultado?.fase === "conferindo"
      ? t("computadores.atualizacao.conferencia.conferindo", { n: resultado.responderam, total: resultado.total })
      : resultado?.fase === "sem_resposta"
        ? t("computadores.atualizacao.conferencia.semResposta")
        : resultado?.fase === "nao_conferiu"
        ? t("computadores.atualizacao.conferencia.naoConferiu", { erro: resultado.erro })
        : resultado?.fase === "em_dia" && !comAtualizacao.length
          ? t("computadores.atualizacao.conferencia.emDia", { versao: resultado.versao })
          : resultado?.fase === "disponivel" || (resultado && comAtualizacao.length)
            ? t("computadores.atualizacao.conferencia.disponivel", { versao: alvo ?? "?", n: Math.max(comAtualizacao.length, resultado?.fase === "disponivel" ? resultado.atras : 0) })
            : comAtualizacao.length
              ? t("computadores.atualizacao.disponiveis", { n: comAtualizacao.length })
              : t("computadores.atualizacao.emDia")
  const comoSegue =
    resultado?.fase === "disponivel" && !precisaNuvem
      ? modo === "assim_que_sair"
        ? manuais.length
          ? t("computadores.atualizacao.conferencia.antigosPeloBotao")
          : t("computadores.atualizacao.conferencia.comecaSozinho")
        : modo === "madrugada"
          ? t("computadores.atualizacao.conferencia.esperaMadrugada")
          : null
      : null
  const mostrarTodos = manuais.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <DownloadIcon className="size-4" aria-hidden />
          </span>
          {t("computadores.atualizacao.titulo")}
        </CardTitle>
        <CardDescription>{t("computadores.atualizacao.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <LinhaNuvem />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5" role="status" aria-live="polite">
            <span className={cn("flex items-center gap-1.5", resultado?.fase === "em_dia" ? "text-ok" : "text-muted-foreground")}>
              {conferindo ? <Spinner className="size-3.5" /> : resultado?.fase === "em_dia" ? <CircleCheckIcon className="size-4" aria-hidden /> : null}
              {textoDoEstado}
            </span>
            {comoSegue ? <span className="text-xs text-muted-foreground">{comoSegue}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!pode || conferindo}
              title={pode ? t("computadores.atualizacao.verificarDica") : t("computadores.atualizacao.soAdmin")}
              onClick={() => void verificar()}
            >
              {conferindo ? <Spinner /> : <RefreshCwIcon />}
              {t("computadores.atualizacao.verificar")}
            </Button>
            {mostrarTodos ? (
              <Button size="sm" disabled={!pode || enviando} onClick={() => void atualizarTodos()}>
                {enviando ? <Spinner /> : <DownloadIcon />}
                {t("computadores.atualizacao.todos", { n: manuais.length })}
              </Button>
            ) : null}
          </div>
        </div>

        {precisaNuvem && alvo ? (
          <Alert className="border-atencao-borda bg-atencao-fundo">
            <CloudAlertIcon className="text-atencao" />
            <AlertDescription className="flex flex-col gap-1">
              <span className="text-atencao">{t("computadores.atualizacao.precisaNuvem", { versao: alvo })}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        {parada ? (
          <Alert className="border-atencao-borda bg-atencao-fundo">
            <CirclePauseIcon className="text-atencao" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-atencao">{t("computadores.atualizacao.parada.texto")}</span>
              <Button size="sm" variant="outline" disabled={!pode} onClick={retomar}>
                {t("computadores.atualizacao.parada.retomar")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {mostrarAndamento && alvo ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{t("computadores.atualizacao.andamento.titulo")}</span>
              <span className="text-muted-foreground tabular-nums">
                {t("computadores.atualizacao.andamento.resumo", { feitos, total: linhas.length, versao: alvo })}
              </span>
            </div>
            <Progress value={linhas.length ? (feitos / linhas.length) * 100 : 0} className="h-1.5" aria-hidden />
            <ul className="flex flex-col gap-1">
              {linhas.map(({ pc, estado: e }) => {
                const Icone = ICONE_DO_ESTADO[e]
                const texto =
                  e === "em_dia"
                    ? t("computadores.atualizacao.andamento.em_dia", { versao: alvo })
                    : e === "na_fila" && modo === "madrugada"
                      ? t("computadores.atualizacao.andamento.na_filaMadrugada")
                      : t(`computadores.atualizacao.andamento.${e}`)
                const cor = e === "em_dia" ? "text-ok" : e === "falhou" || e === "parada" || e === "precisa_nuvem" ? "text-atencao" : "text-muted-foreground"
                return (
                  <li key={pc.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{pc.nome}</span>
                    <span className={cn("flex shrink-0 items-center gap-1", cor)}>
                      {Icone ? <Icone className="size-3.5" aria-hidden /> : <Spinner className="size-3" />}
                      {texto}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{t("computadores.atualizacao.modo.titulo")}</span>
            <span className="text-xs text-muted-foreground">{t("computadores.atualizacao.modo.descricao")}</span>
          </div>
          <RadioGroup
            value={modo}
            onValueChange={escolher}
            disabled={!pode}
            aria-label={t("computadores.atualizacao.modo.titulo")}
            className="gap-2 md:grid-cols-3"
          >
            {MODOS_ATUALIZAR.map((m) => {
              const Icone = ICONE_DO_MODO[m]
              return (
                <FieldLabel key={m} htmlFor={`atualizar-${m}`}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={m} id={`atualizar-${m}`} />
                    <FieldContent>
                      <FieldTitle>
                        <Icone className="size-3.5 text-muted-foreground" aria-hidden />
                        {t(`computadores.atualizacao.modo.${m}.titulo`)}
                      </FieldTitle>
                      <FieldDescription className="text-xs">
                        {t(`computadores.atualizacao.modo.${m}.texto`, { fuso: estado.config.fuso })}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )
            })}
          </RadioGroup>
        </div>

      </CardContent>
    </Card>
  )
}
