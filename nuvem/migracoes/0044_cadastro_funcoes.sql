-- Reveza AI · 0044 · as funções do cadastro operacional (as colunas estão na 0043).
-- reaplicável: só funções (create or replace).
--
-- 1. Só as contas dela (so_contas_dela): sem transbordo, e a conta dela nunca fica na principal de um computador.
-- 2. Uma conta em várias empresas: no mesmo computador, as unidades ligadas e estritas com o mesmo conjunto de contas
--    dividem uma trilha (o login gira, então duas pastas de login na mesma conta derrubariam uma à outra). Em
--    computadores diferentes a conta continua indo a um por vez.
-- 3. A pasta de cada computador (computador_id).
-- 4. painel_unidade: nome, modo, contas e pastas numa transação só.
-- 5. A conta em uso fica enquanto uma sessão de unidade estrita rodar nela (agente_segurar_principal).

-- ------------------------------------------------------------------------------------------- só as contas dela
create or replace function public.rvz_estrita(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select e.so_contas_dela from public.empresas e where e.id = p_id), false)
$$;

-- As contas de uma unidade, em ordem: as dela; projeto sem contas próprias usa as da empresa (como rvz_marcada).
create or replace function public.rvz_contas_efetivas(p_id uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select array_agg(ce.conta_id order by ce.conta_id) from public.conta_empresas ce where ce.empresa_id = p_id),
    (select array_agg(ce.conta_id order by ce.conta_id)
       from public.empresas e join public.conta_empresas ce on ce.empresa_id = e.pai where e.id = p_id),
    '{}'::uuid[])
$$;

