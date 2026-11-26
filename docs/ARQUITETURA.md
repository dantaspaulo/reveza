🌐 **Português** · [English](ARQUITETURA.en.md)

# Reveza AI: arquitetura

Gestor de várias contas de assistente de código, com painel na nuvem, troca de conta automática e registro de uso.
Funciona com o Claude Code (a única menção ao nome fica na instalação e nos requisitos). Projeto aberto, licença MIT.

Este documento é a fonte de verdade para quem constrói. Decisões tomadas pelo dono do projeto em 10 e 11/10/2026.

## 1. Princípios

1. **Login de conta nunca em claro fora do computador.** O cofre na nuvem guarda só texto cifrado. A chave do cofre
   existe só nos computadores do usuário (chaveiro do sistema). Vercel e Supabase não conseguem decifrar.
2. **A nuvem orquestra.** Ela decide qual computador usa qual conta, com base no uso que os computadores relatam.
   Sem internet, o computador mantém a conta atual e não troca (aceito pelo dono).
3. **O computador só chama a nuvem.** Nenhuma porta aberta, nenhum túnel. Busca a cada 5 s.
4. **Menor privilégio em tudo.** Nenhuma chave de servidor fora do Supabase. A Vercel usa a chave pública e o token de
   quem está logado. Cada computador tem a própria identidade, revogável sozinha.
5. **Cada instalação é dona de tudo.** Supabase, Vercel e domínio são da pessoa que instala. Nada passa por servidor
   do autor do projeto.

## 2. Peças

| Peça | Tecnologia | Onde roda | Papel |
|---|---|---|---|
| `agente` | Node 18+ (TypeScript compilado), só módulos nativos + `@supabase/supabase-js` | cada computador | troca a credencial local, lê o uso das contas que tem em mãos, renova login, cifra e decifra o cofre, registra uso das transcrições, retoma sessão |
| `mod` | módulo de hooks do Claude Code | cada sessão | uso ao vivo, aviso de limite, retomada da sessão, `/reveza` |
| `nuvem` | Supabase (Postgres + RLS, Auth com MFA, Edge Functions, pg_cron) | projeto da pessoa | estado, decisões, cofre cifrado, filas, alertas, auditoria e a própria atualização (`atualizar-nuvem`, 7e) |
| `painel` | Vite + React + TypeScript + Tailwind v4 + shadcn/ui (blocos oficiais) + React Bits grátis (baixado na instalação) | Vercel da pessoa | tudo o que a pessoa vê e controla, pt-BR e en, instalável no celular (PWA) |
| `instalador` | Node (`npx github:<dono>/reveza`) | computador da pessoa | perguntas, provisiona Supabase e Vercel, domínio, primeiro computador e contas, alertas, prova final |
| `cli` | o próprio `agente` (`reveza status`, `reveza trocar`, `reveza uso --csv`, `reveza doctor`) | computador | integração por script e diagnóstico |

Por que o agente sai de Python para Node: Windows não tem Python de fábrica, o Node já é exigido pelo instalador e
pelo Claude Code, e o Node tem AES-256-GCM e scrypt nativos (o Python padrão não tem cifra autenticada).

## 3. Onde fica o login de cada conta no computador

| Sistema | Credencial ativa | Credencial de cada conta guardada |
|---|---|---|
| macOS | chaveiro, serviço `Claude Code-credentials` (gravação por `security -i` quando cabe em ~4 KB, argv quando não, como o próprio Claude Code) | chaveiro, serviço `Claude Code-credentials-<sha256(pasta)[:8]>` da pasta `~/.reveza/contas/<id>` |
| Linux e Windows | `~/.claude/.credentials.json` (modo 600 no Linux; ACL do perfil no Windows) | `~/.reveza/contas/<id>/.credentials.json` |

Trilha de empresa (0.18.0, seção 6b): a pasta `~/.reveza/trilhas/<empresa>` faz o papel da credencial ativa para as
sessões daquela empresa, com o mesmo formato das pastas de conta (macOS: chaveiro, serviço
`Claude Code-credentials-<sha256(pasta)[:8]>`; Linux: `<pasta>/.credentials.json`). O assistente usa essa pasta quando
o processo nasce com `CLAUDE_SECURESTORAGE_CONFIG_DIR` apontando para ela.

Regras herdadas do roteador (provadas em 10 e 11/10, com teste):
- trocar mexe só em `claudeAiOauth` e `organizationUuid`; o `mcpOAuth` é da máquina e fica;
- nunca renovar pela cópia guardada da conta ativa (o token de renovação gira);
- renovar e trocar a mesma conta nunca ao mesmo tempo (trava por conta); destino perto de vencer é renovado antes;
- conferir a principal 5 s depois da troca e refazer se uma sessão regravou a conta antiga;
- login novo só vale se a conta que voltou é a pedida.

## 4. Cofre cifrado

- Chave do cofre `K`: 32 bytes aleatórios, criada no primeiro computador, guardada no chaveiro do sistema
  (macOS: Keychain; Windows: DPAPI do usuário, num arquivo em `~\.reveza\segredos`; Linux: `secret-tool` quando houver,
  senão arquivo 600 com aviso).
- Cada login guardado: `AES-256-GCM(K, nonce aleatório de 12 bytes, JSON só com claudeAiOauth e organizationUuid)`,
  com dado associado `conta_id|versao` (impede trocar o cifrado de uma conta pelo de outra).
- Computador novo recebe `K` cifrada só para ele (0.2.0; achado 2 da revisão de segurança de 11/10/2026, em que o
  código `rvzl_` levava a frase do cofre em texto reversível). Ele cria um par ECDH P-256 só em memória (chave privada
  não exportável) e registra a chave pública no pedido dele (`ligacao_pedidos`). O computador que tem `K` confere o
  código de 12 caracteres que a pessoa digita (`XXXX-XXXX-YYYY`: a primeira parte sai da chave pública, a segunda é
  sorteada e não vai à nuvem), cifra `K` para essa chave pública com a parte sorteada (ECDH efêmero + HKDF-SHA256 com a
  parte sorteada no sal + AES-256-GCM, rótulos `reveza-ligacao-computador-v3`, dado associado com o id do computador
  novo) e entrega pela nuvem, que só vê texto cifrado e apaga o envelope na primeira leitura. O novo só abre envelope
  feito com a parte sorteada dele e ainda confere a impressão de `K` contra a da instalação antes de guardar. Detalhes
  na seção 8.
- Emergência (computador já ligado que perdeu `K`): a **frase de 6 palavras**. O computador que tem `K` gera as
  palavras (`reveza ligar --mostrar-frase`), deriva uma chave com scrypt e publica `K` embrulhado por 10 minutos; o
  outro digita as palavras (`reveza ligar --frase`) e desembrulha. A frase não vai à nuvem e não liga computador
  novo (a identidade pendente não chega a computador ativo sem receber `K` pelo pedido).
- Perdeu todos os computadores: o cofre não se recupera (é o preço de a nuvem não conseguir ler). As contas se
  conectam de novo pelo login oficial.

## 5. Posse das contas (uma conta, um computador de cada vez)

O token de renovação gira a cada uso. Dois computadores com a mesma cópia queimam o login um do outro. Por isso:
- `posse(conta_id, computador_id, desde, expira_em)`: quem tem a posse é o único que usa ou renova aquela conta.
- O computador renova a posse a cada busca (expira em 2 min sem renovar). Antes de soltar uma conta, ele cifra e
  devolve ao cofre o login mais novo, e só então solta.
- Leitura de uso de conta parada: a nuvem escolhe um computador ligado, que pega a posse curta, renova se precisar,
  lê, devolve ao cofre e solta.
- A cópia mais nova vence (0.16.4). Ao pegar a posse, o computador compara a cópia local com a do cofre: a local com
  token de renovação e validade mais longa é um login mais novo (entrada de novo feita aqui, renovação que não chegou a
  subir) e fica, e é ela que sobe ao cofre ao soltar; senão vale a do cofre. Antes, a do cofre sempre passava por cima:
  em 16/11/2026 um login refeito num computador nunca chegou ao cofre, e os outros seguiram recebendo a cópia cancelada.
  A devolução recusada por "sem posse" (a posse venceu e outro pegou) larga a posse local e avisa uma vez, sem repetir
  a cada busca; a retomada para devolver na saída que a nuvem recusa volta a tentar 5 minutos depois.

## 6. Decisão (na nuvem)

Função `decidir()` em Postgres, chamada pelo pg_cron a cada minuto e na hora por gatilho quando chega uso novo ou
aviso de limite. Para cada computador ligado:
- modo `limite` (só no limite), `limiar` (aviso e troca) ou `rodizio` (de tempos em tempos, intervalo sorteado entre
  75% e 125%, conta livre sorteada ou a menos usada), com o limiar valendo de rede;
- respeita ordem de preferência, conta de reserva (só sem nenhuma outra), agenda por horário, teto semanal e plano
  da semana (cota da semana dividida pelos dias restantes);
- janela cheia = maior entre 5 h, semana e semana por família de modelo; reset que já passou conta como zero. A
  semana de um modelo que a API manda na lista nova (`limits`, `weekly_scoped`; hoje só a do Fable, gravada como
  `seven_day_fable`, 0.9.0) aparece no painel, mas fica fora desse máximo: quem usa outro modelo não troca por ela.
  Ela NÃO é cota a mais: mede o Fable incluso no plano (passou de 100%, o Fable só segue com créditos de uso), e o
  Fable gasta também a semana da conta. O próprio Claude Code (2.1.322) diz isso no "reset do Fable", que "devolve à
  semana o que o Fable gastou", e a semana geral se chama "Current week (all models)". Com a semana da conta cheia, o
  Fable para junto; passar as sessões para o Fable perto do fim da semana não rende uso a mais (10/11/2026);
- conta que não roda o modelo das sessões de um computador (sem créditos de uso, como o Fable numa conta Team, 0.9.0):
  o mod reconhece "requires usage credits" e "<modelo> limit reached · continuing on ... uses usage credits", o agente
  chama `agente_sem_modelo(conta, modelo, sessao)` e a conta fica fora das candidatas daquele computador por 6 horas
  (`contas_sem_modelo`, 0028). Com outra livre, troca na hora e a sessão continua no mesmo modelo; sem troca em 2
  minutos (ou parando de novo logo), o mod passa a sessão para o modelo padrão (`/model default`) e ela continua;
- espera mínima de 90 s entre trocas do mesmo computador, menos quando a sessão bateu o limite ou a conta em uso
  chegou a 100%;
- na hora de trocar, sem conta abaixo do aviso (0.12.0, `rvz_escolher`): a com mais folga abaixo do gatilho e com
  menos uso que a em uso; depois as de reserva; com a em uso cheia (100% ou a sessão no limite), a com mais folga
  abaixo de 100%. Relato de 06/11/2026: com as outras entre 85% e 93%, a nuvem respondia "nenhuma conta livre" e o
  computador ficou 47 minutos na conta em 100%. Pausada, agenda, teto da semana e conta sem o modelo valem também
  aqui; a conta sem o modelo da sessão não conta como cheia (sem outra abaixo do gatilho, a sessão segue no modelo
  padrão nela);
