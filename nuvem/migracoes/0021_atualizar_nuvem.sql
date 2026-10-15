-- Reveza AI · 0021 · a nuvem e o painel também se atualizam sozinhos (pedido do Paulo, 12/10/2026, para a 0.3.0).
-- reaplicável: tabela "if not exists", restrição recriada, permissões e funções (create or replace).
-- 0.3.2: roda de novo para devolver o corpo de agente_vez_de_atualizar com o portão da publicação. Na subida da 0.3.0
-- para a 0.3.1, o plano rodou só a 0020 (que mudou) e a versão dela, mais antiga, ficou por cima da desta. O plano agora
-- roda também as reaplicáveis seguintes à primeira que muda (auditoria de segurança run-3).
--
-- 1. A nuvem aplica as próprias migrações, sem credencial guardada: a Edge Function `atualizar-nuvem` usa a conexão que
--    a plataforma dá às funções (SUPABASE_DB_URL), só aceita versão oficial publicada e mais nova, e chama as funções
--    `servico_nuvem_*` daqui para marcar o andamento (uma atualização por vez) e o fim (versão da nuvem, alerta).
-- 2. As Edge Functions e o painel precisam dos tokens do Supabase e da Vercel. Ligar isso é opcional (desligado de
--    fábrica): os tokens chegam aqui CIFRADOS com a chave do cofre (a mesma dos logins), a nuvem guarda texto que não lê
--    e só um computador da instalação abre (`credenciais_atualizacao`, só por função de computador).
-- 3. A ordem: nuvem (migrações) → funções e painel (um computador por vez, `publicacao_vez`) → computadores. Com a
--    atualização completa ligada, os computadores só se atualizam sozinhos depois que funções e painel foram publicados.
--
-- Configuração nova (só leitura para o painel; escrita só por estas funções e pelo instalador):
--   nuvem_versao        "X.Y.Z": a versão cujas migrações a nuvem tem
--   nuvem_atualizacao   {estado: atualizando|atualizada|falhou, de, para, desde, fim, por, motivo, aplicadas}
--   publicado           {funcoes: "X.Y.Z", painel: "X.Y.Z", em}: o que está no ar
--   impressoes          {"X.Y.Z": {funcoes, painel}}: o resumo das funções e do painel de cada versão (a função calcula)
--   painel_publicacao   {projeto, equipe, dominio, url, url_vercel, vapid}: o que qualquer computador precisa para publicar
--   atualizacao_completa {ligada, em, computador}: os tokens guardados (nunca os tokens)
--   publicacao_vez      {computador, para, desde, estado, partes, motivo}: quem publica agora

alter table public.config drop constraint if exists config_chave_check;
alter table public.config add constraint config_chave_check check (chave in ('auto', 'modo', 'aviso', 'troca',
  'rodizio_minutos', 'rodizio_ordem', 'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s', 'proximo_rodizio_em',
  'fuso', 'alertas_ate', 'exigir_duas_etapas', 'cofre_impressao', 'atualizar_sozinho', 'atualizacao_vez',
  'nuvem_versao', 'nuvem_atualizacao', 'publicado', 'impressoes', 'painel_publicacao', 'atualizacao_completa',
  'publicacao_vez', 'idioma'));

-- Os tokens cifrados (AES-256-GCM com a chave do cofre, dado associado "reveza-atualizacao|<nome>"). Ninguém lê de
-- fora: nem o painel, nem a chave de serviço. Só as funções agente_* (computador ativo) e o apagar do administrador.
create table if not exists public.credenciais_atualizacao (
  nome text primary key check (nome in ('supabase', 'vercel')),
  cifrado bytea not null check (length(cifrado) between 17 and 8192),
  nonce bytea not null check (length(nonce) = 12),
  gravado_por uuid references public.computadores on delete set null,
  gravado_em timestamptz not null default now()
);
alter table public.credenciais_atualizacao enable row level security;
revoke all on public.credenciais_atualizacao from public, anon, authenticated, service_role;

-- "X.Y.Z" em números, para comparar; null quando não é versão.
create or replace function public.rvz_versao_num(p text) returns integer[]
language sql immutable set search_path = public, pg_temp as $$
  select case when p ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then string_to_array(p, '.')::integer[] end
$$;

