// Troca automática como painel de controle: liga e desliga, os 3 modos com a frase de cada um, limiares, rodízio,
// ordem de preferência e reserva, agenda e teto por conta, ajustes finos e o custo de trocar muito. Tudo vira um
// rascunho; a barra de baixo salva de uma vez (as funções painel_config e painel_conta do banco).

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  CircleDollarSignIcon,
  PencilIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react"

import { NomeConta } from "@/components/painel/conta"
import { resumoFaixa, useDias } from "@/components/painel/editor-agenda"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Codigo } from "@/components/painel/copiar"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { soCriticas } from "@/dados/derivados"
import type { ConfigTroca, Conta, Modo, OrdemRodizio } from "@/dados/tipos"
import { useT } from "@/i18n"
import { fmtDuracao, fmtFuturo, fmtPct } from "@/lib/formato"
import { camposMudados } from "@/lib/rascunho"
import { faixaRodizio, trocasPorDia } from "@/lib/regra"
import { cn } from "@/lib/utils"
import { useDialogo } from "@/hooks/use-dialogo"
import { EditarConta } from "./contas"

/** Tempo de atualização que a pessoa escolhe: de quanto em quanto tempo cada computador conversa com a nuvem. */
export const INTERVALOS = [5, 10, 15, 30] as const

const MODOS: Modo[] = ["limite", "limiar", "rodizio"]

const FUSOS_COMUNS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Recife",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Noronha",
  "Europe/Lisbon",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
]

interface Rascunho {
  config: ConfigTroca
  ordem: string[]
  reservas: Record<string, boolean>
}

function daBase(contas: Conta[], config: ConfigTroca): Rascunho {
  const ordenadas = [...contas].sort((a, b) => a.prioridade - b.prioridade || a.email.localeCompare(b.email))
  return {
    config: { ...config },
    ordem: ordenadas.map((c) => c.id),
    reservas: Object.fromEntries(contas.map((c) => [c.id, c.reserva])),
  }
}

