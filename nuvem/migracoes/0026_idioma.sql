-- Reveza AI · 0026 · o idioma da instalação (inglês ao lado do português, 13/10/2026).
-- reaplicável: restrição recriada e função (create or replace); o instalador roda de novo quando o arquivo muda.
--
-- O alerta que sai pelos canais (Telegram, e-mail, webhook, celular) usa o texto que a nuvem gravou em português. Quem
-- escolhe a língua do alerta é a instalação, não uma pessoa (os canais são da instalação): a configuração `idioma`
-- ("pt-BR" ou "en"), gravada pelo instalador, vai junto com os alertas pendentes e a função de alertas escreve a
-- mensagem na língua dela. Sem a configuração, ou com valor que não seja um dos dois, vale pt-BR. O painel não grava
-- `idioma` (painel_config segue recusando chave que não conhece): cada pessoa escolhe o próprio idioma no painel.

-- A lista é a completa de hoje, igual à da última migração que recria a restrição (0.4.6), mais `idioma`: reaplicada numa
-- nuvem em uso, uma lista antiga recusaria as linhas que já usam os valores novos e a atualização pararia no meio.
alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma'));

-- O corpo da 0010, mais o idioma da instalação ao lado de eventos, canais e webhooks.
create or replace function public.alertas_pendentes(p_limite integer default 50) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ate bigint := coalesce((public.rvz_cfg('alertas_ate', '0') #>> '{}')::bigint, 0);
  v_idioma text := coalesce(public.rvz_cfg('idioma', '"pt-BR"') #>> '{}', 'pt-BR');
  v_eventos jsonb;
  v_canais jsonb;
  v_max bigint;
begin
  if v_idioma not in ('pt-BR', 'en') then v_idioma := 'pt-BR'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'em', em, 'tipo', tipo, 'texto', texto, 'dados', dados) order by id), '[]'),
         max(id)
    into v_eventos, v_max
    from (select * from public.eventos
           where id > v_ate and origem = 'nuvem' and tipo in ('alerta', 'troca', 'limite')
           order by id limit p_limite) e;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'canal', canal, 'destino', destino - 'vault_id',
                                               'tem_segredo', destino ? 'vault_id', 'eventos', eventos)), '[]')
    into v_canais from public.alertas where ativo;
  if v_max is not null then
    insert into public.config (chave, valor) values ('alertas_ate', to_jsonb(v_max))
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  return jsonb_build_object('eventos', v_eventos, 'canais', v_canais, 'idioma', v_idioma,
    'webhooks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'eventos', eventos)), '[]')
                   from public.webhooks_saida where ativo and segredo_vault_id is not null));
end $$;
