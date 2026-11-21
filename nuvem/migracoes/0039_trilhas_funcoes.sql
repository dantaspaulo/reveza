-- Reveza AI · 0039 · as funções das trilhas (a tabela está na 0038).
-- reaplicável: só funções (create or replace).
--
-- 1. rvz_principal_pode: a conta do computador (a principal) não usa conta que está numa trilha nem conta que é só de
--    empresas separadas. Entra em rvz_candidatas, rvz_socorro, rvz_atribuir, decidir e agente_ola. Sem empresa
--    separada e sem trilha, ela é sempre verdadeira e nada muda.
-- 2. rvz_candidatas_trilha, rvz_escolher_trilha e rvz_decidir_trilha: a conta de cada trilha, com as mesmas regras da
--    principal (pausada, sem login, sem o modelo, agenda, teto da semana, posse de outro computador, aviso e gatilho)
--    e o transbordo da empresa quando as contas dela enchem.
-- 3. agente_empresas (as empresas separadas e as regras de pasta delas, para o agente classificar as sessões) e
--    agente_trilhas (o agente diz quais trilhas têm sessão e recebe a conta de cada uma).
-- 4. agente_limite e agente_pegar_posse sabem das trilhas; painel_empresa guarda "separar"; a troca à mão (painel e
--    API) recusa a conta que a principal não pode usar; revogar e remover conta cuidam das trilhas.

-- ------------------------------------------------------------------------------------------- quem a principal usa
create or replace function public.rvz_em_trilha(p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.atribuicao_trilhas t where t.conta_id = p_conta)
$$;

-- A conta tem marca de empresa e todas as empresas marcadas estão separadas: ela é só delas.
create or replace function public.rvz_so_de_separadas(p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.conta_empresas ce where ce.conta_id = p_conta)
     and not exists (select 1 from public.conta_empresas ce join public.empresas e on e.id = ce.empresa_id
                      where ce.conta_id = p_conta and not e.separar)
$$;

