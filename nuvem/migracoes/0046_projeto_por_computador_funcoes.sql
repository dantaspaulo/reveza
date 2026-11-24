-- Reveza AI · 0046 · projeto por computador: as funções (as colunas estão na 0045).
-- reaplicável: só funções (create or replace).
--
-- 1. rvz_roda_em: a unidade roda neste computador? O subprojeto segue o projeto.
-- 2. Quem recebe: agente_empresas, as regras, a trilha dividida e a classificação do uso olham só o que roda aqui. A
--    trilha que já existe segue até soltar: sessão aberta não muda de conta.
-- 3. A conta continua em um login só. A principal parada em conta de projeto de outro computador vai para uma conta de
--    projeto daqui, para soltar a outra. Sem nenhuma livre, fica e avisa: não dá para trocar direto entre dois
--    computadores, porque cada agente pega a conta nova antes de soltar a antiga e os dois esperariam para sempre.
-- 4. painel_unidade recebe os computadores, e o portão de versão olha só os computadores do projeto.
-- 5. As frases que a pessoa lê passam de "empresa" para "projeto". O nome interno (empresas, empresa_id) não muda.

-- ------------------------------------------------------------------------------------------- onde o projeto roda
create or replace function public.rvz_roda_em(p_id uuid, p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select r.em_todos_computadores
           or exists (select 1 from public.empresa_computadores ec
                       where ec.empresa_id = r.id and ec.computador_id = p_pc)
      from public.empresas e
      join public.empresas r on r.id = coalesce(e.pai, e.id)
     where e.id = p_id), false)
$$;

-- A conta está marcada para uma unidade ligada e estrita que não roda neste computador.
create or replace function public.rvz_de_outro_computador(p_conta uuid, p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.empresas u
                  where u.so_contas_dela and public.rvz_unidade_de(u.id) = u.id
                    and public.rvz_unidade_ligada(u.id) and public.rvz_marcada(p_conta, u.id)
                    and not public.rvz_roda_em(u.id, p_pc))
$$;

-- ------------------------------------------------------------------------------------------------------ a trilha
-- O corpo da 0044, mais: trilha nova só onde a unidade roda. A que já existe segue, porque pode ter sessão aberta.
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
    if not public.rvz_roda_em(p_emp, p_pc) then return null; end if;
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
             else 'a conta em uso não é mais deste projeto' end);
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
      perform public.rvz_atribuir_trilha(p_pc, p_emp, v_cand, 'voltou para uma conta do projeto');
      return v_cand;
    end if;
  end if;
  return v_atual;
end $$;

