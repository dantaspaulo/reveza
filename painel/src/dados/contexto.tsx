import * as React from "react"
import { toast } from "sonner"

import { useT } from "@/i18n"
import { pintarPorWorkspace } from "@/lib/cores"
import { comDemo } from "@/lib/demo"
import { navegar } from "@/lib/rota"
import { ErroPainel, type EstadoTempoReal, type Fonte } from "./fonte"
import type { Idioma, Instantaneo } from "./tipos"

interface ContextoDados {
  fonte: Fonte
  estado: Instantaneo | null
  erro: Error | null
  recarregar: () => Promise<void>
  atualizadoEm: Date | null
  /** Quanto a última leitura completa levou. */
  latenciaMs: number | null
  online: boolean
}

const Contexto = React.createContext<ContextoDados | null>(null)

export function DadosProvider({ fonte, children }: { fonte: Fonte; children: React.ReactNode }) {
  const [estado, setEstado] = React.useState<Instantaneo | null>(null)
  const [erro, setErro] = React.useState<Error | null>(null)
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null)
  const [latenciaMs, setLatenciaMs] = React.useState<number | null>(null)
  const [online, setOnline] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const emVoo = React.useRef<Promise<void> | null>(null)

  const { idioma } = useT()
  const recarregar = React.useCallback(async () => {
    if (emVoo.current) return emVoo.current
    const p = (async () => {
      try {
        const inicio = performance.now()
        const novo = await fonte.carregar()
        setLatenciaMs(Math.round(performance.now() - inicio))
        // contas do mesmo workspace com a mesma cor (e um tom cada nos gráficos), em todas as telas de uma vez
        setEstado({ ...novo, contas: pintarPorWorkspace(novo.contas) })
        setErro(null)
        setAtualizadoEm(new Date())
      } catch (e) {
        setErro(e instanceof Error ? e : new Error(String(e)))
      } finally {
        emVoo.current = null
      }
    })()
    emVoo.current = p
    return p
  }, [fonte])

  // Na demonstração, os textos de exemplo acompanham o idioma da tela (a releitura vem na hora).
  React.useEffect(() => {
    const f = fonte as Fonte & { usarIdioma?: (i: Idioma) => void }
    if (!f.usarIdioma) return
    f.usarIdioma(idioma)
    void recarregar()
  }, [fonte, idioma, recarregar])

  React.useEffect(() => {
    void recarregar()
    // O tempo real avisa a cada mudança (os computadores mexem de 5 em 5 s): relê no máximo a cada 15 s.
    // Depois de uma ação de quem está no painel, useAcao relê na hora.
    let espera: ReturnType<typeof setTimeout> | null = null
    let ultima = Date.now()
    const aoMudar = () => {
      if (espera) return
      const falta = Math.max(300, ultima + 15_000 - Date.now())
      espera = setTimeout(() => {
        espera = null
        ultima = Date.now()
        void recarregar()
      }, falta)
    }
    let atual: EstadoTempoReal = "conectando"
    let desde = 0
    let cancelar = () => {}
    const ligar = () => {
      cancelar()
      desde = Date.now()
      cancelar = fonte.assinar(aoMudar, (e) => {
        atual = e
      })
    }
    ligar()
    // O cliente do tempo real tenta voltar sozinho; se o canal ficou para trás, assina de novo (no máximo a cada 10 s).
    const religarSePreciso = () => {
      if (atual !== "ligado" && Date.now() - desde > 10_000) ligar()
    }
    // rede de segurança: se o tempo real cair, relê a cada 30 s e ao voltar para a aba
    const intervalo = setInterval(() => {
      void recarregar()
      religarSePreciso()
    }, 30_000)
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return
      void recarregar()
      religarSePreciso()
    }
    // A aba que o navegador congelou para poupar memória (ou que voltou do cache de ir e voltar) volta com o canal
    // parecendo vivo e às vezes morto: relê na hora e assina de novo.
    const aoDescongelar = () => {
      void recarregar()
      ligar()
    }
    const aoMostrar = (ev: PageTransitionEvent) => {
      if (ev.persisted) aoDescongelar()
    }
    const aoMudarRede = () => {
      setOnline(navigator.onLine)
      if (!navigator.onLine) return
      void recarregar()
      religarSePreciso()
    }
    document.addEventListener("visibilitychange", aoVoltar)
    document.addEventListener("resume", aoDescongelar)
    window.addEventListener("pageshow", aoMostrar)
    window.addEventListener("online", aoMudarRede)
    window.addEventListener("offline", aoMudarRede)
    return () => {
      cancelar()
      if (espera) clearTimeout(espera)
      clearInterval(intervalo)
      document.removeEventListener("visibilitychange", aoVoltar)
      document.removeEventListener("resume", aoDescongelar)
      window.removeEventListener("pageshow", aoMostrar)
      window.removeEventListener("online", aoMudarRede)
      window.removeEventListener("offline", aoMudarRede)
    }
  }, [fonte, recarregar])

  const valor = React.useMemo(
    () => ({ fonte, estado, erro, recarregar, atualizadoEm, latenciaMs, online }),
    [fonte, estado, erro, recarregar, atualizadoEm, latenciaMs, online]
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

/** Um instantâneo fixo, sem leitura nem tempo real: os testes das telas montam cada seção com ele. */
export function DadosFixos({
  fonte,
  estado,
  children,
}: {
  fonte: Fonte
  estado: Instantaneo
  children: React.ReactNode
}) {
  const valor = React.useMemo<ContextoDados>(
    () => ({
      fonte,
      estado,
      erro: null,
      recarregar: async () => {},
      atualizadoEm: new Date(estado.agora),
      latenciaMs: 0,
      online: true,
    }),
    [fonte, estado]
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useDados() {
  const c = React.useContext(Contexto)
  if (!c) throw new Error("useDados fora do DadosProvider")
  return c
}

/** O instantâneo já carregado (as seções só montam depois do primeiro carregamento). */
export function useEstado(): Instantaneo {
  const { estado } = useDados()
  if (!estado) throw new Error("estado ainda não carregou")
  return estado
}

/** Relógio para "visto há", contagens regressivas etc. Cada componente escolhe a frequência. */
export function useAgora(intervaloMs = 15_000): Date {
  const [agora, setAgora] = React.useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), intervaloMs)
    return () => clearInterval(id)
  }, [intervaloMs])
  return agora
}