-- O corpo da 0039, mais: a conta marcada para uma unidade ligada e estrita não fica na principal.
create or replace function public.rvz_principal_pode(p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not public.rvz_em_trilha(p_conta) and not public.rvz_so_de_separadas(p_conta)
     and not exists (select 1 from public.empresas u
                      where u.so_contas_dela and public.rvz_unidade_de(u.id) = u.id
                        and public.rvz_unidade_ligada(u.id) and public.rvz_marcada(p_conta, u.id))
$$;

-- O corpo da 0041, mais: a unidade estrita não usa transbordo.
create or replace function public.rvz_serve_trilha(p_conta uuid, p_emp uuid, p_transbordo boolean) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  e public.empresas%rowtype;
  v_regra uuid;
begin
  if public.rvz_marcada(p_conta, p_emp) then return not p_transbordo; end if;
  if not p_transbordo then return false; end if;
  select * into e from public.empresas where id = p_emp;
  if not found then return false; end if;
  -- só as contas dela: nada de transbordo nem de herdar
  if e.so_contas_dela then return false; end if;
  v_regra := e.id;
  if e.pai is not null and e.herdar_transbordo then
    -- cheias as do projeto: as da empresa, depois o transbordo dela
    if exists (select 1 from public.conta_empresas ce where ce.empresa_id = e.pai and ce.conta_id = p_conta) then
      return true;
    end if;
    v_regra := e.pai;
  end if;
  return coalesce((select case x.transbordo
                            when 'qualquer' then not public.rvz_so_de_separadas(p_conta)
                            when 'escolhidas' then p_conta = any(x.transbordo_contas)
                            else false end
                     from public.empresas x where x.id = v_regra), false);
end $$;

-- As outras unidades estritas que podem ter sessão no login desta trilha: foram mandadas para ela e ela ainda não soltou.
create or replace function public.rvz_dividem_trilha(p_pc uuid, p_emp uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(m.id), '{}'::uuid[])
    from public.atribuicao_trilhas t, unnest(t.unidades) as m(id)
   where t.computador_id = p_pc and t.empresa_id = p_emp and m.id <> p_emp
     and public.rvz_estrita(m.id) and public.rvz_unidade_de(m.id) = m.id and public.rvz_unidade_ligada(m.id)
$$;

-- O corpo da 0039, mais: entre as livres, primeiro a conta de que menos outras unidades estritas dependem. Com listas
-- só em parte iguais, a escolha errada deixaria outra unidade sem nenhuma conta. E a trilha dividida só vai para uma
-- conta que sirva a todas as unidades que podem ter sessão nela.
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
            public.rvz_pct_efetivo(c.id), c.prioridade, c.email
$$;

-- O corpo da 0041, com a estrita: a conta que saiu da lista troca por outra da lista, se houver.
create or replace function public.rvz_decidir_trilha(p_pc uuid, p_emp uuid, p_limite boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auto boolean := (public.rvz_cfg('auto', 'false') #>> '{}')::boolean;
  v_modo text := public.rvz_cfg('modo', '"limiar"') #>> '{}';
  v_troca numeric := (public.rvz_cfg('troca', '95') #>> '{}')::numeric;
  v_espera int := (public.rvz_cfg('espera_entre_trocas_s', '90') #>> '{}')::int;
  v_gatilho numeric := case when v_modo = 'limite' then 100 else v_troca end;
  v_separar boolean := public.rvz_unidade_ligada(p_emp);
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
  select conta_id, decidido_em into v_atual, v_quando
    from public.atribuicao_trilhas where computador_id = p_pc and empresa_id = p_emp for update;
  if not coalesce(v_separar, false) then return v_atual; end if;

  if v_atual is null then
    v_cand := public.rvz_escolher_trilha(p_pc, p_emp, null, 100, true);
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand, 'trilha nova');
      perform public.rvz_lembrar_divisao(p_pc);
    elsif not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'trilha_sem_conta'
                       and dados ->> 'empresa' = p_emp::text and em > now() - interval '1 hour') then
      perform public.rvz_evento('alerta',
        format(case when public.rvz_estrita(p_emp)
                    then '%s não tem conta livre: as sessões não abrem até a conta dela soltar.'
                    else '%s não tem conta livre: as sessões vão pela conta do computador.' end,
               public.rvz_nome_unidade(p_emp)),
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
    -- a trilha pode estar dividida: enquanto a conta que saiu da lista desta unidade ainda é de outra que foi mandada
    -- para esta trilha, pode haver sessão dela neste login, e trocar a levaria para uma conta que não é dela. Fica até a
    -- trilha soltar. Outra unidade que só tem a mesma conta na lista, sem nunca ter dividido a trilha, não segura nada.
    if not v_serve and exists (select 1 from unnest(public.rvz_dividem_trilha(p_pc, p_emp)) as m(id)
                                where v_atual = any (public.rvz_contas_efetivas(m.id))) then
      return v_atual;
    end if;
    v_cand := public.rvz_escolher_trilha(p_pc, p_emp, null, 100);
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand,
        case when v_pausada then 'a conta em uso foi pausada' when v_sem_login then 'a conta em uso precisa entrar de novo'
             else 'a conta em uso não é mais desta empresa ou projeto' end);
      return v_cand;
    end if;
    -- sem outra para pôr no lugar, a sessão aberta segue nela até fechar (soltar agora a deixaria no login errado); o
    -- agente não deixa sessão nova entrar na conta que saiu da lista
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

  if v_auto and not v_da_empresa and v_esperou then
    select k.conta_id into v_cand
      from public.rvz_candidatas_trilha(p_pc, p_emp, (public.rvz_cfg('aviso', '90') #>> '{}')::numeric, false) k limit 1;
    if v_cand is not null then
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand, 'voltou para uma conta da empresa ou do projeto');
      return v_cand;
    end if;
  end if;
  return v_atual;
end $$;

-- ------------------------------------------------------------------------------------------- a trilha dividida
-- A trilha de uma unidade neste computador: ela mesma, ou, se é ligada e estrita, a representante das unidades com o
-- mesmo conjunto de contas. Representante: a que já está numa dessas contas aqui (a sessão viva não muda de login);
-- sem nenhuma, a mais antiga.
create or replace function public.rvz_trilha_de(p_pc uuid, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_contas uuid[];
  v uuid;
begin
  if not public.rvz_estrita(p_id) or not public.rvz_unidade_ligada(p_id) or public.rvz_unidade_de(p_id) <> p_id then
    return p_id;
  end if;
  v_contas := public.rvz_contas_efetivas(p_id);
  if cardinality(v_contas) = 0 then return p_id; end if;
  select x.id into v
    from public.empresas x
   where x.so_contas_dela and public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
     and public.rvz_contas_efetivas(x.id) = v_contas
   order by exists (select 1 from public.atribuicao_trilhas t
                     where t.computador_id = p_pc and t.empresa_id = x.id and t.conta_id = any (v_contas)) desc,
            x.criado_em, x.id
   limit 1;
  return coalesce(v, p_id);
end $$;

-- Anota quem é mandado para cada trilha deste computador. Só acrescenta: a anotação some quando a trilha solta.
create or replace function public.rvz_lembrar_divisao(p_pc uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.atribuicao_trilhas t
     set unidades = (select array_agg(distinct m) from unnest(t.unidades || d.membros) as m)
    from (select public.rvz_trilha_de(p_pc, x.id) as trilha, array_agg(x.id) as membros
            from public.empresas x
           where x.so_contas_dela and public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
           group by 1) d
   where t.computador_id = p_pc and t.empresa_id = d.trilha and not (d.membros <@ t.unidades);
end $$;

-- O nome da trilha: "Empresa A + Empresa B" quando ela é dividida (só aparece em registro e aviso).
create or replace function public.rvz_nome_trilha(p_pc uuid, p_id uuid, p_divide boolean default true) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not p_divide then public.rvz_nome_unidade(p_id)
              else coalesce(left((select string_agg(public.rvz_nome_unidade(x.id), ' + ' order by public.rvz_nome_unidade(x.id))
                                    from public.empresas x
                                   where public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
                                     and public.rvz_trilha_de(p_pc, x.id) = p_id), 120),
                            public.rvz_nome_unidade(p_id)) end
$$;

-- ------------------------------------------------------------------------------------------- a pasta por computador
-- O corpo da 0041, só com as regras deste computador e as que valem para todos.
create or replace function public.rvz_classificar(p_pc uuid, p_pasta text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p text := public.rvz_norm_pasta(p_pasta);
  v_melhor uuid;
  v_nota numeric := -1;
  r record;
  partes text[];
  i int;
  v_ag text;
  v_ag_nome text;
  v_ag_titulo text;
  v_base text;
begin
  if p is null or p = '' then return null; end if;
  partes := string_to_array(p, '/');
  -- a regra deste computador vem antes da que vale para todos: no empate, ela ganha
  for r in select x.tipo, x.padrao, x.empresa_id from public.pastas_empresa x
            where x.computador_id is null or x.computador_id = p_pc
            order by x.computador_id is null loop
    if r.tipo = 'pasta' and btrim(r.padrao) ~ '^([~/]|[A-Za-z]:(/|\\|$))' then
      v_base := public.rvz_norm_pasta(r.padrao);
      if (p = v_base or (v_base = '/' and left(p, 1) = '/') or left(p, length(v_base) + 1) = v_base || '/')
         and length(v_base) > v_nota then
        v_nota := length(v_base); v_melhor := r.empresa_id;
      end if;
    elsif r.tipo = 'pasta' then
      v_base := btrim(public.rvz_norm_pasta(r.padrao), '/');
      if v_base <> '' then
        for i in reverse coalesce(array_length(partes, 1), 0) .. 1 loop
          if partes[i] = v_base then
            if length(array_to_string(partes[1:i], '/')) - 0.25 > v_nota then
              v_nota := length(array_to_string(partes[1:i], '/')) - 0.25; v_melhor := r.empresa_id;
            end if;
            exit;
          end if;
        end loop;
      end if;
    end if;
  end loop;
  -- título: a pasta de agente mais longa que contém a pasta; a regra de texto mais longo que o título ou o nome contém
  select public.rvz_norm_pasta(a.pasta), lower(a.nome), lower(a.titulo) into v_ag, v_ag_nome, v_ag_titulo
    from public.agentes_openbot a
   where a.computador_id = p_pc
     and (p = public.rvz_norm_pasta(a.pasta) or left(p, length(public.rvz_norm_pasta(a.pasta)) + 1) = public.rvz_norm_pasta(a.pasta) || '/')
   order by length(public.rvz_norm_pasta(a.pasta)) desc limit 1;
  if v_ag is not null and length(v_ag) - 0.5 > v_nota then
    select x.empresa_id into r from public.pastas_empresa x
     where x.tipo = 'titulo' and btrim(x.padrao) <> ''
       and (x.computador_id is null or x.computador_id = p_pc)
       and (strpos(v_ag_titulo, lower(btrim(x.padrao))) > 0 or strpos(v_ag_nome, lower(btrim(x.padrao))) > 0)
     order by length(btrim(x.padrao)) desc, x.computador_id is null limit 1;
    if found then v_melhor := r.empresa_id; end if;
  end if;
  return v_melhor;
end $$;

-- O corpo da 0037, com a chave nova (a regra sem computador).
create or replace function public.painel_pasta_empresa(p_tipo text, p_padrao text, p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_padrao text := btrim(coalesce(p_padrao, ''));
  v_id uuid;
begin
  perform public.rvz_exigir_admin();
  if p_tipo not in ('pasta', 'titulo') then raise exception 'tipo inválido'; end if;
  if length(v_padrao) not between 1 and 300 or v_padrao ~ '[[:cntrl:]]' then raise exception 'padrão inválido'; end if;
  if p_tipo = 'pasta' then
    v_padrao := regexp_replace(v_padrao, '(.)/+$', '\1');
    -- a pasta pessoal ou a raiz do disco inteira pegaria todo o uso de todas as empresas
    if v_padrao ~ '^(~|/+|[A-Za-z]:)$' then raise exception 'padrão inválido'; end if;
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then raise exception 'empresa desconhecida'; end if;
  insert into public.pastas_empresa (tipo, padrao, empresa_id) values (p_tipo, v_padrao, p_empresa)
  on conflict (tipo, padrao, coalesce(computador_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set empresa_id = excluded.empresa_id
  returning id into v_id;
  perform public.rvz_auditar('pasta_empresa', v_id::text,
                             jsonb_build_object('tipo', p_tipo, 'padrao', v_padrao, 'empresa', p_empresa));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- O corpo da 0041, mais: a trilha dividida, as regras deste computador e a marca de estrita. O agente antes da 0.19.0
-- segue sem a divisão, porque o portão dele conta cada unidade separada.
create or replace function public.agente_empresas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_entende boolean := public.rvz_versao_agente((select versao from public.computadores where id = v_pc))
                       >= public.rvz_versao_agente('0.19.0');
  v_fora uuid[] := '{}';
begin
  if not v_entende then
    select coalesce(array_agg(u.id), '{}') into v_fora
      from public.empresas u
     where public.rvz_unidade_de(u.id) = u.id and public.rvz_unidade_ligada(u.id)
       and exists (
         select 1
           from public.empresas x
          where public.rvz_tira_da_empresa(x.id)
            and exists (select 1 from public.pastas_empresa r where public.rvz_unidade_de(r.empresa_id) = x.id)
            and (
              -- da mesma empresa: a regra do projeto costuma estar dentro da regra da empresa
              coalesce(x.pai, x.id) = coalesce(u.pai, u.id)
              -- de outra empresa: uma regra dele pode pegar, com mais precisão, uma pasta desta
              or exists (select 1
                           from public.pastas_empresa rx, public.pastas_empresa ru
                          where public.rvz_unidade_de(rx.empresa_id) = x.id
                            and public.rvz_unidade_de(ru.empresa_id) = u.id
                            and public.rvz_regras_cruzam(rx.tipo, rx.padrao, ru.tipo, ru.padrao))));
  else
    -- antes de o computador receber as regras: a sessão só entra numa trilha dividida depois de ler esta resposta
    perform public.rvz_lembrar_divisao(v_pc);
  end if;
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id,
                                                              'nome', public.rvz_nome_trilha(v_pc, x.id, v_entende),
                                                              'estrita', public.rvz_estrita(x.id),
                                                              -- a principal que já está numa destas serve à sessão
                                                              'contas', case when public.rvz_estrita(x.id)
                                                                             then to_jsonb(public.rvz_contas_efetivas(x.id))
                                                                             else '[]'::jsonb end)
                                           order by public.rvz_nome_trilha(v_pc, x.id, v_entende))
                            from (select distinct case when v_entende then public.rvz_trilha_de(v_pc, e.id) else e.id end as id
                                    from public.empresas e
                                   where public.rvz_unidade_de(e.id) = e.id and public.rvz_unidade_ligada(e.id)
                                     and not (e.id = any (v_fora))) x), '[]'),
    'regras', case when not exists (select 1 from public.empresas where separar) then '[]'::jsonb
                   else coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'padrao', r.padrao,
                                                                      'empresa', case when v_entende
                                                                       then public.rvz_trilha_de(v_pc, public.rvz_unidade_de(r.empresa_id))
                                                                       else public.rvz_unidade_de(r.empresa_id) end)
                                                   order by r.computador_id is null, r.tipo, r.padrao)
                                    from public.pastas_empresa r
                                   where (r.computador_id is null or r.computador_id = v_pc)
                                     and (public.rvz_unidade_ligada(public.rvz_unidade_de(r.empresa_id))
                                          or public.rvz_tira_da_empresa(public.rvz_unidade_de(r.empresa_id)))), '[]') end,
    'computador_id', v_pc);
end $$;

-- ------------------------------------------------------------------------------------------- painel
-- Salva uma empresa ou projeto de uma vez: nome, cor, modo, contas e pastas. Confere tudo antes de gravar, para não
-- deixar metade. A pasta de outra unidade é recusada (a regra antiga trocava de dono em silêncio).
create or replace function public.painel_unidade(p_id uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_id uuid := p_id;
  v_e public.empresas%rowtype;
  v_pai uuid;
  v_modo text;
  v_liga boolean;
  v_contas uuid[];
  v_pastas jsonb := '[]'::jsonb;
  v_r jsonb;
  x jsonb;
  v_tipo text;
  v_padrao text;
  v_pc uuid;
  v_dono uuid;
  v_q uuid;
  v_atrasado text;
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_campos) <> 'object' then raise exception 'campos inválidos'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('nome', 'cor', 'pai', 'modo', 'contas', 'pastas') then raise exception 'campo não permitido: %', k; end if;
  end loop;
  if v_id is not null then
    select * into v_e from public.empresas where id = v_id;
    if not found then raise exception 'empresa desconhecida'; end if;
    v_pai := v_e.pai;
  elsif p_campos ? 'pai' and jsonb_typeof(p_campos -> 'pai') <> 'null' then
    v_pai := (p_campos ->> 'pai')::uuid;
  end if;

  if p_campos ? 'contas' then
    if jsonb_typeof(p_campos -> 'contas') <> 'array' or jsonb_array_length(p_campos -> 'contas') > 50 then
      raise exception 'contas inválidas';
    end if;
    select coalesce(array_agg(distinct c::uuid), '{}') into v_contas from jsonb_array_elements_text(p_campos -> 'contas') c;
    if exists (select 1 from unnest(v_contas) i where not exists (select 1 from public.contas c where c.id = i)) then
      raise exception 'conta desconhecida';
    end if;
  else
    select coalesce(array_agg(ce.conta_id), '{}') into v_contas from public.conta_empresas ce where ce.empresa_id = v_id;
  end if;

  v_modo := case when p_campos ? 'modo' then
                   case when jsonb_typeof(p_campos -> 'modo') = 'null' then null else p_campos ->> 'modo' end
                 else v_e.modo end;
  v_liga := v_modo = 'ligado' or (not p_campos ? 'modo' and v_id is not null and v_e.pai is null and v_e.separar);
  if coalesce(v_liga, false) and cardinality(v_contas) = 0
     and (v_pai is null or not exists (select 1 from public.conta_empresas ce where ce.empresa_id = v_pai)) then
    return jsonb_build_object('ok', false, 'erro', 'escolha uma conta para ligar');
  end if;
  -- a empresa que fica sem conta não pode deixar sem conta um projeto ligado que usa a dela
  if v_id is not null and v_pai is null and cardinality(v_contas) = 0
     and exists (select 1 from public.empresas p
                  -- o modo do projeto depois deste salvamento: sem modo próprio, ele segue o novo modo da empresa
                  where p.pai = v_id and (p.modo = 'ligado' or (p.modo is distinct from 'desligado' and coalesce(v_liga, false)))
                    and not exists (select 1 from public.conta_empresas ce where ce.empresa_id = p.id)) then
    return jsonb_build_object('ok', false, 'erro', 'um projeto ligado usa a conta desta empresa');
  end if;
  -- só as contas dela: computador antes da 0.20.0 não obedece e abriria a sessão em outra conta
  -- (projeto sem modo ou em teste segue a empresa: dentro de uma empresa ligada, ele vale como ligado)
  if coalesce(v_liga, false)
     or (v_pai is not null and v_modo is distinct from 'desligado' and public.rvz_modo_real(v_pai) = 'ligado') then
    select q.nome into v_atrasado
      from public.computadores q
     where not q.revogado and q.visto_em > now() - interval '24 hours'
       and public.rvz_versao_agente(q.versao) < public.rvz_versao_agente('0.20.0')
     order by q.nome limit 1;
    if found then
      return jsonb_build_object('ok', false, 'erro',
        format('atualize o computador %s antes de ligar: a versão dele ainda não segue a conta da empresa', v_atrasado));
    end if;
  end if;

  if p_campos ? 'pastas' then
    if jsonb_typeof(p_campos -> 'pastas') <> 'array' or jsonb_array_length(p_campos -> 'pastas') > 100 then
      raise exception 'pastas inválidas';
    end if;
    for x in select * from jsonb_array_elements(p_campos -> 'pastas') loop
      v_tipo := x ->> 'tipo';
      v_padrao := btrim(coalesce(x ->> 'padrao', ''));
      v_pc := nullif(x ->> 'computador', '')::uuid;
      if v_tipo not in ('pasta', 'titulo') then raise exception 'tipo inválido'; end if;
      if length(v_padrao) not between 1 and 300 or v_padrao ~ '[[:cntrl:]]' then raise exception 'padrão inválido'; end if;
      if v_tipo = 'pasta' then
        v_padrao := regexp_replace(v_padrao, '(.)/+$', '\1');
        if v_padrao ~ '^(~|/+|[A-Za-z]:)$' then raise exception 'padrão inválido'; end if;
      end if;
      -- a regra que já existia num computador removido não impede de salvar o resto; regra nova nele, sim
      if v_pc is not null
         and not exists (select 1 from public.computadores q where q.id = v_pc and not q.revogado)
         and not exists (select 1 from public.pastas_empresa r
                          where r.empresa_id = v_id and r.computador_id = v_pc and r.tipo = v_tipo and r.padrao = v_padrao) then
        raise exception 'computador desconhecido';
      end if;
      select r.empresa_id into v_dono from public.pastas_empresa r
       where r.tipo = v_tipo and public.rvz_norm_pasta(r.padrao) = public.rvz_norm_pasta(v_padrao)
         and r.empresa_id is distinct from v_id
         and (r.computador_id is null or v_pc is null or r.computador_id = v_pc)
       limit 1;
      if v_dono is not null then
        return jsonb_build_object('ok', false, 'erro',
          format('a pasta %s já é de %s', v_padrao, public.rvz_nome_unidade(v_dono)));
      end if;
      v_pastas := v_pastas || jsonb_build_object('tipo', v_tipo, 'padrao', v_padrao, 'computador', v_pc);
    end loop;
  end if;

  v_r := public.painel_empresa(v_id, p_campos - 'contas' - 'pastas');
  if not coalesce((v_r ->> 'ok')::boolean, false) then return v_r; end if;
  v_id := (v_r ->> 'id')::uuid;

  if p_campos ? 'contas' then
    delete from public.conta_empresas where empresa_id = v_id and not (conta_id = any (v_contas));
    insert into public.conta_empresas (conta_id, empresa_id)
    select i, v_id from unnest(v_contas) i on conflict do nothing;
  end if;
  -- depois das contas: projeto ligado ou que segue a empresa, sem conta própria, usa a conta dela e divide a trilha com
  -- ela, então a empresa ligada recebe a marca junto (o portão de versão acima já valeu). Projeto em teste não muda nada.
  update public.empresas set so_contas_dela = true
   where id = v_id
      or (id = v_pai and (v_modo is null or v_modo = 'ligado') and public.rvz_modo_real(v_pai) = 'ligado'
          and not exists (select 1 from public.conta_empresas ce where ce.empresa_id = v_id));
  -- ligar a empresa liga junto o projeto que segue ela e tem conta própria: ele também só roda nas contas dele
  update public.empresas p set so_contas_dela = true
   where p.pai = v_id and not p.so_contas_dela and public.rvz_modo_real(p.id) = 'ligado'
     and exists (select 1 from public.conta_empresas ce where ce.empresa_id = p.id);
  if p_campos ? 'pastas' then
    delete from public.pastas_empresa r
     where r.empresa_id = v_id
       and not exists (select 1 from jsonb_array_elements(v_pastas) y
                        where y ->> 'tipo' = r.tipo and y ->> 'padrao' = r.padrao
                          and (y ->> 'computador') is not distinct from r.computador_id::text);
    insert into public.pastas_empresa (tipo, padrao, empresa_id, computador_id)
    select y ->> 'tipo', y ->> 'padrao', v_id, nullif(y ->> 'computador', '')::uuid
      from jsonb_array_elements(v_pastas) y
    on conflict (tipo, padrao, coalesce(computador_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  end if;
  perform public.rvz_auditar('unidade', v_id::text,
                             jsonb_build_object('contas', cardinality(v_contas), 'pastas', jsonb_array_length(v_pastas)));
  -- a conta que virou só desta unidade sai da principal na hora
  for v_q in select a.computador_id from public.atribuicao a where not public.rvz_principal_pode(a.conta_id) loop
    perform public.decidir(v_q);
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Salva várias unidades de uma vez (mover uma pasta entre empresas são dois passos): ou entra tudo, ou nada. `ref` é o
-- nome provisório da unidade nova, que um projeto novo pode citar em `pai`.
create or replace function public.painel_unidades(p_passos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x jsonb;
  v_campos jsonb;
  v_r jsonb;
  v_novos jsonb := '{}'::jsonb;
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_passos) <> 'array' or jsonb_array_length(p_passos) not between 1 and 200 then
    raise exception 'passos inválidos';
  end if;
  begin
    for x in select * from jsonb_array_elements(p_passos) loop
      if jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'campos') <> 'object' then raise exception 'passo inválido'; end if;
      v_campos := x -> 'campos';
      if v_campos ? 'pai' and v_novos ? (v_campos ->> 'pai') then
        v_campos := jsonb_set(v_campos, '{pai}', v_novos -> (v_campos ->> 'pai'));
      end if;
      v_r := public.painel_unidade(nullif(x ->> 'id', '')::uuid, v_campos);
      if not coalesce((v_r ->> 'ok')::boolean, false) then
        raise exception using errcode = 'RVZ01', message = coalesce(v_r ->> 'erro', 'não foi possível salvar');
      end if;
      if nullif(x ->> 'id', '') is null and x ? 'ref' then
        v_novos := v_novos || jsonb_build_object(left(x ->> 'ref', 80), v_r ->> 'id');
      end if;
    end loop;
  exception when sqlstate 'RVZ01' then
    -- este bloco desfaz o que os passos anteriores gravaram
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'ids', v_novos);
end $$;

-- ------------------------------------------------------------------------------------------- a conta em uso fica
-- Sessão de unidade estrita aberta no login da principal (a conta dela estava lá e não havia outra para a principal):
-- se a principal trocasse, a sessão seguiria o login para uma conta que não é dela. O agente avisa quais unidades têm
-- sessão viva nesse login, e a conta não sai por motivo nenhum enquanto o aviso se renovar: nem cheia, nem pausada, nem
-- sem login, nem removida. Quem resolve é fechar a sessão, e o alerta diz isso.
create or replace function public.rvz_principal_segura(p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.atribuicao a
     cross join lateral unnest(a.segura_unidades) as u(id)
     where a.computador_id = p_pc and a.segura_ate > now()
       and public.rvz_estrita(u.id) and public.rvz_unidade_ligada(u.id)
       and a.conta_id = any(public.rvz_contas_efetivas(u.id)))
$$;

create or replace function public.agente_segurar_principal(p_empresas uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_conta uuid;
  v_unidades uuid[];
begin
  if p_empresas is null or cardinality(p_empresas) > 50 then raise exception 'lista inválida'; end if;
  -- com a linha presa: uma troca em andamento termina antes, e a trava é calculada sobre a conta que ficou
  select conta_id into v_conta from public.atribuicao where computador_id = v_pc for update;
  if v_conta is null then return jsonb_build_object('ok', true, 'segura', false, 'unidades', '[]'::jsonb); end if;
  select coalesce(array_agg(x), '{}') into v_unidades from unnest(p_empresas) as x
   where public.rvz_estrita(x) and public.rvz_unidade_ligada(x) and v_conta = any(public.rvz_contas_efetivas(x));
  update public.atribuicao
     set segura_unidades = v_unidades,
         segura_ate = case when cardinality(v_unidades) > 0 then now() + interval '3 minutes' end
   where computador_id = v_pc;
  -- quem não voltou na lista está com a conta errada aqui: a sessão dela não abre
  return jsonb_build_object('ok', true, 'segura', cardinality(v_unidades) > 0, 'unidades', to_jsonb(v_unidades),
                            'conta', v_conta);
end $$;

-- O corpo da 0039, mais: a conta segura por uma sessão não sai por troca automática.
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
  v_segura boolean;
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
    v_segura := public.rvz_principal_segura(pc.id);

    -- Uma sessão da empresa ou do projeto roda neste login e só pode rodar nas contas dela: a conta fica, mesmo cheia,
    -- pausada ou sem login (trocar levaria a sessão junto para uma conta que não é dela). O alerta diz o que fazer.
    if v_segura then
      v_ef := public.rvz_pct_efetivo(v_atual);
      if (coalesce(v_pausada, false) or coalesce(v_sem_login, false) or p_limite or coalesce(v_ef, 0) >= v_gatilho)
         and not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_segura'
                         and dados ->> 'computador' = pc.id::text and em > now() - interval '1 hour') then
        perform public.rvz_evento('alerta',
          case when coalesce(v_pausada, false) or coalesce(v_sem_login, false)
               then 'A conta em uso foi pausada ou perdeu o login e fica neste computador porque uma sessão de empresa ou projeto só pode rodar nela. Feche essa sessão para trocar de conta.'
               else 'A conta em uso encheu e fica neste computador porque uma sessão de empresa ou projeto só pode rodar nela. Feche essa sessão para as outras trocarem de conta.' end,
          jsonb_build_object('motivo', 'principal_segura', 'computador', pc.id, 'conta', v_atual));
      end if;
      continue;
    end if;

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

-- O corpo da 0039, mais: a troca à mão não tira a conta de uma sessão que só pode rodar nela.
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
  if public.rvz_principal_segura(p_computador)
     and not exists (select 1 from public.atribuicao where computador_id = p_computador and conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro',
      'uma sessão de empresa ou projeto está rodando na conta em uso: feche essa sessão antes de trocar');
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

-- O corpo da 0039, mais a mesma recusa da troca pelo painel.
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
  if public.rvz_principal_segura(p_computador)
     and not exists (select 1 from public.atribuicao where computador_id = p_computador and conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro',
      'uma sessão de empresa ou projeto está rodando na conta em uso: feche essa sessão antes de trocar');
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

-- O corpo da 0024, mais: a preferida fica guardada, mas não entra por cima de uma sessão que só pode rodar na conta em uso.
create or replace function public.painel_computador_preferida(p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
  end if;
  if p_conta is not null then
    if not exists (select 1 from public.contas where id = p_conta) then
      return jsonb_build_object('ok', false, 'erro', 'conta desconhecida');
    end if;
    if exists (select 1 from public.computadores where conta_preferida = p_conta and id <> p_computador and not revogado) then
      return jsonb_build_object('ok', false, 'erro', 'outro computador já prefere esta conta');
    end if;
  end if;
  update public.computadores set conta_preferida = p_conta where id = p_computador;
  perform public.rvz_auditar('preferida', p_computador::text, jsonb_build_object('conta', p_conta));
  if p_conta is not null and not public.rvz_principal_segura(p_computador)
     and exists (select 1 from public.rvz_candidatas(p_computador) k where k.conta_id = p_conta) then
    perform public.rvz_atribuir(p_computador, p_conta, 'conta preferida deste computador');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- O corpo da 0032, mais: a conta presa por uma sessão de empresa ou projeto não sai.
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
    if public.rvz_principal_segura(v_pc) then
      return jsonb_build_object('ok', false, 'erro',
        format('uma sessão de empresa ou projeto está rodando nesta conta no computador %s: feche essa sessão antes de remover', v_nome));
    end if;
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

-- O corpo da 0039, mais: a conta presa por uma sessão espera ela fechar para sair.
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
        if public.rvz_principal_segura(v_pc) then continue; end if;
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