-- O corpo da 0044, só entre as unidades que rodam neste computador. A que saiu dele mas ainda tem a trilha aberta aqui
-- continua representando: quem ficou segue no mesmo login em vez de pedir um segundo na mesma conta.
create or replace function public.rvz_trilha_de(p_pc uuid, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_contas uuid[];
  v uuid;
begin
  if not public.rvz_estrita(p_id) or not public.rvz_unidade_ligada(p_id) or public.rvz_unidade_de(p_id) <> p_id
     or not public.rvz_roda_em(p_id, p_pc) then
    return p_id;
  end if;
  v_contas := public.rvz_contas_efetivas(p_id);
  if cardinality(v_contas) = 0 then return p_id; end if;
  select x.id into v
    from public.empresas x
   where x.so_contas_dela and public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
     and public.rvz_contas_efetivas(x.id) = v_contas
     and (public.rvz_roda_em(x.id, p_pc)
          or exists (select 1 from public.atribuicao_trilhas t
                      where t.computador_id = p_pc and t.empresa_id = x.id and t.conta_id = any (v_contas)))
   order by exists (select 1 from public.atribuicao_trilhas t
                     where t.computador_id = p_pc and t.empresa_id = x.id and t.conta_id = any (v_contas)) desc,
            x.criado_em, x.id
   limit 1;
  return coalesce(v, p_id);
end $$;

-- O corpo da 0044, só com quem roda neste computador.
create or replace function public.rvz_lembrar_divisao(p_pc uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.atribuicao_trilhas t
     set unidades = (select array_agg(distinct m) from unnest(t.unidades || d.membros) as m)
    from (select public.rvz_trilha_de(p_pc, x.id) as trilha, array_agg(x.id) as membros
            from public.empresas x
           where x.so_contas_dela and public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
             and public.rvz_roda_em(x.id, p_pc)
           group by 1) d
   where t.computador_id = p_pc and t.empresa_id = d.trilha and not (d.membros <@ t.unidades);
end $$;

-- O corpo da 0044, só com quem roda neste computador (e a própria trilha, mesmo que a unidade tenha saído dele).
create or replace function public.rvz_nome_trilha(p_pc uuid, p_id uuid, p_divide boolean default true) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not p_divide then public.rvz_nome_unidade(p_id)
              else coalesce(left((select string_agg(public.rvz_nome_unidade(x.id), ' + ' order by public.rvz_nome_unidade(x.id))
                                    from public.empresas x
                                   where public.rvz_unidade_de(x.id) = x.id and public.rvz_unidade_ligada(x.id)
                                     and (x.id = p_id or public.rvz_roda_em(x.id, p_pc))
                                     and public.rvz_trilha_de(p_pc, x.id) = p_id), 120),
                            public.rvz_nome_unidade(p_id)) end
$$;

-- ------------------------------------------------------------------------------------------------------ as regras
-- O corpo da 0044, só com as regras dos projetos que rodam neste computador.
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
            where (x.computador_id is null or x.computador_id = p_pc)
              and public.rvz_roda_em(x.empresa_id, p_pc)
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
       and public.rvz_roda_em(x.empresa_id, p_pc)
       and (strpos(v_ag_titulo, lower(btrim(x.padrao))) > 0 or strpos(v_ag_nome, lower(btrim(x.padrao))) > 0)
     order by length(btrim(x.padrao)) desc, x.computador_id is null limit 1;
    if found then v_melhor := r.empresa_id; end if;
  end if;
  return v_melhor;
end $$;

-- O corpo da 0044, mais: cada computador recebe só os projetos e as regras que rodam nele, em qualquer versão do agente.
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
                                     and public.rvz_roda_em(e.id, v_pc)
                                     and not (e.id = any (v_fora))) x), '[]'),
    'regras', case when not exists (select 1 from public.empresas where separar) then '[]'::jsonb
                   else coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'padrao', r.padrao,
                                                                      'empresa', case when v_entende
                                                                       then public.rvz_trilha_de(v_pc, public.rvz_unidade_de(r.empresa_id))
                                                                       else public.rvz_unidade_de(r.empresa_id) end)
                                                   order by r.computador_id is null, r.tipo, r.padrao)
                                    from public.pastas_empresa r
                                   where (r.computador_id is null or r.computador_id = v_pc)
                                     and public.rvz_roda_em(r.empresa_id, v_pc)
                                     and (public.rvz_unidade_ligada(public.rvz_unidade_de(r.empresa_id))
                                          or public.rvz_tira_da_empresa(public.rvz_unidade_de(r.empresa_id)))), '[]') end,
    'computador_id', v_pc);
end $$;