create or replace function public.rvz_principal_pode(p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not public.rvz_em_trilha(p_conta) and not public.rvz_so_de_separadas(p_conta)
$$;

-- O corpo da 0033, mais rvz_principal_pode.
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
            public.rvz_mesma_org(c.id, p_pc) desc,
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

-- O corpo da 0033, mais rvz_principal_pode.
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
     and public.rvz_principal_pode(c.id)
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

-- O corpo da 0003, mais: conta numa trilha não vai para a principal (nem pedida à mão).
create or replace function public.rvz_atribuir(p_pc uuid, p_conta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_de uuid;
begin
  -- uma atribuição de cada vez no projeto inteiro: duas decisões simultâneas não dão a mesma conta a dois computadores
  perform pg_advisory_xact_lock(778801);
  if p_conta is not null and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> p_pc) then
    return;
  end if;
  if p_conta is not null and public.rvz_em_trilha(p_conta) then
    return;
  end if;
  select conta_id into v_de from public.atribuicao where computador_id = p_pc;
  insert into public.atribuicao (computador_id, conta_id, motivo, versao, decidido_em)
  values (p_pc, p_conta, p_motivo, 1, now())
  on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                            versao = atribuicao.versao + 1, decidido_em = now();
  perform public.rvz_evento('troca',
    format('Troca: %s → %s (%s).',
           coalesce((select email from public.contas where id = v_de), 'nenhuma'),
           coalesce((select email from public.contas where id = p_conta), 'nenhuma'), p_motivo),
    jsonb_build_object('computador', p_pc, 'de', v_de, 'para', p_conta, 'motivo', p_motivo));
end $$;

-- ------------------------------------------------------------------------------------------- a conta de cada trilha
-- A conta serve à trilha da empresa: marcada para ela, ou (p_transbordo) do transbordo dela. "qualquer": as que a
-- principal pode usar (sem as que são só de outras empresas separadas); "escolhidas": a lista; "nenhum": nenhuma.
create or replace function public.rvz_serve_trilha(p_conta uuid, p_emp uuid, p_transbordo boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.conta_empresas ce where ce.conta_id = p_conta and ce.empresa_id = p_emp)
      then not p_transbordo
    when not p_transbordo then false
    else coalesce((select case e.transbordo
                            when 'qualquer' then not public.rvz_so_de_separadas(p_conta)
                            when 'escolhidas' then p_conta = any(e.transbordo_contas)
                            else false end
                     from public.empresas e where e.id = p_emp), false)
  end
$$;

-- As livres para a trilha (p_pc, p_emp), abaixo de p_teto: sem atribuição em lugar nenhum (principal ou trilha), sem
-- posse de outro computador e com as regras de sempre. As de reserva por último; depois a menos usada.
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
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and (p_teto is null or public.rvz_pct_efetivo(c.id) < p_teto)
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.reserva, public.rvz_pct_efetivo(c.id), c.prioridade, c.email
$$;

-- Para onde a trilha vai. `p_atual`: o uso da conta em uso (a nova tem de ter menos; null quando a em uso não serve).
-- `p_ate`: o gatilho na troca comum; 100 com a em uso cheia, pausada, sem login ou fora da empresa. `p_nova`: a trilha
-- ainda não tem conta; sem nenhuma abaixo de 100, fica com a da empresa menos usada, mesmo cheia (as sessões esperam a
-- volta do crédito, como no transbordo "nenhum"). Null quando não há conta para a trilha.
create or replace function public.rvz_escolher_trilha(p_pc uuid, p_emp uuid, p_atual numeric, p_ate numeric,
                                                      p_nova boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_gatilho numeric := least(p_ate, case when public.rvz_cfg('modo', '"limiar"') #>> '{}' = 'limite' then 100
                                         else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end);
  v uuid;
  v_t boolean;
begin
  -- 1. as da empresa e depois o transbordo: a livre (abaixo do aviso) e, sem ela, abaixo do gatilho com menos uso
  foreach v_t in array array[false, true] loop
    select k.conta_id into v from public.rvz_candidatas_trilha(p_pc, p_emp, v_aviso, v_t) k limit 1;
    if v is not null then return v; end if;
    select k.conta_id into v from public.rvz_candidatas_trilha(p_pc, p_emp, v_gatilho, v_t) k
     where p_atual is null or k.efetivo < p_atual limit 1;
    if v is not null then return v; end if;
  end loop;
  -- 2. a em uso não serve mais: qualquer uma abaixo de 100%, da empresa antes
  if p_ate > v_gatilho then
    foreach v_t in array array[false, true] loop
      select k.conta_id into v from public.rvz_candidatas_trilha(p_pc, p_emp, p_ate, v_t) k
       where p_atual is null or k.efetivo < p_atual limit 1;
      if v is not null then return v; end if;
    end loop;
  end if;
  -- 3. trilha sem conta: a da empresa menos usada, mesmo cheia
  if p_nova then
    select k.conta_id into v from public.rvz_candidatas_trilha(p_pc, p_emp, null, false) k limit 1;
  end if;
  return v;
end $$;

-- Grava a conta da trilha (null solta a trilha), com a mesma trava da principal.
create or replace function public.rvz_atribuir_trilha(p_pc uuid, p_emp uuid, p_conta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_de uuid;
  v_nome text := (select nome from public.empresas where id = p_emp);
begin
  perform pg_advisory_xact_lock(778801);
  if p_conta is not null and (exists (select 1 from public.atribuicao where conta_id = p_conta)
                              or exists (select 1 from public.atribuicao_trilhas where conta_id = p_conta
                                          and (computador_id, empresa_id) <> (p_pc, p_emp))) then
    return;
  end if;
  select conta_id into v_de from public.atribuicao_trilhas where computador_id = p_pc and empresa_id = p_emp;
  if p_conta is null then
    delete from public.atribuicao_trilhas where computador_id = p_pc and empresa_id = p_emp;
  else
    insert into public.atribuicao_trilhas (computador_id, empresa_id, conta_id, motivo, versao, decidido_em, pedida_em)
    values (p_pc, p_emp, p_conta, left(p_motivo, 200), 1, now(), now())
    on conflict (computador_id, empresa_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                                          versao = atribuicao_trilhas.versao + 1, decidido_em = now();
  end if;
  if v_de is distinct from p_conta then
    perform public.rvz_evento('troca',
      format('Troca na trilha %s: %s → %s (%s).', coalesce(v_nome, '?'),
             coalesce((select email from public.contas where id = v_de), 'nenhuma'),
             coalesce((select email from public.contas where id = p_conta), 'nenhuma'), p_motivo),
      jsonb_build_object('computador', p_pc, 'empresa', p_emp, 'de', v_de, 'para', p_conta, 'motivo', p_motivo));
  end if;
end $$;

-- A decisão de uma trilha, com as regras da principal (decidir): sem conta recebe a melhor; a em uso que não serve
-- mais (pausada, sem login, fora da empresa) sai na hora; no gatilho ou no limite da sessão troca; no transbordo volta
-- para uma da empresa quando uma fica livre. Devolve a conta.
-- A trilha nunca fica sem conta por decisão: as sessões abertas nela leem o login da pasta dela, e a conta solta iria
-- para outro lugar com o mesmo login (o token de renovação gira e um derruba o outro). Ela só sai quando o computador,
-- ligado, para de pedir (rvz_soltar_trilhas_paradas). Empresa que deixou de ser separada: a trilha fica como está, sem
-- troca, até a última sessão dela terminar; as sessões novas vão pela principal.
create or replace function public.rvz_decidir_trilha(p_pc uuid, p_emp uuid, p_limite boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auto boolean := (public.rvz_cfg('auto', 'false') #>> '{}')::boolean;
  v_modo text := public.rvz_cfg('modo', '"limiar"') #>> '{}';
  v_troca numeric := (public.rvz_cfg('troca', '95') #>> '{}')::numeric;
  v_espera int := (public.rvz_cfg('espera_entre_trocas_s', '90') #>> '{}')::int;
  v_gatilho numeric := case when v_modo = 'limite' then 100 else v_troca end;
  v_separar boolean;
  v_atual uuid;
  v_quando timestamptz;
  v_ef numeric;
  v_cheia boolean;
  v_esperou boolean;
  v_pausada boolean;
  v_sem_login boolean;
  v_sem_modelo boolean;
  v_da_empresa boolean;
  v_serve boolean;
  v_cand uuid;
begin
  select separar into v_separar from public.empresas where id = p_emp;
  select conta_id, decidido_em into v_atual, v_quando
    from public.atribuicao_trilhas where computador_id = p_pc and empresa_id = p_emp for update;
  if not coalesce(v_separar, false) then return v_atual; end if;

  if v_atual is null then
    v_cand := public.rvz_escolher_trilha(p_pc, p_emp, null, 100, true);
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand, 'trilha nova');
    elsif not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'trilha_sem_conta'
                       and dados ->> 'empresa' = p_emp::text and em > now() - interval '1 hour') then
      perform public.rvz_evento('alerta',
        format('A empresa %s não tem conta livre: as sessões dela vão pela conta do computador.',
               (select nome from public.empresas where id = p_emp)),
        jsonb_build_object('motivo', 'trilha_sem_conta', 'empresa', p_emp, 'computador', p_pc));
    end if;
    return v_cand;
  end if;

  select c.pausada, c.precisa_login into v_pausada, v_sem_login from public.contas c where c.id = v_atual;
  v_sem_modelo := exists (select 1 from public.contas_sem_modelo s where s.conta_id = v_atual and s.computador_id = p_pc
                           and s.ate > now());
  v_da_empresa := public.rvz_serve_trilha(v_atual, p_emp, false);
  v_serve := v_da_empresa or public.rvz_serve_trilha(v_atual, p_emp, true);
  if coalesce(v_pausada, false) or coalesce(v_sem_login, false) or not v_serve then
    v_cand := public.rvz_escolher_trilha(p_pc, p_emp, null, 100);
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand,
        case when v_pausada then 'a conta em uso foi pausada' when v_sem_login then 'a conta em uso precisa entrar de novo'
             else 'a conta em uso não é mais desta empresa' end);
      return v_cand;
    end if;
    -- sem outra, fica onde está (como na principal)
    return v_atual;
  end if;

  v_ef := public.rvz_pct_efetivo(v_atual);
  v_esperou := v_quando is null or v_quando < now() - make_interval(secs => v_espera);
  v_cheia := v_ef is not null and v_ef >= 100;
  if p_limite or v_sem_modelo or (v_auto and v_ef is not null and v_ef >= v_gatilho) then
    v_cand := public.rvz_escolher_trilha(p_pc, p_emp, case when p_limite or v_sem_modelo then null else v_ef end,
                                         case when v_cheia or p_limite or v_sem_modelo then 100 else v_gatilho end);
    if v_cand is not null and (p_limite or v_cheia or v_sem_modelo or v_esperou) then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand,
        case when p_limite then 'a sessão bateu o limite' when v_sem_modelo then 'a conta em uso não roda o modelo'
             when v_cheia or v_modo = 'limite' then 'chegou a 100%' else format('chegou a %s%%', v_troca) end);
      return v_cand;
    end if;
    return v_atual;
  end if;

  -- no transbordo, volta para uma conta da empresa assim que uma fica livre
  if v_auto and not v_da_empresa and v_esperou then
    select k.conta_id into v_cand
      from public.rvz_candidatas_trilha(p_pc, p_emp, (public.rvz_cfg('aviso', '90') #>> '{}')::numeric, false) k limit 1;
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand, 'voltou para uma conta da empresa');
      return v_cand;
    end if;
  end if;
  return v_atual;
end $$;

-- Trilha que o computador, ligado, não pede há 10 minutos (nenhuma sessão viva nela): sai, e a conta fica livre. Com o
-- computador desligado da nuvem, a trilha fica (as sessões dele podem seguir sem internet), como a conta da principal.
create or replace function public.rvz_soltar_trilhas_paradas() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t record;
  n int := 0;
begin
  for t in select a.computador_id, a.empresa_id from public.atribuicao_trilhas a
             join public.computadores q on q.id = a.computador_id
            where a.pedida_em < now() - interval '10 minutes' and q.visto_em > now() - interval '2 minutes'
              and not q.revogado
              for update of a skip locked loop
    perform public.rvz_atribuir_trilha(t.computador_id, t.empresa_id, null, 'trilha sem sessão');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------------------------------- agente
-- As empresas separadas e as regras de pasta delas: o agente classifica cada sessão com elas (a mesma regra do painel:
-- caminho, o mais longo vence; nome de pasta; título do agente do OpenBot).
create or replace function public.agente_empresas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
begin
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome) order by e.nome)
                            from public.empresas e where e.separar), '[]'),
    'regras', coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'padrao', r.padrao, 'empresa', r.empresa_id)
                                         order by r.tipo, r.padrao)
                          from public.pastas_empresa r join public.empresas e on e.id = r.empresa_id where e.separar), '[]'),
    'computador_id', v_pc);
