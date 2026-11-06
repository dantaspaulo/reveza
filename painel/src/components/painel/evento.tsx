// Uma linha da linha do tempo. O texto sai de evento.dados ({de, para, computador, conta, motivo, pct}), nunca do
// campo "texto" do banco: assim a linha fica no idioma de quem vê e com os nomes atuais de contas e computadores.

import {
  ArrowLeftRightIcon,
  BellRingIcon,
  CirclePlayIcon,
  InfoIcon,
  Link2Icon,
  OctagonMinusIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react"

import type { Evento, Instantaneo, TipoEvento } from "@/dados/tipos"
import { useT } from "@/i18n"
import { fmtDataHora, fmtPct, fmtRelativo } from "@/lib/formato"
import { cn } from "@/lib/utils"

type T = ReturnType<typeof useT>

const ICONES: Record<TipoEvento, typeof InfoIcon> = {
  troca: ArrowLeftRightIcon,
  aviso: TriangleAlertIcon,
  limite: OctagonMinusIcon,
  retomada: CirclePlayIcon,
  conexao: Link2Icon,
  erro: XCircleIcon,
  info: InfoIcon,
  alerta: BellRingIcon,
}

const TONS: Partial<Record<TipoEvento, string>> = {
  aviso: "bg-atencao-fundo text-atencao",
  limite: "bg-erro-fundo text-erro",
  erro: "bg-erro-fundo text-erro",
  alerta: "bg-atencao-fundo text-atencao",
  troca: "bg-muted text-foreground",
}

/** Motivo de uma troca: os textos que o banco grava viram texto do idioma da tela; o resto aparece como veio. */
export function traduzirMotivo(motivo: string | null | undefined, { t }: Pick<T, "t">): string | null {
  if (!motivo) return null
  const m = motivo.trim()
  const chegou = /^chegou a (\d+(?:[.,]\d+)?)%$/.exec(m)
  if (m === "chegou a 100%") return t("motivo.cemPorCento")
  if (chegou) return t("motivo.chegouA", { pct: `${chegou[1]}%` })
  const mapa: Record<string, Parameters<T["t"]>[0]> = {
    "a sessão bateu o limite": "motivo.sessaoLimite",
    "rodízio do dia": "motivo.rodizio",
    "pedido pelo painel": "motivo.manual",
    "pedido pela API": "motivo.api",
    "computador sem conta": "motivo.semConta",
    "conta que já estava no computador": "motivo.jaEstava",
    "conta preferida deste computador": "motivo.preferida",
    "devolvendo a conta preferida de outro computador": "motivo.devolvendo",
    "a conta em uso foi pausada": "motivo.pausada",
    "a conta em uso precisa entrar de novo": "motivo.semLogin",
    "a conta em uso foi removida": "motivo.removida",
    limite: "motivo.limite",
    limiar: "motivo.limiar",
    rodizio: "motivo.rodizio",
    manual: "motivo.manual",
  }
  // Object.hasOwn: o motivo vem do banco, e "constructor" ou "__proto__" não podem virar chave de tradução
  return Object.hasOwn(mapa, m) ? t(mapa[m]!) : m
}

export function textoEvento(e: Evento, estado: Pick<Instantaneo, "contas" | "computadores">, i: T) {
  const { t, tx, idioma } = i
  const d = e.dados ?? {}
  const canal = (c: unknown) => {
    const chave = `alertas.canais.${String(c ?? "")}`
    return tx(chave) === chave ? String(c ?? "") : tx(chave)
  }
  const conta = (id: unknown) =>
    id ? (estado.contas.find((c) => c.id === id)?.email ?? String(id).slice(0, 8)) : t("evento.nenhuma")
  const pc = (id: unknown) =>
    id ? (estado.computadores.find((c) => c.id === id)?.nome ?? String(id).slice(0, 8)) : t("evento.alguem")
  const vars = { computador: pc(d.computador), conta: conta(d.conta), de: conta(d.de), para: conta(d.para) }
  // nos eventos de atualização, de e para são versões (X.Y.Z), não contas
  const versao = (v: unknown) => (typeof v === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? v : "?")
  // a nuvem e o painel (0.3.0): a nuvem atualizada, funções e painel publicados, a atualização completa ligada ou não
  if (d.atualizacao_nuvem === "concluida") return { titulo: t("evento.nuvemAtualizada", { para: versao(d.para) }), detalhe: null }
  if (d.publicacao === "concluida") return { titulo: t("evento.publicacaoConcluida", { para: versao(d.para), computador: vars.computador }), detalhe: null }
  if (d.atualizacao_completa === "ligada" || d.atualizacao_completa === "desligada") {
    return { titulo: t(d.atualizacao_completa === "ligada" ? "evento.completaLigada" : "evento.completaDesligada", { computador: vars.computador }), detalhe: null }
  }
  if (typeof d.atualizacao === "string" && ["pedida", "concluida", "falhou", "precisa_nuvem"].includes(d.atualizacao)) {
    const v = { computador: vars.computador, de: versao(d.de), para: versao(d.para) }
    const chave =
      d.atualizacao === "pedida"
        ? "evento.atualizacaoPedida"
        : d.atualizacao === "concluida"
          ? "evento.atualizacaoConcluida"
          : d.atualizacao === "precisa_nuvem"
            ? "evento.atualizacaoPrecisaNuvem"
            : "evento.atualizacaoFalhou"
    const motivo = d.atualizacao === "falhou" && typeof d.motivo === "string" ? d.motivo.slice(0, 200) : null
    const sozinho = d.sozinho === true ? t(d.modo === "assim_que_sair" ? "evento.atualizacaoAssimQueSair" : "evento.atualizacaoSozinho") : null
    return { titulo: t(chave, v), detalhe: motivo ?? sozinho }
  }
  // computador novo (0.2.0): o pedido, a entrega da chave e a recusa vêm da nuvem com os dados de cada um
  if (d.ligacao === "pedido") return { titulo: t("evento.ligacaoPedido"), detalhe: null }
  if (d.ligacao === "entregue") return { titulo: t("evento.ligacaoEntregue", { por: pc(d.por) }), detalhe: null }
  if (d.ligacao === "recusado") {
    const motivo = d.motivo === "dois_pedidos" || d.motivo === "codigo_errado" ? d.motivo : "recusado_na_tela"
    return { titulo: t("evento.ligacaoRecusada"), detalhe: t(`evento.ligacaoMotivo.${motivo}`, { por: pc(d.por) }) }
  }
  let titulo: string
  let detalhe: string | null = null
  switch (e.tipo) {
    case "troca":
      titulo = d.de ? t("evento.troca", vars) : t("evento.trocaSemDe", vars)
      detalhe = traduzirMotivo(d.motivo as string | undefined, i)
      break
    case "aviso":
      titulo = t("evento.aviso", {
        ...vars,
        pct: fmtPct(typeof d.pct === "number" ? d.pct : Number(d.pct ?? 0), idioma),
      })
      break
    case "limite":
      titulo = t("evento.limite", vars)
      break
    case "retomada":
      titulo = t("evento.retomada", vars)
      break
    case "conexao":
      titulo = d.conta ? t("evento.conexao", vars) : t("evento.conexaoComputador", vars)
      break
    case "erro": {
      titulo = d.motivo === "precisa_login" ? t("evento.erroLogin", vars) : t("evento.erro", vars)
      // o que deu errado vem no texto do computador (o título só diz onde); erro do log chega com o prefixo do agente
      const texto = typeof d.erro === "string" && d.erro ? d.erro : typeof e.texto === "string" ? e.texto.replace(/^Erro no agente: /, "") : ""
      detalhe = d.motivo === "precisa_login" || !texto.trim() ? null : texto.slice(0, 200)
      break
    }
    case "alerta":
      if (d.motivo === "atualizacao_falhou") {
        titulo =
          d.parte === "nuvem"
            ? t("evento.nuvemFalhou", { para: versao(d.para) })
            : d.parte === "publicacao"
              ? t("evento.publicacaoFalhou", { para: versao(d.para), computador: vars.computador })
              : t("evento.atualizacaoSozinhoFalhou", { computador: vars.computador, para: versao(d.para) })
        detalhe = typeof d.erro === "string" && d.erro ? d.erro.slice(0, 200) : null
      } else if (d.motivo === "troca_falhou") {
        // o texto que foi pelos canais é da nuvem; aqui o painel monta o seu com as contas que ele conhece
        titulo = d.para ? t("evento.trocaFalhou", vars) : t("evento.trocaFalhouSemConta", vars)
        detalhe = d.de ? t("evento.trocaFalhouContinua", vars) : null
      } else if (d.motivo === "sem_livre") titulo = t("evento.semLivre", vars)
      else if (d.motivo === "teste") titulo = t("evento.teste", { canal: canal(d.canal) })
      else titulo = t("evento.alertaEnviado", { canal: canal(d.canal) })
      break
    default: {
      const chaves = Object.keys(d)
      if (d.motivo === "auto_ligada") titulo = t("evento.autoLigada")
      else if (d.motivo === "auto_desligada") titulo = t("evento.autoDesligada")
      else if (d.motivo === "revogado") titulo = t("evento.revogado", vars)
      else if (d.motivo === "teste_webhook") titulo = t("evento.testeWebhook")
      else if (d.motivo === "leitura") titulo = t("evento.leitura", vars)
      else if (d.conserto === true) {
        titulo = t("evento.conserto", vars)
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
        detalhe = t("evento.consertoResumo", { corrigidos: n(d.corrigidos), naoDeu: n(d.nao_deu) })
      }
      else if (chaves.length === 1 && chaves[0] === "computador") titulo = t("evento.ligacao", vars)
      else titulo = d.computador ? `${t("evento.info")} · ${vars.computador}` : t("evento.info")
    }
  }
  return { titulo, detalhe }
}

export function LinhaEvento({
  evento,
  estado,
  agora,
  className,
}: {
  evento: Evento
  estado: Pick<Instantaneo, "contas" | "computadores">
  agora: Date
  className?: string
}) {
  const i = useT()
  const { titulo, detalhe } = textoEvento(evento, estado, i)
  const Icone = ICONES[evento.tipo] ?? InfoIcon
  return (
    <li className={cn("flex items-start gap-3 py-2.5", className)}>
      <span
        className={cn(
          "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
          TONS[evento.tipo] ?? "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        <Icone className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words">{titulo}</p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={evento.em} title={fmtDataHora(evento.em, agora, i.idioma)}>
            {fmtRelativo(evento.em, agora, i.idioma)}
          </time>
          {detalhe ? <> · {detalhe}</> : null}
        </p>
      </div>
    </li>
  )
}
