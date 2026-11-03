// Uso: números do período (com o custo também em real), leituras do período, barras por dia e por conta (adaptadas do
// "chart-bar-stacked" e do "chart-bar-interactive" dos gráficos do shadcn/ui), ranking, sessões e agentes por dia, mapa
// de calor 7x24, previsão de esgotar, sessões mais caras, a planilha CSV e o cartão de conquista para os stories.

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ActivityIcon,
  BotIcon,
  CalendarClockIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  RepeatIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { CartaoConquista } from "@/components/painel/cartao-conquista"
import { NomeConta, PontoConta } from "@/components/painel/conta"
import { Pagina } from "@/components/painel/pagina"
import { NumeroAnimado } from "@/components/rb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgora, useConsulta, useDados, useEstado } from "@/dados/contexto"
import { cheia, p5, p7 } from "@/dados/derivados"
import type { Instantaneo, LinhaUso, SessaoUso } from "@/dados/tipos"
import { useT } from "@/i18n"
import { COR_OUTRAS, corConta, juntasPorWorkspace, seriesPorConta } from "@/lib/cores"
import { baixarArquivo, paraCsv } from "@/lib/csv"
import { COTACAO_DEMO, useCotacaoDolar, type Cotacao } from "@/lib/cotacao"
import {
  chaveDia,
  fmtBrl,
  fmtDia,
  fmtDuracao,
  fmtDataHora,
  fmtFuturo,
  fmtNumero,
  fmtPct,
  fmtTokens,
  fmtUsd,
} from "@/lib/formato"
import { leituras, type Leitura } from "@/lib/leituras"
import { diasEntre, mapaCalor, porDia, ranking, sessoesPorDia, totais, type Dimensao, type Metrica } from "@/lib/uso"
import { cn } from "@/lib/utils"
import { usePrevisoes } from "./visao-geral"

const PERIODOS = ["7", "30", "90"] as const

