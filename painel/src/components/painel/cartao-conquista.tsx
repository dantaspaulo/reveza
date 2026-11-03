// O cartão de conquista para os stories: a pessoa escolhe o número do período, vê a prévia e baixa o JPG (ou manda
// direto pela folha de compartilhar do celular). O desenho fica em lib/cartao.ts; aqui, a escolha e a exportação.
// Código próprio: é um desenho em canvas para virar imagem, e o painel é público (sem blocos de licença paga).

import * as React from "react"
import { DownloadIcon, Share2Icon, TrophyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useT } from "@/i18n"
import { ALTURA, LARGURA, desenharCartao, marco, type TextosCartao } from "@/lib/cartao"
import type { Cotacao } from "@/lib/cotacao"
import { fmtBrl, fmtCompacto, fmtDia, fmtNumero, fmtTokens, fmtUsd } from "@/lib/formato"

export type MetricaCartao = "tokens" | "usd" | "brl" | "respostas" | "agentes" | "sessoes"

export interface NumerosCartao {
  tokens: number
  usd: number
  respostas: number
  agentes: number
  sessoes: number
}

export function valorDoCartao(m: MetricaCartao, n: NumerosCartao, cotacao: Cotacao | null): number {
  if (m === "brl") return n.usd * (cotacao?.valor ?? 0)
  return n[m]
}

export function CartaoConquista({
  numeros,
  dias,
  de,
  ate,
  cotacao,
  disabled,
}: {
  numeros: NumerosCartao | null
  dias: number
  de: Date
  ate: Date
  cotacao: Cotacao | null
  disabled?: boolean
}) {
  const { t, idioma } = useT()
  const [aberto, setAberto] = React.useState(false)
  const [metrica, setMetrica] = React.useState<MetricaCartao>("tokens")
  const [tela, setTela] = React.useState<HTMLCanvasElement | null>(null)
  const metricas: MetricaCartao[] = ["tokens", "usd", ...(cotacao ? (["brl"] as const) : []), "respostas", "agentes", "sessoes"]
  const podeCompartilhar = React.useMemo(() => {
    try {
      return !!navigator.canShare?.({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] })
    } catch {
      return false
    }
  }, [])

  const textos = React.useMemo<TextosCartao | null>(() => {
    if (!numeros) return null
    const v = valorDoCartao(metrica, numeros, cotacao)
    const m = marco(v)
    const valor =
      metrica === "tokens"
        ? fmtTokens(v, idioma)
        : metrica === "usd"
          ? fmtUsd(v, idioma, 0)
          : metrica === "brl"
            ? fmtBrl(v, idioma)
            : fmtNumero(v, idioma)
    const curto = (x: number) =>
      fmtCompacto(x, idioma, metrica === "usd" ? "USD" : metrica === "brl" ? "BRL" : undefined)
    return {
      cabecalho: t("uso.cartao.cabecalho"),
      periodo: t("uso.cartao.periodo", { n: dias, de: fmtDia(de.toISOString(), idioma), ate: fmtDia(ate.toISOString(), idioma) }),
      valor,
      rotulo: t(`uso.cartao.rotulos.${metrica}`, { n: dias }),
      marco: m ? t("uso.cartao.marco", { marco: curto(m) }) : null,
    }
  }, [numeros, metrica, cotacao, idioma, dias, de, ate, t])

  React.useEffect(() => {
    if (!tela || !textos) return
    let vivo = true
    const familia = getComputedStyle(document.body).fontFamily
    const fontes = document.fonts
    void Promise.all([fontes?.load(`800 200px ${familia}`), fontes?.load(`500 40px ${familia}`)])
      .catch(() => undefined)
      .then(() => {
        const ctx = vivo ? tela.getContext("2d") : null
        if (ctx) desenharCartao(ctx, textos, familia)
      })
    return () => {
      vivo = false
    }
  }, [tela, textos])

  const exportar = async (compartilhar: boolean) => {
    if (!tela) return
    const blob = await new Promise<Blob | null>((r) => tela.toBlob(r, "image/jpeg", 0.92))
    if (!blob) {
      toast.error(t("uso.cartao.falhou"))
      return
    }
    const nome = t("uso.cartao.nome", { metrica: t(`uso.cartao.arquivo.${metrica}`), n: dias })
    if (compartilhar) {
      try {
        await navigator.share({ files: [new File([blob], nome, { type: "image/jpeg" })] })
      } catch (e) {
        if ((e as DOMException)?.name !== "AbortError") toast.error(t("uso.cartao.falhou"))
      }
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(t("uso.cartao.pronto"))
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || !numeros}>
          <TrophyIcon />
          {t("uso.cartao.botao")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("uso.cartao.titulo")}</DialogTitle>
          <DialogDescription>{t("uso.cartao.descricao")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-start">
          <canvas
            ref={setTela}
            width={LARGURA}
            height={ALTURA}
            role="img"
            aria-label={textos ? `${textos.valor} ${textos.rotulo}` : undefined}
            className="mx-auto aspect-[9/16] w-full max-w-60 rounded-xl border bg-[#050A16] shadow-sm"
          />
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t("uso.cartao.escolha")}</p>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={metrica}
              onValueChange={(v) => v && setMetrica(v as MetricaCartao)}
              className="flex flex-wrap justify-start"
            >
              {metricas.map((m) => (
                <ToggleGroupItem key={m} value={m} className="flex-none px-3">
                  {t(`uso.cartao.metricas.${m}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{t("uso.cartao.privacidade")}</p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {podeCompartilhar ? (
            <Button variant="outline" onClick={() => void exportar(true)} disabled={!textos}>
              <Share2Icon />
              {t("uso.cartao.compartilhar")}
            </Button>
          ) : null}
          <Button onClick={() => void exportar(false)} disabled={!textos}>
            <DownloadIcon />
            {t("uso.cartao.baixar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
