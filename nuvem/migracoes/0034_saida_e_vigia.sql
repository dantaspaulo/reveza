-- Reveza AI · 0034 · a conta marcada para sair nunca saía e a vigia da nuvem parou junto; e conta esgotada não entra à
-- mão (pedidos do Paulo, 09/11/2026: "Uma conta que eu deveria ter removido, não saiu... tá marcado para sair do reveza
-- e não sai" e "Contas esgotadas não pode ser usadas, o botão de usar agora nem deve ficar ativo").
-- reaplicável: só funções (create or replace).
--
-- 1. O uso de tokens de uma conta removida fica, sem a conta (conta_id nulo). Quando a mesma hora, computador, projeto
--    e modelo já tinham uso de outra conta removida, a linha batia na chave única e derrubava a remoção inteira: desde
--    07/11 a vigiar() falhou de 2 em 2 minutos (1.559 vezes até 09/11), e com ela pararam os alertas de computador
--    parado e de conta sem login e o aviso de folga. Agora o uso dessa hora soma na linha que já existia.
-- 2. Cada passo da vigiar() e cada conta da remoção correm à parte: o que falhar vira um erro nos eventos (no máximo um
--    por hora para o mesmo passo) e não segura os outros.
-- 3. painel_trocar_agora recusa conta esgotada: 100% numa janela da conta que ainda não renovou (5 horas, semana ou a
--    semana de uma família de modelo). A troca automática já não as escolhia.

-- Um passo da vigia que falhou: um erro nos eventos, no máximo um por hora para o mesmo passo.
create or replace function public.rvz_erro_da_vigia(p_passo text, p_erro text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.eventos where tipo = 'erro' and dados ->> 'vigia' = p_passo
             and em > now() - interval '1 hour') then
    return;
  end if;
  perform public.rvz_evento('erro', format('A vigia da nuvem falhou em "%s": %s', p_passo, left(coalesce(p_erro, ''), 300)),
                            jsonb_build_object('vigia', p_passo));
end $$;

-- O corpo da 0032, com o uso de tokens somado e cada conta à parte.
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
    begin
      v_pc := null;
      select a.computador_id into v_pc from public.atribuicao a where a.conta_id = ct.id for update of a;
      if v_pc is not null then
        v_cand := public.rvz_escolher(v_pc, null, 100);
        if v_cand is null then continue; end if;
        perform public.rvz_atribuir(v_pc, v_cand, 'a conta em uso foi removida');
      end if;
      -- o uso dela fica, sem a conta; a hora que já tem uso de conta removida soma nele (a chave única é a mesma)
      update public.uso_tokens u
         set respostas = u.respostas + x.respostas, entrada = u.entrada + x.entrada, saida = u.saida + x.saida,
             cache_escrita = u.cache_escrita + x.cache_escrita, cache_leitura = u.cache_leitura + x.cache_leitura,
             usd = u.usd + x.usd, agentes = u.agentes + x.agentes
        from public.uso_tokens x
       where x.conta_id = ct.id and u.conta_id is null and u.hora = x.hora and u.computador_id = x.computador_id
         and u.projeto = x.projeto and u.modelo = x.modelo;
      delete from public.uso_tokens x
       where x.conta_id = ct.id
         and exists (select 1 from public.uso_tokens u where u.conta_id is null and u.hora = x.hora
                     and u.computador_id = x.computador_id and u.projeto = x.projeto and u.modelo = x.modelo);
      insert into public.contas_removidas (conta_id, email, removida_por) values (ct.id, ct.email, ct.saida_por)
      on conflict (conta_id) do update set removida_em = now(), removida_por = excluded.removida_por;
      delete from public.contas where id = ct.id;
      perform public.rvz_evento('info', format('A conta %s saiu do Reveza.', ct.email),
                                jsonb_build_object('conta', ct.id, 'email', ct.email, 'removida', true));
      n := n + 1;
    exception when others then
      perform public.rvz_erro_da_vigia(format('remover %s', ct.email), sqlerrm);
    end;
  end loop;
  return n;
end $$;

-- O corpo da 0006, com cada passo à parte.
create or replace function public.vigiar() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare pc record; ct record; n int := 0;
begin
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
  exception when others then
    perform public.rvz_erro_da_vigia('computador parado', sqlerrm);
  end;
  begin
    for ct in select id, email from public.contas where precisa_login and sai_em is null loop
      if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'precisa_login'
                     and dados ->> 'conta' = ct.id::text and em > now() - interval '24 hours') then
        perform public.rvz_evento('alerta', format('%s precisa entrar de novo.', ct.email),
                                  jsonb_build_object('motivo', 'precisa_login', 'conta', ct.id));
        n := n + 1;
      end if;
    end loop;
  exception when others then
    perform public.rvz_erro_da_vigia('conta sem login', sqlerrm);
  end;
  begin
    n := n + public.rvz_purgar_contas_saindo();
  exception when others then
    perform public.rvz_erro_da_vigia('remover contas', sqlerrm);
  end;
  begin
    n := n + public.rvz_vigiar_folga();
  exception when others then
    perform public.rvz_erro_da_vigia('folga', sqlerrm);
  end;
  return n;
end $$;

-- O corpo da 0011, mais a conta esgotada.
create or replace function public.painel_trocar_agora(p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
  end if;
  if exists (select 1 from public.contas where id = p_conta and (pausada or precisa_login)) then
    return jsonb_build_object('ok', false, 'erro', 'conta pausada ou sem login');
  end if;
  if exists (select 1 from public.uso_janelas j where j.conta_id = p_conta and j.pct >= 100
             and j.tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet')
             and (j.reset_em is null or j.reset_em > now())) then
    return jsonb_build_object('ok', false, 'erro', 'conta esgotada: espere a janela renovar');
  end if;
  if exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> p_computador) then
    return jsonb_build_object('ok', false, 'erro', 'a conta está em uso em outro computador');
  end if;
  if not exists (select 1 from public.cofre where conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'conta sem login guardado');
  end if;
  perform public.rvz_atribuir(p_computador, p_conta, 'pedido pelo painel');
  perform public.rvz_auditar('trocar', p_conta::text, jsonb_build_object('computador', p_computador));
  return jsonb_build_object('ok', true);
end $$;
