// O aviso de troca de conta neste navegador: o vigia (montado no painel, em qualquer tela) e o cartão de Alertas que
// liga, desliga e testa. A notificação sai do dado ao vivo que o painel já recebe; nada novo vai para a nuvem.

import * as React from "react"
import { BellRingIcon, CheckIcon, MonitorSmartphoneIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { textoEvento } from "@/components/painel/evento"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { mensagemErro, useDados } from "@/dados/contexto"
import type { Evento, Instantaneo } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  destravarSom,
  guardarPreferencia,
  reservarTrocas,
  tocarSinal,
  trocasNovas,
  usePreferenciaAviso,
} from "@/pwa/aviso-trocas"
import { mostrarNotificacao, pedirPermissao, permissaoAtual, suporteNotificacao } from "@/pwa/notificacoes"

type I18n = ReturnType<typeof useT>

/** Título e corpo do aviso de uma ou várias trocas, no idioma da tela e com os nomes atuais. */
export function textoDoAviso(trocas: readonly Evento[], estado: Pick<Instantaneo, "contas" | "computadores">, i: I18n) {
  const linhas = trocas.map((e) => {
    const { titulo, detalhe } = textoEvento(e, estado, i)
    return detalhe ? `${titulo} (${detalhe})` : titulo
  })
  return {
    titulo:
      trocas.length === 1
        ? i.t("alertas.navegador.notificacaoTitulo")
        : i.t("alertas.navegador.notificacaoVarias", { n: trocas.length }),
    // as três mais novas; o resto está na linha do tempo do painel
    corpo: linhas.slice(-3).join("\n"),
  }
}

/** Mostra o aviso: notificação do sistema quando a pessoa não está olhando a aba; senão, dentro do painel. */
async function avisar(titulo: string, corpo: string, som: boolean, tag: string) {
  if (som) tocarSinal()
  const olhando = document.visibilityState === "visible" && document.hasFocus()
  if (!olhando && (await mostrarNotificacao(titulo, corpo, { tag, url: "/" }))) return
  toast(titulo, { description: corpo, icon: <BellRingIcon className="size-4" /> })
}

/**
 * Vigia as trocas que chegam pelo dado ao vivo e avisa as novas (nunca as que já estavam na tela ao abrir). Fica
 * montado no painel inteiro, então avisa em qualquer seção.
 */
export function VigiaTrocas() {
  const { estado } = useDados()
  const i = useT()
  const { ligado, som } = usePreferenciaAviso()
  const visto = React.useRef<number | null>(null)

  // depois de recarregar, o navegador só deixa tocar som a partir do primeiro gesto da pessoa na página
  React.useEffect(() => {
    if (!ligado || !som) return
    const ao = () => void destravarSom()
    const opcoes = { capture: true, once: true } as const
    window.addEventListener("pointerdown", ao, opcoes)
    window.addEventListener("keydown", ao, opcoes)
    return () => {
      window.removeEventListener("pointerdown", ao, opcoes)
      window.removeEventListener("keydown", ao, opcoes)
    }
  }, [ligado, som])

  React.useEffect(() => {
    if (!estado) return
    const maior = estado.eventos.reduce((m, e) => Math.max(m, e.id), 0)
    if (visto.current === null) {
      visto.current = maior
      return
    }
    const novas = trocasNovas(estado.eventos, visto.current)
    visto.current = Math.max(visto.current, maior)
    if (!ligado || !novas.length) return
    const minhas = reservarTrocas(novas)
    if (!minhas.length) return
    const { titulo, corpo } = textoDoAviso(minhas, estado, i)
    void avisar(titulo, corpo, som, `reveza-troca-${minhas[minhas.length - 1]!.id}`)
  }, [estado, ligado, som, i])

  return null
}

