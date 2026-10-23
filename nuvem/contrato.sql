-- Reveza AI: contrato do banco (Supabase/Postgres). Fonte de verdade para o agente, o painel e as funções.
-- Esta versão define tabelas, tipos e as funções (RPC) que o agente e o painel chamam. As políticas de RLS, os
-- gatilhos de auditoria e o corpo das funções ficam em migracoes/ (escritos a partir deste contrato).
--
-- Regras:
-- - RLS ligado em TODAS as tabelas; anon não alcança nada; authenticated só pelo papel em `membros`.
-- - O painel nunca escreve direto em tabela: chama as funções `painel_*` (security definer, conferem papel e aal2,
--   gravam auditoria). O agente chama as funções `agente_*` (conferem que quem chama é um computador ativo).
-- - `cofre.cifrado` é AES-256-GCM feito no computador; o banco não tem como decifrar.

create type papel as enum ('admin', 'leitura', 'computador');
create type modo_troca as enum ('limite', 'limiar', 'rodizio');
create type estado_comando as enum ('pendente', 'reservado', 'feito', 'recusado', 'expirado');

create table membros (
  user_id uuid primary key references auth.users on delete cascade,
  papel papel not null,
  nome text,
  idioma text not null default 'pt-BR' check (idioma in ('pt-BR', 'en')),
  criado_em timestamptz not null default now()
);

create table convites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  papel papel not null check (papel <> 'computador'),
  token_hash text not null unique,          -- sha256 do token do link; o token só vai no e-mail
  expira_em timestamptz not null default now() + interval '72 hours',
  usado_em timestamptz,
  criado_por uuid not null references auth.users
);

create table computadores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,  -- identidade própria (papel computador)
  nome text not null,
  sistema text not null check (sistema in ('macos', 'linux', 'windows')),
  versao text not null,
  visto_em timestamptz,
  revogado boolean not null default false,
  diagnostico jsonb,                         -- último resultado do `reveza doctor`
  conta_preferida uuid references contas on delete set null,  -- usada sempre que livre (0024); de um computador só
  criado_em timestamptz not null default now()
);

create table contas (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  organizacao text,
  plano text,                                -- pro, max, team...
  nivel text,                                -- multiplicador do plano (5x, 20x)
  cor smallint not null default 0,           -- índice da paleta do painel, estável
  prioridade smallint not null default 100,  -- menor = preferida
  reserva boolean not null default false,    -- só usada sem nenhuma outra livre
  pausada boolean not null default false,
  agenda jsonb not null default '[]',        -- [{dias:[1..7], de:"08:00", ate:"18:00"}] fora disso a conta não é usada
  teto_semana numeric check (teto_semana between 1 and 100),  -- % máximo da semana que o rodízio pode gastar
  precisa_login boolean not null default false,
  criado_em timestamptz not null default now()
);

create table cofre (
  conta_id uuid primary key references contas on delete cascade,
  cifrado bytea not null,                    -- AES-256-GCM(K, nonce, json), tag incluída no fim
  nonce bytea not null check (length(nonce) = 12),
  versao bigint not null,                    -- sobe a cada gravação; vai no dado associado
  expira_em timestamptz,                     -- validade do token de acesso (em claro: não é segredo)
  gravado_por uuid references computadores,
  gravado_em timestamptz not null default now()
);

create table posse (
  conta_id uuid primary key references contas on delete cascade,
  computador_id uuid not null references computadores on delete cascade,
  motivo text not null check (motivo in ('uso', 'leitura', 'renovacao', 'login')),
  desde timestamptz not null default now(),
  expira_em timestamptz not null
);

create table atribuicao (
  computador_id uuid primary key references computadores on delete cascade,
  conta_id uuid references contas,           -- null = nenhuma conta livre
  motivo text not null,
  versao bigint not null default 1,
  decidido_em timestamptz not null default now()
);

