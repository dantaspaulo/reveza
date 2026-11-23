-- Reveza AI · 0043 · cadastro operacional: a conta só da empresa ou do projeto, e a pasta de cada computador. Só acrescenta.
-- reaplicável: tudo com "if not exists"; a troca do índice não mexe em dado. As funções ficam na 0044.
--
-- so_contas_dela: a empresa ou o projeto roda só nas contas marcadas, sem transbordo e sem cair na conta do computador.
-- Nasce falso: quem já usa empresas ligadas segue como antes até salvar pela tela nova.
-- computador_id: a pasta vale só naquele computador; null (como todas as regras de antes) vale em todos.

alter table public.empresas add column if not exists so_contas_dela boolean not null default false;
alter table public.pastas_empresa add column if not exists computador_id uuid references public.computadores on delete cascade;

-- A conta em uso fica no computador enquanto uma sessão de unidade estrita rodar nela (o agente renova; vence sozinho).
alter table public.atribuicao add column if not exists segura_ate timestamptz;
alter table public.atribuicao add column if not exists segura_unidades uuid[] not null default '{}';

-- As unidades que já foram mandadas para esta trilha neste computador: pode haver sessão delas neste login até a trilha
-- soltar, mesmo depois que as listas de contas deixarem de ser iguais.
alter table public.atribuicao_trilhas add column if not exists unidades uuid[] not null default '{}';

-- A mesma pasta pode ser de empresas diferentes em computadores diferentes. Troca de índice: nenhum dado sai.
create unique index if not exists pastas_empresa_chave
  on public.pastas_empresa (tipo, padrao, coalesce(computador_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.pastas_empresa drop constraint if exists pastas_empresa_tipo_padrao_key;
create index if not exists pastas_empresa_computador on public.pastas_empresa (computador_id);
