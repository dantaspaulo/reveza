-- Reveza AI · 0033 · sessões críticas, a leitura velha que escondia a semana cheia e a troca que prefere a mesma
-- organização (pedidos do Paulo, 07/11/2026: "Todas as contas esgotaram e tudo parou... Tenho sessões de monitoramento e
-- erros que não podem jamais parar" e "tivemos em 24h 50 trocas de contas... isso não é bom né?").
-- reaplicável: restrição recriada e funções (create or replace).
--
-- 1. Sessões críticas: `criticas` (liga) e `criticas_gatilho` (50 a 95, 75 de fábrica) na config. A nuvem só guarda a
--    escolha e a entrega aos computadores pelo agente_ola; cada agente decide quando segurar as sessões comuns (nenhuma
--    conta com folga abaixo do gatilho) e o mod de cada sessão segura.
-- 2. Leitura velha: a rvz_pct_efetivo só contava a janela lida há menos de 15 minutos (ou já renovada). Com a leitura
--    de uso limitada pelo provedor, a janela da semana ficava velha e saía da conta, enquanto a de 5 horas já renovada
--    entrava como zero: uma conta com a semana em 100% aparecia em 0% e era escolhida. Medido em 07/11: 14 de 33 trocas
--    do Mac mini foram para uma conta em 94% ou mais, e 3 voltaram em 16 segundos. Agora toda janela que ainda não
--    renovou vale como piso (o uso só cresce até o reset). Sem nenhuma leitura recente, a conta continua sem número.
-- 3. Mesma organização: o cache da conversa é da organização. Trocar para outra fez 67% das sessões abertas mandarem a
--    conversa inteira de novo (17% na mesma organização); cerca de 11% do gasto de 48 h. Entre as candidatas, a da mesma
--    organização da conta em uso vem antes, desde que tenha folga de verdade (30 pontos até o gatilho de troca): uma
--    quase cheia daria outra troca logo depois.

alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma', 'assistente_atualizar', 'criticas', 'criticas_gatilho'));

-- O corpo da 0027, mais as sessões críticas.
create or replace function public.painel_config(p_chave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_aviso numeric; v_troca numeric;
begin
  perform public.rvz_exigir_admin();
  case p_chave
    when 'auto', 'retomar_terminal' then
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
    when 'exigir_duas_etapas' then
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
      -- exigir sem ter as próprias duas etapas trancaria quem ligou do lado de fora
      if (p_valor #>> '{}')::boolean and not public.rvz_tem_duas_etapas(auth.uid()) then
        raise exception 'ative as suas duas etapas antes de exigir dos administradores';
      end if;
    when 'modo' then
      if coalesce(p_valor #>> '{}', '') not in ('limite', 'limiar', 'rodizio') then raise exception 'modo desconhecido'; end if;
    when 'aviso', 'troca' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 1 and 100 then
        raise exception 'limiar entre 1 e 100';
      end if;
      v_aviso := case when p_chave = 'aviso' then (p_valor #>> '{}')::numeric else (public.rvz_cfg('aviso', '90') #>> '{}')::numeric end;
      v_troca := case when p_chave = 'troca' then (p_valor #>> '{}')::numeric else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end;
      if v_aviso >= v_troca then raise exception 'o aviso precisa ser menor que a troca'; end if;
    when 'rodizio_minutos' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 15 and 480 then
        raise exception 'rodízio de 15 a 480 minutos';
      end if;
    when 'rodizio_ordem' then
      if coalesce(p_valor #>> '{}', '') not in ('aleatoria', 'menor_uso') then raise exception 'ordem desconhecida'; end if;
    when 'intervalo_s' then
      -- o tempo de atualização que a pessoa escolhe no painel
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not in (5, 10, 15, 30) then
        raise exception 'tempo de atualização: 5, 10, 15 ou 30 segundos';
      end if;
    when 'espera_entre_trocas_s' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 30 and 3600 then
        raise exception 'espera de 30 a 3600 segundos';
      end if;
    when 'fuso' then
      if not exists (select 1 from pg_timezone_names where name = p_valor #>> '{}') then raise exception 'fuso desconhecido'; end if;
    when 'assistente_atualizar' then
      -- o assistente de código (0.8.0): o jeito dele, sempre a mais nova (o agente atualiza) ou só pelo painel
      if jsonb_typeof(p_valor) <> 'string' or p_valor #>> '{}' not in ('padrao', 'sozinho', 'manual') then
        raise exception 'assistente: padrao, sozinho ou manual';
      end if;
    when 'criticas' then
      -- sessões críticas (0.15.0): sem conta com folga abaixo do gatilho, só as sessões marcadas seguem
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
    when 'criticas_gatilho' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 50 and 95 then
        raise exception 'gatilho das sessões críticas de 50 a 95';
      end if;
    when 'atualizar_sozinho' then
      if jsonb_typeof(p_valor) = 'boolean' then
        null;
      elsif jsonb_typeof(p_valor) = 'string' and p_valor #>> '{}' in ('desligada', 'madrugada', 'assim_que_sair') then
        -- os dois jeitos de antes ficam como eram (false e true): todo agente entende
        if p_valor #>> '{}' = 'desligada' then p_valor := 'false'::jsonb;
        elsif p_valor #>> '{}' = 'madrugada' then p_valor := 'true'::jsonb;
        end if;
      else
        raise exception 'atualizar sozinho: desligada, madrugada ou assim_que_sair';
      end if;
    else
      raise exception 'configuração desconhecida';
  end case;
  insert into public.config (chave, valor, mudado_por, mudado_em) values (p_chave, p_valor, auth.uid(), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_por = excluded.mudado_por, mudado_em = now();
  if p_chave in ('modo', 'rodizio_minutos') then delete from public.config where chave = 'proximo_rodizio_em'; end if;
  -- gravar a escolha (mesmo a mesma: é o Retomar do painel) destrava a vez parada, depois de uma atualização sozinha que
  -- voltou para a anterior. A que está em andamento fica: apagá-la daria a vez a outro computador com este ainda no meio,
  -- e o resultado dele (inclusive a volta para a anterior) não acharia a vez para parar os outros.
  if p_chave = 'atualizar_sozinho' then
    delete from public.config where chave = 'atualizacao_vez' and valor ->> 'estado' is distinct from 'em_andamento';
  end if;
  perform public.rvz_auditar('config', p_chave, jsonb_build_object('valor', p_valor));
  return jsonb_build_object('ok', true);
end $$;

-- O uso que decide: o maior entre as janelas lidas há menos de 15 minutos (a renovada conta zero), como antes, e nunca
-- abaixo da última leitura de uma janela que ainda não renovou.
create or replace function public.rvz_pct_efetivo(p_conta uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case when x.recente is null then null else greatest(x.recente, coalesce(x.piso, 0)) end
    from (select max(case when j.reset_em is not null and j.reset_em <= now() then 0 else j.pct end)
                   filter (where j.lido_em > now() - interval '15 minutes' or (j.reset_em is not null and j.reset_em <= now()))
                   as recente,
                 max(j.pct) filter (where j.reset_em is not null and j.reset_em > now()) as piso
            from public.uso_janelas j
           where j.conta_id = p_conta and j.pct is not null
             and j.tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet')) x
$$;

-- A candidata é da mesma organização da conta em uso no computador e tem folga de verdade (30 pontos até o gatilho).
create or replace function public.rvz_mesma_org(p_conta uuid, p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select c.organizacao is not null and c.organizacao = atual.organizacao
           and public.rvz_pct_efetivo(c.id) <= (case when public.rvz_cfg('modo', '"limiar"') #>> '{}' = 'limite' then 100
                                                     else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end) - 30
      from public.contas c,
           (select k.organizacao from public.atribuicao a join public.contas k on k.id = a.conta_id
             where a.computador_id = p_pc) atual
     where c.id = p_conta), false)
$$;

-- O corpo da 0028, mais a mesma organização antes da ordem de preferência.
create or replace function public.rvz_candidatas(p_pc uuid, p_ordem text default 'preferencia') returns table (conta_id uuid, efetivo numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, public.rvz_pct_efetivo(c.id)
    from public.contas c
   where not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id <> p_pc)
     and not exists (select 1 from public.posse p where p.conta_id = c.id and p.computador_id <> p_pc and p.expira_em > now())
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id = p_pc)
     and not exists (select 1 from public.contas_sem_modelo s where s.conta_id = c.id and s.computador_id = p_pc and s.ate > now())
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < (public.rvz_cfg('aviso', '90') #>> '{}')::numeric
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            public.rvz_mesma_org(c.id, p_pc) desc,
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

-- O corpo da 0031, mais a mesma organização antes da folga.
create or replace function public.rvz_socorro(p_pc uuid, p_teto numeric) returns table (conta_id uuid, efetivo numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, public.rvz_pct_efetivo(c.id)
    from public.contas c
   where not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id <> p_pc)
     and not exists (select 1 from public.posse p where p.conta_id = c.id and p.computador_id <> p_pc and p.expira_em > now())
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id = p_pc)
     and not exists (select 1 from public.contas_sem_modelo s where s.conta_id = c.id and s.computador_id = p_pc and s.ate > now())
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < p_teto
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            public.rvz_mesma_org(c.id, p_pc) desc,
            public.rvz_pct_efetivo(c.id),
            c.prioridade,
            c.email
$$;