- a conta em uso pausada (ou sem login) sai de uso na hora, para a melhor que houver, mesmo com a troca automática
  desligada; o `painel_conta` decide na hora quando pausa uma conta em uso;
- conta preferida de cada computador (uma conta é preferida de um computador só): para ele vem antes das outras
  candidatas; com a troca automática ligada, ele volta para ela quando ela fica livre, depois da espera, menos se a
  conta atual foi pedida à mão (painel ou API), que fica até a próxima troca da regra; no rodízio ele fica nela; no
  limite, troca como qualquer outra. Para os outros computadores, enquanto o dono está ligado, ela vem depois das
  demais, e quem estiver com ela devolve e pega a melhor que sobrar (nunca uma reserva nem a preferida de um
  terceiro);
- mesma organização (0.15.0, `rvz_mesma_org`): depois da preferida, da reserva e da preferida de outro, a candidata da
  mesma organização da conta em uso vem antes, se tiver 30 pontos de folga até o gatilho de troca. O cache da conversa é
  da organização: medido em 07/11/2026, trocar para outra fez 67% das sessões abertas mandarem a conversa inteira de
  novo (17% na mesma organização), cerca de 11% do gasto de 48 h;
- o uso que decide (`rvz_pct_efetivo`, 0.15.0): o maior entre as janelas lidas há menos de 15 minutos (a renovada conta
  zero), nunca abaixo da última leitura de uma janela que ainda não renovou (o uso só cresce até o reset). Antes, com a
  leitura limitada pelo provedor, a semana cheia saía da conta e a conta aparecia em 0%;
- grava a decisão em `atribuicao(computador_id, conta_id, motivo, versao)` e no `eventos`.

**Sessões críticas (0.15.0).** A conta vale para o computador inteiro, então reservar uma conta não protege uma sessão:
quando o computador entra nela, todas gastam juntas. Com `criticas` ligada na config (gatilho `criticas_gatilho`, 50 a
95, 75 de fábrica), cada agente olha as contas (as mesmas que ele conhece da nuvem): sem nenhuma em atividade abaixo do
gatilho (pausada, sem login e sem o modelo do computador não contam; leitura velha vale pelo último número), as sessões
comuns esperam. O agente põe `criticas: { segurar, gatilho }` na resposta de `/api/ativa`, e o mod de cada sessão
recusa o prompt (`prompt.submit` com `drop`; os comandos de barra passam) e a ação (`tool.call` com `deny`, pedindo
para parar) da sessão comum. Na espera a sessão lê a ponte a cada 5 s; quando a espera acaba, a que foi parada no meio
recebe o pedido fixo de continuar. A crítica segue: marcada por `/reveza critica` (a marca fica no agente,
`sessoesCriticas`, e vale na sessão retomada; 30 dias sem uso, sai), por `reveza criticas marcar <sessão>` ou por
`REVEZA_CRITICA=1` no ambiente da sessão. Sessão noutra conta (o app de desktop) não espera, e com o agente fora do ar
ninguém espera. O começo e o fim da espera viram evento.

## 6b. Trilhas: cada empresa nas contas dela (0.18.0)

Desligado de fábrica. Liga por empresa, no painel (**Empresas**, editar, **Separar as contas desta empresa**), e só
vale nas sessões abertas pelo lançador do Reveza.

- **Nuvem (0038, 0039):** `empresas.separar` (falso de fábrica) e `atribuicao_trilhas(computador_id, empresa_id,
  conta_id, motivo, versao, decidido_em, pedida_em)`, uma conta por empresa separada em cada computador, com a conta
  única na tabela (a mesma conta nunca está em duas trilhas) e nunca a mesma da principal. `agente_trilhas(empresas)`
  decide e devolve as trilhas pedidas: contas marcadas para a empresa e, quando acabam, o transbordo dela (nenhum,
  qualquer ou as escolhidas); a trilha sem pedido há 10 min sai. A conta só de empresas separadas não vai para a
  principal (`rvz_principal_pode`), nem pelo painel. `agente_ola` diz se há alguma empresa separada (`trilhas`): sem
  nenhuma, o agente não pede nada.
- **Lançador** (`~/.reveza/lancador/claude`, macOS e Linux, fora do PATH): acha o assistente de verdade (pulando a
  própria pasta, ou `REVEZA_CLAUDE_REAL`), e só pergunta ao agente quando existe `~/.reveza/trilhas/ligadas` e o
  processo ainda não tem `REVEZA_TRILHA` nem `CLAUDE_SECURESTORAGE_CONFIG_DIR`. A pergunta (`reveza trilha --cwd --pid`,
  até 20 s) devolve a pasta da trilha; o lançador exporta `CLAUDE_SECURESTORAGE_CONFIG_DIR` e `REVEZA_TRILHA` e roda o
  assistente. Sem resposta, sem empresa ou sem conta para ela, a sessão abre na principal (sem conta, o agente grava
  um aviso). Para usar: apontar o programa que abre o assistente para o lançador (no terminal, PATH ou alias; no
  OpenBot, `OPENBOT_CLAUDE_PATH`). Windows: sem lançador nesta versão.
- **Agente** (`agente/src/trilhas.ts`): classifica a pasta com as regras da nuvem (a mesma do painel), pede a trilha,
  põe o login da conta na pasta da trilha (`trocarTrilha`, com as mesmas travas da troca principal e a posse de uso
  na nuvem) e devolve ao cofre o login renovado quando a conta sai da trilha. A sessão da trilha manda `trilha` na
  medida e no limite (o mod lê `REVEZA_TRILHA`): o limite enche a conta da trilha, a nuvem escolhe outra, e a sessão
  parada continua na conta nova pela retomada da própria trilha (a retomada da principal não pega item de trilha). O
  `oauthAccount` do `~/.claude.json` (o perfil mostrado pelo assistente) fica sempre o da principal.
- **Limites:** sessão já aberta não muda de trilha; o login de servidor MCP (`mcpOAuth`) mora com a credencial, então
  cada trilha pede de novo o login desses servidores; renovação e retomada sem tela tiram as duas variáveis do
  ambiente herdado antes de pôr as da trilha.

## 6c. Projetos e o modo de cada unidade (0.19.0)

- **Projeto** é uma linha de `empresas` com `pai` (0040); projeto não tem projeto e não muda de empresa; o nome é único
  dentro da mesma empresa. **Unidade** (a que decide a sessão, `rvz_unidade_de`) é a empresa, ou o projeto com contas
  marcadas ou modo `desligado`/`ligado` próprio; o projeto sem nada próprio é parte da empresa (a mesma trilha e o
  mesmo login). A **unidade em teste** (`rvz_unidade_teste`) conta também o projeto com modo `sombra`. `rvz_modo_de`
  (o modo que o painel mostra), `rvz_modo_real`, `rvz_marcada` e `rvz_nome_unidade` (0041) completam a nuvem;
  `modoDe`, `nomeUnidade` e `ordenarUnidades` no painel.
- **Modo:** `desligado` (de fábrica), `sombra` ou `ligado`. Na empresa, `separar` continua igual a "modo ligado" (o
  `painel_empresa` grava os dois juntos), então o `agente_ola` da 0039 segue certo sem ser reescrito. No projeto,
  `modo` null segue a empresa. `herdar_transbordo` (projeto): cheias as contas dele, as da empresa e depois o
  transbordo dela. **Sombra nunca muda sessão:** `rvz_modo_real` só devolve `ligado` ou `desligado`; a empresa em
  sombra vale `desligado` e o projeto em sombra (ou null) vale o modo real da empresa.
- **Revezamento global** é simplesmente "nenhuma unidade ligada nem em teste": não existe chave mestra a mais.
- **Classificação:** `agente_empresas` devolve as unidades ligadas e as regras de duas origens: das unidades ligadas e
  das unidades que tiram pasta de uma empresa ligada (`rvz_tira_da_empresa`: projeto que é unidade, não ligado, numa
  árvore com unidade ligada). A regra de empresa de cima desligada não vai (como na 0.18.0, ela não tira pasta de
  ninguém). O agente 0.19.0 escolhe a regra que vence entre as recebidas (a mesma regra do painel e de
  `rvz_classificar`) e só depois olha se a unidade está na lista; fora dela, a sessão fica na conta do computador.
  Assim um projeto desligado dentro de uma empresa ligada volta ao revezamento de todas as contas.
- **Portão de versão:** o agente 0.18.0 descarta as regras de unidade fora da lista antes de escolher, e a pasta de
  um projeto desligado cairia na empresa ligada. `agente_empresas` lê `computadores.versao` (`rvz_versao_agente`; o
  que não casa conta como anterior) e, para agente antes da 0.19.0, tira da lista a unidade ligada U quando existe
  uma unidade X que tira pasta (`rvz_tira_da_empresa`) na mesma árvore, ou em outra árvore com regra que pode cruzar
  com a de U (`rvz_regras_cruzam`: regra por nome de pasta ou por título cruza sempre; por caminho, quando um contém o
  outro, com a barra como fronteira). Lá a empresa fica como antes de ligar; a trilha que já existia sai pelo caminho
  de sempre (sem pedido há 10 min). O painel lista os computadores atrás e o que não vale neles
  (`empresasForaNoAntigo`, a mesma conta).
- **Regras vencidas:** sem resposta da nuvem, o agente que segue rodando usa as últimas regras que recebeu (só em
  memória); passados `EMPRESAS_VENCIDAS_S` (600 s), a resposta ao lançador leva `vencida: true` e o registro avisa uma
  vez por janela. Não cai para "sem empresa" só porque a nuvem demorou. Se o agente reiniciar com a nuvem fora do
  ar, ele começa sem regras e as sessões novas ficam na conta do computador até a primeira leitura.
- **Sombra:** `rvz_rodar_sombra` (agenda `reveza-sombra`, 0042, de minuto em minuto, sob a trava 778805) decide, para
  cada computador e unidade em teste (`rvz_unidade_teste`) em modo `sombra` e não ligada de verdade, com sessão nos
  últimos 10 min, a conta que a trilha usaria (`rvz_escolher_sombra`, as candidatas da trilha sem a principal impedir)
  e grava em `trilhas_sombra` com a conta em uso de verdade e as trocas que teria feito. Não toca posse, atribuição
  nem login; cada mudança é um evento `info`. A linha parada há 10 min sai.

## 6d. Cadastro operacional (0.20.0)

A tela Empresas (menu Operação) é o cadastro: computador, empresa, projetos dentro dela e a conta de cada um. Os números
por empresa foram para a tela de Uso. Salvar chama `painel_unidades` com a lista de passos (cada um é um
`painel_unidade`, que confere tudo antes de gravar nome, modo, contas e pastas). A lista é uma transação: uma recusa
desfaz os passos anteriores, e o projeto novo acha a empresa nova pelo `ref` provisório.

Desde a 0.21.1, depois da gravação confirmada, o painel só libera a edição após uma leitura iniciada depois dela. Se a
leitura falhar, mantém o rascunho bloqueado e permite tentar somente a leitura. Se a resposta da gravação for incerta
(sem resposta do banco), a edição não volta nesta aba: a escrita pode ainda estar em curso, e uma leitura que chegasse
antes dela mostraria o cadastro velho, a partir do qual a segunda gravação apagaria o que a primeira escreveu. A tela
diz isso e oferece só o botão Recarregar a página, para conferir o cadastro. Os IDs provisórios dos projetos criados
são substituídos pelos IDs devolvidos na resposta confirmada.

