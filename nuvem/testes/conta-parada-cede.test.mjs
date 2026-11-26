// Conta parada cede ao computador no limite (0047). O caso: um computador trabalhando bate o limite e não há conta
// livre, enquanto outro computador, ligado e parado há tempo, segura uma conta com folga. A nuvem leva o parado para
// a conta mais gasta entre as sem dono (a do meio) e dá a conta dele a quem parou. Nunca troca direta entre os dois: cada agente
// pega a conta nova antes de soltar a antiga, e os dois esperariam para sempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";

const CEDEU = "parado: cedeu a conta a um computador no limite";
const RECEBEU = "recebeu a conta de um computador parado";

async function usar(b, pc, conta, motivo = "chegou a 99%", ha = "1 hour") {
  await b.sql(`insert into public.atribuicao (computador_id, conta_id, motivo, decidido_em)
               values ($1, $2, $3, now() - $4::interval)
               on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                                         decidido_em = excluded.decidido_em`, [pc.pc, conta, motivo, ha]);
}

// Leituras da janela de 5 h da conta, a mais antiga primeiro, espalhadas nos últimos 25 min.
async function historico(b, conta, valores) {
  await b.sql("delete from public.uso_historico where conta_id = $1", [conta]);
  for (const [i, p5] of valores.entries()) {
    const min = 25 - i * Math.floor(20 / Math.max(1, valores.length - 1));
    await b.sql("insert into public.uso_historico (conta_id, em, p5, p7) values ($1, now() - $2::interval, $3, 17)",
      [conta, `${min} minutes`, p5]);
  }
}

// Uma sessão do computador com a última atividade há `min` minutos, nas contas dadas.
async function sessao(b, pc, min, contas = []) {
  await b.sql(`insert into public.sessoes (id, computador_id, inicio, fim, contas)
               values (gen_random_uuid()::text, $1, now() - interval '2 hours', now() - $2::interval, $3::uuid[])`,
    [pc.pc, `${min} minutes`, contas]);
}

// O computador está ligado (visto sem intervalo de mais de 5 min) desde `ha`.
async function ligadoHa(b, pc, ha) {
  await b.sql("update public.computadores set ligado_desde = now() - $2::interval where id = $1", [pc.pc, ha]);
}

async function eventoLimite(b, pc, conta, ha) {
  await b.sql(`insert into public.eventos (em, tipo, texto, dados)
               values (now() - $1::interval, 'limite', 'teste', jsonb_build_object('computador', $2::text, 'conta', $3::text))`,
    [ha, pc.pc, conta]);
}

async function alertasSemLivre(b) {
  const [{ n }] = await b.sql("select count(*)::int n from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'");
  return n;
}

async function motivo(b, pc) {
  const [l] = await b.sql("select motivo from public.atribuicao where computador_id = $1", [pc.pc]);
  return l?.motivo ?? null;
}

// O Mac-mini trabalha na "cheia", que encheu; a VPS está parada há horas na "boa"; a "meio" está cheia e sem dono.
async function palco({ historicoBoa = [0, 0, 0], sessaoMini = true, auto = true, pctCheia = 100 } = {}) {
  const b = await banco();
  await b.config("auto", auto);
  await b.config("modo", "limiar");
  const mini = await b.computador("mini");
  const vps = await b.computador("vps");
  await ligadoHa(b, mini, "3 hours");
  await ligadoHa(b, vps, "3 hours");
  const cheia = await b.conta(mini, "cheia@exemplo.com", pctCheia);
  const boa = await b.conta(mini, "boa@exemplo.com", 0);
  const meio = await b.conta(mini, "meio@exemplo.com", 100);
  await b.sql("delete from public.posse");
  await usar(b, mini, cheia);
  await usar(b, vps, boa);
  await historico(b, boa, historicoBoa);
  if (sessaoMini) await sessao(b, mini, 2, [cheia]);
  return { b, mini, vps, cheia, boa, meio };
}

async function limite(b, pc, conta) {
  return b.rpc(pc, "agente_limite", { p_conta: conta, p_sessao: null });
}

test("o caso de 25/11: quem bateu o limite recebe a conta do parado, e o parado vai para a cheia sem dono", async () => {
  const { b, mini, vps, cheia, boa, meio } = await palco();
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(vps), meio, "o parado vai para a conta do meio");
  assert.equal(await b.atribuida(mini), boa, "quem parou no limite recebe a conta com folga");
  assert.equal(await motivo(b, vps), CEDEU);
  assert.equal(await motivo(b, mini), RECEBEU);
  assert.equal(await alertasSemLivre(b), 0, "não diz que não há conta livre");
  const [{ n }] = await b.sql("select count(*)::int n from public.atribuicao where conta_id = $1", [cheia]);
  assert.equal(n, 0, "a conta cheia de quem parou fica sem dono, para a próxima vez");
});

