// As reaplicáveis rodam de novo quando o arquivo muda, e com elas todas as seguintes (o plano da atualização da nuvem).
// Num banco em uso, com linhas que usam os valores mais novos de cada lista, rodar de novo não pode falhar nem mudar
// dado: uma restrição recriada com a lista antiga recusaria essas linhas e a atualização da nuvem pararia no meio
// (0009, 0012 e 0018 guardavam listas antigas da configuração e dos eventos de alerta; corrigido na 0.4.6).
import test from "node:test";
import assert from "node:assert/strict";
import { banco } from "./apoio.mjs";
import { migracoes, reaplicavel, SQL_REGISTRO } from "../provisionar.mjs";

// Toda restrição com lista de valores, lida do banco já migrado: a lista que vale é a da última migração que a define.
async function listas(b) {
  const linhas = await b.sql(`select conrelid::regclass::text as tabela, pg_get_constraintdef(oid) as def from pg_constraint
    where contype = 'c' and connamespace = 'public'::regnamespace and pg_get_constraintdef(oid) ~ 'ARRAY\\['`);
  return linhas.map(({ tabela, def }) => {
    const m = def.match(/(\w+) (= ANY \(|<@ )ARRAY\[([^\]]*)\]/);
    assert.ok(m, `restrição de ${tabela} num formato que o teste não lê: ${def}`);
    return { tabela, coluna: m[1], todos: m[2] === "<@ ", valores: [...m[3].matchAll(/'([^']*)'::text/g)].map((x) => x[1]) };
  });
}

// Como pôr no banco uma linha com cada valor da lista. Lista nova sem receita aqui faz o teste falhar de propósito.
function receitas(b, ctx) {
  const pc = async (sistema = "macos") => {
    const id = await b.usuario("computador");
    const [{ id: pcId }] = await b.sql(
      "insert into public.computadores (user_id, nome, sistema, versao) values ($1, $2, $3, '1.0.0') returning id",
      [id, `pc ${sistema}`, sistema]);
    return pcId;
  };
  const conta = async () => b.conta(ctx.A, `${Math.random().toString(36).slice(2, 10)}@exemplo.com`);
  return {
    "config.chave": (v) => b.config(v, true),
    "computadores.sistema": (v) => pc(v),
    "comandos.acao": (v) => b.sql("insert into public.comandos (criado_por, computador_id, acao) values ($1, $2, $3)",
      [ctx.admin.id, ctx.A.pc, v]),
    "eventos.tipo": (v) => b.sql("insert into public.eventos (tipo, texto, origem) values ($1, 'x', 'nuvem')", [v]),
    "eventos.origem": (v) => b.sql("insert into public.eventos (tipo, texto, origem) values ('info', 'x', $1)", [v]),
    "alertas.canal": (v) => b.sql("insert into public.alertas (canal, destino, eventos, criado_por) values ($1, '{}', '{}', $2)",
      [v, ctx.admin.id]),
    "alertas.eventos": (todos) => b.sql(
      "insert into public.alertas (canal, destino, eventos, criado_por) values ('telegram', '{}', $1, $2)", [todos, ctx.admin.id]),
    "chaves_api.escopos": (todos) => b.sql(
      "insert into public.chaves_api (user_id, nome, prefixo, hash, escopos) values ($1, 'k', 'rvz_abc123', $2, $3)",
      [ctx.admin.id, "f".repeat(64), todos]),
    "credenciais_atualizacao.nome": (v) => b.sql(
      "insert into public.credenciais_atualizacao (nome, cifrado, nonce) values ($1, $2, $3)",
      [v, Buffer.alloc(40, 1), Buffer.alloc(12, 2)]),
    "ligacao_pedidos.idioma": async (v) => b.sql(
      "insert into public.ligacao_pedidos (computador_id, idioma) values ($1, $2)", [await pc("pendente"), v]),
    "ligacao_pedidos.recusado": async (v) => b.sql(
      "insert into public.ligacao_pedidos (computador_id, recusado, recusado_em) values ($1, $2, now())", [await pc("pendente"), v]),
    "membros.idioma": async (v) => b.sql("update public.membros set idioma = $1 where user_id = $2", [v, await b.usuario("leitura")]),
    "posse.motivo": async (v) => b.sql(
      "insert into public.posse (conta_id, computador_id, motivo, expira_em) values ($1, $2, $3, now() + interval '1 hour')",
      [await conta(), ctx.A.pc, v]),
    "uso_janelas.tipo": async (v) => b.sql(
      "insert into public.uso_janelas (conta_id, tipo, pct, fonte) values ($1, $2, 10, 'api') on conflict do nothing", [ctx.c, v]),
    "uso_janelas.fonte": async (v) => b.sql(
      "insert into public.uso_janelas (conta_id, tipo, pct, fonte) values ($1, 'seven_day', 10, $2)", [await conta(), v]),
    "empresas.transbordo": (v) => b.sql("insert into public.empresas (nome, transbordo) values ($1, $1)", [v]),
    "pastas_empresa.tipo": async (v) => {
      const [{ id }] = await b.sql("insert into public.empresas (nome) values ($1) returning id", [`regra ${v}`]);
      await b.sql("insert into public.pastas_empresa (tipo, padrao, empresa_id) values ($1, 'x', $2)", [v, id]);
    },
  };
}

// O banco inteiro como texto, tabela por tabela (o registro de migrações fica de fora: é dele mudar).
async function retrato(b) {
  const tabelas = (await b.sql("select tablename from pg_tables where schemaname = 'public' and tablename <> 'reveza_migracoes' order by 1"))
    .map((t) => t.tablename);
  const r = {};
  for (const t of tabelas) {
    const [{ n, h }] = await b.sql(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`);
    r[t] = `${n}:${h}`;
  }
  return r;
}

test("as reaplicáveis rodam de novo, em ordem, num banco com todos os valores de cada lista, sem falhar nem mudar dado", async () => {
  const b = await banco();
  const admin = { id: await b.usuario("admin"), aal: "aal2" };
  const A = await b.computador("Mac do escritório");
  const ctx = { admin, A, c: await b.conta(A, "uma@exemplo.com") };
  await b.sql("insert into public.webhooks_saida (url, eventos, criado_por) values ('https://hook.exemplo.com/a', $1, $2)",
    [["sem_livre", "troca", "troca_falhou", "atualizacao_falhou"], admin.id]);

  const povoar = receitas(b, ctx);
  const todas = await listas(b);
  for (const l of todas) {
    const receita = povoar[`${l.tabela}.${l.coluna}`];
    assert.ok(receita, `${l.tabela}.${l.coluna} ganhou lista de valores: ensine este teste a pôr uma linha com cada um`);
    if (l.todos) await receita(l.valores);
    else for (const v of l.valores) await receita(v);
  }
  // cada valor de cada lista está no banco (senão o teste não provaria nada sobre ele)
  for (const l of todas) {
    const expr = l.todos ? `(select array_agg(distinct e) from public.${l.tabela}, unnest(${l.coluna}) e)`
      : `(select array_agg(distinct ${l.coluna}::text) from public.${l.tabela})`;
    const [{ tem }] = await b.sql(`select ${expr} as tem`);
    for (const v of l.valores) assert.ok(tem?.includes(v), `${l.tabela}.${l.coluna} sem linha com '${v}'`);
  }

  // como na nuvem em uso: o registro existe e tem todas
  await b.db.exec(SQL_REGISTRO);
  for (const m of migracoes()) await b.sql("insert into public.reveza_migracoes (nome, hash) values ($1, 'x')", [m.nome]);

  const antes = await retrato(b);
  const plano = migracoes().filter((m) => reaplicavel(m) && !m.nome.endsWith(".supabase.sql"));
  assert.ok(plano.length > 15, "o plano tem as reaplicáveis");
  for (const volta of [1, 2]) {
    for (const m of plano) {
      await b.db.exec(m.sql).catch((e) => assert.fail(`${m.nome} falhou ao rodar de novo (volta ${volta}): ${e.message}`));
    }
  }
  assert.deepEqual(await retrato(b), antes, "rodar de novo não muda dado");
});
