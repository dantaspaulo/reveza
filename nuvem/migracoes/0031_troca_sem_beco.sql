-- Reveza AI · 0031 · a troca que não fica presa numa conta cheia, a conta pausada que sai de uso e o remover conta
-- (relato do Paulo, 06/11/2026).
-- reaplicável: tabela com "if not exists", funções (create or replace).
--
-- Às 11h43 a conta em uso de um computador chegou a 100% e todas as outras estavam entre 85% e 93% (várias pela semana).
-- A lista de candidatas só aceitava conta abaixo do aviso (85%), então a nuvem respondeu "nenhuma conta livre" e o
-- computador ficou 47 minutos na conta cheia, com as sessões paradas, até a janela de 5 horas de outra conta zerar. Às
-- 12h20 a pessoa pausou a conta em uso pelo painel, e o computador seguiu nela. Agora:
--   1. A escolha na hora de trocar (`rvz_escolher`): a livre de sempre (abaixo do aviso, fora as de reserva); sem ela, a
--      com mais folga abaixo do gatilho, com menos uso que a em uso; depois as de reserva, na mesma ordem; e, com a em
--      uso cheia (100% ou a sessão no limite), a com mais folga abaixo de 100%. As regras da pessoa (pausada, login,
--      agenda, teto da semana, sem o modelo deste computador) valem em todos os passos (`rvz_socorro`).
--   2. A conta em uso pausada, ou sem login, sai de uso na hora, para a melhor que houver, mesmo com a troca automática
--      desligada: pausar é dizer "não use esta". O painel_conta decide na hora quando pausa uma conta em uso.
--   3. A conta em uso cheia (100%) troca sem a espera entre trocas.
--   4. Remover conta (`painel_remover_conta`): o computador que estiver nela vai antes para outra; a conta sai da nuvem
--      (login do cofre, janelas e histórico de uso; o uso em tokens fica nos relatórios, sem o nome da conta) e fica um
--      registro em `contas_removidas`, que cada computador lê (`agente_contas_removidas`) para apagar a cópia que guarda
--      do login dela. Quem estava desligado na hora apaga quando voltar.

create table if not exists public.contas_removidas (
  conta_id uuid primary key,
  email text not null check (length(email) <= 320),
  removida_em timestamptz not null default now(),
  removida_por uuid
);
alter table public.contas_removidas enable row level security;
revoke all on public.contas_removidas from anon, authenticated;

-- Contas que podem receber um computador na hora de trocar, até `p_teto` de uso (exclusivo), na ordem do socorro: a
-- preferida deste computador, as que não são de reserva, as que não são preferidas de outro computador ligado, e a com
-- mais folga primeiro. Os mesmos filtros da rvz_candidatas (0028), sem o corte no aviso.
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
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < p_teto
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            public.rvz_pct_efetivo(c.id),
            c.prioridade,
            c.email
$$;

-- A conta para onde um computador vai quando precisa sair da que usa. `p_atual`: o uso da conta em uso (a nova tem de
-- ter menos; null quando a em uso não serve de jeito nenhum: pausada, sem login, sem o modelo, sessão no limite).
-- `p_ate`: o gatilho na troca comum; 100 com a em uso cheia, pausada ou sem login. Null quando não há para onde ir.
create or replace function public.rvz_escolher(p_pc uuid, p_atual numeric, p_ate numeric) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_gatilho numeric := least(p_ate, case when public.rvz_cfg('modo', '"limiar"') #>> '{}' = 'limite' then 100
                                         else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end);
  v uuid;
begin
  -- 1. a livre de sempre (abaixo do aviso), sem as de reserva
  select k.conta_id into v from public.rvz_candidatas(p_pc) k join public.contas c on c.id = k.conta_id
   where not c.reserva limit 1;
  if v is not null then return v; end if;
  -- 2. abaixo do gatilho, sem as de reserva: a com mais folga
  select s.conta_id into v from public.rvz_socorro(p_pc, v_gatilho) s join public.contas c on c.id = s.conta_id
   where not c.reserva and (p_atual is null or s.efetivo < p_atual) limit 1;
  if v is not null then return v; end if;
  -- 3. as de reserva, na mesma ordem
  select k.conta_id into v from public.rvz_candidatas(p_pc) k limit 1;
  if v is not null then return v; end if;
  select s.conta_id into v from public.rvz_socorro(p_pc, v_gatilho) s
   where p_atual is null or s.efetivo < p_atual limit 1;
  if v is not null then return v; end if;
  -- 4. a em uso não serve mais (cheia, pausada, sem login): qualquer uma abaixo de 100%, a com mais folga
  if p_ate > v_gatilho then
    select s.conta_id into v from public.rvz_socorro(p_pc, p_ate) s
     where p_atual is null or s.efetivo < p_atual limit 1;
  end if;
  return v;
end $$;

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
  v_cand uuid;
  v_trocas int := 0;
