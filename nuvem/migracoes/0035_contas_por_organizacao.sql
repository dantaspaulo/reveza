-- Reveza AI · 0035 · a mesma pessoa em dois planos não é uma conta só.
-- A conta do Team e a do plano individual têm o mesmo e-mail, mas organizações diferentes do Claude. O registro
-- antigo olhava só o e-mail, e a segunda substituía a primeira.
-- reaplicável: não (mexe em tabela). A identidade de uma conta passa a ser (e-mail, organização do Claude).

alter table public.contas add column if not exists organizacao_id text
  check (organizacao_id is null or length(organizacao_id) <= 80);
alter table public.contas add column if not exists account_uuid text
  check (account_uuid is null or length(account_uuid) <= 80);

-- A conta de antes da 0035 não tem o uuid da organização. A unicidade por e-mail sozinho sai; no lugar entra
-- (e-mail, organização), com a organização vazia quando o computador ainda não a conhece.
alter table public.contas drop constraint if exists contas_email_key;
create unique index if not exists contas_email_organizacao
  on public.contas (email, (coalesce(organizacao_id, '')));

-- Registro de um login. A identidade é (e-mail, organização): a mesma pessoa no Team e no plano individual são duas
-- contas, com dois cofres. A linha de antes da 0035, sem organizacao_id, é adotada uma vez pelo registro cuja
-- organização textual é a mesma, para o login que já estava no cofre não se perder.
drop function if exists public.agente_registrar_conta(text, text, text, text, text, text, timestamptz);
create or replace function public.agente_registrar_conta(p_email text, p_organizacao text, p_plano text, p_nivel text,
                                              p_cifrado text, p_nonce text, p_expira_em timestamptz default null,
                                              p_organizacao_id text default null, p_account_uuid text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_id uuid;
  v_versao bigint;
  v_cor smallint;
  v_org text := nullif(left(coalesce(p_organizacao_id, ''), 80), '');
  v_org_nome text := nullif(left(coalesce(p_organizacao, ''), 200), '');
  v_contas bigint;
begin
  if length(coalesce(p_email, '')) > 254 or lower(coalesce(p_email, '')) !~
     '^[a-z0-9][a-z0-9._%+-]*@[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'e-mail inválido';
  end if;
  if v_org is not null and v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'organização inválida';
  end if;
  -- Agente de antes da 0035 não manda a organização: com duas contas do mesmo e-mail, ele não tem como escolher.
  -- Recusar é melhor do que sobrescrever uma das duas.
  if v_org is null then
    select count(*) into v_contas from public.contas where email = lower(p_email);
    if v_contas > 1 then
      return jsonb_build_object('ok', false, 'erro', 'há mais de uma conta com este e-mail; atualize o agente para distinguir a organização');
    end if;
  end if;
  select id into v_id from public.contas
    where email = lower(p_email) and organizacao_id is not distinct from v_org;
  if v_id is null and v_org is not null then
    -- linha de antes da 0035: mesma organização textual e sem o uuid
    select id into v_id from public.contas
      where email = lower(p_email) and organizacao_id is null
        and organizacao is not distinct from v_org_nome
      order by criado_em limit 1
      for update;
  end if;
  -- Antes de qualquer gravação: conta que outro computador tem (atribuída a ele ou com posse viva) não muda daqui.
  if v_id is not null and (
       exists (select 1 from public.atribuicao where conta_id = v_id and computador_id <> v_pc)
    or exists (select 1 from public.posse where conta_id = v_id and computador_id <> v_pc and expira_em > now())) then
    return jsonb_build_object('ok', false, 'erro', 'conta com outro computador agora; tente de novo em instantes');
  end if;
  select coalesce(max(cor) + 1, 0) % 32 into v_cor from public.contas;
  if v_id is not null then
    update public.contas
       set organizacao = coalesce(v_org_nome, organizacao), plano = left(p_plano, 40), nivel = left(p_nivel, 40),
           organizacao_id = coalesce(v_org, organizacao_id),
           account_uuid = coalesce(nullif(left(coalesce(p_account_uuid, ''), 80), ''), account_uuid),
           precisa_login = false
     where id = v_id;
  else
    insert into public.contas (email, organizacao, plano, nivel, organizacao_id, account_uuid, cor)
    values (lower(p_email), v_org_nome, left(p_plano, 40), left(p_nivel, 40), v_org,
            nullif(left(coalesce(p_account_uuid, ''), 80), ''), v_cor)
    on conflict (email, (coalesce(organizacao_id, ''))) do update set
      organizacao = excluded.organizacao, plano = excluded.plano, nivel = excluded.nivel,
      account_uuid = coalesce(excluded.account_uuid, contas.account_uuid), precisa_login = false
    returning id into v_id;
  end if;
  select coalesce(versao, 0) + 1 into v_versao from public.cofre where conta_id = v_id;
  v_versao := coalesce(v_versao, 1);
  insert into public.cofre (conta_id, cifrado, nonce, versao, expira_em, gravado_por)
  values (v_id, decode(p_cifrado, 'base64'), decode(p_nonce, 'base64'), v_versao, p_expira_em, v_pc)
  on conflict (conta_id) do update set cifrado = excluded.cifrado, nonce = excluded.nonce, versao = excluded.versao,
                                       expira_em = excluded.expira_em, gravado_por = excluded.gravado_por,
                                       gravado_em = now();
  perform public.rvz_evento('conexao', format('%s (%s) conectada.', lower(p_email), coalesce(v_org_nome, 'sem organização')),
                            jsonb_build_object('conta', v_id, 'computador', v_pc, 'organizacao_id', v_org));
  return jsonb_build_object('ok', true, 'conta_id', v_id, 'versao', v_versao);
end $$;

-- A busca de 5 em 5 s: a conta que já estava no computador é identificada pelo e-mail e, quando o agente manda, pela
-- organização. Sem o uuid, a linha de antes da 0035 continua valendo.
drop function if exists public.agente_ola(text, jsonb, text);
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
    'ligacoes', public.rvz_ligacoes_abertas(v_pc));
end $$;