Recusa comprovada é diferente de resultado incerto: um erro com código do próprio banco (SQLSTATE, como o `P0001` de
uma função que levanta exceção, ou um código do PostgREST) prova que a transação foi desfeita, e aí o rascunho volta a
ser editável na hora. Sem código do banco (queda de rede, 502, 504) não há prova de recusa, e vale o bloqueio acima. O
`PGRST001` também conta como incerto: é a conexão com o banco que caiu no meio do pedido, e a gravação pode ter
terminado.

A trava é da aba, e não da tela: fica presa à fonte de dados (`painel/src/dados/gravacao.ts`), que nasce de novo só
quando a página recarrega. Trocar de seção monta a tela de novo sem recarregar, e o Alocar da tela Contas grava o mesmo
cadastro; por isso toda gravação do cadastro passa por `gravarCadastro` (e o apagar de projeto por `apagarNoCadastro`,
a mesma trava). Com o resultado incerto, ela recusa antes de
ir à nuvem, também depois de sair da tela e voltar. Com uma gravação ainda sem resposta, recusa a segunda
(`gravacao_em_curso`), e a tela montada no meio dela espera a resposta e uma leitura nova antes de liberar a edição.

**A revisão conferida no banco (0048, 0.21.2).** A trava da aba não alcança outra aba, outro computador nem uma
gravação perdida que termina depois da recarga. Por isso o banco confere: a `painel_cadastro_revisao` (membro) devolve
a revisão, um sha256 do conteúdo das quatro tabelas que o cadastro grava (`empresas`, `conta_empresas`,
`pastas_empresa`, `empresa_computadores`); o painel a lê ANTES das tabelas e a manda ao gravar. As duas gravações da
tela passam pelo mesmo caminho privado, `rvz_cadastro_seguro`: `painel_unidades_seguro` (salvar) e
`painel_empresa_apagar_seguro` (apagar projeto), as duas só para admin. Ele guarda a operação (UUID do painel) em
`cadastro_operacoes` (sem acesso pelo PostgREST), tranca as quatro tabelas em `share row exclusive`, que conflita com
qualquer escrita nelas, e só então compara a revisão: diferente, devolve "o cadastro mudou; atualize antes de salvar"
(`cadastro_mudou` no painel) sem mudar nada; igual, roda o passo de sempre (`painel_unidades` ou
`painel_empresa_apagar`). A mesma operação repetida devolve o resultado guardado; com outro pedido, outro tipo ou outra
pessoa, "operação já usada". Na tela, apagar um projeto salvo fica bloqueado enquanto houver mudança sem salvar
(apagaria por baixo do rascunho), e depois de uma recusa por leitura velha o Salvar espera o Descartar. Nuvem sem a
0048: o painel lê sem revisão e grava pelas funções antigas. Painel aberto de versão anterior grava pelas antigas até
recarregar; a revisão dele não existe, mas a tranca do caminho novo espera por ele.

Limites conhecidos: a revisão resume o conteúdo, então uma mudança e a volta exata dela entre a leitura da revisão e a
das tabelas (frações de segundo) passariam (um contador por gatilho resolveria); `cadastro_operacoes` cresce uma
linha por gravação, sem limpeza; e o apagar confere as trilhas abertas (`atribuicao_trilhas`) sem trancá-las, então
uma sessão aberta no mesmo instante perde a trilha pela cascata (já existia antes da 0048).

- **Só as contas dela (`empresas.so_contas_dela`, 0043):** nasce falso, e a tela nova grava verdadeiro. Unidade assim
  (estrita) não usa transbordo (`rvz_serve_trilha`), e a conta marcada para ela, com a unidade ligada, não fica na
  principal de nenhum computador (`rvz_principal_pode`). Quem não salvou pela tela nova segue como na 0.19.
- **Uma conta em várias empresas:** a tabela `atribuicao_trilhas` guarda a conta em uma trilha só, porque o login gira.
  No mesmo computador, as unidades ligadas e estritas com o mesmo conjunto de contas dividem uma trilha
  (`rvz_trilha_de`: a que já tem conta ali, senão a mais antiga). `agente_empresas` manda ao agente só a representante e
  aponta as regras das outras para ela. Em computadores diferentes, a conta segue indo a um por vez.
- **Pasta por computador (`pastas_empresa.computador_id`, 0043):** null vale em todos. A chave passa a ser tipo, padrão
  e computador. A regra de um computador ganha, no empate, da que vale em todos. `painel_unidade` recusa a pasta que já é
  de outra unidade no mesmo computador, ou quando um dos lados vale em todos.
- **Sem conta livre:** `Trilhas.pedir` devolve `bloqueio` para a unidade estrita e `reveza trilha` escreve o motivo e
  sai 3. Até a 0.20.2 o lançador não abria a conversa (saída 78). Desde a 0.21.0 (plano B) ele espera a conta do projeto:
  pergunta de novo (`reveza trilha --de-novo`) a cada 15 s por até 720 s e só então sai 78; `REVEZA_ESPERA_S=0` volta ao
  antigo. Na pergunta de novo, só resposta positiva e explícita tira da espera: a trilha conferida (saída 0, duas linhas)
  ou a conta em uso com a trava confirmada pela nuvem (saída 5, quando o agente manda `certa`); sem resposta, erro ou
  principal sem certeza saem 4 e a espera segue. A trava pedida na pergunta de novo entra em `travaPedida` antes da
  chamada, e as chamadas a `agente_segurar_principal` vão uma por vez (a que não volta segura a próxima até 20 s), porque a
  nuvem guarda a última lista que chega. A pergunta usa a pasta física (`realpath`), o instalador troca o lançador por
  rename (quem espera não lê um arquivo pela metade), e o comando que não conversa (`COMANDOS_SEM_CONVERSA`: `--version`,
  `doctor`, `mcp`, `config` e afins) pergunta sem o processo e nunca espera; `auth` e `setup-token`
  (`COMANDOS_DE_CONTA`) nem perguntam e abrem fora da trilha (quem já nasceu numa trilha segue nela, como todo comando,
  pela marca `REVEZA_TRILHA` no ambiente). Um teste confere que todo comando do `claude --help`
  está em uma das três listas. Na primeira pergunta, o agente que não responde leva mais 2 tentativas; seguindo assim, a
  sessão abre na conta em uso, com aviso, como antes. No modo sombra nada é barrado. Sem a primeira leitura da nuvem, a
  pasta não tem empresa conhecida e o assistente abre normal.
- **Conta esgotada (0.21.0):** `decisao.esgotada` é o teste do `painel_trocar_agora`: uma janela que decide em 100% ou
  mais, sem ter renovado (reset no futuro ou desconhecido). A conta em uso esgotada não serve à sessão nova de projeto
  (`Trilhas.principalServe`, na primeira pergunta, na de novo e na retomada): a sessão espera. Quem já segura a conta em
  uso segue segurando (`naPrincipal` usa `ativaServe`, sem o teste), porque trocar levaria a sessão aberta junto. `reveza
  trocar` (sem nuvem ou com `--local`) recusa a conta esgotada. A troca pela API, a trilha nova sem conta abaixo de 100
  e a trilha que já tem uma conta esgotada (ela é devolvida sem o teste) ficam para a 0.21.1.
- **Quem segura a conta em uso (revisão da 0.21.0):** o processo fica em `pidsPrincipal` só quando a resposta desta
  pergunta o pôs lá (a principal com a trava). A mesma pergunta pode chegar de novo (a resposta que passa dos 20 s da
  ponte se perde e o lançador repete): a resposta seguinte que abre na trilha, espera ou abre sem trava o solta
  (`Trilhas.pedir`, por `largarPrincipal`). O comando que não conversa vai com `--sem-conversa` e sem o processo:
  `Trilhas.semConversa` responde pela trilha que já tem conta que vale, ou pela principal, sem busca, trava nem gravação.
- **Retomada (`Trilhas.retomada`):** a regra vale pela pasta, mesmo para a sessão que parou no login da principal. Ela
  volta na trilha, na principal se a conta em uso é da unidade (o processo entra na trava) ou espera na fila, e a fila
  mantém a trilha pedida. Depois de religar, sem as regras lidas, a retomada espera.
- **Conta que saiu da lista:** `rvz_decidir_trilha` troca por outra da lista; sem outra, a trilha mantém a conta até as
  sessões abertas fecharem, e o agente não deixa sessão nova entrar nela.
- **Listas em parte iguais:** `rvz_candidatas_trilha` prefere a conta de que menos outras unidades estritas dependem.
  Quando a representante de uma trilha dividida muda, a unidade nova espera a trilha antiga soltar.
- **Quem dividiu a trilha (`atribuicao_trilhas.unidades`, 0043):** `rvz_lembrar_divisao` anota as unidades mandadas para a
  trilha antes de o computador receber as regras. Até a trilha soltar, ela só troca para uma conta que sirva a todas
  (`rvz_dividem_trilha`), porque pode haver sessão de qualquer uma nesse login. Unidade que só tem a mesma conta na
  lista, sem ter dividido a trilha, não segura nada.
- **Sessão sem tela na fila:** a retomada dentro da trilha entra nos processos dela, e a espera pela conta da unidade
  respeita o mesmo prazo da fila (2 h, 6 h no OpenBot). Passado o prazo, a sessão não reabre sozinha e o painel avisa.
- **Portão de versão:** `painel_unidade` recusa ligar enquanto houver computador não revogado, visto nas últimas 24 h,
  abaixo da 0.20.0, porque ele ignoraria a marca de estrita.
- **Sessão na conta da principal (`atribuicao.segura_ate` e `segura_unidades`, 0043):** quando a conta da unidade estrita
  está na principal, a sessão abre nesse login. O agente guarda o processo em `pidsPrincipal` e avisa a nuvem
  (`agente_segurar_principal`), que segura a conta por 3 min, renovados a cada busca enquanto o processo vive.
  Enquanto `rvz_principal_segura` for verdadeira, `decidir` não tira a conta; cheia, as sessões do computador esperam e
  sai um alerta `principal_segura` por hora. Troca pelo painel, pela API ou com `--local` é recusada, a preferida fica
  guardada sem entrar, e remover a conta é recusado ou adiado. A conta pausada ou sem login também fica até a sessão
  fechar, com alerta. O agente só abre a sessão depois que a nuvem confirma a unidade; sem resposta dela, nenhuma troca
  chega ao computador.
- **Quando a trava falha de lado:** a retomada pede a trava (`Trilhas.confirmarTrava`) e só abre o processo com a
  confirmação da conta em uso; se a nuvem não responde em 3 s, a sessão nova é recusada. Com a trava vencida (computador
  que dormiu), `aplicarAtribuicao` mantém a conta em uso enquanto a nuvem deixar. O agente guarda a hora de início de cada
  processo (`iniciosPrincipal`), para um número reaproveitado depois de religar não prender a conta, e as contas da
  unidade (`contasPrincipal`), para a unidade que deixou de ser representante seguir protegida. Quando a nuvem responde
  sobre a conta que está mesmo em uso e a unidade não volta na lista, os processos deixam de prender a conta.
