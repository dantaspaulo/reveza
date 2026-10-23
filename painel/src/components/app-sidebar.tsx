// Menu lateral. Adaptado do bloco oficial "sidebar-07" do shadcn/ui (barra que recolhe para ícones; no celular vira
// gaveta): a troca de time virou a marca da instalação, o menu virou os 4 grupos das 12 seções, e o usuário ganhou
// tema, idioma e sair.

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { Logo } from "@/components/painel/logo"
import { TextoGradiente } from "@/components/rb"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useEstado } from "@/dados/contexto"
import { useT } from "@/i18n"
import { painelAtras } from "@/lib/atualizar"
import { comDemo, emDemo } from "@/lib/demo"
import { Link } from "@/lib/rota"


export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { t } = useT()
  const { eu, computadores, config } = useEstado()
  const demo = emDemo()
  const { isMobile, setOpenMobile } = useSidebar()
  const atras = demo ? null : painelAtras(__VERSAO_PAINEL__, computadores, config.nuvem)
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={t("app.nome")}>
              <Link href={comDemo("/")}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
                  <Logo className="!size-8 rounded-lg" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <TextoGradiente className="!justify-start truncate font-semibold">{t("app.nome")}</TextoGradiente>
                  <span className="truncate text-xs text-muted-foreground">
                    {demo ? t("app.demo") : t("app.descricao")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <NavUser eu={eu} />
        {/* a versão do painel fica à vista embaixo (some com a barra recolhida, onde só há ícones) */}
        {atras ? (
          // o painel atrás da nuvem fica à vista em toda tela, e leva ao cartão que diz como trazer o novo
          <Link
            href={comDemo("/computadores")}
            title={t("app.versaoPainelAtrasDica")}
            onClick={() => isMobile && setOpenMobile(false)}
            className="px-2 pb-1 text-[11px] leading-snug break-words text-atencao tabular-nums underline-offset-2 hover:underline group-data-[collapsible=icon]:hidden"
          >
            {t("app.versaoPainelAtras", { versao: __VERSAO_PAINEL__, nova: atras })}
          </Link>
        ) : (
          <p className="truncate px-2 pb-1 text-[11px] text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden">
            {t("app.versaoPainel", { versao: __VERSAO_PAINEL__ })}
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
