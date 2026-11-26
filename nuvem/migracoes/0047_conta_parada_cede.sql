-- Reveza AI · 0047 · conta parada cede ao computador que bateu o limite.
-- reaplicável: coluna com "if not exists", gatilho recriado e funções (create or replace).
--
-- O caso (25/11/2026): o computador que trabalhava bateu o limite e não havia conta livre, enquanto outro computador,
-- ligado e parado havia horas, segurava uma conta com folga. Ficou 72 min parado, até uma conta cheia renovar.
-- Agora, na decidir, sem candidata para quem encheu:
-- 1. Quem pede precisa estar trabalhando e com a conta em uso cheia ou acima do gatilho (a falta do modelo da sessão,
--    agente_sem_modelo, não é limite), passada a espera entre trocas (como na troca de sempre): bateu o limite agora,
--    bateu nessa conta depois de recebê-la (nas últimas 5 h: a sessão parada no limite espera a conta renovar, e a
--    retomada do Reveza a continua na conta nova; o evento da falta do modelo não conta), ou tem sessão que usou essa
--    conta com atividade nos últimos 15 min (sessão só de trilha não conta). Dois computadores parados não trocam entre
--    si, e quem pede conta assim nunca é doador.
-- 2. O doador: outro computador ligado há mais de 60 min (computadores.ligado_desde, marcada por gatilho quando ele volta
--    a ser visto depois de mais de 5 min fora; vazia, de antes desta versão, conta como ligado há tempo), com a conta há
--    mais de 30 min, não escolhida à mão, sem sessão de projeto segurando a principal, sem atividade nem limite em
--    60 min, e com o uso da conta parado (2 leituras ou mais em 60 min, a janela de 5 h igual). Limite conhecido: uma
--    sessão que espera mais de 60 min sem escrever nada parece parada; ela segue na conta do meio e, se bater o limite,
--    troca pelo caminho normal.
-- 3. A conta do doador serve a quem pede: os filtros da rvz_candidatas, menos os de posse e de atribuição.
-- 4. A conta do meio: sem dono, sem posse de outro computador, com cofre, login bom (leitura recente), não pausada, que a
--    principal pode usar, dentro da agenda e do teto da semana, com o modelo no doador. Primeiro as que não são a
--    preferida de outro computador ligado (o doador fica nela, e a preferida não voltaria ao dono); depois a mais cheia,
--    para não gastar uma boa com quem está parado. Sem ela, nada: a troca direta entre os dois travaria (cada agente pega
--    a conta nova antes de soltar a antiga).
-- 5. O doador vai para a do meio e quem pede recebe a dele, que chega quando o doador soltar a posse (o mesmo caminho da
--    troca entre computadores pelo painel). Travas na ordem da decidir e sem esperar: as linhas do doador (computador e
--    atribuição) com skip locked e, só com doador e conta do meio, a trava das trocas. Sem doador, nenhuma trava. Quem não
--    conseguiu a trava, ou deixou de fora um doador com a linha presa por outra decisão, tenta no minuto seguinte, pelo
--    cron, sem alerta.
-- 6. Sem volta: o doador, enquanto não pede conta (o item 1, sem a parte da conta cheia), fica na conta do meio: não
--    troca pela regra (limiar, preferida, devolução da preferida de outro, rodízio) nem gera o aviso de 90% (pegaria a
--    próxima conta boa e viraria doador de novo). Quando volta a trabalhar e bate o limite, troca pelo caminho normal.
--    Pausar a conta, perder o login ou escolher outra à mão seguem valendo.

-- Desde quando o computador está ligado: a hora em que foi visto pela primeira vez, ou de novo depois de mais de 5 min
-- sem ser visto (o agente é visto a cada busca, bem menos que isso). Vazia nos computadores de antes desta versão.
alter table public.computadores add column if not exists ligado_desde timestamptz;

create or replace function public.rvz_ligado_desde() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.ligado_desde := coalesce(new.ligado_desde, new.visto_em);
  elsif new.visto_em is not null
        and (old.visto_em is null or old.visto_em < new.visto_em - interval '5 minutes') then
    new.ligado_desde := new.visto_em;
  end if;
  return new;
end $$;

drop trigger if exists computadores_ligado_desde on public.computadores;
create trigger computadores_ligado_desde before insert or update of visto_em on public.computadores
  for each row execute function public.rvz_ligado_desde();

-- O computador teve sessão com atividade ou bateu o limite nos últimos p_min minutos.
create or replace function public.rvz_computador_ativo(p_pc uuid, p_min integer) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.sessoes s
                  where s.computador_id = p_pc and s.fim > now() - make_interval(mins => p_min))
      or exists (select 1 from public.eventos e
                  where e.em > now() - make_interval(mins => p_min) and e.tipo = 'limite'
                    and e.dados ->> 'computador' = p_pc::text)
