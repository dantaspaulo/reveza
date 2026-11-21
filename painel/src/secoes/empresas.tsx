// Empresas (0.17.0): o uso separado por empresa ou projeto. As empresas, as marcas das contas e as regras das pastas
// são dado de cada instalação, guardado na nuvem dela e escolhido aqui; a classificação é feita na leitura
// (lib/empresas), então mudar uma regra reorganiza também o passado. Nesta versão nada muda na troca: as marcas e o
// transbordo ficam gravados para a escolha de conta por empresa, que vem depois. Gráfico adaptado do
// "chart-bar-stacked" do shadcn/ui, como o da tela de Uso.

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Building2Icon, InfoIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Confirmar } from "@/components/painel/confirmar"
import { NomeConta } from "@/components/painel/conta"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAcao, useAgora, useConsulta, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { ErroPainel } from "@/dados/fonte"
import type {
  Conta,
  DadosEmpresas,
  Empresa,
  Instantaneo,
  LinhaUso,
  RegraPasta,
  SessaoUso,
  Transbordo,
  TrocaUso,
} from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { COR_OUTRAS, N_CORES, corConta } from "@/lib/cores"
import {
  SEM_DONO,
  contasPorEmpresa,
  criarClassificador,
  numerosPorEmpresa,
  pastaAmpla,
  pastasSemDono,
  porPeriodoEmpresa,
  sugestaoPorDominio,
  trocasPorEmpresa,
  type Classificar,
  type NumerosEmpresa,
} from "@/lib/empresas"
import { fmtDia, fmtNumero, fmtTokens, fmtUsd } from "@/lib/formato"
import { diasEntre, type Metrica } from "@/lib/uso"

const PERIODOS = ["7", "30", "90"] as const
const NENHUM: Classificar = () => null

type T = ReturnType<typeof useT>

/** O nome e a cor de cada grupo do uso (uma empresa ou o "sem dono"). */
function useRotulos(empresas: Empresa[]) {
  const { t } = useT()
  return React.useMemo(() => {
    const porId = new Map(empresas.map((e) => [e.id, e]))
    return {
      nome: (id: string) => (id === SEM_DONO ? t("empresas.semDono") : (porId.get(id)?.nome ?? id)),
      cor: (id: string) => {
        const e = porId.get(id)
        return e ? corConta(e.cor) : COR_OUTRAS
      },
    }
  }, [empresas, t])
}

function Ponto({ cor }: { cor: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: cor }} />
}