test("pelo cron: o limite gravado depois da atribuição basta para ceder no minuto seguinte", async () => {
  // sem sessão recente: no caso real as sessões estavam paradas no limite, e só o limite diz que ele trabalha
  const { b, mini, vps, cheia, boa, meio } = await palco({ sessaoMini: false });
  await usar(b, vps, boa, "chegou a 99%", "10 minutes");
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia, "a VPS pegou a conta há 10 min: ainda não cede");
  assert.equal(await alertasSemLivre(b), 1);
  await b.sql("update public.atribuicao set decidido_em = now() - interval '1 hour' where computador_id = $1", [vps.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(vps), meio, "e o parado não volta a trocar no mesmo minuto");
});

test("doador trabalhando (sessão há 10 min) não cede", async () => {
  const { b, mini, vps, cheia, boa } = await palco();
  await sessao(b, vps, 10, [boa]);
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
  assert.equal(await alertasSemLivre(b), 1, "segue o alerta de sempre");
});

test("uso subindo na conta do doador (login usado fora do Reveza) não cede", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ historicoBoa: [0, 2, 3] });
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("sem leituras bastantes da conta do doador (menos de 2 em 60 min) não cede", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ historicoBoa: [0] });
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("doador com a conta escolhida à mão, pelo painel ou pela API, não cede", async () => {
  for (const m of ["pedido pelo painel", "pedido pela API"]) {
    const { b, mini, vps, cheia, boa } = await palco();
    await usar(b, vps, boa, m);
    await limite(b, mini, cheia);
    assert.equal(await b.atribuida(mini), cheia, m);
    assert.equal(await b.atribuida(vps), boa, m);
  }
});

test("doador com sessão há 45 min (ferramenta longa, sem escrever) não cede: parado é 60 min", async () => {
  const { b, mini, vps, cheia, boa } = await palco();
  await sessao(b, vps, 45, [boa]);
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("limite de antes não conta: o limite gravado antes de receber a conta não faz pedir", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ sessaoMini: false });
  await usar(b, mini, cheia, "chegou a 99%", "10 minutes");
  await eventoLimite(b, mini, cheia, "20 minutes");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("sessão só de projeto não pede: a sessão recente precisa ter usado a conta em uso", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ sessaoMini: false });
  // a conta da trilha fica fora da principal (aqui, pausada para a principal não a escolher como livre)
  const trilha = await b.conta(mini, "trilha@exemplo.com", 40, { pausada: true });
  await sessao(b, mini, 2, [trilha]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), cheia, "a principal cheia ninguém usa");
  assert.equal(await b.atribuida(vps), boa);
});

test("sem o modelo não é limite: a conta em uso com folga não tira a conta de um parado", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ pctCheia: 20 });
  await b.rpc(mini, "agente_sem_modelo", { p_conta: cheia, p_modelo: "opus", p_sessao: null });
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("doador fora do ar não cede: não há agente lá para soltar a posse", async () => {
  const { b, mini, vps, cheia, boa } = await palco();
  await b.sql("update public.computadores set visto_em = now() - interval '10 minutes' where id = $1", [vps.pc]);
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("computador que acabou de ligar não cede: parado é 60 min ligado, sem sessão", async () => {
  const { b, mini, vps, cheia, boa, meio } = await palco();
  // a VPS estava desligada (visto há 3 h) e voltou agora: o gatilho marca a hora em que ligou
  await b.sql("update public.computadores set visto_em = now() - interval '3 hours' where id = $1", [vps.pc]);
  await b.sql("update public.computadores set visto_em = now() where id = $1", [vps.pc]);
  const [{ ok }] = await b.sql("select ligado_desde > now() - interval '1 minute' ok from public.computadores where id = $1", [vps.pc]);
  assert.equal(ok, true, "ligado_desde é a hora em que voltou");
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
  // computador de antes da versão (sem a marca): conta como ligado há tempo
  await b.sql("update public.computadores set ligado_desde = null where id = $1", [vps.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(vps), meio);
});

test("a preferida de outro computador ligado vai por último como conta do meio: havendo outra, fica para o dono", async () => {
  const { b, mini, vps, cheia, boa, meio } = await palco();
  const air = await b.computador("air");
  // "a-meio" vem antes de "meio" pelo e-mail, e as duas estão em 100%: sem a regra, seria a escolhida
  const aMeio = await b.conta(mini, "a-meio@exemplo.com", 100);
  await b.sql("delete from public.posse");
  await b.sql("update public.computadores set conta_preferida = $2 where id = $1", [air.pc, aMeio]);
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(vps), meio, "o parado vai para a sem dono que não é preferida de ninguém");
});

test("quem trocou há menos da espera entre trocas não recebe ainda; passada a espera, recebe (a 97%, sem bater o limite)", async () => {
  const { b, mini, vps, cheia, boa, meio } = await palco({ pctCheia: 97 });
  await usar(b, mini, cheia, "chegou a 95%", "30 seconds");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), cheia, "trocou há 30 s: espera os 90 s entre trocas");
  assert.equal(await b.atribuida(vps), boa);
  await b.sql("update public.atribuicao set decidido_em = now() - interval '2 minutes' where computador_id = $1", [mini.pc]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(vps), meio);
});