$$;

-- Quem encheu está trabalhando: bateu o limite agora, bateu nessa conta depois de recebê-la, ou tem sessão ativa nela.
-- O evento da falta do modelo (motivo sem_modelo, da agente_sem_modelo) não é limite: a sessão segue no modelo padrão.
create or replace function public.rvz_pede_conta(p_pc uuid, p_conta uuid, p_desde timestamptz, p_limite boolean)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_limite, false)
      or exists (select 1 from public.sessoes s
                  where s.computador_id = p_pc and s.fim > now() - interval '15 minutes' and p_conta = any(s.contas))
      or exists (select 1 from public.eventos e
                  where e.em > greatest(coalesce(p_desde, '-infinity'::timestamptz), now() - interval '5 hours')
                    and e.tipo = 'limite' and e.dados ->> 'computador' = p_pc::text
                    and e.dados ->> 'conta' = p_conta::text
                    and coalesce(e.dados ->> 'motivo', '') <> 'sem_modelo')
$$;

-- O uso da conta não subiu nos últimos p_min minutos: duas leituras ou mais, a janela de 5 h igual em todas.
create or replace function public.rvz_uso_parado(p_conta uuid, p_min integer) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(count(h.p5) >= 2 and max(h.p5) = min(h.p5), false)
    from public.uso_historico h
   where h.conta_id = p_conta and h.em > now() - make_interval(mins => p_min)
$$;

-- A conta serviria como principal deste computador, se estivesse livre: os filtros da rvz_candidatas (0039), menos os de
-- posse e de atribuição. Mudou um filtro lá, muda aqui (conta-parada-cede.test.mjs cobre os que dependem do computador).
create or replace function public.rvz_serve_principal(p_conta uuid, p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.contas c
     where c.id = p_conta and not c.pausada and not c.precisa_login
       and not exists (select 1 from public.contas_sem_modelo s
                        where s.conta_id = c.id and s.computador_id = p_pc and s.ate > now())
       and exists (select 1 from public.cofre k where k.conta_id = c.id)
       and public.rvz_principal_pode(c.id)
       and not public.rvz_de_outro_computador(c.id, p_pc)
       and public.rvz_agenda_permite(c.agenda)
       and public.rvz_pct_efetivo(c.id) is not null
       and public.rvz_pct_efetivo(c.id) < (public.rvz_cfg('aviso', '90') #>> '{}')::numeric
       and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                                where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana))
$$;

-- A conta para onde o doador vai: sem dono, sem posse de outro computador, com cofre e login bom, dentro da agenda e do
-- teto, com o modelo no doador; primeiro as que não são preferida de outro computador, depois a mais cheia.
create or replace function public.rvz_conta_do_meio(p_doador uuid, p_evitar uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.contas c
   where c.id <> p_evitar and not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id)
     and not exists (select 1 from public.posse p
                      where p.conta_id = c.id and p.computador_id <> p_doador and p.expira_em > now())
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_principal_pode(c.id)
     and not public.rvz_de_outro_computador(c.id, p_doador)
     and not exists (select 1 from public.contas_sem_modelo s
                      where s.conta_id = c.id and s.computador_id = p_doador and s.ate > now())
     and public.rvz_agenda_permite(c.agenda)
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
     and public.rvz_pct_efetivo(c.id) is not null
   order by public.rvz_preferida_de_outro(c.id, p_doador), public.rvz_pct_efetivo(c.id) desc, c.email
   limit 1
$$;

-- O computador p_doador, na conta p_conta_doador, pode ceder essa conta a p_pc, que está na p_conta: os itens 2 e 3 do
-- topo. Uma regra só para a lista de doadores e para a contagem deles (rvz_ceder_parada).
create or replace function public.rvz_pode_doar(p_doador uuid, p_conta_doador uuid, p_decidido timestamptz, p_motivo text,
                                                p_pc uuid, p_conta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
       p_doador <> p_pc and p_conta_doador is not null and p_conta_doador <> p_conta
       and p_decidido < now() - interval '30 minutes'
       and not (coalesce(p_motivo, '') = any(array['pedido pelo painel', 'pedido pela API']))
       and exists (select 1 from public.computadores q
                    where q.id = p_doador and not q.revogado and q.visto_em > now() - interval '2 minutes'
                      and coalesce(q.ligado_desde, '-infinity'::timestamptz) < now() - interval '60 minutes')
       and not public.rvz_principal_segura(p_doador)
       and not public.rvz_computador_ativo(p_doador, 60)
       -- quem bateu o limite nessa conta (nas últimas 5 h) também espera por ela: não é doador, nem logo depois que
       -- ela renova (as leituras do histórico ainda não mudaram)
       and not public.rvz_pede_conta(p_doador, p_conta_doador, p_decidido, false)
       and public.rvz_uso_parado(p_conta_doador, 60)
       and public.rvz_serve_principal(p_conta_doador, p_pc), false)
