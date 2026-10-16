# Versões

Formato: [versão semântica](https://semver.org/lang/pt-BR/). A versão de cada entrega fica no `package.json`, na tag do
Git (`vX.Y.Z`) e na página de versões do GitHub, sempre iguais.

- **X.0.0**: mudança grande, que pode exigir reinstalar ou mudar o jeito de usar.
- **X.Y.0**: melhoria ou recurso novo que não quebra nada.
- **X.Y.Z**: correção.

## 0.8.0 · 15/10/2026

A versão do assistente de código (o Claude Code) em cada computador, no painel, e a escolha de como ele se atualiza.
Veio de um caso real: dois computadores da mesma instalação em versões diferentes do assistente. Precisa da nuvem
atualizada (migração 0027: a nuvem se atualiza sozinha, ou pelo **Atualizar a nuvem**) e dos computadores na 0.8.0
(pelo painel, ou com `npx github:dantaspaulo/reveza --atualizar` em cada um).

- **Cartão Assistente de código** em **Computadores**: a versão de cada computador lado a lado, qual é a mais nova
  entre eles e quem está atrás, o **Atualizar** de cada um e o **Atualizar os atrasados**. Sessões abertas seguem na
  versão em que começaram; a nova vale nas próximas. Computador com o agente de antes da 0.8.0 mostra a versão, mas só
  atualiza pelo painel depois de atualizar o agente.
- **Como o assistente se atualiza**, para a instalação toda:
  - **Do jeito do assistente** (o padrão): o Reveza não mexe, como antes.
  - **Sempre a mais nova**: cada computador roda a atualização do assistente a cada 6 horas, num momento calmo, mesmo
    sem sessão aberta. Mantém todos na mesma versão.
  - **Só pelo painel**: o Reveza desliga a atualização automática do assistente (`DISABLE_AUTOUPDATER` no
    `~/.claude/settings.json`) e a versão só muda pelo **Atualizar**. Serve para segurar todos numa versão que funciona.
- **O que é seu fica:** um `DISABLE_AUTOUPDATER` (ou `DISABLE_UPDATES`) que você escreveu à mão não é tocado, e o painel
  avisa que a atualização automática foi desligada à mão naquele computador. A desinstalação devolve o que o Reveza
  desligou (`reveza assistente liberar`).
- **Se a atualização falhar** (sem rede, ou instalação pelo apt, dnf ou apk, que precisa de root), o painel mostra o
  erro na linha do computador.

## 0.7.1 · 15/10/2026

Correção do alerta de segurança do GitHub sobre o pacote `braces` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)):
padrões muito aninhados estouram a pilha e derrubam o processo Node. Não há versão corrigida do `braces`, então ele
saiu do painel. Nada muda no que se vê: o painel construído sai idêntico, arquivo por arquivo. Chega na próxima vez que
o painel for publicado (com a atualização completa ligada, sozinho; ou com `npx github:dantaspaulo/reveza --atualizar`
no computador que criou a instalação).

- **Painel sem a linha de comando do shadcn/ui:** ela só entrava na instalação por um arquivo de CSS (variantes e
  utilitários), e trazia mais 250 pacotes, entre eles o `braces`. O CSS foi copiado sem mudança para
  `painel/src/shadcn-tailwind.css`, com a licença MIT. A instalação do painel fica mais leve.
- **O código vulnerável nunca rodava no Reveza:** o `braces` só era usado por essa linha de comando, que nem o
  instalador nem o painel executam. O alerta era de pacote instalado, não de falha alcançável.
- **Teste novo** (`painel/src/dependencias.test.ts`): recusa a linha de comando do shadcn de volta nas dependências e
  qualquer `braces` até a 3.0.3 no `package-lock.json` do painel.

## 0.7.0 · 15/10/2026

