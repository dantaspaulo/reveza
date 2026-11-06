-- Reveza AI · 0023 · a troca de conta que não firmou vira alerta (pergunta de um usuário, 13/10/2026).
-- reaplicável: restrição recriada, função e gatilho recriados; a inclusão nos canais só roda na primeira vez.
--
-- Quando o computador não consegue trocar de conta (a troca não firmou depois de 3 tentativas, ou a conta que a nuvem
-- escolheu não entra há 5 minutos), ele grava um evento de erro com `motivo: troca_falhou` e os ids das contas.
-- Evento de computador não sai pelos canais (0010), então quem escreve o alerta é a nuvem: um gatilho lê só os ids,
-- monta o texto com o nome do computador e os e-mails que estão nas tabelas dela, e manda no máximo um por computador
-- por hora. O texto escrito pelo computador nunca vai para fora. Agente antigo não manda o motivo: nada muda para ele.

alter table public.alertas drop constraint if exists alertas_eventos_check;
alter table public.alertas add constraint alertas_eventos_check check (eventos <@ array['sem_livre', 'precisa_login',
  'computador_parado', 'login_vence', 'resumo_dia', 'troca', 'limite', 'atualizacao_falhou', 'troca_falhou',
  'folga_acabando']);

-- Canais e webhooks que já avisam quando falta conta livre passam a avisar também a troca que não firmou. Só na
-- primeira vez: quem tirar depois pelo painel não ganha de volta quando esta migração rodar de novo.
do $$
declare v_ja boolean := false;
begin
  -- o registro pode ainda não existir (instalação nova, teste): a consulta a ele só é montada quando existe
  if to_regclass('public.reveza_migracoes') is not null then
    execute 'select exists (select 1 from public.reveza_migracoes where nome = $1)' into v_ja using '0023_troca_falhou.sql';
  end if;
  if not v_ja then
    update public.alertas set eventos = eventos || array['troca_falhou']
     where 'sem_livre' = any(eventos) and not ('troca_falhou' = any(eventos));
    update public.webhooks_saida set eventos = eventos || array['troca_falhou']
     where 'sem_livre' = any(eventos) and not ('troca_falhou' = any(eventos));
  end if;
end $$;

create or replace function public.rvz_troca_falhou() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pc uuid;
  v_de uuid;
  v_para uuid;
  v_nome text;
  v_email_de text;
  v_email_para text;
begin
  -- o computador vem do agente_evento (sempre o de quem chamou); de e para vêm do computador: só id válido conta
  if coalesce(new.dados ->> 'computador', '') !~* v_uuid then return null; end if;
  v_pc := (new.dados ->> 'computador')::uuid;
  if exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'troca_falhou'
               and dados ->> 'computador' = v_pc::text and em > now() - interval '1 hour') then
    return null;
  end if;
  if coalesce(new.dados ->> 'de', '') ~* v_uuid then v_de := (new.dados ->> 'de')::uuid; end if;
  if coalesce(new.dados ->> 'para', '') ~* v_uuid then v_para := (new.dados ->> 'para')::uuid; end if;
  select nome into v_nome from public.computadores where id = v_pc;
  select email into v_email_de from public.contas where id = v_de;
  select email into v_email_para from public.contas where id = v_para;
  v_nome := coalesce(v_nome, 'sem nome');
  perform public.rvz_evento('alerta',
    case
      when v_email_para is not null and v_email_de is not null and v_email_de <> v_email_para then
        format('No computador %s, a troca para %s não firmou: a conta em uso continua %s. Confira no painel.',
               v_nome, v_email_para, v_email_de)
      when v_email_para is not null then
        format('No computador %s, a troca para %s não firmou. Confira no painel.', v_nome, v_email_para)
      else format('No computador %s, uma troca de conta não firmou. Confira no painel.', v_nome)
    end,
    jsonb_build_object('motivo', 'troca_falhou', 'computador', v_pc,
                       'de', case when v_email_de is null then null else v_de end,
                       'para', case when v_email_para is null then null else v_para end));
  return null;
exception when others then
  -- o alerta não pode derrubar o evento do computador, que já conta o que houve no painel
  raise warning 'reveza: alerta da troca que não firmou: %', sqlerrm;
  return null;
end $$;

drop trigger if exists eventos_troca_falhou on public.eventos;
create trigger eventos_troca_falhou after insert on public.eventos for each row
  when (new.origem = 'computador' and new.tipo = 'erro' and new.dados ->> 'motivo' = 'troca_falhou')
  execute function public.rvz_troca_falhou();