end $$;

-- O agente diz quais trilhas têm sessão (empresas, no máximo 50) e recebe a conta de cada uma. Renova a posse de uso
-- das contas das trilhas dele, como a busca faz com a da principal.
create or replace function public.agente_trilhas(p_empresas uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_e uuid;
begin
  if p_empresas is null or cardinality(p_empresas) > 50 then raise exception 'lista inválida'; end if;
  update public.atribuicao_trilhas set pedida_em = now() where computador_id = v_pc and empresa_id = any(p_empresas);
  perform public.rvz_soltar_trilhas_paradas();
  foreach v_e in array p_empresas loop
    perform public.rvz_decidir_trilha(v_pc, v_e);
  end loop;
  update public.posse set expira_em = now() + interval '2 minutes'
   where computador_id = v_pc and motivo = 'uso'
     and conta_id in (select t.conta_id from public.atribuicao_trilhas t where t.computador_id = v_pc);
  return jsonb_build_object('ok', true, 'trilhas', coalesce((
    select jsonb_agg(jsonb_build_object('empresa', t.empresa_id, 'conta_id', t.conta_id, 'email', c.email,
                                        'versao', t.versao, 'motivo', t.motivo, 'modelo', c.modelo) order by t.empresa_id)
      from public.atribuicao_trilhas t join public.contas c on c.id = t.conta_id
     where t.computador_id = v_pc), '[]'));
end $$;

-- O corpo da 0002, mais: o limite de uma conta que está numa trilha deste computador troca a conta da trilha.
create or replace function public.agente_limite(p_conta uuid, p_sessao text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_atr uuid;
  v_versao bigint;
  v_emp uuid;
begin
  select empresa_id into v_emp from public.atribuicao_trilhas where computador_id = v_pc and conta_id = p_conta;
  if v_emp is not null then
    insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values (p_conta, 'five_hour', 100, now(), 'sessao')
    on conflict (conta_id, tipo) do update set pct = 100, lido_em = now(), fonte = 'sessao';
    if p_sessao is not null then
      update public.sessoes set parada_no_limite = true where id = p_sessao and computador_id = v_pc;
    end if;
    perform public.rvz_evento('limite', 'Uma sessão bateu o limite.',
                              jsonb_build_object('conta', p_conta, 'computador', v_pc, 'empresa', v_emp));
    perform public.rvz_decidir_trilha(v_pc, v_emp, true);
    select versao into v_versao from public.atribuicao_trilhas where computador_id = v_pc and empresa_id = v_emp;
    return jsonb_build_object('ok', true, 'versao', v_versao, 'empresa', v_emp);
  end if;
  select conta_id, versao into v_atr, v_versao from public.atribuicao where computador_id = v_pc;
  if v_atr is distinct from p_conta then
    -- O limite foi da conta de antes da troca: nada a fazer, a troca já aconteceu.
    return jsonb_build_object('ok', true, 'trocou', true, 'versao', v_versao);
  end if;
  insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values (p_conta, 'five_hour', 100, now(), 'sessao')
  on conflict (conta_id, tipo) do update set pct = 100, lido_em = now(), fonte = 'sessao';
  if p_sessao is not null then
    update public.sessoes set parada_no_limite = true where id = p_sessao and computador_id = v_pc;
  end if;
  perform public.rvz_evento('limite', 'Uma sessão bateu o limite.', jsonb_build_object('conta', p_conta, 'computador', v_pc));
  perform public.decidir(v_pc, true);
  select versao into v_versao from public.atribuicao where computador_id = v_pc;
  return jsonb_build_object('ok', true, 'versao', v_versao);
end $$;

-- O corpo da 0010, mais: a posse de uso vale para a conta de uma trilha deste computador, e a conta numa trilha de
-- outro computador não é lida nem renovada aqui.
create or replace function public.agente_pegar_posse(p_conta uuid, p_motivo text, p_segundos integer default 120) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_dono uuid;
  v_cofre record;
begin
  if coalesce(p_motivo, '') not in ('uso', 'leitura', 'renovacao', 'login') then raise exception 'motivo inválido'; end if;
  -- trava a conta: dois computadores pedindo ao mesmo tempo esperam um pelo outro (sem posse viva, o "for update" da
  -- posse não trava nada)
  perform 1 from public.contas where id = p_conta for update;
  if p_motivo = 'uso' and not exists (select 1 from public.atribuicao where computador_id = v_pc and conta_id = p_conta)
     and not exists (select 1 from public.atribuicao_trilhas where computador_id = v_pc and conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'a nuvem não atribuiu esta conta a este computador');
  end if;
  if p_motivo <> 'uso' and (exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> v_pc)
                            or exists (select 1 from public.atribuicao_trilhas where conta_id = p_conta and computador_id <> v_pc)) then
    return jsonb_build_object('ok', false, 'erro', 'conta em uso por outro computador');
  end if;
  select computador_id into v_dono from public.posse where conta_id = p_conta and expira_em > now() for update;
  if v_dono is not null and v_dono <> v_pc then
    return jsonb_build_object('ok', false, 'erro', 'conta com outro computador');
  end if;
  insert into public.posse (conta_id, computador_id, motivo, expira_em)
  values (p_conta, v_pc, p_motivo, now() + make_interval(secs => least(greatest(p_segundos, 10), 600)))
  on conflict (conta_id) do update set computador_id = excluded.computador_id, motivo = excluded.motivo,
                                       desde = case when posse.computador_id = excluded.computador_id then posse.desde else now() end,
                                       expira_em = excluded.expira_em;
  select cifrado, nonce, versao, expira_em into v_cofre from public.cofre where conta_id = p_conta;
  return jsonb_build_object('ok', true, 'cofre', case when v_cofre.versao is null then null else jsonb_build_object(
    'cifrado', public.rvz_b64(v_cofre.cifrado), 'nonce', public.rvz_b64(v_cofre.nonce), 'versao', v_cofre.versao,
    'expira_em', v_cofre.expira_em) end);
end $$;

-- O corpo da 0035, mais: a conta que já estava no computador só vira a atribuição dele se a principal pode usá-la.
create or replace function public.agente_ola(p_versao text, p_diagnostico jsonb default null, p_conta_local text default null,
                                             p_organizacao_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_local uuid;
  v_atr record;
  v_cfg jsonb;
  v_cmds jsonb;
  v_org text := nullif(left(coalesce(p_organizacao_id, ''), 80), '');
begin
  update public.computadores
     set visto_em = now(), versao = left(p_versao, 40), diagnostico = coalesce(p_diagnostico, diagnostico)
   where id = v_pc;
  -- Renova só a posse de uso da conta atribuída; a de uma conta que saiu vence sozinha.
  update public.posse set expira_em = now() + interval '2 minutes'
   where computador_id = v_pc and motivo = 'uso'
     and conta_id = (select conta_id from public.atribuicao where computador_id = v_pc);
  -- Primeira vez: a conta que já está no computador vira a atribuição dele (se ninguém mais a usa nem a tem em mãos),
  -- com a mesma trava do rvz_atribuir.
  if not exists (select 1 from public.atribuicao where computador_id = v_pc) and p_conta_local is not null then
    perform pg_advisory_xact_lock(778801);
    select id into v_local from public.contas
      where email = lower(p_conta_local) and not pausada and not precisa_login
        and (v_org is null or organizacao_id is not distinct from v_org or organizacao_id is null)
      order by (organizacao_id is not distinct from v_org) desc, criado_em
      limit 1;
    if v_local is not null
       and public.rvz_principal_pode(v_local)
       and not exists (select 1 from public.atribuicao where conta_id = v_local)
       and not exists (select 1 from public.atribuicao where computador_id = v_pc)
       and not exists (select 1 from public.posse where conta_id = v_local and computador_id <> v_pc and expira_em > now()) then
      insert into public.atribuicao (computador_id, conta_id, motivo) values (v_pc, v_local, 'conta que já estava no computador');
    end if;
  end if;
  update public.comandos set estado = 'expirado'
   where computador_id = v_pc and estado = 'pendente' and criado_em < now() - interval '2 minutes';
  select a.conta_id, a.versao, a.motivo, c.email, c.modelo into v_atr
    from public.atribuicao a left join public.contas c on c.id = a.conta_id where a.computador_id = v_pc;
  select jsonb_object_agg(chave, valor) into v_cfg from public.config;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'acao', acao, 'corpo', corpo, 'criado_em', criado_em) order by id), '[]')
    into v_cmds
    from (select id, acao, corpo, criado_em from public.comandos
           where computador_id = v_pc and estado = 'pendente' order by id limit 10) q;
  return jsonb_build_object(
    'computador_id', v_pc,
    'atribuicao', case when v_atr.conta_id is null then null else
      jsonb_build_object('conta_id', v_atr.conta_id, 'email', v_atr.email, 'versao', v_atr.versao, 'motivo', v_atr.motivo,
                         'modelo', v_atr.modelo) end,
    'config', v_cfg,
    'comandos', v_cmds,
    'enxugar', coalesce((select enxugar from public.computadores where id = v_pc), false),
    'ligacao_pendente', exists (select 1 from public.ligacoes where usado_em is null and expira_em > now()),
    'ligacoes', public.rvz_ligacoes_abertas(v_pc),
    'trilhas', exists (select 1 from public.empresas where separar));
