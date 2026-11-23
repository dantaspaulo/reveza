-- Reveza AI · 0041 · as funções dos projetos e do modo de teste (a tabela está na 0040).
-- reaplicável: só funções (create or replace).
--
-- Unidade: a empresa, ou o projeto que tem contas próprias ou modo próprio. Projeto sem nada próprio é parte da
-- empresa (a mesma trilha e o mesmo login). O modo da unidade: desligado (como hoje), sombra (a nuvem decide e registra
-- o que faria, sem trocar nada) ou ligado (a trilha da 0.18.0). Com tudo desligado, nada muda (os testes provam).

-- ------------------------------------------------------------------------------------------- unidade e modo
-- O modo de uma linha de empresas (empresa ou projeto). Empresa: "separar" (0.18.0) é o ligado; senão o modo gravado.
-- Projeto: o modo dele; sem modo, o da empresa.
create or replace function public.rvz_modo_de(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.pai is null then case when e.separar then 'ligado' when e.modo = 'sombra' then 'sombra' else 'desligado' end
      else coalesce(e.modo, (select case when p.separar then 'ligado' when p.modo = 'sombra' then 'sombra' else 'desligado' end
                               from public.empresas p where p.id = e.pai), 'desligado')
    end
    from public.empresas e where e.id = p_id), 'desligado')
$$;

-- O modo que vale para as sessões: só ligado ou desligado. O teste (sombra) não muda as sessões: a empresa em teste
-- segue desligada, e o projeto em teste (ou sem modo) segue a empresa, como se não tivesse modo próprio.
create or replace function public.rvz_modo_real(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when e.pai is null then case when e.separar then 'ligado' else 'desligado' end
      when e.modo in ('desligado', 'ligado') then e.modo
      else (select case when p.separar then 'ligado' else 'desligado' end from public.empresas p where p.id = e.pai)
    end
    from public.empresas e where e.id = p_id), 'desligado')
$$;