- **Depois de religar:** as últimas regras lidas ficam em `estado.regrasEmpresas` e valem até a nuvem responder. O pedido
  do lançador fecha em até 18 s, abaixo dos 20 s da ponte.
- **Alcance:** a separação vale para o que abre pelo lançador `~/.reveza/lancador/claude`. Programa que chama o assistente
  por outro caminho não passa por ela.

## 6e. Projeto por computador (0.20.1)

A tela Empresas virou Projetos (rota `/projetos`; `/empresas` continua abrindo), e o nível de dentro virou subprojeto. No
banco e no código o nome segue `empresa`: renomear tabela em produção seria risco sem ganho para quem usa.

- **Onde roda (`empresas.em_todos_computadores` e `empresa_computadores`, 0045):** verdadeiro vale em todos, como antes;
  falso vale só nos computadores da tabela. O subprojeto segue o projeto (`rvz_roda_em` olha a raiz). A 0045 preenche uma
  vez só: o projeto que tinha todas as pastas presas a computadores passa a rodar nesses, e os outros ficam em todos.
  Rodar de novo não desfaz a escolha de ninguém.
- **Filtro na nuvem (0046):** `rvz_classificar`, `agente_empresas`, `rvz_trilha_de`, `rvz_lembrar_divisao` e
  `rvz_nome_trilha` ignoram o projeto que não roda no computador. O agente antigo já recebe a lista filtrada.
- **Trilha:** `rvz_decidir_trilha` só abre trilha nova onde o projeto roda. A que já existe segue até as sessões fecharem.
- **Principal:** `rvz_de_outro_computador(conta, pc)` diz se a conta é de um projeto ligado e estrito que não roda ali.
  Em `decidir`, sem candidata comum, a principal vai para uma conta de um projeto daqui; sem nenhuma, fica e sai o alerta
  `principal_de_outro`, uma vez por hora por computador. Não há troca cruzada direta: o agente pega a posse da conta nova
  antes de soltar a antiga, então dois computadores, cada um querendo a conta do outro, ficariam tentando para sempre.
- **Cadastro:** `painel_unidade` aceita `computadores` só no projeto (null: todos; lista: só nesses; lista vazia é
  recusada). Computador novo na lista precisa existir e não estar revogado; o que já estava e foi removido não impede
  salvar. O portão de versão olha só os computadores em que o projeto roda.
- **Painel:** cada aba de computador lista os projetos que rodam nele (`rodaNoComputador`); projeto sem nenhum computador
  ativo aparece em todas, para não sumir. A escolha só vai à nuvem quando muda, para não desfazer a de outra pessoa. A
  lista de contas mostra o estado, os limites e onde cada conta está (`ondeEsta`), e avisa quem sai dela ao salvar
  (`saemDaConta`). Com a nuvem sem a 0045, a tela esconde a escolha e não manda o campo.
- **Limite:** a regra de pasta que vale em todos os computadores ainda colide com a de outro projeto, mesmo em
  computadores diferentes. Prenda a regra ao computador.

## 6f. Conta parada cede ao computador no limite (0.21.1)

A conta atribuída a um computador ficava com ele mesmo parado: `rvz_candidatas` não oferece conta atribuída a outro
computador. Com várias contas cheias, o computador que trabalhava batia o limite e esperava a própria conta renovar,
enquanto outro computador, ligado e parado, segurava uma conta com folga. A 0047 resolve dentro da `decidir`, no ramo
"cheia ou bateu o limite" sem candidata, antes do alerta `sem_livre`:

- **Quem pede (`rvz_pede_conta`):** a conta em uso está cheia, ou acima do gatilho e passada a espera entre trocas (a
  falta do modelo da sessão, que chega com limite pela `agente_sem_modelo`, não basta), e ele bateu o limite agora,
  bateu nessa conta depois de recebê-la (nas últimas 5 h: a sessão parada no limite espera a conta renovar, e a
  retomada a continua na conta nova; o evento `limite` com motivo `sem_modelo` não conta) ou tem sessão que usou essa
  conta com atividade nos últimos 15 min (sessão só de trilha não conta). Dois computadores parados não trocam entre
  si.
- **O doador (`rvz_pode_doar`):** outro computador ligado (visto há menos de 2 min) há mais de 60 min
  (`computadores.ligado_desde`, marcada pelo gatilho `computadores_ligado_desde` quando ele é visto pela primeira vez ou
  de novo depois de mais de 5 min fora; vazia, de antes da 0047, conta como ligado há tempo), com a conta há mais de 30 min,
  motivo que não é pedido à mão, sem sessão de projeto segurando a principal, sem atividade nem limite em 60 min
  (`rvz_computador_ativo`), que não pede conta ele mesmo (quem bateu o limite nessa conta nas últimas 5 h também espera
  por ela, mesmo logo depois que ela renova e as leituras ainda não mudaram) e com o uso da conta parado (`rvz_uso_parado`: 2 leituras ou mais em 60 min, a janela de 5 h
  igual). A conta dele precisa servir a quem pede (`rvz_serve_principal`, os filtros da `rvz_candidatas` menos posse e
  atribuição). Entre vários, a conta com mais folga.
- **A conta do meio (`rvz_conta_do_meio`):** sem dono, sem posse de outro computador, com cofre, leitura recente (login
  bom), não pausada, que a principal pode usar, dentro da agenda e do teto da semana, com o modelo no doador; a
  preferida de outro computador ligado por último (o doador parado não a devolveria), e a mais cheia primeiro. O doador
  vai para ela e quem pede recebe a dele,
  que chega quando o doador soltar a posse (o caminho da troca entre computadores pelo painel). Sem conta do meio, nada
  muda: a troca direta entre os dois travaria (6e).
- **Sem impasse:** as travas seguem a ordem da `decidir` e nenhuma espera: primeiro as linhas do doador (computador e
  atribuição, `for update of a, q skip locked`), depois a trava das trocas (`pg_try_advisory_xact_lock(778801)`), só
  quando há doador e conta do meio (a conta do meio é lida de novo com a trava). Sem doador, nenhuma trava fica presa até
  o fim da decisão. A `decidir` do doador começa pela linha do computador dele e espera esta terminar. Quem não conseguiu tenta de novo pelo cron, no minuto seguinte, sem o alerta
  `sem_livre`: a `rvz_ceder_parada` devolve nulo com a trava ocupada ou quando a lista travada saiu menor que a
  contagem dos doadores (um ficou de fora porque outra decisão segurava a linha dele).
- **Sem volta:** o computador que cedeu (motivo "parado: cedeu a conta a um computador no limite"), enquanto não pede
  conta (`rvz_pede_conta`), não troca pela regra (limiar, volta à preferida, devolução da preferida de outro, rodízio)
  nem gera o aviso de 90%; pausar a conta, perder o login e a troca à mão seguem valendo. Quando volta a trabalhar e
  bate o limite nessa conta, troca pelo caminho normal, e esse limite vale por 5 h.
- **Fora da regra:** computador fora do ar (o agente dele não está lá para soltar a posse, e voltar com o login antigo
  giraria o token), conta escolhida à mão e a troca automática desligada.
- **Limites:** "parado" vem do que a nuvem vê: a última linha de cada sessão e as leituras de uso. Uma sessão que espera
  mais de 60 min sem escrever nada (uma tarefa de fundo longa) parece parada; ela segue na conta do meio e, se bater o
  limite, troca pelo caminho normal. Resolver de vez pede um sinal de sessão viva do agente. E, como em toda troca,
  se o agente do doador não conseguir instalar a conta do meio, a posse da conta antiga vence em 2 min (a busca só
  renova a da atribuída): o mesmo risco da troca que falha em qualquer computador, anotado para uma versão do agente.

## 7. Nuvem: tabelas (todas com RLS ligado)

| Tabela | Quem lê | Quem escreve |
|---|---|---|
| `membros(user_id, papel)` papel: `admin`, `leitura`, `computador` | membro | admin (convite por Edge Function) |
| `convites(email, papel, expira_em, criado_por)` | admin | admin |
| `computadores(id, user_id, nome, sistema, versao, visto_em, revogado, conta_preferida)` | membro | o próprio computador (seu registro); admin revoga e escolhe a conta preferida |
| `contas(id, email, organizacao, plano, cor, prioridade, reserva, pausada, agenda, teto_semana)` | membro | admin; computador grava plano e organização |
| `cofre(conta_id, cifrado, nonce, versao, gravado_por, gravado_em)` | só computador | só computador com posse |
| `posse(conta_id, computador_id, expira_em)` | membro | só por função (`pegar_posse`, `soltar_posse`) |
| `atribuicao(computador_id, conta_id, motivo, versao)` | membro | só a função `decidir` |
| `uso_janelas(conta_id, tipo, pct, reset_em, lido_em, fonte)` | membro | computador |
| `uso_tokens(dia, hora, conta_id, computador_id, projeto, pasta, modelo, entrada, saida, cache_escrita, cache_leitura, usd, respostas, agentes)` | membro | computador |
| `sessoes(id, computador_id, projeto, pasta, inicio, fim, agentes, usd, contas)` | membro | computador |
| `empresas(id, nome, cor, transbordo, transbordo_contas, separar, pai, modo, herdar_transbordo)` (0.17.0; `separar` na 0.18.0; projeto, modo e transbordo herdado na 0.19.0) | membro | admin, pela função |
| `conta_empresas(conta_id, empresa_id)` as empresas que cada conta atende; sem linha, a conta atende todas | membro | admin, pela função |
| `pastas_empresa(id, tipo, padrao, empresa_id)` tipo `pasta` (caminho ou nome) ou `titulo` (agente do OpenBot) | membro | admin, pela função |
| `empresa_computadores(empresa_id, computador_id)` (0.20.1) os computadores do projeto com `empresas.em_todos_computadores` falso | membro | admin, pela função |
| `agentes_openbot(computador_id, pasta, nome, titulo, visto_em)` | membro | computador, pela função |
| `atribuicao_trilhas(computador_id, empresa_id, conta_id, motivo, versao, decidido_em, pedida_em)` (0.18.0) | membro | só as funções das trilhas |
| `trilhas_sombra(computador_id, empresa_id, conta_id, em_uso, motivo, sessoes, trocas, versao, decidido_em, visto_em)` (0.19.0) | membro | só `rvz_rodar_sombra` |
| `eventos(em, tipo, texto, dados)` | membro | funções e computador |
| `comandos(id, criado_por, computador_id, acao, corpo, estado, resposta)` | membro | admin cria; computador reserva e responde |
| `ligacao_pedidos(computador_id, aprovador, idioma, publica, pedido_em, expira_em, envelope, entregue_por, entregue_em, lido_em, recusado)` | membro, sem `publica` e `envelope` | o computador novo registra a chave pública (uma vez); computador ativo entrega ou recusa; admin escolhe o aprovador |
| `config(chave, valor)` modo, limiares, rodízio, intervalo; e, só leitura, a versão da nuvem e o que está no ar (7e) | membro | admin (as de 7e: só funções da nuvem e o instalador) |
| `credenciais_atualizacao(nome, cifrado, nonce, gravado_por, gravado_em)` os tokens da atualização completa, cifrados com `K` | ninguém de fora (nem o painel, nem a chave de serviço); computador ativo pela função | computador ativo (ligar e desligar); admin só apaga |
| `alertas(canal, destino_cifrado, eventos, ativo)` | admin | admin |
| `auditoria(em, user_id, acao, alvo, ip)` | admin | gatilhos (ninguém edita) |
| `chaves_api(id, user_id, prefixo, hash, escopos, criada_em, usada_em, revogada)` | dono da chave | o próprio usuário |