create table uso_janelas (
  conta_id uuid not null references contas on delete cascade,
  tipo text not null check (tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet')),
  pct numeric,
  reset_em timestamptz,
  lido_em timestamptz not null default now(),
  fonte text not null check (fonte in ('sessao', 'api')),
  primary key (conta_id, tipo)
);

create table uso_historico (                 -- um ponto a cada 5 min por conta, 90 dias
  conta_id uuid not null references contas on delete cascade,
  em timestamptz not null,
  p5 numeric,
  p7 numeric,
  primary key (conta_id, em)
);

create table uso_tokens (                    -- agregado por hora, vindo das transcrições de cada computador
  hora timestamptz not null,
  conta_id uuid references contas on delete set null,
  computador_id uuid not null references computadores on delete cascade,
  projeto text not null default '',          -- nome da pasta final, nunca o caminho
  modelo text not null,
  respostas integer not null default 0,
  entrada bigint not null default 0,
  saida bigint not null default 0,
  cache_escrita bigint not null default 0,
  cache_leitura bigint not null default 0,
  usd numeric(14, 4) not null default 0,
  primary key (hora, conta_id, computador_id, projeto, modelo)
);

create table sessoes (
  id text primary key,                       -- id da sessão do assistente
  computador_id uuid not null references computadores on delete cascade,
  projeto text not null default '',
  inicio timestamptz,
  fim timestamptz,
  respostas integer not null default 0,
  tokens bigint not null default 0,
  usd numeric(14, 4) not null default 0,
  agentes integer not null default 0,
  contas uuid[] not null default '{}',
  modelos text[] not null default '{}',
  parada_no_limite boolean not null default false
);

create table eventos (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null check (tipo in ('troca', 'aviso', 'limite', 'retomada', 'conexao', 'erro', 'info', 'alerta')),
  texto text not null,
  dados jsonb not null default '{}'          -- {de, para, computador, conta, motivo...}: o painel lê daqui, nunca do texto
);

create table comandos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  criado_por uuid not null references auth.users,
  computador_id uuid not null references computadores on delete cascade,
  acao text not null check (acao in ('conectar', 'entrar_de_novo', 'cancelar_login', 'codigo_login', 'atualizar',
                                     'diagnostico', 'retomar_sessao')),
  corpo jsonb not null default '{}' check (pg_column_size(corpo) <= 4096),
  estado estado_comando not null default 'pendente',
  resposta jsonb,
  http smallint,
  reservado_em timestamptz,
  concluido_em timestamptz
);

create table config (
  chave text primary key check (chave in ('auto', 'modo', 'aviso', 'troca', 'rodizio_minutos', 'rodizio_ordem',
                                          'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s')),
  valor jsonb not null,
  mudado_por uuid references auth.users,
  mudado_em timestamptz not null default now()
);

create table alertas (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('telegram', 'email', 'webhook', 'push')),
  destino jsonb not null,                    -- sem segredo em claro: segredos ficam no Vault do Supabase (vault_id)
  eventos text[] not null,                   -- 'sem_livre', 'precisa_login', 'computador_parado', 'login_vence', 'resumo_dia', 'troca',
                                             -- 'limite', 'atualizacao_falhou', 'troca_falhou' (0023)
  ativo boolean not null default true,
  criado_por uuid not null references auth.users
);

create table push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

create table chaves_api (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  nome text not null,
  prefixo text not null,                     -- rvz_xxxx (visível)
  hash text not null unique,                 -- sha256 do resto
  escopos text[] not null check (escopos <@ array['ler', 'trocar', 'config']),
  criada_em timestamptz not null default now(),
  usada_em timestamptz,
  revogada boolean not null default false
);

create table webhooks_saida (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url like 'https://%'),
  eventos text[] not null,
  segredo_vault_id uuid not null,            -- assinatura HMAC de cada envio
  ativo boolean not null default true,
  criado_por uuid not null references auth.users
);

-- Computador novo pedindo para entrar (0019, versão 0.2.0): o código aparece NELE e é digitado num computador que já
-- tem a chave do cofre. Ninguém lê direto a chave pública nem o envelope; o painel lê o andamento (membro).
create table ligacao_pedidos (
  computador_id uuid primary key references computadores on delete cascade,  -- o computador novo (linha pendente)
  aprovador uuid references computadores on delete set null,                  -- onde a janela abre (o painel escolhe)
  aprovador_em timestamptz,
  idioma text not null default 'pt-BR',      -- a língua da janela (a do painel)
  publica jsonb,                             -- chave pública ECDH P-256 do computador novo; registrada uma vez só
  pedido_em timestamptz,
  expira_em timestamptz,                     -- pedido_em + 10 minutos
  envelope jsonb,                            -- a chave do cofre cifrada para `publica` (ECDH + HKDF-SHA256 + AES-256-GCM)
  entregue_por uuid references computadores on delete set null,
  entregue_em timestamptz,
  lido_em timestamptz,                       -- lido uma vez: o envelope sai do banco
  recusado text,                             -- recusado_na_tela, dois_pedidos, codigo_errado
  recusado_em timestamptz
);

create table auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  user_id uuid,
  acao text not null,
  alvo text,
  detalhes jsonb not null default '{}'
);

