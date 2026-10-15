// Visão geral: faixas de alerta, números do dia (adaptados do "section-cards" do bloco dashboard-01), a conta de cada
// computador, a janela de 5 horas no tempo (adaptado do "chart-area-interactive" do dashboard-01) e a linha do tempo.

import * as React from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import {
  AppleIcon,
  HourglassIcon,
  ArrowRightIcon,
  BellRingIcon,
  CircleAlertIcon,
  InfoIcon,
  MonitorIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { BarraUso, NomeConta, SeloEstado } from "@/components/painel/conta"
import { LinhaEvento, traduzirMotivo } from "@/components/painel/evento"
import { Pagina } from "@/components/painel/pagina"
import { NumeroAnimado } from "@/components/rb"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgora, useConsulta, useDados, useEstado } from "@/dados/contexto"
import {
  estadoComputador,
  estadoConta,
  faixasDeAlerta,
  p5,
  p7,
  resetDe,
  versaoMaisNova,
  type FaixaAlerta,
} from "@/dados/derivados"
import type { Computador, Conta, Instantaneo, PontoHistorico, Sistema } from "@/dados/tipos"
import { useT } from "@/i18n"
import { corConta, juntasPorWorkspace } from "@/lib/cores"
import { comDemo } from "@/lib/demo"
import { chaveDia, fmtFuturo, fmtHora, fmtPct, fmtRelativo, fmtUsd } from "@/lib/formato"
import { preverEsgotar, type Previsao } from "@/lib/plano"
import { Link } from "@/lib/rota"
import { totais } from "@/lib/uso"
import { cn } from "@/lib/utils"

export const ICONE_SISTEMA: Record<Sistema, typeof AppleIcon> = {
  macos: AppleIcon,
  linux: TerminalIcon,
  windows: MonitorIcon,
  pendente: HourglassIcon,
}

export function usePrevisoes(estado: Instantaneo, historico: PontoHistorico[] | null, agora: Date) {
  return React.useMemo(() => {
    const mapa = new Map<string, Previsao | null>()
    if (!historico) return mapa
    for (const c of estado.contas) {
      const pontos = historico.filter((p) => p.contaId === c.id)
      mapa.set(
        c.id,
        preverEsgotar({
          pontos,
          agora,
          reset5: resetDe(c, "five_hour"),
          reset7: resetDe(c, "seven_day"),
          atual5: p5(c, agora),
          atual7: p7(c, agora),
        })
      )
    }
    return mapa
    // a previsão só muda quando o histórico muda; o "agora" de cada minuto não precisa refazer a conta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.contas, historico])
}

export default function VisaoGeral() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(15_000)
  const [inicioOntem] = React.useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - 1)
    return d
  })
  const uso = useConsulta(
    (f) => f.uso({ de: inicioOntem, ate: new Date(inicioOntem.getTime() + 3 * 86_400_000) }),
    [inicioOntem]
  )
  const historico = useConsulta((f) => f.historico(new Date(Date.now() - 24 * 3_600_000)), [])
  const previsoes = usePrevisoes(estado, historico.dados, agora)

  return (
    <Pagina titulo={t("menu.secoes.visao")} descricao={t("visao.descricao")}>
      <Faixas estado={estado} agora={agora} />
      <Numeros estado={estado} agora={agora} uso={uso.dados} previsoes={previsoes} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <EmUso estado={estado} agora={agora} />
          <GraficoJanela estado={estado} historico={historico.dados} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ResumoContas estado={estado} agora={agora} />
          <Eventos estado={estado} agora={agora} />
        </div>
      </div>
    </Pagina>
  )
}