Ações do painel que mudam alguma coisa passam por função Postgres `security definer` que confere o papel, grava a
auditoria e valida a entrada; o painel nunca escreve direto em tabela.

Ajustes da revisão de segurança de 11/10/2026 (migrações 0007 e 0008, testes em `nuvem/testes/revisao-seguranca` e
`painel-extra`):
- leitura de convites, alertas, webhooks e auditoria exige administrador COM duas etapas;
- o segredo de cada canal de alerta (Vault) só a própria função liga ao canal; destino conferido por canal, e todo
  endereço que a nuvem chama é https público (sem IP escrito, porta diferente de 443, usuário na URL ou nome interno),
  conferido no banco e de novo na Edge Function, que não segue redirecionamento;
- o código de login colado no painel sai de `comandos` assim que o computador reserva o pedido;
- convite novo cancela o anterior do mesmo e-mail, convite pode ser cancelado e aceitar nunca rebaixa administrador;
- revogar computador desliga o login dele no Auth e derruba as sessões;
- uma conta só pode estar atribuída a um computador (índice único e trava na `rvz_atribuir`);
- comando `ligar` (0.1.x: a frase cifrada para o navegador): saiu na 0.2.0. `painel_comando` recusa a ação e o agente
  responde 410; o computador novo entra pelo código que aparece nele (seção 8).

## 7b. Ponte local (mod e linha de comando ↔ agente)

HTTP só em 127.0.0.1, Host conferido (contra DNS rebinding), cabeçalho `X-Reveza: 1` (o navegador não manda sem
preflight, e a ponte não responde preflight) e a prova da chave local que mora em `~/.reveza/ponte.chave` (64 hex,
arquivo 600): `X-Reveza-Prova` = HMAC-SHA256(chave, "MÉTODO\ncaminho\ntempo\nnonce"), com `X-Reveza-Tempo` (60 s) e
`X-Reveza-Nonce` (uso único). A chave nunca viaja: se outro programa estiver na porta no lugar do agente, ele não a
aprende. Outro usuário do mesmo computador, que alcança 127.0.0.1, não lê e-mails nem força troca. A
retomada de sessão só acontece na pasta registrada na transcrição da própria sessão (nunca na que chega pela ponte),
e o texto que o mod põe no prompt é fixo.

**Conversa de outro programa não se retoma.** O `claude --resume <sessão> -p` da retomada sem tela vale só para
conversa do próprio assistente: o `entrypoint` do começo da transcrição é `cli` ou `sdk-cli`. Conversa que outro
programa abriu (o OpenBot grava `openbot`; um app pelo SDK, `sdk-ts` ou `sdk-py`), ou que roda numa pasta de agente do
OpenBot (`~/OpenBot/Agents/<agente>`, mesmo sem a marca), fica de fora: o programa a reabre sozinho na conta nova, e a
cópia do Reveza trabalharia junto com a dele, na mesma conversa e nas mesmas pastas, respondendo para o Reveza e não
para quem conversa (caso de 10/11/2026: duas cópias de um agente do OpenBot ao mesmo tempo). A fila marca a sessão como
descartada, com um evento dizendo de quem ela é, e o **retomar** do painel responde 409.

**Conversa com processo vivo não ganha outra cópia (0.16.2).** O processo que bateu o limite pode seguir vivo, relendo
o login e trabalhando na conta nova, e uma retomada anterior pode estar no meio do trabalho (caso de 10/11/2026: um
`claude -p` de hora em hora foi reaberto duas vezes, em duas trocas seguidas, com o processo original ainda vivo, e as
cópias repetiram registros e avisos). Antes de abrir o `claude --resume`, a retomada procura um processo da conversa
neste computador (`agente/src/sessaoviva.ts`): pela linha de comando do `ps` (`--resume`, `-r` ou `--session-id` com o
id, numa linha do assistente) e pelo registro de sessões que o próprio assistente mantém ao lado das transcrições
(`~/.claude/sessions/<pid>.json`, com o `sessionId`; ele pega o processo original, que não traz o id na linha de
comando, e confere no `ps` que o número ainda é do assistente). No Windows, sem o `ps`, vale só o registro. Com processo
vivo, a sessão segue na fila com o número dele (`vivo`), sai um evento, e o ciclo (15 s) confere de novo. Quando o
processo sai, ela só volta se a última resposta do assistente na transcrição for o erro da API (`isApiErrorMessage`, o
limite); se ele seguiu na conta nova e terminou, a fila a marca como retomada ("voltou a trabalhar sozinha") e nada
reabre. Sem resposta no fim lido, não dá para saber, e ela volta como antes. O **retomar** do painel com processo vivo
responde 409 e a sessão segue esperando.

**Uma retomada sem tela por vez, e passada superada não volta (0.16.2).** Numa troca de 10/11/2026 o Reveza reabriu
no mesmo segundo 13 passadas sem tela, 9 delas de uma rotina de 5 em 5 minutos que o relógio da rotina já tinha deixado
para trás (registros repetidos, crédito gasto à toa e uns 1,9 GB de memória juntos). Agora:

- a fila retoma a mais antiga primeiro e uma por vez: a retomada que o Reveza abriu e ainda roda (`retomadaEm`, conferida
  com o mesmo `sessaoviva.ts`) segura as outras, e o ciclo solta a próxima quando ela sai. A liberação (`liberadaEm`, a
  hora da troca) é que conta para o prazo da fila, não a hora em que chega a vez;
- quem lança `claude -p` de tempos em tempos pode marcar a passada com `REVEZA_ROTINA=<nome>` no ambiente. O mod manda a
  marca na medida e no limite, a fila a guarda (`rotina`) e a retomada a leva adiante. Da mesma rotina só volta a
  passada mais nova, e nenhuma quando outra sessão da rotina apareceu depois do corte (o relógio dela já seguiu). A
  marca é explícita de propósito: agrupar pela pasta, pelo texto do pedido ou pelo rótulo do serviço que lançou o
  processo (o `XPC_SERVICE_NAME` do launchd) juntaria tarefas diferentes e descartaria trabalho;
- a sessão sem tela que bate o limite com a troca já feita (o pedido chega com a versão de antes) volta já, sem esperar a
  troca seguinte;
- sem conta livre para trocar, a sessão sem tela volta quando a própria conta volta: no limite a fila guarda `voltaEm`
  (o reset mais tardio das janelas cheias) e o ciclo a solta quando a conta em uso é a que encheu, o reset passou e ela
  está abaixo do gatilho.

**Conversa de agente do OpenBot continua pelo próprio OpenBot (0.16.2).** A 0.16.1 deixou de reabrir essas conversas
com `claude --resume -p`, supondo que o OpenBot as reabria. Não reabre: ele só abre o programa do agente quando chega
mensagem ou rotina, e o turno cortado fica cortado (10/11/2026: 12 conversas cortadas às 20:58, nenhuma continuou
quando o crédito voltou). Com o OpenBot instalado (`agente/src/openbot.ts`; por enquanto no macOS), a conversa cortada
na pasta de agente dele continua uma vez por corte, pelo comando que o OpenBot traz para scripts locais
(`openbot-cli run <agente> - --id reveza-<sessão>-<corte>`, que só enfileira; a chave impede a mesma continuação duas
vezes), e só quando:

- a conversa ainda parou no erro do limite (se chegou mensagem nova e ela seguiu, nada sai);
- ela é o chat principal de um agente agora: a sessão do assistente ativa ligada à conversa do agente no banco do
  OpenBot, lido só para leitura (`sqlite3 -readonly`). A rodada de rotina roda numa sessão temporária que o OpenBot não
  guarda: fica com a próxima rodada da rotina. Sem o banco, ou sem resposta dele, nada sai;
- o turno cortado não era uma mensagem automática que o remetente repete sozinho: uma por linha em
  `~/.reveza/retomar-ignorar.txt`, comparada com o começo do pedido (sem o histórico e sem os blocos de instrução que o
  OpenBot põe na frente).

As cortadas juntas saem uma por vez, com 60 s entre elas, e 30 s depois da troca (o processo da conversa relê o login).
O prazo é de 6 h depois do corte, para cobrir a janela de 5 h voltar. O texto diz a hora do corte, pede para continuar
de onde parou, lembra que o que dependia de alguém continua esperando e pede só "nada pendente" quando nada ficou pela
metade. Falha do comando (OpenBot fora do ar, agente sem scripts locais) vira um evento de erro, sem repetir sozinha.

**Rotas das trilhas (0.18.0).** `POST /api/trilha { cwd, pid }` (o lançador, pela linha de comando): `cwd` absoluto
de até 4096 caracteres, `pid` inteiro; devolve a trilha da empresa da pasta (ou nada, com aviso). Com `deNovo: true`
(0.21.0, a pergunta do lançador que espera), o agente não regrava o estado a cada pergunta e só manda `certa: true` com
a trava da conta em uso confirmada pela nuvem. `POST
/api/trilha/ativa { trilha, sessao }` (o mod, no lugar de `GET /api/ativa`, quando a sessão nasceu com
`REVEZA_TRILHA`): a conta da trilha e a versão dela; trilha desconhecida dá 404. Medida e limite com `trilha` no corpo
vão para a conta da trilha e nunca mexem na principal. Mesma prova da chave local das outras rotas.

**A conta da sessão (0.10.3).** O uso ao vivo (`/api/medida`) e o limite (`/api/limite`) só valem para a conta em uso
quando a sessão está nela. Relato de um usuário (22/10/2026): o app de desktop, com login próprio numa conta A, carregava
o mod, e o uso dele era gravado na conta B, a em uso (o painel e a troca decidiam com o número errado). O mod lê a conta
da sessão com `$.session.authorize()` (a credencial fica no Claude Code; o mod recebe um apelido que só vale para o
endereço oficial) e `GET /api/oauth/profile`, uma vez por sessão e de novo quando a conta em uso muda (30 min de
validade; 2 min sem resposta ou com o agente dizendo outra conta), e manda ao agente só `{ accountUuid, orgUuid }`, ou
`{ fora: true }` para sessão sem o login que o Reveza troca (chave de API, token só de uso no ambiente, que o perfil
recusa pelo escopo). O agente compara com a conta em uso: login de fora (conta que não está neste computador, `fora`)
não mexe no número, não enche a conta, não marca "sem o modelo" e não entra na fila (o mod avisa a sessão e mostra na
linha de status); sem a conta (mod antigo, perfil fora do ar, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) segue como
antes.

