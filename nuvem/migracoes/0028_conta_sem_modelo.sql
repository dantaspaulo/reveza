-- Reveza AI · 0028 · conta que não roda o modelo da sessão, e a semana de cada modelo (relato do Paulo, 22/10/2026).
-- reaplicável: tabela e restrição com "if not exists"/recriadas, funções (create or replace).
--
-- Às 20:56 o Reveza trocou um computador com sessões no Fable 5.1 para uma conta de plano Team, em que o Fable só roda
-- com créditos de uso (e a conta não tinha). As sessões pararam com "Fable 5.1 requires usage credits". A API de uso
-- não diz que modelos cada plano tem, então o mod avisa quando acontece e a nuvem lembra:
--   1. `contas_sem_modelo`: a conta não roda aquele modelo para aquele computador até `ate` (6 horas). Enquanto vale, a
--      conta não é candidata para ele (rvz_candidatas); para os outros computadores, segue normal.
--   2. `agente_sem_modelo(conta, modelo, sessao)`: o agente chama quando uma sessão para por isso; grava a marca e
--      decide na hora (como agente_limite). Sem outra conta livre, fica onde está: o mod passa a sessão para o modelo
--      padrão e ela continua.
--   3. A API passou a mandar a semana de cada modelo numa lista (`limits`, tipo `weekly_scoped`): o agente grava a do
--      Fable como `seven_day_fable`. Ela aparece no painel, mas fica fora do percentual efetivo (quem usa o Opus não
--      troca de conta porque a semana do Fable encheu).

alter table public.uso_janelas drop constraint if exists uso_janelas_tipo_check;
alter table public.uso_janelas add constraint uso_janelas_tipo_check
  check (tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_fable'));

create table if not exists public.contas_sem_modelo (
  conta_id uuid not null references public.contas on delete cascade,
  computador_id uuid not null references public.computadores on delete cascade,
  modelo text not null check (length(modelo) between 1 and 60),
  ate timestamptz not null,
  criado_em timestamptz not null default now(),
  primary key (conta_id, computador_id)
);
alter table public.contas_sem_modelo enable row level security;
revoke all on public.contas_sem_modelo from anon, authenticated;
grant select on public.contas_sem_modelo to authenticated;
drop policy if exists membro_le on public.contas_sem_modelo;
create policy membro_le on public.contas_sem_modelo for select to authenticated using (public.rvz_eh_membro());

-- O corpo da 0003, só com as janelas da conta toda: a semana de um modelo (seven_day_fable) não vale para quem usa outro.
create or replace function public.rvz_pct_efetivo(p_conta uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select max(case when j.reset_em is not null and j.reset_em <= now() then 0 else j.pct end)
    from public.uso_janelas j
   where j.conta_id = p_conta and j.pct is not null
     and j.tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet')
     and (j.lido_em > now() - interval '15 minutes' or (j.reset_em is not null and j.reset_em <= now()))
$$;

-- O corpo da 0024, mais: a conta marcada como sem o modelo deste computador não é candidata para ele enquanto vale.
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
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < (public.rvz_cfg('aviso', '90') #>> '{}')::numeric
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

-- Uma sessão deste computador parou porque a conta em uso não roda o modelo dela (sem créditos de uso). Devolve
-- {ok, versao, trocou}: trocou = a atribuição mudou agora (havia outra conta livre).
create or replace function public.agente_sem_modelo(p_conta uuid, p_modelo text, p_sessao text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_atr uuid;
  v_antes bigint;
  v_versao bigint;
  v_modelo text := left(btrim(coalesce(p_modelo, '')), 60);
begin
  if v_modelo = '' or v_modelo ~ '[[:cntrl:]]' then raise exception 'modelo inválido'; end if;
  select conta_id, versao into v_atr, v_antes from public.atribuicao where computador_id = v_pc;
  if v_atr is distinct from p_conta then
    -- foi a conta de antes da troca: a troca já aconteceu
    return jsonb_build_object('ok', true, 'trocou', true, 'versao', v_antes);
  end if;
  insert into public.contas_sem_modelo (conta_id, computador_id, modelo, ate)
  values (p_conta, v_pc, v_modelo, now() + interval '6 hours')
  on conflict (conta_id, computador_id) do update set modelo = excluded.modelo, ate = excluded.ate, criado_em = now();
  if p_sessao is not null then
    update public.sessoes set parada_no_limite = true where id = p_sessao and computador_id = v_pc;
  end if;
  perform public.rvz_evento('limite', 'Uma sessão parou porque a conta não roda o modelo dela sem créditos de uso.',
    jsonb_build_object('conta', p_conta, 'computador', v_pc, 'modelo', v_modelo, 'motivo', 'sem_modelo'));
  perform public.decidir(v_pc, true);
  select versao into v_versao from public.atribuicao where computador_id = v_pc;
  return jsonb_build_object('ok', true, 'versao', v_versao, 'trocou', v_versao is distinct from v_antes);
end $$;
