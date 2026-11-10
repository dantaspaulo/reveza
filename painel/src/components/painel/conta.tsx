// Peças pequenas que mostram uma conta: o ponto de cor, o nome, o selo de estado e a barra de uso.

import {
  AlertTriangleIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  OctagonMinusIcon,
  TimerIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { janela, pctJanela, resetDe, type EstadoConta } from "@/dados/derivados"
import type { Conta } from "@/dados/tipos"
import { useT } from "@/i18n"
import { corConta } from "@/lib/cores"
import { fmtFuturo, fmtPct } from "@/lib/formato"
import { cn } from "@/lib/utils"

/** O ponto com a cor do workspace da conta. `tom` só onde várias contas aparecem juntas sem o nome de cada uma. */
export function PontoConta({ cor, tom = 0, className }: { cor: number; tom?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full ring-2 ring-background", className)}
      style={{ background: corConta(cor, tom) }}
    />
  )
}

export function NomeConta({
  conta,
  className,
  mostrarOrg = false,
}: {
  conta: Pick<Conta, "email" | "cor" | "organizacao" | "nomeWorkspace">
  className?: string
  mostrarOrg?: boolean
}) {
  // o workspace que deu a cor (a organização ou, sem ela, o domínio do e-mail)
  const workspace = conta.nomeWorkspace ?? conta.organizacao
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-2", className)}>
      <PontoConta cor={conta.cor} />
      <span className="min-w-0">
        <span className="block truncate">{conta.email}</span>
        {mostrarOrg && workspace ? (
          <span className="block truncate text-xs text-muted-foreground">{workspace}</span>
        ) : null}
      </span>
    </span>
  )
}

const ESTILO: Record<EstadoConta, string> = {
  saindo: "border-erro-borda bg-erro-fundo text-erro",
  precisa_login: "border-erro-borda bg-erro-fundo text-erro",
  esgotada: "border-erro-borda bg-erro-fundo text-erro",
  aviso: "border-atencao-borda bg-atencao-fundo text-atencao",
  pausada: "border-border bg-muted text-muted-foreground",
  em_uso: "border-ok/30 bg-ok-fundo text-ok",
  reserva: "border-border bg-transparent text-muted-foreground",
  livre: "border-border bg-transparent text-foreground",
}

const ICONE: Record<EstadoConta, typeof KeyRoundIcon> = {
  saindo: TimerIcon,
  precisa_login: KeyRoundIcon,
  esgotada: OctagonMinusIcon,
  aviso: AlertTriangleIcon,
  pausada: CirclePauseIcon,
  em_uso: CirclePlayIcon,
  reserva: LifeBuoyIcon,
  livre: CircleCheckIcon,
}

export function SeloEstado({ estado, className }: { estado: EstadoConta; className?: string }) {
  const { t } = useT()
  const Icone = ICONE[estado]
  return (
    <Badge variant="outline" className={cn("gap-1", ESTILO[estado], className)}>
      <Icone />
      {t(`estadoConta.${estado}`)}
    </Badge>
  )
}

/** Quantos pontos antes do aviso a barra já fica âmbar. */
export const FAIXA_ATENCAO = 15

/**
 * O nível do uso (0.13.0): "atencao" dos 15 pontos antes do aviso até ele, "alerta" do aviso para cima. Sem o aviso
 * (`alerta` ausente), fica no normal.
 */
export function nivelUso(pct: number | null, alerta?: number): "normal" | "atencao" | "alerta" {
  if (pct === null || alerta === undefined) return "normal"
  if (pct >= Math.min(alerta, 100)) return "alerta"
  if (pct >= alerta - FAIXA_ATENCAO) return "atencao"
  return "normal"
}

/**
 * Barra de uso de uma janela: a cor é a da conta (identidade) até perto do aviso; daí fica âmbar e, do aviso para
 * cima, vermelha (0.13.0, `alerta` = o aviso da instalação). As marcas finas são o aviso e a troca. O número fica ao
 * lado, em texto e com a mesma cor, nunca só na cor.
 */
export function BarraUso({
  pct,
  cor,
  aviso,
  troca,
  alerta,
  rotulo,
  detalhe,
  compacta = false,
}: {
  pct: number | null
  cor: number
  aviso?: number
  troca?: number
  alerta?: number
  rotulo?: string
  detalhe?: string
  compacta?: boolean
}) {
  const { idioma } = useT()
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const esgotada = pct !== null && pct >= 100
  const nivel = esgotada ? "alerta" : nivelUso(pct, alerta)
  const corBarra = nivel === "alerta" ? "var(--erro)" : nivel === "atencao" ? "var(--atencao)" : corConta(cor)
  return (
    <div className="min-w-0">
      {rotulo !== undefined || detalhe !== undefined ? (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-muted-foreground">{rotulo}</span>
          <span className="shrink-0 tabular-nums">
            <span
              className={cn(
                "font-medium",
                nivel === "alerta" ? "text-erro" : nivel === "atencao" ? "text-atencao" : "text-foreground"
              )}
            >
              {fmtPct(pct, idioma, 1)}
            </span>
            {detalhe ? <span className="text-muted-foreground"> · {detalhe}</span> : null}
          </span>
        </div>
      ) : null}
      <div
        className={cn("relative w-full overflow-hidden rounded-full bg-muted", compacta ? "h-1.5" : "h-2")}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label={rotulo}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${v}%`, background: corBarra }}
        />
        {aviso ? (
          <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/35" style={{ left: `${aviso}%` }} />
        ) : null}
        {troca ? (
          <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${troca}%` }} />
        ) : null}
      </div>
    </div>
  )
}

/**
 * A semana do Fable, embaixo da semana da conta (pedido do Paulo, 10/11/2026: "não mostra o do fable"). A API manda à
 * parte (a lista `limits`, desde outubro de 2026) o quanto já se usou do Fable incluso no plano na semana; passou de
 * 100%, o Fable só segue com créditos de uso. Não é cota a mais: o Fable gasta também a semana da conta (o "reset do
 * Fable" do Claude Code 2.1.322 "devolve à semana o que o Fable gastou") e, com ela cheia, para junto. Por isso a barra
 * não tem as marcas de aviso e de troca (ela não decide a troca, como na nuvem desde a 0028), fica âmbar perto do fim do
 * incluso e vermelha nele. Conta sem a semana do Fable (plano sem o Fable incluso) não mostra nada.
 */
export function BarraFable({ conta, agora, comRotulo = false }: { conta: Conta; agora: Date; comRotulo?: boolean }) {
  const { t, idioma } = useT()
  if (!janela(conta, "seven_day_fable")) return null
  const reset = resetDe(conta, "seven_day_fable")
  return (
    <div title={t("fable.nota")}>
      <BarraUso
        pct={pctJanela(conta, "seven_day_fable", agora)}
        cor={conta.cor}
        alerta={100}
        rotulo={comRotulo ? t("janela.seven_day_fable") : t("fable.curto")}
        detalhe={comRotulo && reset ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) }) : undefined}
        compacta
      />
    </div>
  )
}
