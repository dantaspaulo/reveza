// A língua dos alertas que saem pelos canais: a da instalação (alertas_pendentes devolve `idioma`).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as alertas from "../alertas/index.ts";
import { idiomaDe, motivoEmIngles, textoDoEvento, textos } from "../_comum/i18n.ts";

function supabaseFalso(rotas) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    const corpo = init.body && typeof init.body === "string" ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : init.body;
    chamadas.push({ url, metodo: init.method ?? "GET", corpo, headers: init.headers ?? {} });
    for (const [padrao, resp] of rotas) {
      if (url.includes(padrao)) {
        const r = typeof resp === "function" ? resp(corpo, init) : resp;
        return new Response(JSON.stringify(r.body ?? r), { status: r.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ message: "nao esperado " + url }), { status: 500 });
  };
  return { amb: { url: "https://ref.supabase.co", anon: "anon", servico: "SERVICO", fetch: f }, chamadas };
}
const jwt = (carga) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(carga)}.assinatura`;
};
const req = (url, init = {}) => new Request(url, init);

test("idiomaDe: en e en-US viram inglês; o resto, pt-BR", () => {
  for (const v of ["en", "en-US", "EN"]) assert.equal(idiomaDe(v), "en", v);
  for (const v of ["pt-BR", "pt", "fr", "", null, undefined, 3]) assert.equal(idiomaDe(v), "pt-BR", String(v));
});

test("em pt-BR o texto do evento é o original, sem recompor", () => {
  const e = { tipo: "troca", texto: "Troca: a@exemplo.com → b@exemplo.com (chegou a 95%).", dados: { motivo: "chegou a 95%" } };
  assert.equal(textoDoEvento(e, "pt-BR"), e.texto);
  assert.equal(textoDoEvento(e, undefined), e.texto);
  assert.equal(textoDoEvento({ tipo: "alerta", texto: "  texto estranho  ", dados: { motivo: "sem_livre" } }, "pt-BR"), "  texto estranho  ");
});

test("em inglês: a troca vem do texto e dos dados", () => {
  const ev = (texto, motivo) => ({ tipo: "troca", texto, dados: { motivo, computador: "c", de: "d", para: "p" } });
  assert.equal(textoDoEvento(ev("Troca: a@exemplo.com → b@exemplo.com (chegou a 95%).", "chegou a 95%"), "en"),
    "Switch: a@exemplo.com → b@exemplo.com (reached 95%).");
  assert.equal(textoDoEvento(ev("Troca: nenhuma → b@exemplo.com (computador sem conta).", "computador sem conta"), "en"),
    "Switch: none → b@exemplo.com (computer without an account).");
  assert.equal(textoDoEvento(ev("Troca: a@exemplo.com → b@exemplo.com (a sessão bateu o limite).", "a sessão bateu o limite"), "en"),
    "Switch: a@exemplo.com → b@exemplo.com (the session hit the limit).");
  assert.equal(textoDoEvento(ev("Troca: a@exemplo.com → b@exemplo.com (motivo novo).", "motivo novo"), "en"),
    "Switch: a@exemplo.com → b@exemplo.com (motivo novo).", "motivo que não se conhece segue como veio");
  assert.equal(textoDoEvento(ev("formato que ninguém previu", "x"), "en"), "formato que ninguém previu", "sem como montar: o texto original");
  assert.equal(motivoEmIngles("pedido pelo painel"), "requested from the panel");
  assert.equal(motivoEmIngles("constructor"), "constructor");
});

test("em inglês: limite, sem conta livre, computador parado e conta que precisa entrar", () => {
  assert.equal(textoDoEvento({ tipo: "limite", texto: "Uma sessão bateu o limite.", dados: {} }, "en"), "A session hit the limit.");
  assert.equal(textoDoEvento({ tipo: "alerta", texto: "Nenhuma conta livre para trocar.", dados: { motivo: "sem_livre" } }, "en"),
    "No free account to switch to.");
  assert.equal(textoDoEvento({ tipo: "alerta", texto: "O computador Mac mini não dá notícia desde 13/10 09:15.", dados: { motivo: "computador_parado" } }, "en"),
    "Computer Mac mini hasn't checked in since Oct 13, 09:15.");
  assert.equal(textoDoEvento({ tipo: "alerta", texto: "a@exemplo.com precisa entrar de novo.", dados: { motivo: "precisa_login" } }, "en"),
    "a@exemplo.com needs to sign in again.");
  assert.equal(textoDoEvento({ tipo: "alerta", texto: "outro formato", dados: { motivo: "precisa_login" } }, "en"),
    "An account needs to sign in again.");
});

test("em inglês: a troca que não firmou, nas três formas do texto", () => {
  const ev = (texto) => ({ tipo: "alerta", texto, dados: { motivo: "troca_falhou" } });
  assert.equal(textoDoEvento(ev("No computador Mac do escritório, a troca para outra@exemplo.com não firmou: a conta em uso continua uma@exemplo.com. Confira no painel."), "en"),
    "On computer Mac do escritório, the switch to outra@exemplo.com didn't take: the account in use is still uma@exemplo.com. Check the panel.");
  assert.equal(textoDoEvento(ev("No computador Mac de casa, a troca para outra@exemplo.com não firmou. Confira no painel."), "en"),
    "On computer Mac de casa, the switch to outra@exemplo.com didn't take. Check the panel.");
  assert.equal(textoDoEvento(ev("No computador Mac de casa, uma troca de conta não firmou. Confira no painel."), "en"),
    "On computer Mac de casa, an account switch didn't take. Check the panel.");
});

test("em inglês: a atualização que falhou, da nuvem, da publicação e do computador", () => {
  const ev = (texto, dados) => ({ tipo: "alerta", texto, dados: { motivo: "atualizacao_falhou", ...dados } });
  assert.equal(textoDoEvento(ev("A atualização da nuvem para a 0.5.0 parou: x. Nada ficou pela metade.", { parte: "nuvem", para: "0.5.0", erro: "timeout" }), "en"),
    "The cloud update to 0.5.0 stopped: timeout. Nothing was left half done (each migration applies fully or not at all); the cloud stays on the previous version, and the computers wait.");
  assert.match(textoDoEvento(ev("A publicação das funções e do painel da 0.5.0 em Mac mini não terminou em 45 minutos: x", { parte: "publicacao", para: "0.5.0" }), "en"),
    /^Publishing the functions and the panel of 0\.5\.0 on computer Mac mini didn't finish in 45 minutes: /);
  assert.match(textoDoEvento(ev("A publicação das funções e do painel da 0.5.0 em um computador não deu certo: falhou. O painel", { parte: "publicacao", para: "0.5.0", erro: "falhou" }), "en"),
    /^Publishing the functions and the panel of 0\.5\.0 on a computer didn't work: falhou\. The previous panel stays online; /);
  assert.match(textoDoEvento(ev("A atualização sozinha de Mac mini para a 0.5.0 não terminou: os outros", { para: "0.5.0", computador: "c" }), "en"),
    /^The automatic update of Mac mini to 0\.5\.0 didn't finish\. /);
  assert.match(textoDoEvento(ev("A atualização sozinha de um computador para a 0.5.0 não deu certo e ele voltou para a anterior: os outros", { para: "0.5.0", erro: "x" }), "en"),
    /^The automatic update of a computer to 0\.5\.0 failed and rolled back to the previous version\. /);
});

test("os textos fixos: pt-BR por padrão, inglês na instalação em inglês", () => {
  assert.equal(textos("pt-BR").tituloResumo, "Reveza AI · resumo do dia");
  assert.equal(textos("en").tituloResumo, "Reveza AI · Daily summary");
  assert.equal(textos(undefined).testeCanal, "Se chegou, o canal está certo.");
  assert.equal(textos("en").testeCanal, "If you got this, the channel is set up correctly.");
});

test("resumo do dia em inglês: número en-US e 'no reading'", () => {
  const r = { usd: 1234.5, trocas: 3, agentes: 7, contas: [{ email: "a@exemplo.com", pct: 42.4 }, { email: "b@exemplo.com", pct: null }] };
  const t = alertas.textoResumo(r, "en");
  assert.match(t, /^Today: US\$ 1,234\.50 equivalent cost, 3 switches, 7 agents\./);
  assert.match(t, /a@exemplo\.com: 42%/);
  assert.match(t, /b@exemplo\.com: no reading/);
  assert.match(alertas.textoResumo(r), /US\$ 1\.234,50 equivalentes/, "sem idioma, o português de sempre");
});

test("enviarPendentes: idioma en manda o texto em inglês ao Telegram e ao webhook; evento, tipo, dados e id não mudam", async () => {
  const { amb, chamadas } = supabaseFalso([
    ["rpc/alertas_pendentes", {
      idioma: "en",
      eventos: [{ id: 7, tipo: "troca", texto: "Troca: a@exemplo.com → b@exemplo.com (chegou a 100%).", dados: { motivo: "chegou a 100%", computador: "c1" } }],
      canais: [{ id: "t1", canal: "telegram", destino: { chat_id: "99" }, tem_segredo: true, eventos: ["troca"] }],
      webhooks: [{ id: "w1", url: "https://n8n.exemplo.com/hook", eventos: ["troca"] }],
    }],
    ["servico_segredo_alerta", "TOKEN-BOT"],
    ["servico_segredo_webhook", "s"],
    ["api.telegram.org", { ok: true }],
    ["n8n.exemplo.com", { ok: true }],
  ]);
  const r = await alertas.enviarPendentes(amb, amb.fetch);
  assert.deepEqual(r, { eventos: 1, envios: 2 });
  const tg = chamadas.find((c) => c.url.includes("api.telegram.org"));
  assert.equal(tg.corpo.text, "Reveza AI\nSwitch: a@exemplo.com → b@exemplo.com (reached 100%).");
  const wh = chamadas.find((c) => c.url.includes("n8n.exemplo.com"));
  assert.deepEqual(Object.keys(wh.corpo), ["evento", "tipo", "texto", "dados", "id"]);
  assert.equal(wh.corpo.evento, "troca");
  assert.equal(wh.corpo.tipo, "troca");
  assert.equal(wh.corpo.id, 7);
  assert.deepEqual(wh.corpo.dados, { motivo: "chegou a 100%", computador: "c1" });
  assert.equal(wh.corpo.texto, "Switch: a@exemplo.com → b@exemplo.com (reached 100%).");
});

test("enviarPendentes: sem idioma na resposta (nuvem antiga) ou em pt-BR, o texto é o original", async () => {
  for (const idioma of [undefined, "pt-BR"]) {
    const { amb, chamadas } = supabaseFalso([
      ["rpc/alertas_pendentes", {
        ...(idioma ? { idioma } : {}),
        eventos: [{ id: 1, tipo: "limite", texto: "Uma sessão bateu o limite.", dados: {} }],
        canais: [{ id: "t1", canal: "telegram", destino: { chat_id: "99" }, tem_segredo: false, eventos: ["limite"] }],
        webhooks: [],
      }],
      ["api.telegram.org", { ok: true }],
    ]);
    await alertas.enviarPendentes(amb, amb.fetch);
    assert.equal(chamadas.find((c) => c.url.includes("api.telegram.org")).corpo.text, "Reveza AI\nUma sessão bateu o limite.");
  }
});

test("alertas: o resumo do dia sai com o título e o texto na língua da instalação", async () => {
  const segredoCron = "c".repeat(64);
  const resumo = { usd: 1234.5, trocas: 1, agentes: 2, contas: [{ email: "a@exemplo.com", pct: null }] };
  const { amb, chamadas } = supabaseFalso([
    ["rpc/resumo_dia", resumo],
    ["rpc/alertas_pendentes", { idioma: "en", eventos: [], canais: [{ id: "e1", canal: "email", destino: { de: "a@exemplo.com", para: "b@exemplo.com" }, tem_segredo: true, eventos: ["resumo_dia"] }], webhooks: [] }],
    ["servico_segredo_alerta", "re_chave"],
    ["api.resend.com", { id: "x" }],
  ]);
  const r = await alertas.tratar(req("https://x", { method: "POST", headers: { "x-reveza-cron": segredoCron }, body: JSON.stringify({ acao: "resumo" }) }), amb, segredoCron);
  assert.deepEqual(await r.json(), { ok: true, envios: 1 });
  const mail = chamadas.find((c) => c.url.includes("api.resend.com"));
  assert.equal(mail.corpo.subject, "Reveza AI · Daily summary");
  assert.match(mail.corpo.text, /^Today: US\$ 1,234\.50 equivalent cost, 1 switch, 2 agents\.\na@exemplo\.com: no reading$/);
});

test("alertas: o teste de canal e de webhook saem na língua da instalação; a mensagem de erro da API segue em português", async () => {
  globalThis.Deno = { env: { get: () => undefined } };
  try {
    const token = jwt({ sub: "a1", aal: "aal2" });
    const base = [["/auth/v1/user", { id: "a1", email: "a@exemplo.com" }], ["servico_papel", "admin"]];
    const { amb, chamadas } = supabaseFalso([...base,
      ["rpc/alertas_pendentes", { idioma: "en", eventos: [], canais: [{ id: "t1", canal: "telegram", destino: { chat_id: "9" }, tem_segredo: false, eventos: [] }], webhooks: [] }],
      ["api.telegram.org", { ok: true }]]);
    const r = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar", alerta_id: "t1" }) }), amb, "c".repeat(64));
    assert.equal(r.status, 200);
    assert.equal(chamadas.find((c) => c.url.includes("api.telegram.org")).corpo.text, "Reveza AI · test\nIf you got this, the channel is set up correctly.");

    const nao = supabaseFalso([...base, ["rpc/alertas_pendentes", { idioma: "en", eventos: [], canais: [], webhooks: [] }]]);
    const r404 = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar", alerta_id: "nada" }) }), nao.amb, "c".repeat(64));
    assert.equal(r404.status, 404);
    assert.equal((await r404.json()).erro, "alerta desconhecido ou desligado");

    const w = supabaseFalso([...base,
      ["rpc/alertas_pendentes", { idioma: "en", eventos: [], canais: [], webhooks: [] }],
      ["rpc/servico_webhook", { id: "w1", url: "https://n8n.exemplo.com/hook", ativo: true, tem_segredo: true }],
      ["servico_segredo_webhook", "s"], ["n8n.exemplo.com", {}]]);
    const rw = await alertas.tratar(req("https://x", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ acao: "testar_webhook", webhook_id: "w1" }) }), w.amb, "c".repeat(64));
    assert.equal(rw.status, 200);
    const corpo = w.chamadas.find((c) => c.url.includes("n8n.exemplo.com")).corpo;
    assert.equal(corpo.texto, "If you got this, the webhook is set up correctly.");
    assert.equal(corpo.evento, "teste");
    assert.equal(corpo.tipo, "teste");
  } finally {
    delete globalThis.Deno;
  }
});
