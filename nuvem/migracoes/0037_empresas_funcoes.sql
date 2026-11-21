-- Reveza AI · 0037 · as funções das empresas (as tabelas estão na 0036).
-- reaplicável: só funções (create or replace).
--
-- 1. agente_relatar_tokens recebe a pasta inteira de cada linha e de cada sessão (agente de antes manda sem: pasta
--    vazia, como antes) e usa a chave única nova, com a pasta.
-- 2. rvz_purgar_contas_saindo soma o uso de uma conta removida na linha sem conta da mesma hora, computador, projeto,
--    PASTA e modelo (sem a pasta, duas pastas com o mesmo nome curto virariam uma).
-- 3. agente_relatar_agentes: os agentes do OpenBot do computador (pasta, nome, título).
-- 4. painel_empresa, painel_empresa_apagar, painel_conta_empresas, painel_pasta_empresa e painel_pasta_empresa_apagar:
--    só administrador (com a segunda etapa quando a instalação exige), cada uma grava a auditoria.

-- Uma pasta como o agente manda: relativa à pasta pessoal ("~/...") ou absoluta ("/..." ou, no Windows, "D:/..."), sem
-- caractere de controle. O resto vira vazio (o painel usa o nome curto). O agente normaliza do mesmo jeito antes de
-- enviar (registro/pasta.ts, pastaNaNuvem), para duas pastas locais que viram a mesma aqui irem somadas numa linha só.
create or replace function public.rvz_pasta(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when v ~ '^(~|~/.*|/.*|[A-Za-z]:(/.*)?)$' then v else '' end
    from (select left(regexp_replace(btrim(coalesce(p, '')), '[[:cntrl:]]', '', 'g'), 300) as v) x
$$;

create or replace function public.agente_relatar_tokens(p_linhas jsonb, p_sessoes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
begin
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 1000 then raise exception 'linhas inválidas'; end if;
  -- Duas linhas do lote com a mesma chave daqui (pastas locais que a normalização junta) vão somadas: sem isso o lote
  -- inteiro falharia ("cannot affect row a second time") e o uso do computador pararia de subir.
  insert into public.uso_tokens (hora, conta_id, computador_id, projeto, pasta, modelo, respostas, entrada, saida,
                                 cache_escrita, cache_leitura, usd, agentes)
  select x.hora, x.conta_id, v_pc, x.projeto, x.pasta, x.modelo, sum(x.respostas)::int, sum(x.entrada)::bigint,
         sum(x.saida)::bigint, sum(x.cache_escrita)::bigint, sum(x.cache_leitura)::bigint, sum(x.usd), sum(x.agentes)::int
    from (select date_trunc('hour', (l ->> 'hora')::timestamptz) as hora, nullif(l ->> 'conta_id', '')::uuid as conta_id,
                 left(replace(coalesce(l ->> 'projeto', ''), '/', ''), 120) as projeto,
                 public.rvz_pasta(l ->> 'pasta') as pasta, left(l ->> 'modelo', 80) as modelo,
                 (l ->> 'respostas')::int as respostas, (l ->> 'entrada')::bigint as entrada,
                 (l ->> 'saida')::bigint as saida, (l ->> 'cache_escrita')::bigint as cache_escrita,
                 (l ->> 'cache_leitura')::bigint as cache_leitura, (l ->> 'usd')::numeric as usd,
                 greatest(coalesce((l ->> 'agentes')::int, 0), 0) as agentes
            from jsonb_array_elements(p_linhas) l
           where (l ->> 'hora')::timestamptz between now() - interval '400 days' and now() + interval '1 hour') x
   group by x.hora, x.conta_id, x.projeto, x.pasta, x.modelo
  on conflict (hora, coalesce(conta_id, '00000000-0000-0000-0000-000000000000'::uuid), computador_id, projeto, pasta, modelo)
  do update set respostas = excluded.respostas, entrada = excluded.entrada, saida = excluded.saida,
                cache_escrita = excluded.cache_escrita, cache_leitura = excluded.cache_leitura, usd = excluded.usd,
                agentes = excluded.agentes;
  if jsonb_typeof(p_sessoes) = 'array' and jsonb_array_length(p_sessoes) <= 200 then
    insert into public.sessoes (id, computador_id, projeto, pasta, inicio, fim, respostas, tokens, usd, agentes, contas,
                                modelos)
    select left(s ->> 'id', 80), v_pc, left(replace(coalesce(s ->> 'projeto', ''), '/', ''), 120),
           public.rvz_pasta(s ->> 'pasta'),
           (s ->> 'inicio')::timestamptz, (s ->> 'fim')::timestamptz, (s ->> 'respostas')::int,
           (s ->> 'tokens')::bigint, (s ->> 'usd')::numeric, (s ->> 'agentes')::int,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(s -> 'contas') x), '{}'),
           coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(s -> 'modelos') x), '{}')
      from jsonb_array_elements(p_sessoes) s
     where (s ->> 'inicio')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
       and (s ->> 'fim')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
    on conflict (id) do update set fim = excluded.fim, respostas = excluded.respostas, tokens = excluded.tokens,
                                   usd = excluded.usd, agentes = excluded.agentes, contas = excluded.contas,
                                   modelos = excluded.modelos,
                                   pasta = case when excluded.pasta <> '' then excluded.pasta else sessoes.pasta end
    where sessoes.computador_id = v_pc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- O corpo da 0034, com a pasta na soma do uso de uma conta removida.
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

