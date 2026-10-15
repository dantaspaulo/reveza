import * as React from "react"
import { CloudOffIcon, FlaskConicalIcon, LogOutIcon, RefreshCwIcon, RotateCwIcon, UserXIcon } from "lucide-react"

import { AuthDemo, type Autenticacao } from "@/auth/auth"
import { SessaoProvider, useSessao } from "@/auth/sessao"
import { AppSidebar } from "@/components/app-sidebar"
import { AvisoAbaDescartada } from "@/components/painel/aviso-aba"
import { BotaoCopiar } from "@/components/painel/copiar"
import { Logo } from "@/components/painel/logo"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { DadosProvider, useDados } from "@/dados/contexto"
import { FonteDemo } from "@/dados/demo"
import { ErroPainel, type Fonte } from "@/dados/fonte"
import { idiomaGuardado, useT } from "@/i18n"
import { comDemo, emDemo, temNuvem } from "@/lib/demo"
import { comRecarga, detalhesDaFalha, ehFalhaDeCarga, telaPreguicosa } from "@/lib/falha"
import { useRota } from "@/lib/rota"
import { ROTAS_AUTH, secaoDoCaminho, type IdSecao } from "@/secoes/rotas"

// Cada seção é um pedaço do build carregado quando a tela abre. Uma aba aberta antes de uma versão nova pede pedaços
// que não existem mais: telaPreguicosa recarrega a página uma vez em vez de mostrar a tela quebrada.
const SECOES: Record<IdSecao, React.LazyExoticComponent<React.ComponentType>> = {
  visao: telaPreguicosa(() => import("@/secoes/visao-geral")),
  contas: telaPreguicosa(() => import("@/secoes/contas")),
  computadores: telaPreguicosa(() => import("@/secoes/computadores")),
  uso: telaPreguicosa(() => import("@/secoes/uso")),
  plano: telaPreguicosa(() => import("@/secoes/plano")),
  troca: telaPreguicosa(() => import("@/secoes/troca")),
  alertas: telaPreguicosa(() => import("@/secoes/alertas")),
  integracoes: telaPreguicosa(() => import("@/secoes/integracoes")),
  time: telaPreguicosa(() => import("@/secoes/time")),
  minhaConta: telaPreguicosa(() => import("@/secoes/minha-conta")),
  comoFunciona: telaPreguicosa(() => import("@/secoes/como-funciona")),
  saude: telaPreguicosa(() => import("@/secoes/saude")),
}

const TelasAuth = telaPreguicosa(() => import("@/auth/telas"))

export default function App() {
  const demo = emDemo()
  const [nucleo, setNucleo] = React.useState<{ auth: Autenticacao; fonte: Fonte } | null>(() =>
    demo ? { auth: new AuthDemo(), fonte: new FonteDemo({ idioma: idiomaGuardado() }) } : null
  )

  React.useEffect(() => {
    if (demo || !temNuvem()) return
    // O cliente do Supabase só carrega quando há nuvem (a demonstração não baixa nada dele).
    void comRecarga(() => Promise.all([import("@/auth/auth-supabase"), import("@/dados/supabase")]))()
      .then(([a, f]) => setNucleo({ auth: new a.AuthSupabase(), fonte: new f.FonteSupabase() }))
      .catch((e) => console.error("carregar o painel", e))
  }, [demo])

  return <ComNucleo nucleo={nucleo} demo={demo} />
}

function ComNucleo({ nucleo, demo }: { nucleo: { auth: Autenticacao; fonte: Fonte } | null; demo: boolean }) {
  if (!demo && !temNuvem()) return <SemNuvem />
  if (!nucleo) return <Carregando />
  return (
    <SessaoProvider auth={nucleo.auth}>
      <Portao fonte={nucleo.fonte} />
    </SessaoProvider>
  )
}