-- O que falta publicar para a versão da nuvem: funções e painel. Uma parte fica em dia quando a versão publicada já é a
-- da nuvem (ou mais nova), ou quando a função calculou que as duas versões têm o mesmo resumo daquela parte (a versão
-- nova não mexeu nela). Sem saber o que está no ar, conta como pendente.
create or replace function public.rvz_publicacao_pendente() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_nuvem text := public.rvz_cfg('nuvem_versao', 'null') #>> '{}';
  v_pub jsonb := public.rvz_cfg('publicado', '{}');
  v_imp jsonb := public.rvz_cfg('impressoes', '{}');
  v_r jsonb := '{}';
  v_parte text;
  v_ver text;
begin
  if public.rvz_versao_num(v_nuvem) is null then
    return jsonb_build_object('versao', null, 'funcoes', false, 'painel', false);
  end if;
  if jsonb_typeof(v_pub) <> 'object' then v_pub := '{}'; end if;
  if jsonb_typeof(v_imp) <> 'object' then v_imp := '{}'; end if;
  foreach v_parte in array array['funcoes', 'painel'] loop
    v_ver := v_pub ->> v_parte;
    v_r := v_r || jsonb_build_object(v_parte, case
      when public.rvz_versao_num(v_ver) is null then true
      when public.rvz_versao_num(v_ver) >= public.rvz_versao_num(v_nuvem) then false
      when (v_imp #>> array[v_nuvem, v_parte]) is not null
           and (v_imp #>> array[v_nuvem, v_parte]) = (v_imp #>> array[v_ver, v_parte]) then false
      else true end);
  end loop;
  return v_r || jsonb_build_object('versao', v_nuvem);
end $$;

-- A atualização completa está ligada de verdade (os dois tokens cifrados guardados)?
create or replace function public.rvz_completa_ligada() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from public.credenciais_atualizacao where nome in ('supabase', 'vercel')) = 2
$$;

-- ------------------------------------------------------------------------------------------- a função atualizar-nuvem
-- Chamadas pela Edge Function pela conexão do banco (o papel dono das tabelas); nenhum papel de fora executa.

create or replace function public.servico_nuvem_estado() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'versao', public.rvz_cfg('nuvem_versao', 'null'),
    'atualizar_sozinho', public.rvz_modo_atualizar(public.rvz_cfg('atualizar_sozinho', 'false')),
    'fuso', public.rvz_cfg('fuso', '"America/Sao_Paulo"'),
    'atualizacao', public.rvz_cfg('nuvem_atualizacao', 'null'),
    'publicado', public.rvz_cfg('publicado', 'null'),
    'impressoes', public.rvz_cfg('impressoes', '{}'))
$$;