end $$;

-- ------------------------------------------------------------------------------------------- decidir
-- O corpo da 0031, mais: solta as trilhas paradas, e a conta em uso que a principal não pode mais usar (ficou só de
-- empresas separadas) sai como a pausada.
create or replace function public.decidir(p_pc uuid default null, p_limite boolean default false) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auto boolean := (public.rvz_cfg('auto', 'false') #>> '{}')::boolean;
  v_modo text := public.rvz_cfg('modo', '"limiar"') #>> '{}';
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_troca numeric := (public.rvz_cfg('troca', '95') #>> '{}')::numeric;
  v_espera int := (public.rvz_cfg('espera_entre_trocas_s', '90') #>> '{}')::int;
  v_rod_min int := (public.rvz_cfg('rodizio_minutos', '90') #>> '{}')::int;
  v_rod_ordem text := public.rvz_cfg('rodizio_ordem', '"aleatoria"') #>> '{}';
  v_prox timestamptz := nullif(public.rvz_cfg('proximo_rodizio_em', 'null') #>> '{}', '')::timestamptz;
  v_gatilho numeric := case when v_modo = 'limite' then 100 else v_troca end;
  v_manual text[] := array['pedido pelo painel', 'pedido pela API'];
  pc record;
  v_atual uuid;
  v_quando timestamptz;
  v_motivo text;
  v_pref uuid;
  v_esperou boolean;
  v_ef numeric;
  v_cheia boolean;
  v_pausada boolean;
  v_sem_login boolean;
  v_so_empresa boolean;
  v_cand uuid;
  v_trocas int := 0;
begin
  if p_pc is null then perform public.rvz_soltar_trilhas_paradas(); end if;
  for pc in select c.id, c.conta_preferida from public.computadores c
             where not c.revogado and c.visto_em > now() - interval '2 minutes' and (p_pc is null or c.id = p_pc)
             order by c.id
             for update loop
    v_atual := null; v_quando := null; v_motivo := null; v_cand := null;
    select conta_id, decidido_em, motivo into v_atual, v_quando, v_motivo
      from public.atribuicao where computador_id = pc.id for update;
    v_pref := pc.conta_preferida;

    -- Computador sem conta: recebe a melhor livre (mesmo com a troca automática desligada, para começar a trabalhar).
    -- A preferida dele vem primeiro na lista.
    if v_atual is null then
      select conta_id into v_cand from public.rvz_candidatas(pc.id) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'computador sem conta');
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    -- A conta em uso foi pausada, perdeu o login ou ficou só de empresas separadas: sai de uso na hora, para a melhor
    -- que houver, mesmo com a troca automática desligada (pausar é dizer "não use esta"). Sem outra, fica onde está.
    select c.pausada, c.precisa_login into v_pausada, v_sem_login from public.contas c where c.id = v_atual;
    v_so_empresa := not public.rvz_principal_pode(v_atual);
    if coalesce(v_pausada, false) or coalesce(v_sem_login, false) or v_so_empresa then
      v_cand := public.rvz_escolher(pc.id, null, 100);
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when v_pausada then 'a conta em uso foi pausada' when v_sem_login then 'a conta em uso precisa entrar de novo'
               else 'a conta em uso agora é só de empresas separadas' end);
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if not v_auto then continue; end if;
    v_ef := public.rvz_pct_efetivo(v_atual);
    v_esperou := v_quando is null or v_quando < now() - make_interval(secs => v_espera);
    -- cheia pelo uso (o agente_limite grava 100% na janela de 5 h antes de decidir); a conta sem o modelo da sessão
    -- (agente_sem_modelo) não está cheia: sem outra abaixo do gatilho, a sessão segue no modelo padrão nela
    v_cheia := v_ef is not null and v_ef >= 100;

    if p_limite or (v_ef is not null and v_ef >= v_gatilho) then
      -- a livre de sempre; sem ela, a com mais folga (a em uso cheia aceita até 100%)
      v_cand := public.rvz_escolher(pc.id, case when p_limite then null else v_ef end,
                                    case when v_cheia then 100 else v_gatilho end);
      if v_cand is null then
        if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'
                       and em > now() - interval '1 hour') then
          perform public.rvz_evento('alerta', 'Nenhuma conta livre para trocar.',
                                    jsonb_build_object('motivo', 'sem_livre', 'computador', pc.id));
        end if;
      elsif p_limite or v_cheia or v_esperou then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when p_limite then 'a sessão bateu o limite' when v_cheia or v_modo = 'limite' then 'chegou a 100%'
               else format('chegou a %s%%', v_troca) end);
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    -- Volta para a preferida quando ela está livre de novo. Troca pedida à mão fica até a próxima troca da regra.
    if v_pref is not null and v_pref <> v_atual and not (coalesce(v_motivo, '') = any(v_manual)) and v_esperou
       and exists (select 1 from public.rvz_candidatas(pc.id) k where k.conta_id = v_pref) then
      perform public.rvz_atribuir(pc.id, v_pref, 'conta preferida deste computador');
      v_trocas := v_trocas + 1;
      continue;
    end if;

    -- Devolve a preferida de outro computador ligado que está sem ela, se houver outra conta boa para pegar.
    if not (coalesce(v_motivo, '') = any(v_manual)) and v_esperou
       and exists (select 1 from public.computadores q
                    where q.conta_preferida = v_atual and q.id <> pc.id and not q.revogado
                      and q.visto_em > now() - interval '2 minutes'
                      and not exists (select 1 from public.atribuicao qa
                                       where qa.computador_id = q.id and qa.motivo = any(v_manual))) then
      select k.conta_id into v_cand from public.rvz_candidatas(pc.id) k join public.contas c on c.id = k.conta_id
       where not c.reserva and not public.rvz_preferida_de_outro(k.conta_id, pc.id) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'devolvendo a conta preferida de outro computador');
        v_trocas := v_trocas + 1;
        continue;
      end if;
    end if;

    -- No rodízio, o computador que está na preferida fica nela.
    if v_modo = 'rodizio' and v_prox is not null and now() >= v_prox and v_esperou
       and v_atual is distinct from v_pref then
      select conta_id into v_cand from public.rvz_candidatas(pc.id, v_rod_ordem) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'rodízio do dia');
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if v_ef is not null and v_ef >= v_aviso
       and not exists (select 1 from public.eventos where tipo = 'aviso' and origem = 'nuvem' and dados ->> 'conta' = v_atual::text
                       and em > now() - interval '5 hours') then
      perform public.rvz_evento('aviso', format('Conta em uso chegou a %s%%.', round(v_ef)),
                                jsonb_build_object('conta', v_atual, 'computador', pc.id, 'pct', v_ef));
    end if;
  end loop;

  -- Agenda o próximo rodízio quando o modo é rodízio e o horário passou (ou nunca foi marcado).
  if v_modo = 'rodizio' and (v_prox is null or now() >= v_prox) then
    insert into public.config (chave, valor) values ('proximo_rodizio_em',
      to_jsonb(now() + make_interval(secs => (v_rod_min * 60 * (0.75 + random() * 0.5))::int)))
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  return v_trocas;
end $$;

