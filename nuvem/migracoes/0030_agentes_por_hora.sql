-- Reveza AI · 0030 · os agentes contados pela hora em que começaram, não pela sessão (relato do Paulo, 03/11/2026:
-- "Será que tá contabilizando mesmo os agents usados?").
-- reaplicável: coluna com "if not exists" e função (create or replace).
--
-- O painel somava os agentes das sessões que COMEÇARAM no período. Sessão de editor fica aberta por semanas (no Mac do
-- Paulo, três estavam abertas desde julho, agosto e setembro), e os agentes que ela dispara no período ficavam de
-- fora: em 30 dias o painel mostrava 1.089 agentes no Mac e o registro do próprio Mac tinha 1.615. Agora cada linha de
-- uso por hora leva quantos agentes começaram naquela hora, conta, projeto e modelo, e o painel soma isso.
-- Agente antigo (que não manda o número) grava 0, como antes.

alter table public.uso_tokens add column if not exists agentes integer not null default 0 check (agentes >= 0);

create or replace function public.agente_relatar_tokens(p_linhas jsonb, p_sessoes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
begin
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 1000 then raise exception 'linhas inválidas'; end if;
  insert into public.uso_tokens (hora, conta_id, computador_id, projeto, modelo, respostas, entrada, saida,
                                 cache_escrita, cache_leitura, usd, agentes)
  select date_trunc('hour', (l ->> 'hora')::timestamptz), nullif(l ->> 'conta_id', '')::uuid, v_pc,
         left(replace(coalesce(l ->> 'projeto', ''), '/', ''), 120), left(l ->> 'modelo', 80),
         (l ->> 'respostas')::int, (l ->> 'entrada')::bigint, (l ->> 'saida')::bigint,
         (l ->> 'cache_escrita')::bigint, (l ->> 'cache_leitura')::bigint, (l ->> 'usd')::numeric,
         greatest(coalesce((l ->> 'agentes')::int, 0), 0)
    from jsonb_array_elements(p_linhas) l
   where (l ->> 'hora')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
  on conflict (hora, coalesce(conta_id, '00000000-0000-0000-0000-000000000000'::uuid), computador_id, projeto, modelo)
  do update set respostas = excluded.respostas, entrada = excluded.entrada, saida = excluded.saida,
                cache_escrita = excluded.cache_escrita, cache_leitura = excluded.cache_leitura, usd = excluded.usd,
                agentes = excluded.agentes;
  if jsonb_typeof(p_sessoes) = 'array' and jsonb_array_length(p_sessoes) <= 200 then
    insert into public.sessoes (id, computador_id, projeto, inicio, fim, respostas, tokens, usd, agentes, contas, modelos)
    select left(s ->> 'id', 80), v_pc, left(replace(coalesce(s ->> 'projeto', ''), '/', ''), 120),
           (s ->> 'inicio')::timestamptz, (s ->> 'fim')::timestamptz, (s ->> 'respostas')::int,
           (s ->> 'tokens')::bigint, (s ->> 'usd')::numeric, (s ->> 'agentes')::int,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(s -> 'contas') x), '{}'),
           coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(s -> 'modelos') x), '{}')
      from jsonb_array_elements(p_sessoes) s
     where (s ->> 'inicio')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
       and (s ->> 'fim')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
    on conflict (id) do update set fim = excluded.fim, respostas = excluded.respostas, tokens = excluded.tokens,
                                   usd = excluded.usd, agentes = excluded.agentes, contas = excluded.contas,
                                   modelos = excluded.modelos
    where sessoes.computador_id = v_pc;
  end if;
  return jsonb_build_object('ok', true);
end $$;