/** O cartão "Neste navegador" de Alertas: liga o aviso de trocas, o sinal e testa. */
export function CartaoAvisoNavegador() {
  const i = useT()
  const { t, tx } = i
  const { ligado, som } = usePreferenciaAviso()
  const [permissao, setPermissao] = React.useState(permissaoAtual)
  const suporte = suporteNotificacao()
  const mac = typeof navigator !== "undefined" && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2

  // pede a permissão no mesmo clique; recusada, o aviso fica só com o sinal e o aviso dentro do painel
  const permitir = async () => {
    try {
      await pedirPermissao(suporte)
    } catch (e) {
      toast.warning(mensagemErro(e, t, tx), { description: t("alertas.navegador.semNotificacao") })
    } finally {
      setPermissao(permissaoAtual())
    }
  }

  const ligar = async (v: boolean) => {
    if (v) destravarSom()
    guardarPreferencia({ ligado: v })
    if (!v) {
      toast.success(t("alertas.navegador.desligado"))
      return
    }
    if (som) tocarSinal()
    toast.success(t("alertas.navegador.ligado"))
    if (suporte === "ok" && permissaoAtual() !== "granted") await permitir()
  }

  const testar = async () => {
    destravarSom()
    if (som) tocarSinal()
    try {
      await pedirPermissao(suporte)
      setPermissao(permissaoAtual())
      const ok = await mostrarNotificacao(t("alertas.navegador.notificacaoTitulo"), t("alertas.navegador.testeCorpo"), {
        tag: "reveza-teste-troca",
      })
      if (!ok) throw new Error("notif_sem_suporte")
    } catch (e) {
      setPermissao(permissaoAtual())
      toast(t("alertas.navegador.notificacaoTitulo"), {
        description: `${t("alertas.navegador.testeCorpo")} ${mensagemErro(e, t, tx)}`,
        icon: <BellRingIcon className="size-4" />,
      })
    }
  }

  const situacao =
    suporte !== "ok"
      ? {
          ok: false,
          texto: `${tx(suporte === "ios_instalar" ? "erros.notif_ios_instalar" : "erros.notif_sem_suporte")} ${t("alertas.navegador.semNotificacao")}`,
        }
      : permissao === "granted"
        ? { ok: true, texto: t("alertas.navegador.permissaoOk") }
        : permissao === "denied"
          ? { ok: false, texto: `${t("erros.notif_bloqueada")} ${t("alertas.navegador.semNotificacao")}` }
          : { ok: null, texto: t("alertas.navegador.permissaoPedir") }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-muted">
            <MonitorSmartphoneIcon className="size-4" aria-hidden />
          </span>
          {t("alertas.navegador.titulo")}
        </CardTitle>
        <CardDescription>{t("alertas.navegador.descricao")}</CardDescription>
        <CardAction>
          <Switch checked={ligado} onCheckedChange={(v) => void ligar(v)} aria-label={t("alertas.navegador.ligar")} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Field orientation="horizontal">
          <Switch
            id="aviso-som"
            checked={som}
            disabled={!ligado}
            onCheckedChange={(v) => {
              guardarPreferencia({ som: v })
              if (v) {
                destravarSom()
                tocarSinal()
              }
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor="aviso-som" className="font-normal">
              {t("alertas.navegador.som")}
            </FieldLabel>
            <FieldDescription>{t("alertas.navegador.somDica")}</FieldDescription>
          </FieldContent>
        </Field>
        <p
          className={
            situacao.ok === false
              ? "flex items-start gap-2 rounded-md border border-atencao-borda bg-atencao-fundo px-3 py-2 text-atencao"
              : "flex items-start gap-2 text-muted-foreground"
          }
          role="status"
        >
          {situacao.ok === false ? (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : situacao.ok ? (
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          ) : null}
          <span>{situacao.texto}</span>
        </p>
        {mac ? <p className="text-xs text-muted-foreground">{t("alertas.navegador.mac")}</p> : null}
        <p className="text-xs text-muted-foreground">{t("alertas.navegador.abaAberta")}</p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={() => void testar()}>
          <BellRingIcon />
          {t("alertas.navegador.testar")}
        </Button>
        {ligado && suporte === "ok" && permissao === "default" ? (
          <Button variant="ghost" size="sm" onClick={() => void permitir()}>
            {t("alertas.navegador.permitir")}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