/** Consulta sob demanda (uso, sessões, histórico, auditoria), refeita quando as dependências mudam. Enquanto a nova
 * leitura não chega, os dados anteriores continuam na tela. */
export function useConsulta<T>(fazer: (fonte: Fonte) => Promise<T>, deps: React.DependencyList) {
  const { fonte, atualizadoEm } = useDados()
  const { idioma } = useT()
  const fazerRef = React.useRef(fazer)
  React.useLayoutEffect(() => {
    fazerRef.current = fazer
  })
  const [versao, setVersao] = React.useState(0)
  // quando o instantâneo muda, o que depende dele (o uso de hoje) é relido, no máximo de 5 em 5 minutos
  const janela = atualizadoEm ? Math.floor(atualizadoEm.getTime() / 300_000) : 0
  const chave = JSON.stringify([versao, janela, idioma, ...deps])
  const [resultado, setResultado] = React.useState<{ chave: string | null; dados: T | null; erro: Error | null }>({
    chave: null,
    dados: null,
    erro: null,
  })

  React.useEffect(() => {
    let vivo = true
    fazerRef
      .current(fonte)
      .then((dados) => vivo && setResultado({ chave, dados, erro: null }))
      .catch(
        (e) =>
          vivo && setResultado((r) => ({ chave, dados: r.dados, erro: e instanceof Error ? e : new Error(String(e)) }))
      )
    return () => {
      vivo = false
    }
  }, [fonte, chave])

  return {
    dados: resultado.dados,
    erro: resultado.erro,
    carregando: resultado.chave !== chave,
    recarregar: () => setVersao((v) => v + 1),
  }
}

/**
 * Quem pode mudar as coisas: admin. Quem ativou as duas etapas precisa do código nesta sessão (aal2); quem não ativou
 * age só com a senha, a não ser que a instalação exija as duas etapas (a mesma regra do banco, rvz_aal2).
 */
export function usePermissao() {
  const { eu, config } = useEstado()
  if (eu.papel !== "admin") return { pode: false, motivo: "leitura" as const }
  if (eu.aal !== "aal2" && (eu.totp || config.exigirDuasEtapas)) return { pode: false, motivo: "aal1" as const }
  return { pode: true, motivo: null }
}

/** Roda uma ação de escrita com aviso de sucesso ou erro traduzido. Devolve [deu certo, valor]. */
export function useAcao() {
  const { t, tx } = useT()
  const { recarregar } = useDados()
  return React.useCallback(
    async <T,>(fazer: () => Promise<T>, sucesso?: string): Promise<[true, T] | [false, undefined]> => {
      try {
        const r = await fazer()
        if (sucesso) toast.success(sucesso)
        void recarregar()
        return [true, r]
      } catch (e) {
        toast.error(mensagemErro(e, t, tx))
        // A nuvem pediu a verificação em duas etapas (ação de admin sem aal2): leva à tela do código.
        if (e instanceof ErroPainel && e.codigo === "precisa_aal2")
          navegar(comDemo(`/duas-etapas?voltar=${encodeURIComponent(window.location.pathname)}`))
        return [false, undefined]
      }
    },
    [t, tx, recarregar]
  )
}

export function mensagemErro(e: unknown, t: ReturnType<typeof useT>["t"], tx: ReturnType<typeof useT>["tx"]): string {
  const codigo = e instanceof ErroPainel ? e.codigo : e instanceof Error ? e.message : "falha"
  const chave = `erros.${codigo}`
  const msg = tx(chave)
  if (msg !== chave) return msg
  // Sem código conhecido: a mensagem que o banco escreveu (ex.: "o endereço precisa ser https público") é a mais útil.
  if (e instanceof ErroPainel && e.message && e.message !== e.codigo && !/fetch|network/i.test(e.message))
    return e.message
  return t("erros.falha")
}
