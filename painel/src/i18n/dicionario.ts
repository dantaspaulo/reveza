// Junta os textos de cada parte do painel. O português é o padrão e o molde: o inglês tem de ter as mesmas chaves
// (o tipo de cada arquivo em textos/ confere).

import type { Folhas } from "./secao"
import alertas from "./textos/alertas"
import auth from "./textos/auth"
import base from "./textos/base"
import comoFunciona from "./textos/como-funciona"
import computadores from "./textos/computadores"
import contas from "./textos/contas"
import integracoes from "./textos/integracoes"
import minhaConta from "./textos/minha-conta"
import saude from "./textos/saude"
import time from "./textos/time"
import troca from "./textos/troca"
import uso from "./textos/uso"
import visao from "./textos/visao"

export const pt = {
  ...base.pt,
  ...auth.pt,
  ...visao.pt,
  ...contas.pt,
  ...computadores.pt,
  ...uso.pt,
  ...troca.pt,
  ...alertas.pt,
  ...integracoes.pt,
  ...time.pt,
  ...minhaConta.pt,
  ...comoFunciona.pt,
  ...saude.pt,
}

export type Dicionario = Folhas<typeof pt>

export const en: Dicionario = {
  ...base.en,
  ...auth.en,
  ...visao.en,
  ...contas.en,
  ...computadores.en,
  ...uso.en,
  ...troca.en,
  ...alertas.en,
  ...integracoes.en,
  ...time.en,
  ...minhaConta.en,
  ...comoFunciona.en,
  ...saude.en,
}

type Caminhos<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Caminhos<T[K], `${P}${K}.`>
}[keyof T & string]

export type Chave = Caminhos<typeof pt>
