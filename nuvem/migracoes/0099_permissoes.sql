-- Reveza AI · 0099 · permissões de execução, sempre por último.
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.
-- O Supabase libera para anon e authenticated tudo o que nasce no public. Aqui fecha tudo e libera uma a uma.
-- Migração nova que criar função: acrescentar a liberação aqui e rodar de novo este arquivo.

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Usadas dentro das políticas de leitura (rodam com o papel de quem lê).
grant execute on function public.rvz_papel(), public.rvz_eh_membro(), public.rvz_eh_admin(), public.rvz_aal2()
  to authenticated;

grant execute on function
  public.agente_registrar(text, text, text), public.agente_ola(text, jsonb, text),
  public.agente_pegar_posse(uuid, text, integer), public.agente_devolver_cofre(uuid, text, text, bigint, timestamptz),
  public.agente_soltar_posse(uuid), public.agente_registrar_conta(text, text, text, text, text, text, timestamptz),
  public.agente_relatar_uso(jsonb, jsonb), public.agente_relatar_tokens(jsonb, jsonb), public.agente_limite(uuid, text),
  public.agente_sem_modelo(uuid, text, text),
  public.agente_reservar_comando(bigint), public.agente_responder_comando(bigint, integer, jsonb),
  public.agente_evento(text, text, jsonb), public.agente_ligacao_publicar(text, text), public.agente_ligacao_buscar(),
  public.agente_marcar_login(uuid, boolean), public.agente_cofre_impressao(text),
  public.agente_vez_de_atualizar(text, text), public.agente_atualizacao_resultado(text, text, text), public.agente_migracoes(),
  public.agente_credenciais_guardar(text, text, text, text, text), public.agente_credenciais_atualizacao(),
  public.agente_credenciais_apagar(), public.agente_vez_de_publicar(text), public.agente_publicacao_resultado(text, text, text),
  public.agente_painel_publicacao(),
  public.agente_ligacao_pedir(jsonb), public.agente_ligacao_receber(), public.agente_ligacoes_abertas(),
  public.agente_ligacao_entregar(uuid, jsonb, jsonb), public.agente_ligacao_recusar(uuid, text),
  public.painel_ligacao_aprovador(uuid, uuid, text),
  public.painel_config(text, jsonb), public.painel_conta(uuid, jsonb), public.painel_trocar_agora(uuid, uuid),
  public.painel_comando(uuid, text, jsonb), public.painel_convidar(text, public.papel, text), public.painel_convite_cancelar(uuid), public.painel_minhas_sessoes(), public.painel_encerrar_sessao(uuid),
  public.painel_membros(), public.painel_validade_logins(),
  public.painel_mudar_papel(uuid, public.papel), public.painel_revogar_membro(uuid),
  public.painel_revogar_computador(uuid), public.painel_alerta(text, jsonb, text[], boolean, uuid),
  public.painel_alerta_apagar(uuid), public.painel_webhook(text, text[], boolean, uuid),
  public.painel_chave_api_criar(text, text[]), public.painel_chave_api_revogar(uuid),
  public.painel_meu_idioma(text), public.painel_push_inscrever(text, text, text),
  public.painel_alerta_segredo(uuid, text), public.painel_webhook_segredo(uuid), public.painel_credenciais_apagar(),
  public.painel_computador_preferida(uuid, uuid), public.painel_computador_enxugar(uuid, boolean), public.painel_computador_nome(uuid, text)
to authenticated;

-- As servico_nuvem_* (0021) não são liberadas para ninguém: só o papel dono do banco as chama, pela conexão que a
-- plataforma dá à Edge Function atualizar-nuvem.

-- Só a chave de serviço (Edge Functions e pg_cron).
grant execute on function public.api_conferir_chave(text), public.decidir(uuid, boolean),
  public.convite_aceitar(uuid, text, text), public.servico_papel(uuid), public.servico_registrar_computador(uuid, uuid),
  public.vigiar(), public.resumo_dia(), public.alertas_pendentes(integer), public.servico_segredo_alerta(uuid),
  public.servico_segredo_webhook(uuid), public.servico_webhook(uuid), public.servico_aal_ok(uuid, text), public.api_estado(uuid), public.api_trocar(uuid, uuid, uuid),
  public.api_config(uuid, text, jsonb)
to service_role;
