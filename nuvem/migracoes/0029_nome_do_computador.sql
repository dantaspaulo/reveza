-- Reveza AI · 0029 · o nome de cada computador, dado no painel (pedido de um usuário, 22/10/2026: "se não fica ip ou
-- tipo BOOK 124183127, e fica difícil identificar qual é aquela máquina").
-- reaplicável: coluna com "if not exists" e funções (create or replace).
--
-- O agente manda o nome do sistema ao se registrar, e agente_registrar gravava por cima a cada vez. Agora quem
-- administra renomeia no painel (painel_computador_nome), também o computador novo que ainda espera o primeiro contato,
-- e o nome fica: `nome_do_painel` marca que veio de lá, e o registro do agente não sobrescreve. Nome vazio volta ao
-- nome do sistema (o próximo registro do agente grava). Dois computadores ativos não têm o mesmo nome.

alter table public.computadores add column if not exists nome_do_painel boolean not null default false;

create or replace function public.painel_computador_nome(p_computador uuid, p_nome text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '[[:space:]]+', ' ', 'g'));
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido ou revogado';
  end if;
  if v_nome ~ '[[:cntrl:]]' or length(v_nome) > 60 then raise exception 'nome inválido: até 60 caracteres, sem quebra de linha'; end if;
  if v_nome = '' then
    update public.computadores set nome_do_painel = false where id = p_computador;
    perform public.rvz_auditar('computador_nome', p_computador::text, jsonb_build_object('nome', null));
    return jsonb_build_object('ok', true, 'nome_do_sistema', true);
  end if;
  if exists (select 1 from public.computadores where id <> p_computador and not revogado and lower(nome) = lower(v_nome)) then
    raise exception 'já existe um computador com este nome';
  end if;
  update public.computadores set nome = v_nome, nome_do_painel = true where id = p_computador;
  perform public.rvz_auditar('computador_nome', p_computador::text, jsonb_build_object('nome', v_nome));
  return jsonb_build_object('ok', true, 'nome', v_nome);
end $$;

-- O corpo da 0019, mais: o nome dado no painel não é sobrescrito pelo do sistema.
create or replace function public.agente_registrar(p_nome text, p_sistema text, p_versao text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_atual record;
  v_nome text := btrim(regexp_replace(regexp_replace(left(coalesce(p_nome, ''), 80), '[^[:alnum:] _()-]+', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if (select m.papel from public.membros m where m.user_id = auth.uid()) is distinct from 'computador' then
    raise exception 'só identidade de computador' using errcode = '42501';
  end if;
  if coalesce(p_sistema, '') not in ('macos', 'linux', 'windows') then raise exception 'sistema inválido'; end if;
  select id, revogado, sistema, criado_em into v_atual from public.computadores where user_id = auth.uid() for update;
  if not found then raise exception 'acesso sem registro: crie outro no painel' using errcode = '42501'; end if;
  if v_atual.revogado then raise exception 'computador revogado' using errcode = '42501'; end if;
  if v_atual.sistema = 'pendente' and v_atual.criado_em < now() - interval '24 hours' then
    raise exception 'código de acesso vencido: crie outro no painel' using errcode = '42501';
  end if;
  if v_atual.sistema = 'pendente'
     and exists (select 1 from public.config where chave = 'cofre_impressao')
     and not exists (select 1 from public.ligacao_pedidos where computador_id = v_atual.id and lido_em is not null) then
    raise exception 'este computador ainda não recebeu a chave do cofre: termine a ligação (o código aparece nele e é digitado num computador que já usa o Reveza)'
      using errcode = '42501';
  end if;
  if v_nome = '' then v_nome := 'computador'; end if;
  -- o nome que o administrador deu no painel fica; sem ele, vale o do sistema
  update public.computadores set nome = case when nome_do_painel then nome else v_nome end,
         sistema = p_sistema, versao = left(p_versao, 40), visto_em = now()
   where user_id = auth.uid()
  returning id into v_id;
  return jsonb_build_object('computador_id', v_id);
end $$;