test("doador que bateu o limite nessa conta não cede, nem logo depois que ela renova: ele também espera por ela", async () => {
  const { b, mini, vps, cheia, boa } = await palco();
  // a VPS recebeu a "boa" há 3 h, bateu o limite nela há 2 h, e a conta já renovou (0%, leituras iguais)
  await usar(b, vps, boa, "chegou a 99%", "3 hours");
  await eventoLimite(b, vps, boa, "2 hours");
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("a falta do modelo não faz pedir: o evento dela não vale como limite nas 5 h seguintes", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ pctCheia: 97, sessaoMini: false });
  await usar(b, mini, cheia, "chegou a 95%", "2 hours");
  await b.sql(`insert into public.eventos (em, tipo, texto, dados)
               values (now() - interval '1 hour', 'limite', 'teste',
                       jsonb_build_object('computador', $1::text, 'conta', $2::text, 'motivo', 'sem_modelo'))`, [mini.pc, cheia]);
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), cheia, "parado há 1 h, só com a falta do modelo: não pede");
  assert.equal(await b.atribuida(vps), boa);
});

test("sem doador, a decisão não segura a trava das trocas até o fim (o cron e o agente não se travam)", async () => {
  const travas = async (b, pc) => b.db.transaction(async (tx) => {
    await tx.query("select public.decidir($1, true)", [pc.pc]);
    return (await tx.query("select count(*)::int n from pg_locks where locktype = 'advisory' and objid = 778801")).rows[0].n;
  });
  const um = await palco();
  await sessao(um.b, um.vps, 10, [um.boa]); // o único doador possível está trabalhando
  assert.equal(await travas(um.b, um.mini), 0, "sem doador, a trava não foi pega");
  assert.equal(await um.b.atribuida(um.mini), um.cheia);
  // a conta enxerga a trava: com troca de verdade, ela aparece
  const dois = await palco();
  assert.equal(await travas(dois.b, dois.mini), 1, "com a troca, a trava aparece até o fim da decisão");
  assert.equal(await dois.b.atribuida(dois.mini), dois.boa);
});

test("sem conta do meio não cede: a troca direta entre os dois travaria", async () => {
  const casos = {
    "sem leitura recente": (b, meio) => b.sql("update public.uso_janelas set lido_em = now() - interval '1 hour' where conta_id = $1", [meio]),
    pausada: (b, meio) => b.sql("update public.contas set pausada = true where id = $1", [meio]),
    "sem login": (b, meio) => b.sql("update public.contas set precisa_login = true where id = $1", [meio]),
    "sem cofre": (b, meio) => b.sql("delete from public.cofre where conta_id = $1", [meio]),
    "com posse de outro computador": async (b, meio, mini) =>
      b.sql("insert into public.posse (conta_id, computador_id, motivo, expira_em) values ($1, $2, 'leitura', now() + interval '1 minute')", [meio, mini.pc]),
    "fora da agenda": (b, meio) =>
      b.sql(`update public.contas set agenda = '[{"dias": [], "de": "00:00", "ate": "00:00"}]'::jsonb where id = $1`, [meio]),
    "acima do teto da semana": async (b, meio) => {
      await b.sql("update public.contas set teto_semana = 10 where id = $1", [meio]);
      await b.sql("insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values ($1, 'seven_day', 17, now(), 'api') on conflict (conta_id, tipo) do update set pct = 17, lido_em = now()", [meio]);
    },
    "sem o modelo no doador": async (b, meio, mini, vps) =>
      b.sql("insert into public.contas_sem_modelo (conta_id, computador_id, modelo, ate) values ($1, $2, 'opus', now() + interval '1 hour')", [meio, vps.pc]),
  };
  for (const [nome, estragar] of Object.entries(casos)) {
    const { b, mini, vps, cheia, boa, meio } = await palco();
    await estragar(b, meio, mini, vps);
    await limite(b, mini, cheia);
    assert.equal(await b.atribuida(mini), cheia, nome);
    assert.equal(await b.atribuida(vps), boa, nome);
    assert.equal(await alertasSemLivre(b), 1, nome);
  }
});

