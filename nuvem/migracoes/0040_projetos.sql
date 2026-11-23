-- Reveza AI · 0040 · projetos dentro da empresa e o modo de teste (sombra). Só acrescenta.
-- reaplicável: tudo com "if not exists"; o índice do nome é refeito com o mesmo nome, sem mexer em dado.
--
-- Um projeto é uma linha da própria tabela de empresas, com `pai` apontando para a empresa. Assim as marcas das contas,
-- as regras de pasta, o transbordo e as trilhas da 0.18.0 servem a ele sem mudar nada: a regra de pasta mais longa
-- vence, então a do projeto vence a da empresa. As funções ficam na 0041 (reaplicável).
--
-- modo: null (de fábrica) = na empresa, pelo "separar" da 0.18.0 (ligado ou desligado); no projeto, o mesmo da
-- empresa. 'desligado', 'sombra' (decide e registra o que faria, sem trocar nada) ou 'ligado'.
-- herdar_transbordo (só projeto): cheias as contas dele, primeiro as da empresa, depois o transbordo da empresa.

alter table public.empresas add column if not exists pai uuid references public.empresas on delete cascade;
alter table public.empresas add column if not exists modo text check (modo in ('desligado', 'sombra', 'ligado'));
alter table public.empresas add column if not exists herdar_transbordo boolean not null default true;
create index if not exists empresas_pai on public.empresas (pai);

-- O nome era único entre todas; agora é único dentro da mesma empresa (o projeto "Site" pode existir em duas). Troca
-- de índice: nenhum dado sai. O novo fica com o nome do velho (empresas_nome): a 0036 tem "create unique index if not
-- exists empresas_nome" e o cabeçalho dela ("-- reaplicável: não") casa com a regra das reaplicáveis, então ela pode
-- rodar de novo um dia; com o nome ocupado, ela não refaz o índice de antes (que falharia com dois "Site").
create unique index if not exists empresas_nome_no_pai
  on public.empresas (coalesce(pai, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nome)));
drop index if exists public.empresas_nome;
alter index if exists public.empresas_nome_no_pai rename to empresas_nome;

-- O que a trilha de cada unidade em teste faria em cada computador (a conta que usaria e a conta de verdade).
create table if not exists public.trilhas_sombra (
  computador_id uuid not null references public.computadores on delete cascade,
  empresa_id uuid not null references public.empresas on delete cascade,
  conta_id uuid references public.contas on delete set null,
  em_uso uuid references public.contas on delete set null,
  motivo text not null default '' check (length(motivo) <= 200),
  sessoes integer not null default 0,
  trocas integer not null default 0,
  versao bigint not null default 1,
  decidido_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  primary key (computador_id, empresa_id)
);

-- Como as outras tabelas (0001): RLS ligada, nada para anon, leitura para membro, escrita só pelas funções.
alter table public.trilhas_sombra enable row level security;
revoke all on public.trilhas_sombra from anon, authenticated;
grant select on public.trilhas_sombra to authenticated;
drop policy if exists membro_le on public.trilhas_sombra;
create policy membro_le on public.trilhas_sombra for select to authenticated using (public.rvz_eh_membro());
