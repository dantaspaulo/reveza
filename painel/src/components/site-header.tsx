// Cabeçalho de cada página. Adaptado do "site-header" do bloco dashboard-01 do shadcn/ui: botão do menu, nome da
// seção e, à direita, se os dados estão ao vivo, reconectando (a aba que o navegador pausou, por exemplo) ou se é a
// demonstração.

import { FlaskConicalIcon, WifiOffIcon } from "lucide-react"

import { TextoBrilho } from "@/components/rb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAgora, useDados } from "@/dados/contexto"
import { situacaoDoPainel } from "@/dados/derivados"
import { useT } from "@/i18n"
import { emDemo } from "@/lib/demo"
import { fmtRelativo } from "@/lib/formato"

export function SiteHeader({ titulo }: { titulo: string }) {
  const { t, idioma } = useT()
  const { atualizadoEm, online, erro } = useDados()
  const agora = useAgora(5000)
  const demo = emDemo()
  const situacao = atualizadoEm ? situacaoDoPainel({ online, erro, atualizadoEm, agora }) : null
  const quando = atualizadoEm ? t("app.atualizado", { quando: fmtRelativo(atualizadoEm, agora, idioma) }) : null
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex w-full min-w-0 items-center gap-1 px-3 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" aria-label={t("menu.abrir")} />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="truncate text-base font-medium">{titulo}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!online ? (
            <Badge variant="outline" className="gap-1.5 border-atencao-borda bg-atencao-fundo text-atencao">
              <WifiOffIcon className="size-3.5" />
              <span className="hidden sm:inline">{t("app.offline")}</span>
            </Badge>
          ) : null}
          {demo ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="gap-1.5">
                  <FlaskConicalIcon className="size-3.5" />
                  {t("app.demo")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{t("app.demoDica")}</TooltipContent>
            </Tooltip>
          ) : null}
          {situacao === "ao_vivo" ? (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-50 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-ok" />
              </span>
              <TextoBrilho className="font-medium">{t("app.aoVivo")}</TextoBrilho>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{quando}</span>
            </span>
          ) : null}
          {situacao === "reconectando" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  role="status"
                  className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="inline-flex size-2 rounded-full bg-atencao" aria-hidden />
                  <span className="font-medium text-atencao">{t("app.reconectando")}</span>
                  <span aria-hidden className="hidden md:inline">
                    ·
                  </span>
                  <span className="hidden tabular-nums md:inline">{quando}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{t("app.reconectandoDica")}</TooltipContent>
            </Tooltip>
          ) : null}
          {demo ? (
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <a href="/">{t("app.sairDemo")}</a>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
