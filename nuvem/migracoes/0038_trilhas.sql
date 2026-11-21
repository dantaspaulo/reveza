-- Reveza AI · 0038 · trilhas: a empresa que usa só as contas dela.
-- Até a 0.17.0 a conta valia para o computador inteiro: as marcas de empresa só separavam os números. Com "separar"
-- ligado numa empresa, as sessões dela (pela classificação de pastas) rodam numa trilha própria em cada computador, com
-- a conta da trilha, escolhida entre as contas marcadas para a empresa (e o transbordo dela). A conta do computador (a
-- "principal") deixa de usar as contas que são só de empresas separadas.
-- reaplicável: não (cria tabela e coluna). Só acrescenta: nenhuma linha muda ou sai.
--
-- Nasce desligado: "separar" é falso em toda empresa e nenhuma trilha existe. Sem empresa separada, tudo segue como
-- antes. As funções ficam na 0039 (reaplicável).

alter table public.empresas add column if not exists separar boolean not null default false;

-- A conta de cada trilha (empresa) de cada computador. Uma conta está em uma trilha no máximo, e nunca na principal de
-- um computador ao mesmo tempo (conferido pelas funções, com a mesma trava da atribuição). pedida_em: a última busca em
-- que o computador disse que a trilha tem sessão; parada há 10 minutos, a trilha sai.
create table if not exists public.atribuicao_trilhas (
  computador_id uuid not null references public.computadores on delete cascade,
  empresa_id uuid not null references public.empresas on delete cascade,
  conta_id uuid not null references public.contas on delete cascade,
  motivo text not null default '' check (length(motivo) <= 200),
  versao bigint not null default 1,
  decidido_em timestamptz not null default now(),
  pedida_em timestamptz not null default now(),
  primary key (computador_id, empresa_id)
);
create unique index if not exists atribuicao_trilhas_conta on public.atribuicao_trilhas (conta_id);

-- Como as outras tabelas (0001): RLS ligada, nada para anon, leitura para membro, escrita só pelas funções.
alter table public.atribuicao_trilhas enable row level security;
revoke all on public.atribuicao_trilhas from anon, authenticated;
grant select on public.atribuicao_trilhas to authenticated;
drop policy if exists membro_le on public.atribuicao_trilhas;
create policy membro_le on public.atribuicao_trilhas for select to authenticated using (public.rvz_eh_membro());
