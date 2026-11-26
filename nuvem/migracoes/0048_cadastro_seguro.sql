-- Reveza AI · 0048 · cadastro seguro: a gravação confere no banco que o cadastro não mudou desde a leitura.
-- reaplicável: cria a tabela se faltar e substitui só as funções.
--
-- 0.21.2. Uma gravação feita a partir de uma leitura velha (resposta perdida e página recarregada, outra aba, outro
-- computador) não pode gravar por cima do que outra já mudou. O painel lê a revisão do cadastro antes das tabelas e a
-- manda junto com os passos; aqui, com as quatro tabelas trancadas, a revisão é conferida e só então os passos rodam
-- pela painel_unidades de sempre. Cada gravação leva uma operação: a mesma operação repetida devolve o resultado
-- guardado, sem gravar de novo. A painel_unidades segue liberada para o painel antigo.

create table if not exists public.cadastro_operacoes (
  id uuid primary key,
  autor uuid not null,
  pedido bytea not null,
  resultado jsonb,
  criado_em timestamptz not null default now()
);
alter table public.cadastro_operacoes enable row level security;
revoke all on public.cadastro_operacoes from public, anon, authenticated;

-- A revisão: o sha256 do texto das quatro tabelas que o cadastro grava, em ordem fixa. Só as funções painel_ gravam
-- nelas (0037 a 0046); apagar conta ou computador muda por cascata, e aí a revisão nova é a certa.
create or replace function public.rvz_cadastro_revisao() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'empresas', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.empresas e), '[]'::jsonb),
    'marcas', coalesce((select jsonb_agg(to_jsonb(m) order by m.empresa_id, m.conta_id) from public.conta_empresas m), '[]'::jsonb),
    'regras', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.pastas_empresa r), '[]'::jsonb),
    'computadores', coalesce((select jsonb_agg(to_jsonb(c) order by c.empresa_id, c.computador_id) from public.empresa_computadores c), '[]'::jsonb)
  )::text, 'UTF8')), 'hex')
$$;

create or replace function public.painel_cadastro_revisao() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  return jsonb_build_object('revisao', public.rvz_cadastro_revisao());
end $$;

create or replace function public.painel_unidades_seguro(p_operacao uuid, p_revisao text, p_passos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash bytea;
  v_criou boolean;
  v_anterior public.cadastro_operacoes%rowtype;
  v_resultado jsonb;
begin
  perform public.rvz_exigir_admin();
  if p_operacao is null or p_revisao is null or p_revisao !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_passos) is distinct from 'array' or jsonb_array_length(p_passos) not between 1 and 200
     or pg_column_size(p_passos) > 16777216 then
    raise exception 'pedido inválido';
  end if;
  v_hash := sha256(convert_to(jsonb_build_object('revisao', p_revisao, 'passos', p_passos)::text, 'UTF8'));
  -- a mesma operação ao mesmo tempo espera a primeira terminar (chave primária) e cai no caminho de repetição
  insert into public.cadastro_operacoes (id, autor, pedido)
  values (p_operacao, auth.uid(), v_hash)
  on conflict (id) do nothing returning true into v_criou;
  if not coalesce(v_criou, false) then
    select * into v_anterior from public.cadastro_operacoes where id = p_operacao;
    if v_anterior.autor is distinct from auth.uid() or v_anterior.pedido is distinct from v_hash then
      raise exception 'operação já usada';
    end if;
    return v_anterior.resultado;
  end if;

  -- Toda outra escrita nessas tabelas (desta função ou das antigas) espera aqui até o fim da transação; a revisão lida
  -- depois da tranca já vê o que a gravação anterior deixou.
  lock table public.empresas, public.conta_empresas, public.pastas_empresa, public.empresa_computadores
    in share row exclusive mode;
  if public.rvz_cadastro_revisao() <> p_revisao then
    v_resultado := jsonb_build_object('ok', false, 'erro', 'o cadastro mudou; atualize antes de salvar');
  else
    v_resultado := public.painel_unidades(p_passos);
  end if;
  update public.cadastro_operacoes set resultado = v_resultado where id = p_operacao;
  return v_resultado;
end $$;

-- Fecha a janela entre esta migração e a 0099, que libera só as duas painel_ para o authenticated.
revoke all on function public.rvz_cadastro_revisao() from public, anon, authenticated;
revoke all on function public.painel_cadastro_revisao() from public, anon, authenticated;
revoke all on function public.painel_unidades_seguro(uuid, text, jsonb) from public, anon, authenticated;