/** Decide entre as telas de entrada e o painel, pelo estado da sessão e pelo endereço. */
function Portao({ fonte }: { fonte: Fonte }) {
  const { estado } = useSessao()
  const { caminho } = useRota()
  const demo = emDemo()
  const rotaAuth = (ROTAS_AUTH as readonly string[]).includes(caminho)

  if (!estado) return <Carregando />
  // Na demonstração as telas de entrada abrem pelo endereço, para ver como são.
  if (demo && rotaAuth)
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth />
      </React.Suspense>
    )
  if (!estado.logado || estado.recuperacao || estado.falta2fa || (rotaAuth && caminho !== "/ativar-duas-etapas"))
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth />
      </React.Suspense>
    )
  return (
    <DadosProvider fonte={fonte}>
      <Painel />
    </DadosProvider>
  )
}

function Painel() {
  const { t } = useT()
  const { estado, erro, recarregar } = useDados()
  const { caminho } = useRota()
  const { sair } = useSessao()

  if (!estado) {
    if (erro instanceof ErroPainel && erro.codigo === "nao_membro")
      return (
        <TelaCheia>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserXIcon />
              </EmptyMedia>
              <EmptyTitle>{t("app.naoMembroTitulo")}</EmptyTitle>
              <EmptyDescription>{t("app.naoMembroTexto")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void sair()}>
                <LogOutIcon />
                {t("app.sair")}
              </Button>
            </EmptyContent>
          </Empty>
        </TelaCheia>
      )
    if (erro)
      return (
        <TelaCheia>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CloudOffIcon />
              </EmptyMedia>
              <EmptyTitle>{t("app.erroCarregar")}</EmptyTitle>
              <EmptyDescription>{erro.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => void recarregar()}>
                <RefreshCwIcon />
                {t("app.tentarDeNovo")}
              </Button>
            </EmptyContent>
          </Empty>
        </TelaCheia>
      )
    return <Carregando />
  }

  // Admin sem verificação em duas etapas: obrigatória quando a instalação exige; senão, oferecida uma vez, com "pular".
  if (
    estado.eu.papel === "admin" &&
    !estado.eu.totp &&
    (estado.config.exigirDuasEtapas || !pulouDuasEtapas(estado.eu.userId))
  )
    return (
      <React.Suspense fallback={<Carregando />}>
        <TelasAuth
          obrigarTotp
          pular={estado.config.exigirDuasEtapas ? undefined : () => pularDuasEtapas(estado.eu.userId)}
        />
      </React.Suspense>
    )

  const secao = secaoDoCaminho(caminho) ?? secaoDoCaminho("/")!
  const Secao = SECOES[secao.id]
  return (
    <SidebarProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {t("app.pularConteudo")}
      </a>
      <AppSidebar />
      {/* a aba que o navegador descartou para poupar memória volta recarregada: diz que nada parou */}
      <AvisoAbaDescartada />
      <SidebarInset className="min-w-0">
        <SiteHeader titulo={t(`menu.secoes.${secao.id}`)} />
        <main id="conteudo" className="min-w-0 flex-1">
          <ProtecaoSecao key={secao.id}>
            <React.Suspense fallback={<EsqueletoSecao />}>
              <Secao />
            </React.Suspense>
          </ProtecaoSecao>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** Uma tela que quebra (por um dado inesperado vindo de um computador, por exemplo) não derruba o painel inteiro. */
class ProtecaoSecao extends React.Component<
  { children: React.ReactNode },
  { erro: unknown; componentes: string | null; quebrou: boolean }
> {
  state = { erro: null as unknown, componentes: null as string | null, quebrou: false }
  static getDerivedStateFromError(erro: unknown) {
    return { erro, quebrou: true }
  }
  componentDidCatch(erro: unknown, info: React.ErrorInfo) {
    console.error("tela do painel", erro)
    this.setState({ componentes: info.componentStack ?? null })
  }
  render() {
    return this.state.quebrou ? (
      <SecaoQuebrou
        erro={this.state.erro}
        componentes={this.state.componentes}
        aoTentar={() => this.setState({ erro: null, componentes: null, quebrou: false })}
      />
    ) : (
      this.props.children
    )
  }
}

/**
 * A caixa da tela quebrada: a mensagem do erro e "Copiar detalhes" (mensagem, pilha curta, rota e versão, sem dado
 * sensível), para a pessoa mandar o que quebrou. Pedaço do build que não existe mais (versão nova publicada com a aba
 * aberta): pede para recarregar, que é o que resolve.
 */
export function SecaoQuebrou({
  erro,
  componentes,
  aoTentar,
}: {
  erro: unknown
  componentes?: string | null
  aoTentar: () => void
}) {
  const { t, idioma } = useT()
  const versaoNova = ehFalhaDeCarga(erro)
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? "")
  // a rota e a hora de quando a tela quebrou
  const detalhes = React.useMemo(
    () =>
      detalhesDaFalha({
        erro,
        componentes,
        caminho: window.location.pathname,
        versao: __VERSAO_PAINEL__,
        navegador: typeof navigator === "undefined" ? undefined : navigator.userAgent,
        idioma,
      }),
    [erro, componentes, idioma]
  )
  return (
    // margem por fora (padding do invólucro): com margem no próprio cartão de largura cheia, ele vazava no celular
    <div className="p-4 md:p-6">
      <Empty className="border" role="alert">
        <EmptyHeader className="max-w-lg">
          <EmptyMedia variant="icon">
            <CloudOffIcon />
          </EmptyMedia>
          <EmptyTitle>{versaoNova ? t("app.versaoNovaTitulo") : t("app.secaoQuebrou")}</EmptyTitle>
          <EmptyDescription>{versaoNova ? t("app.versaoNovaTexto") : t("app.secaoQuebrouDica")}</EmptyDescription>
          {mensagem ? (
            <code className="mt-1 max-w-full rounded-md bg-muted px-2 py-1 font-mono text-xs break-words text-muted-foreground">
              {mensagem.length > 240 ? `${mensagem.slice(0, 240)}…` : mensagem}
            </code>
          ) : null}
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          {versaoNova ? (
            <Button onClick={() => window.location.reload()}>
              <RotateCwIcon data-icon="inline-start" />
              {t("app.recarregar")}
            </Button>
          ) : (
            <Button variant="outline" onClick={aoTentar}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("app.tentarDeNovo")}
            </Button>
          )}
          <BotaoCopiar texto={detalhes} rotulo={t("app.copiarDetalhes")} className="h-8" />
        </EmptyContent>
      </Empty>
    </div>
  )
}

