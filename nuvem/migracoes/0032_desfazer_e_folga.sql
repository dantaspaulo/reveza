-- Reveza AI · 0032 · remover conta com desfazer e o aviso de folga acabando (pedidos do Paulo, 06/11/2026).
-- reaplicável: colunas com "if not exists", restrição e funções recriadas; a inclusão nos canais só roda na primeira vez.
--
-- 1. Remover conta ganha um prazo para desfazer (10 minutos; `remover_espera_min` na config muda). O clique passa o
--    computador que estava nela para outra (como na 0031), pausa a conta e marca `sai_em`. Nesse tempo nada se apaga:
--    login do cofre, janelas, histórico e a cópia do login nos computadores ficam. `painel_desfazer_remocao` devolve a
--    conta como estava, com a pausa de antes. Passado o prazo, o `vigiar` faz a remoção da 0031 (a marca em
--    `contas_removidas`, que os computadores leem para apagar a cópia do login, e o delete). Caso real: em 06/11 uma
--    conta saiu por engano e o computador apagou a cópia do login dois minutos depois.
-- 2. Folga acabando (`folga_acabando`): com duas ou mais contas em atividade e no máximo uma abaixo do aviso, a nuvem
--    avisa antes de faltar conta, com a conta que libera primeiro e a hora. No máximo um a cada 6 horas. O alerta de
--    sempre (`sem_livre`) só chega quando a troca já não acha para onde ir.

alter table public.contas add column if not exists sai_em timestamptz;
alter table public.contas add column if not exists pausada_antes boolean;
alter table public.contas add column if not exists saida_por uuid;

alter table public.alertas drop constraint if exists alertas_eventos_check;
alter table public.alertas add constraint alertas_eventos_check check (eventos <@ array['sem_livre', 'precisa_login',
  'computador_parado', 'login_vence', 'resumo_dia', 'troca', 'limite', 'atualizacao_falhou', 'troca_falhou',
  'folga_acabando']);

-- Canais e webhooks que já avisam quando falta conta livre passam a avisar também a folga acabando. Só na primeira
-- vez: quem tirar depois pelo painel não ganha de volta quando esta migração rodar de novo.
do $$
declare v_ja boolean := false;
begin
  if to_regclass('public.reveza_migracoes') is not null then
    execute 'select exists (select 1 from public.reveza_migracoes where nome = $1)' into v_ja using '0032_desfazer_e_folga.sql';
  end if;
  if not v_ja then
    update public.alertas set eventos = eventos || array['folga_acabando']
     where 'sem_livre' = any(eventos) and not ('folga_acabando' = any(eventos));
    update public.webhooks_saida set eventos = eventos || array['folga_acabando']
     where 'sem_livre' = any(eventos) and not ('folga_acabando' = any(eventos));
  end if;
end $$;

