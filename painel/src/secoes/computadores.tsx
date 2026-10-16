// Computadores: cada um com estado, versão, conta em uso e ações (trocar agora, diagnóstico, atualizar, revogar), e o
// passo a passo de ligar um computador novo (o código aparece nele e é digitado num computador que já usa o Reveza).

import * as React from "react"
import {
  ActivityIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  LaptopIcon,
  PlusIcon,
  ShieldOffIcon,
  ShuffleIcon,
} from "lucide-react"

import { BarraUso, NomeConta, SeloEstado } from "@/components/painel/conta"
import { BotaoAtualizar, CartaoAtualizacoes, LinhaAtualizacao, useAtualizar } from "@/components/painel/atualizar"
import { CartaoAssistente } from "@/components/painel/assistente"
import { BotaoCorrigir, ResultadoConserto, useCorrigir, useDiagnostico } from "@/components/painel/conserto"
import { Codigo } from "@/components/painel/copiar"
import { Confirmar } from "@/components/painel/confirmar"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { compararVersao, estadoComputador, estadoConta, p5, p7, versaoMaisNova } from "@/dados/derivados"
import type { Computador, EstadoLigacao, FaseLigacao, Instantaneo } from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { fmtDuracao, fmtPct, fmtRelativo } from "@/lib/formato"
import { comDemo } from "@/lib/demo"
import { comandoInstalador, sistemaDoNavegador, type SistemaDoNavegador } from "@/lib/instalador"
import { VERSAO_MINIMA_PARA_LIBERAR } from "@/lib/ligacao"
import { Link } from "@/lib/rota"
import { cn } from "@/lib/utils"
import { ICONE_SISTEMA } from "./visao-geral"

