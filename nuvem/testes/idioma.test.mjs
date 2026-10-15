// 0026: o idioma da instalação na configuração da nuvem e nos alertas pendentes (a língua do alerta que sai pelos canais).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { banco } from "./apoio.mjs";
import { gravarIdioma } from "../../instalador/lib/nuvem.mjs";
import { usarIdioma } from "../../instalador/lib/texto.mjs";

const MIGRACAO = readFileSync(new URL("../migracoes/0026_idioma.sql", import.meta.url), "utf8");

const pendentes = async (b) => (await b.como("servico", "select public.alertas_pendentes(50) as r"))[0].r;

test("0026 é reaplicável e roda duas vezes sem erro", async () => {
  assert.match(MIGRACAO, /^-- reaplicável/m);
  const b = await banco();
  await b.db.exec(MIGRACAO);
  await b.db.exec(MIGRACAO);
});

test("config aceita a chave idioma e segue recusando chave desconhecida", async () => {
  const b = await banco();
  await b.config("idioma", "en");
  assert.equal((await b.sql("select valor #>> '{}' as v from public.config where chave = 'idioma'"))[0].v, "en");
  await assert.rejects(b.config("inventada", "x"), /config_chave_check/);
  // as chaves de antes seguem aceitas (a lista da restrição é a completa)
  for (const chave of ["auto", "nuvem_versao", "publicado", "painel_publicacao", "publicacao_vez", "atualizacao_completa"]) {
    await b.config(chave, chave === "auto");
  }
});

test("alertas_pendentes devolve o idioma da instalação: pt-BR sem a configuração ou com valor estranho", async () => {
  const b = await banco();
  assert.equal((await pendentes(b)).idioma, "pt-BR");
  await b.config("idioma", "en");
  assert.equal((await pendentes(b)).idioma, "en");
  await b.config("idioma", "pt-BR");
  assert.equal((await pendentes(b)).idioma, "pt-BR");
  for (const estranho of ["fr", true, 3, null]) {
    await b.config("idioma", estranho);
    assert.equal((await pendentes(b)).idioma, "pt-BR", String(estranho));
  }
});

test("alertas_pendentes mantém eventos, canais e webhooks como antes, e o texto do evento segue em português", async () => {
  const b = await banco();
  await b.config("idioma", "en");
  await b.sql("select public.rvz_evento('limite', 'Uma sessão bateu o limite.', '{}')");
  const r = await pendentes(b);
  assert.deepEqual(Object.keys(r).sort(), ["canais", "eventos", "idioma", "webhooks"]);
  assert.equal(r.eventos.length, 1);
  assert.equal(r.eventos[0].texto, "Uma sessão bateu o limite.");
  assert.equal((await pendentes(b)).eventos.length, 0, "o cursor andou");
});

test("o painel não grava o idioma da instalação (cada pessoa escolhe o dela) e nada quebra", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  await assert.rejects(b.rpc(admin, "painel_config", { p_chave: "idioma", p_valor: "en" }), /configuração desconhecida/);
  assert.equal((await b.rpc(admin, "painel_config", { p_chave: "auto", p_valor: true })).ok, true);
});

test("o instalador grava o idioma na nuvem (inglês ou pt-BR) e regrava ao mudar", async () => {
  const b = await banco();
  const consultar = (sql, p) => b.sql(sql, p);
  const lido = async () => (await b.sql("select valor #>> '{}' as v from public.config where chave = 'idioma'"))[0]?.v;
  try {
    usarIdioma("en");
    await gravarIdioma(consultar);
    assert.equal(await lido(), "en");
    assert.equal((await pendentes(b)).idioma, "en");
    usarIdioma("pt");
    await gravarIdioma(consultar);
    assert.equal(await lido(), "pt-BR");
    await gravarIdioma(consultar, "en-US");
    assert.equal(await lido(), "pt-BR", "só en ou pt-BR: o resto vira pt-BR");
    await gravarIdioma(consultar, "en");
    assert.equal(await lido(), "en");
  } finally {
    usarIdioma("pt");
  }
});

test("o alerta de troca que não firmou chega com o texto em português e os dados que o inglês precisa", async () => {
  const b = await banco();
  await b.config("idioma", "en");
  const A = await b.computador("Mac do escritório");
  const de = await b.conta(A, "uma@exemplo.com");
  const para = await b.conta(A, "outra@exemplo.com");
  await b.como("servico", "select public.alertas_pendentes(500)");
  await b.rpc(A, "agente_evento", { p_tipo: "erro", p_texto: "x", p_dados: { motivo: "troca_falhou", de, para } });
  const r = await pendentes(b);
  const e = r.eventos.find((x) => x.dados?.motivo === "troca_falhou");
  assert.equal(r.idioma, "en");
  assert.match(e.texto, /^No computador Mac do escritório, a troca para outra@exemplo\.com não firmou/);
});
