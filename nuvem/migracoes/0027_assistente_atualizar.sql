-- Reveza AI · 0027 · a versão do assistente de código em cada computador (pedido do Paulo, 15/10/2026: "temos dois
-- pcs, e eles estão com versões diferentes").
-- reaplicável: restrição recriada e função (create or replace).
--
-- A escolha `assistente_atualizar` é da instalação: "padrao" (o Reveza não mexe; vale sem a linha), "sozinho" (cada
-- agente roda a atualização do assistente de 6 em 6 horas, num momento calmo) ou "manual" (o agente desliga a
-- atualização automática do assistente e a versão só muda pelo Atualizar do painel). O pedido do painel para um
-- computador atualizar o assistente é o comando `atualizar` com o corpo {"assistente": true}: a ação já existe, e o
-- agente de antes da 0.8.0 recusa o corpo ("o pedido de atualização só leva a versão") sem mexer em nada.

-- A lista é a completa de hoje, igual à da última migração que recria a restrição (0026), mais `assistente_atualizar`:
-- reaplicada numa nuvem em uso, uma lista antiga recusaria as linhas que já usam os valores novos.
alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma', 'assistente_atualizar'));

-- O corpo da 0020, mais a escolha do assistente de código.
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