**Sessão atrasada na troca (0.10.5).** O assistente relê o login a cada 30 s (medido no 2.1.312: o chaveiro trocado no
meio de um turno vale a partir do pedido seguinte a esses 30 s), mas nem toda sessão consegue: em 29/10/2026 a tela do
Mac travou e a sessão gráfica fechou 4 minutos depois de uma troca, e os processos das sessões do editor que sobraram
(sem o editor, numa sessão do sistema que acabou) seguiram na conta que saiu por 7 a 11 minutos, até ela bater 100%. A
0.10.3 só reconhecia a conta que saiu nos 2 primeiros minutos; depois disso o limite virava "outra conta" e a sessão
parava sem voltar. Agora a sessão numa conta deste computador que não é a em uso é `atrasada`, a qualquer tempo: a
medida dela não entra na conta em uso, o mod relê a conta dela em 30 s (e não em 30 min), e o limite (ou o modelo
recusado) marca a conta dela (cheia, ou sem o modelo), põe a sessão na fila e responde `trocou` com `aguardarS` (35 s, e
120 s na segunda vez). O mod espera esse tempo e manda a sessão continuar; a de terminal volta na hora, num processo
novo, que lê o login. Voltou e bateu de novo na mesma conta, na mesma versão da troca, pela terceira vez: a sessão não
pega a troca (processo sem acesso ao chaveiro, login próprio numa dessas contas), e o agente responde `outraConta` com
`naoPegou` (o e-mail da conta), o mod diz isso à sessão e sai um aviso nos eventos. O app de desktop tem login próprio:
o mod manda na medida e no limite o `CLAUDE_CODE_ENTRYPOINT` da sessão, e com `claude-desktop`, `claude-desktop-3p` ou
`local-agent` (o Cowork; o mesmo conjunto que o assistente trata como app de desktop) a conta deste computador conta como
outra conta (no limite avisa na hora, sem esperar nem fila), como na 0.10.3. No limite o mod lê a conta da
sessão de novo, sem a guardada: o limite é da credencial do pedido que acabou de falhar. O log diz em que conta está cada
sessão fora da em uso.

**O login do assistente no Windows (0.10.4).** O assistente passou a poder guardar o login no Gerenciador de
Credenciais do Windows (store `windows-credman-with-plaintext-fallback`, ligado pela marca `tengu_windows_credman` que
ele guarda em `cachedGrowthBookFeatures` do `.config.json` da pasta `~/.claude` ou do `~/.claude.json`, ou à força por
`CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`; lido no código do assistente 2.1.309). Ligado, o `.credentials.json` vira só a
reserva, e o login que o Reveza põe nele não vale nas sessões. O agente confere de 10 em 10 minutos e solta um evento de
erro quando liga; o `reveza doctor` (e a Saúde) mostra a conferência `login-windows`. O suporte (ler e gravar o login no
Gerenciador) depende de conhecer o formato que o assistente usa lá, que não está no pacote do macOS.

**O limite nas organizações Team e Enterprise (0.12.0).** Nessas organizações o Claude Code põe o plugin de segurança
dele (`cc-plugin-sec-default`) na frente dos plugins que a pessoa instala, e ele manda os eventos clássicos (`classic.*`)
direto para baixo, sem passar por eles: o `classic.StopFailure` do mod era pulado ("its classic.StopFailure hook was
skipped") e, de 13/10 a 06/11/2026, nenhum limite chegou ao agente pelo mod. O mod passa a ouvir também o
`turn.complete` (fim do turno principal com `reason: "error"`), que não é clássico. O `answer` dele vem vazio no
erro de API (conferido no 2.1.312): o limite é reconhecido pela última mensagem da sessão (`$.session.messages()`,
"You've hit your 5-hour limit · resets ...") ou, sem ela, pelo uso em 100% que a resposta recusada trouxe
(`$.session.usage().rateLimits`). Quando os dois caminhos chegam (fora das organizações), o StopFailure vem antes e o
fim do turno logo depois não repete.

**O estado no disco (0.10.3).** Relato de um usuário (Windows, desligamento brusco em 22/10/2026): o `estado.json`
voltou com bytes nulos e o agente subiu só com a conta em uso, sem aviso. A gravação atômica manda o conteúdo ao disco
antes da troca de nome (e a pasta depois, onde o sistema deixa; uns 8 ms por gravação do estado, de 15 em 15 s; o
registro de uso, que se refaz sozinho, não espera). Na partida, um estado ilegível é guardado como
`estado.json.estragado-<data>` (nunca apagado), volta a cópia boa `estado.json.bom` (feita na partida, quando a lista de
contas muda e de hora em hora) e sai um evento de erro, que vai ao painel. Uma pasta de conta fora da lista volta pelo
`.claude.json` dela quando o perfil não responde (token vencido depois de horas parado), e a pasta sem login de uma conta
fora da lista não é apagada (é a única pista dela; o evento pede para entrar de novo).

**O uso relatado e o login morto (0.16.4).** A nuvem grava cada janela relatada com a hora da chegada (`lido_em`) e
decide pelas lidas há menos de 15 minutos. O agente só relata a leitura que tem até 15 minutos (`LEITURA_VALIDA_S`):
antes, com a leitura da conta em uso parada (login vencido), ele mandava o último número de novo a cada busca, a nuvem
o tomava por novo e a conta parecia longe do limite (16/11/2026: 57% na nuvem com a conta em 100%; nenhuma troca
automática, só a manual). Sem leitura da conta em uso por 15 minutos, sai um aviso de erro uma vez (e um registro quando
volta a ler). O login da conta em uso que venceu e não renova (o assistente apaga o login do chaveiro depois de uma
renovação recusada, e as sessões param pedindo para entrar) conta como conta sem login: o agente repõe a cópia do cofre
ou troca para outra, sem esperar. Antes de trocar para uma conta cujo login parece válido pelo prazo mas não foi lido
nos últimos 10 minutos, o agente confere o perfil; recusado (401 ou 403) e sem renovação, a conta fica marcada como
"precisa entrar de novo" e a troca vai para outra.

**Conversas do OpenBot e o mod (0.16.4).** O OpenBot só carrega os hooks e plugins de `~/.claude` (onde mora o mod)
com a opção "Usar minha configuração do Claude Code", desligada de fábrica. Desligada, as conversas dele rodam sem o mod:
o Reveza não vê o limite nem o uso ao vivo delas e só troca pela leitura do uso. O `reveza doctor` (e a Saúde) mostra a
conferência `openbot`, com o caminho para ligar. O plano sem janela de 5 horas (a API manda `five_hour` vazio, como no
Max 20x) é normal: a decisão usa a semana e a semana por modelo.

## 7c. Atualização do banco

`reveza_migracoes(nome, hash)`: migração nova entra; arquivo marcado `-- reaplicável` (só funções, políticas e
índices idempotentes) roda de novo quando muda; migração de tabela que mudou depois de aplicada é recusada (vai numa
migração nova); depois da primeira que entra, todas as reaplicáveis seguintes rodam de novo, na ordem (uma função
definida em mais de um arquivo fica sempre com o corpo do último: na subida da 0.3.0 para a 0.3.1, só a 0020 rodou e a
`agente_vez_de_atualizar` voltou ao corpo dela, sem o portão da publicação da 0021; corrigido na 0.3.2); as permissões
(0099) fecham qualquer aplicação. Instalador mais velho que a nuvem não mexe nela. As chaves do push (VAPID) nascem uma vez. A mesma
regra vale nos dois caminhos: o instalador (Management API, com o token) e, desde a 0.3.0, a própria nuvem (7e), que
aplica cada migração numa transação. Por isso migração nova não pode controlar a própria transação nem usar
`concurrently` ou `vacuum` (a nuvem recusa antes de começar e diz por quê).

## 7d. Atualizar o programa dos computadores

O painel só pede (`atualizar` com `{ versao: "mais_nova" }`, ou `{ conferir: true }` no Verificar atualização); quem
escolhe, baixa e instala é o agente (`agente/src/atualizar.ts`): só versão publicada do repositório oficial e maior que
a dele, pelo instalador da própria versão nova, num processo separado, com a cópia do estado e a volta sozinha.
- **Verificar atualização** (0.2.1): cada computador ligado lê a versão publicada na hora (no máximo uma vez por minuto;
  no ciclo normal, a cada 6 horas) e responde `{ atual, mais_nova, nova, atualizando, precisa_nuvem }`.
- **Atualizar sozinho** (`config.atualizar_sozinho`): desligada (`false`, o padrão), de madrugada (`true`, das 3h às
  5h no fuso) ou `"assim_que_sair"` (assim que o agente acha a versão nova). De madrugada continua `true` no banco para
  os agentes de antes da 0.2.1 entenderem. Nos dois jeitos ligados: só com o computador calmo (sem troca de conta em
  andamento nem sessão no limite) e um por vez (`atualizacao_vez`, 0018 e 0020); se um volta para a anterior, os
  outros param e sai um alerta. O agente da 0.2.1 conta no diagnóstico que entende o "assim que sair"
  (`assimQueSair`); os de antes só vão sozinhos de madrugada, e o painel deixa o Atualizar todos para eles.
- **Trava de compatibilidade**: uma versão nova pode trazer migração da nuvem. Antes de rodar o instalador, o agente
  compara as migrações do pacote baixado (`nuvem/migracoes`) com as que a nuvem já aplicou (`agente_migracoes()`: os
  nomes e, desde a 0.3.1, o resumo sha256 de cada uma em `reveza_migracoes`; o computador não lê a tabela). Falta a que
  não tem o nome lá e, enquanto a nuvem estiver numa versão anterior (`nuvem_versao`), também a reaplicável que existe
  com outro conteúdo (a 0099 muda quase toda versão); com a nuvem na mesma versão ou adiante, basta o nome. O resumo é
  do texto com fim de linha LF (`.gitattributes` fixa LF nos `.sql`; o registrado com CRLF por um clone no Windows de
  antes da 0.3.1 também vale), igual no instalador, na função `atualizar-nuvem` e no agente. Faltando alguma, ou com a
  nuvem sem a função ou sem o registro, não atualiza: o painel mostra "A versão Y precisa da nuvem atualizada
  primeiro: use Atualizar a nuvem" (até a 0.2.1, era no computador principal, com os tokens; desde a 0.3.0 a nuvem se
  atualiza sozinha, 7e), e o agente confere a nuvem de 5 em 5 minutos (sem baixar de novo) até poder seguir. Mudança
  de tabela continua indo num arquivo novo de migração: o instalador recusa migração de tabela que mudou.
- **A ordem** (0.3.0): com a atualização completa ligada (7e), a vez de se atualizar sozinho (`agente_vez_de_atualizar`)
  espera as funções e o painel da versão da nuvem irem ao ar (`motivo: publicacao`), e para se a publicação parou
  (`publicacao_falhou`). Enquanto um computador publica, ele mesmo não se atualiza (a publicação é um processo dele).
