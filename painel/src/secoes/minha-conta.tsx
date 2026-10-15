// Minha conta: perfil, idioma e tema, troca de senha com reautenticação, verificação em duas etapas (TOTP com QR),
// sessões abertas com "sair de todas" e o aparelho (instalar o app, testar notificação).

import * as React from "react"
import {
  BellRingIcon,
  DownloadIcon,
  LaptopIcon,
  LogOutIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SmartphoneIcon,
} from "lucide-react"
import { toast } from "sonner"

import { AtivarTotp, CampoCodigo } from "@/auth/telas"
import { problemaSenha } from "@/auth/auth"
import { useSessao } from "@/auth/sessao"
import { Confirmar } from "@/components/painel/confirmar"
import { Pagina } from "@/components/painel/pagina"
import { useTheme, type Tema } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { mensagemErro, useAcao, useAgora, useConsulta, useDados, useEstado } from "@/dados/contexto"
import type { Idioma } from "@/dados/tipos"
import { useT } from "@/i18n"
import { en, pt } from "@/i18n/dicionario"
import { fmtDataHora, fmtRelativo } from "@/lib/formato"
import { notificacaoDeTeste } from "@/pwa/notificacoes"
import { aoMudarInstalacao, jaInstalado, pedidoDeInstalacao } from "@/pwa/registrar"

export default function MinhaConta() {
  const { t } = useT()
  return (
    <Pagina titulo={t("menu.secoes.minhaConta")} descricao={t("minhaConta.descricao")}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Perfil />
          <Senha />
        </div>
        <div className="flex flex-col gap-4">
          <DuasEtapas />
          <Sessoes />
          <Aparelho />
        </div>
      </div>
    </Pagina>
  )
}