-- ------------------------------------------------------------------------------------------------------- o painel
-- O corpo da 0044, mais: `computadores` (null é todos, a lista é só esses; só no projeto, o subprojeto segue ele). Sem o
-- campo, como o painel antigo, fica como está. O portão de versão olha só os computadores onde o projeto roda.
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
  v_todos boolean;
  v_pcs uuid[] := '{}';
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_campos) <> 'object' then raise exception 'campos inválidos'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('nome', 'cor', 'pai', 'modo', 'contas', 'pastas', 'computadores') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if v_id is not null then
    select * into v_e from public.empresas where id = v_id;
    if not found then raise exception 'projeto desconhecido'; end if;
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

  if p_campos ? 'computadores' then
    if v_pai is not null then raise exception 'o subprojeto roda nos computadores do projeto'; end if;
    if jsonb_typeof(p_campos -> 'computadores') = 'null' then
      v_todos := true;
    else
      if jsonb_typeof(p_campos -> 'computadores') <> 'array' or jsonb_array_length(p_campos -> 'computadores') > 100 then
        raise exception 'computadores inválidos';
      end if;
      select coalesce(array_agg(distinct c::uuid), '{}') into v_pcs from jsonb_array_elements_text(p_campos -> 'computadores') c;
      if cardinality(v_pcs) = 0 then
        return jsonb_build_object('ok', false, 'erro', 'escolha um computador para este projeto');
      end if;
      -- o que já estava na lista e foi removido não impede de salvar o resto; computador novo na lista precisa existir
      if exists (select 1 from unnest(v_pcs) i
                  where not exists (select 1 from public.computadores q where q.id = i and not q.revogado)
                    and not exists (select 1 from public.empresa_computadores ec
                                     where ec.empresa_id = v_id and ec.computador_id = i)) then
        raise exception 'computador desconhecido';
      end if;
      v_todos := false;
    end if;
  else
    -- projeto novo sem o campo vale em todos, como sempre; o subprojeto olha a lista do projeto
    select r.em_todos_computadores into v_todos from public.empresas r where r.id = coalesce(v_pai, v_id);
    v_todos := coalesce(v_todos, true);
    select coalesce(array_agg(ec.computador_id), '{}') into v_pcs
      from public.empresa_computadores ec where ec.empresa_id = coalesce(v_pai, v_id);
  end if;

  v_modo := case when p_campos ? 'modo' then
                   case when jsonb_typeof(p_campos -> 'modo') = 'null' then null else p_campos ->> 'modo' end
                 else v_e.modo end;
  v_liga := v_modo = 'ligado' or (not p_campos ? 'modo' and v_id is not null and v_e.pai is null and v_e.separar);
  if coalesce(v_liga, false) and cardinality(v_contas) = 0
     and (v_pai is null or not exists (select 1 from public.conta_empresas ce where ce.empresa_id = v_pai)) then
    return jsonb_build_object('ok', false, 'erro', 'escolha uma conta para ligar');
  end if;
  -- o projeto que fica sem conta não pode deixar sem conta um subprojeto ligado que usa a dele
  if v_id is not null and v_pai is null and cardinality(v_contas) = 0
     and exists (select 1 from public.empresas p
                  -- o modo do subprojeto depois deste salvamento: sem modo próprio, ele segue o novo modo do projeto
                  where p.pai = v_id and (p.modo = 'ligado' or (p.modo is distinct from 'desligado' and coalesce(v_liga, false)))
                    and not exists (select 1 from public.conta_empresas ce where ce.empresa_id = p.id)) then
    return jsonb_build_object('ok', false, 'erro', 'um subprojeto ligado usa a conta deste projeto');
  end if;
  -- só as contas dela: computador antes da 0.20.0 não obedece e abriria a sessão em outra conta
  -- (subprojeto sem modo ou em teste segue o projeto: dentro de um projeto ligado, ele vale como ligado)
  if coalesce(v_liga, false)
     or (v_pai is not null and v_modo is distinct from 'desligado' and public.rvz_modo_real(v_pai) = 'ligado')
     -- trocar os computadores de um projeto em teste ou desligado leva junto o subprojeto que tem modo próprio ligado
     or (p_campos ? 'computadores' and v_id is not null
         and exists (select 1 from public.empresas s where s.pai = v_id and s.modo = 'ligado')) then
    select q.nome into v_atrasado
      from public.computadores q
     where not q.revogado and q.visto_em > now() - interval '24 hours'
       and (v_todos or q.id = any (v_pcs))
       and public.rvz_versao_agente(q.versao) < public.rvz_versao_agente('0.20.0')
     order by q.nome limit 1;
    if found then
      return jsonb_build_object('ok', false, 'erro',
        format('atualize o computador %s antes de ligar: a versão dele ainda não segue a conta do projeto', v_atrasado));
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

  v_r := public.painel_empresa(v_id, p_campos - 'contas' - 'pastas' - 'computadores');
  if not coalesce((v_r ->> 'ok')::boolean, false) then return v_r; end if;
  v_id := (v_r ->> 'id')::uuid;

  if p_campos ? 'computadores' then
    update public.empresas set em_todos_computadores = v_todos where id = v_id;
    delete from public.empresa_computadores where empresa_id = v_id and not (computador_id = any (v_pcs));
    insert into public.empresa_computadores (empresa_id, computador_id)
    select v_id, i from unnest(v_pcs) i on conflict do nothing;
  end if;

  if p_campos ? 'contas' then
    delete from public.conta_empresas where empresa_id = v_id and not (conta_id = any (v_contas));
    insert into public.conta_empresas (conta_id, empresa_id)
    select i, v_id from unnest(v_contas) i on conflict do nothing;
  end if;
  -- depois das contas: subprojeto ligado ou que segue o projeto, sem conta própria, usa a conta dele e divide a trilha
  -- com ele, então o projeto ligado recebe a marca junto (o portão de versão acima já valeu). Em teste não muda nada.
  update public.empresas set so_contas_dela = true
   where id = v_id
      or (id = v_pai and (v_modo is null or v_modo = 'ligado') and public.rvz_modo_real(v_pai) = 'ligado'
          and not exists (select 1 from public.conta_empresas ce where ce.empresa_id = v_id));
  -- ligar o projeto liga junto o subprojeto que segue ele e tem conta própria: ele também só roda nas contas dele
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
                             jsonb_build_object('contas', cardinality(v_contas), 'pastas', jsonb_array_length(v_pastas),
                                                'computadores', case when v_todos then null else cardinality(v_pcs) end));
  -- a conta que virou só desta unidade sai da principal na hora
  for v_q in select a.computador_id from public.atribuicao a where not public.rvz_principal_pode(a.conta_id) loop
    perform public.decidir(v_q);
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ------------------------------------------------------------------------------------------------- a conta em uso
-- O corpo da 0044, mais: a principal parada em conta de projeto de outro computador vai para uma conta de projeto daqui.
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
  v_de_outro boolean;
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

    -- A conta em uso foi pausada, perdeu o login ou ficou só de projetos separados: sai de uso na hora, para a melhor
    -- que houver, mesmo com a troca automática desligada (pausar é dizer "não use esta"). Sem outra, fica onde está.
    select c.pausada, c.precisa_login into v_pausada, v_sem_login from public.contas c where c.id = v_atual;
    v_so_empresa := not public.rvz_principal_pode(v_atual);
    v_segura := public.rvz_principal_segura(pc.id);

    -- Uma sessão do projeto roda neste login e só pode rodar nas contas dele: a conta fica, mesmo cheia, pausada ou sem
    -- login (trocar levaria a sessão junto para uma conta que não é dele). O alerta diz o que fazer.
    if v_segura then
      v_ef := public.rvz_pct_efetivo(v_atual);
      if (coalesce(v_pausada, false) or coalesce(v_sem_login, false) or p_limite or coalesce(v_ef, 0) >= v_gatilho)
         and not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_segura'
                         and dados ->> 'computador' = pc.id::text and em > now() - interval '1 hour') then
        perform public.rvz_evento('alerta',
          case when coalesce(v_pausada, false) or coalesce(v_sem_login, false)
               then 'A conta em uso foi pausada ou perdeu o login e fica neste computador porque uma sessão de projeto só pode rodar nela. Feche essa sessão para trocar de conta.'
               else 'A conta em uso encheu e fica neste computador porque uma sessão de projeto só pode rodar nela. Feche essa sessão para as outras trocarem de conta.' end,
          jsonb_build_object('motivo', 'principal_segura', 'computador', pc.id, 'conta', v_atual));
      end if;
      continue;
    end if;

    if coalesce(v_pausada, false) or coalesce(v_sem_login, false) or v_so_empresa then
      v_cand := public.rvz_escolher(pc.id, null, 100);
      v_de_outro := public.rvz_de_outro_computador(v_atual, pc.id);
      -- Só sobraram contas de projeto e a em uso é de um projeto de outro computador: vai para uma conta de projeto
      -- daqui, para soltar a outra. Sem nenhuma, fica e avisa uma vez por hora (veja o item 3 no topo).
      if v_cand is null and v_de_outro then
        select k.conta_id into v_cand
          from public.empresas u
         cross join lateral public.rvz_candidatas_trilha(pc.id, u.id, 100, false) k
         where u.so_contas_dela and public.rvz_unidade_de(u.id) = u.id and public.rvz_unidade_ligada(u.id)
           and public.rvz_roda_em(u.id, pc.id)
           and not public.rvz_de_outro_computador(k.conta_id, pc.id)
         order by k.efetivo limit 1;
        if v_cand is null
           and not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'principal_de_outro'
                           and dados ->> 'computador' = pc.id::text and em > now() - interval '1 hour') then
          perform public.rvz_evento('alerta',
            format('O computador %s está numa conta de um projeto de outro computador e não há conta livre para trocar. Deixe uma conta sem projeto, ou que seja de um projeto dele.',
                   (select q.nome from public.computadores q where q.id = pc.id)),
            jsonb_build_object('motivo', 'principal_de_outro', 'computador', pc.id, 'conta', v_atual));
        end if;
      end if;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when v_pausada then 'a conta em uso foi pausada' when v_sem_login then 'a conta em uso precisa entrar de novo'
               when v_de_outro then 'a conta em uso é de um projeto de outro computador'
               else 'a conta em uso agora é só de projetos separados' end);
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