O Reveza AI em inglês, contribuição de [@andrefrd](https://github.com/andrefrd) ([#3](https://github.com/dantaspaulo/reveza/pull/3)).
O instalador pergunta o idioma logo no começo e a escolha vale para o agente, os comandos do Claude Code e os alertas
da nuvem; o painel segue o idioma do aparelho. Quem já usa continua em português. Atualize os computadores pelo painel
(ou com `npx github:dantaspaulo/reveza --atualizar` em cada um); a nuvem se atualiza sozinha (ou pelo **Atualizar a
nuvem**).

- **Idioma no primeiro passo do instalador:** português ou inglês, com a sugestão pelo idioma do terminal.
  `--idioma pt|en` pula a pergunta; com `--sim` (ou sem terminal) fica em português, salvo `--idioma en`. A escolha fica
  gravada na instalação. Quem já usa o Reveza e atualiza pelo terminal ouve a pergunta uma vez; pela atualização do
  painel, segue em português sem pergunta.
- **Agente e Claude Code:** a linha de comando, o `doctor`, a linha de status, os avisos, o `/reveza` e a retomada da
  sessão falam o idioma da instalação.
- **Alertas pelos canais** (celular, e-mail, Telegram, webhook) no idioma da instalação: vale o do último computador
  que atualizou a nuvem.
- **Painel:** sem escolha feita, segue o primeiro idioma do aparelho. O aviso do celular que chega sem texto segue a
  mesma regra.
- **Documentação em inglês:** `README.en.md` e `docs/ARQUITETURA.en.md`, com o seletor de idioma no topo.
- **Só as 2 cópias mais novas:** antes de atualizar, o instalador guarda uma cópia do estado em `~/.reveza/copias`.
  Ficavam 5, de dezenas de MB cada; agora ficam as 2 mais novas.
- **Ainda em português:** algumas mensagens de erro do agente, como as de quando o download de uma atualização falha
  ou o chaveiro não responde. Ficam para a próxima passada de tradução.

## 0.6.3 · 15/10/2026

Painel sem o aviso **Neste navegador**. Era o único aviso que dependia da aba aberta, e passava a impressão de que a
vigilância dos computadores dependia do navegador. Não depende: o serviço de cada computador troca de conta sozinho e
conversa com a nuvem, e a nuvem manda todos os alertas com o painel fechado. Só o painel muda; os computadores não
mudam nesta versão. Para receber: em **Computadores → Atualizações**, **Atualizar a nuvem** e depois publicar o painel,
sozinho com a atualização completa ligada ou com `npx github:dantaspaulo/reveza --atualizar` no computador que criou a
instalação (o painel mostra o passo).

- **Saiu o cartão Neste navegador** (em Alertas e em Minha conta) e o vigia que, com a aba aberta, transformava cada
  troca em notificação e sinal sonoro. O painel aberto não dispara mais nenhum aviso por conta própria.
- **Para ser avisado de cada troca:** em **Alertas**, num canal da nuvem (no celular, por e-mail, Telegram ou webhook),
  marque **Cada troca de conta**. Chega com o painel fechado.
- A tela de Alertas passa a dizer que os avisos chegam mesmo com o painel fechado. O botão de testar notificação em
  **Minha conta → Este aparelho** continua.

## 0.6.2 · 15/10/2026

Painel com a economia de memória do navegador (relato de usuário: com o Chrome no máximo de economia de memória, o
painel "fica desconectando"). Só o painel muda; os computadores não mudam nesta versão. Para receber: em
**Computadores → Atualizações**, **Atualizar a nuvem** e depois publicar o painel, sozinho com a atualização completa
ligada ou com `npx github:dantaspaulo/reveza --atualizar` no computador que criou a instalação (o painel mostra o passo).

- **Fechar o painel não para o Reveza.** O serviço de cada computador troca de conta sozinho, e a nuvem vigia os
  computadores e manda os alertas (no celular, por e-mail, Telegram ou webhook) com o painel fechado. Só o aviso
  **Neste navegador** depende da aba aberta, e o cartão dele passa a dizer isso.
- **O que estava errado:** o Chrome e o Edge, para poupar memória, pausam a aba parada ou a descartam e recarregam
  quando se volta a ela. Na aba pausada, a conexão em tempo real morria sem aviso e o cabeçalho seguia dizendo "ao
  vivo". Ao voltar, o relógio da tela andava antes de chegar a leitura nova, e computadores ligados apareciam por um
  instante como **parados**.
- **Agora:** quando a aba volta (retomada, restaurada do cache, visível de novo ou com a rede de volta), o painel relê
  tudo na hora e refaz a conexão em tempo real. O cabeçalho só diz "ao vivo" com leitura recente; com leitura velha ou
  falha na última, mostra **reconectando…** em âmbar, com a hora da última leitura.
- **Computador ligado não pisca como parado:** o estado de cada computador (e as faixas de alerta do topo) passa a
  contar o tempo a partir da última leitura, com 20 s de folga, e não do relógio da tela. A cegueira do painel não vira
  computador parado; quem já estava parado ou atrasado na leitura continua assim.
- **Aba recarregada pelo navegador:** quando o navegador descartou a aba para poupar memória, o painel avisa uma vez e
  explica como deixar o painel sempre ativo nas opções de desempenho do navegador. O **Entendi** guarda a escolha.
- **README:** "Painel fechado", no dia a dia, em português e em inglês.

## 0.6.1 · 14/10/2026

Duas correções de uma contribuição: Kaio Henrique (pilotaimoveis) achou as falhas num computador com WSL e mandou os
PRs #1 e #2. Atualize os computadores pelo painel; a nuvem não muda nesta versão.

- **Login no WSL:** o login pela tela do Reveza abre a janela anônima do navegador do Windows, e o WSL deixa de contar
  como Linux sem tela. Os discos do Windows saem da tabela de montagens do próprio WSL (WSL 1 e 2, qualquer letra) e do
  `root` do `[automount]` no `/etc/wsl.conf`, em vez de um `/mnt/c` fixo: quem mudou a pasta dos discos ou instalou o
  navegador em outro disco também é atendido. Sem navegador achado, vale o `explorer.exe` do Windows. A mensagem só diz
  que abriu quando o navegador abriu de fato: um Linux sem `xdg-open`, ou um WSL com a ponte para o Windows desligada,
  passa a ouvir que não deu para abrir, em vez de um "abri" que não aconteceu.
- **Computador sem `instalacao.json` volta a se atualizar:** o instalador só gravava esse arquivo no último passo, e
  uma instalação que parava depois de subir o agente deixava o computador funcionando e o **Atualizar** do painel
  recusando para sempre ("não há instalação para atualizar"). Agora o instalador grava o arquivo logo depois de subir
  o serviço, e de novo no fim. E, quando o arquivo falta, o instalador reconhece a instalação pelo que ela deixou no
  disco (o `ponte.json` que o agente grava ao subir e o comando `reveza`, que aponta para o programa) e pergunta ao
  programa novo o resto: se há serviço e se o gerenciador de serviços responde, o modo sombra e o endereço da nuvem
  (só o endereço e a chave pública, nada de segredo). Atualiza só o programa daquele computador, sem mexer na nuvem nem
  no painel. Como quem reconhece é o instalador, e todo agente chama o instalador novo no Atualizar, o computador que
  já está com a recusa também se atualiza por esta versão, venha de qual versão vier.
- **WSL sem systemd:** a unidade do serviço existe no disco, mas nunca roda. O instalador passa a perguntar se o
  gerenciador responde e, se não responde, segue sem serviço, em vez de instalar um serviço que derrubaria a
  atualização depois de 30 s.
- **O que muda junto:** uma instalação nova que parar depois de subir o serviço e for rodada de novo continua como
  atualização da mesma nuvem, em vez de criar outra. Os passos de contas e alertas, que só rodam na instalação nova,
  não se repetem nesse caso. Sem `ponte.json` nem programa no disco, a recusa de antes continua: não há o que atualizar.
- **Para quem contribui:** `reveza servico status --json` passa a dizer se o gerenciador de serviços respondeu e o modo
  sombra, e `reveza nuvem identidade` mostra o endereço da nuvem e a chave pública do computador.

## 0.6.0 · 13/10/2026

Modelo de cada conta e saída enxuta. Um usuário pediu para escolher no painel o modelo que cada conta usa e para ligar
ou desligar, por computador, a saída mais curta dos comandos de leitura. Atualize os computadores pelo painel; a nuvem
se atualiza sozinha (ou pelo **Atualizar a nuvem**). Os campos novos só valem nos computadores com o agente 0.6.0.

- **Modelo de cada conta:** em **Contas**, ao editar uma conta, o campo **Modelo do assistente** (`opus`, `sonnet`,
  `haiku`, `opusplan` ou outro nome, como no `/model`; `[1m]` no fim pede a janela de 1M). Quando um computador passa
  para a conta, o agente grava o modelo na chave `model` do `~/.claude/settings.json`; as sessões abertas depois
  começam nele. Mudar o modelo de uma conta no painel vale na hora para os computadores que estão nela. Quem trocar
  pelo `/model` fica com o seu até a próxima troca de conta. **Não mexer** (o padrão): o agente devolve o valor de
  antes, se foi ele que mudou, e senão não toca na chave. A gravação é atômica e só mexe nessa chave.
- **Saída enxuta:** em **Computadores**, a chave **Saída enxuta** de cada computador, desligada de fábrica. Ligada, o
  mod encurta o stdout de `git status`, `git diff` e `git show`, `ls`, `find`, `grep`, `rg` e `tree`: tira as dicas do
  `git status`, a linha `index` do diff, o `total` e o `.` e `..` do `ls -l`, junta embaixo do nome as linhas do mesmo
  arquivo no `grep` e no `find`, e corta listagem acima de 300 linhas (e arquivo de diff acima de 200) com aviso de
  quantas saíram. Comando com pipe, `;`, outro `&&` ou redirecionamento passa inteiro, por isso `| cat` no fim mostra
  tudo; formato de máquina e stderr ficam como vieram; erro no enxugar devolve a saída original. Medido em 13/10/2026,
  em 13 comandos de leitura em três repositórios de verdade: 34% menos texto no total (119.800 para 79.333
  caracteres), com `git status` de 51% a 59%, `find` com subpastas 48%, `grep -rn` de 17% a 20%, `ls -la` de 6% a 14%
  e `git diff` de 1% a 3%.
- **Nuvem:** migração 0025 (`contas.modelo`, com o formato conferido no banco; `computadores.enxugar`; a função
  `painel_computador_enxugar`; o `agente_ola` passa a levar o modelo da conta e a chave do computador). O painel só
  manda o modelo quando ele mudou, então editar conta numa nuvem ainda sem a 0025 continua funcionando.
- **Versão do mod:** o `plugin.json` do mod passa a andar com a versão do Reveza.

## 0.5.0 · 13/10/2026

Conta preferida de cada computador. Um usuário com uma conta de plano maior (20x) pediu para deixá-la como padrão no
computador principal: até aqui, a ordem das contas valia igual para todos os computadores, e a conta maior caía em
qualquer um. Atualize os computadores pelo painel; a nuvem se atualiza sozinha (ou pelo **Atualizar a nuvem**).

- **Onde escolher:** em **Computadores**, no cartão de cada computador, o campo **Conta preferida**. Uma conta é
  preferida de um computador só. Se ela estiver livre na hora, o computador já passa para ela.
- **Como a troca automática usa:** para o computador dono, a preferida vem antes de todas as outras (com as mesmas
  regras: livre, com login, dentro da agenda e abaixo do aviso). Quando ela fica livre de novo, ele volta para ela,
  depois da espera entre trocas. Troca pedida à mão pelo painel ou pela API não é desfeita: fica até a próxima troca
  da regra. No rodízio, o computador que está na preferida fica nela. No limite, troca como qualquer outra conta.
- **Os outros computadores:** enquanto o dono está ligado, a preferida dele vem depois das demais (só entra se não
  houver outra). Se outro computador estiver com ela e o dono ligado sem ela, o outro devolve e pega a melhor que
  sobrar, nunca uma reserva nem a preferida de um terceiro. Sem outra para pegar, fica como está. Com o dono fora do
  ar, ela volta à fila normal.
- **Histórico e Como funciona:** os motivos novos ("conta preferida deste computador" e "devolvendo a conta preferida
  de outro computador") aparecem traduzidos, e o simulador do Como funciona mostra a preferida na ordem.
- **Computador revogado** solta a preferida dele.

## 0.4.6 · 13/10/2026

Correção preventiva na atualização da nuvem. Três regras antigas do banco guardavam listas desatualizadas das opções de
configuração e dos tipos de alerta. Se uma delas precisasse rodar de novo numa nuvem em uso, a atualização da nuvem
pararia no meio e voltaria atrás sem atualizar. Até aqui isso não aconteceu: essas regras não tinham mudado. Atualize
os computadores pelo painel; a nuvem se atualiza sozinha (ou pelo **Atualizar a nuvem**) e, desta vez, roda de novo as
regras corrigidas.

- **Listas completas:** as três regras passam a ter as mesmas listas da regra mais nova, então rodar qualquer uma de novo
  aceita as configurações e os alertas que já existem.
- **Teste novo:** monta um banco com uma linha para cada valor que cada lista aceita, roda de novo, duas vezes e em
  ordem, todas as regras que a atualização pode rodar, e confere que nenhuma falha e que nenhum dado muda. Lista nova
  que o teste não sabe povoar faz o teste falhar, para não passar sem ser coberta.

## 0.4.5 · 13/10/2026

Troca de conta que não firmou vira alerta. Um usuário perguntou se o Reveza avisa quando a troca falha ou se segue sem
registro: até aqui, a falha ficava só nos eventos do painel. Agora ela sai pelos canais de alerta, como a falta de conta
livre. Atualize os computadores pelo painel: a nuvem se atualiza sozinha (ou pelo **Atualizar a nuvem**).

- **Alerta "Troca de conta que não firmou":** Telegram, e-mail, webhook e notificação no celular. O texto é escrito pela
  nuvem, com o nome do computador e os e-mails que ela conhece ("No computador X, a troca para Y não firmou: a conta em
  uso continua Z"); o que o computador escreve nunca vai para fora. No máximo um aviso por computador por hora.
- **Quando o computador avisa:** a troca não firmou depois de 3 tentativas (uma sessão regravou a conta antiga), ou a
  conta que a nuvem escolheu não entra há 5 minutos e 3 buscas (cofre vazio, posse recusada, credencial que não se
  grava). A mesma conta que não entra avisa uma vez; volta a avisar depois de uma troca que dá certo ou de a nuvem
  escolher outra conta.
- **Canais que já existem:** quem recebe "Sem conta livre" passa a receber também a troca que não firmou (só na
  atualização; tirar pelo painel vale para sempre). Canal novo já vem com ela marcada.
- **Webhooks:** a lista de eventos mostra só o que a nuvem manda de fato. "Aviso" e "Conexão" saíram (eram eventos do
  computador e nunca saíam); entraram "Troca que não firmou" e "Atualização parou". Webhook antigo que tenha os dois
  continua mostrando o nome.

## 0.4.4 · 13/10/2026

Os testes não deixam mais pastas na pasta temporária do computador. Em 13/10, com o disco do Mac mini quase cheio,
havia mais de mil pastas `reveza-*` deixadas por rodadas de teste e de ensaio. Só quem roda os testes do projeto é
afetado; o agente instalado não muda.

- **Testes do agente:** cada rodada usa uma pasta temporária só dela, apagada no fim, mesmo quando um teste esquece de
  limpar o que criou.
- **Teste de instalação de ponta a ponta:** as casas de teste (uns 40 MB cada, com o painel compilado) são apagadas no
  fim. `--manter` guarda as duas para olhar depois de uma falha.
- **Ensaio:** a pasta do ensaio era deixada para trás quando a criação do gist falhava.

## 0.4.3 · 13/10/2026

Problema no computador visto pelo painel, na hora (pedido do Paulo: acompanhar o Mac mini e o MacBook enquanto
funcionam). Em 13/10 o disco de um computador encheu por alguns minutos e o erro só ficou no log local. Atualize os
computadores pelo painel.

- **Erro do agente no painel:** o que o agente escreve como erro no log (disco cheio, arquivo que não se grava) também
  vai para os eventos, sem a pasta do usuário. O mesmo erro sobe uma vez a cada 30 minutos (números e nomes de arquivo
  temporário não contam como erro novo) e no máximo 10 por hora por computador.
- **O texto do erro aparece:** os eventos de erro mostravam só "Erro em <computador>"; agora mostram o que deu errado.
- **Disco no diagnóstico:** o `reveza doctor` e a tela Saúde conferem o espaço livre. Abaixo de 5 GB é aviso; abaixo de
  2 GB é falha, porque com o disco cheio o agente não grava o estado nem o uso das contas, e o assistente de código
  também para.
- **Gravação que falha não deixa lixo:** o arquivo temporário de uma gravação que não terminou (disco cheio no meio) é
  apagado, em vez de ficar ao lado do arquivo.

## 0.4.2 · 13/10/2026

Sessão que trava com "Prompt is too long" (pedido do Paulo, depois de duas sessões travadas no MacBook em 12 e 13/10).
Atualize os computadores pelo painel; o mod das sessões vai junto.

- **Resumo da conversa:** nas contas que não são 20x, o agente deixa o Claude Code resumir a conversa perto de 180 mil
  tokens. O automático dele, no Opus 5.5, é 1 milhão: uma sessão de dias chegou a 615 mil, travou e nem o `/compact`
  resolvia, porque para resumir ele manda a conversa inteira. Cada mensagem também manda a conversa inteira, então
  conversa menor faz a conta durar mais. Nas contas de 20x fica o automático. O valor acompanha a conta a cada troca.
- **No terminal:** `reveza resumo` mostra; `reveza resumo 300k` muda; `reveza resumo desligar` devolve o automático.
  Um `/autocompact` seu vale por cima, e um valor que você pôs à mão no settings.json o agente não mexe.
- **Sessão que travou:** o mod mostra como sair (`/rewind`, voltar algumas mensagens, `/compact`) e o tamanho da
  conversa fica nos eventos do painel, para saber por que travou.

## 0.4.1 · 13/10/2026

Sessão que trava com "prompt is too long" (relato do Paulo, 13/10/2026). Atualize os computadores pelo painel; o mod das
sessões vai junto.

- **O que acontece:** numa conta de equipe sem uso extra liberado, a conversa que passa de 200 mil tokens precisa de
  crédito para o contexto de 1 milhão. O Claude Code recusa com "Usage credits required for 1M context" e chama esse
  erro de `rate_limit`, o mesmo nome do limite de uso. O mod do Reveza entendia como limite da conta: marcava a conta
  como esgotada, trocava de conta à toa e mandava a sessão continuar, que batia no mesmo erro.
- **Agora:** o mod só avisa o agente quando é limite de uso de verdade ("You've hit your session limit", "weekly
  limit", "spend limit"). O erro do contexto de 1 milhão mostra o que fazer: `/compact`, ou outra sessão; trocar de
  conta não resolve. O 429 momentâneo ("this may be a temporary capacity issue") também não troca de conta.
- **Sessão que já travou:** rode `/compact`. Se ele também recusar, volte a uma mensagem anterior (Esc duas vezes) e
  rode `/compact` dali, ou comece outra sessão.

## 0.4.0 · 13/10/2026

Ligar um computador novo com um código que tem uma parte secreta. Sem mudança no banco: atualize os computadores pelo
botão do painel (Computadores → Atualizar) antes de ligar um computador novo.

- **Por quê:** a auditoria de segurança de 12/10/2026 (rodada 3) deixou um ponto em aberto. O código que aparece no
  computador novo saía inteiro da chave pública dele, que fica na nuvem. Quem escreve direto no banco (o dono do banco,
  ou quem tivesse a chave de serviço do Supabase) podia montar a entrega com uma chave do cofre DELE e trocar junto a
  impressão da instalação: o computador novo adotava essa chave e passava a mandar os logins cifrados com ela.
- **Agora o código tem 12 caracteres, `XXXX-XXXX-YYYY`.** Os 8 primeiros continuam saindo da chave pública: quem
  libera confere que vai entregar para o computador certo. Os 4 últimos são sorteados no computador novo, não vão à
  nuvem e entram na cifra da entrega: sem eles, ninguém monta uma entrega que o computador novo aceite, nem o banco.
- **No computador novo:** o código aparece em duas linhas de letras grandes. Não mande foto dele para ninguém: os 4
  últimos são o segredo.
- **No computador que libera:** a janela pede os 12 caracteres (`reveza ligar XXXX-XXXX-YYYY` sem tela). Ele precisa
  estar na 0.4.0; o painel só oferece esses e avisa quais atualizar. Um computador novo com o Reveza antigo (código de
  8) recebe a mensagem para instalar de novo.
- Dois testes que só quebravam no Windows ou com a variável do Supabase no ambiente (o do patch do ensaio e o da CSP
  do painel) passam em qualquer lugar.

## 0.3.4 · 12/10/2026

Conectar conta sem cair na conta errada e sem código para colar. A 0.3.3 explicava o atalho da janela anônima; esta
versão faz o computador abrir a janela anônima ele mesmo. Atualize os computadores pelo botão do painel; o painel novo
entra pela atualização da nuvem.

- **O que estava errado:** o Claude Code abre dois caminhos de login ao mesmo tempo. O navegador do computador recebe
  um endereço que termina sozinho; a tela mostra outro, que dá um código para colar. O navegador abria no perfil que
  estivesse aberto (com vários perfis do Chrome, na conta errada), e o painel mostrava o endereço do código.
- **Agora:** o computador abre o login numa **janela anônima** (Chrome, Edge, Brave, Chromium ou Firefox, o primeiro
  que tiver). Nela não há conta aberta: é o "sair e limpar antes" sem mexer no navegador de todo dia. Entrou na conta,
  o login termina sozinho, sem código.
- **No painel:** aparece onde o login abriu ("numa janela anônima do Google Chrome no computador X"). O endereço com
  código continua lá para quem está em outro aparelho.
- **No terminal:** `reveza contas conectar <e-mail>` diz o mesmo e aceita o código ali, para outro aparelho.
- **No Windows** o login segue abrindo no navegador padrão, e a conta pedida continua conferida no fim. Em Linux sem
  tela, o painel avisa que não deu para abrir e o login segue pelo código.

## 0.3.3 · 12/10/2026

Conectar conta quando o navegador não abre (relato de usuário: "diz que abriu e não abriu"). Atualize os computadores
pelo botão do painel; o painel novo entra pela atualização da nuvem.

- **O link do login volta a aparecer no painel.** O Claude Code passou a abrir o login em `claude.com` (antes,
  `claude.ai`), e o painel jogava esse endereço fora: aparecia "o computador abriu o login no navegador dele" sem nenhum
  botão. Agora aparecem **Abrir o login**, **Copiar o endereço** e o campo para colar o código que a página mostra.
- **Janela anônima:** o painel e o terminal explicam que, com outra conta já aberta no navegador (ou vários perfis do
  Chrome), o login entra na conta errada ou nem aparece; numa janela anônima não há conta aberta.
- **Pelo terminal:** `reveza contas conectar <e-mail>` mostra o endereço logo de cara e aceita o código da página ali
  mesmo (antes, só esperava o navegador).
- O painel não diz mais que o navegador abriu antes de saber.

## 0.3.2 · 12/10/2026

Correções da auditoria de segurança da 0.2.0 à 0.3.1 (skill da Cloudflare, rodada 3). Traz uma mudança pequena no banco:
a nuvem se atualiza sozinha (ou pelo Atualizar a nuvem do painel); os computadores, depois dela.

- **Atualização do banco:** quando uma migração antiga muda, as seguintes rodam de novo junto. Na subida da 0.3.0 para
  a 0.3.1 só a 0020 rodou, e uma função voltou ao corpo antigo (a vez de atualizar perdia o portão da publicação, que só
  vale com a atualização completa ligada). Esta versão devolve o corpo certo.
- **Instalador mais velho que a nuvem** não mexe mais nela nem no painel (antes, voltava migrações para trás).
- **Chave do cofre:** a impressão da chave é conferida a cada busca; um computador com chave diferente da instalação
  para de mandar login para o cofre e avisa. `reveza cofre iniciar` que perde a corrida para outro computador apaga a
  chave recém-criada.
- **Publicação automática:** sem ninguém olhando, o painel não troca o domínio próprio pelo endereço da Vercel quando o
  DNS não responde na hora; guardar os tokens de novo ou desligar não tira a vez de quem está publicando.
- **Revogar computador** com a atualização completa ligada avisa para trocar os tokens do Supabase e da Vercel.
- **Downloads da atualização** (nuvem e agente): só do repositório oficial, com o limite de tamanho valendo enquanto o
  pacote chega, e pacote com cabeçalho estragado recusado (um tamanho negativo travava o agente).
- **Windows e pastas com espaço ou acento:** seis scripts saíam calados sem fazer nada (inclusive o que gera os
  cabeçalhos de segurança do painel e as travas contra publicar segredo ou código do React Bits). Agora rodam.
- Para quem desenvolve: o ensaio do CI lê a mudança do evento (antes ela aparecia no log público).

## 0.3.1 · 12/10/2026

Correções da revisão de código da 0.2.1 e da 0.3.0. Traz uma mudança pequena no banco (a nuvem se atualiza sozinha, ou
pelo Atualizar a nuvem do painel); os computadores, pelo botão ou sozinhos, depois dela.

- **Trava de compatibilidade mais justa:** o computador compara também o conteúdo das migrações (o resumo), não só o
  nome. Uma versão que só muda as permissões (0099) ou uma função já não passa antes de a nuvem chegar nela.
- **Mudar "Atualizar sozinho" no meio de uma atualização** não tira mais a vez do computador que está atualizando
  (antes podiam ficar dois ao mesmo tempo, e a volta para a versão anterior não parava os outros).
- **Atualização sozinha parada** (um computador voltou para a anterior): o painel mostra "parada" e um botão Retomar,
  em vez de "esperando a vez" para sempre.
- **Verificar atualização** sem acesso ao GitHub diz que não deu para conferir, em vez de "Todos na versão mais nova".
- **Atualizar a nuvem** sem as duas etapas leva para a tela das duas etapas (antes, só um aviso genérico de falha).
- **Nuvem e painel:** uma atualização da nuvem que caiu no meio aparece como interrompida (o botão volta), em vez de
  girar para sempre ou mostrar "em dia" na versão antiga.
- **Salvar a tela Troca** grava só o que se mexeu nela: um rascunho antigo não volta mais o "Atualizar sozinho" (nem
  outro campo) que outra aba mudou.
- **Atualização completa:** no prazo, o build e a publicação que o instalador abriu morrem junto; e um segundo
  instalador no mesmo computador espera o primeiro em vez de publicar junto.
- **Windows:** as migrações (`.sql`) ficam sempre com fim de linha LF no clone (`.gitattributes`), e o resumo delas
  não depende mais do fim de linha: uma nuvem instalada de um clone no Windows não trava a atualização sozinha.
- **Domínio do painel:** `--dominio` aceita o ponto final (`contas.x.com.`) e acento (vira punycode).
- Para quem desenvolve: o ensaio (`node scripts/ensaio.mjs`) acha a própria execução no GitHub pelo id, leva arquivo
  binário no patch, manda mudança pequena sem gist, funciona em pasta com espaço ou acento e em worktree; o pre-push só
  aceita o ensaio da árvore de antes para o commit de versão; os scripts de versão usam o repositório do `origin`.

## 0.3.0 · 12/10/2026

A nuvem e o painel também se atualizam sozinhos. Esta versão traz mudança no banco e uma função nova da nuvem: atualize
UMA vez o computador que criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.3.0.tar.gz --atualizar`
(com os tokens do Supabase e da Vercel); depois disso a nuvem se atualiza pelo painel, sem token, e os outros
computadores pelo botão.

- **Atualizar a nuvem** (Computadores → Atualizações → Nuvem e painel): a própria nuvem baixa a versão oficial mais
  nova e aplica só as migrações que faltam, cada uma inteira ou nada, sem guardar token nenhum. A linha mostra a versão
  da nuvem, das funções e do painel, e em que pé estão.
- **Na ordem, inclusive sozinho:** Atualizar sozinho (Desligada, De madrugada, Assim que sair) vale também para a
  nuvem: nuvem, depois funções e painel, depois os computadores. Um passo que falha para os seguintes, aparece no painel
  e manda o alerta "Atualização sozinha parou".
- **Atualização completa (opcional, desligada de fábrica):** `reveza atualizacao-completa ligar` guarda os tokens do
  Supabase e da Vercel na nuvem cifrados com a chave do cofre (a nuvem não consegue ler), e um computador da instalação
  publica sozinho as funções e o painel novos. Quem tem um computador da instalação passa a ter esses tokens: use
  tokens de alcance curto e com validade. Desliga com `reveza atualizacao-completa desligar` ou no painel. O fim da
  instalação oferece (padrão: não).
- Sem a atualização completa, o painel mostra o passo manual só quando a versão mexe nas funções ou no painel.
- **Domínio do painel:** `--dominio contas.meudominio.com` põe ou troca o subdomínio (na instalação ou no
  `--atualizar`) e `--dominio vercel` volta ao endereço gratuito da Vercel; o passo a passo do DNS vale para qualquer
  provedor. Sem escolher, o painel fica no endereço gratuito da Vercel (`<projeto>.vercel.app`, com HTTPS).
- O aviso da versão que precisa da nuvem primeiro aponta para o Atualizar a nuvem.

## 0.2.1 · 12/10/2026

Verificar atualização na hora e escolher como os computadores se atualizam sozinhos. Atualize primeiro o computador que
criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.2.1.tar.gz --atualizar` (com os
tokens do Supabase e da Vercel: esta versão traz mudança no banco e o painel novo); os outros, pelo botão do painel.

- **Verificar atualização** (Computadores): cada computador ligado confere na hora a versão publicada, sem esperar as
  6 horas, e o painel mostra "Todos na versão mais nova" ou "Versão Y disponível", com Atualizar todos.
- **Atualizar sozinho vira uma escolha:** Desligada (o padrão), De madrugada (3h às 5h) ou **Assim que sair** (o
  computador se atualiza assim que acha a versão nova). Sempre um computador por vez e só com ele calmo (sem troca de
  conta em andamento nem sessão no limite); se um voltar para a versão anterior, os outros param e sai um alerta. Quem
  já tinha ligado continua de madrugada. O cartão mostra o andamento de cada computador.
- **Trava de compatibilidade:** um computador não troca o programa por uma versão que traz mudança na nuvem ainda não
  aplicada. O painel avisa: "A versão Y precisa da nuvem e do painel atualizados primeiro: rode a atualização no
  computador principal". Depois disso, eles seguem sozinhos.
- **Segurança (revisão de código da 0.2.0):** o computador novo recusa a chave do cofre quando a nuvem não tem a
  impressão da chave da instalação; quem libera grava a impressão antes de entregar. Quem escrevesse direto no banco
  poderia apagar a impressão e plantar uma chave dele no computador novo.
- **Nada sai sem passar antes nos três sistemas:** `node scripts/ensaio.mjs` roda os testes daqui e leva a mudança aos
  testes do GitHub (instalação em macOS, Linux e Windows, Windows de verdade e ponta a ponta) antes de publicar; o
  lançamento e o envio para a main recusam código sem esse ensaio verde. O teste do Windows tira o tamanho do código de
  ligação do próprio agente.
- Computadores numa versão anterior à 0.2.1 só se atualizam sozinhos de madrugada; com "Assim que sair", o painel deixa
  o Atualizar todos para eles.

## 0.2.0 · 12/10/2026

Computador novo sem segredo na tela, e instalação mais curta. Atualize primeiro o computador que criou a instalação
com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.2.0.tar.gz --atualizar` (com os tokens do Supabase
e da Vercel: esta versão traz mudança no banco e o painel novo); os outros computadores, pelo botão Atualizar do painel
(ou o mesmo comando, que não pede token). O computador que libera um computador novo precisa estar na 0.2.0 (o painel
avisa).

- **Ligar computador novo sem segredo na tela** (achado 2 da revisão de segurança de 11/10/2026). O painel mostra um
  código de acesso (`rvzc_`) que só deixa o computador novo **pedir** para entrar: não abre o cofre. O computador novo
  mostra em letras grandes um código de 8 caracteres; você digita esse código na janela que abre no computador que já
  usa o Reveza (sem tela: `reveza ligar XXXX-XXXX`). A chave do cofre vai cifrada só para o computador novo (ECDH +
  HKDF-SHA256 + AES-256-GCM), a nuvem só vê texto cifrado e o apaga na primeira leitura. O pedido vale 10 minutos, um
  por vez (dois ao mesmo tempo são recusados), e três códigos errados recusam o pedido.
- A identidade de um computador novo só vira computador depois de receber a chave do cofre. O painel acompanha cada
  passo e mostra quem liberou; a janela abre na língua do painel.
- **A troca automática já vem ligada** na instalação nova, antes do limite (avisa em 90%, troca em 95%), sem perguntas.
  Uma linha diz isso e onde mudar (no painel, em Troca automática). Quem importa de outro gestor fica com a configuração
  de lá; atualizar não muda a troca de ninguém.
- **A página de criar cada token abre sozinha** no navegador (Supabase e Vercel), na hora em que o instalador pede. Não
  abre com `--sim`, sem terminal, por SSH sem tela nem com o token já no ambiente.
- **Etapas numeradas de 1 até o total do seu caminho** (antes eram sempre "de 8", com números pulados), e perguntas
  mais claras, cada uma dizendo para que serve.
- **Saiu:** o código `rvzl_` (levava a senha do computador e a frase do cofre) e o `rvzpc_`, que o instalador agora
  recusa pedindo um código novo; a frase cifrada para o navegador; e `reveza ligar --painel ligar` (liberar sem
  perguntar). A frase de 6 palavras fica só como emergência, para um computador já ligado que perdeu a chave
  (`reveza ligar --mostrar-frase` / `--frase`).

## 0.1.7 · 12/10/2026

Saúde que conserta, atualizar pelo painel, notificações e a tela de Alertas de volta. Atualize primeiro o computador que
criou a instalação com `npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.7.tar.gz --atualizar` (com os
tokens do Supabase e da Vercel: esta versão traz mudanças no banco e o painel novo); nos outros computadores, o mesmo
comando, que não pede token; daqui em diante, o botão Atualizar do painel.

- **`reveza doctor` conserta o que tem conserto seguro:** serviço parado ou não instalado, mod ausente nas sessões e
  Claude Code sem login (põe a conta que a nuvem mandou, ou a melhor livre). Cada linha diz "corrigido" ou o que fazer;
  o que não tem conserto automático (entrar de novo numa conta, chave do cofre, relógio, Claude Code ausente ou velho)
  só explica. `reveza doctor --so-ver` só confere.
- **Corrigir na tela Saúde e no cartão do computador** (só administrador), com o resultado item a item. A tela diz que é
  o `reveza doctor` de cada computador, e o Rodar agora mostra na hora o que o computador mandou (antes mostrava o
  resultado guardado, de até 10 minutos antes).
- **Atualizar pelo painel:** "Versão X disponível · Atualizar" em cada computador e "Atualizar todos" em Computadores. O
  computador só aceita versão oficial publicada e mais nova que a dele, baixada do GitHub do projeto, e atualiza com a
  cópia conferida e a volta sozinha da 0.1.6. O painel e a nuvem continuam sendo atualizados pelo instalador no
  computador principal.
- **Atualizar sozinho de madrugada** (opção em Computadores, desligada de fábrica): com versão nova publicada, cada
  computador se atualiza entre 3h e 5h, sem troca de conta nem sessão no limite naquele momento, um por vez. Se um
  voltar para a versão anterior, os outros param e sai um alerta.
- **Tela de Alertas que abria quebrada depois de uma atualização do painel:** a aba aberta antes da versão nova pedia um
  pedaço do painel que não existe mais. Agora a página se recarrega sozinha; se alguma tela quebrar, a caixa de erro
  mostra a mensagem e tem "Copiar detalhes" (sem senha, token nem e-mail).
- **Notificação no celular de ponta a ponta:** crie o alerta em Alertas, o navegador pede a permissão e o aparelho passa
  a receber, com o texto do alerta (cifrado só para aquele aparelho). No iPhone e no iPad, só com o painel instalado
  na tela inicial.
- **Aviso de troca de conta no navegador:** em Alertas ou Minha conta, "Neste navegador" liga uma notificação e um sinal
  curto a cada troca de conta enquanto o painel está aberto.
- **O ntfy saiu dos canais de alerta** (painel, nuvem e instalador). A atualização da nuvem apaga algum alerta ntfy que
  tenha sobrado.
- A instalação e a atualização não acusam mais "nenhum login" enquanto a conta que a nuvem mandou está chegando.
- **Correção:** com o Claude Code sem login, a troca de conta podia gravar o vazio por cima do login guardado da conta
  que estava em uso (vinha da 0.1.4).

## 0.1.6 · 12/10/2026

Cores por workspace e atualização que não perde nada. Quem tem a 0.1.5 atualiza com
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.6.tar.gz --atualizar` (no computador que criou a
instalação, com os tokens do Supabase e da Vercel para o painel subir junto).

- **Contas do mesmo workspace com a mesma cor.** O workspace é a organização da conta ou, sem ela, o domínio do e-mail
  (gmail.com, outlook.com e outros provedores públicos não juntam contas). A cor de cada workspace é a da conta mais
  antiga dele, e dois workspaces não dividem cor enquanto houver cor livre.
- **Nos gráficos, um tom por conta.** Em Uso por dia, na janela de 5 horas e nas sessões, cada conta aparece num tom da
  cor do workspace, e as do mesmo workspace ficam juntas na pilha e na legenda.
- **Trocar a cor vale para o workspace inteiro.** Na gaveta da conta, o campo virou "Cor do workspace", mostra o tom de
  cada conta e põe cadeado nas cores que já são de outro workspace.
- **Atualizar não perde nada.** Antes de mexer em qualquer coisa, o instalador copia contas, logins, uso, configuração e
  identidade para `~/.reveza/copias` e confere a cópia arquivo a arquivo (ficam as 5 mais novas). Depois de atualizar,
  confere que o agente da versão nova está rodando; se não estiver em 30 segundos, volta sozinho para a versão anterior,
  com a configuração da cópia, e as contas e os logins ficam como estavam.
- **Barra lateral do painel:** no topo, o que o Reveza é (antes aparecia o identificador do projeto no Supabase); a
  versão do painel fica embaixo, no rodapé.
- Demonstração e fotos do site com a versão de verdade do Reveza (antes apareciam 0.4.1 e 0.4.2 fixos).
- O teste de ponta a ponta da instalação roda no GitHub a cada envio, nos dois jeitos de instalar.

## 0.1.5 · 12/10/2026

Atualizar um computador ligado não pede mais token. Quem tem a 0.1.4 atualiza com
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.5.tar.gz --atualizar`.

- **Computador novo, atualização sem perguntas:** no computador que entrou pelo código do painel, o `--atualizar`
  perguntava o token do Supabase e seguia como se fosse uma instalação nova. Agora ele atualiza só o programa daquele
  computador; a nuvem e o painel continuam com o computador que criou a instalação.
- No computador que criou a instalação, a pergunta do token avisa que deixar em branco atualiza só ele.
- O teste de ponta a ponta atualiza o segundo computador com os tokens no ambiente e confere que nada vai à nuvem.

## 0.1.4 · 12/10/2026

Windows de verdade e ligação de computador novo mais segura. Quem tem a 0.1.3 atualiza com
`npx github:dantaspaulo/reveza#v0.1.4 --atualizar` (no Windows sem o Git,
`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/v0.1.4.tar.gz --atualizar`). Atualize também o painel (o
`--atualizar` com os tokens do Supabase e da Vercel): para ligar computador novo, painel e computador precisam estar os
dois na 0.1.4.

- **Segurança: um pedido de ligação por vez, e código de 6 caracteres.** Se dois pedidos de ligar computador novo chegam
  juntos, o computador recusa os dois (com som e aviso) e pede para gerar de novo no painel. O código que se digita na
  janela passou de 4 para 6 caracteres. Isso fecha o caso, achado na revisão de segurança, em que alguém com acesso
  direto ao banco da nuvem forjava um segundo pedido com o mesmo código do verdadeiro e levava a chave do cofre.
- **O computador novo recebe a conta mesmo com o Claude Code sem login.** Antes, a troca ficava adiada para sempre com
  "não consegui identificar a conta em uso".
- **Windows, provado num Windows de verdade a cada envio** (o GitHub instala, derruba, atualiza e desinstala o Reveza
  numa máquina Windows, com acento e espaço no caminho):
  - o serviço instala sem administrador (antes, num terminal comum, dava "Acesso negado" e o agente não subia);
  - o agente roda sem janela (antes abria um terminal na tela, e fechar a janela derrubava o agente);
  - não para depois de 3 dias, roda na bateria e não para ao tirar da tomada;
  - volta sozinho em até um minuto se cair, e o `--atualizar` troca o agente que está rodando (antes a versão antiga
    seguia rodando);
  - a janela de confirmação de computador novo aparece (antes ficava escondida, e o pedido era recusado em 90 s);
  - o agente acha o Claude Code instalado pelo npm (o pacote de hoje traz um `.exe`), para conectar, renovar e retomar;
  - o comando `reveza` funciona com acento no caminho (`C:\Users\João`), e o instalador oferece pôr o `reveza` no Path
    do usuário.
- **Linux: o `--atualizar` reinicia o agente** (antes a versão antiga seguia rodando até o computador reiniciar).
- Painel: a caixa de ligar computador novo mostra o comando e o código inteiros (antes cortava à direita).

## 0.1.3 · 11/10/2026

Computador novo em qualquer sistema. Quem tem a 0.1.2 atualiza com `npx github:dantaspaulo/reveza#v0.1.3 --atualizar`.

- **O painel mostra o passo a passo do sistema do computador novo** (macOS, Windows ou Linux), já aberto no sistema de
  quem está olhando: como abrir o terminal, o comando e o que precisa estar instalado.
- **Sem precisar do Git:** o comando do painel baixa o pacote da versão direto do GitHub
  (`npx https://github.com/dantaspaulo/reveza/archive/refs/tags/vX.Y.Z.tar.gz --ligar`). O `npx github:...` pedia o Git,
  que o Windows não traz, e o computador novo fica na mesma versão dos outros.
- **Instalação conferida de verdade nos três sistemas:** a cada envio, o GitHub instala o Reveza no macOS, no Linux e no
  Windows (de dentro de um `node_modules`, como o npx deixa) e roda os testes do agente em cada um.
- README: compartilhar no WhatsApp leva ao site, que tem a imagem de compartilhamento.

## 0.1.2 · 11/10/2026

Apoio ao projeto e versão num lugar só. Quem tem a 0.1.1 atualiza com `npx github:dantaspaulo/reveza#v0.1.2 --atualizar`.

- **Apoie o projeto:** no README, contribuição de R$ 100 pelo Asaas (Pix, cartão ou boleto), Pix direto para valores
  maiores e o botão de mandar o Reveza no WhatsApp.
- **Toda correção sai com versão:** `node scripts/versao.mjs lancar X.Y.Z` sobe a versão em todos os lugares (pacotes,
  travas, agente, README), publica, marca a tag e cria a release com o texto desta página. O `npm test` confere que
  tudo está na mesma versão, e o pre-push (`.githooks`) recusa empurrar para a main mudança no que se instala sem
  versão nova.

## 0.1.1 · 11/10/2026

Correção: computador novo instalado pelo `npx github:dantaspaulo/reveza` parava em "agente/package-lock.json ausente".
Pelo npx, o repositório chega dentro de uma pasta `node_modules`, e o filtro que deixa de fora as dependências olhava o
caminho inteiro e jogava fora tudo. Agora olha só o caminho dentro do programa, e o teste de ponta a ponta roda a
instalação de dentro de um `node_modules`, do mesmo jeito que o npx deixa.

**Para quem parou nesse erro:** rode de novo `npx github:dantaspaulo/reveza#v0.1.1 --ligar`.

## 0.1.0 · 11/10/2026

Primeira versão aberta. Várias contas do Claude Code, revezando sozinhas: o Reveza troca de conta antes do limite e a
sessão continua na conta nova.

- **Troca automática** por limiar (avisa em 90% e troca em 95%, o padrão), só no limite ou em rodízio ao longo do dia,
  com ordem de preferência, conta de reserva, agenda por horário e teto semanal. Perto do gatilho, a conta em uso é
  lida a cada 15 segundos.
- **A sessão continua:** as sessões abertas seguem na conta nova sem reiniciar; uma sessão sem ninguém que parou no
  limite é retomada sozinha na conta seguinte. A cada troca, o computador toca um som (`reveza som desligar` tira).
- **Cofre cifrado:** cada login é cifrado no computador (AES-256-GCM); a chave mora só no chaveiro do sistema e a
  nuvem guarda texto que não consegue ler.
- **Painel na sua nuvem** (Supabase e Vercel, planos grátis): visão geral, contas, computadores, troca, uso e custo
  equivalente, plano da semana, alertas (Telegram, ntfy, e-mail, webhook, celular), time com papéis e auditoria, API com
  chave pessoal e webhooks assinados. Em português e inglês, instala no celular, e tem modo demonstração.
- **Computador novo com um código só:** o painel gera o código; o computador que já tem a chave pede, numa janela, o
  código de 4 caracteres que o painel mostra; no computador novo, `npx github:dantaspaulo/reveza --ligar` e colar.
- **Instalador de um comando** (`npx github:dantaspaulo/reveza`), em macOS, Linux (inclusive VPS sem tela) e Windows,
  com Node 20.19 ou mais novo: cria a nuvem, publica o painel, conecta as contas, configura os alertas e faz a prova
  final. `--sem-nuvem`, `--demo`, `--sombra` e `--importar` para outros jeitos de começar.
- **Segurança:** auditoria completa com a skill de auditoria de segurança da Cloudflare, com os achados confirmados
  corrigidos; versões travadas e instalação sem scripts de terceiros; a trava do repositório recusa segredo, dado
  pessoal e componente do React Bits em todo commit.

**Instalar:** `npx github:dantaspaulo/reveza` · **atualizar:** `npx github:dantaspaulo/reveza --atualizar` (contas, uso
e configuração ficam).
