# REVIEW.md: o que olhar neste repositório

## O que é este código
O Reveza: o agente de cada computador (Node), a nuvem (Postgres no Supabase, com funções e RLS), o painel (React) e o
instalador. Repositório público.

## Como é a falha aqui
O erro típico passa nos testes e só aparece com várias contas e vários computadores ao mesmo tempo: uma troca que não
firma, um login renovado num computador que derruba o mesmo login em outro, um número velho tratado como novo. E, por
ser público, um dado de quem usa (e-mail, nome de empresa ou de cliente, caminho pessoal) que escapa para o código, um
teste, o CHANGELOG ou a release.

## Sempre olhar
- **login e cofre**: `agente/src` (troca, cofre, posse) e `painel/src/auth`. A mesma conta nunca fica ativa em dois
  lugares; o token de renovação gira a cada uso.
- **nuvem**: `nuvem/migracoes`. Migração só acrescenta (nada de drop, truncate ou update que zere dado); toda tabela
  nova com RLS e na lista do teste de segurança; toda função de escrita confere o papel, valida a entrada e grava a
  auditoria; permissões novas no `0099_permissoes.sql`.
- **entrada de fora**: o que o agente lê do disco, do assistente e da nuvem (tamanho, tipo, caracteres de controle).
- **CI e instalador**: `.github/workflows` e `instalador/`.

## Sempre precisa de gente (risco alto)
- login e permissão, migração da nuvem, CI e instalador.

## Ignorar
- `node_modules`, arquivo gerado, dependência de terceiro e dado de teste.

## Regras deste repositório
- Nenhum e-mail, nome de empresa ou caminho pessoal real em código, teste, CHANGELOG ou aviso: nos testes, domínios
  `.exemplo`; as escolhas de quem usa moram na nuvem dele e são feitas no painel.
- Texto de tela nos dois idiomas (português e inglês), com as mesmas variáveis, sem nome de marca do assistente.
- Toda correção ou melhoria sai com versão nova, release e CHANGELOG (`scripts/versao.mjs`).

## Como responder
- No máximo 3 achados DETALHE por revisão. Acima disso, escolha os 3 que mais importam.
- Todo achado leva arquivo e linha, mais o caminho de como falha. Sem isso, não escreva.
- Estilo, formatação, limpeza e nome por gosto não viram achado.
- O resumo começa com a contagem: "3 achados: 1 importante, 2 detalhes".
- Nada a corrigir também se diz: "Nenhum achado. Rodei <as verificações>".