-- ------------------------------------------------------------------------------------------- painel
-- O corpo da 0037, mais o campo "separar" (liga a trilha da empresa). Ligar ou desligar decide na hora os computadores
-- cuja conta em uso deixou de servir à principal.
create or replace function public.painel_empresa(p_id uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_id uuid := p_id;
  v_nome text;
  v_contas uuid[];
  v_pc uuid;
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_campos) <> 'object' then raise exception 'campos inválidos'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('nome', 'cor', 'transbordo', 'transbordo_contas', 'separar') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if p_campos ? 'nome' then
    v_nome := btrim(coalesce(p_campos ->> 'nome', ''));
    if length(v_nome) not between 1 and 60 or v_nome ~ '[[:cntrl:]]' then raise exception 'nome inválido'; end if;
    if exists (select 1 from public.empresas where lower(btrim(nome)) = lower(v_nome) and id is distinct from v_id) then
      return jsonb_build_object('ok', false, 'erro', 'já existe uma empresa com esse nome');
    end if;
  end if;
  if p_campos ? 'transbordo' and coalesce(p_campos ->> 'transbordo', '') not in ('nenhum', 'qualquer', 'escolhidas') then
    raise exception 'transbordo inválido';
  end if;
  if p_campos ? 'separar' and jsonb_typeof(p_campos -> 'separar') <> 'boolean' then
    raise exception 'separar inválido';
  end if;
  if p_campos ? 'transbordo_contas' then
    if jsonb_typeof(p_campos -> 'transbordo_contas') <> 'array' or jsonb_array_length(p_campos -> 'transbordo_contas') > 50 then
      raise exception 'contas do transbordo inválidas';
    end if;
    -- só contas que existem; id mal formado derruba a gravação
    select coalesce(array_agg(c.id order by c.prioridade, c.id), '{}') into v_contas
      from public.contas c
     where c.id in (select x::uuid from jsonb_array_elements_text(p_campos -> 'transbordo_contas') x);
  end if;
  if v_id is null then
    if v_nome is null then raise exception 'nome inválido'; end if;
    insert into public.empresas (nome, cor, transbordo, transbordo_contas, separar)
    values (v_nome, coalesce((p_campos ->> 'cor')::smallint, 0), coalesce(p_campos ->> 'transbordo', 'nenhum'),
            coalesce(v_contas, '{}'), coalesce((p_campos ->> 'separar')::boolean, false))
    returning id into v_id;
  else
    update public.empresas set
      nome = coalesce(v_nome, nome),
      cor = coalesce((p_campos ->> 'cor')::smallint, cor),
      transbordo = coalesce(p_campos ->> 'transbordo', transbordo),
      transbordo_contas = coalesce(v_contas, transbordo_contas),
      separar = coalesce((p_campos ->> 'separar')::boolean, separar)
    where id = v_id;
    if not found then raise exception 'empresa desconhecida'; end if;
  end if;
  perform public.rvz_auditar('empresa', v_id::text, p_campos);
  if p_campos ? 'separar' then
    for v_pc in select a.computador_id from public.atribuicao a where not public.rvz_principal_pode(a.conta_id) loop
      perform public.decidir(v_pc);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- O corpo da 0037, mais: a empresa com trilha não sai (apagar levaria a trilha junto, e a conta dela ficaria livre
-- para outro lugar com as sessões da trilha ainda no mesmo login). Desligar "separar" e esperar a trilha sair.
create or replace function public.painel_empresa_apagar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nome text;
begin
  perform public.rvz_exigir_admin();
  if exists (select 1 from public.atribuicao_trilhas where empresa_id = p_id) then
    return jsonb_build_object('ok', false, 'erro',
      'a empresa tem sessões abertas na trilha dela: desligue "separar" e espere as sessões terminarem');
  end if;
  delete from public.empresas where id = p_id returning nome into v_nome;
  if v_nome is null then raise exception 'empresa desconhecida'; end if;
  perform public.rvz_auditar('empresa_apagar', p_id::text, jsonb_build_object('nome', v_nome));
  return jsonb_build_object('ok', true);
