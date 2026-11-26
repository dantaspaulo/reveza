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
  auditoria; permissões novas no `0099_permissoes.sql`. Trocar um índice (criar o novo, que aceita tudo o que o velho
  aceitava, e só depois tirar o velho) não apaga dado e vale; nome de função que já existe em outra migração não se
  reusa com outro tipo de retorno (o `create or replace` falha e trava a atualização da nuvem).
- **entrada de fora**: o que o agente lê do disco, do assistente e da nuvem (tamanho, tipo, caracteres de controle).
- **CI e instalador**: `.github/workflows` e `instalador/`.
- **trilhas** (0.18.0): `agente/src/trilhas.ts`, o lançador em `instalador/lib/programa.mjs` e a 0039. A mesma conta
  nunca em duas trilhas nem na trilha e na principal; o login renovado da trilha volta ao cofre; renovação e retomada
  tiram `CLAUDE_SECURESTORAGE_CONFIG_DIR` e `REVEZA_TRILHA` herdados; o `oauthAccount` fica o da principal; tudo
  desligado sem empresa com `separar`.
- **projetos e modos** (0.19.0): a 0040 e a 0041, `agente_empresas` e o portão de versão. Com tudo desligado nada
  muda; o agente antes da 0.19.0 nunca recebe a unidade que ele mandaria para a conta errada; a sombra não troca
  posse, atribuição nem login; o painel manda `modo` e a nuvem mantém `separar` igual a "ligado".
- **cadastro** (0.20.0): a 0043 e a 0044, `painel_unidade`, o bloqueio do lançador e a trava da conta em uso. A unidade
  estrita nunca abre nem continua em conta fora das dela; a trava só vale para unidade ligada, estrita e com a conta
  em uso, e vence sozinha quando o processo some; todo caminho que atribui conta à principal respeita a trava (`decidir`,
  troca à mão, API, preferida, remover e saída agendada); quem não salvou pelo cadastro novo segue como na 0.19. A
  trava precisa sobreviver a computador que dorme, agente que religa, processo com número reaproveitado e nuvem lenta;
  `painel_unidades` grava tudo ou nada. Trilha dividida só troca para conta que sirva a todas as unidades anotadas nela.
- **projeto por computador** (0.20.1): a 0045 e a 0046. Toda função que entrega regra, classifica pasta, abre trilha ou
  decide a principal olha `rvz_roda_em`, para valer também no agente antigo; o projeto antigo segue em todos; a
  trilha aberta segue até as sessões fecharem; nada de troca cruzada direta entre dois computadores (a posse trava); o
  painel só manda `computadores` quando mudou.
- **Alocar na tela Contas** (0.20.2): `planoDeAlocar` em `painel/src/lib/cadastro.ts`. Só projeto (o subprojeto herda
  as contas do projeto e fica na tela Projetos); relê o cadastro antes de gravar e manda só `contas`; a mesma recusa da
  tela Projetos; o aviso de quem sai da conta conta a herança do subprojeto ligado; conta saindo (`sai_em`) não se aloca.
- **espera do lançador e conta esgotada** (0.21.0): `lancadorClaude` em `instalador/lib/programa.mjs`, `cmdTrilha` em
  `agente/src/cli.ts` e `Trilhas.pedir`. Na pergunta de novo, só a trilha conferida (saída 0) ou a certeza do agente
  (saída 5) tiram da espera; erro, agente fora e "não sei" seguem esperando. Comando novo do assistente entra em uma das
  três listas (`COMANDOS_SEM_CONVERSA`, `COMANDOS_DE_CONTA`, `COMANDOS_COM_CONVERSA`), e o teste de classificação lê o
  `claude --help`. As chamadas a `agente_segurar_principal` vão uma por vez, porque a nuvem guarda a última lista. A
  conta esgotada (`decisao.esgotada`, o mesmo teste do `painel_trocar_agora`) não recebe sessão nova, mas quem já a
  segura segue segurando. O processo só fica na trava da conta em uso quando a resposta daquela pergunta o pôs lá
  (`largarPrincipal`, em `Trilhas.pedir`: a mesma sessão pode perguntar duas vezes), e o comando que não conversa vai
  com `--sem-conversa` (`Trilhas.semConversa`: sem busca, trava nem gravação).
- **conta parada cede** (0.21.1): `rvz_ceder_parada` na 0047, chamada pela `decidir` sem candidata. Sempre pela conta do
  meio (`rvz_conta_do_meio`: sem dono, sem posse de outro, login bom, agenda, teto e modelo do doador, a preferida de
  outro por último), nunca troca direta; doador (`rvz_pode_doar`, a mesma regra na lista e na contagem) ligado há mais
  de 60 min (`computadores.ligado_desde`, pelo gatilho), parado (sem sessão, sem limite e com o uso igual em 60 min), com
  a conta há mais de 30 min e não escolhida à mão; quem pede só trabalhando na conta em uso (a sessão de trilha não
  conta), com ela cheia ou acima do gatilho (a falta de modelo não é limite) e passada a espera entre trocas; a trava da
  atribuição tentada sem esperar e a linha do doador com `skip locked`, sem alerta quando uma das duas deixou alguém de
  fora, e nenhuma trava sem doador (linhas do doador antes da trava das trocas, a ordem da `decidir`); quem pede conta
  nunca é doador, e o evento `limite` com motivo `sem_modelo` não faz pedir; o doador parado não troca pela regra nem
  gera o aviso de 90% até pedir conta. Filtro novo na `rvz_candidatas` precisa ir também à
  `rvz_serve_principal`, e motivo novo de troca entra no `traduzirMotivo` e no `motivoEmIngles`.

## Sempre precisa de gente (risco alto)
- login e permissão, migração da nuvem, CI, instalador e o lançador das trilhas.

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
