-- Reveza AI · 0050 · projetos pelas pastas da barra lateral do OpenBot: as funções (a coluna e a tabela estão na 0049).
-- reaplicável: só funções (create or replace).
--
-- 1. agente_relatar_agentes guarda a cadeia de pastas de cada agente (secoes). Sem o campo (agente antigo), fica vazia;
--    com null (a barra não foi lida agora), fica a que estava, para uma leitura que falha não tirar ninguém do projeto.
--    Agentes na mesma pasta de trabalho ficam com a parte comum das cadeias (a conversa é de todos eles).
-- 2. agente_relatar_secoes (nova): a lista das pastas do computador, para o painel mostrar o nome.
-- 3. rvz_classificar, agente_empresas e painel_unidade conhecem a regra "secao", com portão de versão: computador antes
--    da 0.22.0 não recebe a regra e a nuvem não a aplica a ele.
-- Precedência, igual no agente (trilhas.ts) e no painel: caminho exato ou mais fundo > nome de pasta > pasta do
-- OpenBot (a mais funda ganha) > título > caminho de uma pasta acima. A nota da pasta do OpenBot é a pasta do agente
-- menos 0,49, mais 0,01 por nível (até 9): fica entre o nome (menos 0,25) e o título (menos 0,5).

-- A cadeia que veio do agente: lista de 1 a 10 ids válidos, sem repetir. Fora disso, sem pasta.
create or replace function public.rvz_secoes_validas(p jsonb) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare r text[];
begin
  if jsonb_typeof(p) is distinct from 'array' then return '{}'; end if;
  if jsonb_array_length(p) not between 1 and 10 then return '{}'; end if;
  if exists (select 1 from jsonb_array_elements(p) e
              where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[A-Za-z0-9_-]{1,100}$') then
    return '{}';
  end if;
  r := array(select e #>> '{}' from jsonb_array_elements(p) with ordinality t(e, i) order by i);
  if (select count(distinct x) from unnest(r) x) <> cardinality(r) then return '{}'; end if;
  return r;
end $$;

-- A parte comum do começo das cadeias (lista JSON de listas). Uma delas null: null (não se sabe; fica a que estava).
create or replace function public.rvz_secoes_comuns(p jsonb) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  r text[];
  c text[];
  e jsonb;
  i int;
begin
  if jsonb_typeof(p) is distinct from 'array' then return null; end if;
  for e in select x from jsonb_array_elements(p) x loop
    if jsonb_typeof(e) is distinct from 'array' then return null; end if;
    c := array(select jsonb_array_elements_text(e));
    if r is null then
      r := c;
    else
      i := 0;
      while i < least(cardinality(r), cardinality(c)) and r[i + 1] = c[i + 1] loop i := i + 1; end loop;
      r := r[1:i];
    end if;
  end loop;
  return coalesce(r, '{}');
end $$;

-- O corpo da 0037, mais a cadeia de pastas. Grava e atualiza; não apaga.
create or replace function public.agente_relatar_agentes(p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  g record;
  n int := 0;
begin
  if jsonb_typeof(p_lista) is distinct from 'array' or jsonb_array_length(p_lista) > 500 then
    raise exception 'lista inválida';
  end if;
  for g in
    select x.pasta, (array_agg(x.nome order by x.i))[1] as nome, (array_agg(x.titulo order by x.i))[1] as titulo,
           public.rvz_secoes_comuns(jsonb_agg(x.sec order by x.i)) as secoes
      from (select public.rvz_pasta(a ->> 'pasta') as pasta,
                   left(regexp_replace(coalesce(a ->> 'nome', ''), '[[:cntrl:]]', ' ', 'g'), 120) as nome,
                   left(regexp_replace(coalesce(a ->> 'titulo', ''), '[[:cntrl:]]', ' ', 'g'), 200) as titulo,
                   case when not (a ? 'secoes') then '[]'::jsonb
                        when jsonb_typeof(a -> 'secoes') = 'null' then 'null'::jsonb
                        else to_jsonb(public.rvz_secoes_validas(a -> 'secoes')) end as sec,
                   t.i
              from jsonb_array_elements(p_lista) with ordinality t(a, i)
             where jsonb_typeof(a) = 'object') x
     where x.pasta <> ''
     group by x.pasta
  loop
    if g.secoes is null then
      insert into public.agentes_openbot (computador_id, pasta, nome, titulo, visto_em)
      values (v_pc, g.pasta, g.nome, g.titulo, now())
      on conflict (computador_id, pasta) do update set nome = excluded.nome, titulo = excluded.titulo, visto_em = now();
    else
      insert into public.agentes_openbot (computador_id, pasta, nome, titulo, secoes, visto_em)
      values (v_pc, g.pasta, g.nome, g.titulo, g.secoes, now())
      on conflict (computador_id, pasta) do update
        set nome = excluded.nome, titulo = excluded.titulo, secoes = excluded.secoes, visto_em = now();
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'gravados', n);
end $$;

-- As pastas da barra deste computador: [{id, nome, pai}], no máximo 500, ids válidos e sem repetir. A lista inteira
-- troca a que havia (a pasta que sumiu sai). Lista fora disso é recusada e nada muda.
create or replace function public.agente_relatar_secoes(p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  n int;
begin
  if jsonb_typeof(p_lista) is distinct from 'array' or jsonb_array_length(p_lista) > 500 then
    raise exception 'lista inválida';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lista) s
              where jsonb_typeof(s) <> 'object' or jsonb_typeof(s -> 'id') is distinct from 'string'
                 or (s ->> 'id') !~ '^[A-Za-z0-9_-]{1,100}$')
     or (select count(distinct s ->> 'id') from jsonb_array_elements(p_lista) s) <> jsonb_array_length(p_lista) then
    raise exception 'lista inválida';
  end if;
  delete from public.secoes_openbot o
   where o.computador_id = v_pc
     and not exists (select 1 from jsonb_array_elements(p_lista) s where s ->> 'id' = o.id);
  insert into public.secoes_openbot (computador_id, id, nome, pai, visto_em)
  select v_pc, s ->> 'id',
         left(btrim(regexp_replace(case when jsonb_typeof(s -> 'nome') = 'string' then s ->> 'nome' else '' end,
                                   '[[:cntrl:]]', ' ', 'g')), 120),
         case when jsonb_typeof(s -> 'pai') = 'string' and (s ->> 'pai') ~ '^[A-Za-z0-9_-]{1,100}$'
                   and (s ->> 'pai') <> (s ->> 'id') then s ->> 'pai' end,
         now()
    from jsonb_array_elements(p_lista) s
  on conflict (computador_id, id) do update set nome = excluded.nome, pai = excluded.pai, visto_em = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'gravadas', n);