-- Começar: uma atualização da nuvem por vez. A vez vale 10 minutos (a função termina bem antes, ou cai).
create or replace function public.servico_nuvem_comecar(p_para text, p_por text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_at jsonb;
  v_de text;
begin
  if public.rvz_versao_num(p_para) is null then raise exception 'versão inválida'; end if;
  if coalesce(p_por, '') not in ('painel', 'sozinho') then raise exception 'origem inválida'; end if;
  perform pg_advisory_xact_lock(778803);
  v_at := public.rvz_cfg('nuvem_atualizacao', 'null');
  if v_at ->> 'estado' = 'atualizando' and (v_at ->> 'desde')::timestamptz > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'atualizando', 'para', v_at ->> 'para');
  end if;
  v_de := public.rvz_cfg('nuvem_versao', 'null') #>> '{}';
  insert into public.config (chave, valor, mudado_em)
  values ('nuvem_atualizacao', jsonb_build_object('estado', 'atualizando', 'de', v_de, 'para', p_para, 'desde', now(), 'por', p_por), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  return jsonb_build_object('ok', true, 'de', v_de);
end $$;

-- O fim que deu certo: a versão da nuvem, os resumos das partes (fica a meia dúzia mais nova) e o evento.
create or replace function public.servico_nuvem_terminou(p_para text, p_aplicadas jsonb, p_impressoes jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_at jsonb;
  v_atual text;
  v_imp jsonb;
  v_vez jsonb;
  v_n integer;
begin
  if public.rvz_versao_num(p_para) is null then raise exception 'versão inválida'; end if;
  perform pg_advisory_xact_lock(778803);
  v_at := coalesce(public.rvz_cfg('nuvem_atualizacao', 'null'), '{}');
  v_atual := public.rvz_cfg('nuvem_versao', 'null') #>> '{}';
  if public.rvz_versao_num(v_atual) is null or public.rvz_versao_num(p_para) >= public.rvz_versao_num(v_atual) then
    insert into public.config (chave, valor, mudado_em) values ('nuvem_versao', to_jsonb(p_para), now())
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  v_imp := public.rvz_cfg('impressoes', '{}');
  if jsonb_typeof(v_imp) <> 'object' then v_imp := '{}'; end if;
  if jsonb_typeof(p_impressoes) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}') into v_imp
      from (select k, v from jsonb_each(v_imp || p_impressoes) as e(k, v)
             where public.rvz_versao_num(k) is not null and jsonb_typeof(v) = 'object'
             order by public.rvz_versao_num(k) desc limit 6) q;
    insert into public.config (chave, valor, mudado_em) values ('impressoes', v_imp, now())
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  v_n := case when jsonb_typeof(p_aplicadas) = 'array' then jsonb_array_length(p_aplicadas) else 0 end;
  insert into public.config (chave, valor, mudado_em)
  values ('nuvem_atualizacao', jsonb_build_object('estado', 'atualizada', 'de', v_at ->> 'de', 'para', p_para,
            'desde', v_at -> 'desde', 'fim', now(), 'por', v_at ->> 'por',
            'aplicadas', case when jsonb_typeof(p_aplicadas) = 'array' then p_aplicadas else '[]'::jsonb end), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  -- versão nova da nuvem: a publicação de uma versão anterior que tinha parado não segura a nova
  v_vez := public.rvz_cfg('publicacao_vez', 'null');
  if v_vez is not null and v_vez ->> 'para' is distinct from p_para and v_vez ->> 'estado' <> 'em_andamento' then
    delete from public.config where chave = 'publicacao_vez';
  end if;
  if v_n > 0 then
    perform public.rvz_evento('info', format('A nuvem foi atualizada para a %s (%s migração(ões)).', p_para, v_n),
      jsonb_build_object('atualizacao_nuvem', 'concluida', 'para', p_para, 'aplicadas', v_n));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- O fim que não deu certo: para aqui, avisa no painel e manda o alerta (os canais que recebem atualizacao_falhou).
create or replace function public.servico_nuvem_falhou(p_para text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at jsonb;
begin
  perform pg_advisory_xact_lock(778803);
  v_at := coalesce(public.rvz_cfg('nuvem_atualizacao', 'null'), '{}');
  insert into public.config (chave, valor, mudado_em)
  values ('nuvem_atualizacao', jsonb_build_object('estado', 'falhou', 'de', v_at ->> 'de', 'para', p_para,
            'desde', v_at -> 'desde', 'fim', now(), 'por', v_at ->> 'por', 'motivo', left(coalesce(p_motivo, ''), 300)), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  perform public.rvz_evento('alerta',
    format('A atualização da nuvem para a %s parou: %s. Nada ficou pela metade (cada migração vai inteira ou não vai); a nuvem segue na versão de antes, e os computadores esperam.',
           coalesce(p_para, '?'), left(coalesce(p_motivo, 'sem motivo'), 200)),
    jsonb_build_object('motivo', 'atualizacao_falhou', 'parte', 'nuvem', 'para', p_para, 'erro', left(coalesce(p_motivo, ''), 200)));
  return jsonb_build_object('ok', true);
end $$;

-- O administrador pediu de novo (Atualizar a nuvem): a publicação que tinha parado pode tentar de novo.
create or replace function public.servico_nuvem_destravar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(778804);
  delete from public.config where chave = 'publicacao_vez' and valor ->> 'estado' = 'falhou';
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------- os tokens cifrados

-- Guardar (reveza atualizacao-completa ligar): os dois tokens cifrados com a chave do cofre. A impressão da chave tem de
-- ser a da instalação (um computador com outra chave guardaria um texto que nenhum outro abre).
create or replace function public.agente_credenciais_guardar(p_supabase text, p_supabase_nonce text, p_vercel text,
                                                            p_vercel_nonce text, p_impressao text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_nome text;
  v_c bytea; v_n bytea;
  v_c2 bytea; v_n2 bytea;
begin
  if public.rvz_cfg('cofre_impressao', 'null') #>> '{}' is distinct from p_impressao then
    raise exception 'a chave do cofre deste computador não é a da instalação';
  end if;
  begin
    v_c := decode(p_supabase, 'base64'); v_n := decode(p_supabase_nonce, 'base64');
    v_c2 := decode(p_vercel, 'base64'); v_n2 := decode(p_vercel_nonce, 'base64');
  exception when others then
    raise exception 'cifrado inválido';
  end;
  if v_c is null or v_c2 is null or length(v_n) <> 12 or length(v_n2) <> 12 then raise exception 'cifrado inválido'; end if;
  insert into public.credenciais_atualizacao (nome, cifrado, nonce, gravado_por, gravado_em) values
    ('supabase', v_c, v_n, v_pc, now()), ('vercel', v_c2, v_n2, v_pc, now())
  on conflict (nome) do update set cifrado = excluded.cifrado, nonce = excluded.nonce, gravado_por = excluded.gravado_por,
                                   gravado_em = now();
  select nome into v_nome from public.computadores where id = v_pc;
  insert into public.config (chave, valor, mudado_em)
  values ('atualizacao_completa', jsonb_build_object('ligada', true, 'em', now(), 'computador', v_pc), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  -- a vez parada sai (tokens novos tentam de novo); a que está em andamento fica com quem publica (0.3.2, auditoria run-3)
  delete from public.config where chave = 'publicacao_vez' and valor ->> 'estado' is distinct from 'em_andamento';
  perform public.rvz_evento('info',
    format('A atualização completa (funções e painel) foi ligada em %s: os tokens ficam cifrados com a chave do cofre.', coalesce(v_nome, 'um computador')),
    jsonb_build_object('atualizacao_completa', 'ligada', 'computador', v_pc));
  return jsonb_build_object('ok', true);
end $$;

-- Os dados do painel na Vercel (projeto, equipe, domínio, endereços; nada de token), para o computador conferir que o
-- token da Vercel alcança o projeto antes de guardar e para publicar.
create or replace function public.agente_painel_publicacao() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_computador();
  return jsonb_build_object('painel', public.rvz_cfg('painel_publicacao', 'null'));
end $$;

-- Os tokens cifrados, para o computador que vai publicar (só computador ativo; quem não tem a chave não abre).
create or replace function public.agente_credenciais_atualizacao() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_computador();
  return coalesce((select jsonb_object_agg(nome, jsonb_build_object('cifrado', encode(cifrado, 'base64'),
                     'nonce', encode(nonce, 'base64'), 'gravado_em', gravado_em))
                     from public.credenciais_atualizacao), '{}');
end $$;

create or replace function public.rvz_apagar_credenciais(p_quem text, p_pc uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.credenciais_atualizacao;
  insert into public.config (chave, valor, mudado_em)
  values ('atualizacao_completa', jsonb_build_object('ligada', false, 'em', now(), 'computador', p_pc), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  delete from public.config where chave = 'publicacao_vez' and valor ->> 'estado' is distinct from 'em_andamento';
  perform public.rvz_evento('info',
    format('A atualização completa foi desligada (%s): os tokens cifrados saíram da nuvem. Para tirar o acesso de vez, apague os tokens no Supabase e na Vercel.', p_quem),
    jsonb_build_object('atualizacao_completa', 'desligada', 'computador', p_pc));
end $$;

-- Apagar pelo computador (reveza atualizacao-completa desligar).
create or replace function public.agente_credenciais_apagar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  perform public.rvz_apagar_credenciais('pelo computador', v_pc);
  return jsonb_build_object('ok', true);
end $$;

-- Apagar pelo painel (administrador): desligar não precisa da chave do cofre, ligar precisa (só num computador).
create or replace function public.painel_credenciais_apagar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  perform public.rvz_apagar_credenciais('pelo painel', null);
  perform public.rvz_auditar('atualizacao_completa', 'desligar', '{}');
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------- a vez de publicar

-- Um computador por vez publica as funções e o painel da versão que a nuvem já tem. Devolve {pode, motivo, funcoes, painel}.
-- O mesmo computador pedindo de novo com a vez dele em andamento é a publicação dele que caiu no meio (o agente
-- reiniciou): pode de novo. Outro só depois de 45 minutos; aí a de antes vira falha e alerta.
create or replace function public.agente_vez_de_publicar(p_para text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_pend jsonb;
  v_vez jsonb;
  v_nome text;
begin
  if public.rvz_versao_num(p_para) is null then raise exception 'versão inválida'; end if;
  if not public.rvz_completa_ligada() then return jsonb_build_object('pode', false, 'motivo', 'desligada'); end if;
  v_pend := public.rvz_publicacao_pendente();
  if v_pend ->> 'versao' is distinct from p_para then return jsonb_build_object('pode', false, 'motivo', 'nuvem'); end if;
  if not ((v_pend ->> 'funcoes')::boolean or (v_pend ->> 'painel')::boolean) then
    return jsonb_build_object('pode', false, 'motivo', 'em_dia');
  end if;
  perform pg_advisory_xact_lock(778804);
  v_vez := public.rvz_cfg('publicacao_vez', 'null');
  if v_vez is not null and v_vez ->> 'para' = p_para and v_vez ->> 'estado' = 'falhou' then
    return jsonb_build_object('pode', false, 'motivo', 'falhou');
  end if;
  if v_vez is not null and v_vez ->> 'estado' = 'em_andamento' and (v_vez ->> 'computador')::uuid <> v_pc then
    if (v_vez ->> 'desde')::timestamptz > now() - interval '45 minutes' then
      return jsonb_build_object('pode', false, 'motivo', 'outro');
    end if;
    select nome into v_nome from public.computadores where id = (v_vez ->> 'computador')::uuid;
    update public.config set valor = v_vez || jsonb_build_object('estado', 'falhou', 'motivo', 'não terminou em 45 minutos'),
                             mudado_em = now()
     where chave = 'publicacao_vez';
    perform public.rvz_evento('alerta',
      format('A publicação das funções e do painel da %s em %s não terminou em 45 minutos: os computadores não vão se atualizar sozinhos até alguém pedir de novo (Atualizar a nuvem).',
             v_vez ->> 'para', coalesce(v_nome, 'um computador')),
      jsonb_build_object('motivo', 'atualizacao_falhou', 'parte', 'publicacao', 'computador', v_vez ->> 'computador', 'para', v_vez ->> 'para'));
    return jsonb_build_object('pode', false, 'motivo', 'falhou');
  end if;
  insert into public.config (chave, valor, mudado_em)
  values ('publicacao_vez', jsonb_build_object('computador', v_pc, 'para', p_para, 'desde', now(), 'estado', 'em_andamento',
            'partes', jsonb_build_object('funcoes', v_pend -> 'funcoes', 'painel', v_pend -> 'painel')), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  return jsonb_build_object('pode', true, 'funcoes', v_pend -> 'funcoes', 'painel', v_pend -> 'painel');
end $$;

-- O fim da publicação, contado pelo computador que publicou: 'concluida' marca o que está no ar; 'falhou' para os
-- computadores (que só se atualizam sozinhos depois da publicação) e vira alerta.
create or replace function public.agente_publicacao_resultado(p_para text, p_estado text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_vez jsonb;
  v_pub jsonb;
  v_nome text;
begin
  if coalesce(p_estado, '') not in ('concluida', 'falhou') then raise exception 'estado inválido'; end if;
  perform pg_advisory_xact_lock(778804);
  v_vez := public.rvz_cfg('publicacao_vez', 'null');
  if v_vez is null or (v_vez ->> 'computador')::uuid <> v_pc or v_vez ->> 'para' <> coalesce(p_para, '')
     or v_vez ->> 'estado' <> 'em_andamento' then
    return jsonb_build_object('ok', false);
  end if;
  select nome into v_nome from public.computadores where id = v_pc;
  if p_estado = 'concluida' then
    update public.config set valor = v_vez || jsonb_build_object('estado', 'concluida', 'fim', now()), mudado_em = now()
     where chave = 'publicacao_vez';
    v_pub := public.rvz_cfg('publicado', '{}');
    if jsonb_typeof(v_pub) <> 'object' then v_pub := '{}'; end if;
    if (v_vez #>> '{partes,funcoes}')::boolean then v_pub := v_pub || jsonb_build_object('funcoes', p_para); end if;
    if (v_vez #>> '{partes,painel}')::boolean then v_pub := v_pub || jsonb_build_object('painel', p_para); end if;
    insert into public.config (chave, valor, mudado_em) values ('publicado', v_pub || jsonb_build_object('em', now()), now())
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
    perform public.rvz_evento('info', format('Funções e painel da %s publicados por %s.', p_para, coalesce(v_nome, 'um computador')),
      jsonb_build_object('publicacao', 'concluida', 'computador', v_pc, 'para', p_para));
  else
    update public.config set valor = v_vez || jsonb_build_object('estado', 'falhou', 'fim', now(), 'motivo', left(coalesce(p_motivo, ''), 300)),
                             mudado_em = now()
     where chave = 'publicacao_vez';
    perform public.rvz_evento('alerta',
      format('A publicação das funções e do painel da %s em %s não deu certo: %s. O painel que estava no ar continua; os computadores não vão se atualizar sozinhos até alguém pedir de novo (Atualizar a nuvem).',
             p_para, coalesce(v_nome, 'um computador'), left(coalesce(p_motivo, 'sem motivo'), 200)),
      jsonb_build_object('motivo', 'atualizacao_falhou', 'parte', 'publicacao', 'computador', v_pc, 'para', p_para,
                         'erro', left(coalesce(p_motivo, ''), 200)));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- A vez de atualizar sozinho (a de 0020) com a ordem: com a atualização completa ligada, os computadores esperam as
-- funções e o painel da versão nova serem publicados; se a publicação parou, eles também param.
create or replace function public.agente_vez_de_atualizar(p_de text, p_para text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_vez jsonb;
  v_dono uuid;
  v_versao text;
  v_nome text;
  v_pend jsonb;
  v_pub jsonb;
begin
  if coalesce(p_de, '') !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' or coalesce(p_para, '') !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then
    raise exception 'versão inválida';
  end if;
  if public.rvz_modo_atualizar(public.rvz_cfg('atualizar_sozinho', 'false')) = 'desligada' then
    return jsonb_build_object('pode', false, 'motivo', 'desligado');
  end if;
  if public.rvz_completa_ligada() then
    v_pend := public.rvz_publicacao_pendente();
    if v_pend ->> 'versao' = p_para then
      v_pub := public.rvz_cfg('publicacao_vez', 'null');
      if v_pub is not null and v_pub ->> 'para' = p_para and v_pub ->> 'estado' = 'falhou' then
        return jsonb_build_object('pode', false, 'motivo', 'publicacao_falhou');
      end if;
      if (v_pend ->> 'funcoes')::boolean or (v_pend ->> 'painel')::boolean then
        return jsonb_build_object('pode', false, 'motivo', 'publicacao');
      end if;
    end if;
  end if;
  perform pg_advisory_xact_lock(778802);
  select valor into v_vez from public.config where chave = 'atualizacao_vez';
  if v_vez is not null and v_vez ->> 'estado' = 'falhou' then
    return jsonb_build_object('pode', false, 'motivo', 'falhou');
  end if;
  if v_vez is not null and v_vez ->> 'estado' = 'em_andamento' then
    v_dono := (v_vez ->> 'computador')::uuid;
    select versao, nome into v_versao, v_nome from public.computadores where id = v_dono and not revogado;
    if v_dono = v_pc then
      return jsonb_build_object('pode', false, 'motivo', 'em_andamento');
    elsif v_versao is not distinct from (v_vez ->> 'para') then
      null; -- o anterior voltou na versão nova: a vez está livre
    elsif v_versao is not null and (v_vez ->> 'desde')::timestamptz > now() - interval '45 minutes' then
      return jsonb_build_object('pode', false, 'motivo', 'outro');
    else
      update public.config set valor = v_vez || jsonb_build_object('estado', 'falhou', 'motivo', 'não voltou na versão nova em 45 minutos'),
                               mudado_em = now()
       where chave = 'atualizacao_vez';
      perform public.rvz_evento('alerta',
        format('A atualização sozinha de %s para a %s não terminou: os outros computadores não vão se atualizar sozinhos até alguém conferir e escolher de novo como atualizar.',
               coalesce(v_nome, 'um computador'), v_vez ->> 'para'),
        jsonb_build_object('motivo', 'atualizacao_falhou', 'computador', v_dono, 'para', v_vez ->> 'para'));
      return jsonb_build_object('pode', false, 'motivo', 'falhou');
    end if;
  end if;
  insert into public.config (chave, valor, mudado_em)
  values ('atualizacao_vez', jsonb_build_object('computador', v_pc, 'de', p_de, 'para', p_para, 'desde', now(), 'estado', 'em_andamento'), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  return jsonb_build_object('pode', true);
end $$;

-- As servico_nuvem_* e o apagar interno: nem a chave de serviço (o Supabase libera tudo que nasce para ela). Só o papel
-- dono do banco, pela conexão da Edge Function atualizar-nuvem.
revoke execute on function public.servico_nuvem_estado(), public.servico_nuvem_comecar(text, text),
  public.servico_nuvem_terminou(text, jsonb, jsonb), public.servico_nuvem_falhou(text, text), public.servico_nuvem_destravar(),
  public.rvz_apagar_credenciais(text, uuid)
from public, anon, authenticated, service_role;
