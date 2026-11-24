// Os números por empresa e projeto (0.17.0), na tela de Uso desde a 0.20.0: a tela Empresas ficou só com o cadastro.
// A classificação é feita na leitura (lib/empresas), então mudar uma regra reorganiza também o passado. Gráfico
// adaptado do "chart-bar-stacked" do shadcn/ui, como o da tela de Uso.

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { FolderKanbanIcon } from "lucide-react"
import { NomeConta } from "@/components/painel/conta"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAgora, useConsulta, useEstado } from "@/dados/contexto"
import type { DadosEmpresas, Empresa, Instantaneo, LinhaUso, SessaoUso, TrocaUso } from "@/dados/tipos"
import { useT } from "@/i18n"
import { COR_OUTRAS, corConta } from "@/lib/cores"
import { SEM_DONO, criarClassificador, numerosPorEmpresa, porPeriodoEmpresa, trocasPorEmpresa, nomeUnidade, ordenarUnidades, subirAEmpresa, type Classificar, type NumerosEmpresa } from "@/lib/empresas"
import { fmtDia, fmtNumero, fmtTokens, fmtUsd } from "@/lib/formato"
import { diasEntre, type Metrica } from "@/lib/uso"

const PERIODOS = ["7", "30", "90"] as const
const NENHUM: Classificar = () => null

function Ponto({ cor }: { cor: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: cor }} />
}

/** O nome e a cor de cada grupo do uso (uma empresa, um projeto como "Empresa / Projeto", ou o "sem dono"). */
function useRotulos(empresas: Empresa[]) {
  const { t } = useT()
  return React.useMemo(() => {
    const porId = new Map(empresas.map((e) => [e.id, e]))
    return {
      nome: (id: string) => {
        if (id === SEM_DONO) return t("empresas.semDono")
        const e = porId.get(id)
        return e ? nomeUnidade(e, empresas) : id
      },
      cor: (id: string) => {
        const e = porId.get(id)
        return e ? corConta(e.cor) : COR_OUTRAS
      },
    }
  }, [empresas, t])
}