begin
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

    -- A conta em uso foi pausada ou perdeu o login: sai de uso na hora, para a melhor que houver, mesmo com a troca
    -- automática desligada (pausar é dizer "não use esta"). Sem outra, fica onde está.
    select c.pausada, c.precisa_login into v_pausada, v_sem_login from public.contas c where c.id = v_atual;
    if coalesce(v_pausada, false) or coalesce(v_sem_login, false) then
      v_cand := public.rvz_escolher(pc.id, null, 100);
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when v_pausada then 'a conta em uso foi pausada' else 'a conta em uso precisa entrar de novo' end);
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

-- O corpo da 0025, mais: pausar uma conta em uso decide na hora o computador que está nela (sem esperar o minuto do
-- agendador).
create or replace function public.painel_conta(p_conta uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_modelo text;
  v_pc uuid;
begin
  perform public.rvz_exigir_admin();
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('cor', 'prioridade', 'reserva', 'pausada', 'agenda', 'teto_semana', 'modelo') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if p_campos ? 'agenda' and not public.rvz_agenda_valida(p_campos -> 'agenda') then
    raise exception 'agenda inválida: lista de {"dias":[1..7], "de":"HH:MM", "ate":"HH:MM"}';
  end if;
  if p_campos ? 'modelo' then
    if jsonb_typeof(p_campos -> 'modelo') not in ('string', 'null') then
      raise exception 'modelo inválido';
    end if;
    v_modelo := nullif(lower(btrim(p_campos ->> 'modelo')), '');
    if v_modelo is not null and v_modelo !~ '^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$' then
      raise exception 'modelo inválido';
    end if;
  end if;
  update public.contas set
    cor = coalesce((p_campos ->> 'cor')::smallint, cor),
    prioridade = coalesce((p_campos ->> 'prioridade')::smallint, prioridade),
    reserva = coalesce((p_campos ->> 'reserva')::boolean, reserva),
    pausada = coalesce((p_campos ->> 'pausada')::boolean, pausada),
    agenda = coalesce(p_campos -> 'agenda', agenda),
    teto_semana = case when p_campos ? 'teto_semana' then (p_campos ->> 'teto_semana')::numeric else teto_semana end,
    modelo = case when p_campos ? 'modelo' then v_modelo else modelo end
  where id = p_conta;
  if not found then raise exception 'conta desconhecida'; end if;
  perform public.rvz_auditar('conta', p_conta::text, p_campos);
  if coalesce((p_campos ->> 'pausada')::boolean, false) then
    for v_pc in select a.computador_id from public.atribuicao a where a.conta_id = p_conta loop
      perform public.decidir(v_pc);
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Painel (administrador com duas etapas): tira uma conta do Reveza. O computador que estiver nela vai antes para a
-- melhor que houver; sem outra para ele, a conta fica (a pessoa troca ou pausa antes).
create or replace function public.painel_remover_conta(p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text;
  v_pc uuid;
  v_nome text;
  v_cand uuid;
begin
  perform public.rvz_exigir_admin();
  select email into v_email from public.contas where id = p_conta for update;
  if v_email is null then return jsonb_build_object('ok', false, 'erro', 'conta desconhecida'); end if;
  -- uma conta está atribuída a um computador no máximo (índice único da 0007)
  select a.computador_id, q.nome into v_pc, v_nome
    from public.atribuicao a join public.computadores q on q.id = a.computador_id
   where a.conta_id = p_conta for update of a;
  if v_pc is not null then
    v_cand := public.rvz_escolher(v_pc, null, 100);
    if v_cand is null then
      return jsonb_build_object('ok', false, 'erro',
        format('o computador %s usa esta conta agora e não tem outra para ir: conecte ou libere outra conta antes', v_nome));
    end if;
    perform public.rvz_atribuir(v_pc, v_cand, 'a conta em uso foi removida');
  end if;
  insert into public.contas_removidas (conta_id, email, removida_por) values (p_conta, v_email, auth.uid())
  on conflict (conta_id) do update set removida_em = now(), removida_por = excluded.removida_por;
  delete from public.contas where id = p_conta;
  perform public.rvz_auditar('remover_conta', p_conta::text, jsonb_build_object('email', v_email));
  perform public.rvz_evento('info', format('A conta %s saiu do Reveza.', v_email),
                            jsonb_build_object('conta', p_conta, 'removida', true));
  return jsonb_build_object('ok', true, 'computador', v_pc, 'para', v_cand);
end $$;

-- Agente: as contas removidas (últimos 180 dias), para apagar a cópia do login que o computador guarda delas.
create or replace function public.agente_contas_removidas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_computador();
  return coalesce((select jsonb_agg(jsonb_build_object('conta_id', r.conta_id, 'email', r.email) order by r.removida_em desc)
                     from (select conta_id, email, removida_em from public.contas_removidas
                            where removida_em > now() - interval '180 days'
                            order by removida_em desc limit 200) r), '[]'::jsonb);
end $$;