test("conta do doador que não serve a quem pede (sem o modelo dele, com teto da semana) não sai do doador", async () => {
  const casos = {
    "sem o modelo": (b, boa, mini) =>
      b.sql("insert into public.contas_sem_modelo (conta_id, computador_id, modelo, ate) values ($1, $2, 'opus', now() + interval '1 hour')", [boa, mini.pc]),
    "teto da semana": async (b, boa) => {
      await b.sql("update public.contas set teto_semana = 10 where id = $1", [boa]);
      await b.sql("insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values ($1, 'seven_day', 17, now(), 'api') on conflict (conta_id, tipo) do update set pct = 17, lido_em = now()", [boa]);
    },
  };
  for (const [nome, estragar] of Object.entries(casos)) {
    const { b, mini, vps, cheia, boa } = await palco();
    await estragar(b, boa, mini);
    await limite(b, mini, cheia);
    assert.equal(await b.atribuida(mini), cheia, nome);
    assert.equal(await b.atribuida(vps), boa, nome);
  }
});

test("dois parados não trocam entre si: quem pede precisa estar trabalhando", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ sessaoMini: false });
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), cheia, "só a leitura passou do gatilho, sem sessão nem limite");
  assert.equal(await b.atribuida(vps), boa);
});

test("trabalhando sem ter batido o limite (sessão há 2 min, leitura acima do gatilho) já recebe", async () => {
  const { b, mini, vps, boa, meio } = await palco();
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(vps), meio);
});

test("com a troca automática desligada, nada cede", async () => {
  const { b, mini, vps, cheia, boa } = await palco({ auto: false });
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), cheia);
  assert.equal(await b.atribuida(vps), boa);
});

test("dois doadores: quem pede recebe a conta com mais folga", async () => {
  const { b, mini, vps, cheia, boa } = await palco();
  const air = await b.computador("air");
  await ligadoHa(b, air, "3 hours");
  const trinta = await b.conta(mini, "trinta@exemplo.com", 30);
  await b.conta(mini, "meio2@exemplo.com", 100);
  await b.sql("delete from public.posse");
  await usar(b, air, trinta);
  await historico(b, trinta, [30, 30, 30]);
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(mini), boa);
  assert.equal(await b.atribuida(air), trinta, "o outro doador fica como estava");
  void vps;
});

test("sem volta: o doador parado fica na conta do meio; quando volta e bate o limite, troca pelo caminho normal", async () => {
  const { b, mini, vps, cheia, meio } = await palco();
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(vps), meio);
  const nova = await b.conta(mini, "nova@exemplo.com", 5);
  await b.sql("delete from public.posse");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(vps), meio, "parado, não pega a conta boa que apareceu");
  const antes = await alertasSemLivre(b);
  assert.equal(antes, 0, "nem alerta");
  await limite(b, vps, meio);
  assert.equal(await b.atribuida(vps), nova, "trabalhando, bateu o limite: troca como sempre");
});

test("doador que voltou e bateu o limite não fica preso: passados 15 min, a conta boa que aparece é dele", async () => {
  const { b, mini, vps, cheia, meio } = await palco();
  await limite(b, mini, cheia);
  assert.equal(await b.atribuida(vps), meio);
  await limite(b, vps, meio);
  assert.equal(await b.atribuida(vps), meio, "sem conta livre, fica e alerta");
  // cedeu há 40 min e bateu o limite há 20: passou a janela de 15 min da sessão
  await b.sql("update public.atribuicao set decidido_em = now() - interval '40 minutes' where computador_id = $1", [vps.pc]);
  await b.sql("update public.eventos set em = now() - interval '20 minutes' where tipo = 'limite' and dados ->> 'computador' = $1", [vps.pc]);
  const nova = await b.conta(mini, "nova@exemplo.com", 5);
  await b.sql("delete from public.posse");
  await b.sql("select public.decidir()");
  assert.equal(await b.atribuida(vps), nova, "o limite nessa conta depois de recebê-la diz que ele trabalha");
});