-- --------------------------------------------------------------------------------- as frases que a pessoa lê
-- As funções que só mudam de frase, sem copiar o corpo: a troca é exata, e a bateria recusa frase que tenha ficado para
-- trás (projeto-por-computador.test.mjs).
do $$
declare
  f record;
  v_antes text;
  v_depois text;
  t text[];
  v_frases text[] := array[
    ['uma sessão de empresa ou projeto', 'uma sessão de projeto'],
    ['a conta é só de empresas separadas ou está na trilha de uma empresa', 'a conta é só de projetos separados ou está na trilha de um projeto'],
    ['o projeto não muda de empresa', 'o subprojeto não muda de projeto'],
    ['empresa do projeto desconhecida', 'projeto do subprojeto desconhecido'],
    ['já existe um projeto com esse nome nesta empresa', 'já existe um subprojeto com esse nome neste projeto'],
    ['já existe uma empresa com esse nome', 'já existe um projeto com esse nome'],
    ['a empresa precisa de um modo', 'o projeto precisa de um modo'],
    ['há sessões abertas na trilha desta empresa ou de um projeto dela', 'há sessões abertas na trilha deste projeto ou de um subprojeto dele'],
    ['a conta não é mais desta empresa ou projeto', 'a conta não é mais deste projeto'],
    ['voltaria para uma conta da empresa ou do projeto', 'voltaria para uma conta do projeto'],
    ['empresa desconhecida', 'projeto desconhecido']
  ];
begin
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('api_trocar', 'painel_trocar_agora', 'painel_remover_conta', 'painel_empresa',
                                'painel_empresa_apagar', 'painel_conta_empresas', 'painel_pasta_empresa', 'rvz_rodar_sombra') loop
    v_antes := pg_get_functiondef(f.oid);
    v_depois := v_antes;
    foreach t slice 1 in array v_frases loop
      v_depois := replace(v_depois, t[1], t[2]);
    end loop;
    if v_depois <> v_antes then execute v_depois; end if;
  end loop;
end $$;
