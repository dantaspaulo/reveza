-- Reveza AI · 0009 · verificação em duas etapas opcional (pedido do Paulo em 11/10/2026: "quero que seja possível
-- pular"). Quem ATIVOU as duas etapas continua precisando do código em toda sessão; quem não ativou age só com a
-- senha, a não ser que a instalação exija (config exigir_duas_etapas, ligada no painel).
-- reaplicável: restrição recriada e funções (create or replace); o instalador roda de novo quando o arquivo muda.

-- A lista é a completa de hoje, igual à da última migração que recria a restrição (0.4.6): reaplicada numa nuvem
-- em uso, uma lista antiga recusaria as linhas que já usam os valores novos e a atualização pararia no meio.
alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma'));

-- A instalação exige as duas etapas de todo administrador?
create or replace function public.rvz_exige_duas_etapas() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (valor #>> '{}')::boolean from public.config where chave = 'exigir_duas_etapas'), false)
$$;

-- O usuário tem as duas etapas ativas (fator TOTP verificado)?
create or replace function public.rvz_tem_duas_etapas(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
$$;

-- Vale como "duas etapas confirmadas": a sessão passou pelo código, ou a pessoa não ativou e a instalação não exige.
create or replace function public.rvz_aal2() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or (auth.uid() is not null and not public.rvz_exige_duas_etapas() and not public.rvz_tem_duas_etapas(auth.uid()))
$$;

-- Para as Edge Functions (chave de serviço): a mesma regra, com o nível de verificação do token de quem chamou.
create or replace function public.servico_aal_ok(p_user uuid, p_aal text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_aal, '') = 'aal2'
      or (not public.rvz_exige_duas_etapas() and not public.rvz_tem_duas_etapas(p_user))
$$;
