// Conectar uma conta nova ou entrar de novo numa conta: o painel só pede; quem abre o login oficial é um computador
// (comando "conectar" ou "entrar_de_novo" com o e-mail), numa janela anônima do navegador dele, e termina sozinho quando
// a pessoa entra na conta. O endereço que o painel mostra é para outro aparelho: lá a página dá um código, que vai por
// "codigo_login".

import * as React from "react"
import { CheckCircle2Icon, ExternalLinkIcon, Loader2Icon, XCircleIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { BotaoCopiar } from "@/components/painel/copiar"
import { useAcao, useAgora, useDados, useEstado } from "@/dados/contexto"
import { estadoComputador } from "@/dados/derivados"
import type { Comando, Conta } from "@/dados/tipos"
import { useT } from "@/i18n"

/** Os domínios do login oficial. O Claude Code 2.1.29x passou a abrir o login em claude.com (antes, claude.ai): sem ele
 * aqui, o painel jogava fora o endereço e a pessoa ficava sem o botão de abrir o login (relato de usuário, 12/10/2026). */
const DOMINIOS_DO_LOGIN = ["claude.ai", "claude.com", "anthropic.com"]

/** Só abre endereço do login oficial: quem manda a resposta é um computador, e o painel não abre link qualquer. */
export function urlDeLogin(v: unknown): string | null {
  if (typeof v !== "string") return null
  try {
    const u = new URL(v)
    const host = u.hostname.toLowerCase()
    const oficial = DOMINIOS_DO_LOGIN.some((d) => host === d || host.endsWith(`.${d}`))
    return u.protocol === "https:" && !u.username && !u.password && !u.port && oficial ? u.toString() : null
  } catch {
    return null
  }
}

/** Onde o login abriu no computador (agente 0.3.4+): o painel diz "janela anônima do Chrome", e não "se não abriu". */
export type JanelaDoLogin = { aberto: boolean; navegador: string | null; privado: boolean }

export function janelaDoLogin(v: unknown): JanelaDoLogin | null {
  if (!v || typeof v !== "object") return null
  const j = v as Record<string, unknown>
  if (typeof j.aberto !== "boolean" || typeof j.privado !== "boolean") return null
  const navegador = typeof j.navegador === "string" && /^[A-Za-z ]{1,40}$/.test(j.navegador) ? j.navegador : null
  return { aberto: j.aberto, navegador, privado: j.privado }
}

/** Acompanha um comando até ele terminar (o computador busca a cada 5 s). */
export function useComando(id: number | null) {
  const { fonte } = useDados()
  const [lido, setLido] = React.useState<Comando | null>(null)
  React.useEffect(() => {
    if (id === null) return
    let vivo = true
    const fim = Date.now() + 5 * 60_000
    const ler = async () => {
      const c = await fonte.lerComando(id).catch(() => null)
      if (!vivo) return
      if (c) setLido(c)
      if (c && ["feito", "recusado", "expirado"].includes(c.estado)) return
      if (Date.now() < fim) setTimeout(ler, 1500)
    }
    void ler()
    return () => {
      vivo = false
    }
  }, [fonte, id])
  return lido && lido.id === id ? lido : null
}

function textoDaJanela(
  t: ReturnType<typeof useT>["t"],
  janela: JanelaDoLogin,
  computador: string,
  email: string
): string {
  if (!janela.aberto) return t("contas.login.janela.naoAbriu", { computador })
  if (!janela.privado) return t("contas.login.janela.normal", { computador, email })
  return janela.navegador
    ? t("contas.login.janela.anonimaDo", { navegador: janela.navegador, computador, email })
    : t("contas.login.janela.anonima", { computador, email })
}

export function DialogoLogin({
  aberto,
  aoFechar,
  conta,
}: {
  aberto: boolean
  aoFechar: () => void
  /** Sem conta: conectar uma nova. Com conta: entrar de novo nela. */
  conta?: Conta
}) {
  const { t } = useT()
  const { fonte, atualizadoEm } = useDados()
  const estado = useEstado()
  const agora = useAgora(5000)
  const acao = useAcao()
  const ligados = estado.computadores.filter((c) => estadoComputador(c, agora, atualizadoEm) === "online")
  // quem abre passa key={chave da abertura}: o formulário nasce limpo a cada vez
  const [email, setEmail] = React.useState(conta?.email ?? "")
  const [pc, setPc] = React.useState<string>(() => ligados[0]?.id ?? "")
  const [cmdId, setCmdId] = React.useState<number | null>(null)
  const [codigo, setCodigo] = React.useState("")
  const [enviando, setEnviando] = React.useState(false)
  const cmd = useComando(cmdId)
  // A resposta do "conectar" traz o login aberto no computador: o id (para mandar o código) e o endereço oficial.
  const loginId = typeof cmd?.resposta?.login_id === "string" ? cmd.resposta.login_id : null
  const url = urlDeLogin(cmd?.resposta?.url)
  const janela = janelaDoLogin(cmd?.resposta?.janela)
  const nomePc = estado.computadores.find((c) => c.id === pc)?.nome ?? ""
  // Conectada de verdade: a conta nova apareceu, ou a que pedia login deixou de pedir (comparando com o pedido).
  const [antes, setAntes] = React.useState<{ existia: boolean; precisava: boolean } | null>(null)
  const alvo = estado.contas.find((c) => c.email === email.trim().toLowerCase())
  const conectada = !!cmdId && !!antes && !!alvo && !alvo.precisaLogin && (antes.existia ? antes.precisava : true)

  const pedir = async () => {
    const atual = estado.contas.find((c) => c.email === email.trim().toLowerCase())
    setAntes({ existia: !!atual, precisava: !!atual?.precisaLogin })
    setEnviando(true)
    const [ok, c] = await acao(() =>
      fonte.comando(pc, conta ? "entrar_de_novo" : "conectar", { email: email.trim().toLowerCase() })
    )
    setEnviando(false)
    if (ok) setCmdId(c.id)
  }

  const estadoCmd = cmd?.estado ?? (cmdId ? "pendente" : null)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {conta ? t("contas.login.tituloEntrar", { conta: conta.email }) : t("contas.login.tituloConectar")}
          </DialogTitle>
          <DialogDescription>{t("contas.login.descricao")}</DialogDescription>
        </DialogHeader>
        {!cmdId ? (
          <form
            id="form-login"
            onSubmit={(e) => {
              e.preventDefault()
              void pedir()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="login-email">{t("contas.login.email")}</FieldLabel>
                <Input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  readOnly={!!conta}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("contas.login.emailExemplo")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="login-pc">{t("contas.login.computador")}</FieldLabel>
                {ligados.length ? (
                  <Select value={pc} onValueChange={setPc}>
                    <SelectTrigger id="login-pc" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ligados.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Alert>
                    <AlertDescription>{t("contas.login.semComputador")}</AlertDescription>
                  </Alert>
                )}
              </Field>
            </FieldGroup>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg border p-3 text-sm" role="status" aria-live="polite">
              {estadoCmd === "feito" ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-ok" />
              ) : estadoCmd === "recusado" || estadoCmd === "expirado" ? (
                <XCircleIcon className="mt-0.5 size-4 shrink-0 text-erro" />
              ) : (
                <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              <span>
                {conectada
                  ? t("contas.login.conectada")
                  : estadoCmd === "feito" && janela
                    ? textoDaJanela(t, janela, nomePc, email.trim().toLowerCase())
                    : estadoCmd
                      ? t(`contas.login.estados.${estadoCmd}`)
                      : null}
              </span>
            </div>
            {estadoCmd === "feito" && url && !conectada ? (
              <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                <p>{janela?.aberto ? t("contas.login.outroAparelho") : t("contas.login.abrirAqui")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon data-icon="inline-start" />
                      {t("contas.login.abrirLogin")}
                    </a>
                  </Button>
                  <BotaoCopiar texto={url} rotulo={t("contas.login.copiarLogin")} />
                </div>
                {janela?.privado ? null : <p className="text-xs">{t("contas.login.anonima")}</p>}
              </div>
            ) : null}
            {estadoCmd === "feito" && !url && !conectada ? (
              <p className="text-sm text-muted-foreground">{t("contas.login.semEndereco", { email: email.trim().toLowerCase() })}</p>
            ) : null}
            {estadoCmd === "feito" && !conectada ? (
              <p className="text-xs text-muted-foreground">{t("contas.login.terminal", { email: email.trim().toLowerCase() })}</p>
            ) : null}
            {estadoCmd === "feito" && loginId && !conectada ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const [ok] = await acao(
                    () => fonte.comando(pc, "codigo_login", { login_id: loginId, codigo: codigo.trim() }),
                    t("contas.login.codigoEnviado")
                  )
                  if (ok) setCodigo("")
                }}
              >
                <FieldLabel htmlFor="login-codigo">{t("contas.login.codigo")}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="login-codigo"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                  />
                  <Button type="submit" variant="outline" disabled={!codigo.trim()}>
                    {t("contas.login.enviarCodigo")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        )}
        <DialogFooter>
          {!cmdId ? (
            <>
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button type="submit" form="form-login" disabled={!pc || !email || enviando}>
                {enviando ? <Spinner /> : null}
                {t("contas.login.enviar")}
              </Button>
            </>
          ) : conectada || estadoCmd === "recusado" || estadoCmd === "expirado" ? (
            <Button onClick={aoFechar}>{t("comum.fechar")}</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={async () => {
                  if (loginId) await acao(() => fonte.comando(pc, "cancelar_login", { login_id: loginId }))
                  aoFechar()
                }}
              >
                {t("contas.login.cancelar")}
              </Button>
              <Button onClick={aoFechar}>{t("comum.fechar")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
