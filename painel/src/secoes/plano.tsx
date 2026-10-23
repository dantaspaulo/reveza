// Plano da semana: a cota semanal de cada conta dividida pelos dias, quanto já foi, o ritmo e o uso de cada dia
// (barras do shadcn/ui charts com a linha da cota diária).

import * as React from "react"
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts"
import { InfoIcon } from "lucide-react"

import { NomeConta } from "@/components/painel/conta"
import { Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { useAgora, useConsulta, useEstado } from "@/dados/contexto"
import { janela, p7, pctJanela } from "@/dados/derivados"
import type { Conta, PontoHistorico } from "@/dados/tipos"
import { useT } from "@/i18n"
import { corConta } from "@/lib/cores"
import { fmtDataHora, fmtDiaSemana, fmtFuturo, fmtNumero, fmtPct } from "@/lib/formato"
import { DIA_MS, planoSemana, usoPorDia, type Ritmo } from "@/lib/plano"
import { cn } from "@/lib/utils"

const TOM: Record<Ritmo, string> = {
  abaixo: "border-border text-muted-foreground",
  no_ritmo: "border-ok/30 bg-ok-fundo text-ok",
  acima: "border-atencao-borda bg-atencao-fundo text-atencao",
  esgotada: "border-erro-borda bg-erro-fundo text-erro",
  sem_dado: "border-border text-muted-foreground",
}

export default function Plano() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const historico = useConsulta((f) => f.historico(new Date(Date.now() - 8 * DIA_MS)), [])
  const contas = [...estado.contas].sort((a, b) => a.prioridade - b.prioridade)
  return (
    <Pagina titulo={t("menu.secoes.plano")} descricao={t("plano.descricao")}>
      <Alert>
        <InfoIcon />
        <AlertDescription>{t("plano.dicaRitmo")}</AlertDescription>
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        {contas.map((c) => (
          <CartaoPlano key={c.id} conta={c} agora={agora} historico={historico.dados} />
        ))}
      </div>
    </Pagina>
  )
}

function CartaoPlano({ conta, agora, historico }: { conta: Conta; agora: Date; historico: PontoHistorico[] | null }) {
  const { t, idioma } = useT()
  // sem a semana geral (a Anthropic deixou de informar em várias contas, 22/10/2026), a semana do Fable, quando houver
  const geral = janela(conta, "seven_day")
  const fable = geral ? undefined : janela(conta, "seven_day_fable")
  const j = geral ?? fable
  const pctSemana = geral ? p7(conta, agora) : fable ? pctJanela(conta, "seven_day_fable", agora) : null
  const plano = planoSemana({ p7: pctSemana, resetEm: j?.resetEm ?? null, agora, teto: geral ? conta.tetoSemana : null })
  const ritmo: Ritmo = plano?.ritmo ?? "sem_dado"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="min-w-0">
          <NomeConta conta={conta} />
        </CardTitle>
        <CardDescription>
          {plano
            ? t("plano.renova", {
                quando: `${fmtDataHora(plano.reset, agora, idioma)} (${fmtFuturo(plano.reset, agora, idioma)})`,
              })
            : null}
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn(TOM[ritmo])}>
            {!plano && conta.lidoEm ? t("plano.semSemanaSelo") : t(`plano.ritmo.${ritmo}`)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!plano ? (
          <p className="text-sm text-muted-foreground">{conta.lidoEm ? t("plano.semSemana") : t("plano.semLeitura")}</p>
        ) : (
          <>
            {fable ? <p className="text-xs text-muted-foreground">{t("plano.soFable")}</p> : null}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-semibold tabular-nums">{fmtPct(plano.usado, idioma)}</span>
                <span className="text-sm text-muted-foreground">
                  {t("plano.usado", { usado: fmtPct(plano.usado, idioma), limite: fmtPct(plano.limite, idioma) })}
                  {conta.tetoSemana != null ? ` · ${t("plano.teto", { pct: fmtPct(conta.tetoSemana, idioma) })}` : ""}
                </span>
              </div>
              <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (plano.usado / plano.limite) * 100)}%`,
                    background: plano.ritmo === "esgotada" ? "var(--erro-barra)" : corConta(conta.cor),
                  }}
                />
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-0.5 bg-foreground/70"
                  style={{ left: `${Math.min(100, (plano.esperadoAgora / plano.limite) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("plano.esperado", { pct: fmtPct(plano.esperadoAgora, idioma, 1) })}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-2.5">
                <dt className="text-xs text-muted-foreground">{t("plano.cotaDia")}</dt>
                <dd className="font-medium tabular-nums">{fmtPct(plano.cotaDia, idioma, 1)}</dd>
              </div>
              <div className="rounded-lg border p-2.5">
                <dt className="text-xs text-muted-foreground">{t("plano.porDia")}</dt>
                <dd className="font-medium tabular-nums">
                  {t("plano.porDiaTexto", {
                    pct: fmtPct(plano.porDiaRestante, idioma, 1),
                    dias: `${fmtNumero(plano.diasRestantes, idioma, 1)} ${t("comum.dias")}`,
                  })}
                </dd>
              </div>
            </dl>
            {plano.esgotaEm ? (
              <p className="text-sm text-atencao">
                {t("plano.esgotaAntes", { quando: fmtDataHora(plano.esgotaEm, agora, idioma) })}
              </p>
            ) : plano.ritmo !== "esgotada" ? (
              <p className="text-sm text-muted-foreground">
                {t("plano.folga", { pct: fmtPct(plano.limite - plano.usado, idioma) })}
              </p>
            ) : null}
            {/* o histórico guarda a semana geral: com a do Fable, não há uso por dia para mostrar */}
            {geral ? (
              <DiasDaSemana
                conta={conta}
                historico={historico}
                inicio={plano.inicio}
                cota={plano.cotaDia}
                agora={agora}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function DiasDaSemana({
  conta,
  historico,
  inicio,
  cota,
  agora,
}: {
  conta: Conta
  historico: PontoHistorico[] | null
  inicio: Date
  cota: number
  agora: Date
}) {
  const { t, idioma } = useT()
  const dados = React.useMemo(() => {
    if (!historico) return null
    const valores = usoPorDia(
      historico.filter((p) => p.contaId === conta.id),
      inicio
    )
    return valores.map((v, i) => {
      const dia = new Date(inicio.getTime() + i * DIA_MS)
      return { dia: fmtDiaSemana(dia, idioma), uso: v, futuro: dia.getTime() > agora.getTime() }
    })
  }, [historico, conta.id, inicio, idioma, agora])
  const config = { uso: { label: t("plano.diasGrafico"), color: corConta(conta.cor) } } satisfies ChartConfig
  if (!dados) return <Skeleton className="h-28 w-full" />
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{t("plano.diasGrafico")}</p>
      <ChartContainer config={config} className="aspect-auto h-28 w-full">
        <BarChart data={dados} margin={{ top: 6, left: 0, right: 0 }}>
          <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={6} />
          <YAxis hide domain={[0, Math.max(cota * 1.3, ...dados.map((d) => d.uso * 1.1))]} />
          <ReferenceLine
            y={cota}
            stroke="var(--foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
            label={{
              value: t("plano.cotaLinha"),
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={
              <ChartTooltipContent
                formatter={(v) => <span className="font-mono tabular-nums">{fmtPct(Number(v), idioma, 1)}</span>}
              />
            }
          />
          <Bar dataKey="uso" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {dados.map((d, i) => (
              <Cell key={i} fill="var(--color-uso)" fillOpacity={d.futuro ? 0.25 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}