-- Os agentes do OpenBot deste computador: [{pasta, nome, titulo}], no máximo 500. Grava e atualiza; não apaga.
create or replace function public.agente_relatar_agentes(p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  n int;
begin
  if jsonb_typeof(p_lista) <> 'array' or jsonb_array_length(p_lista) > 500 then raise exception 'lista inválida'; end if;
  insert into public.agentes_openbot (computador_id, pasta, nome, titulo, visto_em)
  select distinct on (public.rvz_pasta(a ->> 'pasta')) v_pc, public.rvz_pasta(a ->> 'pasta'),
         left(regexp_replace(coalesce(a ->> 'nome', ''), '[[:cntrl:]]', ' ', 'g'), 120),
         left(regexp_replace(coalesce(a ->> 'titulo', ''), '[[:cntrl:]]', ' ', 'g'), 200), now()
    from jsonb_array_elements(p_lista) a
   where jsonb_typeof(a) = 'object' and public.rvz_pasta(a ->> 'pasta') <> ''
  on conflict (computador_id, pasta) do update set nome = excluded.nome, titulo = excluded.titulo, visto_em = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'gravados', n);
end $$;

-- Cria (p_id nulo) ou muda uma empresa. Campos: nome, cor, transbordo, transbordo_contas.
create or replace function public.painel_empresa(p_id uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_id uuid := p_id;
  v_nome text;
  v_contas uuid[];
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_campos) <> 'object' then raise exception 'campos inválidos'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('nome', 'cor', 'transbordo', 'transbordo_contas') then
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
    insert into public.empresas (nome, cor, transbordo, transbordo_contas)
    values (v_nome, coalesce((p_campos ->> 'cor')::smallint, 0), coalesce(p_campos ->> 'transbordo', 'nenhum'),
            coalesce(v_contas, '{}'))
    returning id into v_id;
  else
    update public.empresas set
      nome = coalesce(v_nome, nome),
      cor = coalesce((p_campos ->> 'cor')::smallint, cor),
      transbordo = coalesce(p_campos ->> 'transbordo', transbordo),
      transbordo_contas = coalesce(v_contas, transbordo_contas)
    where id = v_id;
    if not found then raise exception 'empresa desconhecida'; end if;
  end if;
  perform public.rvz_auditar('empresa', v_id::text, p_campos);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Tira uma empresa. As marcas das contas e as regras de pasta dela saem junto; o uso não muda (ele não guarda a
-- empresa: a classificação é feita na leitura).
create or replace function public.painel_empresa_apagar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nome text;
begin
  perform public.rvz_exigir_admin();
  delete from public.empresas where id = p_id returning nome into v_nome;
  if v_nome is null then raise exception 'empresa desconhecida'; end if;
  perform public.rvz_auditar('empresa_apagar', p_id::text, jsonb_build_object('nome', v_nome));
  return jsonb_build_object('ok', true);
end $$;

-- As empresas que uma conta atende (a lista inteira: o que não vier sai). Lista vazia: a conta atende todas.
create or replace function public.painel_conta_empresas(p_conta uuid, p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.contas where id = p_conta) then raise exception 'conta desconhecida'; end if;
  if jsonb_typeof(p_lista) <> 'array' or jsonb_array_length(p_lista) > 50 then raise exception 'lista inválida'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(p_lista) x;
  if exists (select 1 from unnest(v_ids) i where not exists (select 1 from public.empresas e where e.id = i)) then
    raise exception 'empresa desconhecida';
  end if;
  delete from public.conta_empresas where conta_id = p_conta and not (empresa_id = any (v_ids));
  insert into public.conta_empresas (conta_id, empresa_id)
  select p_conta, i from unnest(v_ids) i on conflict do nothing;
  perform public.rvz_auditar('conta_empresas', p_conta::text, jsonb_build_object('empresas', p_lista));
  return jsonb_build_object('ok', true);
end $$;

-- Uma regra de pasta (cria ou muda a empresa da regra com o mesmo tipo e padrão).
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
  on conflict (tipo, padrao) do update set empresa_id = excluded.empresa_id
  returning id into v_id;
  perform public.rvz_auditar('pasta_empresa', v_id::text,
                             jsonb_build_object('tipo', p_tipo, 'padrao', v_padrao, 'empresa', p_empresa));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.painel_pasta_empresa_apagar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_padrao text;
begin
  perform public.rvz_exigir_admin();
  delete from public.pastas_empresa where id = p_id returning padrao into v_padrao;
  if v_padrao is null then raise exception 'regra desconhecida'; end if;
  perform public.rvz_auditar('pasta_empresa_apagar', p_id::text, jsonb_build_object('padrao', v_padrao));
  return jsonb_build_object('ok', true);
end $$;