export default function Empresas() {
  const { t, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const [periodo, setPeriodo] = React.useState<(typeof PERIODOS)[number]>("30")
  const [agrupar, setAgrupar] = React.useState<"dia" | "semana">("dia")
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
  const cadastro = useConsulta((f) => f.empresas(), [])
  const uso = useConsulta((f) => f.uso(intervalo), [intervalo])
  const sessoes = useConsulta((f) => f.sessoes(intervalo), [intervalo])
  const trocas = useConsulta((f) => f.trocas(intervalo), [intervalo])
  const dias = React.useMemo(() => diasEntre(intervalo.de, agora), [intervalo, agora])

  const dados = cadastro.dados
  const classificar = React.useMemo(() => (dados ? criarClassificador(dados) : NENHUM), [dados])
  const indisponivel = cadastro.erro instanceof ErroPainel && cadastro.erro.codigo === "indisponivel"

  const formatar = React.useCallback(
    (v: number) =>
      metrica === "usd"
        ? fmtUsd(v, idioma, v >= 100 ? 0 : 2)
        : metrica === "tokens"
          ? fmtTokens(v, idioma)
          : fmtNumero(v, idioma),
    [metrica, idioma]
  )

  if (indisponivel)
    return (
      <Pagina titulo={t("menu.secoes.empresas")} descricao={t("empresas.descricao")}>
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("empresas.indisponivel.titulo")}</AlertTitle>
          <AlertDescription>{t("empresas.indisponivel.texto")}</AlertDescription>
        </Alert>
      </Pagina>
    )

  return (
    <Pagina titulo={t("menu.secoes.empresas")} descricao={t("empresas.descricao")}>
      <AvisoPermissao />
      <Alert>
        <InfoIcon />
        <AlertTitle>{t("empresas.aviso.titulo")}</AlertTitle>
        <AlertDescription>{t("empresas.aviso.texto")}</AlertDescription>
      </Alert>

      {dados && dados.empresas.length === 0 ? (
        <Sugestao estado={estado} aoMudar={cadastro.recarregar} />
      ) : null}

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
          <span className="text-sm text-muted-foreground">{t("empresas.verPor")}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={agrupar}
            onValueChange={(v) => v && setAgrupar(v as typeof agrupar)}
          >
            <ToggleGroupItem value="dia">{t("empresas.dia")}</ToggleGroupItem>
            <ToggleGroupItem value="semana">{t("empresas.semana")}</ToggleGroupItem>
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

      <Tabs defaultValue="numeros" className="gap-4">
        <TabsList className="w-full sm:w-auto">
          {(["numeros", "contas", "pastas", "empresas"] as const).map((a) => (
            <TabsTrigger key={a} value={a}>
              {t(`empresas.abas.${a}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="numeros" className="flex flex-col gap-4">
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
          />
        </TabsContent>
        <TabsContent value="contas">
          <AbaContas estado={estado} dados={dados} uso={uso.dados} classificar={classificar} aoMudar={cadastro.recarregar} />
        </TabsContent>
        <TabsContent value="pastas" className="flex flex-col gap-4">
          <AbaPastas estado={estado} dados={dados} uso={uso.dados} classificar={classificar} aoMudar={cadastro.recarregar} />
        </TabsContent>
        <TabsContent value="empresas">
          <AbaCadastro estado={estado} dados={dados} aoMudar={cadastro.recarregar} />
        </TabsContent>
      </Tabs>
    </Pagina>
  )
}

/** A sugestão pelo domínio do e-mail das contas: aparece só sem nenhuma empresa e só cria com o clique. */
function Sugestao({ estado, aoMudar }: { estado: Instantaneo; aoMudar: () => void }) {
  const { t, tn } = useT()
  const { fonte } = useDados()
  const { pode } = usePermissao()
  const acao = useAcao()
  const [ocupado, setOcupado] = React.useState(false)
  const grupos = React.useMemo(() => sugestaoPorDominio(estado.contas), [estado.contas])
  if (grupos.length === 0) return null
  const porId = new Map(estado.contas.map((c) => [c.id, c]))

  const aceitar = async () => {
    setOcupado(true)
    const [ok, n] = await acao(async () => {
      let n = 0
      for (const [i, g] of grupos.entries()) {
        const id = await fonte.salvarEmpresa(null, { nome: g.dominio, cor: i % N_CORES, transbordo: "nenhum" })
        n += 1
        for (const c of g.contas) await fonte.marcarContaEmpresas(c, [id])
      }
      return n
    })
    setOcupado(false)
    if (ok) toast.success(tn("empresas.sugestao.feito", n))
    aoMudar()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("empresas.sugestao.titulo")}
        </CardTitle>
        <CardDescription>{t("empresas.sugestao.texto")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grupos.map((g) => (
          <div key={g.dominio} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{g.dominio}</span>
              <Badge variant="secondary">{tn("empresas.sugestao.contas", g.contas.length)}</Badge>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {g.contas.map((id) => {
                const c = porId.get(id)
                return c ? (
                  <li key={id} className="min-w-0">
                    <NomeConta conta={c} />
                  </li>
                ) : null
              })}
            </ul>
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Button onClick={() => void aceitar()} disabled={!pode || ocupado}>
          {ocupado ? <Spinner /> : null}
          {t("empresas.sugestao.aceitar")}
        </Button>
      </CardFooter>
    </Card>
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
}) {
  const { t, tn } = useT()
  const empresas = React.useMemo(() => dados?.empresas ?? [], [dados])
  const rotulos = useRotulos(empresas)
  const numeros = React.useMemo(
    () => (uso && sessoes ? numerosPorEmpresa(uso, sessoes, classificar) : null),
    [uso, sessoes, classificar]
  )
  const contagem = React.useMemo(
    () => (trocas && dados ? trocasPorEmpresa(trocas, estado.contas, dados.marcas) : null),
    [trocas, dados, estado.contas]
  )
  // as empresas na ordem do cadastro, e o sem dono por último quando tem uso
  const ordem = React.useMemo(() => {
    const ids = empresas.map((e) => e.id)
    if (numeros?.has(SEM_DONO)) ids.push(SEM_DONO)
    return ids
  }, [empresas, numeros])

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
              <Building2Icon />
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
        classificar={classificar}
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

function AbaContas({
  estado,
  dados,
  uso,
  classificar,
  aoMudar,
}: {
  estado: Instantaneo
  dados: DadosEmpresas | null
  uso: LinhaUso[] | null
  classificar: Classificar
  aoMudar: () => void
}) {
  const { t } = useT()
  const empresas = React.useMemo(() => dados?.empresas ?? [], [dados])
  const rotulos = useRotulos(empresas)
  const porConta = React.useMemo(() => (uso ? contasPorEmpresa(uso, classificar) : null), [uso, classificar])
  const marcasDe = React.useMemo(() => {
    const m = new Map<string, string[]>()
    for (const x of dados?.marcas ?? []) m.set(x.contaId, [...(m.get(x.contaId) ?? []), x.empresaId])
    return m
  }, [dados])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("empresas.contas.titulo")}</CardTitle>
        <CardDescription>{t("empresas.contas.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!dados ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {empresas.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">{t("empresas.contas.semEmpresas")}</p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("menu.secoes.contas")}</TableHead>
                  <TableHead>{t("empresas.contas.marcar")}</TableHead>
                  <TableHead>{t("empresas.contas.usoNoPeriodo")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estado.contas.map((c) => {
                  const marcas = (marcasDe.get(c.id) ?? []).slice().sort()
                  return (
                    <LinhaConta
                      // a linha nasce de novo quando a nuvem devolve outras marcas
                      key={`${c.id}:${marcas.join(",")}`}
                      conta={c}
                      marcas={marcas}
                      empresas={empresas}
                      uso={porConta?.get(c.id) ?? null}
                      rotulos={rotulos}
                      aoMudar={aoMudar}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LinhaConta({
  conta,
  marcas,
  empresas,
  uso,
  rotulos,
  aoMudar,
}: {
  conta: Conta
  marcas: string[]
  empresas: Empresa[]
  uso: Map<string, number> | null
  rotulos: ReturnType<typeof useRotulos>
  aoMudar: () => void
}) {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const { pode } = usePermissao()
  const acao = useAcao()
  const [valor, setValor] = React.useState(marcas)
  const [ocupado, setOcupado] = React.useState(false)
  const usos = uso ? [...uso.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : []

  const mudar = async (nova: string[]) => {
    const antes = valor
    setValor(nova)
    setOcupado(true)
    const [ok] = await acao(() => fonte.marcarContaEmpresas(conta.id, nova), t("empresas.contas.salvo"))
    setOcupado(false)
    if (!ok) setValor(antes)
    aoMudar()
  }

  return (
    <TableRow>
      <TableCell className="max-w-64">
        <div className="flex min-w-0 flex-col gap-0.5">
          <NomeConta conta={conta} />
          {conta.saiEm ? <span className="text-xs text-muted-foreground">{t("empresas.contas.saindo")}</span> : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {empresas.length > 0 ? (
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              spacing={1}
              className="flex-wrap"
              value={valor}
              disabled={!pode || ocupado}
              onValueChange={(v) => void mudar(v)}
              aria-label={t("empresas.contas.marcar")}
            >
              {empresas.map((e) => (
                <ToggleGroupItem key={e.id} value={e.id} className="gap-1.5">
                  <Ponto cor={corConta(e.cor)} />
                  {e.nome}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {valor.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("empresas.contas.todas")}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {usos.map(([id, v]) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <Ponto cor={rotulos.cor(id)} />
              <span className="text-muted-foreground">{rotulos.nome(id)}</span>
              <span className="font-mono tabular-nums">{fmtUsd(v, idioma)}</span>
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AbaPastas({
  estado,
  dados,
  uso,
  classificar,
  aoMudar,
}: {
  estado: Instantaneo
  dados: DadosEmpresas | null
  uso: LinhaUso[] | null
  classificar: Classificar
  aoMudar: () => void
}) {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const { pode } = usePermissao()
  const acao = useAcao()
  const nova = useDialogo<string>()
  const [apagar, setApagar] = React.useState<RegraPasta | null>(null)
  const empresas = React.useMemo(() => dados?.empresas ?? [], [dados])
  const rotulos = useRotulos(empresas)
  const agentes = React.useMemo(() => dados?.agentes ?? [], [dados])
  const semDono = React.useMemo(
    () => (uso ? pastasSemDono(uso, classificar, agentes) : null),
    [uso, classificar, agentes]
  )
  const nomePc = (id: string) => estado.computadores.find((c) => c.id === id)?.nome ?? id

  const atribuir = async (padrao: string, empresaId: string) => {
    await acao(() => fonte.salvarRegraPasta("pasta", padrao, empresaId), t("empresas.pastas.atribuido"))
    aoMudar()
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("empresas.pastas.semDonoTitulo")}</CardTitle>
          <CardDescription>{t("empresas.pastas.semDonoDescricao")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!semDono || !dados ? (
            <Skeleton className="h-32 w-full" />
          ) : semDono.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empresas.pastas.semDonoVazio")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("empresas.numeros.pastas")}</TableHead>
                  <TableHead className="text-right">{t("empresas.numeros.custo")}</TableHead>
                  <TableHead>{t("empresas.pastas.empresa")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {semDono.slice(0, 50).map((p) => (
                  <TableRow key={p.chave}>
                    <TableCell className="max-w-[22rem]">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-mono text-xs break-all">
                          {p.pasta || t("empresas.pastas.semPasta", { projeto: p.projeto })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            p.agente ? t("empresas.pastas.agente", { titulo: p.agente.titulo || p.agente.nome }) : null,
                            p.computadores.map(nomePc).join(", "),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmtUsd(p.usd, idioma)}</TableCell>
                    <TableCell>
                      {/* linha de antes (sem pasta) ou pasta larga demais: a regra se escolhe na caixa, não num clique */}
                      {!p.pasta || pastaAmpla(p.pasta) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-44"
                          disabled={!pode || empresas.length === 0}
                          onClick={() => nova.abrir(p.pasta ? "" : p.projeto)}
                        >
                          <PlusIcon />
                          {t("empresas.pastas.criarRegra")}
                        </Button>
                      ) : (
                      <Select
                        disabled={!pode || empresas.length === 0}
                        onValueChange={(v) => void atribuir(p.pasta, v)}
                      >
                        <SelectTrigger size="sm" className="w-44" aria-label={t("empresas.pastas.escolher")}>
                          <SelectValue placeholder={t("empresas.pastas.escolher")} />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              <Ponto cor={corConta(e.cor)} />
                              {e.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("empresas.pastas.regrasTitulo")}</CardTitle>
          <CardDescription>{t("empresas.pastas.regrasDescricao")}</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" disabled={!pode || empresas.length === 0} onClick={() => nova.abrir()}>
              <PlusIcon />
              {t("empresas.pastas.nova")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!dados ? (
            <Skeleton className="h-24 w-full" />
          ) : dados.regras.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empresas.pastas.regrasVazio")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("empresas.pastas.tipo")}</TableHead>
                  <TableHead>{t("empresas.pastas.padrao")}</TableHead>
                  <TableHead>{t("empresas.pastas.empresa")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.regras.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {r.tipo === "titulo" ? t("empresas.pastas.tipoTitulo") : t("empresas.pastas.tipoPasta")}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[20rem] font-mono text-xs break-all">{r.padrao}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Ponto cor={rotulos.cor(r.empresaId)} />
                        {rotulos.nome(r.empresaId)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={!pode}
                        aria-label={t("empresas.pastas.apagar")}
                        onClick={() => setApagar(r)}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("empresas.pastas.agentesTitulo")}</CardTitle>
          <CardDescription>{t("empresas.pastas.agentesDescricao")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!dados ? (
            <Skeleton className="h-24 w-full" />
          ) : agentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empresas.pastas.agentesVazio")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("empresas.pastas.tipoTitulo")}</TableHead>
                  <TableHead>{t("empresas.numeros.pastas")}</TableHead>
                  <TableHead>{t("empresas.pastas.empresaDoAgente")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentes.map((a) => {
                  const nome = a.pasta.split("/").filter(Boolean).pop() ?? ""
                  const e = classificar(a.pasta, nome) ?? SEM_DONO
                  return (
                    <TableRow key={`${a.computadorId}:${a.pasta}`}>
                      <TableCell className="max-w-[16rem]">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm">{a.titulo || a.nome}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[a.titulo ? a.nome : null, nomePc(a.computadorId)].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[18rem] font-mono text-xs break-all">{a.pasta}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Ponto cor={rotulos.cor(e)} />
                          {rotulos.nome(e)}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DialogoRegra
        key={nova.chave}
        aberto={nova.aberto}
        aoFechar={nova.fechar}
        empresas={empresas}
        aoMudar={aoMudar}
        inicial={nova.valor ?? ""}
      />
      <Confirmar
        aberto={apagar !== null}
        aoFechar={() => setApagar(null)}
        titulo={t("empresas.pastas.apagarTitulo")}
        texto={t("empresas.pastas.apagarTexto")}
        botao={t("empresas.pastas.apagarBotao")}
        botaoSegurar={t("empresas.pastas.apagarSegurar")}
        aoConfirmar={async () => {
          if (!apagar) return
          await acao(() => fonte.apagarRegraPasta(apagar.id), t("empresas.pastas.apagada"))
          aoMudar()
        }}
      />
    </>
  )
}

function DialogoRegra({
  aberto,
  aoFechar,
  empresas,
  aoMudar,
  inicial,
}: {
  aberto: boolean
  aoFechar: () => void
  empresas: Empresa[]
  aoMudar: () => void
  /** O padrão já preenchido (o nome do projeto de uma linha sem pasta), para a pessoa conferir antes de criar. */
  inicial: string
}) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const [tipo, setTipo] = React.useState<RegraPasta["tipo"]>("pasta")
  const [padrao, setPadrao] = React.useState(inicial)
  const ampla = tipo === "pasta" && pastaAmpla(padrao)
  const [empresa, setEmpresa] = React.useState(empresas[0]?.id ?? "")
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("empresas.pastas.nova")}</DialogTitle>
          <DialogDescription>{t("empresas.pastas.regrasDescricao")}</DialogDescription>
        </DialogHeader>
        <form
          id="form-regra"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!empresa) return
            setEnviando(true)
            const [ok] = await acao(() => fonte.salvarRegraPasta(tipo, padrao, empresa), t("empresas.pastas.atribuido"))
            setEnviando(false)
            if (!ok) return
            aoMudar()
            aoFechar()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>{t("empresas.pastas.tipo")}</FieldLabel>
              <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as RegraPasta["tipo"])}>
                {(["pasta", "titulo"] as const).map((x) => (
                  <Field key={x} orientation="horizontal">
                    <RadioGroupItem value={x} id={`regra-tipo-${x}`} />
                    <FieldLabel htmlFor={`regra-tipo-${x}`} className="font-normal">
                      {x === "pasta" ? t("empresas.pastas.tipoPasta") : t("empresas.pastas.tipoTitulo")}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="regra-padrao">{t("empresas.pastas.padrao")}</FieldLabel>
              <Input
                id="regra-padrao"
                required
                maxLength={300}
                value={padrao}
                placeholder={tipo === "pasta" ? t("empresas.pastas.padraoDicaPasta") : t("empresas.pastas.padraoDicaTitulo")}
                onChange={(e) => setPadrao(e.target.value)}
                aria-invalid={ampla || undefined}
              />
              {ampla ? <FieldDescription className="text-destructive">{t("empresas.pastas.ampla")}</FieldDescription> : null}
            </Field>
            <Field>
              <FieldLabel>{t("empresas.pastas.empresa")}</FieldLabel>
              <Select value={empresa} onValueChange={setEmpresa}>
                <SelectTrigger aria-label={t("empresas.pastas.empresa")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <Ponto cor={corConta(e.cor)} />
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.cancelar")}
          </Button>
          <Button type="submit" form="form-regra" disabled={enviando || !padrao.trim() || !empresa || ampla}>
            {enviando ? <Spinner /> : null}
            {t("empresas.pastas.criar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function resumoTransbordo(e: Empresa, contas: Pick<Conta, "id">[], tn: T["tn"], t: T["t"]): string {
  if (e.transbordo === "escolhidas") {
    // só as que ainda existem: a conta removida do Reveza fica no cadastro da empresa até a próxima gravação
    const existem = new Set(contas.map((c) => c.id))
    return tn("empresas.cadastro.transbordoResumo.escolhidas", e.transbordoContas.filter((id) => existem.has(id)).length)
  }
  return e.transbordo === "qualquer"
    ? t("empresas.cadastro.transbordoResumo.qualquer")
    : t("empresas.cadastro.transbordoResumo.nenhum")
}

function AbaCadastro({
  estado,
  dados,
  aoMudar,
}: {
  estado: Instantaneo
  dados: DadosEmpresas | null
  aoMudar: () => void
}) {
  const { t, tn } = useT()
  const { fonte } = useDados()
  const { pode } = usePermissao()
  const acao = useAcao()
  const dialogo = useDialogo<Empresa | null>()
  const [apagar, setApagar] = React.useState<Empresa | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("empresas.cadastro.titulo")}</CardTitle>
        <CardDescription>{t("empresas.cadastro.descricao")}</CardDescription>
        <CardAction>
          <Button size="sm" disabled={!pode || !dados} onClick={() => dialogo.abrir(null)}>
            <PlusIcon />
            {t("empresas.cadastro.nova")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!dados ? (
          <Skeleton className="h-32 w-full" />
        ) : dados.empresas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empresas.vazio.texto")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {dados.empresas.map((e) => {
              const contas = dados.marcas.filter((m) => m.empresaId === e.id).length
              const regras = dados.regras.filter((r) => r.empresaId === e.id).length
              return (
                <li key={e.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Ponto cor={corConta(e.cor)} />
                    <span className="min-w-0 flex-1 truncate font-medium">{e.nome}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={!pode}
                      aria-label={t("empresas.cadastro.editar")}
                      onClick={() => dialogo.abrir(e)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      disabled={!pode}
                      aria-label={t("empresas.cadastro.apagar")}
                      onClick={() => setApagar(e)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tn("empresas.cadastro.contasDela", contas)} · {tn("empresas.cadastro.regrasDela", regras)}
                  </p>
                  <p className="text-xs">{resumoTransbordo(e, estado.contas, tn, t)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      {dados ? (
        <DialogoEmpresa
          key={dialogo.chave}
          aberto={dialogo.aberto}
          aoFechar={dialogo.fechar}
          empresa={dialogo.valor ?? null}
          estado={estado}
          dados={dados}
          aoMudar={aoMudar}
        />
      ) : null}
      <Confirmar
        aberto={apagar !== null}
        aoFechar={() => setApagar(null)}
        titulo={t("empresas.cadastro.apagarTitulo", { nome: apagar?.nome ?? "" })}
        texto={t("empresas.cadastro.apagarTexto")}
        botao={t("empresas.cadastro.apagarBotao")}
        botaoSegurar={t("empresas.cadastro.apagarSegurar")}
        aoConfirmar={async () => {
          if (!apagar) return
          await acao(() => fonte.apagarEmpresa(apagar.id), t("empresas.cadastro.apagada"))
          aoMudar()
        }}
      />
    </Card>
  )
}

function DialogoEmpresa({
  aberto,
  aoFechar,
  empresa,
  estado,
  dados,
  aoMudar,
}: {
  aberto: boolean
  aoFechar: () => void
  empresa: Empresa | null
  estado: Instantaneo
  dados: DadosEmpresas
  aoMudar: () => void
}) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const [nome, setNome] = React.useState(empresa?.nome ?? "")
  const [cor, setCor] = React.useState(String(empresa?.cor ?? dados.empresas.length % N_CORES))
  const [transbordo, setTransbordo] = React.useState<Transbordo>(empresa?.transbordo ?? "nenhum")
  const [escolhidas, setEscolhidas] = React.useState<string[]>(empresa?.transbordoContas ?? [])
  const [enviando, setEnviando] = React.useState(false)
  // para o transbordo, as contas de fora: as que não estão marcadas para esta empresa e não estão saindo
  const deFora = estado.contas.filter(
    (c) => !c.saiEm && !dados.marcas.some((m) => m.contaId === c.id && m.empresaId === empresa?.id)
  )

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{empresa ? empresa.nome : t("empresas.cadastro.nova")}</DialogTitle>
          <DialogDescription>{t("empresas.cadastro.descricao")}</DialogDescription>
        </DialogHeader>
        <form
          id="form-empresa"
          className="max-h-[60vh] overflow-y-auto pr-1"
          onSubmit={async (e) => {
            e.preventDefault()
            setEnviando(true)
            const campos = {
              nome: nome.trim(),
              cor: Number(cor),
              transbordo,
              transbordoContas: transbordo === "escolhidas" ? escolhidas : [],
            }
            const [ok] = await acao(
              () => fonte.salvarEmpresa(empresa?.id ?? null, campos),
              empresa ? t("empresas.cadastro.salva") : t("empresas.cadastro.criada")
            )
            setEnviando(false)
            if (!ok) return
            aoMudar()
            aoFechar()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="empresa-nome">{t("empresas.cadastro.nome")}</FieldLabel>
              <Input id="empresa-nome" required maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("empresas.cadastro.cor")}</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                className="flex-wrap"
                value={cor}
                onValueChange={(v) => v && setCor(v)}
              >
                {Array.from({ length: N_CORES }, (_, i) => (
                  <ToggleGroupItem key={i} value={String(i)} aria-label={t("empresas.cadastro.corN", { n: i + 1 })}>
                    <span className="size-3.5 rounded-full" style={{ background: corConta(i) }} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel>{t("empresas.cadastro.transbordo")}</FieldLabel>
              <RadioGroup value={transbordo} onValueChange={(v) => setTransbordo(v as Transbordo)}>
                {(["nenhum", "qualquer", "escolhidas"] as const).map((x) => {
                  const rotulo = ({ nenhum: "Nenhum", qualquer: "Qualquer", escolhidas: "Escolhidas" } as const)[x]
                  return (
                    <FieldLabel key={x} htmlFor={`transbordo-${x}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem value={x} id={`transbordo-${x}`} />
                        <FieldContent>
                          <FieldTitle>{t(`empresas.cadastro.transbordo${rotulo}`)}</FieldTitle>
                          <FieldDescription>{t(`empresas.cadastro.transbordo${rotulo}Dica`)}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  )
                })}
              </RadioGroup>
            </Field>
            {transbordo === "escolhidas" ? (
              <Field>
                <FieldLabel>{t("empresas.cadastro.transbordoContas")}</FieldLabel>
                <div className="flex flex-col gap-2">
                  {deFora.map((c) => (
                    <Field key={c.id} orientation="horizontal">
                      <Checkbox
                        id={`transbordo-conta-${c.id}`}
                        checked={escolhidas.includes(c.id)}
                        onCheckedChange={(v) =>
                          setEscolhidas((x) => (v ? [...x, c.id] : x.filter((y) => y !== c.id)))
                        }
                      />
                      <FieldLabel htmlFor={`transbordo-conta-${c.id}`} className="min-w-0 font-normal">
                        <NomeConta conta={c} />
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </Field>
            ) : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("comum.cancelar")}
          </Button>
          <Button type="submit" form="form-empresa" disabled={enviando || !nome.trim()}>
            {enviando ? <Spinner /> : null}
            {t("empresas.cadastro.salvar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