function Faixas({ estado, agora }: { estado: Instantaneo; agora: Date }) {
  const { t, idioma } = useT()
  const { atualizadoEm } = useDados()
  const faixas = faixasDeAlerta(estado, agora, atualizadoEm)
  if (!faixas.length) return null
  const nomeConta = (id?: string) => estado.contas.find((c) => c.id === id)?.email ?? ""
  const pc = (id?: string) => estado.computadores.find((c) => c.id === id)
  const destino: Record<FaixaAlerta["tipo"], string> = {
    precisa_login: "/contas",
    sem_livre: "/contas",
    computador_parado: "/saude",
    login_vence: "/contas",
    versao_antiga: "/saude",
    auto_desligada: "/troca",
  }
  const nova = versaoMaisNova(estado.computadores.map((c) => c.versao)) ?? ""
  return (
    <div className="flex flex-col gap-3">
      {faixas.map((f, i) => {
        const conta = estado.contas.find((c) => c.id === f.contaId)
        const vars = {
          conta: nomeConta(f.contaId),
          computador: pc(f.computadorId)?.nome ?? "",
          quando:
            f.tipo === "computador_parado"
              ? fmtRelativo(pc(f.computadorId)?.vistoEm, agora, idioma)
              : conta?.loginExpiraEm
                ? fmtFuturo(conta.loginExpiraEm, agora, idioma)
                : "",
          versao: pc(f.computadorId)?.versao ?? "",
          nova,
        }
        const Icone = f.nivel === "erro" ? CircleAlertIcon : f.nivel === "atencao" ? TriangleAlertIcon : InfoIcon
        return (
          <Alert
            key={`${f.tipo}-${f.contaId ?? f.computadorId ?? i}`}
            className={cn(
              "has-data-[slot=alert-action]:pr-2.5 sm:has-data-[slot=alert-action]:pr-44",
              f.nivel === "erro" &&
                "border-erro-borda bg-erro-fundo text-erro *:data-[slot=alert-description]:text-erro/90",
              f.nivel === "atencao" &&
                "border-atencao-borda bg-atencao-fundo text-atencao *:data-[slot=alert-description]:text-atencao/90"
            )}
          >
            <Icone />
            <AlertTitle>{t(`visao.faixa.${f.tipo}.titulo`, vars)}</AlertTitle>
            <AlertDescription>{t(`visao.faixa.${f.tipo}.texto`, vars)}</AlertDescription>
            <AlertAction className="static col-start-2 mt-2 justify-self-start sm:absolute sm:top-2 sm:right-2 sm:mt-0">
              <Button size="sm" variant="outline" asChild className="bg-background/80">
                <Link href={comDemo(destino[f.tipo])}>{t(`visao.faixa.${f.tipo}.botao`)}</Link>
              </Button>
            </AlertAction>
          </Alert>
        )
      })}
    </div>
  )
}

