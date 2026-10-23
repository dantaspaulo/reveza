// Contas: a lista (tabela do shadcn/ui no computador, cartões no celular), as regras de cada uma numa gaveta lateral
// (Sheet) e o pedido de login a um computador.

import * as React from "react"
import {
  SparklesIcon,
  BanIcon,
  BrainCircuitIcon,
  CalendarClockIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  LockIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react"

import { BarraUso, NomeConta, PontoConta, SeloEstado } from "@/components/painel/conta"
import { DialogoLogin } from "@/components/painel/dialogo-login"
import { EditorAgenda, resumoFaixa, useDias } from "@/components/painel/editor-agenda"
import { AvisoPermissao, Pagina } from "@/components/painel/pagina"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAcao, useAgora, useDados, useEstado, usePermissao } from "@/dados/contexto"
import {
  estadoConta,
  FORMATO_MODELO,
  MODELOS_PRONTOS,
  nomeDoModelo,
  nomePlano,
  normalizarModelo,
  p5,
  p7,
  resetDe,
} from "@/dados/derivados"
import type { CamposConta } from "@/dados/fonte"
import type { Conta, Instantaneo } from "@/dados/tipos"
import { useT } from "@/i18n"
import { N_CORES, corConta, indiceCor } from "@/lib/cores"
import { fmtFuturo, fmtHora, fmtPct, fmtRelativo } from "@/lib/formato"
import { cn } from "@/lib/utils"
import { useDialogo } from "@/hooks/use-dialogo"