create or replace function public.rvz_unidade_ligada(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.rvz_modo_real(p_id) = 'ligado'
$$;

-- A unidade de uma linha, para as sessões de verdade (trilhas e agente): a empresa é ela mesma; o projeto com contas
-- marcadas ou modo próprio ligado ou desligado também; o projeto sem nada próprio, ou só em teste, é parte da empresa.
create or replace function public.rvz_unidade_de(p_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when e.pai is null then e.id
    when e.modo in ('desligado', 'ligado') or exists (select 1 from public.conta_empresas ce where ce.empresa_id = e.id)
      then e.id
    else e.pai end
  from public.empresas e where e.id = p_id
$$;

-- A unidade de uma linha para o teste (sombra): como a de cima, mas o projeto em teste é unidade própria (é dele que se
-- quer ver o que faria).
create or replace function public.rvz_unidade_teste(p_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when e.pai is null then e.id
    when e.modo is not null or exists (select 1 from public.conta_empresas ce where ce.empresa_id = e.id) then e.id
    else e.pai end
  from public.empresas e where e.id = p_id
$$;

-- O projeto que tira sessões de uma empresa ligada: unidade própria, fora do ligado, numa empresa em que alguma
-- unidade está ligada (a própria empresa ou outro projeto dela). As regras dele vão ao agente para vencer as da
-- empresa e mandar a sessão para a conta do computador. A empresa de cima fora do ligado não tira nada de ninguém: as
-- regras dela não vão ao agente, como na 0.18.0.
create or replace function public.rvz_tira_da_empresa(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.empresas x
     where x.id = p_id and x.pai is not null and public.rvz_unidade_de(x.id) = x.id
       and not public.rvz_unidade_ligada(x.id)
       and exists (select 1 from public.empresas y
                    where (y.id = x.pai or y.pai = x.pai) and public.rvz_unidade_de(y.id) = y.id
                      and public.rvz_unidade_ligada(y.id)))
$$;

-- "Empresa / Projeto" (ou só a empresa), para eventos e para o agente.
create or replace function public.rvz_nome_unidade(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when e.pai is null then e.nome else coalesce((select p.nome from public.empresas p where p.id = e.pai), '?') || ' / ' || e.nome end
    from public.empresas e where e.id = p_id
$$;

-- A versão de um agente como número ("0.19.0" vira 19000, maior.menor.remendo em base mil). O que não casa vira 0: o
-- computador que ainda não disse olá conta como anterior a tudo, que é o lado seguro. Não é a rvz_versao_num da 0021
-- (devolve a lista e só aceita "X.Y.Z" exato): esta aceita sufixo ("0.19.0-rc1") e nunca devolve null.
create or replace function public.rvz_versao_agente(p text) returns integer
language plpgsql immutable set search_path = public, pg_temp as $$
declare m text[];
begin
  m := regexp_match(coalesce(p, ''), '^(\d{1,4})\.(\d{1,4})\.(\d{1,4})');
  if m is null then return 0; end if;
  return least(m[1]::int, 999) * 1000000 + least(m[2]::int, 999) * 1000 + least(m[3]::int, 999);
end $$;

-- As contas marcadas de uma unidade: as dela; projeto sem contas próprias usa as da empresa.
create or replace function public.rvz_marcada(p_conta uuid, p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from public.conta_empresas ce where ce.empresa_id = p_id)
      then exists (select 1 from public.conta_empresas ce where ce.empresa_id = p_id and ce.conta_id = p_conta)
    else exists (select 1 from public.empresas e join public.conta_empresas ce on ce.empresa_id = e.pai
                  where e.id = p_id and ce.conta_id = p_conta)
  end
$$;

-- ------------------------------------------------------------------------------------------- quem a principal usa
-- O corpo da 0039, com o modo da unidade no lugar de "separar": a conta é só de unidades ligadas.
create or replace function public.rvz_so_de_separadas(p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.conta_empresas ce where ce.conta_id = p_conta)
     and not exists (select 1 from public.conta_empresas ce
                      where ce.conta_id = p_conta and not public.rvz_unidade_ligada(ce.empresa_id))
$$;

-- O corpo da 0039, mais: projeto (as contas da empresa e o transbordo dela quando "herdar transbordo").
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

-- ------------------------------------------------------------------------------------------- classificar a pasta
-- A mesma regra do agente e do painel (agente/src/trilhas.ts, criarClassificador): o caminho mais longo vence; o nome
-- de pasta conta como o caminho até ela, um pouco abaixo; o título do agente do OpenBot, como a pasta dele, um pouco
-- abaixo ainda. Devolve a linha (empresa ou projeto) da regra que venceu.
create or replace function public.rvz_norm_pasta(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when length(s) > 1 then regexp_replace(s, '/+$', '') else s end
    from (select lower(regexp_replace(replace(btrim(coalesce(p, '')), '\', '/'), '/+', '/', 'g')) as s) x
$$;

-- A regra é um caminho (começa com ~, / ou a letra de um disco)? Nome de pasta e título não são.
create or replace function public.rvz_regra_caminho(p_tipo text, p_padrao text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_tipo = 'pasta' and btrim(coalesce(p_padrao, '')) ~ '^([~/]|[A-Za-z]:(/|\\|$))'
$$;

-- Uma sessão pode cair nas duas regras, com a de fora (rx) mais específica que a da unidade ligada (ru)? Com dois
-- caminhos: rx igual a ru ou dentro dele (com a barra: "~/a/site2" não está dentro de "~/a/site"). Nome de pasta ou
-- título de um dos lados: pode, porque depende da pasta da sessão (o lado seguro).
create or replace function public.rvz_regras_cruzam(p_tx text, p_px text, p_tu text, p_pu text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case
    when public.rvz_regra_caminho(p_tx, p_px) and public.rvz_regra_caminho(p_tu, p_pu) then
      public.rvz_norm_pasta(p_px) = public.rvz_norm_pasta(p_pu) or public.rvz_norm_pasta(p_pu) = '/'
      or starts_with(public.rvz_norm_pasta(p_px), public.rvz_norm_pasta(p_pu) || '/')
    else true end
$$;

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
  for r in select x.tipo, x.padrao, x.empresa_id from public.pastas_empresa x loop
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
       and (strpos(v_ag_titulo, lower(btrim(x.padrao))) > 0 or strpos(v_ag_nome, lower(btrim(x.padrao))) > 0)
     order by length(btrim(x.padrao)) desc limit 1;
    if found then v_melhor := r.empresa_id; end if;
  end if;
  return v_melhor;
end $$;

-- ------------------------------------------------------------------------------------------- a trilha da unidade
-- O corpo da 0039, com o nome "Empresa / Projeto" no evento.
create or replace function public.rvz_atribuir_trilha(p_pc uuid, p_emp uuid, p_conta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_de uuid;
  v_nome text := public.rvz_nome_unidade(p_emp);
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

-- O corpo da 0039, com o modo da unidade no lugar de "separar" e o nome "Empresa / Projeto" no alerta.
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
    elsif not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'trilha_sem_conta'
                       and dados ->> 'empresa' = p_emp::text and em > now() - interval '1 hour') then
      perform public.rvz_evento('alerta',
        format('%s não tem conta livre: as sessões vão pela conta do computador.', public.rvz_nome_unidade(p_emp)),
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
             else 'a conta em uso não é mais desta empresa ou projeto' end);
      return v_cand;
    end if;
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

-- ------------------------------------------------------------------------------------------- agente
-- O corpo da 0039 com projetos: a lista são as unidades ligadas ("Empresa / Projeto"). As regras que vão são as das
-- unidades ligadas e as dos projetos que tiram sessões de uma empresa ligada (rvz_tira_da_empresa), cada uma apontando
-- para a unidade dela (projeto sem nada próprio aponta para a empresa). A empresa de cima fora do ligado não manda
-- regra, como na 0.18.0: uma regra criada só para os números não muda a conta de ninguém. O agente 0.19.0 escolhe a
-- regra que vence entre as que recebeu e só depois olha se a unidade está na lista (fora dela: a conta do computador).
--
-- Portão de compatibilidade (0.19.0): o agente 0.18.0 e anteriores descartam a regra de unidade fora da lista ANTES de
-- escolher, então a pasta de um projeto que tira sessões de uma empresa ligada cairia na conta dela. Como não dá para
-- escrever "esta subpasta vai na principal" no modelo do 0.18.0, a unidade que ele erraria simplesmente não vai para
-- aquele computador: lá a separação fica como antes de ela ser ligada (rodízio normal), sem conta errada e sem sessão
-- interrompida, até ele atualizar. Erra quando um projeto desses é da mesma empresa ou tem regra que pode pegar a
-- mesma pasta com mais precisão (rvz_regras_cruzam; nome de pasta e título contam sempre). O painel mostra quais
-- computadores estão atrás e o que não vale neles.
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
  end if;
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', public.rvz_nome_unidade(e.id))
                                           order by public.rvz_nome_unidade(e.id))
                            from public.empresas e
                           where public.rvz_unidade_de(e.id) = e.id and public.rvz_unidade_ligada(e.id)
                             and not (e.id = any (v_fora))), '[]'),
    'regras', case when not exists (select 1 from public.empresas where separar) then '[]'::jsonb
                   else coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'padrao', r.padrao,
                                                                      'empresa', public.rvz_unidade_de(r.empresa_id))
                                                   order by r.tipo, r.padrao)
                                    from public.pastas_empresa r
                                   where public.rvz_unidade_ligada(public.rvz_unidade_de(r.empresa_id))
                                      or public.rvz_tira_da_empresa(public.rvz_unidade_de(r.empresa_id))), '[]') end,
    'computador_id', v_pc);
end $$;

-- ------------------------------------------------------------------------------------------- modo de teste (sombra)
-- As candidatas da sombra: as regras da trilha, mas a conta da principal de cada computador não impede (com a unidade
-- ligada ela sairia de lá); a das trilhas de verdade e a das outras sombras impedem.
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
   order by c.reserva, public.rvz_pct_efetivo(c.id), c.prioridade, c.email
$$;

-- A mesma escolha de rvz_escolher_trilha, com as candidatas da sombra.
create or replace function public.rvz_escolher_sombra(p_pc uuid, p_emp uuid, p_atual numeric, p_ate numeric,
                                                      p_nova boolean default false) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_gatilho numeric := least(p_ate, case when public.rvz_cfg('modo', '"limiar"') #>> '{}' = 'limite' then 100
                                         else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end);
  v uuid;
  v_t boolean;
begin
  foreach v_t in array array[false, true] loop
    select k.conta_id into v from public.rvz_candidatas_sombra(p_pc, p_emp, v_aviso, v_t) k limit 1;
    if v is not null then return v; end if;
    select k.conta_id into v from public.rvz_candidatas_sombra(p_pc, p_emp, v_gatilho, v_t) k
     where p_atual is null or k.efetivo < p_atual limit 1;
    if v is not null then return v; end if;
  end loop;
  if p_ate > v_gatilho then
    foreach v_t in array array[false, true] loop
      select k.conta_id into v from public.rvz_candidatas_sombra(p_pc, p_emp, p_ate, v_t) k
       where p_atual is null or k.efetivo < p_atual limit 1;
      if v is not null then return v; end if;
    end loop;
  end if;
  if p_nova then
    select k.conta_id into v from public.rvz_candidatas_sombra(p_pc, p_emp, null, false) k limit 1;
  end if;
  return v;
end $$;

-- De minuto em minuto (agenda na 0042): para cada computador e unidade em teste com sessão viva (sessoes.fim nos
-- últimos 10 min, a pasta classificada pelas regras), decide como a trilha decidiria e grava em trilhas_sombra. Nada
-- é trocado: nem posse, nem atribuição, nem login. Cada mudança vira um evento "info" (os canais de alerta não mandam
-- "info"). A linha de uma unidade sem sessão há 10 min sai.
create or replace function public.rvz_rodar_sombra() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auto boolean := (public.rvz_cfg('auto', 'false') #>> '{}')::boolean;
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_modo text := public.rvz_cfg('modo', '"limiar"') #>> '{}';
  v_troca numeric := (public.rvz_cfg('troca', '95') #>> '{}')::numeric;
  v_espera int := (public.rvz_cfg('espera_entre_trocas_s', '90') #>> '{}')::int;
  v_gatilho numeric := case when v_modo = 'limite' then 100 else v_troca end;
  u record;
  v_atual uuid;
  v_quando timestamptz;
  v_cand uuid;
  v_ef numeric;
  v_motivo text;
  v_pausada boolean;
  v_sem_login boolean;
  n int := 0;
begin
  -- chave só da sombra (778801 a 778804 já têm dono: decisão, vez de atualizar e ligação, nuvem): duas passadas da
  -- agenda nunca rodam juntas, e nada mais espera por ela
  perform pg_advisory_xact_lock(778805);
  if exists (select 1 from public.empresas where modo = 'sombra') then
    for u in
      select x.pc, x.emp, count(*)::int as sessoes
        from (select s.computador_id as pc,
                     public.rvz_unidade_teste(public.rvz_classificar(s.computador_id, s.pasta)) as emp
                from public.sessoes s join public.computadores q on q.id = s.computador_id
               where s.fim > now() - interval '10 minutes' and s.pasta <> '' and not q.revogado) x
       -- a unidade em teste que já está ligada de verdade (projeto em teste com contas próprias numa empresa ligada)
       -- não tem o que testar: a trilha dela é a de verdade
       where x.emp is not null and public.rvz_modo_de(x.emp) = 'sombra' and not public.rvz_unidade_ligada(x.emp)
       group by x.pc, x.emp
       order by x.pc, x.emp
    loop
      select t.conta_id, t.decidido_em into v_atual, v_quando
        from public.trilhas_sombra t where t.computador_id = u.pc and t.empresa_id = u.emp;
      v_cand := null;
      v_motivo := null;
      if v_atual is null then
        v_cand := public.rvz_escolher_sombra(u.pc, u.emp, null, 100, true);
        v_motivo := 'começaria aqui';
      else
        select c.pausada, c.precisa_login into v_pausada, v_sem_login from public.contas c where c.id = v_atual;
        v_ef := public.rvz_pct_efetivo(v_atual);
        if coalesce(v_pausada, true) or coalesce(v_sem_login, false)
           or not (public.rvz_serve_trilha(v_atual, u.emp, false) or public.rvz_serve_trilha(v_atual, u.emp, true)) then
          v_cand := public.rvz_escolher_sombra(u.pc, u.emp, null, 100);
          v_motivo := case when v_pausada then 'a conta foi pausada' when v_sem_login then 'a conta precisa entrar de novo'
                           else 'a conta não é mais desta empresa ou projeto' end;
        elsif v_ef is not null and (v_ef >= 100 or (v_auto and v_ef >= v_gatilho
                                                     and v_quando < now() - make_interval(secs => v_espera))) then
          v_cand := public.rvz_escolher_sombra(u.pc, u.emp, case when v_ef >= 100 then null else v_ef end,
                                               case when v_ef >= 100 then 100 else v_gatilho end);
          v_motivo := case when v_ef >= 100 then 'chegou a 100%' else format('chegou a %s%%', v_troca) end;
        elsif v_auto and not public.rvz_serve_trilha(v_atual, u.emp, false)
              and v_quando < now() - make_interval(secs => v_espera) then
          select k.conta_id into v_cand from public.rvz_candidatas_sombra(u.pc, u.emp, v_aviso, false) k limit 1;
          v_motivo := 'voltaria para uma conta da empresa ou do projeto';
        end if;
        v_cand := coalesce(v_cand, v_atual);
      end if;
      insert into public.trilhas_sombra (computador_id, empresa_id, conta_id, em_uso, motivo, sessoes, trocas, versao,
                                         decidido_em, visto_em)
      values (u.pc, u.emp, v_cand, (select a.conta_id from public.atribuicao a where a.computador_id = u.pc),
              coalesce(v_motivo, ''), u.sessoes, 0, 1, now(), now())
      on conflict (computador_id, empresa_id) do update set
        em_uso = excluded.em_uso,
        sessoes = excluded.sessoes,
        visto_em = now(),
        conta_id = excluded.conta_id,
        motivo = case when trilhas_sombra.conta_id is distinct from excluded.conta_id then excluded.motivo
                      else trilhas_sombra.motivo end,
        trocas = trilhas_sombra.trocas + case when trilhas_sombra.conta_id is not null
                                               and trilhas_sombra.conta_id is distinct from excluded.conta_id then 1 else 0 end,
        versao = trilhas_sombra.versao + case when trilhas_sombra.conta_id is distinct from excluded.conta_id then 1 else 0 end,
        decidido_em = case when trilhas_sombra.conta_id is distinct from excluded.conta_id then now()
                           else trilhas_sombra.decidido_em end;
      if v_cand is distinct from v_atual then
        perform public.rvz_evento('info',
          format('Em teste, %s %s: %s → %s (%s). Nada foi trocado.', public.rvz_nome_unidade(u.emp),
                 case when v_atual is null then 'começaria' else 'trocaria' end,
                 coalesce((select email from public.contas where id = v_atual), 'nenhuma'),
                 coalesce((select email from public.contas where id = v_cand), 'nenhuma'), v_motivo),
          jsonb_build_object('motivo', 'sombra', 'computador', u.pc, 'empresa', u.emp, 'de', v_atual, 'para', v_cand,
                             'razao', v_motivo));
      end if;
      n := n + 1;
    end loop;
  end if;
  delete from public.trilhas_sombra where visto_em < now() - interval '10 minutes';
  return n;
end $$;

-- ------------------------------------------------------------------------------------------- painel
-- O corpo da 0039, mais: "pai" (cria um projeto dentro da empresa), "modo" e "herdar_transbordo". Projeto não tem
-- projeto. "separar" fica igual a "o modo gravado é ligado" (na empresa e no projeto): o agente_ola da 0039 liga as
-- trilhas do computador quando alguma linha tem "separar", e assim continua certo sem ser reescrito.
create or replace function public.painel_empresa(p_id uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_id uuid := p_id;
  v_nome text;
  v_contas uuid[];
  v_pc uuid;
  v_pai uuid;
  v_modo text;
  v_e public.empresas%rowtype;
begin
  perform public.rvz_exigir_admin();
  if jsonb_typeof(p_campos) <> 'object' then raise exception 'campos inválidos'; end if;
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('nome', 'cor', 'transbordo', 'transbordo_contas', 'separar', 'pai', 'modo', 'herdar_transbordo') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if v_id is not null then
    select * into v_e from public.empresas where id = v_id;
    if not found then raise exception 'empresa desconhecida'; end if;
    if p_campos ? 'pai' and (p_campos ->> 'pai') is distinct from (v_e.pai::text) then
      raise exception 'o projeto não muda de empresa';
    end if;
    v_pai := v_e.pai;
  elsif p_campos ? 'pai' and jsonb_typeof(p_campos -> 'pai') <> 'null' then
    v_pai := (p_campos ->> 'pai')::uuid;
    if not exists (select 1 from public.empresas where id = v_pai and pai is null) then
      raise exception 'empresa do projeto desconhecida';
    end if;
  end if;
  if p_campos ? 'nome' then
    v_nome := btrim(coalesce(p_campos ->> 'nome', ''));
    if length(v_nome) not between 1 and 60 or v_nome ~ '[[:cntrl:]]' then raise exception 'nome inválido'; end if;
    if exists (select 1 from public.empresas where lower(btrim(nome)) = lower(v_nome) and id is distinct from v_id
                and pai is not distinct from v_pai) then
      return jsonb_build_object('ok', false, 'erro',
        case when v_pai is null then 'já existe uma empresa com esse nome' else 'já existe um projeto com esse nome nesta empresa' end);
    end if;
  end if;
  if p_campos ? 'transbordo' and coalesce(p_campos ->> 'transbordo', '') not in ('nenhum', 'qualquer', 'escolhidas') then
    raise exception 'transbordo inválido';
  end if;
  if p_campos ? 'separar' and jsonb_typeof(p_campos -> 'separar') <> 'boolean' then
    raise exception 'separar inválido';
  end if;
  if p_campos ? 'herdar_transbordo' and jsonb_typeof(p_campos -> 'herdar_transbordo') <> 'boolean' then
    raise exception 'herdar transbordo inválido';
  end if;
  if p_campos ? 'modo' then
    v_modo := case when jsonb_typeof(p_campos -> 'modo') = 'null' then null else p_campos ->> 'modo' end;
    if v_modo is not null and v_modo not in ('desligado', 'sombra', 'ligado') then raise exception 'modo inválido'; end if;
    if v_modo is null and v_pai is null then raise exception 'a empresa precisa de um modo'; end if;
  end if;
  if p_campos ? 'transbordo_contas' then
    if jsonb_typeof(p_campos -> 'transbordo_contas') <> 'array' or jsonb_array_length(p_campos -> 'transbordo_contas') > 50 then
      raise exception 'contas do transbordo inválidas';
    end if;
    select coalesce(array_agg(c.id order by c.prioridade, c.id), '{}') into v_contas
      from public.contas c
     where c.id in (select x::uuid from jsonb_array_elements_text(p_campos -> 'transbordo_contas') x);
  end if;
  if v_id is null then
    if v_nome is null then raise exception 'nome inválido'; end if;
    insert into public.empresas (nome, cor, transbordo, transbordo_contas, separar, pai, modo, herdar_transbordo)
    values (v_nome, coalesce((p_campos ->> 'cor')::smallint, 0), coalesce(p_campos ->> 'transbordo', 'nenhum'),
            coalesce(v_contas, '{}'),
            case when v_pai is not null then coalesce(v_modo, '') = 'ligado'
                 when p_campos ? 'modo' then v_modo = 'ligado'
                 else coalesce((p_campos ->> 'separar')::boolean, false) end,
            v_pai,
            case when v_pai is not null then v_modo
                 when p_campos ? 'modo' then v_modo
                 when coalesce((p_campos ->> 'separar')::boolean, false) then 'ligado'
                 else null end,
            coalesce((p_campos ->> 'herdar_transbordo')::boolean, true))
    returning id into v_id;
  else
    update public.empresas set
      nome = coalesce(v_nome, nome),
      cor = coalesce((p_campos ->> 'cor')::smallint, cor),
      transbordo = coalesce(p_campos ->> 'transbordo', transbordo),
      transbordo_contas = coalesce(v_contas, transbordo_contas),
      separar = case when pai is not null then
                       case when p_campos ? 'modo' then coalesce(v_modo, '') = 'ligado' else separar end
                     when p_campos ? 'modo' then v_modo = 'ligado'
                     else coalesce((p_campos ->> 'separar')::boolean, separar) end,
      modo = case when p_campos ? 'modo' then v_modo
                  when pai is null and p_campos ? 'separar' then
                    case when (p_campos ->> 'separar')::boolean then 'ligado'
                         when modo = 'ligado' then 'desligado' else modo end
                  else modo end,
      herdar_transbordo = coalesce((p_campos ->> 'herdar_transbordo')::boolean, herdar_transbordo)
    where id = v_id;
  end if;
  perform public.rvz_auditar(case when v_pai is null then 'empresa' else 'projeto' end, v_id::text, p_campos);
  if p_campos ? 'separar' or p_campos ? 'modo' then
    for v_pc in select a.computador_id from public.atribuicao a where not public.rvz_principal_pode(a.conta_id) loop
      perform public.decidir(v_pc);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- O corpo da 0039, mais: os projetos dela saem junto (on delete cascade), então nenhum deles pode ter trilha.
create or replace function public.painel_empresa_apagar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nome text;
  v_pai uuid;
begin
  perform public.rvz_exigir_admin();
  if exists (select 1 from public.atribuicao_trilhas t join public.empresas e on e.id = t.empresa_id
              where e.id = p_id or e.pai = p_id) then
    return jsonb_build_object('ok', false, 'erro',
      'há sessões abertas na trilha desta empresa ou de um projeto dela: desligue e espere as sessões terminarem');
  end if;
  delete from public.empresas where id = p_id returning nome, pai into v_nome, v_pai;
  if v_nome is null then raise exception 'empresa desconhecida'; end if;
  perform public.rvz_auditar(case when v_pai is null then 'empresa_apagar' else 'projeto_apagar' end, p_id::text,
                             jsonb_build_object('nome', v_nome));
  return jsonb_build_object('ok', true);
end $$;