/** Os números por empresa e projeto, na tela de Uso. Sem empresa cadastrada, não aparece. */
export function UsoPorEmpresa() {
  const { t, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const [periodo, setPeriodo] = React.useState<(typeof PERIODOS)[number]>("30")
  const [agrupar, setAgrupar] = React.useState<"dia" | "semana">("dia")
  const [metrica, setMetrica] = React.useState<Metrica>("usd")
  const [somarProjetos, setSomarProjetos] = React.useState(false)
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
  const cadastro = useConsulta((f) => f.empresas(), [])
  const uso = useConsulta((f) => f.uso(intervalo), [intervalo])
  const sessoes = useConsulta((f) => f.sessoes(intervalo), [intervalo])
  const trocas = useConsulta((f) => f.trocas(intervalo), [intervalo])
  const dias = React.useMemo(() => diasEntre(intervalo.de, agora), [intervalo, agora])
  const dados = cadastro.dados
  const classificar = React.useMemo(() => (dados ? criarClassificador(dados) : NENHUM), [dados])
  const temProjetos = !!dados?.empresas.some((e) => e.pai)
  const formatar = React.useCallback(
    (v: number) =>
      metrica === "usd"
        ? fmtUsd(v, idioma, v >= 100 ? 0 : 2)
        : metrica === "tokens"
          ? fmtTokens(v, idioma)
          : fmtNumero(v, idioma),
    [metrica, idioma]
  )
  if (!dados || dados.empresas.length === 0) return null

  const grupo = (rotulo: string, valor: string, mudar: (v: string) => void, itens: [string, string][]) => (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <ToggleGroup type="single" variant="outline" size="sm" value={valor} onValueChange={(v) => v && mudar(v)}>
        {itens.map(([v, texto]) => (
          <ToggleGroupItem key={v} value={v}>
            {texto}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t("empresas.op.numeros")}</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {grupo(t("uso.periodo"), periodo, (v) => setPeriodo(v as typeof periodo), PERIODOS.map((p) => [p, t("uso.dias", { n: p })]))}
        {grupo(t("empresas.verPor"), agrupar, (v) => setAgrupar(v as typeof agrupar), [
          ["dia", t("empresas.dia")],
          ["semana", t("empresas.semana")],
        ])}
        {temProjetos
          ? grupo(t("empresas.projetos.numerosPor"), somarProjetos ? "empresa" : "projeto", (v) => setSomarProjetos(v === "empresa"), [
              ["projeto", t("empresas.projetos.porProjeto")],
              ["empresa", t("empresas.projetos.porEmpresa")],
            ])
          : null}
        {grupo(t("uso.metrica"), metrica, (v) => setMetrica(v as Metrica), (["usd", "tokens", "respostas"] as const).map((m) => [m, t(`uso.metricas.${m}`)]))}
      </div>
      <AbaNumeros
        estado={estado}
        dados={dados}
        uso={uso.dados}
        sessoes={sessoes.dados}
        trocas={trocas.dados}
        classificar={classificar}
        dias={dias}
        agrupar={agrupar}
        metrica={metrica}
        formatar={formatar}
        somarProjetos={somarProjetos && temProjetos}
      />
    </section>
  )
}

function AbaNumeros({
  estado,
  dados,
  uso,
  sessoes,
  trocas,
  classificar,
  dias,
  agrupar,
  metrica,
  formatar,
  somarProjetos,
}: {
  estado: Instantaneo
  dados: DadosEmpresas | null
  uso: LinhaUso[] | null
  sessoes: SessaoUso[] | null
  trocas: TrocaUso[] | null
  classificar: Classificar
  dias: string[]
  agrupar: "dia" | "semana"
  metrica: Metrica
  formatar: (v: number) => string
  /** 0.19.0: os projetos somados na empresa deles (sem isso, cada projeto tem o próprio cartão, logo abaixo dela). */
  somarProjetos: boolean
}) {
  const { t, tn } = useT()
  const empresas = React.useMemo(() => ordenarUnidades(dados?.empresas ?? []), [dados])
  const rotulos = useRotulos(empresas)
  const ver = React.useMemo(
    () => (somarProjetos ? subirAEmpresa(classificar, empresas) : classificar),
    [somarProjetos, classificar, empresas]
  )
  const numeros = React.useMemo(
    () => (uso && sessoes ? numerosPorEmpresa(uso, sessoes, ver) : null),
    [uso, sessoes, ver]
  )
  // somando os projetos, a marca de uma conta num projeto conta para a empresa dele (uma vez só)
  const marcas = React.useMemo(() => {
    if (!dados) return []
    if (!somarProjetos) return dados.marcas
    const pai = new Map(empresas.filter((e) => e.pai).map((e) => [e.id, e.pai as string]))
    const vistas = new Set<string>()
    return dados.marcas
      .map((m) => ({ contaId: m.contaId, empresaId: pai.get(m.empresaId) ?? m.empresaId }))
      .filter((m) => {
        const k = `${m.contaId}:${m.empresaId}`
        if (vistas.has(k)) return false
        vistas.add(k)
        return true
      })
  }, [dados, somarProjetos, empresas])
  const contagem = React.useMemo(
    () => (trocas && dados ? trocasPorEmpresa(trocas, estado.contas, marcas) : null),
    [trocas, dados, estado.contas, marcas]
  )
  // as empresas na ordem do cadastro, cada uma seguida dos projetos dela, e o sem dono por último quando tem uso
  const ordem = React.useMemo(() => {
    const ids = (somarProjetos ? empresas.filter((e) => !e.pai) : empresas).map((e) => e.id)
    if (numeros?.has(SEM_DONO)) ids.push(SEM_DONO)
    return ids
  }, [empresas, numeros, somarProjetos])

  if (!numeros || !dados)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    )

  return (
    <>
      {empresas.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>{t("empresas.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("empresas.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ordem.map((id) => (
          <CartaoEmpresa
            key={id}
            nome={rotulos.nome(id)}
            cor={rotulos.cor(id)}
            n={numeros.get(id) ?? null}
            trocas={id === SEM_DONO ? null : (contagem?.porEmpresa.get(id) ?? 0)}
          />
        ))}
      </div>
      {contagem && contagem.total > 0 ? (
        <p className="text-xs text-muted-foreground">
          {[
            tn("empresas.numeros.trocasTotal", contagem.total),
            contagem.semMarca ? tn("empresas.numeros.trocasSemMarca", contagem.semMarca) : null,
            contagem.semConta ? tn("empresas.numeros.trocasSemConta", contagem.semConta) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          . {t("empresas.numeros.trocasDica")}
        </p>
      ) : null}
      <GraficoEmpresas
        uso={uso}
        classificar={ver}
        rotulos={rotulos}
        ordem={ordem}
        dias={dias}
        agrupar={agrupar}
        metrica={metrica}
        formatar={formatar}
      />
      <Detalhe estado={estado} numeros={numeros} ordem={ordem} rotulos={rotulos} />
    </>
  )
}

function CartaoEmpresa({
  nome,
  cor,
  n,
  trocas,
}: {
  nome: string
  cor: string
  n: NumerosEmpresa | null
  /** null: o sem dono, que não tem conta marcada. */
  trocas: number | null
}) {
  const { t, idioma } = useT()
  const linhas: [string, string][] = n
    ? [
        [t("empresas.numeros.tokens"), fmtTokens(n.tokens, idioma)],
        [t("empresas.numeros.entrada"), fmtTokens(n.entrada, idioma)],
        [t("empresas.numeros.saida"), fmtTokens(n.saida, idioma)],
        [t("empresas.numeros.cache"), fmtTokens(n.cacheEscrita + n.cacheLeitura, idioma)],
        ...(trocas === null ? [] : [[t("empresas.numeros.trocas"), fmtNumero(trocas, idioma)] as [string, string]]),
        [t("empresas.numeros.sessoes"), fmtNumero(n.sessoes, idioma)],
        [t("empresas.numeros.agentes"), fmtNumero(n.agentes, idioma)],
        [t("empresas.numeros.contas"), fmtNumero([...n.contas.keys()].filter(Boolean).length, idioma)],
        [t("empresas.numeros.pastas"), fmtNumero(n.pastas.size, idioma)],
      ]
    : []
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription className="flex min-w-0 items-center gap-2">
          <Ponto cor={cor} />
          <span className="truncate font-medium text-foreground">{nome}</span>
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{fmtUsd(n?.usd ?? 0, idioma)}</CardTitle>
      </CardHeader>
      <CardContent>
        {n ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            {linhas.map(([rotulo, valor]) => (
              <div key={rotulo} className="flex min-w-0 flex-col">
                <dt className="truncate text-xs text-muted-foreground">{rotulo}</dt>
                <dd className="tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("empresas.numeros.semUso")}</p>
        )}
      </CardContent>
      {trocas === null ? (
        <CardFooter className="text-xs text-muted-foreground">{t("empresas.semDonoDica")}</CardFooter>
      ) : null}
    </Card>
  )
}

function GraficoEmpresas({
  uso,
  classificar,
  rotulos,
  ordem,
  dias,
  agrupar,
  metrica,
  formatar,
}: {
  uso: LinhaUso[] | null
  classificar: Classificar
  rotulos: ReturnType<typeof useRotulos>
  ordem: string[]
  dias: string[]
  agrupar: "dia" | "semana"
  metrica: Metrica
  formatar: (v: number) => string
}) {
  const { t, idioma } = useT()
  const { dados, series, config } = React.useMemo(() => {
    if (!uso) return { dados: [], series: [] as string[], config: {} as ChartConfig }
    const r = porPeriodoEmpresa(uso, classificar, dias, agrupar, metrica)
    // a chave da série não pode ter caractere fora de [a-z0-9] (vira variável de CSS): e0, e1...
    const chave = new Map<string, string>()
    const config: ChartConfig = {}
    const presentes = new Set(r.grupos)
    for (const id of ordem.filter((x) => presentes.has(x))) {
      const k = `e${chave.size}`
      chave.set(id, k)
      config[k] = { label: rotulos.nome(id), color: rotulos.cor(id) }
    }
    const linhas = r.dados.map((linha) => {
      const nova: Record<string, number | string> = { dia: linha.dia! }
      for (const [id, k] of chave) nova[k] = linha[id] ?? 0
      return nova
    })
    return { dados: linhas, series: [...chave.values()], config }
  }, [uso, classificar, dias, agrupar, metrica, ordem, rotulos])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("empresas.grafico.titulo")}</CardTitle>
        <CardDescription>
          {agrupar === "dia" ? t("empresas.grafico.descricaoDia") : t("empresas.grafico.descricaoSemana")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {!uso ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
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
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {formatar(Number(valor))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              {series.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="a"
                  fill={`var(--color-${k})`}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

const PASTAS_NO_DETALHE = 6
const CONTAS_NO_DETALHE = 5

/** Onde foi o uso de cada empresa: as contas e as pastas, da maior para a menor. */
function Detalhe({
  estado,
  numeros,
  ordem,
  rotulos,
}: {
  estado: Instantaneo
  numeros: Map<string, NumerosEmpresa>
  ordem: string[]
  rotulos: ReturnType<typeof useRotulos>
}) {
  const { t, tn, idioma } = useT()
  const comUso = ordem.filter((id) => (numeros.get(id)?.usd ?? 0) > 0 || (numeros.get(id)?.tokens ?? 0) > 0)
  if (comUso.length === 0) return null
  const contaPorId = new Map(estado.contas.map((c) => [c.id, c]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("empresas.detalhe.titulo")}</CardTitle>
        <CardDescription>{t("empresas.detalhe.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {comUso.map((id) => {
          const n = numeros.get(id)!
          const contas = [...n.contas.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, CONTAS_NO_DETALHE)
          const pastas = [...n.pastas.entries()].sort((a, b) => b[1].usd - a[1].usd)
          return (
            <section key={id} className="flex flex-col gap-2">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <Ponto cor={rotulos.cor(id)} />
                <span className="truncate">{rotulos.nome(id)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                  {fmtUsd(n.usd, idioma)}
                </span>
              </h4>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("empresas.detalhe.contas")}</span>
                  <ul className="flex flex-col gap-1 text-sm">
                    {contas.map(([contaId, v]) => {
                      const c = contaId ? contaPorId.get(contaId) : undefined
                      return (
                        <li key={contaId ?? "sem"} className="flex items-center justify-between gap-3">
                          {c ? (
                            <NomeConta conta={c} className="min-w-0" />
                          ) : (
                            <span className="text-muted-foreground">{t("empresas.detalhe.semConta")}</span>
                          )}
                          <span className="shrink-0 font-mono text-xs tabular-nums">{fmtUsd(v.usd, idioma)}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("empresas.detalhe.pastas")}</span>
                  <ul className="flex flex-col gap-1 text-sm">
                    {pastas.slice(0, PASTAS_NO_DETALHE).map(([chave, p]) => (
                      <li key={chave} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-mono text-xs" title={p.pasta || p.projeto}>
                          {p.pasta || t("empresas.pastas.semPasta", { projeto: p.projeto })}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums">{fmtUsd(p.usd, idioma)}</span>
                      </li>
                    ))}
                    {pastas.length > PASTAS_NO_DETALHE ? (
                      <li className="text-xs text-muted-foreground">
                        {tn("empresas.detalhe.maisPastas", pastas.length - PASTAS_NO_DETALHE)}
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}