export default function Troca() {
  const { t, idioma } = useT()
  const estado = useEstado()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const agora = useAgora(30_000)
  const base = React.useMemo(() => daBase(estado.contas, estado.config), [estado.contas, estado.config])
  const [r, setR] = React.useState<Rascunho>(base)
  const [salvando, setSalvando] = React.useState(false)
  const editar = useDialogo<Conta>()

  // Quando a nuvem muda (outra pessoa salvou), o rascunho segue a base enquanto não houver mudança local.
  const sujo = JSON.stringify(r) !== JSON.stringify(base)
  const ultimaBase = React.useRef(base)
  React.useEffect(() => {
    setR((atual) => (JSON.stringify(atual) === JSON.stringify(ultimaBase.current) ? base : atual))
    ultimaBase.current = base
  }, [base])

  const cfg = r.config
  // só o que se mexeu nesta tela vai ao salvar: um rascunho antigo não regrava o que outra aba (ou outra tela) mudou
  const tocados = React.useRef(new Set<keyof ConfigTroca>())
  const mudar = (campos: Partial<ConfigTroca>) => {
    for (const k of Object.keys(campos) as (keyof ConfigTroca)[]) tocados.current.add(k)
    setR((x) => ({ ...x, config: { ...x.config, ...campos } }))
  }
  const contaPorId = (id: string) => estado.contas.find((c) => c.id === id)!

  const salvar = async () => {
    setSalvando(true)
    const camposConfig = camposMudados(cfg, base.config, tocados.current)
    const [ok] = await acao(async () => {
      if (Object.keys(camposConfig).length) await fonte.salvarConfig(camposConfig)
      if (r.ordem.join() !== base.ordem.join()) await fonte.ordenarContas(r.ordem)
      for (const [id, reserva] of Object.entries(r.reservas))
        if (reserva !== base.reservas[id]) await fonte.salvarConta(id, { reserva })
    }, t("troca.salvar.salvo"))
    setSalvando(false)
    if (ok) {
      ultimaBase.current = r
      tocados.current.clear()
    }
  }

  const mover = (i: number, d: -1 | 1) =>
    setR((x) => {
      const ordem = [...x.ordem]
      const j = i + d
      if (j < 0 || j >= ordem.length) return x
      ;[ordem[i], ordem[j]] = [ordem[j], ordem[i]]
      return { ...x, ordem }
    })

  // o que vale agora (a configuração salva, não o rascunho): as sessões comuns estão em espera
  const seguraAgora = soCriticas(estado.contas, estado.config, agora)
  const fx = faixaRodizio(cfg.rodizioMinutos)
  const vars = {
    aviso: fmtPct(cfg.aviso, idioma),
    troca: fmtPct(cfg.troca, idioma),
    intervalo: fmtDuracao(cfg.rodizioMinutos * 60, idioma),
  }

  return (
    <Pagina titulo={t("menu.secoes.troca")} descricao={t("troca.descricao")} className="pb-28">
      <AvisoPermissao />

      <Card className={cn("transition-colors", cfg.auto && "border-ok/40")}>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-lg font-semibold">{t("troca.auto.titulo")}</p>
            <p className="text-sm text-muted-foreground">
              {cfg.auto ? t("troca.auto.ligada") : t("troca.auto.desligada")}
            </p>
          </div>
          <Switch
            checked={cfg.auto}
            onCheckedChange={(auto) => mudar({ auto })}
            disabled={!pode}
            aria-label={t("troca.auto.rotulo")}
            className="scale-125"
          />
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("troca.modo.titulo")}</CardTitle>
            <CardDescription>{t("troca.modo.descricao")}</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup value={cfg.modo} onValueChange={(v) => mudar({ modo: v as Modo })} disabled={!pode}>
              {MODOS.map((m) => (
                <FieldLabel key={m} htmlFor={`modo-${m}`}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={m} id={`modo-${m}`} />
                    <FieldContent>
                      <FieldTitle>
                        {t(`modo.${m}`)}
                        {estado.config.modo === m ? (
                          <Badge variant="secondary" className="ml-1">
                            {t("troca.modo.valendo")}
                          </Badge>
                        ) : null}
                      </FieldTitle>
                      <FieldDescription>{t(`troca.modo.${m}`, vars)}</FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("troca.limiares.titulo")}</CardTitle>
              <CardDescription>{t("troca.limiares.descricao")}</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Limiar
                  rotulo={t("troca.limiares.aviso")}
                  dica={t("troca.limiares.avisoDica")}
                  valor={cfg.aviso}
                  aoMudar={(aviso) => mudar({ aviso: Math.min(aviso, (cfg.modo === "limite" ? 100 : cfg.troca) - 1) })}
                  desligado={!pode}
                />
                <Limiar
                  rotulo={t("troca.limiares.troca")}
                  dica={cfg.modo === "limite" ? t("troca.limiares.trocaNoLimite") : t("troca.limiares.trocaDica")}
                  valor={cfg.modo === "limite" ? 100 : cfg.troca}
                  aoMudar={(troca) => mudar({ troca: Math.max(troca, cfg.aviso + 1) })}
                  desligado={!pode || cfg.modo === "limite"}
                />
              </FieldGroup>
            </CardContent>
          </Card>

          {cfg.modo === "rodizio" ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("troca.rodizio.titulo")}</CardTitle>
                {estado.config.modo === "rodizio" && estado.config.proximoRodizioEm ? (
                  <CardDescription className="flex items-center gap-1.5">
                    <TimerIcon className="size-3.5" aria-hidden />
                    {t("troca.rodizio.proxima", { quando: fmtFuturo(estado.config.proximoRodizioEm, agora, idioma) })}
                  </CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <div className="flex items-center justify-between">
                      <FieldLabel>{t("troca.rodizio.intervalo")}</FieldLabel>
                      <span className="text-sm font-medium tabular-nums">{vars.intervalo}</span>
                    </div>
                    <Slider
                      value={[cfg.rodizioMinutos]}
                      min={15}
                      max={480}
                      step={15}
                      onValueChange={(v) => mudar({ rodizioMinutos: v[0] ?? 90 })}
                      disabled={!pode}
                      aria-label={t("troca.rodizio.intervalo")}
                    />
                    <FieldDescription>
                      {t("troca.rodizio.faixa", {
                        min: fmtDuracao(fx.min * 60, idioma),
                        max: fmtDuracao(fx.max * 60, idioma),
                        n: trocasPorDia(cfg.rodizioMinutos),
                      })}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t("troca.rodizio.ordem")}</FieldLabel>
                    <RadioGroup
                      value={cfg.rodizioOrdem}
                      onValueChange={(v) => mudar({ rodizioOrdem: v as OrdemRodizio })}
                      className="grid gap-2 sm:grid-cols-2"
                      disabled={!pode}
                    >
                      {(["aleatoria", "menor_uso"] as const).map((o) => (
                        <FieldLabel key={o} htmlFor={`ordem-${o}`}>
                          <Field orientation="horizontal">
                            <RadioGroupItem value={o} id={`ordem-${o}`} />
                            <FieldContent>
                              <FieldTitle>{t(`troca.rodizio.${o}`)}</FieldTitle>
                              <FieldDescription>{t(`troca.rodizio.${o}Dica`)}</FieldDescription>
                            </FieldContent>
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("troca.ordem.titulo")}</CardTitle>
            <CardDescription>{t("troca.ordem.descricao")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {r.ordem.map((id, i) => {
                const c = contaPorId(id)
                if (!c) return null
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border p-2 pl-3">
                    <span className="w-5 shrink-0 text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                    {/* no celular a chave de reserva desce para baixo do e-mail */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                      <div className="min-w-0 flex-1">
                        <NomeConta conta={c} className="text-sm" />
                        {c.pausada ? (
                          <span className="ml-[18px] text-xs text-muted-foreground">{t("troca.ordem.pausada")}</span>
                        ) : null}
                      </div>
                      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground max-sm:ml-[18px]">
                        <Switch
                          size="sm"
                          checked={r.reservas[id] ?? false}
                          onCheckedChange={(v) => setR((x) => ({ ...x, reservas: { ...x.reservas, [id]: v } }))}
                          disabled={!pode}
                        />
                        {t("troca.ordem.reserva")}
                      </label>
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!pode || i === 0}
                        onClick={() => mover(i, -1)}
                        aria-label={t("troca.ordem.subir", { conta: c.email })}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!pode || i === r.ordem.length - 1}
                        onClick={() => mover(i, 1)}
                        aria-label={t("troca.ordem.descer", { conta: c.email })}
                      >
                        <ArrowDownIcon />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className={cn("transition-colors", seguraAgora && "border-atencao-borda")}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden />
                {t("troca.criticas.titulo")}
                {seguraAgora ? (
                  <Badge variant="outline" className="border-atencao-borda bg-atencao-fundo text-atencao">
                    {t("troca.criticas.agora")}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>{t("troca.criticas.descricao")}</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="criticas">{t("troca.criticas.ligar")}</FieldLabel>
                    <FieldDescription>{t("troca.criticas.ligarDica")}</FieldDescription>
                  </FieldContent>
                  <Switch id="criticas" checked={cfg.criticas} onCheckedChange={(criticas) => mudar({ criticas })} disabled={!pode} />
                </Field>
                {cfg.criticas ? (
                  <>
                    <Limiar
                      rotulo={t("troca.criticas.gatilho")}
                      dica={t("troca.criticas.gatilhoDica")}
                      valor={cfg.criticasGatilho}
                      aoMudar={(criticasGatilho) => mudar({ criticasGatilho })}
                      desligado={!pode}
                      min={50}
                      max={95}
                      passo={5}
                    />
                    <Field>
                      <FieldTitle>{t("troca.criticas.comoMarcar")}</FieldTitle>
                      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                        <span>{t("troca.criticas.naSessao")}</span>
                        <Codigo texto="/reveza critica" />
                        <span>{t("troca.criticas.naRotina")}</span>
                        <Codigo texto="REVEZA_CRITICA=1" />
                        <span>{t("troca.criticas.noTerminal")}</span>
                        <Codigo texto="reveza criticas marcar <id>" />
                      </div>
                    </Field>
                  </>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
          <AgendaTeto aoEditar={(c) => editar.abrir(c)} fuso={cfg.fuso} aoMudarFuso={(fuso) => mudar({ fuso })} />
          <Card>
            <CardHeader>
              <CardTitle>{t("troca.ajustes.titulo")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel>{t("troca.ajustes.espera")}</FieldLabel>
                    <span className="text-sm font-medium tabular-nums">
                      {fmtDuracao(cfg.esperaEntreTrocasS, idioma)}
                    </span>
                  </div>
                  <Slider
                    value={[cfg.esperaEntreTrocasS]}
                    min={30}
                    max={900}
                    step={30}
                    onValueChange={(v) => mudar({ esperaEntreTrocasS: v[0] ?? 90 })}
                    disabled={!pode}
                    aria-label={t("troca.ajustes.espera")}
                  />
                  <FieldDescription>{t("troca.ajustes.esperaDica")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t("troca.ajustes.intervalo")}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={String(cfg.intervaloS)}
                    onValueChange={(v) => v && mudar({ intervaloS: Number(v) })}
                    disabled={!pode}
                    aria-label={t("troca.ajustes.intervalo")}
                    className="w-full sm:w-auto"
                  >
                    {INTERVALOS.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)} className="flex-1 tabular-nums sm:flex-none sm:px-4">
                        {t("troca.ajustes.segundos", { n })}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>{t("troca.ajustes.intervaloDica")}</FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="retomar">{t("troca.ajustes.retomar")}</FieldLabel>
                    <FieldDescription>{t("troca.ajustes.retomarDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="retomar"
                    checked={cfg.retomarTerminal}
                    onCheckedChange={(retomarTerminal) => mudar({ retomarTerminal })}
                    disabled={!pode}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>

      <Alert className="border-atencao-borda bg-atencao-fundo text-atencao *:data-[slot=alert-description]:text-atencao/90">
        <CircleDollarSignIcon />
        <AlertDescription>{t("troca.custo")}</AlertDescription>
      </Alert>

      {sujo ? (
        <div className="sticky bottom-3 z-10 mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border bg-popover/95 p-3 pl-4 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">{t("troca.salvar.pendente")}</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                tocados.current.clear()
                setR(base)
              }}
              disabled={salvando}
            >
              {t("comum.descartar")}
            </Button>
            <Button onClick={() => void salvar()} disabled={!pode || salvando}>
              {salvando ? <Spinner /> : null}
              {t("comum.salvar")}
            </Button>
          </div>
        </div>
      ) : null}
      <EditarConta key={editar.chave} conta={editar.valor ?? null} aberto={editar.aberto} aoFechar={editar.fechar} />
    </Pagina>
  )
}

function Limiar({
  rotulo,
  dica,
  valor,
  aoMudar,
  desligado,
  min = 50,
  max = 100,
  passo = 1,
}: {
  rotulo: string
  dica: string
  valor: number
  aoMudar: (v: number) => void
  desligado?: boolean
  min?: number
  max?: number
  passo?: number
}) {
  const { idioma } = useT()
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{rotulo}</FieldLabel>
        <span className="text-sm font-medium tabular-nums">{fmtPct(valor, idioma)}</span>
      </div>
      <Slider
        value={[valor]}
        min={min}
        max={max}
        step={passo}
        onValueChange={(v) => aoMudar(v[0] ?? valor)}
        disabled={desligado}
        aria-label={rotulo}
      />
      <FieldDescription>{dica}</FieldDescription>
    </Field>
  )
}

function AgendaTeto({
  aoEditar,
  fuso,
  aoMudarFuso,
}: {
  aoEditar: (c: Conta) => void
  fuso: string
  aoMudarFuso: (f: string) => void
}) {
  const { t, idioma } = useT()
  const estado = useEstado()
  const { pode } = usePermissao()
  const { curtos } = useDias()
  const fusos = FUSOS_COMUNS.includes(fuso) ? FUSOS_COMUNS : [fuso, ...FUSOS_COMUNS]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("troca.agenda.titulo")}</CardTitle>
        <CardDescription>{t("troca.agenda.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="divide-y">
          {[...estado.contas]
            .sort((a, b) => a.prioridade - b.prioridade)
            .map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <NomeConta conta={c} className="text-sm" />
                  <p className="ml-[18px] flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <CalendarClockIcon className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">
                      {c.agenda.length
                        ? c.agenda.map((f) => resumoFaixa(f, curtos, t("contas.agenda.ate"))).join("; ")
                        : t("contas.agendaSempre")}
                      {" · "}
                      {c.tetoSemana != null
                        ? t("contas.teto", { pct: fmtPct(c.tetoSemana, idioma) })
                        : t("troca.agenda.semTeto")}
                    </span>
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => aoEditar(c)} disabled={!pode}>
                  <PencilIcon />
                  <span className="sr-only sm:not-sr-only">{t("troca.agenda.editar")}</span>
                </Button>
              </li>
            ))}
        </ul>
        <Field>
          <FieldLabel htmlFor="fuso">{t("troca.agenda.fuso")}</FieldLabel>
          <Select value={fuso} onValueChange={aoMudarFuso} disabled={!pode}>
            <SelectTrigger id="fuso" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fusos.map((f) => (
                <SelectItem key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  )
}