-- ------------------------------------------------------------------------------------------------ funções do agente
-- Todas exigem que auth.uid() seja um computador não revogado. Devolvem jsonb.
-- agente_registrar(nome, sistema, versao)                       -> {computador_id}
-- agente_ola(versao, diagnostico jsonb)                         -> {atribuicao, config, comandos_pendentes, ligar_codigo?}
--     (a "busca" de 5 em 5 s: renova visto_em e as posses deste computador, devolve o que fazer)
-- agente_pegar_posse(conta_id, motivo, segundos)                -> {ok, cofre?: {cifrado, nonce, versao}}
-- agente_devolver_cofre(conta_id, cifrado, nonce, versao_anterior, expira_em) -> {ok, versao}  (exige posse)
-- agente_soltar_posse(conta_id)                                 -> {ok}
-- agente_registrar_conta(email, organizacao, plano, nivel, cifrado, nonce) -> {conta_id}  (login novo)
-- agente_relatar_uso(janelas jsonb, historico jsonb)            -> {ok}
-- agente_relatar_tokens(linhas jsonb, sessoes jsonb)            -> {ok}
-- agente_limite(conta_id, sessao, tipo)                         -> {ok}  (sessão bateu o limite: decide na hora)
-- agente_reservar_comando(id)                                   -> {ok, comando?}  (pendente -> reservado, atômico)
-- agente_responder_comando(id, http, resposta)                  -> {ok}
-- agente_evento(tipo, texto, dados)                             -> {ok}
--     (erro com dados.motivo = 'troca_falhou' e os ids de conta de/para: a nuvem escreve o alerta com o texto dela,
--      no máximo um por computador por hora, 0023; o texto do computador nunca sai pelos canais)
-- agente_ligacao_publicar(embrulho bytea, sal bytea)            -> {ok, expira_em}  (frase de emergência, 10 min)
-- agente_ligacao_buscar()                                       -> {embrulho, sal}  (computador já ativo, uma vez)
-- agente_ligacoes_abertas()                                     -> {pedidos: [{computador_id, publica, expira_em, para_mim, idioma}]}
--     (também vem em agente_ola.ligacoes; mais de um aberto = todos recusados)
-- agente_ligacao_entregar(computador_id, publica, envelope)     -> {ok}  (só o pedido aberto com a mesma chave pública)
-- agente_ligacao_recusar(computador_id, motivo)                 -> {ok}
-- Só a identidade PENDENTE dona do pedido (antes de entrar; agente_registrar recusa pendente sem a chave recebida):
-- agente_ligacao_pedir(publica jsonb)                           -> {ok, computador_id, expira_em}  (uma vez, 10 min)
-- agente_ligacao_receber()                                      -> {estado: esperando|entregue|recusado|vencido|lido, envelope?, impressao?}

-- ------------------------------------------------------------------------------------------------ funções do painel
-- Leitura: views com RLS (membros leem tudo, menos cofre, alertas.destino e chaves_api de outros).
-- Escrita (admin + aal2, gravam auditoria):
-- painel_config(chave, valor)
-- painel_conta(conta_id, campos jsonb)           cor, prioridade, reserva, pausada, agenda, teto_semana
-- painel_trocar_agora(computador_id, conta_id)   força atribuição (respeita posse)
-- painel_comando(computador_id, acao, corpo)     enfileira para o computador (a ação ligar saiu na 0.2.0)
-- painel_convidar(email, papel) / painel_revogar_membro(user_id) / painel_mudar_papel(user_id, papel)
-- painel_revogar_computador(computador_id)
-- painel_computador_preferida(computador_id, conta_id)  conta preferida (null tira); livre agora, passa para ela
-- painel_computador_nome(computador_id, nome)   nome dado no painel (0029); o registro do agente não o troca; vazio volta ao do sistema
-- painel_ligacao_aprovador(computador_novo, aprovador, idioma)  em qual computador (e língua) a janela de liberar abre
-- painel_alerta(...) / painel_webhook(...) / painel_chave_api(...)  (segredos vão ao Vault pela função)
-- Qualquer membro: painel_meu_idioma(idioma), painel_push_inscrever(endpoint, p256dh, auth)

-- ------------------------------------------------------------------------------------------------ decisão
-- decidir(computador_id default null) -> roda a regra da seção 6 da ARQUITETURA para um ou todos os computadores;
-- chamada pelo pg_cron a cada minuto, por agente_relatar_uso e agente_limite. Grava atribuicao e eventos.
-- A conta preferida de cada computador vem primeiro para ele e por último para os outros (seção 6).