end $$;

-- O corpo da 0046, mais a pasta do OpenBot (só em computador na 0.22.0 ou mais): entre o nome de pasta e o título.
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
  v_ag_secoes text[];
  v_base text;
  v_secao boolean := public.rvz_versao_agente((select q.versao from public.computadores q where q.id = p_pc))
                     >= public.rvz_versao_agente('0.22.0');
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
  select public.rvz_norm_pasta(a.pasta), lower(a.nome), lower(a.titulo), a.secoes
    into v_ag, v_ag_nome, v_ag_titulo, v_ag_secoes
    from public.agentes_openbot a
   where a.computador_id = p_pc
     and (p = public.rvz_norm_pasta(a.pasta) or left(p, length(public.rvz_norm_pasta(a.pasta)) + 1) = public.rvz_norm_pasta(a.pasta) || '/')
   order by length(public.rvz_norm_pasta(a.pasta)) desc limit 1;
  -- pasta do OpenBot: a regra deste computador cuja pasta está na cadeia do agente; a mais funda ganha
  if v_ag is not null and v_secao and cardinality(v_ag_secoes) > 0 then
    select x.empresa_id, array_position(v_ag_secoes, x.padrao) as fundo into r
      from public.pastas_empresa x
     where x.tipo = 'secao' and x.computador_id = p_pc and x.padrao = any (v_ag_secoes)
       and public.rvz_roda_em(x.empresa_id, p_pc)
     order by array_position(v_ag_secoes, x.padrao) desc limit 1;
    if found and length(v_ag) - 0.49 + 0.01 * least(r.fundo, 9) > v_nota then
      v_nota := length(v_ag) - 0.49 + 0.01 * least(r.fundo, 9); v_melhor := r.empresa_id;
    end if;
  end if;
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

