-- Reveza AI · 0018 · atualizar sozinho de madrugada (pedido do Paulo, 12/10/2026).
-- reaplicável: restrições recriadas e funções (create or replace).
--
-- A opção `atualizar_sozinho` (desligada de fábrica) faz cada agente, ao ver versão nova publicada, se atualizar sozinho
-- entre 3h e 5h no fuso da instalação, pelo mesmo caminho seguro do botão do painel. Um computador por vez: a vez fica em
-- `atualizacao_vez` ({computador, de, para, desde, estado}); o próximo só começa quando o anterior voltou na versão nova.
-- Se um voltou para a anterior (ou não voltou em 45 minutos), os outros não atualizam sozinhos e sai um alerta
-- (`atualizacao_falhou`); desligar e ligar a opção destrava.

-- A lista é a completa de hoje, igual à da última migração que recria a restrição (0.4.6): reaplicada numa nuvem
-- em uso, uma lista antiga recusaria as linhas que já usam os valores novos e a atualização pararia no meio.
alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma'));

alter table public.alertas drop constraint if exists alertas_eventos_check;
alter table public.alertas add constraint alertas_eventos_check check (eventos <@ array['sem_livre', 'precisa_login',
  'computador_parado', 'login_vence', 'resumo_dia', 'troca', 'limite', 'atualizacao_falhou', 'troca_falhou']);

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
    when 'atualizar_sozinho' then
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
    else
      raise exception 'configuração desconhecida';
  end case;
  insert into public.config (chave, valor, mudado_por, mudado_em) values (p_chave, p_valor, auth.uid(), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_por = excluded.mudado_por, mudado_em = now();
  if p_chave in ('modo', 'rodizio_minutos') then delete from public.config where chave = 'proximo_rodizio_em'; end if;
  -- ligar ou desligar a opção destrava a vez (inclusive depois de uma atualização sozinha que voltou para a anterior)
  if p_chave = 'atualizar_sozinho' then delete from public.config where chave = 'atualizacao_vez'; end if;
  perform public.rvz_auditar('config', p_chave, jsonb_build_object('valor', p_valor));
  return jsonb_build_object('ok', true);
end $$;

-- A vez de atualizar sozinho. Devolve {pode, motivo}. Quem pede é o agente, com a versão dele e a mais nova publicada.
create or replace function public.agente_vez_de_atualizar(p_de text, p_para text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_vez jsonb;
  v_dono uuid;
  v_versao text;
  v_nome text;
begin
  if coalesce(p_de, '') !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' or coalesce(p_para, '') !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then
    raise exception 'versão inválida';
  end if;
  if coalesce((public.rvz_cfg('atualizar_sozinho', 'false') #>> '{}')::boolean, false) is not true then
    return jsonb_build_object('pode', false, 'motivo', 'desligado');
  end if;
  perform pg_advisory_xact_lock(778802);
  select valor into v_vez from public.config where chave = 'atualizacao_vez';
  if v_vez is not null and v_vez ->> 'estado' = 'falhou' then
    return jsonb_build_object('pode', false, 'motivo', 'falhou');
  end if;
  if v_vez is not null and v_vez ->> 'estado' = 'em_andamento' then
    v_dono := (v_vez ->> 'computador')::uuid;
    select versao, nome into v_versao, v_nome from public.computadores where id = v_dono and not revogado;
    if v_dono = v_pc then
      return jsonb_build_object('pode', false, 'motivo', 'em_andamento');
    elsif v_versao is not distinct from (v_vez ->> 'para') then
      null; -- o anterior voltou na versão nova: a vez está livre
    elsif v_versao is not null and (v_vez ->> 'desde')::timestamptz > now() - interval '45 minutes' then
      return jsonb_build_object('pode', false, 'motivo', 'outro');
    else
      -- não voltou na versão nova a tempo (ou foi revogado no meio): os outros param, e vira alerta
      update public.config set valor = v_vez || jsonb_build_object('estado', 'falhou', 'motivo', 'não voltou na versão nova em 45 minutos'),
                               mudado_em = now()
       where chave = 'atualizacao_vez';
      perform public.rvz_evento('alerta',
        format('A atualização sozinha de %s para a %s não terminou: os outros computadores não vão se atualizar sozinhos até alguém conferir e ligar a opção de novo.',
               coalesce(v_nome, 'um computador'), v_vez ->> 'para'),
        jsonb_build_object('motivo', 'atualizacao_falhou', 'computador', v_dono, 'para', v_vez ->> 'para'));
      return jsonb_build_object('pode', false, 'motivo', 'falhou');
    end if;
  end if;
  insert into public.config (chave, valor, mudado_em)
  values ('atualizacao_vez', jsonb_build_object('computador', v_pc, 'de', p_de, 'para', p_para, 'desde', now(), 'estado', 'em_andamento'), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  return jsonb_build_object('pode', true);
end $$;

-- O fim da atualização sozinha, contado pelo agente que estiver de pé depois: 'concluida' (o novo subiu) libera a vez;
-- 'falhou' (voltou para a anterior) para os outros e vira alerta; 'nao_comecou' (o pacote nem baixou) só libera a vez.
create or replace function public.agente_atualizacao_resultado(p_para text, p_estado text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_vez jsonb;
  v_nome text;
begin
  if coalesce(p_estado, '') not in ('concluida', 'falhou', 'nao_comecou') then raise exception 'estado inválido'; end if;
  perform pg_advisory_xact_lock(778802);
  select valor into v_vez from public.config where chave = 'atualizacao_vez';
  if v_vez is null or (v_vez ->> 'computador')::uuid <> v_pc or v_vez ->> 'para' <> coalesce(p_para, '') or v_vez ->> 'estado' <> 'em_andamento' then
    return jsonb_build_object('ok', false);
  end if;
  if p_estado = 'nao_comecou' then
    delete from public.config where chave = 'atualizacao_vez';
  elsif p_estado = 'concluida' then
    update public.config set valor = v_vez || jsonb_build_object('estado', 'concluida', 'fim', now()), mudado_em = now()
     where chave = 'atualizacao_vez';
  else
    update public.config set valor = v_vez || jsonb_build_object('estado', 'falhou', 'motivo', left(coalesce(p_motivo, ''), 200)), mudado_em = now()
     where chave = 'atualizacao_vez';
    select nome into v_nome from public.computadores where id = v_pc;
    perform public.rvz_evento('alerta',
      format('A atualização sozinha de %s para a %s não deu certo e ele voltou para a anterior: os outros computadores não vão se atualizar sozinhos até alguém conferir e ligar a opção de novo.',
             coalesce(v_nome, 'um computador'), p_para),
      jsonb_build_object('motivo', 'atualizacao_falhou', 'computador', v_pc, 'para', p_para, 'erro', left(coalesce(p_motivo, ''), 200)));
  end if;
  return jsonb_build_object('ok', true);
end $$;
