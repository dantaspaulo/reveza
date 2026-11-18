<!-- base gerada pelo BigBoss em 18/11/2026 a partir do próprio repositório. O dono troca a frase marcada na seção "Como é a falha aqui" e apaga o que não servir. -->

# REVIEW.md: o que olhar neste repositório

Base gerada pelo BigBoss em 18/11/2026. Dono: Reveza. Método: ~/OpenBot/Shared/REVISAO-DE-CODIGO.md.

## O que é este código
`reveza`, Node. 61 commits nos últimos 30 dias, 2 autor(es) (git log, 18/11/2026).

## Como é a falha aqui
@@COMO FALHA@@: o agente dono escreve aqui uma frase com o jeito típico de este código estar errado
(exemplos: "a resposta sai confiante e errada", "manda para o cliente errado",
"funciona no teste e quebra com dado real"). Até lá, o revisor usa só as seções abaixo.

## Sempre olhar (caminhos achados neste repositório)
- **login e permissao** (12 arquivos): `painel/src/auth (4)`, `agente/src (2)`, `agente/test (2)`, `painel/src/components (2)`
- **entrada de fora** (2 arquivos): `agente/src (1)`, `agente/test (1)`
- **CI e instalador** (3 arquivos): `.github/workflows (3)`

## Sempre precisa de gente (risco alto)
- login e permissao, CI e instalador
  (a tabela de risco está no REGRAS-DO-PAULO.md, seção Revisão de código).

## Ignorar
- `node_modules`
- Arquivo gerado, dependência de terceiro, dado de teste e tradução automática.

## Regras deste repositório
- (o dono acrescenta aqui o comentário de revisão que já se repetiu duas vezes)

## Como responder
- No máximo 3 achados DETALHE por revisão. Acima disso, escolha os 3 que mais importam.
- Todo achado leva arquivo e linha, mais o caminho de como falha. Sem isso, não escreva.
- Estilo, formatação, limpeza e nome por gosto não viram achado.
- O resumo começa com a contagem: "3 achados: 1 importante, 2 detalhes".
- Nada a corrigir também se diz: "Nenhum achado. Rodei <as verificações>".

