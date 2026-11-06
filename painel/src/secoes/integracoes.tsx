// Integrações: chaves de API com escopo (a chave inteira aparece uma vez), webhooks de saída e exemplos prontos de
// curl, n8n e script.

import * as React from "react"
import { KeyRoundIcon, PlusIcon, SendIcon, ShieldOffIcon, TriangleAlertIcon, WebhookIcon } from "lucide-react"

import { BotaoCopiar, Codigo } from "@/components/painel/copiar"
import { Confirmar } from "@/components/painel/confirmar"
import { Pagina, PedidoDuasEtapas, useFalta2fa } from "@/components/painel/pagina"
import { CartaoLuz } from "@/components/rb"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { mensagemErro, useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import type { ChaveApi, EscopoChave, WebhookSaida } from "@/dados/tipos"
import { useDialogo } from "@/hooks/use-dialogo"
import { useT } from "@/i18n"
import { toast } from "sonner"
import { fmtRelativo } from "@/lib/formato"

// Só o que a nuvem manda para fora (alertas_pendentes): aviso e conexão são do computador e nunca saíam, por isso
// deixaram a lista; webhook antigo que os tenha continua mostrando o nome.
const EVENTOS_WEBHOOK = [
  "troca",
  "limite",
  "sem_livre",
  "folga_acabando",
  "troca_falhou",
  "precisa_login",
  "computador_parado",
  "atualizacao_falhou",
] as const

function baseApi() {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "") || "https://SEU-PROJETO.supabase.co"
  return `${url}/functions/v1/api`
}

export default function Integracoes() {
  const { t } = useT()
  return (
    <Pagina titulo={t("menu.secoes.integracoes")} descricao={t("integracoes.descricao")}>
      <div className="grid gap-4 xl:grid-cols-2">
        <Chaves />
        <Webhooks />
      </div>
      <Exemplos />
    </Pagina>
  )
}

function Chaves() {
  const { t, idioma } = useT()
  const estado = useEstado()
  const agora = useAgora(60_000)
  const { fonte } = useDados()
  const acao = useAcao()
  const nova = useDialogo()
  const [revogar, setRevogar] = React.useState<ChaveApi | null>(null)
  // Leitura também cria chave (só com o escopo "ler"); a função do banco exige a verificação em duas etapas.
  const podeCriar = estado.eu.aal === "aal2"
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integracoes.chaves.titulo")}</CardTitle>
        <CardDescription>{t("integracoes.chaves.descricao")}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => nova.abrir()} disabled={!podeCriar}>
            <PlusIcon />
            {t("integracoes.chaves.nova")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {estado.chaves.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("integracoes.chaves.vazio")}</p>
        ) : (
          <ul className="divide-y">
            {estado.chaves.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <KeyRoundIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.nome}</span>
                    {c.revogada ? <Badge variant="outline">{t("integracoes.chaves.revogada")}</Badge> : null}
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">{c.prefixo}_••••••••</code>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {c.escopos.map((e) => (
                      <Badge key={e} variant="secondary" className="font-mono">
                        {t(`integracoes.chaves.escopos.${e}`)}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {t("integracoes.chaves.criada", { quando: fmtRelativo(c.criadaEm, agora, idioma) })} ·{" "}
                      {c.usadaEm
                        ? t("integracoes.chaves.usada", { quando: fmtRelativo(c.usadaEm, agora, idioma) })
                        : t("integracoes.chaves.nuncaUsada")}
                    </span>
                  </div>
                </div>
                {!c.revogada ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRevogar(c)}
                    aria-label={t("integracoes.chaves.revogar.botao")}
                    disabled={!podeCriar}
                  >
                    <ShieldOffIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <NovaChave key={nova.chave} aberto={nova.aberto} aoFechar={nova.fechar} />
      <Confirmar
        aberto={!!revogar}
        aoFechar={() => setRevogar(null)}
        titulo={t("integracoes.chaves.revogar.titulo", { nome: revogar?.nome ?? "" })}
        texto={t("integracoes.chaves.revogar.texto")}
        botao={t("integracoes.chaves.revogar.botao")}
        botaoSegurar={t("integracoes.chaves.revogar.botaoSegurar")}
        aoConfirmar={() =>
          revogar ? acao(() => fonte.revogarChave(revogar.id), t("integracoes.chaves.revogar.feito")) : undefined
        }
      />
    </Card>
  )
}

