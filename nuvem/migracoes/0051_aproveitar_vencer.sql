-- Reveza AI · 0051 · usar primeiro a conta cuja semana vai renovar com sobra.
-- reaplicável: restrição recriada e funções (create or replace).
--
-- A sobra da semana que renova sem uso se perde. A ordem de antes escolhia a menos usada, que costuma ser justamente a
-- que tem mais tempo até renovar, enquanto outra conta renova logo com muitos pontos sobrando.
--
-- Desligado de fábrica (`aproveitar_vencer`, falso): nada muda para quem não ligar. Ligado, entre as candidatas que já
-- entrariam (o filtro não muda), a conta cuja semana renova em até `aproveitar_horas` (12 a 168, 48 de fábrica), com
-- 20 pontos de folga até o gatilho de troca (e até o teto da semana da conta, quando há), vem antes das outras, a que
-- renova antes primeiro. A preferida do
-- computador, a reserva e a preferida de outro computador seguem na frente; a mesma organização vem depois (a sobra
-- perdida pesa mais que o cache de uma troca). Vale na conta do computador (inclusive no rodízio), nas trilhas dos
-- projetos e na sombra. O socorro (todas acima do aviso, ou a busca com teto acima do aviso nas trilhas e na sombra)
-- segue pela de mais folga, como antes.

alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma', 'assistente_atualizar', 'criticas', 'criticas_gatilho', 'aproveitar_vencer',
  'aproveitar_horas'));

-- A semana da conta vai renovar logo, com folga para usar: devolve o reset (para ordenar, o mais perto primeiro); senão,
-- nulo. Folga de 20 pontos até o gatilho de troca (100 no modo limite): menos que isso daria outra troca logo depois. A
-- conta com teto da semana precisa dos mesmos 20 pontos até o teto: em uso, ela só sai pelo gatilho. O prazo vale só como
-- número inteiro de 12 a 168 (72.0 conta como 72); outro valor gravado por fora do painel vale 48, como no agente, sem
-- derrubar a escolha.
create or replace function public.rvz_vence_logo(p_conta uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select j.reset_em
    from public.uso_janelas j
    join public.contas c on c.id = j.conta_id
   where j.conta_id = p_conta and j.tipo = 'seven_day'
     and coalesce((public.rvz_cfg('aproveitar_vencer', 'false') #>> '{}')::boolean, false)
     and j.pct is not null
     and (c.teto_semana is null or j.pct <= c.teto_semana - 20)
     and j.reset_em > now()
     and j.reset_em <= now() + make_interval(hours => (
           select case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 12 and 168
                        and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
                       then (v #>> '{}')::numeric::int else 48 end
             from (select public.rvz_cfg('aproveitar_horas', '48') as v) x))
     and public.rvz_pct_efetivo(p_conta) <= (case when public.rvz_cfg('modo', '"limiar"') #>> '{}' = 'limite' then 100
                                                  else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end) - 20
$$;

-- O corpo da 0033, mais as duas chaves.
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
    when 'aproveitar_vencer' then
      -- usar primeiro a conta cuja semana vai renovar com sobra (0.22.3)
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
    when 'aproveitar_horas' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 12 and 168
         or (p_valor #>> '{}')::numeric <> trunc((p_valor #>> '{}')::numeric) then
        raise exception 'a semana que renova em até 12 a 168 horas (número inteiro)';
      end if;
      p_valor := to_jsonb(trunc((p_valor #>> '{}')::numeric)::int);
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

-- O corpo da 0039, mais a que vence logo depois da preferida de outro computador.
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
     and public.rvz_principal_pode(c.id)
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < (public.rvz_cfg('aviso', '90') #>> '{}')::numeric
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            public.rvz_vence_logo(c.id) nulls last,
            public.rvz_mesma_org(c.id, p_pc) desc,
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

-- O corpo da 0044, mais a que vence logo depois das contas de outra unidade estrita (só na busca até o aviso: acima
-- dele é socorro, que segue pela de mais folga).
create or replace function public.rvz_candidatas_trilha(p_pc uuid, p_emp uuid, p_teto numeric, p_transbordo boolean)
returns table (conta_id uuid, efetivo numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, public.rvz_pct_efetivo(c.id)
    from public.contas c
   where not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id)
     and not exists (select 1 from public.atribuicao_trilhas t where t.conta_id = c.id)
     and not exists (select 1 from public.posse p where p.conta_id = c.id and p.computador_id <> p_pc and p.expira_em > now())
     and not exists (select 1 from public.contas_sem_modelo s where s.conta_id = c.id and s.computador_id = p_pc and s.ate > now())
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_serve_trilha(c.id, p_emp, p_transbordo)
     and not exists (select 1 from unnest(public.rvz_dividem_trilha(p_pc, p_emp)) as m(id)
                      where not (c.id = any (public.rvz_contas_efetivas(m.id))))
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and (p_teto is null or public.rvz_pct_efetivo(c.id) < p_teto)
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.reserva,
            (select count(*) from public.empresas u
              where u.id <> p_emp and u.so_contas_dela and public.rvz_unidade_de(u.id) = u.id
                and public.rvz_unidade_ligada(u.id) and c.id = any (public.rvz_contas_efetivas(u.id))
                and public.rvz_contas_efetivas(u.id) <> public.rvz_contas_efetivas(p_emp)),
            case when p_teto <= (public.rvz_cfg('aviso', '90') #>> '{}')::numeric then public.rvz_vence_logo(c.id) end nulls last,
            public.rvz_pct_efetivo(c.id), c.prioridade, c.email
$$;

-- O corpo da 0041, mais a que vence logo depois da reserva (a sombra prevê a trilha; só na busca até o aviso).
create or replace function public.rvz_candidatas_sombra(p_pc uuid, p_emp uuid, p_teto numeric, p_transbordo boolean)
returns table (conta_id uuid, efetivo numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, public.rvz_pct_efetivo(c.id)
    from public.contas c
   where not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao_trilhas t where t.conta_id = c.id)
     and not exists (select 1 from public.trilhas_sombra s where s.conta_id = c.id
                      and (s.computador_id, s.empresa_id) <> (p_pc, p_emp))
     and not exists (select 1 from public.contas_sem_modelo s where s.conta_id = c.id and s.computador_id = p_pc and s.ate > now())
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_serve_trilha(c.id, p_emp, p_transbordo)
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and (p_teto is null or public.rvz_pct_efetivo(c.id) < p_teto)
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.reserva,
            case when p_teto <= (public.rvz_cfg('aviso', '90') #>> '{}')::numeric then public.rvz_vence_logo(c.id) end nulls last,
            public.rvz_pct_efetivo(c.id), c.prioridade, c.email
$$;