export default function Computadores() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const ligar = useDialogo()
  const ativos = estado.computadores.filter((c) => !c.revogado)
  const revogados = estado.computadores.filter((c) => c.revogado)

  return (
    <Pagina
      titulo={t("menu.secoes.computadores")}
      descricao={t("computadores.descricao")}
      acoes={
        <Button onClick={() => ligar.abrir()} disabled={!pode}>
          <PlusIcon />
          {t("computadores.ligar")}
        </Button>
      }
    >
      <AvisoPermissao />
      {ativos.length ? <CartaoAtualizacoes /> : null}
      {ativos.length ? <CartaoAssistente /> : null}
      {ativos.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LaptopIcon />
            </EmptyMedia>
            <EmptyTitle>{t("computadores.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("computadores.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => ligar.abrir()} disabled={!pode}>
              {t("computadores.ligar")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ativos.map((pc) => (
            <CartaoComputador key={pc.id} pc={pc} estado={estado} agora={agora} />
          ))}
        </div>
      )}
      {revogados.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group/revogados -ml-2 self-start">
              <ChevronDownIcon className="transition-transform group-data-[state=open]/revogados:rotate-180" />
              {t("computadores.revogados", { n: revogados.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 grid gap-2 lg:grid-cols-2">
            {revogados.map((pc) => {
              const Sistema = ICONE_SISTEMA[pc.sistema]
              return (
                <div
                  key={pc.id}
                  className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
                >
                  <Sistema className="size-4" aria-hidden />
                  <span className="truncate">{pc.nome}</span>
                  <Badge variant="outline" className="ml-auto">
                    {t("estadoComputador.revogado")}
                  </Badge>
                </div>
              )
            })}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <DialogoLigar key={ligar.chave} aberto={ligar.aberto} aoFechar={ligar.fechar} />
    </Pagina>
  )
}

function CartaoComputador({ pc, estado, agora }: { pc: Computador; estado: Instantaneo; agora: Date }) {
  const { t, idioma } = useT()
  const { fonte, atualizadoEm } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const trocar = useDialogo()
  const [revogar, setRevogar] = React.useState(false)
  const situacao = estadoComputador(pc, agora, atualizadoEm)
  const Sistema = ICONE_SISTEMA[pc.sistema]
  const conta = estado.contas.find((c) => c.id === pc.atribuicao?.contaId)
  const outras = estado.contas.filter((c) => c.posse?.computadorId === pc.id && c.id !== conta?.id)
  const nova = versaoMaisNova(estado.computadores.filter((c) => !c.revogado).map((c) => c.versao))
  const desatualizado = !!nova && compararVersao(pc.versao, nova) < 0
  const corrigir = useCorrigir(pc)
  const diag = useDiagnostico(pc, corrigir)
  const atualizar = useAtualizar(pc)
  const itens = diag.diagnostico?.itens ?? []
  const okItens = itens.filter((i) => i.ok === true).length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <Sistema className="size-4" aria-hidden />
          </span>
          <span className="truncate">{pc.nome}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              situacao === "online" ? "text-ok" : situacao === "atrasado" ? "text-atencao" : "text-erro"
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {t(`estadoComputador.${situacao}`)}
          </span>
          <span>· {t(`sistema.${pc.sistema}`)}</span>
          <span>· {t("computadores.versao", { versao: pc.versao })}</span>
          {desatualizado ? (
            <Badge variant="outline" className="border-atencao-borda bg-atencao-fundo text-atencao">
              {t("saude.desatualizada", { versao: nova ?? "" })}
            </Badge>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("computadores.contaEmUso")}</span>
          {conta ? (
            <>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <NomeConta conta={conta} className="font-medium" />
                <SeloEstado estado={estadoConta(conta, estado.config, agora)} />
              </div>
              <BarraUso
                pct={p5(conta, agora)}
                cor={conta.cor}
                aviso={estado.config.aviso}
                troca={estado.config.modo === "limite" ? undefined : estado.config.troca}
                rotulo={t("janela.five_hour")}
                compacta
              />
              <BarraUso pct={p7(conta, agora)} cor={conta.cor} rotulo={t("janela.seven_day")} compacta />
            </>
          ) : (
            <span className="text-muted-foreground">{t("computadores.semConta")}</span>
          )}
        </div>
        <ContaPreferida pc={pc} estado={estado} />
        <SaidaEnxuta pc={pc} />
        {outras.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("computadores.outrasPosses")}</span>
            {outras.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <NomeConta conta={c} />
                <span className="text-xs text-muted-foreground">{t(`computadores.posse.${c.posse!.motivo}`)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("computadores.ultimaBusca")}</dt>
            <dd className="tabular-nums">{fmtRelativo(pc.vistoEm, agora, idioma)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("computadores.ligadoEm")}</dt>
            <dd>{fmtRelativo(pc.criadoEm, agora, idioma)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("saude.diagnostico")}</dt>
            <dd>
              <Link
                href={comDemo("/saude")}
                className={cn("underline-offset-4 hover:underline", okItens < itens.length && "text-atencao")}
              >
                {itens.length ? t("computadores.diagnosticoResumo", { ok: okItens, total: itens.length }) : "–"}
              </Link>
            </dd>
          </div>
        </dl>
        <ResultadoConserto andamento={corrigir.andamento} compacto />
        <LinhaAtualizacao andamento={atualizar.andamento} />
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!pode} onClick={() => trocar.abrir()}>
          <ShuffleIcon />
          {t("computadores.acoes.trocar")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!pode || diag.rodando}
          onClick={() => void diag.pedir()}
        >
          {diag.rodando ? <Spinner /> : <ActivityIcon />}
          {t("computadores.acoes.diagnostico")}
        </Button>
        {corrigir.quantos ? <BotaoCorrigir corrigir={corrigir} variant="outline" /> : null}
        <BotaoAtualizar atualizar={atualizar} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={!pode}
          onClick={() => setRevogar(true)}
        >
          <ShieldOffIcon />
          {t("computadores.acoes.revogar")}
        </Button>
      </CardFooter>
      <DialogoTrocar key={trocar.chave} pc={pc} aberto={trocar.aberto} aoFechar={trocar.fechar} />
      <Confirmar
        aberto={revogar}
        aoFechar={() => setRevogar(false)}
        titulo={t("computadores.revogar.titulo", { computador: pc.nome })}
        texto={t("computadores.revogar.texto") + (estado.config.nuvem?.completa ? t("computadores.revogar.textoCompleta") : "")}
        botao={t("computadores.revogar.botao")}
        botaoSegurar={t("computadores.revogar.botaoSegurar")}
        aoConfirmar={() =>
          acao(() => fonte.revogarComputador(pc.id), t("computadores.revogar.feito", { computador: pc.nome }))
        }
      />
    </Card>
  )
}

const SEM_PREFERIDA = "__nenhuma"

function ContaPreferida({ pc, estado }: { pc: Computador; estado: Instantaneo }) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [enviando, setEnviando] = React.useState(false)
  const id = `preferida-${pc.id}`
  // uma conta é preferida de um computador só: a de outro aparece desligada, com o nome dele
  const dono = (contaId: string) =>
    estado.computadores.find((x) => x.id !== pc.id && !x.revogado && x.contaPreferidaId === contaId)
  const escolher = async (v: string) => {
    const contaId = v === SEM_PREFERIDA ? null : v
    if (contaId === (pc.contaPreferidaId ?? null)) return
    const conta = estado.contas.find((c) => c.id === contaId)
    setEnviando(true)
    await acao(
      () => fonte.preferirConta(pc.id, contaId),
      conta
        ? t("computadores.preferida.feito", { computador: pc.nome, conta: conta.email })
        : t("computadores.preferida.tirada", { computador: pc.nome })
    )
    setEnviando(false)
  }
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {t("computadores.preferida.rotulo")}
      </FieldLabel>
      <Select
        value={pc.contaPreferidaId ?? SEM_PREFERIDA}
        onValueChange={(v) => void escolher(v)}
        disabled={!pode || enviando}
      >
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_PREFERIDA}>{t("computadores.preferida.nenhuma")}</SelectItem>
          {estado.contas.map((c) => {
            const outro = dono(c.id)
            return (
              <SelectItem key={c.id} value={c.id} disabled={!!outro}>
                <NomeConta conta={c} />
                {outro ? (
                  <span className="text-xs text-muted-foreground">
                    {t("computadores.preferida.deOutro", { computador: outro.nome })}
                  </span>
                ) : null}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("computadores.preferida.dica")}</p>
    </Field>
  )
}

function SaidaEnxuta({ pc }: { pc: Computador }) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const [enviando, setEnviando] = React.useState(false)
  const id = `enxugar-${pc.id}`
  const mudar = async (ligado: boolean) => {
    setEnviando(true)
    await acao(
      () => fonte.enxugarComputador(pc.id, ligado),
      t(ligado ? "computadores.enxugar.ligado" : "computadores.enxugar.desligado", { computador: pc.nome })
    )
    setEnviando(false)
  }
  return (
    <Field orientation="horizontal" className="items-start gap-3">
      <FieldContent className="gap-0.5">
        <FieldLabel htmlFor={id} className="text-xs font-normal text-muted-foreground">
          {t("computadores.enxugar.rotulo")}
        </FieldLabel>
        <p className="text-xs text-muted-foreground">{t("computadores.enxugar.dica")}</p>
      </FieldContent>
      <Switch
        id={id}
        size="sm"
        checked={pc.enxugar}
        disabled={!pode || enviando || pc.revogado}
        onCheckedChange={(v) => void mudar(v)}
      />
    </Field>
  )
}

function DialogoTrocar({ pc, aberto, aoFechar }: { pc: Computador; aberto: boolean; aoFechar: () => void }) {
  // quem abre passa key={chave da abertura}: a escolha nasce vazia a cada vez
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const agora = useAgora(15_000)
  const acao = useAcao()
  const [escolha, setEscolha] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const opcoes = estado.contas.filter((c) => c.id !== pc.atribuicao?.contaId)
  const ocupada = (id: string) =>
    estado.computadores.some((x) => x.id !== pc.id && !x.revogado && x.atribuicao?.contaId === id)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("computadores.trocar.titulo", { computador: pc.nome })}</DialogTitle>
          <DialogDescription>{t("computadores.trocar.descricao")}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={escolha} onValueChange={setEscolha} aria-label={t("computadores.trocar.conta")}>
          {opcoes.map((c) => {
            const bloqueada = ocupada(c.id) || c.precisaLogin
            return (
              <FieldLabel key={c.id} htmlFor={`trocar-${c.id}`} className={cn(bloqueada && "opacity-60")}>
                <Field orientation="horizontal">
                  <RadioGroupItem id={`trocar-${c.id}`} value={c.id} disabled={bloqueada} />
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <NomeConta conta={c} />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {ocupada(c.id)
                        ? t("computadores.trocar.ocupada")
                        : c.precisaLogin
                          ? t("estadoConta.precisa_login")
                          : `${t(`estadoConta.${estadoConta(c, estado.config, agora)}`)} · ${fmtPct(p5(c, agora), idioma)}`}
                    </span>
                  </div>
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.cancelar")}
          </Button>
          <Button
            disabled={!escolha || enviando}
            onClick={async () => {
              setEnviando(true)
              const conta = estado.contas.find((c) => c.id === escolha)
              const [ok] = await acao(
                () => fonte.trocarAgora(pc.id, escolha),
                t("computadores.trocar.feito", { computador: pc.nome, conta: conta?.email ?? "" })
              )
              setEnviando(false)
              if (ok) aoFechar()
            }}
          >
            {enviando ? <Spinner /> : null}
            {t("computadores.trocar.botao")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoLigar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t } = useT()
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("computadores.ligacao.titulo")}</DialogTitle>
          <DialogDescription>{t("computadores.ligacao.descricao")}</DialogDescription>
        </DialogHeader>
        <LigarComputadorNovo />
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.fechar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type EtapaLigar =
  | { tipo: "inicio" }
  | { tipo: "criando" }
  | { tipo: "acompanhar"; codigo: string; computadorId: string }

/** As fases em que o painel ainda espera alguma coisa (as outras são o fim: ligado, recusado, vencido). */
const FASES_EM_CURSO = new Set<FaseLigacao>(["esperando_pedido", "esperando_codigo", "entregue"])

/**
 * Ligar um computador novo (0.2.0): o painel cria a identidade pendente e mostra o código de acesso, que só deixa o
 * computador novo pedir para entrar. O computador novo mostra um código de 12 caracteres; a pessoa digita esse código
 * na janela que abre no computador escolhido aqui (ou `reveza ligar XXXX-XXXX-YYYY` nele, sem tela). O painel só acompanha.
 */
function LigarComputadorNovo() {
  const { t, idioma } = useT()
  const { fonte, recarregar, atualizadoEm } = useDados()
  const estado = useEstado()
  const agora = useAgora(1000)
  const acao = useAcao()
  const ativos = estado.computadores.filter((c) => !c.revogado && c.sistema !== "pendente")
  const liberam = ativos.filter((c) => compararVersao(c.versao, VERSAO_MINIMA_PARA_LIBERAR) >= 0)
  const online = (c: Computador) => estadoComputador(c, agora, atualizadoEm) === "online"
  const [pc, setPc] = React.useState(() => (liberam.find(online) ?? liberam[0])?.id ?? "")
  const [etapa, setEtapa] = React.useState<EtapaLigar>({ tipo: "inicio" })
  const [lig, setLig] = React.useState<EstadoLigacao | null>(null)
  const pendente = React.useRef<string | null>(null)
  const escolhido = liberam.find((c) => c.id === pc) ?? null
  const novoId = etapa.tipo === "acompanhar" ? etapa.computadorId : null
  const emCurso = !lig || FASES_EM_CURSO.has(lig.fase)

  // o andamento: de 2 em 2 segundos enquanto falta alguma coisa
  React.useEffect(() => {
    if (!novoId || !emCurso) return
    let vivo = true
    const ler = async () => {
      try {
        const e = await fonte.estadoLigacao(novoId)
        if (!vivo) return
        setLig(e)
        // entrou: o próximo código não revoga este computador, e a lista relê já (com o nome dele)
        if (e.fase === "ligado") {
          pendente.current = null
          void recarregar()
        }
      } catch {
        // sem conexão por um instante: tenta na próxima volta
      }
    }
    void ler()
    const id = setInterval(() => void ler(), 2000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [fonte, novoId, emCurso, recarregar])

  const gerar = async () => {
    setEtapa({ tipo: "criando" })
    setLig(null)
    // um código novo invalida o anterior que não chegou a ser usado
    if (pendente.current) await acao(() => fonte.revogarComputador(pendente.current!))
    pendente.current = null
    const [ok, acesso] = await acao(() => fonte.criarAcessoComputador())
    if (!ok || !acesso.computadorId) return setEtapa({ tipo: "inicio" })
    pendente.current = acesso.computadorId
    if (escolhido) await acao(() => fonte.escolherAprovador(acesso.computadorId!, escolhido.id))
    setEtapa({ tipo: "acompanhar", codigo: acesso.codigo, computadorId: acesso.computadorId })
  }

  const abrirJanela = async (id: string) => {
    setPc(id)
    if (!novoId) return
    const c = liberam.find((x) => x.id === id)
    await acao(() => fonte.escolherAprovador(novoId, id), t("computadores.ligacao.janelaPedida", { computador: c?.nome ?? "" }))
  }

  const nomeDe = (c: Computador) => (online(c) ? c.nome : t("computadores.ligacao.foraDoAr", { computador: c.nome }))
  const seletor = liberam.length > 1 && (
    <Select value={pc} onValueChange={(v) => void (etapa.tipo === "acompanhar" ? abrirJanela(v) : setPc(v))}>
      <SelectTrigger id="ligar-pc" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {liberam.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {nomeDe(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  if (etapa.tipo !== "acompanhar") {
    const atrasado = ativos.find((c) => compararVersao(c.versao, VERSAO_MINIMA_PARA_LIBERAR) < 0)
    return (
      <div className="flex flex-col gap-3">
        {!ativos.length ? (
          <Alert>
            <AlertDescription>{t("computadores.ligacao.semLigado")}</AlertDescription>
          </Alert>
        ) : !liberam.length ? (
          <Alert className="border-atencao-borda bg-atencao-fundo">
            <AlertDescription>
              {t("computadores.ligacao.atualizeAntes", { versao: VERSAO_MINIMA_PARA_LIBERAR, computador: atrasado?.nome ?? "" })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {seletor ? (
              <Field>
                <FieldLabel htmlFor="ligar-pc">{t("computadores.ligacao.ondeDigitar")}</FieldLabel>
                {seletor}
              </Field>
            ) : (
              <p className="text-sm">{t("computadores.ligacao.inicio", { computador: escolhido?.nome ?? "" })}</p>
            )}
            <Button onClick={() => void gerar()} disabled={etapa.tipo === "criando"} className="self-start">
              {etapa.tipo === "criando" ? <Spinner /> : <KeyRoundIcon />}
              {t("computadores.ligacao.gerar")}
            </Button>
          </>
        )}
      </div>
    )
  }

  const novo = estado.computadores.find((c) => c.id === etapa.computadorId)
  const restante = lig?.expiraEm ? (new Date(lig.expiraEm).getTime() - agora.getTime()) / 1000 : null
  const fase = lig?.fase ?? "esperando_pedido"
  const fim = fase === "recusado" || fase === "vencido"
  const nomeAprovador = escolhido?.nome ?? ""
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4 text-sm">
        <Passo n={1} feito={fase !== "esperando_pedido"}>
          <span>{t("computadores.ligacao.passoRodar")}</span>
          <ComandoPorSistema extra="--ligar" />
        </Passo>
        <Passo n={2} feito={fase !== "esperando_pedido"}>
          <span>{t("computadores.ligacao.passoColar")}</span>
          <Codigo texto={etapa.codigo} className="[&_pre]:break-all [&_pre]:whitespace-pre-wrap" />
          <span className="text-xs text-muted-foreground">{t("computadores.ligacao.acessoAviso")}</span>
        </Passo>
        <Passo n={3} feito={fase === "entregue" || fase === "ligado"}>
          <span>{t("computadores.ligacao.passoDigitar", { computador: nomeAprovador })}</span>
          <span className="text-xs text-muted-foreground">{t("computadores.ligacao.semTela")}</span>
          <Codigo texto="reveza ligar XXXX-XXXX-YYYY" />
          {seletor && (fase === "esperando_pedido" || fase === "esperando_codigo") ? (
            <Field>
              <FieldLabel htmlFor="ligar-pc" className="text-xs text-muted-foreground">
                {t("computadores.ligacao.outroComputador")}
              </FieldLabel>
              {seletor}
            </Field>
          ) : null}
        </Passo>
      </ol>
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg p-3 text-sm",
          fim ? "border border-atencao-borda bg-atencao-fundo" : "bg-muted/60"
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          {fase === "ligado" ? (
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          ) : fim ? (
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-atencao" aria-hidden />
          ) : (
            <Spinner className="mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn(fase === "ligado" ? "text-ok" : fim ? "text-foreground" : "text-muted-foreground")}>
            {fase === "ligado"
              ? novo && novo.sistema !== "pendente"
                ? t("computadores.ligacao.fase.ligado", { computador: novo.nome })
                : t("computadores.ligacao.fase.ligadoSemNome")
              : fase === "recusado"
                ? t(`computadores.ligacao.fase.${lig?.motivo ?? "recusado_na_tela"}`)
                : t(`computadores.ligacao.fase.${fase}`, { computador: nomeAprovador })}
          </span>
        </div>
        {fase === "esperando_codigo" && restante !== null && restante > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("computadores.ligacao.expira", { tempo: fmtDuracao(restante, idioma) })}
            </span>
            {escolhido ? (
              <Button variant="outline" size="sm" onClick={() => void abrirJanela(escolhido.id)}>
                {t("computadores.ligacao.janelaDeNovo")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {fim ? (
          <Button variant="outline" size="sm" onClick={() => void gerar()} className="ml-6 self-start">
            {t("computadores.ligacao.tentarDeNovo")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Um passo numerado (o número vira um visto quando o passo já foi). */
function Passo({ n, feito, children }: { n: number; feito: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
          feito ? "border-ok/40 bg-ok/10 text-ok" : "bg-background"
        )}
        aria-hidden
      >
        {feito ? <CheckIcon className="size-3.5" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </li>
  )
}

/** O comando de instalar com as instruções do sistema de quem vai rodar (abre no sistema deste navegador). */
function ComandoPorSistema({ extra }: { extra: string }) {
  const { t } = useT()
  const [sistema, setSistema] = React.useState<SistemaDoNavegador>(() => sistemaDoNavegador())
  const sistemas: SistemaDoNavegador[] = ["macos", "windows", "linux"]
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label={t("computadores.ligacao.sistemas.rotulo")} className="flex gap-1 self-start rounded-lg bg-muted p-1">
        {sistemas.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={sistema === s}
            onClick={() => setSistema(s)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium", sistema === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {t(`computadores.ligacao.sistemas.${s}.nome`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t(`computadores.ligacao.sistemas.${sistema}.abrir`)}</p>
      {/* o comando com o endereço do pacote da versão é longo: quebra a linha em vez de passar da caixa */}
      <Codigo texto={comandoInstalador(extra)} className="[&_pre]:break-all [&_pre]:whitespace-pre-wrap" />
      <p className="text-xs text-muted-foreground">{t("computadores.ligacao.sistemas.requisitos")}</p>
    </div>
  )
}