function Numeros({
  estado,
  agora,
  uso,
  previsoes,
}: {
  estado: Instantaneo
  agora: Date
  uso: import("@/dados/tipos").LinhaUso[] | null
  previsoes: Map<string, Previsao | null>
}) {
  const { t, tn, idioma } = useT()
  const estados = estado.contas.map((c) => estadoConta(c, estado.config, agora))
  const livres = estados.filter((e) => e === "livre" || e === "reserva").length
  const emUso = estados.filter((e) => e === "em_uso" || e === "aviso").length
  const esgotadas = estados.filter((e) => e === "esgotada").length
  const login = estados.filter((e) => e === "precisa_login").length

  const trocas = estado.eventos.filter(
    (e) => e.tipo === "troca" && agora.getTime() - new Date(e.em).getTime() < 24 * 3_600_000
  )

  const hoje = chaveDia(agora)
  const ontem = chaveDia(new Date(agora.getTime() - 86_400_000))
  const horaAgora = agora.getHours() + agora.getMinutes() / 60
  const custoHoje = uso ? totais(uso.filter((l) => chaveDia(l.hora) === hoje)).usd : null
  const custoOntem = uso
    ? totais(
        uso.filter((l) => {
          const d = new Date(l.hora)
          return chaveDia(d) === ontem && d.getHours() < horaAgora
        })
      ).usd
    : null

  const proxima = [...previsoes.entries()]
    .filter((e): e is [string, Previsao] => !!e[1])
    .sort((a, b) => a[1].em.getTime() - b[1].em.getTime())[0]
  const contaProxima = proxima ? estado.contas.find((c) => c.id === proxima[0]) : undefined

  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/[0.03] *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs sm:grid-cols-2 xl:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t("visao.kpi.livres")}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            <NumeroAnimado valor={livres} />
            <span className="text-base font-normal text-muted-foreground"> / {estado.contas.length}</span>
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          {[
            tn("visao.kpi.emUso", emUso),
            esgotadas ? tn("visao.kpi.esgotadas", esgotadas) : null,
            login ? tn("visao.kpi.login", login) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t("visao.kpi.trocas")}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            <NumeroAnimado valor={trocas.length} />
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          {trocas[0]
            ? t("visao.kpi.trocasRodape", { quando: fmtRelativo(trocas[0].em, agora, idioma) })
            : t("visao.kpi.trocasNenhuma")}
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1">
            {t("visao.kpi.custo")}
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground" aria-label={t("visao.kpi.custoDica")}>
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{t("visao.kpi.custoDica")}</TooltipContent>
            </Tooltip>
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {custoHoje === null ? <Skeleton className="h-8 w-28" /> : fmtUsd(custoHoje, idioma)}
          </CardTitle>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          {custoOntem !== null ? t("visao.kpi.custoRodape", { valor: fmtUsd(custoOntem, idioma) }) : " "}
        </CardFooter>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>{t("visao.kpi.proxima")}</CardDescription>
          <CardTitle className="text-xl font-semibold @[250px]/card:text-2xl">
            {proxima && contaProxima ? (
              <span className="tabular-nums">{fmtFuturo(proxima[1].em, agora, idioma)}</span>
            ) : (
              <span className="text-base font-normal text-muted-foreground">{t("visao.kpi.proximaNenhuma")}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm text-muted-foreground">
          {proxima && contaProxima ? (
            <>
              <NomeConta conta={contaProxima} className="max-w-full text-foreground" />
              <span>
                {t("visao.kpi.proximaRodape", {
                  janela: t(proxima[1].janela === "cinco_horas" ? "janela.five_hour" : "janela.seven_day"),
                })}
              </span>
            </>
          ) : (
            " "
          )}
        </CardFooter>
      </Card>
    </div>
  )
}

/** A janela que está mais perto do fim (para mostrar só uma no resumo). */
function janelaMaisCheia(c: Conta, agora: Date) {
  const v5 = p5(c, agora)
  const v7 = p7(c, agora)
  if (v5 === null && v7 === null) return null
  return (v5 ?? -1) >= (v7 ?? -1) ? { tipo: "five_hour" as const, pct: v5 } : { tipo: "seven_day" as const, pct: v7 }
}

function EmUso({ estado, agora }: { estado: Instantaneo; agora: Date }) {
  const { t } = useT()
  const ativos = estado.computadores.filter((c) => !c.revogado)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visao.emUso.titulo")}</CardTitle>
        <CardDescription>{t("visao.emUso.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {ativos.length === 0 ? (
          <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
            {t("visao.emUso.nenhum")}
            <Button size="sm" asChild>
              <Link href={comDemo("/computadores")}>{t("visao.emUso.ligar")}</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {ativos.map((pc) => (
              <CartaoComputador key={pc.id} pc={pc} estado={estado} agora={agora} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CartaoComputador({ pc, estado, agora }: { pc: Computador; estado: Instantaneo; agora: Date }) {
  const i = useT()
  const { t, idioma } = i
  const { atualizadoEm } = useDados()
  const conta = estado.contas.find((c) => c.id === pc.atribuicao?.contaId)
  const situacao = estadoComputador(pc, agora, atualizadoEm)
  const Sistema = ICONE_SISTEMA[pc.sistema]
  const r5 = conta ? resetDe(conta, "five_hour") : null
  const r7 = conta ? resetDe(conta, "seven_day") : null
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Sistema className="size-4 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{pc.nome}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 text-xs",
            situacao === "online" ? "text-ok" : situacao === "atrasado" ? "text-atencao" : "text-erro"
          )}
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {t(`estadoComputador.${situacao}`)}
        </span>
      </div>
      {conta ? (
        <>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <NomeConta conta={conta} className="text-sm font-medium" />
            <SeloEstado estado={estadoConta(conta, estado.config, agora)} />
          </div>
          <BarraUso
            pct={p5(conta, agora)}
            cor={conta.cor}
            aviso={estado.config.aviso}
            troca={estado.config.modo === "limite" ? undefined : estado.config.troca}
            rotulo={t("janela.five_hour")}
            detalhe={r5 ? t("visao.emUso.renova", { quando: fmtFuturo(r5, agora, idioma) }) : undefined}
          />
          <BarraUso
            pct={p7(conta, agora)}
            cor={conta.cor}
            rotulo={t("janela.seven_day")}
            detalhe={r7 ? t("visao.emUso.renova", { quando: fmtFuturo(r7, agora, idioma) }) : undefined}
            compacta
          />
          {pc.atribuicao ? (
            <p className="text-xs text-muted-foreground">
              {traduzirMotivo(pc.atribuicao.motivo, i)} ·{" "}
              {t("visao.emUso.desde", { quando: fmtRelativo(pc.atribuicao.decididoEm, agora, idioma) })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("visao.emUso.semConta")}</p>
      )}
    </div>
  )
}

function ResumoContas({ estado, agora }: { estado: Instantaneo; agora: Date }) {
  const { t } = useT()
  const ordenadas = [...estado.contas].sort((a, b) => a.prioridade - b.prioridade)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visao.contas.titulo")}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href={comDemo("/contas")}>
              {t("visao.contas.verTodas")}
              <ArrowRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ordenadas.map((c) => {
          const j = janelaMaisCheia(c, agora)
          return (
            <div key={c.id} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                <NomeConta conta={c} />
                <SeloEstado estado={estadoConta(c, estado.config, agora)} />
              </div>
              {j ? <BarraUso pct={j.pct} cor={c.cor} rotulo={t(`janela.${j.tipo}`)} compacta /> : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function GraficoJanela({ estado, historico }: { estado: Instantaneo; historico: PontoHistorico[] | null }) {
  const { t, idioma } = useT()
  const [horas, setHoras] = React.useState("6")
  const contas = juntasPorWorkspace(estado.contas.filter((c) => historico?.some((p) => p.contaId === c.id)))
  const config = React.useMemo(() => {
    const cfg: ChartConfig = {}
    // uma linha por conta: as do mesmo workspace na mesma cor, cada uma num tom
    contas.forEach((c, i) => (cfg[`c${i}`] = { label: c.email, color: corConta(c.cor, c.tom) }))
    return cfg
  }, [contas])
  const dados = React.useMemo(() => {
    if (!historico?.length) return []
    // a janela termina no ponto mais recente do histórico
    const fim = Math.max(...historico.map((p) => new Date(p.em).getTime()))
    const desde = fim - Number(horas) * 3_600_000
    const porInstante = new Map<string, Record<string, number | string>>()
    for (const p of historico) {
      if (new Date(p.em).getTime() < desde || p.p5 === null) continue
      const i = contas.findIndex((c) => c.id === p.contaId)
      if (i < 0) continue
      const linha = porInstante.get(p.em) ?? { em: p.em }
      linha[`c${i}`] = p.p5
      porInstante.set(p.em, linha)
    }
    return [...porInstante.values()].sort((a, b) => String(a.em).localeCompare(String(b.em)))
  }, [historico, horas, contas])

  return (
    <Card className="@container/card">
      <CardHeader className="max-sm:grid-cols-1">
        <CardTitle>{t("visao.grafico.titulo")}</CardTitle>
        <CardDescription>{t("visao.grafico.descricao")}</CardDescription>
        <CardAction className="col-span-full col-start-1 row-start-3 mt-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0">
          <ToggleGroup type="single" variant="outline" size="sm" value={horas} onValueChange={(v) => v && setHoras(v)}>
            <ToggleGroupItem value="6">{t("visao.grafico.h6")}</ToggleGroupItem>
            <ToggleGroupItem value="24">{t("visao.grafico.h24")}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {!historico ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
            <LineChart data={dados} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="em"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
                tickFormatter={(v) => fmtHora(String(v), idioma)}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={(v) => `${v}%`}
              />
              <ReferenceLine
                y={estado.config.aviso}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              {estado.config.modo !== "limite" ? (
                <ReferenceLine
                  y={estado.config.troca}
                  stroke="var(--foreground)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              ) : null}
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => fmtHora(String(p?.[0]?.payload?.em ?? ""), idioma)}
                    formatter={(valor, nome) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: `var(--color-${String(nome)})` }}
                          />
                          {config[String(nome)]?.label}
                        </span>
                        <span className="font-mono font-medium tabular-nums">{fmtPct(Number(valor), idioma, 1)}</span>
                      </div>
                    )}
                  />
                }
              />
              {contas.map((c, i) => (
                <Line
                  key={c.id}
                  dataKey={`c${i}`}
                  type="monotone"
                  stroke={`var(--color-c${i})`}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground sm:px-0">
          {contas.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: corConta(c.cor, c.tom) }} aria-hidden />
              {c.email}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Eventos({ estado, agora }: { estado: Instantaneo; agora: Date }) {
  const { t } = useT()
  const [quantos, setQuantos] = React.useState(8)
  const lista = estado.eventos.slice(0, quantos)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRingIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("visao.eventos.titulo")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("visao.eventos.nenhum")}</p>
        ) : (
          <ul className="divide-y">
            {lista.map((e) => (
              <LinhaEvento key={e.id} evento={e} estado={estado} agora={agora} />
            ))}
          </ul>
        )}
        {estado.eventos.length > quantos ? (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setQuantos((q) => q + 12)}>
            {t("visao.eventos.mais")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