-- O corpo da 0046, mais: a regra de pasta do OpenBot só vai ao computador na 0.22.0 ou mais (o de antes não a conhece).
create or replace function public.agente_empresas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_entende boolean := public.rvz_versao_agente((select versao from public.computadores where id = v_pc))
                       >= public.rvz_versao_agente('0.19.0');
  v_secao boolean := public.rvz_versao_agente((select versao from public.computadores where id = v_pc))
                     >= public.rvz_versao_agente('0.22.0');
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
                                     and (r.tipo <> 'secao' or v_secao)
                                     and public.rvz_roda_em(r.empresa_id, v_pc)
                                     and (public.rvz_unidade_ligada(public.rvz_unidade_de(r.empresa_id))
                                          or public.rvz_tira_da_empresa(public.rvz_unidade_de(r.empresa_id)))), '[]') end,
    'computador_id', v_pc);
end $$;


-- ------------------------------------------------------------------------------------------------------- o painel
-- O corpo da 0046, mais a pasta do OpenBot (tipo "secao": id válido, sempre com computador, uma vez por computador).
-- Na 0046: o corpo da 0044, mais: `computadores` (null é todos, a lista é só esses; só no projeto, o subprojeto segue ele). Sem o
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
      if v_tipo is null or v_tipo not in ('pasta', 'titulo', 'secao') then raise exception 'tipo inválido'; end if;
      if length(v_padrao) not between 1 and 300 or v_padrao ~ '[[:cntrl:]]' then raise exception 'padrão inválido'; end if;
      if v_tipo = 'pasta' then
        v_padrao := regexp_replace(v_padrao, '(.)/+$', '\1');
        if v_padrao ~ '^(~|/+|[A-Za-z]:)$' then raise exception 'padrão inválido'; end if;
      end if;
      -- a pasta do OpenBot: o padrão é o id dela, e o id é do OpenBot de um computador só
      if v_tipo = 'secao' then
        if v_padrao !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'padrão inválido'; end if;
        if v_pc is null then
          return jsonb_build_object('ok', false, 'erro', 'a pasta do OpenBot vale num computador só: escolha o computador');
        end if;
      end if;
      -- a regra que já existia num computador removido não impede de salvar o resto; regra nova nele, sim
      if v_pc is not null
         and not exists (select 1 from public.computadores q where q.id = v_pc and not q.revogado)
         and not exists (select 1 from public.pastas_empresa r
                          where r.empresa_id = v_id and r.computador_id = v_pc and r.tipo = v_tipo and r.padrao = v_padrao) then
        raise exception 'computador desconhecido';
      end if;
      -- o id da pasta do OpenBot é exato (outra caixa é outra pasta); caminho e texto, como sempre
      select r.empresa_id into v_dono from public.pastas_empresa r
       where r.tipo = v_tipo
         and case when v_tipo = 'secao' then r.padrao = v_padrao
                  else public.rvz_norm_pasta(r.padrao) = public.rvz_norm_pasta(v_padrao) end
         and r.empresa_id is distinct from v_id
         and (r.computador_id is null or v_pc is null or r.computador_id = v_pc)
       limit 1;
      if v_dono is not null then
        return jsonb_build_object('ok', false, 'erro',
          case when v_tipo = 'secao'
               then format('a pasta do OpenBot %s já é de %s',
                           coalesce(nullif((select s.nome from public.secoes_openbot s
                                             where s.computador_id = v_pc and s.id = v_padrao), ''), v_padrao),
                           public.rvz_nome_unidade(v_dono))
               else format('a pasta %s já é de %s', v_padrao, public.rvz_nome_unidade(v_dono)) end);
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

-- As rvz_ não são do painel nem do computador: ninguém as executa direto. Da agente_relatar_secoes sai só o público e o
-- anon: o authenticated recebe o execute na 0099 e precisa mantê-lo quando esta migração roda de novo.
revoke all on function public.rvz_secoes_validas(jsonb) from public, anon, authenticated;
revoke all on function public.rvz_secoes_comuns(jsonb) from public, anon, authenticated;
revoke all on function public.agente_relatar_secoes(jsonb) from public, anon;