end $$;

-- O corpo da 0034, mais: a conta numa trilha ou só de empresas separadas não vai para a principal à mão (o
-- rvz_atribuir recusaria calado, ou a próxima decisão tiraria a conta na hora).
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
  if not public.rvz_principal_pode(p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'a conta é só de empresas separadas ou está na trilha de uma empresa');
  end if;
  if not exists (select 1 from public.cofre where conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'conta sem login guardado');
  end if;
  perform public.rvz_atribuir(p_computador, p_conta, 'pedido pelo painel');
  perform public.rvz_auditar('trocar', p_conta::text, jsonb_build_object('computador', p_computador));
  return jsonb_build_object('ok', true);
end $$;

-- O corpo da 0011, mais a mesma conferência da troca pelo painel.
create or replace function public.api_trocar(p_user uuid, p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_admin_api(p_user) then raise exception 'sem acesso'; end if;
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    return jsonb_build_object('ok', false, 'erro', 'computador desconhecido');
  end if;
  if exists (select 1 from public.contas where id = p_conta and (pausada or precisa_login)) then
    return jsonb_build_object('ok', false, 'erro', 'conta pausada ou sem login');
  end if;
  if exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> p_computador) then
    return jsonb_build_object('ok', false, 'erro', 'a conta está em uso em outro computador');
  end if;
  if not public.rvz_principal_pode(p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'a conta é só de empresas separadas ou está na trilha de uma empresa');
  end if;
  if not exists (select 1 from public.cofre where conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'conta sem login guardado');
  end if;
  perform public.rvz_atribuir(p_computador, p_conta, 'pedido pela API');
  insert into public.auditoria (user_id, acao, alvo, detalhes) values (p_user, 'api_trocar', p_conta::text, jsonb_build_object('computador', p_computador));
  return jsonb_build_object('ok', true);
