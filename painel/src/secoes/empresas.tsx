// Empresas (0.20.0): o cadastro operacional. Escolhe o computador, a empresa à esquerda e edita tudo à direita, sem
// janela por cima: conta, pasta e projetos. Cada projeto usa a conta da empresa ou uma própria. Salvar grava o que mudou
// (painel_unidade) e a empresa ou o projeto passa a rodar só nas contas marcadas. Os números ficaram na tela de Uso.

import * as React from "react"
import {
  Building2Icon,
  ChevronRightIcon,
  InfoIcon,
  LaptopIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { NomeConta } from "@/components/painel/conta"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { useAcao, useConsulta, useDados, useEstado, usePermissao } from "@/dados/contexto"
import { ErroPainel } from "@/dados/fonte"
import type { Conta, DadosEmpresas, SessaoUso } from "@/dados/tipos"
import { useT } from "@/i18n"
import {
  alteradas,
  contasDe,
  ligada,
  modoAlternado,
  pastasEm,
  planoDeGravar,
  rascunhoDe,
  rodaEm,
  temRegraEm,
  validar,
  type ErroCadastro,
  type UnidadeRascunho,
} from "@/lib/cadastro"
import { N_CORES } from "@/lib/cores"
import { comDemo } from "@/lib/demo"
import { empresasForaNoAntigo, versaoNum } from "@/lib/empresas"
import { Link } from "@/lib/rota"
import { cn } from "@/lib/utils"

let ultimoNovo = 0
const idNovo = () => `novo-${++ultimoNovo}`

/** As pastas que a pessoa já usa naquele computador: agentes do OpenBot e sessões dos últimos 30 dias. */
function sugestoesDe(dados: DadosEmpresas, sessoes: SessaoUso[] | null, computador: string): string[] {
  const todas = [
    ...dados.agentes.filter((a) => a.computadorId === computador).map((a) => a.pasta),
    ...(sessoes ?? []).filter((s) => s.computadorId === computador).map((s) => s.pasta),
  ]
  return [...new Set(todas.filter(Boolean))].sort().slice(0, 100)
}

/** O que os campos de uma empresa ou projeto precisam para ler e mudar o rascunho. */
interface Edicao {
  lista: UnidadeRascunho[]
  contas: Conta[]
  computador: string
  nomeComputador: string
  sugestoes: string[]
  pode: boolean
  mudar: (id: string, campos: Partial<UnidadeRascunho>) => void
  marcarConta: (u: UnidadeRascunho, conta: string) => void
  alternar: (u: UnidadeRascunho) => void
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

  const empresa = raizes.find((u) => u.id === selecionada) ?? raizes[0] ?? null
  const mudanca = alteradas(referencia, lista).length > 0 && !aguardando

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
    editar((atual) => [
      ...atual,
      { id, novo: true, nome: "", pai: null, cor: atual.length % N_CORES, modo: "desligado", contas: [], pastas: [], titulos: [] },
    ])
    setSelecionada(id)
    setAberto(null)
    setApagar(null)
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
          sugestoes: sugestoesDe(dados, sessoes.dados, computador.id),
          pode,
          mudar,
          marcarConta,
          alternar,
        }
      : null

  return (
    <Pagina
      titulo={t("menu.secoes.empresas")}
      descricao={t("empresas.op.subtitulo")}
      acoes={
        <Button size="sm" disabled={!pode || !edicao} onClick={novaEmpresa}>
          <PlusIcon />
          {t("empresas.op.novaEmpresa")}
        </Button>
      }
    >
      <AvisoPermissao />
      {dados ? <Avisos dados={dados} /> : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          {t("empresas.op.computador")}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {computadores.length ? (
            <Tabs value={computador?.id ?? ""} onValueChange={setEscolhido} className="max-w-full min-w-0">
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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>{t("empresas.op.semEmpresa")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" disabled={!pode} onClick={novaEmpresa}>
              <PlusIcon />
              {t("empresas.op.novaEmpresa")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-[232px_minmax(0,1fr)]">
          <ListaEmpresas
            raizes={raizes}
            lista={lista}
            atual={empresa.id}
            computador={edicao.computador}
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
                <Building2Icon className="size-4" />
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

            {mudanca || erro ? (
              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
                <p className={cn("text-sm", erro && "text-erro")} role={erro ? "alert" : undefined}>
                  {erro ? textoErro(erro, t) : t("empresas.op.naoSalvas")}
                </p>
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
            ) : null}
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

/** Só aparece quando há o que dizer: computador atrasado e o que o modo teste faria. */
function Avisos({ dados }: { dados: DadosEmpresas }) {
  const { t, tn } = useT()
  const estado = useEstado()
  const fora = React.useMemo(() => empresasForaNoAntigo(dados), [dados])
  const atras = estado.computadores.filter((c) => !c.revogado && versaoNum(c.versao) < versaoNum("0.19.0"))
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

function ListaEmpresas({
  raizes,
  lista,
  atual,
  computador,
  aoEscolher,
}: {
  raizes: UnidadeRascunho[]
  lista: UnidadeRascunho[]
  atual: string
  computador: string
  aoEscolher: (id: string) => void
}) {
  const { t, tn } = useT()
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-3xl border bg-muted/30 p-1.5">
      {raizes.map((e) => {
        const projetos = lista.filter((p) => p.pai === e.id).length
        const aqui = rodaEm(e, lista, computador)
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
                ligada(e, lista) && aqui && "bg-ok ring-[3px] ring-ok/20"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{e.nome || t("empresas.op.novaEmpresa")}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {!aqui
                  ? t("empresas.op.naoRodaAqui")
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
            {aqui ? "" : ` · ${t("empresas.op.naoRodaAqui").toLowerCase()}`}
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

/** Contas e pasta: o mesmo bloco na empresa e no projeto. */
function Campos({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  const contas = e.contas.filter((c) => !c.saiEm || u.contas.includes(c.id))
  const chip =
    "h-auto min-h-7 max-w-full justify-start rounded-full px-3 py-1 font-normal text-muted-foreground whitespace-normal hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/15"
  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <Rotulo>{t("empresas.op.contas")}</Rotulo>
        <div className="flex flex-wrap gap-1.5">
          {u.pai ? (
            <Toggle
              variant="outline"
              size="sm"
              className={chip}
              disabled={!e.pode}
              pressed={u.contas.length === 0}
              onPressedChange={() => e.mudar(u.id, { contas: [] })}
            >
              {t("empresas.op.contaDaEmpresa")}
            </Toggle>
          ) : null}
          {contas.map((c) => {
            const marcada = u.contas.includes(c.id)
            const outras = marcada
              ? e.lista.filter((x) => x.id !== u.id && x.contas.includes(c.id)).map((x) => x.nome)
              : []
            return (
              <Toggle
                key={c.id}
                variant="outline"
                size="sm"
                className={chip}
                disabled={!e.pode}
                pressed={marcada}
                onPressedChange={() => e.marcarConta(u, c.id)}
              >
                <NomeConta conta={c} />
                {outras.length ? <span className="text-xs text-muted-foreground">· {outras.join(", ")}</span> : null}
              </Toggle>
            )
          })}
          {contas.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("empresas.op.semContas")}</span>
          ) : null}
        </div>
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

/** A pasta neste computador. Sem nenhuma, uma linha vazia: digitar já cria a regra. */
function Pastas({ u, e }: { u: UnidadeRascunho; e: Edicao }) {
  const { t } = useT()
  const achadas = pastasEm(u, e.computador)
  const linhas = achadas.length ? achadas : [{ pasta: { computador: e.computador, padrao: "" }, indice: -1 }]
  const idLista = `pastas-${u.id}-${e.computador}`
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
          <option key={p} value={p} />
        ))}
      </datalist>
      {linhas.map(({ pasta, indice }, i) => (
        <div key={i} className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Input
            aria-label={t("empresas.op.pasta")}
            placeholder={t("empresas.op.naoRodaAqui")}
            maxLength={300}
            list={idLista}
            disabled={!e.pode}
            value={pasta.padrao}
            onChange={(ev) => trocar(indice, { padrao: ev.target.value })}
            className="min-w-0 flex-[1_1_180px]"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox
              disabled={!e.pode}
              checked={pasta.computador === null}
              onCheckedChange={(v) => trocar(indice, { computador: v === true ? null : e.computador })}
            />
            {t("empresas.op.emTodos")}
          </label>
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
    </div>
  )
}
