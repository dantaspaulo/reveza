-- Reveza AI · 0049 · projetos pelas pastas da barra lateral do OpenBot: a coluna, a tabela e o tipo novo. Só acrescenta.
-- reaplicável: tudo com "if not exists"; a checagem do tipo só é trocada enquanto não conhece "secao". As funções ficam
-- na 0050.
--
-- 0.22.0. O OpenBot organiza os agentes em pastas na barra lateral (com subpastas). O agente lê essa barra, só para
-- leitura, e manda de cada agente a cadeia de pastas da raiz até a dele (agentes_openbot.secoes, ids) e a lista das
-- pastas (secoes_openbot, para o painel mostrar o nome). Uma regra do tipo "secao" (o padrão é o id da pasta) põe no
-- projeto as conversas dos agentes daquela pasta e das de dentro. O id é do OpenBot de um computador, então a regra
-- sempre leva o computador.

alter table public.agentes_openbot add column if not exists secoes text[] not null default '{}';

-- As pastas da barra de cada computador: a lista inteira que o agente leu por último (a que sumiu sai).
create table if not exists public.secoes_openbot (
  computador_id uuid not null references public.computadores on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  nome text not null default '' check (length(nome) <= 120),
  pai text check (pai is null or pai ~ '^[A-Za-z0-9_-]{1,100}$'),
  visto_em timestamptz not null default now(),
  primary key (computador_id, id)
);

-- Como as outras tabelas (0036): RLS ligada, nada para anon, leitura para membro, escrita só pelas funções.
alter table public.secoes_openbot enable row level security;
revoke all on public.secoes_openbot from anon, authenticated;
grant select on public.secoes_openbot to authenticated;
drop policy if exists membro_le on public.secoes_openbot;
create policy membro_le on public.secoes_openbot for select to authenticated using (public.rvz_eh_membro());

-- O tipo novo. A checagem da 0036 só conhece pasta e título; troca uma vez (a que já conhece "secao" fica, para uma
-- migração futura que acrescente outro tipo não ser desfeita quando esta rodar de novo).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.pastas_empresa'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%titulo%' and pg_get_constraintdef(oid) not like '%secao%' loop
    execute format('alter table public.pastas_empresa drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.pastas_empresa'::regclass and conname = 'pastas_empresa_tipo_check') then
    alter table public.pastas_empresa add constraint pastas_empresa_tipo_check check (tipo in ('pasta', 'titulo', 'secao'));
  end if;
  -- a regra de pasta do OpenBot vale num computador só e o padrão é um id
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.pastas_empresa'::regclass and conname = 'pastas_empresa_secao_valida') then
    alter table public.pastas_empresa add constraint pastas_empresa_secao_valida
      check (tipo <> 'secao' or (computador_id is not null and padrao ~ '^[A-Za-z0-9_-]{1,100}$'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.agentes_openbot'::regclass and conname = 'agentes_openbot_secoes_niveis') then
    alter table public.agentes_openbot add constraint agentes_openbot_secoes_niveis check (cardinality(secoes) <= 10);
  end if;
end $$;