end $$;

-- O corpo da 0014, mais: as trilhas do computador revogado saem com a atribuição dele.
create or replace function public.painel_revogar_computador(p_computador uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_desligado boolean;
begin
  perform public.rvz_exigir_admin();
  update public.computadores set revogado = true, diagnostico = null where id = p_computador returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'erro', 'computador desconhecido'); end if;
  -- revogar = desligar a identidade: o login do computador para de funcionar e as sessões abertas caem. Se o Auth
  -- recusar (permissão do esquema auth), as funções do agente já recusam o computador revogado; a auditoria registra.
  begin
    update auth.users set banned_until = 'infinity' where id = v_user;
    delete from auth.sessions where user_id = v_user;
    delete from auth.refresh_tokens where user_id = v_user::text;
    v_desligado := true;
  exception when others then
    v_desligado := false;
  end;
  delete from public.posse where computador_id = p_computador;
  delete from public.atribuicao where computador_id = p_computador;
  delete from public.atribuicao_trilhas where computador_id = p_computador;
  update public.comandos set estado = 'expirado' where computador_id = p_computador and estado in ('pendente', 'reservado');
  update public.ligacoes set expira_em = now() where criado_por = p_computador and usado_em is null and expira_em > now();
  perform public.rvz_auditar('revogar_computador', p_computador::text, jsonb_build_object('login_desligado', v_desligado));
  return jsonb_build_object('ok', true, 'login_desligado', v_desligado);
