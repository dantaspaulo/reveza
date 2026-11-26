// As gravações do cadastro de projetos nesta aba (0.21.1). A trava é da aba inteira, e não de uma tela: trocar de
// seção monta a tela de novo sem recarregar a página, e o Alocar da tela Contas grava o mesmo cadastro. Ela fica presa
// à fonte de dados, que nasce de novo só quando a página recarrega.

import { ErroPainel, type Fonte, type PassoUnidade } from "./fonte"

export interface EstadoGravacao {
  /** gravações do cadastro ainda sem resposta nesta aba */
  emCurso: number
  /** uma gravação terminou sem prova de que gravou ou não: nada mais grava o cadastro nesta aba até recarregar */
  incerto: boolean
  /** quantas gravações foram confirmadas: a tela montada no meio de uma sabe que precisa ler de novo */
  confirmadas: number
}

const INICIAL: EstadoGravacao = { emCurso: 0, incerto: false, confirmadas: 0 }
const estados = new WeakMap<object, EstadoGravacao>()
const ouvintes = new WeakMap<object, Set<() => void>>()

/** O estado desta aba. Devolve o mesmo objeto enquanto nada muda (serve ao useSyncExternalStore). */
export function estadoGravacao(fonte: object): EstadoGravacao {
  return estados.get(fonte) ?? INICIAL
}

export function ouvirGravacao(fonte: object, ouvir: () => void): () => void {
  let lista = ouvintes.get(fonte)
  if (!lista) {
    lista = new Set()
    ouvintes.set(fonte, lista)
  }
  lista.add(ouvir)
  return () => {
    lista.delete(ouvir)
  }
}

function mudar(fonte: object, novo: (antes: EstadoGravacao) => EstadoGravacao) {
  estados.set(fonte, novo(estadoGravacao(fonte)))
  for (const ouvir of [...(ouvintes.get(fonte) ?? [])]) ouvir()
}

/**
 * Grava o cadastro com a trava da aba. Recusa sem ir à nuvem quando há outra gravação sem resposta ou um resultado
 * incerto. Sem prova de recusa (rede, 502, 504, PGRST001, resposta sem os IDs), marca a aba como incerta e devolve o
 * erro `resultado_incerto`, cujo texto manda recarregar e conferir, e não tentar de novo.
 */
export async function gravarCadastro(
  fonte: Pick<Fonte, "salvarUnidades">,
  passos: PassoUnidade[],
  /** 0.21.2: a revisão da leitura de onde a edição saiu; o banco recusa (`cadastro_mudou`) se o cadastro mudou desde ela */
  revisao?: string
): Promise<Record<string, string>> {
  const antes = estadoGravacao(fonte)
  // nada foi enviado nos dois casos: a recusa é certa
  if (antes.incerto) throw new ErroPainel("resultado_incerto", undefined, true)
  if (antes.emCurso > 0) throw new ErroPainel("gravacao_em_curso", undefined, true)
  mudar(fonte, (e) => ({ ...e, emCurso: e.emCurso + 1 }))
  try {
    const ids = await (revisao ? fonte.salvarUnidades(passos, revisao) : fonte.salvarUnidades(passos))
    mudar(fonte, (e) => ({ ...e, emCurso: e.emCurso - 1, confirmadas: e.confirmadas + 1 }))
    return ids
  } catch (erro) {
    const comprovada = erro instanceof ErroPainel && erro.recusaConfirmada
    mudar(fonte, (e) => ({ ...e, emCurso: e.emCurso - 1, incerto: e.incerto || !comprovada }))
    if (comprovada) throw erro
    throw new ErroPainel("resultado_incerto", erro instanceof Error ? erro.message : String(erro), false)
  }
}