export default function Contas() {
  const { t } = useT()
  const estado = useEstado()
  const agora = useAgora(15_000)
  const { pode } = usePermissao()
  const editar = useDialogo<Conta>()
  const login = useDialogo<Conta>()
  const contas = [...estado.contas].sort((a, b) => a.prioridade - b.prioridade || a.email.localeCompare(b.email))

  return (
    <Pagina
      titulo={t("menu.secoes.contas")}
      descricao={t("contas.descricao")}
      acoes={
        <Button onClick={() => login.abrir()} disabled={!pode}>
          <PlusIcon />
          {t("contas.conectar")}
        </Button>
      }
    >
      <AvisoPermissao />
      {contas.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>{t("contas.vazio.titulo")}</EmptyTitle>
            <EmptyDescription>{t("contas.vazio.texto")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => login.abrir()} disabled={!pode}>
              <PlusIcon />
              {t("contas.conectar")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Card className="hidden py-0 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("contas.colunas.conta")}</TableHead>
                  <TableHead>{t("contas.colunas.estado")}</TableHead>
                  <TableHead className="w-44">{t("contas.colunas.cinco")}</TableHead>
                  <TableHead className="w-44">{t("contas.colunas.semana")}</TableHead>
                  <TableHead>{t("contas.colunas.regras")}</TableHead>
                  <TableHead className="w-12 pr-4 text-right">
                    <span className="sr-only">{t("contas.colunas.acoes")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contas.map((c) => (
                  <TableRow key={c.id} id={`conta-${c.id}`}>
                    <TableCell className="max-w-72 pl-4">
                      <InfoConta conta={c} estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <SeloEstado estado={estadoConta(c, estado.config, agora)} />
                    </TableCell>
                    <TableCell>
                      <Janela conta={c} tipo="five_hour" estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <Janela conta={c} tipo="seven_day" estado={estado} agora={agora} />
                    </TableCell>
                    <TableCell>
                      <Regras conta={c} estado={estado} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <MenuConta conta={c} aoEditar={() => editar.abrir(c)} aoEntrar={() => login.abrir(c)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {contas.map((c) => (
              <Card key={c.id} className="gap-3 py-4">
                <CardContent className="flex flex-col gap-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <InfoConta conta={c} estado={estado} agora={agora} />
                    <MenuConta conta={c} aoEditar={() => editar.abrir(c)} aoEntrar={() => login.abrir(c)} />
                  </div>
                  <SeloEstado estado={estadoConta(c, estado.config, agora)} className="self-start" />
                  <Janela conta={c} tipo="five_hour" estado={estado} agora={agora} comRotulo />
                  <Janela conta={c} tipo="seven_day" estado={estado} agora={agora} comRotulo />
                  <Regras conta={c} estado={estado} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      <EditarConta key={editar.chave} conta={editar.valor ?? null} aberto={editar.aberto} aoFechar={editar.fechar} />
      <DialogoLogin key={`login-${login.chave}`} aberto={login.aberto} conta={login.valor} aoFechar={login.fechar} />
    </Pagina>
  )
}

function InfoConta({ conta, estado, agora }: { conta: Conta; estado: Instantaneo; agora: Date }) {
  const { t, idioma } = useT()
  const plano = nomePlano(conta)
  const pc = conta.posse ? estado.computadores.find((c) => c.id === conta.posse?.computadorId) : undefined
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <NomeConta conta={conta} mostrarOrg className="font-medium" />
      <div className="flex flex-wrap items-center gap-1.5 pl-[18px] text-xs text-muted-foreground">
        {plano ? (
          <Badge variant="outline" className="h-4.5 px-1.5 text-[11px]">
            {plano}
          </Badge>
        ) : null}
        <span>
          {conta.lidoEm
            ? t("contas.lido", { quando: fmtRelativo(conta.lidoEm, agora, idioma) })
            : t("contas.semLeitura")}
        </span>
        {pc && conta.posse?.motivo === "uso" ? <span>· {t("contas.emUsoEm", { computador: pc.nome })}</span> : null}
      </div>
    </div>
  )
}

function Janela({
  conta,
  tipo,
  estado,
  agora,
  comRotulo,
}: {
  conta: Conta
  tipo: "five_hour" | "seven_day"
  estado: Instantaneo
  agora: Date
  comRotulo?: boolean
}) {
  const { t, idioma } = useT()
  const pct = tipo === "five_hour" ? p5(conta, agora) : p7(conta, agora)
  const reset = resetDe(conta, tipo)
  if (pct === null && !comRotulo) return <span className="text-xs text-muted-foreground">–</span>
  return (
    <BarraUso
      pct={pct}
      cor={conta.cor}
      aviso={tipo === "five_hour" ? estado.config.aviso : undefined}
      troca={tipo === "five_hour" && estado.config.modo !== "limite" ? estado.config.troca : undefined}
      rotulo={
        comRotulo
          ? t(`janela.${tipo}`)
          : reset
            ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) })
            : ""
      }
      detalhe={comRotulo && reset ? t("visao.emUso.renova", { quando: fmtFuturo(reset, agora, idioma) }) : undefined}
    />
  )
}

function Regras({ conta, estado }: { conta: Conta; estado: Instantaneo }) {
  const { t, idioma } = useT()
  const { curtos } = useDias()
  const itens: { icone: typeof LifeBuoyIcon; texto: string }[] = []
  // a conta não roda o modelo das sessões de um computador (sem créditos de uso): fora dele até a hora marcada
  for (const s of conta.semModelo) {
    const pc = estado.computadores.find((x) => x.id === s.computadorId)
    itens.push({
      icone: BanIcon,
      texto: t("contas.semModelo", { modelo: nomeDoModelo(s.modelo), computador: pc?.nome ?? "?", hora: fmtHora(s.ate, idioma) }),
    })
  }
  const fable = conta.janelas.find((j) => j.tipo === "seven_day_fable")
  if (fable && fable.pct !== null) itens.push({ icone: SparklesIcon, texto: t("contas.semanaFable", { pct: fmtPct(fable.pct, idioma) }) })
  if (conta.reserva) itens.push({ icone: LifeBuoyIcon, texto: t("contas.reservaRegra") })
  if (conta.pausada) itens.push({ icone: PauseIcon, texto: t("estadoConta.pausada") })
  if (conta.tetoSemana != null)
    itens.push({ icone: Settings2Icon, texto: t("contas.teto", { pct: fmtPct(conta.tetoSemana, idioma) }) })
  if (conta.modelo) itens.push({ icone: BrainCircuitIcon, texto: t("contas.modeloRegra", { modelo: conta.modelo }) })
  itens.push({
    icone: CalendarClockIcon,
    texto: conta.agenda.length
      ? conta.agenda.map((f) => resumoFaixa(f, curtos, t("contas.agenda.ate"))).join("; ")
      : t("contas.agendaSempre"),
  })
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <li className="text-foreground">
        {t("contas.colunas.prioridade")} {conta.prioridade}
      </li>
      {itens.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <it.icone className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{it.texto}</span>
        </li>
      ))}
    </ul>
  )
}

function MenuConta({ conta, aoEditar, aoEntrar }: { conta: Conta; aoEditar: () => void; aoEntrar: () => void }) {
  const { t } = useT()
  const { fonte } = useDados()
  const acao = useAcao()
  const { pode } = usePermissao()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${t("contas.colunas.acoes")}: ${conta.email}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={aoEditar} disabled={!pode}>
          <Settings2Icon />
          {t("contas.menu.editar")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={aoEntrar} disabled={!pode}>
          <KeyRoundIcon />
          {t("contas.menu.entrarDeNovo")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!pode}
          onSelect={() =>
            void acao(
              () => fonte.salvarConta(conta.id, { pausada: !conta.pausada }),
              t(conta.pausada ? "contas.retomada" : "contas.pausada", { conta: conta.email })
            )
          }
        >
          {conta.pausada ? <PlayIcon /> : <PauseIcon />}
          {conta.pausada ? t("contas.menu.retomar") : t("contas.menu.pausar")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Seletor das 7 cores da paleta. `ocupadas` são as cores de outros workspaces (cor -> nome): ficam apagadas, para dois
 * workspaces não dividirem a mesma cor (cadeado e apagadas). Com as 7 em uso por outros, todas ficam livres.
 */
export function SeletorCor({
  valor,
  aoMudar,
  desligado,
  rotulo,
  ocupadas,
}: {
  valor: number
  aoMudar: (v: number) => void
  desligado?: boolean
  rotulo: string
  ocupadas?: Map<number, string>
}) {
  const { t } = useT()
  const todasOcupadas = (ocupadas?.size ?? 0) >= N_CORES
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {Array.from({ length: N_CORES }, (_, i) => {
        const dono = todasOcupadas || indiceCor(valor) === i ? undefined : ocupadas?.get(i)
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={indiceCor(valor) === i}
            aria-label={
              dono
                ? `${t("contas.editar.corN", { n: i + 1 })}, ${t("contas.editar.corEmUso", { workspace: dono })}`
                : t("contas.editar.corN", { n: i + 1 })
            }
            title={dono ? t("contas.editar.corEmUso", { workspace: dono }) : undefined}
            disabled={desligado || !!dono}
            onClick={() => aoMudar(i)}
            className={cn(
              "grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              dono && "disabled:opacity-35",
              indiceCor(valor) === i && "ring-2 ring-foreground"
            )}
            style={{ background: corConta(i) }}
          >
            {dono ? <LockIcon className="size-3.5 text-foreground" aria-hidden /> : null}
          </button>
        )
      })}
    </div>
  )
}

/** A cor vale para o workspace: as contas dele (a que se edita primeiro) e as cores que outros workspaces já têm. */
function useWorkspaceDaConta(conta: Conta | null) {
  const estado = useEstado()
  return React.useMemo(() => {
    if (!conta) return { contas: [] as Conta[], ocupadas: new Map<number, string>() }
    const mesmo = (c: Conta) => c.id === conta.id || (!!conta.workspace && c.workspace === conta.workspace)
    const contas = [conta, ...estado.contas.filter((c) => mesmo(c) && c.id !== conta.id)].sort(
      (a, b) => (a.tom ?? 0) - (b.tom ?? 0)
    )
    const ocupadas = new Map<number, string>()
    for (const c of estado.contas)
      if (!mesmo(c) && !ocupadas.has(indiceCor(c.cor))) ocupadas.set(indiceCor(c.cor), c.nomeWorkspace ?? c.email)
    return { contas, ocupadas }
  }, [conta, estado.contas])
}

/** O campo da cor na gaveta: diz de qual workspace é a cor e mostra o tom de cada conta dele nos gráficos. */
const SEM_MODELO = "nenhum"
const OUTRO_MODELO = "outro"

// O modelo que o agente grava no Claude Code quando o computador passa para a conta: um dos apelidos de sempre ou um
// nome digitado. A escolha fica local: digitar "opus" a caminho de "opusplan" não fecha o campo de texto.
function CampoModelo({
  valor,
  invalido,
  aoMudar,
  desligado,
}: {
  valor: string | null
  invalido: boolean
  aoMudar: (modelo: string | null) => void
  desligado: boolean
}) {
  const { t } = useT()
  const pronto = (v: string | null) => (MODELOS_PRONTOS as readonly string[]).includes(v ?? "")
  const [escolha, setEscolha] = React.useState(() =>
    valor === null ? SEM_MODELO : pronto(valor) ? valor : OUTRO_MODELO
  )
  const escolher = (v: string) => {
    setEscolha(v)
    if (v === SEM_MODELO) aoMudar(null)
    else if (v === OUTRO_MODELO) aoMudar(valor !== null && !pronto(valor) ? valor : "")
    else aoMudar(v)
  }
  return (
    <Field>
      <FieldLabel htmlFor="modelo">{t("contas.editar.modelo")}</FieldLabel>
      <FieldDescription>{t("contas.editar.modeloDica")}</FieldDescription>
      <Select value={escolha} onValueChange={escolher} disabled={desligado}>
        <SelectTrigger id="modelo" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_MODELO}>{t("contas.editar.modeloOpcoes.nenhum")}</SelectItem>
          {MODELOS_PRONTOS.map((m) => (
            <SelectItem key={m} value={m} className="font-mono">
              {m}
            </SelectItem>
          ))}
          <SelectItem value={OUTRO_MODELO}>{t("contas.editar.modeloOpcoes.outro")}</SelectItem>
        </SelectContent>
      </Select>
      {escolha === OUTRO_MODELO ? (
        <>
          <Input
            aria-label={t("contas.editar.modelo")}
            className="font-mono"
            placeholder={t("contas.editar.modeloPlaceholder")}
            value={valor ?? ""}
            maxLength={70}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={desligado}
            aria-invalid={invalido && (valor ?? "") !== ""}
            onChange={(e) => aoMudar(e.target.value)}
          />
          {invalido && (valor ?? "") !== "" ? <FieldError>{t("contas.editar.modeloInvalido")}</FieldError> : null}
        </>
      ) : null}
    </Field>
  )
}

function CampoCor({
  conta,
  contas,
  ocupadas,
  valor,
  aoMudar,
  desligado,
}: {
  conta: Conta
  contas: Conta[]
  ocupadas: Map<number, string>
  valor: number
  aoMudar: (v: number) => void
  desligado?: boolean
}) {
  const { t, tn } = useT()
  const nome = conta.nomeWorkspace
  const rotulo = nome ? t("contas.editar.corWorkspace", { workspace: nome }) : t("contas.editar.cor")
  const temOcupada = ocupadas.size < N_CORES && [...ocupadas.keys()].some((c) => c !== indiceCor(valor))
  return (
    <Field>
      <FieldLabel className="break-words">{rotulo}</FieldLabel>
      <SeletorCor valor={valor} aoMudar={aoMudar} desligado={desligado} rotulo={rotulo} ocupadas={ocupadas} />
      <FieldDescription>
        {nome ? tn("contas.editar.corDicaWorkspace", contas.length) : t("contas.editar.corDica")}
        {temOcupada ? ` ${t("contas.editar.corOcupada")}` : ""}
      </FieldDescription>
      {contas.length > 1 ? (
        <ul className="flex flex-wrap gap-1.5">
          {contas.map((c) => (
            <li key={c.id}>
              <Badge variant="outline" className="max-w-full gap-1.5 font-normal">
                <PontoConta cor={valor} tom={c.tom} className="ring-0" />
                <span className="truncate">{c.email}</span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  )
}

export function EditarConta({
  conta,
  aberto,
  aoFechar,
}: {
  conta: Conta | null
  aberto: boolean
  aoFechar: () => void
}) {
  const { t, idioma } = useT()
  const { fonte } = useDados()
  const estado = useEstado()
  const acao = useAcao()
  const { pode } = usePermissao()
  const workspace = useWorkspaceDaConta(conta)
  // quem abre passa key={chave da abertura}: o rascunho nasce da conta a cada vez
  const [rascunho, setRascunho] = React.useState<Required<CamposConta> | null>(() =>
    conta
      ? {
          cor: conta.cor,
          prioridade: conta.prioridade,
          reserva: conta.reserva,
          pausada: conta.pausada,
          agenda: conta.agenda,
          tetoSemana: conta.tetoSemana,
          modelo: conta.modelo,
        }
      : null
  )
  const [salvando, setSalvando] = React.useState(false)

  const r = rascunho
  // null = não mexer; texto que não passa no formato (inclusive "Outro" vazio) segura o Salvar
  const modeloInvalido = !!r && r.modelo !== null && !FORMATO_MODELO.test(r.modelo.trim().toLowerCase())
  const mudar = (campos: Partial<Required<CamposConta>>) => setRascunho((x) => (x ? { ...x, ...campos } : x))
  return (
    <Sheet open={aberto && !!conta} onOpenChange={(v) => !v && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {conta && r ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8 break-all">{t("contas.editar.titulo", { conta: conta.email })}</SheetTitle>
              <SheetDescription>{t("contas.editar.descricao")}</SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <FieldGroup>
                <CampoCor
                  conta={conta}
                  contas={workspace.contas}
                  ocupadas={workspace.ocupadas}
                  valor={r.cor}
                  aoMudar={(cor) => mudar({ cor })}
                  desligado={!pode}
                />
                <Field>
                  <FieldLabel htmlFor="prioridade">{t("contas.editar.prioridade")}</FieldLabel>
                  <Input
                    id="prioridade"
                    type="number"
                    min={0}
                    max={1000}
                    className="w-28"
                    value={r.prioridade}
                    disabled={!pode}
                    onChange={(e) => mudar({ prioridade: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
                  />
                  <FieldDescription>{t("contas.editar.prioridadeDica")}</FieldDescription>
                </Field>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="reserva">{t("contas.editar.reserva")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.reservaDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="reserva"
                    checked={r.reserva}
                    disabled={!pode}
                    onCheckedChange={(reserva) => mudar({ reserva })}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="pausada">{t("contas.editar.pausada")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.pausadaDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="pausada"
                    checked={r.pausada}
                    disabled={!pode}
                    onCheckedChange={(pausada) => mudar({ pausada })}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="teto">{t("contas.editar.teto")}</FieldLabel>
                    <FieldDescription>{t("contas.editar.tetoDica")}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="teto"
                    checked={r.tetoSemana != null}
                    disabled={!pode}
                    onCheckedChange={(v) => mudar({ tetoSemana: v ? 80 : null })}
                  />
                </Field>
                {r.tetoSemana != null ? (
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[r.tetoSemana]}
                      min={10}
                      max={100}
                      step={5}
                      disabled={!pode}
                      onValueChange={(v) => mudar({ tetoSemana: v[0] ?? 80 })}
                      aria-label={t("contas.editar.teto")}
                    />
                    <span className="w-12 text-right text-sm tabular-nums">{fmtPct(r.tetoSemana, idioma)}</span>
                  </div>
                ) : null}
                <FieldSeparator />
                <CampoModelo
                  valor={r.modelo}
                  invalido={modeloInvalido}
                  aoMudar={(modelo) => mudar({ modelo })}
                  desligado={!pode}
                />
                <FieldSeparator />
                <Field>
                  <FieldLabel>{t("contas.editar.agenda")}</FieldLabel>
                  <FieldDescription>
                    {t("contas.editar.agendaDica")} {t("contas.agenda.fuso", { fuso: estado.config.fuso })}
                  </FieldDescription>
                  <EditorAgenda valor={r.agenda} aoMudar={(agenda) => mudar({ agenda })} desligado={!pode} />
                </Field>
              </FieldGroup>
            </div>
            <SheetFooter className="flex-row justify-end gap-2 border-t">
              <Button variant="outline" onClick={aoFechar}>
                {t("comum.cancelar")}
              </Button>
              <Button
                disabled={!pode || salvando || modeloInvalido}
                onClick={async () => {
                  setSalvando(true)
                  // a cor só vai quando mudou, e aí para todas as contas do workspace (pelo mesmo caminho de gravação)
                  const { cor, modelo, ...resto } = r
                  const mudouCor = indiceCor(cor) !== indiceCor(conta.cor)
                  // o modelo também só vai quando mudou: uma nuvem de antes da 0.6.0 recusa o campo
                  const novoModelo = normalizarModelo(modelo)
                  const mudouModelo = novoModelo !== conta.modelo
                  const [ok] = await acao(
                    async () => {
                      await fonte.salvarConta(conta.id, {
                        ...resto,
                        agenda: resto.agenda.filter((f) => f.dias.length > 0),
                        ...(mudouCor ? { cor } : {}),
                        ...(mudouModelo ? { modelo: novoModelo } : {}),
                      })
                      if (mudouCor)
                        for (const outra of workspace.contas)
                          if (outra.id !== conta.id) await fonte.salvarConta(outra.id, { cor })
                    },
                    t("contas.editar.salvo", { conta: conta.email })
                  )
                  setSalvando(false)
                  if (ok) aoFechar()
                }}
              >
                {salvando ? <Spinner /> : null}
                {t("comum.salvar")}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