function Perfil() {
  const { t, idioma, setIdioma } = useT()
  const { theme, setTheme } = useTheme()
  const { eu } = useEstado()
  const { fonte } = useDados()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("minhaConta.perfil.titulo")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("minhaConta.perfil.nome")}</dt>
          <dd className="truncate">{eu.nome ?? "–"}</dd>
          <dt className="text-muted-foreground">{t("minhaConta.perfil.email")}</dt>
          <dd className="truncate">{eu.email}</dd>
          <dt className="text-muted-foreground">{t("minhaConta.perfil.papel")}</dt>
          <dd>
            <Badge variant="secondary">{t(`usuario.papel.${eu.papel}`)}</Badge>
          </dd>
        </dl>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="idioma">{t("minhaConta.preferencias.idioma")}</FieldLabel>
            <Select
              value={idioma}
              onValueChange={(v) => {
                setIdioma(v as Idioma)
                fonte
                  .meuIdioma(v as Idioma)
                  .then(() => toast.success((v === "en" ? en : pt).minhaConta.preferencias.salvo))
                  .catch(() => undefined)
              }}
            >
              <SelectTrigger id="idioma" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{t("minhaConta.preferencias.idiomaDica")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("minhaConta.preferencias.tema")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v as Tema)}>
              <ToggleGroupItem value="light">{t("usuario.claro")}</ToggleGroupItem>
              <ToggleGroupItem value="dark">{t("usuario.escuro")}</ToggleGroupItem>
              <ToggleGroupItem value="system">{t("usuario.sistema")}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function Senha() {
  const { t, tx } = useT()
  const { auth } = useSessao()
  const { eu } = useEstado()
  const [atual, setAtual] = React.useState("")
  const [nova, setNova] = React.useState("")
  const [repetir, setRepetir] = React.useState("")
  const [codigo, setCodigo] = React.useState("")
  const [erro, setErro] = React.useState<string | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("minhaConta.senha.titulo")}</CardTitle>
        <CardDescription>{t("minhaConta.senha.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="form-senha"
          onSubmit={async (e) => {
            e.preventDefault()
            if (nova !== repetir) return setErro(t("erros.senhas_diferentes"))
            const p = problemaSenha(nova, eu.email)
            if (p) return setErro(tx(`erros.senha_${p}`))
            setErro(null)
            setEnviando(true)
            try {
              await auth.trocarSenha(atual, nova, eu.totp ? codigo : undefined)
              toast.success(t("minhaConta.senha.feito"))
              setAtual("")
              setNova("")
              setRepetir("")
              setCodigo("")
            } catch (e) {
              setErro(mensagemErro(e, t, tx))
            } finally {
              setEnviando(false)
            }
          }}
        >
          <FieldGroup>
            <input type="text" autoComplete="username" value={eu.email} readOnly hidden />
            <Field>
              <FieldLabel htmlFor="senha-atual">{t("auth.senhaAtual")}</FieldLabel>
              <Input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                required
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="senha-nova">{t("auth.novaSenha")}</FieldLabel>
              <Input
                id="senha-nova"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
              />
              <FieldDescription>{t("auth.dicaSenha")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="senha-repetir">{t("auth.repetirSenha")}</FieldLabel>
              <Input
                id="senha-repetir"
                type="password"
                autoComplete="new-password"
                required
                value={repetir}
                onChange={(e) => setRepetir(e.target.value)}
              />
            </Field>
            {eu.totp ? (
              <Field>
                <FieldLabel>{t("minhaConta.senha.codigo")}</FieldLabel>
                <CampoCodigo valor={codigo} aoMudar={setCodigo} alinhar="inicio" />
              </Field>
            ) : null}
            {erro ? <FieldError>{erro}</FieldError> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="form-senha" disabled={enviando || (!!eu.totp && codigo.length !== 6)}>
          {enviando ? <Spinner /> : null}
          {t("minhaConta.senha.botao")}
        </Button>
      </CardFooter>
    </Card>
  )
}

function DuasEtapas() {
  const { t, tx, idioma } = useT()
  const { auth } = useSessao()
  const { eu, config } = useEstado()
  const { recarregar, fonte } = useDados()
  const acao = useAcao()
  const agora = useAgora(60_000)
  const [ativar, setAtivar] = React.useState(false)
  const [desligar, setDesligar] = React.useState(false)
  const admin = eu.papel === "admin"
  const obrigatoria = admin && config.exigirDuasEtapas
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {eu.totp ? (
            <ShieldCheckIcon className="size-4 text-ok" aria-hidden />
          ) : (
            <ShieldIcon className="size-4" aria-hidden />
          )}
          {t("minhaConta.totp.titulo")}
        </CardTitle>
        <CardDescription>
          {eu.totp
            ? t("minhaConta.totp.ativa", { quando: fmtRelativo(eu.totp.criadoEm, agora, idioma) })
            : t("minhaConta.totp.inativa")}
          {obrigatoria ? ` ${t("minhaConta.totp.obrigatoria")}` : ""}
        </CardDescription>
        <CardAction>
          {eu.totp ? (
            obrigatoria ? (
              <Badge variant="outline" className="border-ok/30 bg-ok-fundo text-ok">
                {t("comum.ligado")}
              </Badge>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setDesligar(true)}>
                {t("minhaConta.totp.desligar")}
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => setAtivar(true)}>
              {t("minhaConta.totp.ativar")}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      {admin ? (
        <CardContent>
          <Field orientation="horizontal">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="exigir-duas-etapas">{t("minhaConta.totp.exigir")}</FieldLabel>
              <FieldDescription>{t("minhaConta.totp.exigirDica")}</FieldDescription>
            </div>
            <Switch
              id="exigir-duas-etapas"
              checked={config.exigirDuasEtapas}
              disabled={!eu.totp && !config.exigirDuasEtapas}
              onCheckedChange={(v) => void acao(() => fonte.salvarConfig({ exigirDuasEtapas: v }))}
            />
          </Field>
        </CardContent>
      ) : null}
      <Dialog open={ativar} onOpenChange={setAtivar}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("minhaConta.totp.dialogo")}</DialogTitle>
            <DialogDescription>{t("auth.ativar.descricao")}</DialogDescription>
          </DialogHeader>
          {ativar ? (
            <AtivarTotp
              aoConcluir={() => {
                setAtivar(false)
                toast.success(t("minhaConta.totp.ligada"))
                void recarregar()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Confirmar
        aberto={desligar}
        aoFechar={() => setDesligar(false)}
        titulo={t("minhaConta.totp.confirmarDesligar.titulo")}
        texto={t("minhaConta.totp.confirmarDesligar.texto")}
        botao={t("minhaConta.totp.confirmarDesligar.botao")}
        botaoSegurar={t("minhaConta.totp.confirmarDesligar.botaoSegurar")}
        aoConfirmar={async () => {
          try {
            if (eu.totp) await auth.totpRemover(eu.totp.fatorId)
            toast.success(t("minhaConta.totp.desligada"))
            void recarregar()
          } catch (e) {
            toast.error(mensagemErro(e, t, tx))
          }
        }}
      />
    </Card>
  )
}

function Sessoes() {
  const { t, tx, idioma } = useT()
  const { fonte } = useDados()
  const { sair } = useSessao()
  const agora = useAgora(60_000)
  const lista = useConsulta((f) => (f.recursos.listarSessoes ? f.minhasSessoes() : Promise.resolve([])), [])
  const [confirmar, setConfirmar] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("minhaConta.sessoes.titulo")}</CardTitle>
        <CardDescription>{t("minhaConta.sessoes.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!fonte.recursos.listarSessoes ? (
          <p className="text-sm text-muted-foreground">{t("minhaConta.sessoes.semLista")}</p>
        ) : !lista.dados ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y">
            {lista.dados.map((s) => {
              const Icone = s.aparelho === "celular_app" ? SmartphoneIcon : LaptopIcon
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Icone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {tx(`minhaConta.sessoes.aparelhos.${s.aparelho}`)}
                      {s.atual ? (
                        <Badge variant="secondary" className="ml-2">
                          {t("minhaConta.sessoes.atual")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground" title={fmtDataHora(s.criadaEm, agora, idioma)}>
                      {t("minhaConta.sessoes.ultima", { quando: fmtRelativo(s.ultimaVez, agora, idioma) })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={() => setConfirmar(true)}>
          <LogOutIcon />
          {t("minhaConta.sessoes.sairTodas")}
        </Button>
      </CardFooter>
      <Confirmar
        aberto={confirmar}
        aoFechar={() => setConfirmar(false)}
        titulo={t("minhaConta.sessoes.confirmar.titulo")}
        texto={t("minhaConta.sessoes.confirmar.texto")}
        botao={t("minhaConta.sessoes.confirmar.botao")}
        botaoSegurar={t("minhaConta.sessoes.confirmar.botaoSegurar")}
        aoConfirmar={() => sair(true)}
      />
    </Card>
  )
}

function Aparelho() {
  const { t, tx } = useT()
  const [, forcar] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => aoMudarInstalacao(forcar), [])
  const pedido = pedidoDeInstalacao()
  const instalado = jaInstalado()
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("minhaConta.aparelho.titulo")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            {instalado
              ? t("minhaConta.aparelho.instalado")
              : ios
                ? t("minhaConta.aparelho.ios")
                : t("minhaConta.aparelho.instalarDica")}
          </p>
          {!instalado && !ios && !pedido ? (
            <p className="text-xs text-muted-foreground">{t("minhaConta.aparelho.instalarMenu")}</p>
          ) : null}
          {!instalado && !ios && pedido ? (
            <Button
              variant="outline"
              className="self-start"
              onClick={async () => {
                await pedido?.prompt()
                forcar()
              }}
            >
              <DownloadIcon />
              {t("minhaConta.aparelho.instalar")}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">{t("minhaConta.aparelho.testarPushDica")}</p>
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              notificacaoDeTeste(t("minhaConta.aparelho.pushTitulo"), t("minhaConta.aparelho.pushCorpo")).catch((e) =>
                toast.error(mensagemErro(e, t, tx))
              )
            }
          >
            <BellRingIcon />
            {t("minhaConta.aparelho.testarPush")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
