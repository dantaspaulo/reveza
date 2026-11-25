// Projetos (0.20.0, "Empresas" até a 0.20.1): o cadastro operacional. Escolhe o computador, o projeto à esquerda e edita
// tudo à direita, sem janela por cima: em quais computadores ele roda, conta, pasta e subprojetos. Cada subprojeto usa a
// conta do projeto ou uma própria. Salvar grava o que mudou (painel_unidade) e o projeto ou subprojeto passa a rodar só
// nas contas marcadas. Os números ficaram na tela de Uso. Nos nomes internos, projeto ainda é "empresa".

import * as React from "react"
import {
  ChevronRightIcon,
  FolderKanbanIcon,
  ImportIcon,
  InfoIcon,
  LaptopIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { BarraFable, BarraUso, NomeConta, SeloEstado } from "@/components/painel/conta"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { useAcao, useAgora, useConsulta, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { estadoComputador, estadoConta, p5, p7, resetDe } from "@/dados/derivados"
import { ErroPainel } from "@/dados/fonte"
import type { AgenteOpenBot, Computador, Conta, DadosEmpresas, SessaoUso, TrilhaEmUso } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  adicionarTexto,
  agentesDoTexto,
  alternarAgente,
  avisoContas,
  classificadorDoRascunho,
  filtrarLinhas,
  linhasDeAgentes,
  pastasManuais,
  type AvisoContas,
  type LinhaAgente,
  type Usado,
} from "@/lib/agentes"
import {
  alteradas,
  alternarComputador,
  computadoresAtivos,
  contasDe,
  ligada,
  modoAlternado,
  ondeEsta,
  planoDeGravar,
  projetosEmTodos,
  rascunhoDe,
  rodaEm,
  rodaNoComputador,
  saemDaConta,
  temRegraEm,
  validar,
  type ErroCadastro,
  type UnidadeRascunho,
} from "@/lib/cadastro"
import { N_CORES } from "@/lib/cores"
import { comDemo } from "@/lib/demo"
import {
  criarRodaEm,
  empresasForaNoAntigo,
  nomeUnidade as rotuloUnidade,
  versaoNum,
  type Classificar,
} from "@/lib/empresas"
import { fmtFuturo } from "@/lib/formato"
import { Link } from "@/lib/rota"
import { cn } from "@/lib/utils"

let ultimoNovo = 0
const idNovo = () => `novo-${++ultimoNovo}`

const CHIP =
  "h-auto min-h-7 max-w-full justify-start rounded-full px-3 py-1 font-normal text-muted-foreground whitespace-normal hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/15"

/**
 * As pastas que a pessoa já usa naquele computador: agentes do OpenBot e sessões dos últimos 30 dias. 0.21.1: a pasta
 * de um agente vem com o nome dele.
 */
function sugestoesDe(
  dados: DadosEmpresas,
  sessoes: SessaoUso[] | null,
  computador: string
): { pasta: string; rotulo?: string }[] {
  const nomes = new Map<string, string>()
  for (const a of dados.agentes) if (a.computadorId === computador && a.pasta && a.nome) nomes.set(a.pasta, a.nome)
  const todas = [
    ...dados.agentes.filter((a) => a.computadorId === computador).map((a) => a.pasta),
    ...(sessoes ?? []).filter((s) => s.computadorId === computador).map((s) => s.pasta),
  ]
  return [...new Set(todas.filter(Boolean))]
    .sort()
    .slice(0, 100)
    .map((pasta) => ({ pasta, rotulo: nomes.get(pasta) }))
}

/** As pastas em uso nos computadores ativos (agentes do OpenBot e sessões recentes): a base do aviso de conta livre. */
function usadosDe(dados: DadosEmpresas, sessoes: SessaoUso[] | null, ativos: string[]): Usado[] {
  const ativo = new Set(ativos)
  return [
    ...dados.agentes.map((a) => ({ pasta: a.pasta, projeto: "", computadorId: a.computadorId })),
    ...(sessoes ?? []).map((s) => ({ pasta: s.pasta, projeto: s.projeto, computadorId: s.computadorId })),
  ].filter((x) => ativo.has(x.computadorId))
}

/** O que os campos de um projeto ou subprojeto precisam para ler e mudar o rascunho. */
export interface Edicao {
  lista: UnidadeRascunho[]
  contas: Conta[]
  computador: string
  nomeComputador: string
  /** Os computadores ativos: as opções de "Roda em" e onde cada conta está. */
  computadores: Computador[]
  /** As contas em uso pelos projetos separados, em cada computador. */
  trilhas: TrilhaEmUso[]
  /** O cadastro de antes de editar: diz quem perde a conta ao salvar. */
  antes: UnidadeRascunho[]
  sugestoes: { pasta: string; rotulo?: string }[]
  /** 0.21.1: os agentes do OpenBot de todos os computadores e onde cada pasta cai pelo rascunho. */
  agentes: AgenteOpenBot[]
  classificar: Classificar
  pode: boolean
  mudar: (id: string, campos: Partial<UnidadeRascunho>) => void
  /** Muda o rascunho inteiro: marcar um agente pode tirá-lo de outro projeto. */
  aplicar: (fazer: (atual: UnidadeRascunho[]) => UnidadeRascunho[]) => void
  marcarConta: (u: UnidadeRascunho, conta: string) => void
  alternar: (u: UnidadeRascunho) => void
  escolherComputadores: (u: UnidadeRascunho, computadores: string[] | null) => void
}

export default function Empresas() {
  const { t } = useT()
  const estado = useEstado()
  const { fonte } = useDados()
  const { pode: podeEscrever } = usePermissao()
  const acao = useAcao()
  const [intervalo] = React.useState(() => {
    const ate = new Date()
    const de = new Date(ate)
    de.setDate(de.getDate() - 30)
    return { de, ate }
  })
  const cadastro = useConsulta((f) => f.empresas(), [])
  const sessoes = useConsulta((f) => f.sessoes(intervalo), [intervalo])
  const dados = cadastro.dados
  const computadores = estado.computadores.filter((c) => !c.revogado)

  const [escolhido, setEscolhido] = React.useState<string | null>(null)
  const computador = computadores.find((c) => c.id === escolhido) ?? computadores[0] ?? null
  const base = React.useMemo(() => (dados ? rascunhoDe(dados) : []), [dados])
  const [rascunho, setRascunho] = React.useState<UnidadeRascunho[] | null>(null)
  // como o cadastro estava ao começar a editar: o que outra pessoa salvou nesse meio tempo não volta ao valor antigo
  const [foto, setFoto] = React.useState<UnidadeRascunho[] | null>(null)
  const referencia = foto ?? base
  const lista = rascunho ?? base
  const raizes = lista.filter((u) => !u.pai)
  const [selecionada, setSelecionada] = React.useState<string | null>(null)
  const [aberto, setAberto] = React.useState<string | null>(null)
  const [apagar, setApagar] = React.useState<string | null>(null)
  const [erro, setErro] = React.useState<ErroCadastro | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  // salvou: o rascunho fica na tela até a leitura nova chegar, para nada piscar com o valor de antes
  const [aguardando, setAguardando] = React.useState(false)
  // enquanto grava, a tela não edita: o que entrasse agora sumiria quando a leitura nova chegasse
  const pode = podeEscrever && !salvando && !aguardando
  // o que já foi criado numa gravação que parou no meio: tentar de novo não cria em dobro
  const criados = React.useRef(new Map<string, string>())
  // cadastro novo: marcar a primeira conta já liga, até a pessoa mexer na chave
  const [tocados, setTocados] = React.useState<ReadonlySet<string>>(() => new Set())

  const ativos = React.useMemo(
    () => estado.computadores.filter((c) => !c.revogado).map((c) => c.id),
    [estado.computadores]
  )
  const rodaAqui = (u: UnidadeRascunho) => !computador || rodaNoComputador(u, computador.id, ativos)
  // a lista mostra o que roda nesta aba, mais o escolhido: tirar este computador não faz o projeto sumir da tela
  const raizesAqui = raizes.filter((u) => u.id === selecionada || rodaAqui(u))
  const deFora = raizes.filter((u) => !rodaAqui(u))
  const empresa = raizesAqui.find((u) => u.id === selecionada) ?? raizesAqui[0] ?? null
  const mudanca = alteradas(referencia, lista).length > 0 && !aguardando

  // 0.21.1: onde cada pasta cai pelo rascunho e o aviso de conta livre, que muda na hora, antes de salvar
  const agentes = dados?.agentes
  const classificar = React.useMemo(() => classificadorDoRascunho(lista, agentes ?? []), [lista, agentes])
  const usados = React.useMemo(
    () => (dados ? usadosDe(dados, sessoes.dados, ativos) : []),
    [dados, sessoes.dados, ativos]
  )
  const agora = useAgora(60_000)
  const aviso = React.useMemo(
    () => avisoContas(lista, estado.contas, (c) => estadoConta(c, estado.config, agora), usados, classificar),
    [lista, estado.contas, estado.config, agora, usados, classificar]
  )

  const dadosVistos = React.useRef(dados)
  // salvou, mas a leitura falhou: a tela volta a editar, e salvar de novo não cria em dobro
  if (aguardando && !cadastro.carregando && cadastro.erro !== null) setAguardando(false)
  React.useEffect(() => {
    if (dados === dadosVistos.current) return
    dadosVistos.current = dados
    if (!aguardando) return
    const real = (id: string | null) => (id ? (criados.current.get(id) ?? id) : id)
    setSelecionada(real)
    setAberto(real)
    criados.current.clear()
    setTocados(new Set())
    setRascunho(null)
    setFoto(null)
    setAguardando(false)
  }, [dados, aguardando])

  // 0.20.2 (pedido do Paulo, 24/11/2026): o botão diz em qual computador o projeto novo nasce (o da aba)
  const rotuloNovo =
    computador && dados?.computadoresNaNuvem !== false
      ? t("empresas.op.novaEmpresaEm", { computador: computador.nome })
      : t("empresas.op.novaEmpresa")

  const indisponivel = cadastro.erro instanceof ErroPainel && cadastro.erro.codigo === "indisponivel"
  if (indisponivel)
    return (
      <Pagina titulo={t("menu.secoes.empresas")}>
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("empresas.indisponivel.titulo")}</AlertTitle>
          <AlertDescription>{t("empresas.indisponivel.texto")}</AlertDescription>
        </Alert>
      </Pagina>
    )

  const editar = (fazer: (atual: UnidadeRascunho[]) => UnidadeRascunho[]) => {
    setErro(null)
    setFoto((f) => f ?? base)
    setRascunho((r) => fazer(r ?? base))
  }
  const mudar = (id: string, campos: Partial<UnidadeRascunho>) =>
    editar((atual) => atual.map((u) => (u.id === id ? { ...u, ...campos } : u)))
  const alternar = (u: UnidadeRascunho) => {
    setTocados((x) => new Set(x).add(u.id))
    mudar(u.id, { modo: modoAlternado(u, lista) })
  }
  const marcarConta = (u: UnidadeRascunho, conta: string) => {
    const marcando = !u.contas.includes(conta)
    const contas = marcando ? [...u.contas, conta] : u.contas.filter((c) => c !== conta)
    const ligar = marcando && u.novo && !tocados.has(u.id) && !ligada(u, lista)
    mudar(u.id, { contas, ...(ligar ? { modo: modoAlternado(u, lista) } : {}) })
  }
  const novaEmpresa = () => {
    const id = idNovo()
    // nasce só neste computador; com a nuvem antiga fica sem a escolha
    const onde = dados?.computadoresNaNuvem && computador ? { computadores: [computador.id] } : {}
    editar((atual) => [
      ...atual,
      {
        id,
        novo: true,
        nome: "",
        pai: null,
        cor: atual.length % N_CORES,
        modo: "desligado",
        contas: [],
        pastas: [],
        titulos: [],
        ...onde,
      },
    ])
    setSelecionada(id)
    setAberto(null)
    setApagar(null)
  }
  const escolherComputadores = (u: UnidadeRascunho, escolha: string[] | null) => {
    mudar(u.id, { computadores: escolha })
    // fica na tela mesmo que este computador tenha saído da escolha
    setSelecionada(u.id)
  }
  const trazer = (u: UnidadeRascunho) => {
    if (!computador) return
    escolherComputadores(u, [...(u.computadores ?? []).filter((c) => ativos.includes(c)), computador.id])
    setAberto(null)
    setApagar(null)
  }
  const trocarComputador = (id: string) => {
    setEscolhido(id)
    const atual = raizes.find((u) => u.id === selecionada)
    if (atual && !rodaNoComputador(atual, id, ativos)) {
      setSelecionada(null)
      setAberto(null)
      setApagar(null)
    }
  }
  const novoProjeto = (e: UnidadeRascunho) => {
    const id = idNovo()
    editar((atual) => [
      ...atual,
      { id, novo: true, nome: "", pai: e.id, cor: e.cor, modo: null, contas: [], pastas: [], titulos: [] },
    ])
    setAberto(id)
    setApagar(null)
  }
  const descartar = () => {
    setRascunho(null)
    setFoto(null)
    setErro(null)
    setApagar(null)
    setTocados(new Set())
  }
  const salvar = async () => {
    const problema = validar(lista, alteradas(referencia, lista))
    setErro(problema)
    if (problema) {
      const u = lista.find((x) => x.id === problema.id)
      setSelecionada(u?.pai ?? problema.id)
      if (u?.pai) setAberto(u.id)
      return
    }
    setSalvando(true)
    const [ok] = await acao(async () => {
      const passos = planoDeGravar(referencia, lista).map((passo) => {
        const id = criados.current.get(passo.id) ?? (passo.novo ? null : passo.id)
        const { pai, ...resto } = passo.campos
        const campos = id ? resto : { ...resto, ...(pai ? { pai: criados.current.get(pai) ?? pai } : {}) }
        return { ref: passo.id, id, campos }
      })
      // numa transação só: mover uma pasta entre empresas não deixa a pasta sem dono se o segundo passo for recusado
      const novos = await fonte.salvarUnidades(passos)
      for (const [ref, id] of Object.entries(novos)) criados.current.set(ref, id)
    }, t("empresas.op.salvo"))
    setSalvando(false)
    if (ok) setAguardando(true)
    cadastro.recarregar()
  }
  const confirmarApagar = async (u: UnidadeRascunho) => {
    const id = criados.current.get(u.id) ?? (u.novo ? null : u.id)
    if (id) {
      const [ok] = await acao(() => fonte.apagarEmpresa(id), t("empresas.op.apagado"))
      if (!ok) return
      cadastro.recarregar()
    }
    setRascunho((r) => r && r.filter((x) => x.id !== u.id && x.pai !== u.id))
    setApagar(null)
    if (aberto === u.id) setAberto(null)
  }

  const edicao: Edicao | null =
    dados && computador
      ? {
          lista,
          contas: estado.contas,
          computador: computador.id,
          nomeComputador: computador.nome,
          computadores,
          trilhas: dados.trilhas,
          antes: referencia,
          sugestoes: sugestoesDe(dados, sessoes.dados, computador.id),
          agentes: dados.agentes,
          classificar,
          pode,
          mudar,
          aplicar: editar,
          marcarConta,
          alternar,
          escolherComputadores,
        }
      : null

  const barraSalvar =
    mudanca || erro ? (
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className={cn("text-sm", erro && "text-erro")} role={erro ? "alert" : undefined}>
            {erro ? textoErro(erro, t) : t("empresas.op.naoSalvas")}
          </p>
          {aviso && mudanca ? <p className="text-xs text-atencao">{t("empresas.agentes.avisoAoSalvar")}</p> : null}
        </div>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={salvando} onClick={descartar}>
            {t("empresas.op.descartar")}
          </Button>
          <Button size="sm" disabled={salvando || !pode} onClick={() => void salvar()}>
            {salvando ? <Spinner /> : null}
            {t("empresas.op.salvar")}
          </Button>
        </div>
      </div>
    ) : null

  return (
    <Pagina
      titulo={t("menu.secoes.empresas")}
      descricao={t("empresas.op.subtitulo")}
      acoes={
        <div className="flex flex-wrap items-center gap-1.5">
          {edicao && deFora.length ? <TrazerProjeto fora={deFora} pode={pode} aoTrazer={trazer} /> : null}
          <Button size="sm" className="max-w-full" disabled={!pode || !edicao} onClick={novaEmpresa}>
            <PlusIcon />
            <span className="truncate">{rotuloNovo}</span>
          </Button>
        </div>
      }
    >
      <AvisoPermissao />
      {dados ? <Avisos dados={dados} /> : null}
      {dados ? <AvisoEmTodos lista={base} ativos={ativos} /> : null}
      {aviso ? <AvisoContasLivres aviso={aviso} /> : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          {t("empresas.op.computador")}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {computadores.length ? (
            <Tabs value={computador?.id ?? ""} onValueChange={trocarComputador} className="max-w-full min-w-0">
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                {computadores.map((c) => (
                  <TabsTrigger key={c.id} value={c.id} className="h-8 flex-none px-3">
                    <LaptopIcon />
                    {c.nome}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <Button
            asChild
            size={computadores.length ? "icon" : "sm"}
            variant="outline"
            className={computadores.length ? "size-8" : undefined}
          >
            <Link href={comDemo("/computadores")} aria-label={t("empresas.op.adicionarComputador")}>
              <PlusIcon />
              {computadores.length ? null : t("empresas.op.adicionarComputador")}
            </Link>
          </Button>
        </div>
      </div>

      {!dados ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : !edicao ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LaptopIcon />
            </EmptyMedia>
            <EmptyTitle>{t("empresas.op.semComputador")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : !empresa ? (
        <>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderKanbanIcon />
              </EmptyMedia>
              <EmptyTitle>{t(raizes.length ? "empresas.op.semProjetoAqui" : "empresas.op.semEmpresa")}</EmptyTitle>
              {raizes.length ? <EmptyDescription>{t("empresas.op.semProjetoAquiTexto")}</EmptyDescription> : null}
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-1.5">
                <Button size="sm" className="max-w-full" disabled={!pode} onClick={novaEmpresa}>
                  <PlusIcon />
                  <span className="truncate">{rotuloNovo}</span>
                </Button>
                {deFora.length ? <TrazerProjeto fora={deFora} pode={pode} aoTrazer={trazer} /> : null}
              </div>
            </EmptyContent>
          </Empty>
          {barraSalvar ? <div className="overflow-clip rounded-3xl border bg-card">{barraSalvar}</div> : null}
        </>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-[232px_minmax(0,1fr)]">
          <ListaEmpresas
            raizes={raizesAqui}
            lista={lista}
            atual={empresa.id}
            computador={edicao.computador}
            ativos={ativos}
            aoEscolher={(id) => {
              setSelecionada(id)
              setAberto(null)
              setApagar(null)
            }}
          />
          <section
            key={`${empresa.id}:${edicao.computador}`}
            className="min-w-0 animate-in overflow-clip rounded-3xl border bg-card duration-300 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <div className="flex items-center gap-2.5 border-b bg-gradient-to-r from-primary/20 via-primary/5 to-transparent p-4">
              <span className="hidden size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground sm:grid">
                <FolderKanbanIcon className="size-4" />
              </span>
              <Input
                aria-label={t("empresas.op.nomeEmpresa")}
                placeholder={t("empresas.op.nomeEmpresa")}
                maxLength={60}
                disabled={!pode}
                value={empresa.nome}
                onChange={(ev) => mudar(empresa.id, { nome: ev.target.value })}
                className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-semibold tracking-tight shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
              />
              <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="hidden sm:inline">{rotuloModo(empresa, lista, t)}</span>
                <Switch
                  aria-label={t("empresas.op.ligar", { nome: empresa.nome })}
                  disabled={!pode}
                  checked={ligada(empresa, lista)}
                  onCheckedChange={() => alternar(empresa)}
                />
              </label>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground"
                disabled={!pode}
                aria-label={t("empresas.op.apagarEmpresaBotao")}
                onClick={() => setApagar(empresa.id)}
              >
                <Trash2Icon />
              </Button>
            </div>

            <div className="flex flex-col gap-4 p-4">
              {apagar === empresa.id ? (
                <ConfirmaApagar u={empresa} aoCancelar={() => setApagar(null)} aoConfirmar={() => confirmarApagar(empresa)} />
              ) : null}
              <Campos u={empresa} e={edicao} />
              <div className="flex flex-col gap-2">
                <Rotulo>{t("empresas.op.projetos")}</Rotulo>
                <div className="flex flex-col gap-1 rounded-2xl border bg-muted/30 p-1">
                  {lista
                    .filter((p) => p.pai === empresa.id)
                    .map((p) => (
                      <LinhaProjeto
                        key={p.id}
                        p={p}
                        e={edicao}
                        aberto={aberto === p.id}
                        apagando={apagar === p.id}
                        aoAbrir={() => {
                          setAberto(aberto === p.id ? null : p.id)
                          setApagar(null)
                        }}
                        aoApagar={() => setApagar(p.id)}
                        aoCancelarApagar={() => setApagar(null)}
                        aoConfirmarApagar={() => confirmarApagar(p)}
                      />
                    ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full rounded-xl border-dashed text-muted-foreground"
                    disabled={!pode}
                    onClick={() => novoProjeto(empresa)}
                  >
                    <PlusIcon />
                    {t("empresas.op.novoProjeto")}
                  </Button>
                </div>
              </div>
            </div>

            {barraSalvar}
          </section>
        </div>
      )}
    </Pagina>
  )
}

type Traduzir = ReturnType<typeof useT>["t"]

function textoErro(erro: ErroCadastro, t: Traduzir): string {
  return t(`empresas.op.${erro.chave}`, { nome: erro.nome ?? "", pasta: erro.pasta ?? "", dono: erro.dono ?? "" })
}

function rotuloModo(u: UnidadeRascunho, lista: UnidadeRascunho[], t: Traduzir): string {
  if (ligada(u, lista)) return t("empresas.op.ligado")
  return u.modo === "sombra" ? t("empresas.op.sombra") : t("empresas.op.desligado")
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{children}</span>
}

/**
 * Projeto salvo para rodar em todos os computadores (o que veio de antes da 0.20.1): vale também no computador que for
 * ligado depois. O aviso diz quais são e como separar (0.20.2, pedido do Paulo de 24/11/2026). Com um computador só,
 * "todos" é ele, e não há o que separar.
 */
export function AvisoEmTodos({ lista, ativos }: { lista: UnidadeRascunho[]; ativos: string[] }) {
  const { t, tn } = useT()
  const emTodos = projetosEmTodos(lista, ativos)
  if (!emTodos.length) return null
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>{tn("empresas.projetos.emTodosTitulo", emTodos.length)}</AlertTitle>
      <AlertDescription>
        {t("empresas.projetos.emTodosTexto", { projetos: emTodos.map((u) => rotuloUnidade(u, lista)).join(", ") })}
      </AlertDescription>
    </Alert>
  )
}

/** Só aparece quando há o que dizer: computador atrasado e o que o modo teste faria. */
function Avisos({ dados }: { dados: DadosEmpresas }) {
  const { t, tn } = useT()
  const estado = useEstado()
  const fora = React.useMemo(() => empresasForaNoAntigo(dados), [dados])
  const roda = React.useMemo(() => criarRodaEm(dados), [dados])
  // só o computador atrasado em que algum desses projetos roda: nos outros a nuvem nem manda o projeto
  const atras = estado.computadores.filter(
    (c) => !c.revogado && versaoNum(c.versao) < versaoNum("0.19.0") && fora.some((e) => roda(e.id, c.id))
  )
  const mostraAtraso = fora.length > 0 && atras.length > 0
  if (!mostraAtraso && dados.sombras.length === 0) return null
  const nomeUnidade = (id: string) => {
    const u = dados.empresas.find((x) => x.id === id)
    if (!u) return id.slice(0, 8)
    const pai = u.pai ? dados.empresas.find((x) => x.id === u.pai) : null
    return pai ? `${pai.nome} / ${u.nome}` : u.nome
  }
  const nomeConta = (id: string | null) => {
    if (!id) return t("empresas.projetos.nenhuma")
    const c = estado.contas.find((x) => x.id === id)
    return c ? <NomeConta conta={c} /> : id.slice(0, 8)
  }
  const nomePc = (id: string) => estado.computadores.find((c) => c.id === id)?.nome ?? id.slice(0, 8)
  return (
    <div className="flex flex-col gap-3">
      {mostraAtraso ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("empresas.projetos.atrasTitulo")}</AlertTitle>
          <AlertDescription>
            {t("empresas.projetos.atrasTexto", {
              computadores: atras.map((c) => `${c.nome} (${c.versao || "?"})`).join(", "),
              empresas: fora.map((e) => nomeUnidade(e.id)).join(", "),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {dados.sombras.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-2xl border bg-muted/30 p-3">
          <p className="text-sm font-medium">{t("empresas.projetos.sombraTitulo")}</p>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {dados.sombras.map((s) => (
              <li key={`${s.computadorId}:${s.empresaId}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-foreground">{nomeUnidade(s.empresaId)}</span>
                <span>{t("empresas.projetos.sombraEm", { computador: nomePc(s.computadorId) })}</span>
                <span>{t("empresas.projetos.sombraUsaria")}</span>
                {nomeConta(s.contaId)}
                <span>{t("empresas.projetos.sombraAgora")}</span>
                {nomeConta(s.emUso)}
                {s.trocas > 0 ? <span>· {tn("empresas.projetos.sombraTrocas", s.trocas)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** Acrescenta a este computador um projeto que hoje roda só em outros. */
function TrazerProjeto({
  fora,
  pode,
  aoTrazer,
}: {
  fora: UnidadeRascunho[]
  pode: boolean
  aoTrazer: (u: UnidadeRascunho) => void
}) {
  const { t } = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={!pode}>
          <ImportIcon />
          {t("empresas.op.trazerDeOutro")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fora.map((u) => (
          <DropdownMenuItem key={u.id} onSelect={() => aoTrazer(u)}>
            {u.nome || t("empresas.op.novaEmpresa")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListaEmpresas({
  raizes,
  lista,
  atual,
  computador,
  ativos,
  aoEscolher,
}: {
  raizes: UnidadeRascunho[]
  lista: UnidadeRascunho[]
  atual: string
  computador: string
  ativos: string[]
  aoEscolher: (id: string) => void
}) {
  const { t, tn } = useT()
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-3xl border bg-muted/30 p-1.5">
      {raizes.map((e) => {
        const projetos = lista.filter((p) => p.pai === e.id).length
        const aqui = rodaNoComputador(e, computador, ativos)
        // a bolinha verde só quando roda mesmo neste computador: o projeto sem computador ativo aparece, mas não roda
        const naLista = computadoresAtivos(e, ativos)
        const deVerdade = naLista == null || naLista.includes(computador)
        const comPasta = rodaEm(e, lista, computador)
        return (
          <button
            key={e.id}
            type="button"
            aria-current={e.id === atual ? "true" : undefined}
            onClick={() => aoEscolher(e.id)}
            className={cn(
              "flex w-full min-w-0 items-center gap-2.5 rounded-[1.25rem] border border-transparent px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
              e.id === atual && "border-primary/60 bg-card hover:bg-card"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full bg-border",
                ligada(e, lista) && deVerdade && comPasta && "bg-ok ring-[3px] ring-ok/20"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{e.nome || t("empresas.op.novaEmpresa")}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {!aqui
                  ? t("empresas.op.naoRodaAqui")
                  : !comPasta
                    ? t("empresas.op.semPasta")
                    : projetos
                    ? tn("empresas.op.projetosQtd", projetos)
                    : t("empresas.op.semProjetos")}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ConfirmaApagar({
  u,
  aoCancelar,
  aoConfirmar,
}: {
  u: UnidadeRascunho
  aoCancelar: () => void
  aoConfirmar: () => Promise<void>
}) {
  const { t } = useT()
  const [ocupado, setOcupado] = React.useState(false)
  const nome = u.nome || t(u.pai ? "empresas.op.novoProjeto" : "empresas.op.novaEmpresa")
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-erro-borda bg-erro-fundo px-3 py-2 text-sm"
    >
      <span className="min-w-0">
        {t(u.pai ? "empresas.op.apagarTitulo" : "empresas.op.apagarComProjetos", { nome })}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={aoCancelar}>
          {t("comum.cancelar")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true)
            await aoConfirmar()
            setOcupado(false)
          }}
        >
          {ocupado ? <Spinner /> : null}
          {t("empresas.op.apagar")}
        </Button>
      </div>
    </div>
  )
}

function LinhaProjeto({
  p,
  e,
  aberto,
  apagando,
  aoAbrir,
  aoApagar,
  aoCancelarApagar,
  aoConfirmarApagar,
}: {
  p: UnidadeRascunho
  e: Edicao
  aberto: boolean
  apagando: boolean
  aoAbrir: () => void
  aoApagar: () => void
  aoCancelarApagar: () => void
  aoConfirmarApagar: () => Promise<void>
}) {
  const { t } = useT()
  const primeira = e.contas.find((c) => c.id === p.contas[0])
  const conta = p.contas.length
    ? `${primeira?.email ?? ""}${p.contas.length > 1 ? ` +${p.contas.length - 1}` : ""}`
    : t("empresas.op.contaDaEmpresaCurta")
  const aqui = temRegraEm(p, e.computador)
  return (
    <div className={cn("min-w-0 rounded-xl border border-transparent", aberto && "border-border bg-card")}>
      <div className="flex min-w-0 items-center gap-2 pr-2.5">
        <button
          type="button"
          aria-expanded={aberto}
          onClick={aoAbrir}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRightIcon
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")}
          />
          <span className="max-w-[45%] shrink-0 truncate text-sm font-semibold">
            {p.nome || t("empresas.op.novoProjeto")}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
            {conta}
            {aqui ? "" : ` · ${t("empresas.op.semPasta").toLowerCase()}`}
          </span>
        </button>
        <Switch
          aria-label={t("empresas.op.ligar", { nome: p.nome || t("empresas.op.novoProjeto") })}
          disabled={!e.pode}
          checked={ligada(p, e.lista)}
          onCheckedChange={() => e.alternar(p)}
        />
      </div>
      {aberto ? (
        <div className="flex flex-col gap-3.5 px-3 pt-1.5 pb-3">
          <div className="flex flex-col gap-2">
            <Rotulo>{t("empresas.op.nome")}</Rotulo>
            <Input
              aria-label={t("empresas.op.nomeProjeto")}
              maxLength={60}
              disabled={!e.pode}
              value={p.nome}
              onChange={(ev) => e.mudar(p.id, { nome: ev.target.value })}
            />
          </div>
          <Campos u={p} e={e} />
          {apagando ? (
            <ConfirmaApagar u={p} aoCancelar={aoCancelarApagar} aoConfirmar={aoConfirmarApagar} />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit text-muted-foreground"
              disabled={!e.pode}
              onClick={aoApagar}
            >
              <Trash2Icon />
              {t("empresas.op.apagarProjetoBotao")}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Em quais computadores o projeto roda. O subprojeto segue o projeto; com a nuvem antiga, a escolha não aparece. */
export function RodaEm({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  if (u.pai || u.computadores === undefined) return null
  const escolha = u.computadores
  const todos = escolha === null
  const ids = e.computadores.map((c) => c.id)
  const aviso = todos
    ? null
    : !escolha.length
      ? t("empresas.op.erroComputador", { nome: u.nome.trim() || t("empresas.op.novaEmpresa") })
      : !escolha.some((c) => ids.includes(c))
        ? t("empresas.op.semComputadorAtivo")
        : null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Rotulo>{t("empresas.op.rodaEm")}</Rotulo>
      <div className="flex flex-wrap gap-1.5">
        {/* 0.20.2 (pedido do Paulo, 24/11/2026): projeto roda por computador. "Todos" só aparece, marcado, no projeto
            que já rodava em todos, para mostrar o que vale hoje; tocar nele deixa só este computador */}
        {todos ? (
          <Toggle
            variant="outline"
            size="sm"
            className={CHIP}
            disabled={!e.pode}
            pressed
            onPressedChange={() => e.escolherComputadores(u, [e.computador])}
          >
            {t("empresas.op.todos")}
          </Toggle>
        ) : null}
        {e.computadores.map((c) => (
          <Toggle
            key={c.id}
            variant="outline"
            size="sm"
            className={CHIP}
            disabled={!e.pode}
            pressed={!todos && escolha.includes(c.id)}
            onPressedChange={() => e.escolherComputadores(u, alternarComputador(escolha, c.id, ids))}
          >
            <LaptopIcon />
            {c.nome}
          </Toggle>
        ))}
      </div>
      <p className={cn("text-xs text-muted-foreground", (aviso || todos) && "text-atencao")}>
        {aviso ?? t(todos ? "empresas.op.rodaEmDicaTodos" : "empresas.op.rodaEmDica")}
      </p>
    </div>
  )
}

/** A escolha das contas: cada linha já diz o estado, onde a conta está agora e os limites dela. */
function EscolhaContas({ u, e, contas }: { u: UnidadeRascunho; e: Edicao; contas: Conta[] }) {
  const agora = useAgora(15_000)
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5 xl:grid-cols-2">
      {contas.map((c) => (
        <LinhaConta key={c.id} c={c} u={u} e={e} agora={agora} />
      ))}
    </div>
  )
}

function LinhaConta({ c, u, e, agora }: { c: Conta; u: UnidadeRascunho; e: Edicao; agora: Date }) {
  const { t, tn, idioma } = useT()
  const { config } = useEstado()
  const { atualizadoEm } = useDados()
  const marcada = u.contas.includes(c.id)
  const outras = e.lista
    .filter((x) => x.id !== u.id && x.contas.includes(c.id))
    .map((x) => rotuloUnidade(x, e.lista))
  const onde = ondeEsta(c.id, e.computadores, e.trilhas, e.lista)
  const sai = marcada ? saemDaConta(u, e.lista, e.antes, c.id, e.computadores) : []
  // um aviso por computador, mesmo com a conta na principal e numa trilha dele
  const parados = [
    ...new Map(
      onde
        .filter((o) => {
          const pc = e.computadores.find((x) => x.id === o.computadorId)
          return !!pc && estadoComputador(pc, agora, atualizadoEm) === "parado"
        })
        .map((o) => [o.computadorId, o])
    ).values(),
  ]
  const textoOnde = onde.length
    ? onde
        .map((o) =>
          o.unidade
            ? t("empresas.op.contaEmUnidade", { unidade: o.unidade, computador: o.computador })
            : t("empresas.op.contaEmUsoEm", { computador: o.computador })
        )
        .join(" · ")
    : t("empresas.op.contaLivre")
  const barra = (pct: number | null, janela: "five_hour" | "seven_day") => {
    const reset = resetDe(c, janela)
    return (
      <BarraUso
        pct={pct}
        cor={c.cor}
        aviso={config.aviso}
        troca={config.modo === "limite" ? undefined : config.troca}
        alerta={config.aviso}
        rotulo={t(`janela.${janela}`)}
        detalhe={reset ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) }) : undefined}
        compacta
      />
    )
  }
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-start gap-2.5 rounded-xl border bg-card/60 p-3 transition-colors",
        e.pode && "hover:bg-muted/40",
        marcada && "border-primary/60 bg-primary/5"
      )}
    >
      {/* a linha inteira marca a conta: a área de clique da caixa cobre a linha, e o conteúdo não pega o clique */}
      <Checkbox
        aria-label={c.email}
        className="static mt-0.5 after:absolute after:inset-0 after:rounded-xl"
        disabled={!e.pode}
        checked={marcada}
        onCheckedChange={() => e.marcarConta(u, c.id)}
      />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <NomeConta conta={c} className="text-sm font-medium" />
          <SeloEstado estado={estadoConta(c, config, agora)} />
        </div>
        <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
          {textoOnde}
          {outras.length ? ` · ${t("empresas.op.contaMarcadaEm", { projetos: outras.join(", ") })}` : ""}
        </p>
        {/* uma barra por linha: com duas colunas de contas, lado a lado o nome do limite saía cortado */}
        <div className="flex min-w-0 flex-col gap-2">
          {barra(p5(c, agora), "five_hour")}
          {barra(p7(c, agora), "seven_day")}
          <BarraFable conta={c} agora={agora} comRotulo />
        </div>
        {parados.map((o) => (
          <p key={o.computadorId} className="text-xs text-atencao">
            {t("empresas.op.contaPresa", { computador: o.computador })}
          </p>
        ))}
        {sai.length ? (
          <p className="text-xs text-atencao">
            {tn("empresas.op.contaSaiAoSalvar", sai.length, { computadores: sai.join(", ") })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Computadores, contas e pasta: o mesmo bloco no projeto e no subprojeto (que segue os computadores do projeto). */
function Campos({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  const contas = e.contas.filter((c) => !c.saiEm || u.contas.includes(c.id))
  return (
    <>
      <RodaEm u={u} e={e} />
      <div className="flex min-w-0 flex-col gap-2">
        <Rotulo>{t("empresas.op.contas")}</Rotulo>
        {u.pai ? (
          <div className="flex flex-wrap gap-1.5">
            <Toggle
              variant="outline"
              size="sm"
              className={CHIP}
              disabled={!e.pode}
              pressed={u.contas.length === 0}
              onPressedChange={() => e.mudar(u.id, { contas: [] })}
            >
              {t("empresas.op.contaDaEmpresa")}
            </Toggle>
          </div>
        ) : null}
        {contas.length ? (
          <EscolhaContas u={u} e={e} contas={contas} />
        ) : (
          <span className="text-sm text-muted-foreground">{t("empresas.op.semContas")}</span>
        )}
        <LinhaTroca u={u} e={e} />
      </div>
      <Pastas u={u} e={e} />
    </>
  )
}

/** O que acontece quando a conta enche, numa linha. */
function LinhaTroca({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t, tn } = useT()
  const contas = contasDe(u, e.lista)
  const ligadaAgora = ligada(u, e.lista)
  const falta = ligadaAgora && contas.length === 0
  const texto = !ligadaAgora
    ? t("empresas.op.trocaDesligada")
    : falta
      ? t("empresas.op.escolhaConta")
      : contas.length === 1
        ? t("empresas.op.trocaEspera", { conta: e.contas.find((c) => c.id === contas[0])?.email ?? "" })
        : tn("empresas.op.trocaEntre", contas.length)
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm [overflow-wrap:anywhere] text-muted-foreground",
        ligadaAgora && "text-foreground",
        falta && "bg-erro-fundo text-erro"
      )}
    >
      <RefreshCwIcon className={cn("size-4 shrink-0", ligadaAgora && !falta && "text-primary")} />
      {texto}
    </div>
  )
}

/**
 * A pasta neste computador. Sem nenhuma, uma linha vazia: digitar já cria a regra. 0.21.1: a pasta de um agente da
 * lista aparece marcada na lista de agentes, e não aqui.
 */
function Pastas({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  const achadas = pastasManuais(u, e.computador, e.agentes)
  const linhas = achadas.length ? achadas : [{ pasta: { computador: e.computador, padrao: "" }, indice: -1 }]
  const idLista = `pastas-${u.id}-${e.computador}`
  const raiz = u.pai ? e.lista.find((x) => x.id === u.pai) : u
  // "em todos" só faz sentido com o projeto em mais de um computador (ou numa regra que já é assim)
  const naLista = raiz ? computadoresAtivos(raiz, e.computadores.map((c) => c.id)) : null
  const variosComputadores = naLista == null || naLista.length > 1
  const titulos = u.titulos
    .map((regra, indice) => ({ regra, indice }))
    .filter(({ regra }) => regra.computador === null || regra.computador === e.computador)
  const trocar = (indice: number, campos: Partial<UnidadeRascunho["pastas"][number]>) => {
    if (indice < 0) {
      e.mudar(u.id, { pastas: [...u.pastas, { computador: e.computador, padrao: "", ...campos }] })
      return
    }
    e.mudar(u.id, { pastas: u.pastas.map((p, i) => (i === indice ? { ...p, ...campos } : p)) })
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Rotulo>{t("empresas.op.pastaEm", { computador: e.nomeComputador })}</Rotulo>
      <datalist id={idLista}>
        {e.sugestoes.map((p) => (
          <option key={p.pasta} value={p.pasta} label={p.rotulo} />
        ))}
      </datalist>
      {linhas.map(({ pasta, indice }, i) => (
        <div key={i} className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Input
            aria-label={t("empresas.op.pasta")}
            placeholder={t("empresas.pastas.padraoDicaPasta")}
            maxLength={300}
            list={idLista}
            disabled={!e.pode}
            value={pasta.padrao}
            onChange={(ev) => trocar(indice, { padrao: ev.target.value })}
            className="min-w-0 flex-[1_1_180px]"
          />
          {variosComputadores || pasta.computador === null ? (
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <Checkbox
                disabled={!e.pode}
                checked={pasta.computador === null}
                onCheckedChange={(v) => trocar(indice, { computador: v === true ? null : e.computador })}
              />
              {t("empresas.op.emTodos")}
            </label>
          ) : null}
          {achadas.length > 1 ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              disabled={!e.pode}
              aria-label={t("empresas.op.removerPasta")}
              onClick={() => e.mudar(u.id, { pastas: u.pastas.filter((_, x) => x !== indice) })}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      {achadas.length && achadas.every(({ pasta }) => pasta.padrao.trim()) ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-fit text-muted-foreground"
          disabled={!e.pode}
          onClick={() => e.mudar(u.id, { pastas: [...u.pastas, { computador: e.computador, padrao: "" }] })}
        >
          <PlusIcon />
          {t("empresas.op.adicionarPasta")}
        </Button>
      ) : null}
      {titulos.length ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {titulos.map(({ regra, indice }) => (
            <span
              key={`${regra.computador ?? ""}:${regra.padrao}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-0.5 pl-3 text-xs text-muted-foreground"
            >
              <span className="min-w-0 truncate">{t("empresas.op.regraAgente", { titulo: regra.padrao })}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0 rounded-full"
                disabled={!e.pode}
                aria-label={t("empresas.op.removerRegra", { titulo: regra.padrao })}
                onClick={() => e.mudar(u.id, { titulos: u.titulos.filter((_, x) => x !== indice) })}
              >
                <XIcon />
              </Button>
            </span>
          ))}
        </div>
      ) : null}
      <AgentesDoComputador u={u} e={e} />
    </div>
  )
}

/**
 * 0.21.1 (pedido do Paulo em 24/11/2026): os agentes do OpenBot deste computador, com onde cada um cai. Marcar põe a
 * pasta do agente nesta unidade, só neste computador; o texto "nome ou título contém" pega os agentes pelo nome. Sem
 * agentes do OpenBot no computador, nada aparece: a pasta continua valendo como antes.
 */
export function AgentesDoComputador({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t, tn } = useT()
  const [busca, setBusca] = React.useState("")
  const [texto, setTexto] = React.useState("")
  const linhas = React.useMemo(
    () => linhasDeAgentes(e.lista, u.id, e.agentes, e.computador, e.classificar),
    [e.lista, u.id, e.agentes, e.computador, e.classificar]
  )
  if (!linhas.length) return null
  const visiveis = filtrarLinhas(linhas, busca)
  const entram = linhas.filter((l) => l.onde === u.id).length
  const naoEntram = linhas.filter((l) => l.naoEntra).length
  const pega = agentesDoTexto(texto, e.agentes, e.computador)
  const nomes = `${pega
    .slice(0, 5)
    .map((a) => a.nome)
    .join(", ")}${pega.length > 5 ? ` +${pega.length - 5}` : ""}`
  const podeAdicionar = e.pode && adicionarTexto(e.lista, u.id, texto, e.computador) !== null
  const adicionar = () => {
    if (!podeAdicionar) return
    e.aplicar((atual) => adicionarTexto(atual, u.id, texto, e.computador) ?? atual)
    setTexto("")
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 pt-1">
      <Rotulo>{t("empresas.agentes.titulo", { computador: e.nomeComputador })}</Rotulo>
      <p className="text-xs text-muted-foreground">{t("empresas.agentes.dicaModo")}</p>
      <p className="text-xs text-muted-foreground">
        {entram ? tn("empresas.agentes.entram", entram) : t("empresas.agentes.nenhumEntra")}
        {naoEntram ? <span className="text-atencao"> · {tn("empresas.agentes.naoEntram", naoEntram)}</span> : null}
      </p>
      {linhas.length > 6 ? (
        <Input
          aria-label={t("empresas.agentes.buscar")}
          placeholder={t("empresas.agentes.buscar")}
          value={busca}
          onChange={(ev) => setBusca(ev.target.value)}
          className="h-8"
        />
      ) : null}
      <div className="flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto rounded-xl border bg-muted/30 p-1">
        {visiveis.map((l) => (
          <LinhaDoAgente key={l.agente.pasta} l={l} u={u} e={e} />
        ))}
        {visiveis.length ? null : <p className="px-2.5 py-2 text-xs text-muted-foreground">{t("empresas.agentes.nada")}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          aria-label={t("empresas.agentes.textoRotulo")}
          placeholder={t("empresas.agentes.textoDica")}
          maxLength={100}
          disabled={!e.pode}
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key !== "Enter") return
            ev.preventDefault()
            adicionar()
          }}
          className="min-w-0 flex-[1_1_180px]"
        />
        <Button size="sm" variant="outline" disabled={!podeAdicionar} onClick={adicionar}>
          <PlusIcon />
          {t("empresas.agentes.textoAdicionar")}
        </Button>
      </div>
      {texto.trim() ? (
        <p className="text-xs text-muted-foreground">
          {pega.length ? tn("empresas.agentes.textoPega", pega.length, { nomes }) : t("empresas.agentes.textoNenhum")}
        </p>
      ) : null}
    </div>
  )
}

/** Um agente na lista: a caixa, o nome, o título e onde ele cai. */
function LinhaDoAgente({ l, u, e }: { l: LinhaAgente; u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  // entra por outra regra (pasta mais larga, nome ou texto) ou está preso a outro projeto em todos os computadores:
  // a caixa mostra o estado, mas não muda aqui
  const travado = l.regraEmTodos || (!l.marcado && (l.porRegra !== null || l.bloqueio !== null))
  const marcada = l.marcado || l.porRegra !== null
  const [situacao, atencao] = l.naoEntra
      ? [
          l.foraDoComputador
            ? t("empresas.agentes.foraDoComputador")
            : t("empresas.agentes.caiEm", { onde: l.ondeNome ?? t("empresas.agentes.semProjeto") }),
          true,
        ]
      : l.regraEmTodos
        ? [t("empresas.agentes.regraEmTodos"), false]
        : l.bloqueio
          ? [t("empresas.agentes.bloqueado", { dono: l.bloqueio }), true]
      : l.porRegra
        ? [t("empresas.agentes.pelaRegra", { regra: l.porRegra }), false]
        : l.onde === u.id
          ? [t("empresas.agentes.aqui"), false]
          : l.ondeNome
            ? [t("empresas.agentes.em", { onde: l.ondeNome }), true]
            : [t("empresas.agentes.semProjeto"), false]
  return (
    <label
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2",
        e.pode && !travado ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
        marcada && "bg-primary/5"
      )}
    >
      <Checkbox
        className="mt-0.5"
        aria-label={l.agente.nome || l.agente.pasta}
        disabled={!e.pode || travado}
        checked={marcada}
        onCheckedChange={() => e.aplicar((atual) => alternarAgente(atual, u.id, l.agente, e.computador) ?? atual)}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{l.agente.nome || l.agente.pasta}</span>
        <span className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
          {l.agente.titulo ? `${l.agente.titulo} · ` : ""}
          <span className={cn(atencao && "text-atencao")}>{situacao}</span>
        </span>
      </span>
    </label>
  )
}

/** 0.21.1: com projeto ligado, avisa quando não sobra conta (ou folga) para o que está fora dos projetos ligados. */
export function AvisoContasLivres({ aviso }: { aviso: AvisoContas }) {
  const { t, tn } = useT()
  const nenhuma = aviso.tipo === "nenhuma"
  return (
    <Alert className="border-atencao-borda bg-atencao-fundo text-atencao *:data-[slot=alert-description]:text-atencao/90">
      <TriangleAlertIcon />
      <AlertTitle>{t(nenhuma ? "empresas.agentes.avisoNenhumaTitulo" : "empresas.agentes.avisoSemFolgaTitulo")}</AlertTitle>
      <AlertDescription>
        {tn(nenhuma ? "empresas.agentes.avisoNenhumaTexto" : "empresas.agentes.avisoSemFolgaTexto", aviso.fora)}
      </AlertDescription>
    </Alert>
  )
}