$$;

-- Sem candidata para quem encheu: um computador parado cede a conta dele (veja o topo). true = cedeu; false = não há
-- doador; nulo = a trava estava com outra decisão, ou um doador ficou de fora com a linha presa por outra decisão (o
-- cron tenta no minuto seguinte, sem alerta).
create or replace function public.rvz_ceder_parada(p_pc uuid, p_conta uuid, p_desde timestamptz, p_limite boolean)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d record;
  v_meio uuid;
  v_doadores int;
  v_vistos int := 0;
begin
  if p_conta is null or not public.rvz_pede_conta(p_pc, p_conta, p_desde, p_limite) then return false; end if;
  select count(*) into v_doadores from public.atribuicao a
   where public.rvz_pode_doar(a.computador_id, a.conta_id, a.decidido_em, a.motivo, p_pc, p_conta);
  -- sem doador, nenhuma trava: o caso comum não segura nada até o fim da decisão
  if v_doadores = 0 then return false; end if;
  -- A ordem das travas é a da decidir: primeiro as linhas (a do computador doador e a da atribuição dele, sem esperar:
  -- presas por outra decisão, ficam de fora), depois a trava das trocas, também sem esperar. Esta decisão nunca espera
  -- outra, e a decidir do doador, que começa pela linha do computador dele, espera esta terminar.
  for d in
    select a.computador_id as pc, a.conta_id as conta
      from public.atribuicao a
      join public.computadores q on q.id = a.computador_id
     where public.rvz_pode_doar(a.computador_id, a.conta_id, a.decidido_em, a.motivo, p_pc, p_conta)
     order by public.rvz_pct_efetivo(a.conta_id), a.computador_id
       for update of a, q skip locked
  loop
    v_vistos := v_vistos + 1;
    continue when public.rvz_conta_do_meio(d.pc, d.conta) is null;
    -- a trava da rvz_atribuir só agora, com doador e conta do meio: ocupada, o cron tenta no minuto seguinte
    if not pg_try_advisory_xact_lock(778801) then return null; end if;
    -- com a trava, a conta do meio de novo: outra decisão pode tê-la dado a alguém antes
    v_meio := public.rvz_conta_do_meio(d.pc, d.conta);
    if v_meio is null then return null; end if;
    perform public.rvz_atribuir(d.pc, v_meio, 'parado: cedeu a conta a um computador no limite');
    perform public.rvz_atribuir(p_pc, d.conta, 'recebeu a conta de um computador parado');
    return true;
  end loop;
  -- um doador ficou de fora porque outra decisão segurava a linha dele: sem alerta, o cron tenta de novo
  if v_vistos < v_doadores then return null; end if;
  return false;
end $$;

-- ------------------------------------------------------------------------------------------------------ a decidir
-- O corpo da 0046, mais: sem candidata, a conta de um computador parado (rvz_ceder_parada); e o computador que cedeu fica
-- na conta do meio enquanto estiver parado.
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
  v_cedeu boolean;
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

    -- O computador que cedeu a conta fica na do meio enquanto não pede conta, sem troca pela regra (limiar, preferida,
    -- devolução, rodízio) nem aviso de 90%: trocar pegaria a próxima conta boa, e ele viraria doador de novo. Quando
    -- volta a trabalhar e bate o limite, troca pelo caminho normal (o limite nessa conta depois de recebê-la vale por
    -- 5 h, e não só os 15 min da sessão).
    if not p_limite and v_motivo = 'parado: cedeu a conta a um computador no limite'
       and not public.rvz_pede_conta(pc.id, v_atual, v_quando, false) then
      continue;
    end if;

    if p_limite or (v_ef is not null and v_ef >= v_gatilho) then
      -- a livre de sempre; sem ela, a com mais folga (a em uso cheia aceita até 100%)
      v_cand := public.rvz_escolher(pc.id, case when p_limite then null else v_ef end,
                                    case when v_cheia then 100 else v_gatilho end);
      if v_cand is null then
        -- sem conta livre: a de um computador parado, pela conta do meio (veja o topo). Só com a conta em uso cheia ou
        -- acima do gatilho (a falta do modelo da sessão, agente_sem_modelo, chega aqui com limite e a conta com folga)
        -- e com a mesma espera entre trocas da troca de sempre.
        v_cedeu := case when v_cheia or (v_ef is not null and v_ef >= v_gatilho and (p_limite or v_esperou))
                        then public.rvz_ceder_parada(pc.id, v_atual, v_quando, p_limite) else false end;
        if v_cedeu then
          v_trocas := v_trocas + 2;
        elsif v_cedeu is not null and not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'
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