-- Painel (administrador com duas etapas): a conta sai do Reveza depois do prazo. O computador que estiver nela vai
-- antes para a melhor que houver; sem outra para ele, a conta fica (a pessoa troca ou pausa antes). Repetir o pedido
-- com a conta já saindo não muda o prazo.
create or replace function public.painel_remover_conta(p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
  v_pausada boolean;
  v_sai timestamptz;
  v_pc uuid;
  v_nome text;
  v_cand uuid;
  v_min int := greatest(1, least(1440, coalesce((public.rvz_cfg('remover_espera_min', '10') #>> '{}')::int, 10)));
begin
  perform public.rvz_exigir_admin();
  select email, pausada, sai_em into v_email, v_pausada, v_sai from public.contas where id = p_conta for update;
  if v_email is null then return jsonb_build_object('ok', false, 'erro', 'conta desconhecida'); end if;
  if v_sai is not null then return jsonb_build_object('ok', true, 'sai_em', v_sai); end if;
  -- uma conta está atribuída a um computador no máximo (índice único da 0007)
  select a.computador_id, q.nome into v_pc, v_nome
    from public.atribuicao a join public.computadores q on q.id = a.computador_id
   where a.conta_id = p_conta for update of a;
  if v_pc is not null then
    v_cand := public.rvz_escolher(v_pc, null, 100);
    if v_cand is null then
      return jsonb_build_object('ok', false, 'erro',
        format('o computador %s usa esta conta agora e não tem outra para ir: conecte ou libere outra conta antes', v_nome));
    end if;
    perform public.rvz_atribuir(v_pc, v_cand, 'a conta em uso foi removida');
  end if;
  v_sai := now() + make_interval(mins => v_min);
  update public.contas set sai_em = v_sai, pausada_antes = v_pausada, pausada = true, saida_por = auth.uid()
   where id = p_conta;
  perform public.rvz_auditar('remover_conta', p_conta::text, jsonb_build_object('email', v_email, 'sai_em', v_sai));
  perform public.rvz_evento('info', format('A conta %s sai do Reveza em %s minutos; até lá dá para desfazer no painel.', v_email, v_min),
                            jsonb_build_object('conta', p_conta, 'email', v_email, 'saindo', true, 'sai_em', v_sai, 'minutos', v_min));
  return jsonb_build_object('ok', true, 'computador', v_pc, 'para', v_cand, 'sai_em', v_sai);
end $$;

-- Painel: desfaz a remoção dentro do prazo. A conta volta com a pausa que tinha antes do clique.
create or replace function public.painel_desfazer_remocao(p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
  v_sai timestamptz;
  v_antes boolean;
begin
  perform public.rvz_exigir_admin();
  select email, sai_em, pausada_antes into v_email, v_sai, v_antes from public.contas where id = p_conta for update;
  if v_email is null then
    return jsonb_build_object('ok', false, 'erro', 'a conta já saiu do Reveza: conecte de novo para ela voltar');
  end if;
  if v_sai is null then return jsonb_build_object('ok', true); end if;
  update public.contas set sai_em = null, pausada = coalesce(v_antes, false), pausada_antes = null, saida_por = null
   where id = p_conta;
  perform public.rvz_auditar('desfazer_remocao', p_conta::text, jsonb_build_object('email', v_email));
  perform public.rvz_evento('info', format('A conta %s voltou ao Reveza: a remoção foi desfeita.', v_email),
                            jsonb_build_object('conta', p_conta, 'email', v_email, 'saindo', false));
  return jsonb_build_object('ok', true);
end $$;

-- A remoção de verdade, para as contas com o prazo vencido (o vigiar chama). Pausada, a conta não recebe computador;
-- se algum ainda está nela, vai antes para outra, e sem outra ela fica para a próxima volta.
create or replace function public.rvz_purgar_contas_saindo() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ct record;
  v_pc uuid;
  v_cand uuid;
  n int := 0;
begin
  for ct in select id, email, saida_por from public.contas where sai_em is not null and sai_em <= now()
             order by sai_em for update skip locked loop
    select a.computador_id into v_pc from public.atribuicao a where a.conta_id = ct.id for update of a;
    if v_pc is not null then
      v_cand := public.rvz_escolher(v_pc, null, 100);
      if v_cand is null then continue; end if;
      perform public.rvz_atribuir(v_pc, v_cand, 'a conta em uso foi removida');
    end if;
    insert into public.contas_removidas (conta_id, email, removida_por) values (ct.id, ct.email, ct.saida_por)
    on conflict (conta_id) do update set removida_em = now(), removida_por = excluded.removida_por;
    delete from public.contas where id = ct.id;
    perform public.rvz_evento('info', format('A conta %s saiu do Reveza.', ct.email),
                              jsonb_build_object('conta', ct.id, 'email', ct.email, 'removida', true));
    n := n + 1;
  end loop;
  return n;
end $$;

-- A folga de cada conta em atividade (sem pausa, com login, fora da remoção, com o login no cofre). Com folga: a
-- leitura em dia abaixo do aviso, abaixo do teto da semana e dentro da agenda; sem leitura conta como com folga (sem
-- saber, não avisa). `libera_em`: quando renovam todas as janelas que a seguram (acima do aviso, ou a semana no teto).
create or replace function public.rvz_folga_contas()
returns table (conta_id uuid, email text, efetivo numeric, com_folga boolean, libera_em timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with aviso as (select (public.rvz_cfg('aviso', '90') #>> '{}')::numeric as v),
  base as (
    select c.id, c.email, c.teto_semana, c.agenda, public.rvz_pct_efetivo(c.id) as ef,
           (select j.pct from public.uso_janelas j
             where j.conta_id = c.id and j.tipo = 'seven_day' and (j.reset_em is null or j.reset_em > now())) as semana
      from public.contas c
     where not c.pausada and not c.precisa_login and c.sai_em is null
       and exists (select 1 from public.cofre k where k.conta_id = c.id)
  )
  select b.id, b.email, b.ef,
         (b.ef is null or b.ef < a.v) and public.rvz_agenda_permite(b.agenda)
           and (b.teto_semana is null or coalesce(b.semana, 0) < b.teto_semana),
         (select max(j.reset_em) from public.uso_janelas j
           where j.conta_id = b.id and j.reset_em > now() and j.pct is not null
             and ((j.tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet') and j.pct >= a.v)
                  or (j.tipo = 'seven_day' and b.teto_semana is not null and j.pct >= b.teto_semana)))
    from base b cross join aviso a
$$;

-- O alerta de folga acabando, no máximo um a cada 6 horas. Devolve quantos gravou (0 ou 1).
create or replace function public.rvz_vigiar_folga() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_fuso text := coalesce(public.rvz_cfg('fuso', '"America/Sao_Paulo"') #>> '{}', 'UTC');
  v_ativas int;
  v_folga int;
  v_conta uuid;
  v_email text;
  v_pct numeric;
  v_prox uuid;
  v_prox_email text;
  v_libera timestamptz;
  v_quando text;
  v_texto text;
begin
  if exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'folga_acabando'
             and em > now() - interval '6 hours') then
    return 0;
  end if;
  select count(*), count(*) filter (where f.com_folga) into v_ativas, v_folga from public.rvz_folga_contas() f;
  if v_ativas < 2 or v_folga > 1 then return 0; end if;
  select f.conta_id, f.email, f.efetivo into v_conta, v_email, v_pct from public.rvz_folga_contas() f
   where f.com_folga limit 1;
  select f.conta_id, f.email, f.libera_em into v_prox, v_prox_email, v_libera from public.rvz_folga_contas() f
   where not f.com_folga and f.libera_em is not null order by f.libera_em, f.email limit 1;
  v_quando := to_char(v_libera at time zone v_fuso, 'DD/MM HH24:MI');
  v_texto := case
      when v_conta is null then 'Folga acabando: nenhuma conta com folga agora.'
      when v_pct is null then format('Folga acabando: só %s pode ter folga (está sem leitura agora).', v_email)
      else format('Folga acabando: só %s ainda tem folga (%s%%).', v_email, round(v_pct)) end
    || case when v_prox is not null then format(' A próxima libera em %s (%s).', v_quando, v_prox_email) else '' end;
  perform public.rvz_evento('alerta', v_texto, jsonb_build_object(
    'motivo', 'folga_acabando', 'ativas', v_ativas, 'com_folga', v_folga, 'aviso', v_aviso,
    'conta', v_conta, 'email', v_email, 'pct', v_pct,
    'proxima', v_prox, 'proxima_email', v_prox_email, 'libera_em', v_libera, 'libera_txt', v_quando));
  return 1;
end $$;

-- O corpo da 0006, mais a remoção das contas com o prazo vencido e a folga acabando.
create or replace function public.vigiar() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare pc record; ct record; n int := 0;
begin
  for pc in select id, nome, visto_em from public.computadores
             where not revogado and visto_em < now() - interval '3 minutes' and visto_em > now() - interval '7 days' loop
    if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'computador_parado'
                   and dados ->> 'computador' = pc.id::text and em > now() - interval '6 hours') then
      perform public.rvz_evento('alerta', format('O computador %s não dá notícia desde %s.', pc.nome,
                                to_char(pc.visto_em at time zone coalesce(public.rvz_cfg('fuso', '"America/Sao_Paulo"') #>> '{}', 'UTC'), 'DD/MM HH24:MI')),
                                jsonb_build_object('motivo', 'computador_parado', 'computador', pc.id));
      n := n + 1;
    end if;
  end loop;
  for ct in select id, email from public.contas where precisa_login and sai_em is null loop
    if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'precisa_login'
                   and dados ->> 'conta' = ct.id::text and em > now() - interval '24 hours') then
      perform public.rvz_evento('alerta', format('%s precisa entrar de novo.', ct.email),
                                jsonb_build_object('motivo', 'precisa_login', 'conta', ct.id));
      n := n + 1;
    end if;
  end loop;
  n := n + public.rvz_purgar_contas_saindo();
  n := n + public.rvz_vigiar_folga();
  return n;
end $$;

-- O corpo da 0031, mais: a conta saindo do Reveza não muda a pausa (desfazer a remoção é o caminho).
create or replace function public.painel_conta(p_conta uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_modelo text;
  v_pc uuid;
begin
  perform public.rvz_exigir_admin();
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('cor', 'prioridade', 'reserva', 'pausada', 'agenda', 'teto_semana', 'modelo') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if p_campos ? 'pausada' and exists (select 1 from public.contas where id = p_conta and sai_em is not null) then
    return jsonb_build_object('ok', false, 'erro', 'a conta está saindo do Reveza: desfaça a remoção antes de mudar a pausa');
  end if;
  if p_campos ? 'agenda' and not public.rvz_agenda_valida(p_campos -> 'agenda') then
    raise exception 'agenda inválida: lista de {"dias":[1..7], "de":"HH:MM", "ate":"HH:MM"}';
  end if;
  if p_campos ? 'modelo' then
    if jsonb_typeof(p_campos -> 'modelo') not in ('string', 'null') then
      raise exception 'modelo inválido';
    end if;
    v_modelo := nullif(lower(btrim(p_campos ->> 'modelo')), '');
    if v_modelo is not null and v_modelo !~ '^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$' then
      raise exception 'modelo inválido';
    end if;
  end if;
  update public.contas set
    cor = coalesce((p_campos ->> 'cor')::smallint, cor),
    prioridade = coalesce((p_campos ->> 'prioridade')::smallint, prioridade),
    reserva = coalesce((p_campos ->> 'reserva')::boolean, reserva),
    pausada = coalesce((p_campos ->> 'pausada')::boolean, pausada),
    agenda = coalesce(p_campos -> 'agenda', agenda),
    teto_semana = case when p_campos ? 'teto_semana' then (p_campos ->> 'teto_semana')::numeric else teto_semana end,
    modelo = case when p_campos ? 'modelo' then v_modelo else modelo end
  where id = p_conta;
  if not found then raise exception 'conta desconhecida'; end if;
  perform public.rvz_auditar('conta', p_conta::text, p_campos);
  if coalesce((p_campos ->> 'pausada')::boolean, false) then
    for v_pc in select a.computador_id from public.atribuicao a where a.conta_id = p_conta loop
      perform public.decidir(v_pc);
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end $$;