export default function Uso() {
  const { t, idioma } = useT()
  const estado = useEstado()
  const { fonte } = useDados()
  const agora = useAgora(60_000)
  // o custo também em real, pela PTAX do Banco Central (só no painel em português)
  const cotacao = useCotacaoDolar(idioma === "pt-BR", fonte.demo ? COTACAO_DEMO : undefined)
  const [periodo, setPeriodo] = React.useState<(typeof PERIODOS)[number]>("30")
  const [metrica, setMetrica] = React.useState<Metrica>("usd")

  const [hoje] = React.useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const intervalo = React.useMemo(() => {
    const de = new Date(hoje)
    de.setDate(de.getDate() - (Number(periodo) - 1))
    const ate = new Date(hoje)
    ate.setDate(ate.getDate() + 1)
    return { de, ate }
  }, [hoje, periodo])
  const uso = useConsulta((f) => f.uso(intervalo), [intervalo])
  const sessoes = useConsulta((f) => f.sessoes(intervalo), [intervalo])
  // o período anterior, do mesmo tamanho, para a leitura da tendência
  const anterior = useConsulta(
    (f) => {
      const de = new Date(intervalo.de)
      de.setDate(de.getDate() - Number(periodo))
      return f.uso({ de, ate: intervalo.de })
    },
    [intervalo, periodo]
  )
  const historico = useConsulta((f) => f.historico(new Date(Date.now() - 24 * 3_600_000)), [])
  const dias = React.useMemo(() => diasEntre(intervalo.de, agora), [intervalo, agora])

  const formatar = React.useCallback(
    (v: number) =>
      metrica === "usd"
        ? fmtUsd(v, idioma, v >= 100 ? 0 : 2)
        : metrica === "tokens"
          ? fmtTokens(v, idioma)
          : fmtNumero(v, idioma),
    [metrica, idioma]
  )

  const numeros = React.useMemo(() => {
    if (!uso.dados || !sessoes.dados) return null
    const tot = totais(uso.dados)
    return {
      tokens: tot.tokens,
      usd: tot.usd,
      respostas: tot.respostas,
      agentes: agentesDoPeriodo(uso.dados, sessoes.dados, intervalo.de),
      sessoes: sessoes.dados.length,
    }
  }, [uso.dados, sessoes.dados, intervalo.de])

  const exportar = () => {
    if (!uso.dados) return
    const nomeConta = (id: string | null) => estado.contas.find((c) => c.id === id)?.email ?? ""
    const nomePc = (id: string) => estado.computadores.find((c) => c.id === id)?.nome ?? id
    const linhas = uso.dados.map((l) => [
      l.hora,
      nomeConta(l.contaId),
      nomePc(l.computadorId),
      l.projeto,
      l.modelo,
      l.respostas,
      l.entrada,
      l.saida,
      l.cacheEscrita,
      l.cacheLeitura,
      l.usd,
      l.agentes,
    ])
    const nome = t("uso.csv.nome", { de: chaveDia(intervalo.de), ate: chaveDia(agora) })
    baixarArquivo(nome, paraCsv(t("uso.csv.colunas").split(","), linhas))
    toast.success(t("uso.csv.pronto", { n: linhas.length }))
  }

  return (
    <Pagina
      titulo={t("menu.secoes.uso")}
      descricao={t("uso.descricao")}
      acoes={
        <>
          <CartaoConquista
            numeros={numeros}
            dias={Number(periodo)}
            de={intervalo.de}
            ate={agora}
            cotacao={cotacao}
            disabled={!uso.dados?.length}
          />
          <Button variant="outline" onClick={exportar} disabled={!uso.dados?.length}>
            <DownloadIcon />
            {t("comum.exportar")}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("uso.periodo")}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={periodo}
            onValueChange={(v) => v && setPeriodo(v as typeof periodo)}
          >
            {PERIODOS.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {t("uso.dias", { n: p })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("uso.metrica")}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={metrica}
            onValueChange={(v) => v && setMetrica(v as Metrica)}
          >
            {(["usd", "tokens", "respostas"] as const).map((m) => (
              <ToggleGroupItem key={m} value={m}>
                {t(`uso.metricas.${m}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <Numeros uso={uso.dados} sessoes={sessoes.dados} dias={dias.length} de={intervalo.de} cotacao={cotacao} />

      <Leituras
        uso={uso.dados}
        sessoes={sessoes.dados}
        anterior={anterior.dados}
        de={intervalo.de}
        agora={agora}
        diasPeriodo={Number(periodo)}
        cotacao={cotacao}
      />

      <GraficoPorDia estado={estado} uso={uso.dados} dias={dias} metrica={metrica} formatar={formatar} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Ranking estado={estado} uso={uso.dados} metrica={metrica} formatar={formatar} />
        <SessoesPorDia sessoes={sessoes.dados} uso={uso.dados} dias={dias} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MapaCalor uso={uso.dados} metrica={metrica} formatar={formatar} />
        <PrevisaoEsgotar estado={estado} historico={historico.dados} agora={agora} />
      </div>

      <SessoesCaras estado={estado} sessoes={sessoes.dados} agora={agora} />
    </Pagina>
  )
}

/**
 * Agentes que começaram no período: das linhas de uso (nuvem 0030). Sem o número nas linhas (nuvem ou agentes de antes
 * da 0.11.0), soma os das sessões que começaram no período, como antes.
 */
function agentesDoPeriodo(uso: LinhaUso[], sessoes: SessaoUso[], de: Date): number {
  const pelasLinhas = uso.reduce((s, l) => s + l.agentes, 0)
  if (pelasLinhas > 0) return pelasLinhas
  return sessoes.filter((s) => new Date(s.inicio) >= de).reduce((s, x) => s + x.agentes, 0)
}

function Numeros({
  uso,
  sessoes,
  dias,
  de,
  cotacao,
}: {
  uso: LinhaUso[] | null
  sessoes: SessaoUso[] | null
  dias: number
  de: Date
  cotacao: Cotacao | null
}) {
  const { t, idioma } = useT()
  if (!uso || !sessoes)
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    )
  const tot = totais(uso)
  const agentes = agentesDoPeriodo(uso, sessoes, de)
  const novas = sessoes.filter((s) => new Date(s.inicio) >= de).length
  const porDia = (v: number, f: (n: number) => string) => t("uso.kpi.porDia", { valor: f(v / Math.max(1, dias)) })
  const dica = (k: "sessoes" | "agentes") => (k === "sessoes" ? t("uso.kpi.sessoesDica") : t("uso.kpi.agentesDica"))
  const contagens: { chave: "respostas" | "sessoes" | "agentes"; valor: number; rodape: string }[] = [
    { chave: "respostas", valor: tot.respostas, rodape: porDia(tot.respostas, (n) => fmtNumero(n, idioma, n < 10 ? 1 : 0)) },
    { chave: "sessoes", valor: sessoes.length, rodape: t("uso.kpi.sessoesNovas", { n: fmtNumero(novas, idioma) }) },
    { chave: "agentes", valor: agentes, rodape: porDia(agentes, (n) => fmtNumero(n, idioma, n < 10 ? 1 : 0)) },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 *:data-[slot=card]:shadow-xs md:grid-cols-3 xl:grid-cols-5">
      <Card className="col-span-2 gap-2 md:col-span-1">
        <CardHeader>
          <CardDescription className="flex items-center gap-1">
            {t("uso.kpi.custo")}
            <Tooltip>
              <TooltipTrigger aria-label={t("uso.kpi.custoDica")} className="text-muted-foreground">
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {t("uso.kpi.custoDica")}
                {cotacao ? (
                  <>
                    {" "}
                    {t("uso.kpi.cotacao", { valor: fmtBrl(cotacao.valor, idioma, 4), dia: fmtDia(`${cotacao.dia}T12:00:00`, idioma) })}
                  </>
                ) : null}
              </TooltipContent>
            </Tooltip>
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{fmtUsd(tot.usd, idioma, 0)}</CardTitle>
          {cotacao ? (
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("uso.kpi.emReal", { valor: fmtBrl(tot.usd * cotacao.valor, idioma) })}
            </p>
          ) : null}
        </CardHeader>
        <CardFooter className="text-xs text-muted-foreground">
          {porDia(tot.usd, (v) =>
            cotacao ? `${fmtUsd(v, idioma)} · ${fmtBrl(v * cotacao.valor, idioma)}` : fmtUsd(v, idioma)
          )}
        </CardFooter>
      </Card>
      <Card className="col-span-2 gap-2 md:col-span-1">
        <CardHeader>
          <CardDescription>{t("uso.kpi.tokens")}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{fmtTokens(tot.tokens, idioma)}</CardTitle>
        </CardHeader>
        <CardFooter className="text-xs text-muted-foreground">
          {t("uso.kpi.tokensDetalhe", {
            entrada: fmtTokens(tot.entrada, idioma),
            saida: fmtTokens(tot.saida, idioma),
            escrita: fmtTokens(tot.cacheEscrita, idioma),
            leitura: fmtTokens(tot.cacheLeitura, idioma),
          })}
        </CardFooter>
      </Card>
      {contagens.map(({ chave, valor, rodape }) => (
        <Card key={chave} className="gap-2">
          <CardHeader>
            <CardDescription className="flex items-center gap-1">
              {t(`uso.kpi.${chave}`)}
              {chave !== "respostas" ? (
                <Tooltip>
                  <TooltipTrigger aria-label={dica(chave)} className="text-muted-foreground">
                    <InfoIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{dica(chave)}</TooltipContent>
                </Tooltip>
              ) : null}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              <NumeroAnimado valor={valor} />
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">{rodape}</CardFooter>
        </Card>
      ))}
    </div>
  )
}

const ICONE_LEITURA: Record<Leitura["tipo"], LucideIcon> = {
  tendencia: TrendingUpIcon,
  cache: DatabaseIcon,
  longas: CalendarClockIcon,
  curtas: RepeatIcon,
  modelo: BotIcon,
  projeto: FolderIcon,
  pico: ActivityIcon,
  horario: ClockIcon,
}

function Leituras({
  uso,
  sessoes,
  anterior,
  de,
  agora,
  diasPeriodo,
  cotacao,
}: {
  uso: LinhaUso[] | null
  sessoes: SessaoUso[] | null
  anterior: LinhaUso[] | null
  de: Date
  agora: Date
  diasPeriodo: number
  cotacao: Cotacao | null
}) {
  const { t, idioma } = useT()
  const lista = React.useMemo(
    () => (uso && sessoes ? leituras({ uso, sessoes, anterior, de, agora, diasPeriodo }) : null),
    [uso, sessoes, anterior, de, agora, diasPeriodo]
  )
  if (lista && lista.length === 0) return null
  const dinheiro = (v: number) => (cotacao ? `${fmtUsd(v, idioma, 0)} (${fmtBrl(v * cotacao.valor, idioma)})` : fmtUsd(v, idioma, 0))
  const pct = (f: number) => fmtPct(f * 100, idioma)
  const dias = t("uso.calor.dias").split(",")
  const texto = (l: Leitura): string => {
    switch (l.tipo) {
      case "tendencia":
        return t(l.variacao > 0 ? "uso.leituras.tendenciaMais" : "uso.leituras.tendenciaMenos", {
          pct: pct(Math.abs(l.variacao)),
          n: l.dias,
        })
      case "cache":
        return t("uso.leituras.cache", { pct: pct(l.fatia) })
      case "longas":
        return t("uso.leituras.longas", { n: l.n, dias: l.maisAntiga, valor: dinheiro(l.usd) })
      case "curtas":
        return t("uso.leituras.curtas", { n: fmtNumero(l.n, idioma), pct: pct(l.fatia) })
      case "modelo":
        return t("uso.leituras.modelo", { modelo: l.modelo, pct: pct(l.fatia) })
      case "projeto":
        return t("uso.leituras.projeto", { projeto: l.projeto, pct: pct(l.fatia) })
      case "pico":
        return t("uso.leituras.pico", {
          dia: fmtDia(`${l.dia}T12:00:00`, idioma),
          valor: dinheiro(l.usd),
          respostas: fmtNumero(l.respostas, idioma),
        })
      case "horario":
        return t("uso.leituras.horario", { dia: dias[l.diaSemana], hora: l.hora })
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uso.leituras.titulo")}</CardTitle>
        <CardDescription>{t("uso.leituras.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!lista ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {lista.map((l) => {
              const Icone = l.tipo === "tendencia" && l.variacao < 0 ? TrendingDownIcon : ICONE_LEITURA[l.tipo]
              return (
                <li key={l.tipo} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icone className="size-4" />
                  </span>
                  <span className="leading-relaxed">{texto(l)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function GraficoPorDia({
  estado,
  uso,
  dias,
  metrica,
  formatar,
}: {
  estado: Instantaneo
  uso: LinhaUso[] | null
  dias: string[]
  metrica: Metrica
  formatar: (v: number) => string
}) {
  const { t, idioma } = useT()
  const { dados, series, config } = React.useMemo(() => {
    if (!uso) return { dados: [], series: [] as { chave: string; contaId: string }[], config: {} as ChartConfig }
    const volume = new Map<string, number>()
    for (const l of uso) if (l.contaId) volume.set(l.contaId, (volume.get(l.contaId) ?? 0) + l.usd)
    const mapa = seriesPorConta([...volume.entries()].map(([id, v]) => ({ id, volume: v })))
    const chaves = new Map<string, string>()
    const series: { chave: string; contaId: string }[] = []
    const config: ChartConfig = {}
    // a ordem das camadas segue a prioridade (estável), não o volume, com as contas do mesmo workspace juntas
    const ordem = juntasPorWorkspace(estado.contas)
    for (const c of ordem) {
      const s = mapa.get(c.id)
      if (!s || s === "outras") continue
      const chave = `c${series.length}`
      chaves.set(c.id, chave)
      series.push({ chave, contaId: c.id })
      // as contas do mesmo workspace na mesma cor, cada uma num tom
      config[chave] = { label: c.email, color: corConta(c.cor, c.tom) }
    }
    if ([...mapa.values()].includes("outras") || uso.some((l) => !l.contaId)) {
      series.push({ chave: "outras", contaId: "outras" })
      config.outras = { label: t("comum.outras"), color: COR_OUTRAS }
    }
    const { dados } = porDia(uso, "conta", metrica, dias, (g) => chaves.get(g) ?? "outras")
    return { dados, series, config }
  }, [uso, estado.contas, dias, metrica, t])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("uso.porDia.titulo")}</CardTitle>
        <CardDescription>{t("uso.porDia.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {!uso ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
            <BarChart data={dados} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="dia"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={(v) => fmtDia(`${v}T12:00:00`, idioma)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={68}
                tickFormatter={(v) => (metrica === "usd" ? fmtUsd(Number(v), idioma, 0) : formatar(Number(v)))}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) => fmtDia(`${v}T12:00:00`, idioma)}
                    formatter={(valor, nome) => (
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2 shrink-0 rounded-[2px]"
                            style={{ background: `var(--color-${String(nome)})` }}
                          />
                          <span className="truncate">{config[String(nome)]?.label}</span>
                        </span>
                        <span className="font-mono font-medium tabular-nums">{formatar(Number(valor))}</span>
                      </div>
                    )}
                  />
                }
              />
              {series.map((s, i) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  stackId="uso"
                  fill={`var(--color-${s.chave})`}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground sm:px-0">
          {series.map((s) => (
            <li key={s.chave} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[3px]"
                style={{ background: String(config[s.chave]?.color) }}
                aria-hidden
              />
              {config[s.chave]?.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Ranking({
  estado,
  uso,
  metrica,
  formatar,
}: {
  estado: Instantaneo
  uso: LinhaUso[] | null
  metrica: Metrica
  formatar: (v: number) => string
}) {
  const { t, idioma } = useT()
  const [dimensao, setDimensao] = React.useState<Dimensao>("conta")
  const itens = React.useMemo(
    () => (uso ? ranking(uso, dimensao, metrica).slice(0, 8) : null),
    [uso, dimensao, metrica]
  )
  const maior = itens?.[0]?.valor ?? 0
  const rotulo = (g: string) => {
    if (dimensao === "conta") return estado.contas.find((c) => c.id === g)
    if (dimensao === "computador") return estado.computadores.find((c) => c.id === g)?.nome ?? g
    if (dimensao === "projeto" && g === "sem_projeto") return t("comum.semProjeto")
    return g
  }
  return (
    <Card>
      <CardHeader className="max-sm:grid-cols-1">
        <CardTitle>{t("uso.ranking.titulo")}</CardTitle>
        <CardAction className="col-span-full col-start-1 row-start-2 mt-2 justify-self-stretch sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0">
          <Tabs value={dimensao} onValueChange={(v) => setDimensao(v as Dimensao)}>
            <TabsList className="w-full sm:w-auto">
              {(["conta", "modelo", "projeto", "computador"] as const).map((d) => (
                <TabsTrigger key={d} value={d} className="text-xs">
                  {t(`uso.ranking.dimensoes.${d}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!itens ? (
          <Skeleton className="h-56 w-full" />
        ) : itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("uso.ranking.nenhum")}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {itens.map((it) => {
              const r = rotulo(it.grupo)
              const conta = typeof r === "object" ? r : undefined
              return (
                <li key={it.grupo} className="flex flex-col gap-1">
                  <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                    {conta ? (
                      <NomeConta conta={conta} />
                    ) : (
                      <span className="truncate">{typeof r === "string" ? r : t("comum.semConta")}</span>
                    )}
                    <span className="shrink-0 tabular-nums">
                      <span className="font-medium">{formatar(it.valor)}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {new Intl.NumberFormat(idioma, { style: "percent", maximumFractionDigits: 0 }).format(it.fatia)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${maior ? (it.valor / maior) * 100 : 0}%`,
                        background: conta ? corConta(conta.cor) : "var(--calor)",
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function SessoesPorDia({ sessoes, uso, dias }: { sessoes: SessaoUso[] | null; uso: LinhaUso[] | null; dias: string[] }) {
  const { t, idioma } = useT()
  const dados = React.useMemo(() => (sessoes && uso ? sessoesPorDia(sessoes, uso, dias) : []), [sessoes, uso, dias])
  const config = {
    sessoes: { label: t("uso.sessoesDia.sessoes"), color: "var(--calor)" },
    agentes: { label: t("uso.sessoesDia.agentes"), color: "var(--calor)" },
  } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uso.sessoesDia.titulo")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-2 sm:grid-cols-2 sm:px-6">
        {(["sessoes", "agentes"] as const).map((k) => (
          <div key={k} className="min-w-0">
            <p className="mb-1 px-2 text-xs text-muted-foreground sm:px-0">{config[k].label}</p>
            {!sessoes || !uso ? (
              <Skeleton className="h-[160px] w-full" />
            ) : (
              <ChartContainer config={config} className="aspect-auto h-[160px] w-full">
                <BarChart data={dados} margin={{ left: 0, right: 0, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="dia"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    minTickGap={28}
                    tickFormatter={(v) => fmtDia(`${v}T12:00:00`, idioma)}
                  />
                  <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                    content={
                      <ChartTooltipContent hideIndicator labelFormatter={(v) => fmtDia(`${v}T12:00:00`, idioma)} />
                    }
                  />
                  <Bar dataKey={k} fill={`var(--color-${k})`} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MapaCalor({
  uso,
  metrica,
  formatar,
}: {
  uso: LinhaUso[] | null
  metrica: Metrica
  formatar: (v: number) => string
}) {
  const { t } = useT()
  const [foco, setFoco] = React.useState<{ d: number; h: number } | null>(null)
  const [tabela, setTabela] = React.useState(false)
  const matriz = React.useMemo(() => (uso ? mapaCalor(uso, metrica) : null), [uso, metrica])
  const maior = matriz ? Math.max(...matriz.flat(), 0) : 0
  const dias = t("uso.calor.dias").split(",")
  const leitura =
    foco && matriz
      ? t("uso.calor.celula", { dia: dias[foco.d], hora: foco.h, valor: formatar(matriz[foco.d][foco.h]) })
      : " "
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uso.calor.titulo")}</CardTitle>
        <CardDescription>{t("uso.calor.descricao")}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => setTabela((v) => !v)}>
            {tabela ? t("comum.grafico") : t("comum.tabela")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!matriz ? (
          <Skeleton className="h-48 w-full" />
        ) : tabela ? (
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  {dias.map((d) => (
                    <TableHead key={d} className="text-right">
                      {d}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell className="text-muted-foreground">{String(h).padStart(2, "0")}h</TableCell>
                    {dias.map((_, d) => (
                      <TableCell key={d} className="text-right tabular-nums">
                        {matriz[d][h] ? formatar(matriz[d][h]) : "–"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="h-5 text-sm tabular-nums" aria-live="polite">
              {leitura}
            </p>
            <div
              className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-[2px]"
              onMouseLeave={() => setFoco(null)}
            >
              {matriz.map((linha, d) => (
                <React.Fragment key={d}>
                  <span className="self-center pr-1 text-[11px] leading-none text-muted-foreground">{dias[d]}</span>
                  {linha.map((v, h) => (
                    <span
                      key={h}
                      aria-hidden
                      onMouseEnter={() => setFoco({ d, h })}
                      onClick={() => setFoco({ d, h })}
                      className={cn(
                        "aspect-square min-h-2.5 rounded-[3px]",
                        foco?.d === d && foco?.h === h && "ring-2 ring-foreground ring-offset-1 ring-offset-card"
                      )}
                      style={{
                        background:
                          v > 0
                            ? `color-mix(in oklab, var(--calor) ${Math.round(12 + (v / maior) * 88)}%, var(--muted))`
                            : "var(--muted)",
                      }}
                    />
                  ))}
                </React.Fragment>
              ))}
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="text-center text-[10px] text-muted-foreground">
                  {h % 6 === 0 ? h : ""}
                </span>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              {t("uso.calor.menos")}
              <span className="h-2 w-24 rounded-full bg-[linear-gradient(in_oklab_to_right,var(--muted),var(--calor))]" />
              {t("uso.calor.mais")}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PrevisaoEsgotar({
  estado,
  historico,
  agora,
}: {
  estado: Instantaneo
  historico: import("@/dados/tipos").PontoHistorico[] | null
  agora: Date
}) {
  const { t, idioma } = useT()
  const previsoes = usePrevisoes(estado, historico, agora)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uso.previsao.titulo")}</CardTitle>
        <CardDescription>{t("uso.previsao.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!historico ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ul className="divide-y">
            {estado.contas.map((c) => {
              const prev = previsoes.get(c.id)
              const v = cheia(c, agora)
              const esgotada = v !== null && v >= 100
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <NomeConta conta={c} />
                  <span className="shrink-0 max-sm:pl-[18px] sm:text-right">
                    {esgotada ? (
                      <Badge variant="outline" className="border-erro-borda bg-erro-fundo text-erro">
                        {t("uso.previsao.esgotada")}
                      </Badge>
                    ) : p5(c, agora) === null && p7(c, agora) === null ? (
                      <span className="text-muted-foreground">{t("uso.previsao.semDado")}</span>
                    ) : prev ? (
                      <span className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
                        <span className="font-medium text-atencao tabular-nums">
                          {fmtFuturo(prev.em, agora, idioma)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t(prev.janela === "cinco_horas" ? "janela.five_hour" : "janela.seven_day")}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("uso.previsao.nao")}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SessoesCaras({ estado, sessoes, agora }: { estado: Instantaneo; sessoes: SessaoUso[] | null; agora: Date }) {
  const { t, idioma } = useT()
  const lista = React.useMemo(
    () => (sessoes ? [...sessoes].sort((a, b) => b.usd - a.usd).slice(0, 8) : null),
    [sessoes]
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uso.sessoes.titulo")}</CardTitle>
        <CardDescription>{t("uso.sessoes.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {!lista ? (
          <Skeleton className="mx-6 h-48" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t("uso.sessoes.projeto")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("uso.sessoes.computador")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("uso.sessoes.inicio")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("uso.sessoes.duracao")}</TableHead>
                <TableHead className="text-right">{t("uso.sessoes.agentes")}</TableHead>
                <TableHead className="pr-6 text-right">{t("uso.sessoes.custo")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((s) => {
                const pc = estado.computadores.find((c) => c.id === s.computadorId)
                const contas = s.contas.map((id) => estado.contas.find((c) => c.id === id)).filter(Boolean)
                const dur = ((s.fim ? new Date(s.fim) : agora).getTime() - new Date(s.inicio).getTime()) / 1000
                return (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-48 pl-6">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex -space-x-0.5">
                          {contas.map((c) => (
                            <PontoConta key={c!.id} cor={c!.cor} tom={c!.tom} />
                          ))}
                        </span>
                        <span className="truncate font-medium">{s.projeto || t("comum.semProjeto")}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.fim ? null : <span className="text-ok">{t("uso.sessoes.aberta")} · </span>}
                        {s.paradaNoLimite ? <span className="text-atencao">{t("uso.sessoes.parada")}</span> : null}
                        <span className="sm:hidden">{pc?.nome}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{pc?.nome}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {fmtDataHora(s.inicio, agora, idioma)}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">{fmtDuracao(dur, idioma)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.agentes}</TableCell>
                    <TableCell className="pr-6 text-right font-medium tabular-nums">{fmtUsd(s.usd, idioma)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
