-- Reveza AI · 0042 · a agenda do modo de teste (sombra): de minuto em minuto, rvz_rodar_sombra (0041).
-- reaplicável. Só no Supabase (pg_cron). Sem unidade em teste, ela só apaga as linhas paradas e sai.
select cron.unschedule(jobid) from cron.job where jobname = 'reveza-sombra';
select cron.schedule('reveza-sombra', '* * * * *', 'select public.rvz_rodar_sombra()');
