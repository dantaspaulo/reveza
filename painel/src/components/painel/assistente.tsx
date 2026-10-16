// O assistente de código de cada computador (0.8.0): a versão de cada um lado a lado, o Atualizar por computador e o
// "Atualizar os atrasados", e a escolha da instalação: o jeito do assistente, sempre a mais nova (cada agente atualiza de
// 6 em 6 horas) ou só pelo painel (o agente desliga a atualização automática do assistente). Só administrador pede.
// Feito com os componentes do shadcn/ui que o painel já usa (Card, RadioGroup, Field), como o cartão de atualizações:
// o repositório é público e não leva código do React Bits Pro.

import * as React from "react"
import { CircleCheckIcon, MousePointerClickIcon, DownloadIcon, RefreshCwIcon, SparklesIcon, SquareTerminalIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import type { Computador, ModoAssistente } from "@/dados/tipos"
import { useT } from "@/i18n"
import { linhasDoAssistente, momentoDoPedido, type EstadoAssistente } from "@/lib/assistente"
import { cn } from "@/lib/utils"

export const MODOS_ASSISTENTE: ModoAssistente[] = ["padrao", "sozinho", "manual"]
const ICONE_DO_MODO: Record<ModoAssistente, typeof SparklesIcon> = {
  padrao: SquareTerminalIcon,
  sozinho: SparklesIcon,
  manual: MousePointerClickIcon,
}
const COR_DO_ESTADO: Record<EstadoAssistente, string> = {
  mais_nova: "text-ok",
  atras: "text-atencao",
  sem_versao: "text-muted-foreground",
  atualizando: "text-muted-foreground",
}

export function CartaoAssistente() {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const agora = useAgora(5000)
  const { pode } = usePermissao()
  const [pedidos, setPedidos] = React.useState<Record<string, number>>({})
  const [enviando, setEnviando] = React.useState(false)
  // a identidade pendente (código de acesso ainda sem uso) não tem assistente para atualizar
  const ativos = estado.computadores.filter((c) => !c.revogado && c.sistema !== "pendente")
  const modo = estado.config.assistenteAtualizar
  const { maisNova, linhas, iguais } = linhasDoAssistente(ativos, pedidos, agora.getTime())
  const atrasados = linhas.filter((l) => l.estado === "atras" && l.podeAtualizar)

  const pedir = async (pc: Computador) => {
    const [ok] = await acao(() => fonte.comando(pc.id, "atualizar", { assistente: true }), t("computadores.assistente.pedido", { computador: pc.nome }))
    if (ok) setPedidos((p) => ({ ...p, [pc.id]: momentoDoPedido() }))
  }

  const atualizarAtrasados = async () => {
    setEnviando(true)
    const feitos: Record<string, number> = {}
    for (const { pc } of atrasados) {
      try {
        await fonte.comando(pc.id, "atualizar", { assistente: true })
        feitos[pc.id] = momentoDoPedido()
      } catch {
        // segue para os outros; o aviso diz quantos foram
      }
    }
    setEnviando(false)
    const n = Object.keys(feitos).length
    setPedidos((p) => ({ ...p, ...feitos }))
    if (n) toast.success(t("computadores.assistente.todosPedido", { n }))
    else toast.error(t("computadores.assistente.todosFalhou"))
  }

  const escolher = (v: string) => {
    const novo = v as ModoAssistente
    if (!MODOS_ASSISTENTE.includes(novo) || novo === modo) return
    void acao(
      () => fonte.salvarConfig({ assistenteAtualizar: novo }),
      t("computadores.assistente.modo.salvo", { modo: t(`computadores.assistente.modo.${novo}.titulo`) })
    )
  }

  const resumo = iguais && maisNova ? t("computadores.assistente.todosIguais", { versao: maisNova }) : maisNova ? t("computadores.assistente.diferentes", { versao: maisNova }) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <SquareTerminalIcon className="size-4" aria-hidden />
          </span>
          {t("computadores.assistente.titulo")}
        </CardTitle>
        <CardDescription>{t("computadores.assistente.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {resumo ? (
            <span role="status" aria-live="polite" className={cn("flex min-w-0 flex-1 basis-64 items-center gap-1.5", iguais ? "text-ok" : "text-atencao")}>
              {iguais ? <CircleCheckIcon className="size-4" aria-hidden /> : <TriangleAlertIcon className="size-4" aria-hidden />}
              {resumo}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {atrasados.length ? (
            <Button size="sm" disabled={!pode || enviando} title={pode ? undefined : t("computadores.assistente.soAdmin")} onClick={() => void atualizarAtrasados()}>
              {enviando ? <Spinner /> : <DownloadIcon />}
              {t("computadores.assistente.todos", { n: atrasados.length })}
            </Button>
          ) : null}
        </div>

        <ul className="flex flex-col divide-y rounded-lg border">
          {linhas.map(({ pc, versao, estado: e, podeAtualizar }) => {
            const a = pc.diagnostico?.assistente
            const falhou = a?.ultima && !a.ultima.ok ? a.ultima.erro ?? "?" : null
            return (
              <li key={pc.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{pc.nome}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">{versao ?? t("computadores.assistente.semVersao")}</span>
                    <span className={cn("flex items-center gap-1 text-xs", COR_DO_ESTADO[e])}>
                      {e === "atualizando" ? <Spinner className="size-3" /> : null}
                      {e === "mais_nova" && maisNova && !iguais ? t("computadores.assistente.maisNova") : null}
                      {e === "atras" ? t("computadores.assistente.atras") : null}
                      {e === "atualizando" ? t("computadores.assistente.atualizando") : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!pode || !podeAtualizar}
                      title={
                        !a ? t("computadores.assistente.agenteAntigo") : pode ? t("computadores.assistente.atualizarDica") : t("computadores.assistente.soAdmin")
                      }
                      onClick={() => void pedir(pc)}
                    >
                      <RefreshCwIcon />
                      {t("computadores.assistente.atualizar")}
                    </Button>
                  </div>
                </div>
                {falhou && e !== "atualizando" ? (
                  <span className="text-xs text-atencao">{t("computadores.assistente.ultimaFalhou", { erro: falhou })}</span>
                ) : null}
                {a?.autoDesligado === "pessoa" ? <span className="text-xs text-muted-foreground">{t("computadores.assistente.desligadoPessoa")}</span> : null}
                {!a ? <span className="text-xs text-muted-foreground">{t("computadores.assistente.agenteAntigo")}</span> : null}
              </li>
            )
          })}
        </ul>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{t("computadores.assistente.modo.titulo")}</span>
            <span className="text-xs text-muted-foreground">{t("computadores.assistente.modo.descricao")}</span>
          </div>
          <RadioGroup
            value={modo}
            onValueChange={escolher}
            disabled={!pode}
            aria-label={t("computadores.assistente.modo.titulo")}
            className="gap-2 md:grid-cols-3"
          >
            {MODOS_ASSISTENTE.map((m) => {
              const Icone = ICONE_DO_MODO[m]
              return (
                <FieldLabel key={m} htmlFor={`assistente-${m}`}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={m} id={`assistente-${m}`} />
                    <FieldContent>
                      <FieldTitle>
                        <Icone className="size-3.5 text-muted-foreground" aria-hidden />
                        {t(`computadores.assistente.modo.${m}.titulo`)}
                      </FieldTitle>
                      <FieldDescription className="text-xs">{t(`computadores.assistente.modo.${m}.texto`)}</FieldDescription>
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