function NovaChave({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const admin = estado.eu.papel === "admin"
  const [nome, setNome] = React.useState("")
  const [escopos, setEscopos] = React.useState<EscopoChave[]>(["ler"])
  const [chave, setChave] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {chave ? t("integracoes.chaves.dialogo.pronta") : t("integracoes.chaves.dialogo.titulo")}
          </DialogTitle>
          {!chave ? <DialogDescription>{t("integracoes.chaves.dialogo.descricao")}</DialogDescription> : null}
        </DialogHeader>
        {chave ? (
          <div className="flex flex-col gap-3">
            <Alert className="border-atencao-borda bg-atencao-fundo text-atencao *:data-[slot=alert-description]:text-atencao/90">
              <TriangleAlertIcon />
              <AlertDescription>{t("integracoes.chaves.dialogo.prontaTexto")}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-md border bg-muted/50 px-2 py-2 font-mono text-xs break-all">
                {chave}
              </code>
              <BotaoCopiar texto={chave} />
            </div>
          </div>
        ) : (
          <form
            id="form-chave"
            onSubmit={async (e) => {
              e.preventDefault()
              setEnviando(true)
              const [ok, r] = await acao(() => fonte.criarChave(nome, escopos))
              setEnviando(false)
              if (ok) setChave(r.chave)
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="chave-nome">{t("integracoes.chaves.dialogo.nome")}</FieldLabel>
                <Input
                  id="chave-nome"
                  required
                  maxLength={80}
                  value={nome}
                  placeholder={t("integracoes.chaves.dialogo.nomeExemplo")}
                  onChange={(e) => setNome(e.target.value)}
                />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">{t("integracoes.chaves.dialogo.escopos")}</FieldLegend>
                <FieldGroup className="gap-3">
                  {(["ler", "trocar", "config"] as const).map((e) => {
                    const bloqueado = e !== "ler" && !admin
                    return (
                      <Field key={e} orientation="horizontal" data-disabled={bloqueado || undefined}>
                        <Checkbox
                          id={`escopo-${e}`}
                          checked={escopos.includes(e)}
                          disabled={bloqueado}
                          onCheckedChange={(v) => setEscopos((x) => (v ? [...x, e] : x.filter((y) => y !== e)))}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={`escopo-${e}`} className="font-mono">
                            {t(`integracoes.chaves.escopos.${e}`)}
                            {e !== "ler" ? (
                              <span className="font-sans font-normal text-muted-foreground">
                                {" "}
                                ({t("integracoes.chaves.escopos.soAdmin")})
                              </span>
                            ) : null}
                          </FieldLabel>
                          <FieldDescription>{t(`integracoes.chaves.escopos.${e}Dica`)}</FieldDescription>
                        </FieldContent>
                      </Field>
                    )
                  })}
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          {chave ? (
            <Button onClick={aoFechar}>{t("comum.fechar")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button type="submit" form="form-chave" disabled={enviando || !nome.trim() || !escopos.length}>
                {enviando ? <Spinner /> : null}
                {t("integracoes.chaves.dialogo.criar")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Webhooks() {
  const { t } = useT()
  const estado = useEstado()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  const novo = useDialogo()
  const falta2fa = useFalta2fa()
  const admin = estado.eu.papel === "admin"
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integracoes.webhooks.titulo")}</CardTitle>
        <CardDescription>{t("integracoes.webhooks.descricao")}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => novo.abrir()} disabled={!pode}>
            <PlusIcon />
            {t("integracoes.webhooks.novo")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!admin ? (
          <p className="text-sm text-muted-foreground">{t("permissao.leituraTexto")}</p>
        ) : falta2fa ? (
          <PedidoDuasEtapas />
        ) : estado.webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("integracoes.webhooks.vazio")}</p>
        ) : (
          <ul className="divide-y">
            {estado.webhooks.map((w) => (
              <LinhaWebhook
                key={w.id}
                webhook={w}
                pode={pode}
                aoMudar={(ativo) => void acao(() => fonte.mudarWebhook(w, { ativo }))}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <NovoWebhook key={novo.chave} aberto={novo.aberto} aoFechar={novo.fechar} />
    </Card>
  )
}

function LinhaWebhook({
  webhook,
  pode,
  aoMudar,
}: {
  webhook: WebhookSaida
  pode: boolean
  aoMudar: (ativo: boolean) => void
}) {
  const { t, tx } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <WebhookIcon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <code className="block truncate font-mono text-xs">{webhook.url}</code>
        <div className="mt-1 flex flex-wrap gap-1">
          {webhook.eventos.map((e) => (
            <Badge key={e} variant="secondary">
              {tx(`integracoes.webhooks.eventos.${e}`)}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {fonte.recursos.testarWebhook ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!pode || !webhook.ativo}
            aria-label={t("comum.testar")}
            onClick={() =>
              void acao(() => fonte.testarWebhook(webhook.id), t("integracoes.webhooks.testado", { url: webhook.url }))
            }
          >
            <SendIcon />
          </Button>
        ) : null}
        <Switch checked={webhook.ativo} onCheckedChange={aoMudar} disabled={!pode} aria-label={t("comum.ativo")} />
      </div>
    </li>
  )
}

function NovoWebhook({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { t, tx } = useT()
  const { fonte } = useDados()
  const { recarregar } = useDados()
  const [erro, setErro] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState("")
  const [eventos, setEventos] = React.useState<string[]>(["troca", "limite", "sem_livre", "troca_falhou"])
  const [enviando, setEnviando] = React.useState(false)
  const [segredo, setSegredo] = React.useState<string | null>(null)
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("integracoes.webhooks.dialogo.titulo")}</DialogTitle>
          <DialogDescription>{t("integracoes.webhooks.descricao")}</DialogDescription>
        </DialogHeader>
        {segredo ? (
          <div className="flex flex-col gap-3">
            <Alert className="border-atencao-borda bg-atencao-fundo text-atencao *:data-[slot=alert-description]:text-atencao/90">
              <TriangleAlertIcon />
              <AlertDescription>{t("integracoes.webhooks.dialogo.segredoTexto")}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-md border bg-muted/50 px-2 py-2 font-mono text-xs break-all">
                {segredo}
              </code>
              <BotaoCopiar texto={segredo} />
            </div>
          </div>
        ) : (
          <form
            id="form-webhook"
            onSubmit={async (e) => {
              e.preventDefault()
              setEnviando(true)
              setErro(null)
              try {
                // O banco aceita só https público; a mensagem dele aparece aqui no formulário.
                const r = await fonte.criarWebhook(url, eventos)
                toast.success(t("integracoes.webhooks.dialogo.criado"))
                void recarregar()
                if (r.segredo) setSegredo(r.segredo)
                else aoFechar()
              } catch (e) {
                setErro(mensagemErro(e, t, tx))
              } finally {
                setEnviando(false)
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="webhook-url">{t("integracoes.webhooks.dialogo.url")}</FieldLabel>
                <Input
                  id="webhook-url"
                  type="url"
                  required
                  pattern="https://.+"
                  placeholder="https://"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              {erro ? <FieldError>{erro}</FieldError> : null}
              <FieldSet>
                <FieldLegend variant="label">{t("integracoes.webhooks.dialogo.eventos")}</FieldLegend>
                <div className="grid grid-cols-2 gap-2">
                  {EVENTOS_WEBHOOK.map((e) => (
                    <Field key={e} orientation="horizontal">
                      <Checkbox
                        id={`wh-${e}`}
                        checked={eventos.includes(e)}
                        onCheckedChange={(v) => setEventos((x) => (v ? [...x, e] : x.filter((y) => y !== e)))}
                      />
                      <FieldLabel htmlFor={`wh-${e}`} className="font-normal">
                        {t(`integracoes.webhooks.eventos.${e}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </FieldSet>
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          {segredo ? (
            <Button onClick={aoFechar}>{t("comum.fechar")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button type="submit" form="form-webhook" disabled={enviando || !eventos.length}>
                {enviando ? <Spinner /> : null}
                {t("integracoes.webhooks.dialogo.criar")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Exemplos() {
  const { t } = useT()
  const base = baseApi()
  const curl = `# ${t("integracoes.exemplos.estado")}
curl -s ${base}/estado \\
  -H "Authorization: Bearer $REVEZA_CHAVE"

# ${t("integracoes.exemplos.uso")}
curl -s "${base}/uso?dias=7" \\
  -H "Authorization: Bearer $REVEZA_CHAVE"

# ${t("integracoes.exemplos.trocar")}
curl -s -X POST ${base}/trocar \\
  -H "Authorization: Bearer $REVEZA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"computador":"<${t("integracoes.exemplos.idComputador")}>","conta":"<${t("integracoes.exemplos.idConta")}>"}'

# ${t("integracoes.exemplos.config")}
curl -s -X POST ${base}/config \\
  -H "Authorization: Bearer $REVEZA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"chave":"auto","valor":false}'`
  const script = `// node reveza.mjs   (${t("integracoes.exemplos.nodeVersao")})
const base = "${base}"
const chave = process.env.REVEZA_CHAVE

const r = await fetch(\`\${base}/estado\`, {
  headers: { Authorization: \`Bearer \${chave}\` },
})
if (!r.ok) throw new Error(\`HTTP \${r.status}\`)
const estado = await r.json()
for (const pc of estado.computadores) console.log(pc.nome, "→", pc.conta ?? "–")
for (const c of estado.contas) console.log(c.email, \`\${Math.round(c.pct ?? 0)}%\`)`
  const python = `# python3 reveza.py
import json, os, urllib.request

base = "${base}"
pedido = urllib.request.Request(
    f"{base}/estado",
    headers={"Authorization": f"Bearer {os.environ['REVEZA_CHAVE']}"},
)
estado = json.load(urllib.request.urlopen(pedido))
for pc in estado["computadores"]:
    print(pc["nome"], "->", pc["conta"])
for conta in estado["contas"]:
    print(conta["email"], f"{round(conta['pct'] or 0)}%")`
  const n8n = JSON.stringify(
    {
      nodes: [
        {
          parameters: { httpMethod: "POST", path: "reveza", options: {} },
          name: t("integracoes.exemplos.n8nEvento"),
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [0, 0],
        },
        {
          parameters: {
            url: `${base}/estado`,
            sendHeaders: true,
            headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{ $env.REVEZA_CHAVE }}" }] },
            options: {},
          },
          name: t("integracoes.exemplos.estado"),
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          position: [240, 0],
        },
      ],
      connections: {
        [t("integracoes.exemplos.n8nEvento")]: {
          main: [[{ node: t("integracoes.exemplos.estado"), type: "main", index: 0 }]],
        },
      },
    },
    null,
    2
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integracoes.exemplos.titulo")}</CardTitle>
        <CardDescription>{t("integracoes.exemplos.descricao", { chave: "$REVEZA_CHAVE" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">{t("integracoes.exemplos.curl")}</TabsTrigger>
            <TabsTrigger value="n8n">{t("integracoes.exemplos.n8n")}</TabsTrigger>
            <TabsTrigger value="script">{t("integracoes.exemplos.script")}</TabsTrigger>
            <TabsTrigger value="python">{t("integracoes.exemplos.python")}</TabsTrigger>
          </TabsList>
          <TabsContent value="curl" className="pt-2">
            <Codigo texto={curl} />
          </TabsContent>
          <TabsContent value="n8n" className="flex flex-col gap-2 pt-2">
            <p className="text-sm text-muted-foreground">{t("integracoes.exemplos.n8nTexto")}</p>
            <Codigo texto={n8n} className="[&_pre]:max-h-72" />
          </TabsContent>
          <TabsContent value="script" className="pt-2">
            <Codigo texto={script} />
          </TabsContent>
          <TabsContent value="python" className="pt-2">
            <Codigo texto={python} />
          </TabsContent>
        </Tabs>
        <CartaoLuz className="text-sm text-muted-foreground">
          <p>{t("integracoes.exemplos.dependeApi")}</p>
        </CartaoLuz>
      </CardContent>
    </Card>
  )
}
