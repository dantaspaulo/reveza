-- Reveza AI · 0045 · projeto por computador: cada projeto roda só nos computadores escolhidos. Só acrescenta.
-- reaplicável: tudo com "if not exists", e o preenchimento só pega a linha que ainda não tem valor. As funções ficam na 0046.
--
-- No banco e no código o projeto segue com o nome antigo (empresas); na tela e nas mensagens ele é "projeto", e o nível
-- de dentro é "subprojeto". Renomear tabela em uso não traz nada para quem usa e arrisca a atualização.
-- em_todos_computadores: true vale em todos, como sempre foi. false vale só nos computadores de empresa_computadores,
-- mesmo que a lista fique vazia porque o computador foi removido (assim o projeto nunca vira "todos" sem ninguém pedir).
-- O subprojeto não tem lista própria: vale a do projeto.

alter table public.empresas add column if not exists em_todos_computadores boolean;
alter table public.empresas alter column em_todos_computadores set default true;

create table if not exists public.empresa_computadores (
  empresa_id uuid not null references public.empresas on delete cascade,
  computador_id uuid not null references public.computadores on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, computador_id)
);
create index if not exists empresa_computadores_computador on public.empresa_computadores (computador_id);

-- Só na primeira vez (a coluna ainda sem valor): quem já tinha todas as regras presas a computadores passa a rodar só
-- neles, o que não muda nada, porque em outro computador nenhuma regra dele valia. Regra sem computador, ou nenhuma
-- regra: segue em todos. Computador removido não conta.
insert into public.empresa_computadores (empresa_id, computador_id)
select distinct raiz.id, r.computador_id
  from public.empresas raiz
  join public.empresas x on coalesce(x.pai, x.id) = raiz.id
  join public.pastas_empresa r on r.empresa_id = x.id
  join public.computadores q on q.id = r.computador_id and not q.revogado
 where raiz.pai is null and raiz.em_todos_computadores is null
   and not exists (select 1 from public.empresas y join public.pastas_empresa s on s.empresa_id = y.id
                    where coalesce(y.pai, y.id) = raiz.id and s.computador_id is null)
on conflict do nothing;

update public.empresas e
   set em_todos_computadores = not exists (select 1 from public.empresa_computadores ec where ec.empresa_id = e.id)
 where e.em_todos_computadores is null;

alter table public.empresas alter column em_todos_computadores set not null;

-- Como as outras tabelas (0036): RLS ligada, nada para anon, leitura para membro, escrita só pelas funções.
alter table public.empresa_computadores enable row level security;
revoke all on public.empresa_computadores from anon, authenticated;
grant select on public.empresa_computadores to authenticated;
drop policy if exists membro_le on public.empresa_computadores;
create policy membro_le on public.empresa_computadores for select to authenticated using (public.rvz_eh_membro());
