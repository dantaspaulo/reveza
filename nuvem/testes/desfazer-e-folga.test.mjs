// 0032: o remover conta com prazo para desfazer e o aviso de folga acabando (pedidos do Paulo, 06/11/2026: uma conta
// saiu por engano e o computador apagou a cópia do login dois minutos depois; e "aviso de que já está chegando no limite").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0032_desfazer_e_folga.sql", import.meta.url), "utf8");

async function cenario() {
  const b = await banco();
  await b.config("auto", true);
  await b.config("modo", "limiar");
  await b.config("aviso", 85);
  await b.config("troca", 90);
  await b.config("fuso", "UTC");
  const admin = { id: await b.usuario("admin", "admin@exemplo.com"), aal: "aal2" };
  return { b, admin };
}

async function usar(b, pc, conta) {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, 'teste', now() - interval '1 hour')
               on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                                         decidido_em = excluded.decidido_em`, [pc.pc, conta]);
}

async function semana(b, conta, pct) {
  await b.sql(`insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
               values ($1, 'seven_day', $2, now() + interval '2 days', now(), 'api')
               on conflict (conta_id, tipo) do update set pct = excluded.pct, lido_em = now()`, [conta, pct]);
}

const vigiarFolga = async (b) => (await b.sql("select public.rvz_vigiar_folga() as n"))[0].n;
const purgar = async (b) => (await b.sql("select public.rvz_purgar_contas_saindo() as n"))[0].n;

test("desfazer no prazo: a conta volta como estava, com a pausa de antes, o cofre e as janelas", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const livre = await b.conta(pc, "livre@exemplo.com", 20);
  const pausada = await b.conta(pc, "pausada@exemplo.com", 20, { pausada: true });
  for (const id of [livre, pausada]) assert.equal((await b.rpc(admin, "painel_remover_conta", { p_conta: id })).ok, true);
  const [aviso] = await b.sql("select texto from public.eventos where dados ->> 'saindo' = 'true' order by id limit 1");
  assert.match(aviso.texto, /^A conta livre@exemplo\.com sai do Reveza em 10 minutos; até lá dá para desfazer no painel\.$/);

  for (const id of [livre, pausada]) assert.equal((await b.rpc(admin, "painel_desfazer_remocao", { p_conta: id })).ok, true);
  const linhas = await b.sql("select email, pausada, sai_em, pausada_antes, saida_por from public.contas order by email");
  assert.deepEqual(linhas, [
    { email: "livre@exemplo.com", pausada: false, sai_em: null, pausada_antes: null, saida_por: null },
    { email: "pausada@exemplo.com", pausada: true, sai_em: null, pausada_antes: null, saida_por: null },
  ]);
  const [contagem] = await b.sql(`select (select count(*)::int from public.cofre) as cofre,
                                         (select count(*)::int from public.uso_janelas) as janelas,
                                         (select count(*)::int from public.auditoria where acao = 'desfazer_remocao') as desfeitas`);
  assert.deepEqual(contagem, { cofre: 2, janelas: 2, desfeitas: 2 });
  // desfeita, nada sai depois: nem a conta nem a cópia do login nos computadores
  await b.sql("select public.vigiar()");
  const [n] = await b.sql("select count(*)::int n from public.contas");
  assert.equal(n.n, 2);
  assert.deepEqual(await b.rpc(pc, "agente_contas_removidas", {}), []);
});

test("no prazo: a pausa da conta saindo não muda, o resto muda, a troca não vai para ela e repetir não estica o prazo", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const saindo = await b.conta(pc, "saindo@exemplo.com", 20);
  const cheia = await b.conta(pc, "cheia@exemplo.com", 99);
  await usar(b, pc, cheia);
  const r1 = await b.rpc(admin, "painel_remover_conta", { p_conta: saindo });
  const r2 = await b.rpc(admin, "painel_remover_conta", { p_conta: saindo });
  assert.equal(new Date(r2.sai_em).getTime(), new Date(r1.sai_em).getTime());

  const recusa = await b.rpc(admin, "painel_conta", { p_conta: saindo, p_campos: { pausada: false } });
  assert.equal(recusa.ok, false);
  assert.match(recusa.erro, /desfaça a remoção antes/);
  assert.equal((await b.rpc(admin, "painel_conta", { p_conta: saindo, p_campos: { prioridade: 5 } })).ok, true);

  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(pc), cheia, "a conta saindo está pausada: não recebe a troca");
});

test("depois do prazo a conta sai de vez; desfazer avisa que ela já saiu", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "conta@exemplo.com", 20);
  await b.conta(pc, "outra@exemplo.com", 20);
  await b.rpc(admin, "painel_remover_conta", { p_conta: conta });
  assert.equal(await purgar(b), 0, "no prazo, nada sai");
  await b.sql("update public.contas set sai_em = now() - interval '1 second' where id = $1", [conta]);
  await b.sql("select public.vigiar()");
  const [n] = await b.sql("select count(*)::int n from public.contas where id = $1", [conta]);
  assert.equal(n.n, 0);
  const [marca] = await b.sql("select email, removida_por from public.contas_removidas where conta_id = $1", [conta]);
  assert.deepEqual(marca, { email: "conta@exemplo.com", removida_por: admin.id });
  const [ev] = await b.sql("select texto, dados ->> 'email' as email from public.eventos where dados ->> 'removida' = 'true'");
  assert.deepEqual(ev, { texto: "A conta conta@exemplo.com saiu do Reveza.", email: "conta@exemplo.com" });
  const r = await b.rpc(admin, "painel_desfazer_remocao", { p_conta: conta });
  assert.equal(r.ok, false);
  assert.match(r.erro, /já saiu do Reveza/);
});

test("a limpeza espera quando um computador ainda está na conta e não tem para onde ir", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const conta = await b.conta(pc, "conta@exemplo.com", 20);
  const outra = await b.conta(pc, "outra@exemplo.com", 20);
  await b.rpc(admin, "painel_remover_conta", { p_conta: conta });
  await usar(b, pc, conta);
  await b.sql("update public.contas set pausada = true where id = $1", [outra]);
  await b.sql("update public.contas set sai_em = now() - interval '1 second' where id = $1", [conta]);
  assert.equal(await purgar(b), 0);
  assert.equal(await b.atribuida(pc), conta);
  await b.sql("update public.contas set pausada = false where id = $1", [outra]);
  assert.equal(await purgar(b), 1);
  assert.equal(await b.atribuida(pc), outra);
});

test("folga acabando: com uma só conta abaixo do aviso, diz qual libera primeiro e quando; no máximo um a cada 6 horas", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  await b.conta(pc, "folga@exemplo.com", 20);
  const quase = await b.conta(pc, "quase@exemplo.com", 88);
  const cheia = await b.conta(pc, "cheia@exemplo.com", 97);
  await b.sql("update public.uso_janelas set reset_em = now() + interval '1 hour' where conta_id = $1", [quase]);
  await b.sql("update public.uso_janelas set reset_em = now() + interval '4 hours' where conta_id = $1", [cheia]);
  assert.equal(await vigiarFolga(b), 1);
  const [ev] = await b.sql("select tipo, texto, dados from public.eventos where dados ->> 'motivo' = 'folga_acabando'");
  assert.equal(ev.tipo, "alerta");
  assert.match(ev.texto, /^Folga acabando: só folga@exemplo\.com ainda tem folga \(20%\)\. A próxima libera em \d\d\/\d\d \d\d:\d\d \(quase@exemplo\.com\)\.$/);
  assert.equal(ev.dados.proxima, quase);
  assert.equal(ev.dados.proxima_email, "quase@exemplo.com");
  assert.match(ev.dados.libera_txt, /^\d\d\/\d\d \d\d:\d\d$/);
  assert.equal(ev.dados.ativas, 3);
  assert.equal(ev.dados.com_folga, 1);
  assert.equal(await vigiarFolga(b), 0, "não repete antes de 6 horas");
  await b.sql("update public.eventos set em = now() - interval '7 hours' where dados ->> 'motivo' = 'folga_acabando'");
  assert.equal(await vigiarFolga(b), 1, "e lembra de novo depois");
});

test("folga acabando: nenhuma abaixo do aviso; a semana no teto segura a conta até renovar", async () => {
  const { b } = await cenario();
  const pc = await b.computador("mini");
  await b.conta(pc, "alta@exemplo.com", 90);
  const teto = await b.conta(pc, "teto@exemplo.com", 10, { teto_semana: 80 });
  await semana(b, teto, 82);
  assert.equal(await vigiarFolga(b), 1);
  const [ev] = await b.sql("select texto from public.eventos where dados ->> 'motivo' = 'folga_acabando'");
  assert.match(ev.texto, /^Folga acabando: nenhuma conta com folga agora\. A próxima libera em \d\d\/\d\d \d\d:\d\d \(alta@exemplo\.com\)\.$/);
});

test("folga acabando: não avisa com duas contas com folga, com uma só em atividade, nem com as contas sem leitura", async () => {
  const { b, admin } = await cenario();
  const pc = await b.computador("mini");
  const um = await b.conta(pc, "um@exemplo.com", 20);
  const dois = await b.conta(pc, "dois@exemplo.com", 30);
  await b.conta(pc, "cheia@exemplo.com", 99);
  assert.equal(await vigiarFolga(b), 0, "duas com folga");
  // pausada, sem login e saindo do Reveza não estão em atividade: sobra uma
  await b.sql("update public.contas set pausada = true where id = $1", [um]);
  await b.sql("update public.contas set precisa_login = true where id = $1", [dois]);
  assert.equal(await vigiarFolga(b), 0, "uma só em atividade");
  await b.sql("update public.contas set pausada = false, precisa_login = false");
  await b.rpc(admin, "painel_remover_conta", { p_conta: um });
  assert.equal(await vigiarFolga(b), 1, "a saindo não conta: sobra uma com folga entre duas");
  await b.sql("delete from public.eventos");
  await b.rpc(admin, "painel_desfazer_remocao", { p_conta: um });
  // sem leitura em dia conta como com folga (sem saber, não avisa)
  await b.sql("update public.uso_janelas set pct = 95 where conta_id = $1", [dois]);
  await b.sql("update public.uso_janelas set lido_em = now() - interval '1 hour' where conta_id = $1", [um]);
  assert.equal(await vigiarFolga(b), 1);
  const [ev] = await b.sql("select texto from public.eventos where dados ->> 'motivo' = 'folga_acabando'");
  assert.match(ev.texto, /^Folga acabando: só um@exemplo\.com pode ter folga \(está sem leitura agora\)\./);
});

test("o painel aceita a folga acabando num canal, e quem já avisava falta de conta livre ganha ela só na primeira vez", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const so = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "2" }, p_eventos: ["folga_acabando"] });
  assert.ok(so.id);
  const tg = await b.rpc(admin, "painel_alerta", { p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["sem_livre"] });
  await b.sql("insert into public.webhooks_saida (url, eventos, criado_por) values ('https://hook.exemplo.com/a', '{sem_livre}', $1)", [admin.id]);
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
  const eventos = async (id) => (await b.sql("select eventos from public.alertas where id = $1", [id]))[0].eventos;
  assert.deepEqual(await eventos(tg.id), ["sem_livre", "folga_acabando"]);
  assert.deepEqual(await eventos(so.id), ["folga_acabando"]);
  const [{ eventos: wh }] = await b.sql("select eventos from public.webhooks_saida");
  assert.deepEqual(wh, ["sem_livre", "folga_acabando"]);

  await b.db.exec(`create table public.reveza_migracoes (nome text primary key, hash text not null, aplicada_em timestamptz not null default now());
    insert into public.reveza_migracoes (nome, hash) values ('0032_desfazer_e_folga.sql', 'x');`);
  await b.rpc(admin, "painel_alerta", { p_id: tg.id, p_canal: "telegram", p_destino: { chat_id: "1" }, p_eventos: ["sem_livre"] });
  await b.db.exec(MIGRACAO);
  assert.deepEqual(await eventos(tg.id), ["sem_livre"]);
});