function TelaCheia({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center p-6">{children}</div>
}

function Carregando() {
  const { t } = useT()
  return (
    <TelaCheia>
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground" role="status">
        <Logo className="size-10 animate-pulse rounded-xl motion-reduce:animate-none" />
        {t("app.carregando")}
      </div>
    </TelaCheia>
  )
}

function EsqueletoSecao() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 lg:px-6" aria-hidden>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

function SemNuvem() {
  const { t } = useT()
  return (
    <TelaCheia>
      <Empty className="max-w-lg">
        <EmptyHeader>
          <EmptyMedia>
            <Logo className="size-12 rounded-xl" />
          </EmptyMedia>
          <EmptyTitle>{t("app.semNuvemTitulo")}</EmptyTitle>
          <EmptyDescription>{t("app.semNuvemTexto")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <a href="/?demo=1">
              <FlaskConicalIcon />
              {t("app.verDemo")}
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    </TelaCheia>
  )
}

// "Pular por agora" na oferta das duas etapas: lembrado neste navegador (dá para ligar depois em Minha conta).
function pulouDuasEtapas(userId: string): boolean {
  try {
    return localStorage.getItem(`reveza-pulou-duas-etapas-${userId}`) === "1"
  } catch {
    return false
  }
}

function pularDuasEtapas(userId: string) {
  try {
    localStorage.setItem(`reveza-pulou-duas-etapas-${userId}`, "1")
  } catch {
    /* sem armazenamento: a oferta volta no próximo carregamento */
  }
  window.location.assign(comDemo("/"))
}