- **O assistente de código** (0.8.0, `agente/src/assistente.ts`, migração 0027): a escolha da instalação
  `config.assistente_atualizar` é `padrao` (sem a linha: o Reveza não mexe), `sozinho` (o agente roda `claude update` de
  6 em 6 horas, num momento calmo e fora de uma atualização ou publicação do Reveza) ou `manual` (o agente escreve
  `env.DISABLE_AUTOUPDATER = "1"` no `settings.json` do usuário; o `claude update` segue funcionando com ela). O agente
  só tira o valor que ele mesmo escreveu (`assistenteDesligouAuto` no estado); o da pessoa fica, e `reveza assistente
  liberar` (a desinstalação chama) devolve o dele. O painel pede pelo `atualizar` com `{ assistente: true }`: o agente
  responde na hora e roda o `claude update` solto (pode levar minutos); o agente de antes da 0.8.0 recusa o corpo ("só
  leva a versão") sem mexer em nada. O diagnóstico leva `assistente: { versao, modo, autoDesligado, atualizando,
  ultima }`; a versão vem do doctor (`Conferencia.valor`), não do texto. Desde a 0.12.0 (`paraVersao: true` no
  diagnóstico) o pedido pode levar a versão do computador mais adiantado, `{ assistente: true, versao }`: o agente roda
  o `claude update` e, se não chegou nela, instala essa versão (npm: `npm install -g @anthropic-ai/claude-code@X` pelo
  npm do Node do agente; instalação nativa: `claude install X`); `ultima` leva `alvo` e, sem chegar, `ok: false` com
  onde parou. Na instalação pelo npm, o agente põe `npm_config_prefix` com a pasta do assistente em uso (o caminho
  real do programa): com o serviço rodando com outro Node, o `claude update` instalava na pasta desse outro Node.

## 7e. Atualizar a nuvem e o painel (0.3.0)

Pedido do dono (12/10/2026): a nuvem e o painel também se atualizam sozinhos, com o menor privilégio possível. A ordem é
nuvem → funções e painel → computadores, e um passo que falha para os seguintes, avisa no painel e manda o alerta
(`atualizacao_falhou`, com `parte`: `nuvem` ou `publicacao`).

**1. A nuvem aplica as próprias migrações, sem credencial guardada.** A Edge Function `atualizar-nuvem`
(`nuvem/funcoes/atualizar-nuvem`) usa a conexão que a plataforma dá às funções (`SUPABASE_DB_URL`, documentada como a
URL do Postgres do projeto; cliente `jsr:@db/postgres` 0.19.5, o do exemplo oficial do Supabase para Edge Functions).
- Quem pede: o administrador pelo painel (**Atualizar a nuvem**; a regra das duas etapas de sempre), ou o pg_cron de
  hora em hora (`reveza-atualizar-nuvem`, migração 0022, com o segredo do cron dos alertas), que segue a escolha
  **Atualizar sozinho** (desligada não faz nada; de madrugada, das 3h às 5h no fuso; assim que sair, a qualquer hora).
  A sozinha não tenta de novo uma versão que falhou: quem pede de novo é o administrador.
- As regras do agente (7d): repositório fixo no código, só versão publicada (a API de releases; com ela recusando, por
  limite de pedidos do endereço que as funções dividem, a página `/releases/latest`, que só aponta versão publicada) e
  maior que a da nuvem, pacote da tag montado no código e redirecionamento só para `github.com` e
  `codeload.github.com`. O `.tar.gz` é lido na memória, com limite de tamanho, recusando link e caminho para fora; o
  `package.json` tem de ser o do Reveza na versão pedida.
- Antes de tudo, confere que a conexão é dona (ou herda o papel dono) das tabelas e funções que as migrações refazem;
  se não for, para sem mexer e diz os papéis (a nuvem segue pelo instalador).
- Aplica o plano de 7c, cada migração numa transação com `pg_advisory_xact_lock` (778805), `lock_timeout` de 15 s e o
  registro conferido de novo dentro da trava: duas rodadas juntas não aplicam a mesma migração duas vezes, e a que
  falha não deixa nada dela (as anteriores ficam, e a próxima rodada continua dali). Uma rodada por vez
  (`servico_nuvem_comecar`, a vez vale 10 minutos). No fim, `nuvem_versao` (só sobe), `nuvem_atualizacao` e os
  resumos das partes (`impressoes`).
- As funções `servico_nuvem_*` não são liberadas para nenhum papel de fora, nem para a chave de serviço: só o dono do
  banco, pela conexão da função.
- Provado nos testes: todas as migrações de hoje rodam uma transação cada, pelo caminho da função, com um papel que não
  é superusuário e só tem o que o papel `postgres` do Supabase tem (criar no `public`, referenciar `auth.users`, as
  funções do Auth, do Vault e do pg_cron); a 0005 (que cria as extensões pg_cron e pg_net) não roda no Postgres do
  teste. Não provado aqui: o papel exato de `SUPABASE_DB_URL` num projeto de verdade e se ele é o mesmo que o
  instalador usou (a Management API); a função confere isso a cada vez e para com o motivo se não for.

**2. Funções e painel precisam de credencial: opcional e cifrada de ponta a ponta.** Publicar função exige o token
pessoal do Supabase (alcança a conta inteira) e publicar o painel, o token da Vercel.
- Desligada de fábrica. `reveza atualizacao-completa ligar` (ou a oferta no fim da instalação, padrão não) pede os dois
  sem eco, mostra o que custa e como reduzir o alcance (Vercel: escopo no time do painel e validade; Supabase: validade
  e uma conta só com a organização do Reveza), confere que alcançam o projeto e a conta, cifra cada um com `K`
  (AES-256-GCM, dado associado `reveza-atualizacao|<nome>`) e guarda em `credenciais_atualizacao` (a impressão da
  chave tem de ser a da instalação). `desligar` (ou Desligar, no painel) apaga; para tirar o acesso de vez, apague os
  tokens no Supabase e na Vercel. Quem tem um computador da instalação tem `K`, e portanto os tokens.
- A nuvem guarda os dados do painel que antes só o computador criador sabia (`painel_publicacao`: projeto, equipe,
  domínio, endereços, chave pública do push; nunca token) e o que está no ar (`publicado`).
- O que falta publicar (`rvz_publicacao_pendente`, a mesma regra no agente e no painel): uma parte está em dia quando a
  versão no ar já é a da nuvem, ou quando a função calculou o mesmo resumo das duas versões (`impressoes`: as funções
  com `nuvem/provisionar.mjs`, o painel com o build e a publicação; sem testes nem arquivos ocultos).
- Com os tokens guardados, o primeiro computador ligado e calmo (qualquer sistema com o Node do agente) pega a vez
  (`agente_vez_de_publicar`, um por vez; o mesmo computador retoma a publicação que caiu no meio; outro só depois de
  45 minutos, e aí a de antes vira falha), baixa o pacote oficial da versão da nuvem e roda o instalador DELA com
  `--publicar-nuvem --ref <projeto> --partes funcoes,painel`, com os tokens só pela entrada padrão. O instalador só
  publica se a nuvem já está nessa versão, roda o provisionamento (as migrações já entraram; o plano sai vazio) e
  compila o painel nesse computador, com o React Bits grátis baixado ali, como na instalação; a Vercel recebe só o
  resultado, e a implantação nova só vira a de produção quando fica pronta (o painel antigo segue no ar até lá). A
  saída vai para `logs/publicacao-X.log` sem nenhum pedaço dos tokens; o fim vai para `agente_publicacao_resultado`.
- Sem os tokens, nada muda: o painel mostra o passo manual só quando a versão mexe nas funções ou no painel.

**3. No painel**, a linha "Nuvem e painel" no topo do cartão de Atualizações: as versões, **Atualizar a nuvem**
(administrador; também destrava a publicação parada) e o estado (em dia, atualizando, publicando, passo manual,
esperando a publicação, falhou com o motivo, nuvem de antes da 0.3.0). No passo manual, os dois caminhos com o comando
para copiar: ligar a atualização completa (primeiro: vale para as próximas) ou o instalador no computador que criou a
instalação. Com o painel atrás da instalação (`painelAtras`: a versão da nuvem com o painel por publicar, ou a dos
computadores), o rodapé do menu diz isso em toda tela e leva ao cartão (0.10.2: um usuário atualizou a nuvem pelo
botão e procurou o que levasse o painel junto).

## 8. Autenticação e acesso

- Supabase Auth com senha + verificação em duas etapas (TOTP) para `admin`: quem ativou precisa do código em toda
  sessão; quem não ativou age só com a senha, a não ser que a instalação exija (`exigir_duas_etapas`). Quem confere é o
  banco (`rvz_exigir_admin` = admin e `rvz_aal2`) e as Edge Functions (`servico_aal_ok`); não há servidor do painel.
- Computador novo (0.2.0; protocolo 3 desde a 0.4.0): o código aparece NELE e é digitado num computador que já tem a
  chave do cofre; nenhum segredo passa pela tela do painel.
  1. O painel cria a identidade pendente (Edge Function `computador-novo`, linha `pendente` em `computadores`, visível e
     revogável) e escolhe o aprovador, o computador onde a janela abre (`painel_ligacao_aprovador`, com a língua do
     painel). Mostra o comando do instalador e o código de acesso `rvzc_` (endereço, chave anon, e-mail e senha da
     identidade pendente). Esse código só deixa PEDIR: a identidade pendente só alcança `agente_ligacao_pedir` e
     `agente_ligacao_receber`, e `agente_registrar` a recusa até ela ler a chave entregue (menos a primeira identidade
     da instalação, antes de existir `cofre_impressao`, que cria a chave). Os códigos `rvzl_` e `rvzpc_` são recusados.
  2. O computador novo (`reveza ligar`, chamado pelo instalador `--ligar`) cria o par ECDH P-256 em memória e registra
     a chave pública: um pedido por computador, que não se troca (a mesma chave de novo devolve o mesmo pedido) e vence
     em 10 minutos. Mostra em letras grandes o código `XXXX-XXXX-YYYY` (símbolos de 32, sem 0/O/1/I): `XXXX-XXXX` são
     40 bits tirados do SHA-256 da chave pública esticado por scrypt (N=2^15, r=8, ~40 ms); `YYYY` são 20 bits sorteados
     (0.4.0), que não vão à nuvem nem ganham verificador lá. Espera a entrega consultando a nuvem.
  3. O agente do aprovador vê o pedido em `agente_ola.ligacoes`, toca o som e abre a janela (macOS `osascript`, Windows
     `InputBox`, Linux `zenity --entry`) que PEDE o código, sem mostrá-lo; o texto é fixo, só a língua vem da nuvem.
     Código errado pergunta de novo, e na terceira o pedido é recusado; Recusar recusa; sem resposta em 90 s o pedido
     segue aberto. `reveza ligar XXXX-XXXX-YYYY` faz o mesmo sem janela (servidor, VPS, SSH), em qualquer computador com a
     chave. Com a primeira parte certa, cifra `K` para a chave pública do pedido com a parte sorteada e entrega
     (`agente_ligacao_entregar`, que confere a mesma chave pública e deixa entregar uma vez). Um erro de digitação na
     parte sorteada só aparece no computador novo, que não abre o envelope e pede outro código.
  4. Um pedido por vez: dois abertos ao mesmo tempo são recusados pelo agente (e pela própria entrega, no banco), e
     um pedido que chega com a janela aberta anula o que se digitar nela (revisão de segurança de 11/10/2026).
  5. O computador novo lê o envelope uma vez (o banco o apaga), decifra com a chave privada e a parte sorteada,
     confere a impressão contra `cofre_impressao` e guarda `K` no chaveiro; só então se registra como computador. O
     painel acompanha por `ligacao_pedidos` (sem a chave pública e sem o envelope).
  O que um código vazado consegue: o `rvzc_` antes do uso deixa registrar uma chave pública no pedido (o computador
  verdadeiro então recebe erro, e quem libera não tem o código do intruso na tela); depois do uso, o pedido não aceita
  outra chave. Não abre o cofre nem vira computador ativo. Quem escreve direto no banco (dono do banco, chave de
  serviço):
  - não leva `K`: trocar a chave pública por uma dele com a mesma primeira parte pede 2^40 tentativas, cada uma com um
    scrypt, em 10 minutos. Vale mesmo para quem também vê a tela do computador novo;
  - não planta chave no computador novo: o envelope pede a parte sorteada, e o computador novo para no primeiro que não
    abre (1 chance em 2^20). Até a 0.3.x o código inteiro saía da chave pública, e esse escritor montava o envelope com
    uma chave dele e trocava junto a impressão (auditoria de segurança de 12/10/2026, rodada 3). Quem escreve no banco
    E vê a tela do computador novo ainda planta: por isso a tela pede para não mandar foto do código.
  - Um código todo sorteado, conferido por um verificador na nuvem, foi considerado e descartado: quem visse a tela e
    escrevesse no banco trocaria a chave pública e levaria `K`.
  A liberação sem perguntar (`reveza ligar --painel ligar`, 0.1.x) saiu: deixava a nuvem autorizar sozinha.
- Cadastro público desligado; entra só por convite (link de uso único, expira em 72 h).
- Troca de senha com reautenticação; "esqueci a senha" com redirecionamento só para o domínio do painel.
- Sessão: JWT de 1 h com renovação; lista de sessões e "sair de todas" (revoga os refresh tokens do usuário).
- Computador: usuário próprio do Auth, papel `computador`, senha aleatória longa no chaveiro do computador; revogar o
  computador = desativar esse usuário.
- Chaves de API pessoais (para script e n8n): prefixo visível, hash guardado, escopos (`ler`, `trocar`), revogáveis.

## 9. Painel

Menu lateral, nada empilhado numa tela só:
1. **Visão geral**: conta em uso por computador, ritmo, previsão, faixas de alerta.
2. **Contas**: lista, cor, prioridade, reserva, agenda, teto semanal, conectar (gera o pedido ao computador), entrar
   de novo, pausar, usar agora e remover. Desde a 0.20.2 a coluna **Projeto** (no lugar da prioridade, que segue em
   Editar e na ordem da lista) mostra os projetos de cada conta e o **Alocar**, que marca ou tira a conta de um projeto
   pela mesma `painel_unidades` da tela Projetos, só com `contas` (o subprojeto fica na tela Projetos, que mostra a
   herança). O remover (0.13.0, migração 0032) deixa a conta pausada por 10 minutos
   (`sai_em`) com o botão **Desfazer**; só depois o `vigiar` grava a marca em `contas_removidas` e apaga a conta, e cada
   computador apaga a cópia do login. A conta que, no ritmo da semana, acaba antes de renovar ganha o selo **Gastando
   rápido**. As barras de uso ficam âmbar dos 15 pontos antes do aviso até ele e vermelhas do aviso para cima.
3. **Computadores**: lista, sistema, versão, visto há, conta em uso, conta preferida, ligar computador novo (o código aparece nele e é
   digitado num computador que já usa o Reveza; o painel só acompanha), revogar; atualizações (a linha Nuvem e painel
   com o Atualizar a nuvem, seção 7e; Verificar atualização, Atualizar todos, como atualizar sozinho e o andamento,
   seção 7d).
4. **Uso**: custo equivalente (também em real, pela PTAX de venda do Banco Central, que a CSP libera), tokens (com o
   cache gravado e o relido separados), agentes, sessões por dia, conta, modelo, projeto e computador; leituras do
   período; mapa de calor; ranking; previsão de esgotar; exportar planilha; e o cartão para os stories (1080 x 1920, em
   JPG, desenhado no canvas do navegador com um número agregado e a marca reveza.ia.br). Os agentes são contados pela
   hora em que cada um começou (coluna `agentes` de `uso_tokens`, 0030): antes, o painel somava os agentes das sessões
   que começaram no período, e a sessão de editor fica aberta por semanas (em 30 dias, 1.089 agentes no lugar de
   1.615 no Mac do Paulo). As sessões são as com uso no período, também as que começaram antes.
4b. **Empresas** (0.17.0, migrações 0036 e 0037): o uso separado por empresa ou projeto. Cada conta pode ser marcada
   para uma ou mais empresas (sem marca, atende todas); cada pasta vai para uma empresa por regra (caminho: a pasta e
   tudo dentro; nome: qualquer pasta com esse nome no caminho; título: o agente do OpenBot cujo título ou nome tem o
   texto), e a regra mais específica ganha. A classificação é feita no painel, na leitura (`lib/empresas.ts`): o uso
   não guarda a empresa, então mudar uma regra reorganiza o passado e nada é apagado. A tela mostra custo, tokens,
   trocas, sessões, agentes, contas e pastas por empresa, por dia ou semana, a lista das pastas sem dono e o cadastro
   (com o transbordo: esperar, qualquer conta ou só as escolhidas). As trocas são contadas uma vez: o evento do agente
   leva `para_nuvem` (0.17.0), a decisão da nuvem (com `para` em uuid) fica de fora, e o evento antigo é lido pelo
   último e-mail de conta no texto. A pasta de cada uso é a raiz do repositório git (árvore de trabalho conta como o
   principal; submódulo é ele mesmo), relativa à pasta pessoal, até 300 caracteres. Desde a 0.18.0 a empresa pode
   **separar as contas** (seção 6b): o cadastro tem a chave, e cada empresa separada mostra a conta em uso em cada
   computador. Com a nuvem de antes da 0038, a chave some e o resto segue igual.
5. **Plano da semana** (até a 0.12.0): saiu do menu na 0.13.0. O ritmo da semana virou o selo **Gastando rápido** na tela
   Contas, e o endereço `/plano` abre Contas.
6. **Troca automática**: liga e desliga, modo (só no limite, limiar, rodízio), limiares, intervalo, ordem, agenda.
7. **Alertas**: canais (Telegram, e-mail, webhook, notificação no celular), quais eventos, botão de teste; e, por navegador, o aviso de troca de conta com notificação e som enquanto o painel está aberto.
   A folga acabando (0.13.0, migração 0032) avisa antes de faltar conta: com duas ou mais contas em atividade e no
   máximo uma abaixo do aviso, o `vigiar` grava o alerta com a conta que libera primeiro e a hora (no máximo um a cada
   6 horas), e a Visão geral mostra a mesma faixa.
   A troca que não firmou (0.4.5) é um desses eventos: o computador grava um erro com `motivo: troca_falhou` e os ids
   das contas quando a troca não firma depois de 3 tentativas, ou quando a conta que a nuvem atribuiu não entra há 5
   minutos e 3 buscas; um gatilho da nuvem (migração 0023) lê só os ids e escreve o alerta com o nome do computador e
   os e-mails das tabelas dela, no máximo um por computador por hora.
8. **Integrações**: chaves de API, webhooks de saída, exemplos prontos (n8n, curl, script).
9. **Time**: membros, papéis, convites, auditoria.
10. **Minha conta**: senha, verificação em duas etapas, sessões abertas, idioma.
11. **Como funciona**: diagrama animado do caminho (login oficial no computador, cofre cifrado, nuvem decide,
    computador troca) e da regra de alternar, com exemplos.
12. **Saúde**: o resultado do `doctor` de cada computador, atraso da busca, versão.

Modo demonstração: `?demo=1` ou instalação `--demo` liga dados de exemplo gerados no próprio navegador, sem nuvem.

## 10. Instalador (no padrão do Claquete)

`npx github:<dono>/reveza` com `--atualizar`, `--desinstalar`, `--sem-nuvem`, `--demo`, `--doctor`, `--dominio`, `--ajuda`
(e, para uso do agente, `--publicar-nuvem`, 7e).
Passos: conferência do sistema, agente e mod, ligar a uma instalação que já existe (só computador novo com o código do
painel), nuvem (token do Supabase, cria o projeto, aplica o banco e as funções, cria o administrador com verificação em
duas etapas, cria a identidade do computador e a chave do cofre; o token da Vercel é pedido aqui também), serviço,
painel (publica, cabeçalhos; domínio: subdomínio próprio com o passo a passo na Cloudflare, ou o da Vercel; interface:
React Bits grátis baixado, o repositório não traz código do React Bits), contas (login oficial de cada uma), alertas
(canal escolhido, mensagem de teste), prova final (`doctor` e um comando do painel chegando ao computador).

As etapas são numeradas de 1 a N só com as que rodam naquele caminho (`instalador/lib/etapas.mjs`): computador ligado,
atualização e `--sem-nuvem` têm menos etapas, sem número pulado. Numa atualização com nuvem, deixar o token do Supabase
em branco mantém a nuvem e o painel como estão, e as etapas seguintes saem com o total novo.

A troca automática não é pergunta: a instalação nova grava ligada, antes do limite (avisa em 90%, troca em 95%), na
nuvem ou, com `--sem-nuvem`, no estado local; muda no painel. Atualizar, ligar e `--importar` não gravam troca (fica a
que já vale; o `--com-nuvem` leva para a nuvem a do estado local). O banco nasce com a troca desligada; quem a liga é o
instalador.

Domínio do painel: sem escolher, o endereço gratuito da Vercel (`<projeto>.vercel.app`, com HTTPS). `--dominio
<subdomínio>` liga ou troca o domínio (na instalação sem pergunta; no `--atualizar`, com os tokens) e `--dominio vercel`
volta ao endereço da Vercel; `REVEZA_DOMINIO` continua valendo. O passo a passo do registro é neutro de provedor, com a
dica da Cloudflare (proxy desligado) como observação.

No fim da instalação (e do `--atualizar` com os tokens), a oferta da atualização completa (7e), padrão não; com `--sim`
ou sem terminal, fica desligada. Depois de publicar, o instalador grava na nuvem `nuvem_versao`, `publicado` e
`painel_publicacao`.

Na hora de pedir cada token, o instalador abre a página de criá-lo (`open`, `xdg-open` ou `explorer.exe`), só com
tela e pergunta: nunca com `--sim` ou sem terminal, por SSH sem tela, ou com o token já no ambiente; numa atualização,
em que o token do Supabase é opcional, essa página não abre. Falhar ao abrir não para nada: o endereço fica impresso.

**Idioma.** O instalador pergunta o idioma no primeiro passo (português ou inglês) e o grava em
`~/.reveza/instalacao.json` (campo `idioma`); `--idioma pt|en` pula a pergunta. O agente lê esse campo a cada execução, e
o mod lê pelo caminho absoluto: os dois falam o idioma escolhido na instalação. No painel o idioma é de cada pessoa:
fica no navegador (localStorage) e na conta dela (`membros.idioma`), e não muda o de ninguém.

## 11. Segurança do painel publicado

CSP restrita (`script-src 'self'`, `connect-src` só o Supabase da instalação), HSTS, `frame-ancestors 'none'`,
Permissions-Policy, um domínio só (o `*.vercel.app` redireciona), limite de tentativas no login (o do Supabase e,
se a pessoa usar a Cloudflare na frente, uma regra de limite de taxa e o Turnstile), nada de mapa de código no ar.

## 12. Fora do repositório

Credenciais de qualquer tipo (o pre-commit recusa), código do React Bits, e-mails e dados de qualquer conta real.
