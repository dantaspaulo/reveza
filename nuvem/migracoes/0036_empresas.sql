-- Reveza AI · 0036 · empresas: quais contas atendem cada empresa, para onde ela transborda e de qual empresa é cada
-- pasta. O nome curto da pasta (o "projeto") não basta para saber de quem é o gasto: "producao", "fonte" ou o nome de
-- uma árvore de trabalho do git aparecem em vários projetos. Agora o uso leva também a pasta inteira (a raiz do git,
-- relativa à pasta pessoal: "~/Code/projeto"), e a classificação vem de regras que o administrador escolhe no painel.
-- reaplicável: não (cria tabelas e troca o índice único do uso por hora). Só acrescenta: nenhuma linha muda ou sai.
--
-- As regras nascem vazias e desligadas: sem empresa marcada, toda conta atende tudo, como antes. As funções ficam na
-- 0037 (reaplicável), para que uma reaplicação da 0030 nunca devolva a função antiga com a chave única antiga.

-- ------------------------------------------------------------------------------------------- pasta inteira no uso
alter table public.uso_tokens add column if not exists pasta text not null default ''
  check (length(pasta) <= 300);
alter table public.sessoes add column if not exists pasta text not null default ''
  check (length(pasta) <= 300);

-- A chave única ganha a pasta: duas pastas com o mesmo nome curto na mesma hora são duas linhas, não uma por cima da
-- outra. As linhas de antes têm pasta vazia e continuam únicas (a chave nova é a antiga mais uma coluna).
create unique index if not exists uso_tokens_chave_pasta on public.uso_tokens
  (hora, coalesce(conta_id, '00000000-0000-0000-0000-000000000000'::uuid), computador_id, projeto, pasta, modelo);
drop index if exists public.uso_tokens_chave;

-- ------------------------------------------------------------------------------------------- empresas
-- transbordo: quando as contas da empresa enchem, "nenhum" (espera), "qualquer" (qualquer conta livre) ou
-- "escolhidas" (só as contas da lista).
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 60 and nome !~ '[[:cntrl:]]'),
  cor smallint not null default 0 check (cor between 0 and 11),
  transbordo text not null default 'nenhum' check (transbordo in ('nenhum', 'qualquer', 'escolhidas')),
  transbordo_contas uuid[] not null default '{}' check (cardinality(transbordo_contas) <= 50),
  criado_em timestamptz not null default now()
);
create unique index if not exists empresas_nome on public.empresas (lower(btrim(nome)));

-- Quais empresas cada conta atende. Conta sem nenhuma linha aqui atende todas.
create table if not exists public.conta_empresas (
  conta_id uuid not null references public.contas on delete cascade,
  empresa_id uuid not null references public.empresas on delete cascade,
  primary key (conta_id, empresa_id)
);
create index if not exists conta_empresas_empresa on public.conta_empresas (empresa_id);

-- De qual empresa é cada pasta. tipo "pasta": o padrão começa com "~/" ou "/" e vale para a pasta e tudo abaixo dela
-- (a regra mais longa vence); sem barra no começo, vale para qualquer pasta com esse nome. tipo "titulo": vale para a
-- pasta de um agente do OpenBot cujo título (ou nome) contém o padrão.
create table if not exists public.pastas_empresa (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pasta', 'titulo')),
  padrao text not null check (length(btrim(padrao)) between 1 and 300 and padrao !~ '[[:cntrl:]]'),
  empresa_id uuid not null references public.empresas on delete cascade,
  criado_em timestamptz not null default now(),
  unique (tipo, padrao)
);

-- Os agentes do OpenBot de cada computador (pasta, nome e título), lidos pelo agente só para leitura no banco do
-- OpenBot. Servem para a regra por título e para o painel mostrar o nome do agente no lugar de "agent-<id>".
create table if not exists public.agentes_openbot (
  computador_id uuid not null references public.computadores on delete cascade,
  pasta text not null check (length(pasta) between 1 and 300),
  nome text not null default '' check (length(nome) <= 120),
  titulo text not null default '' check (length(titulo) <= 200),
  visto_em timestamptz not null default now(),
  primary key (computador_id, pasta)
);

-- ------------------------------------------------------------------------------------------- segurança de linha
-- Como as outras tabelas (0001): RLS ligada, nada para anon, leitura para membro, escrita só pelas funções.
do $$
declare t text;
begin
  foreach t in array array['empresas', 'conta_empresas', 'pastas_empresa', 'agentes_openbot'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists membro_le on public.%I', t);
    execute format('create policy membro_le on public.%I for select to authenticated using (public.rvz_eh_membro())', t);
  end loop;
end $$;
