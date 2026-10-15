-- Reveza AI · 0012 · impressão da chave do cofre (auditoria de segurança, 11/10/2026).
-- reaplicável: restrição recriada e função (create or replace).
--
-- A primeira chave do cofre registra uma impressão (HMAC da chave, 128 bits; não revela a chave). Computador novo só
-- aceita a chave que a frase abriu se a impressão bater; computador com outra chave não responde a pedido de ligação.
-- Quem grava a impressão é um computador, uma vez só; depois ela não muda por computador nenhum.

-- A lista é a completa de hoje, igual à da última migração que recria a restrição (0.4.6): reaplicada numa nuvem
-- em uso, uma lista antiga recusaria as linhas que já usam os valores novos e a atualização pararia no meio.
alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma'));

create or replace function public.agente_cofre_impressao(p_impressao text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  if p_impressao is not null then
    if p_impressao !~ '^[0-9a-f]{32}$' then raise exception 'impressão inválida'; end if;
    insert into public.config (chave, valor) values ('cofre_impressao', to_jsonb(p_impressao)) on conflict (chave) do nothing;
  end if;
  return jsonb_build_object('ok', true,
    'impressao', (select valor #>> '{}' from public.config where chave = 'cofre_impressao'));
end $$;