end $$;

-- O corpo da 0037, mais: a conta que sai e está numa trilha passa a trilha para outra antes (sem outra, espera, como a
-- da principal); apagar a conta com a trilha nela deixaria as sessões da trilha num login que ninguém mais cuida.
create or replace function public.rvz_purgar_contas_saindo() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ct record;
  v_pc uuid;
  v_emp uuid;
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
      v_pc := null; v_emp := null;
      select t.computador_id, t.empresa_id into v_pc, v_emp from public.atribuicao_trilhas t where t.conta_id = ct.id
         for update of t;
      if v_pc is not null then
        v_cand := public.rvz_escolher_trilha(v_pc, v_emp, null, 100, true);
        if v_cand is null then continue; end if;
        perform public.rvz_atribuir_trilha(v_pc, v_emp, v_cand, 'a conta em uso foi removida');
      end if;
      -- o uso dela fica, sem a conta; a hora que já tem uso de conta removida soma nele (a chave única é a mesma)
      update public.uso_tokens u
         set respostas = u.respostas + x.respostas, entrada = u.entrada + x.entrada, saida = u.saida + x.saida,
             cache_escrita = u.cache_escrita + x.cache_escrita, cache_leitura = u.cache_leitura + x.cache_leitura,
             usd = u.usd + x.usd, agentes = u.agentes + x.agentes
        from public.uso_tokens x
       where x.conta_id = ct.id and u.conta_id is null and u.hora = x.hora and u.computador_id = x.computador_id
         and u.projeto = x.projeto and u.pasta = x.pasta and u.modelo = x.modelo;
      delete from public.uso_tokens x
       where x.conta_id = ct.id
         and exists (select 1 from public.uso_tokens u where u.conta_id is null and u.hora = x.hora
                     and u.computador_id = x.computador_id and u.projeto = x.projeto and u.pasta = x.pasta
                     and u.modelo = x.modelo);
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
