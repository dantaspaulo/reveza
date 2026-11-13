// Apoio dos testes do banco: um Postgres local (PGlite) com o que o Supabase traz pronto, as migrações aplicadas e
// um jeito de agir como cada papel (anon, membro, administrador com ou sem duas etapas, computador).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Parâmetros jsonb vão como JSON (como o PostgREST faz com o corpo da chamada).
const JSONB = new Set(["p_valor", "p_campos", "p_corpo", "p_destino", "p_janelas", "p_historico", "p_linhas",
  "p_sessoes", "p_dados", "p_diagnostico", "p_resposta", "p_publica", "p_envelope"]);

const aqui = path.dirname(fileURLToPath(import.meta.url));
const migracoes = path.join(aqui, "..", "migracoes");

export async function banco() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(aqui, "supabase-falso.sql"), "utf8"));
  for (const arq of readdirSync(migracoes).filter((a) => a.endsWith(".sql") && !a.endsWith(".supabase.sql")).sort()) {
    await db.exec(readFileSync(path.join(migracoes, arq), "utf8"));
  }
  return new Banco(db);
}

class Banco {
  constructor(db) {
    this.db = db;
  }

  async sql(texto, params = []) {
    return (await this.db.query(texto, params)).rows;
  }

  // Cria um usuário do Auth com papel (admin, leitura, computador) e devolve o id.
  async usuario(papel, email = `${randomUUID().slice(0, 8)}@exemplo.com`) {
    const [{ id }] = await this.sql("insert into auth.users (email) values ($1) returning id", [email]);
    if (papel) await this.sql("insert into public.membros (user_id, papel) values ($1, $2)", [id, papel]);
    return id;
  }

  // Executa como um papel do PostgREST: anon ou authenticated com o token (sub, aal).
  async como(quem, texto, params = []) {
    const claims = quem === "anon" || quem === "servico" ? { role: quem === "servico" ? "service_role" : "anon" }
      : { sub: quem.id, aal: quem.aal ?? "aal1", role: "authenticated" };
    const papel = quem === "anon" ? "anon" : quem === "servico" ? "service_role" : "authenticated";
    return this.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.query(`set local role ${papel}`);
      return (await tx.query(texto, params)).rows;
    });
  }

  async rpc(quem, funcao, args = {}) {
    const nomes = Object.keys(args);
    const lista = nomes.map((n, i) => `${n} => $${i + 1}`).join(", ");
    const valores = nomes.map((n) => (JSONB.has(n) ? JSON.stringify(args[n]) : args[n]));
    const [linha] = await this.como(quem, `select public.${funcao}(${lista}) as r`, valores);
    return linha.r;
  }

  // Computador pronto: usuário com papel computador e registrado.
  async computador(nome = "pc") {
    const id = await this.usuario("computador");
    // como o servico_registrar_computador: a identidade nasce com a linha pendente
    await this.sql("insert into public.computadores (user_id, nome, sistema, versao) values ($1, 'Computador novo', 'pendente', '')", [id]);
    const quem = { id };
    const r = await this.rpc(quem, "agente_registrar", { p_nome: nome, p_sistema: "macos", p_versao: "1.0.0" });
    return { ...quem, pc: r.computador_id };
  }

  // Conta com cofre (como se o computador tivesse feito o login) e uso de 5 h.
  // `identidade` distingue a mesma pessoa em organizações diferentes (0035): { organizacao, organizacaoId, accountUuid, plano, nivel }.
  async conta(pc, email, pct5 = 10, extra = {}, identidade = {}) {
    const r = await this.rpc(pc, "agente_registrar_conta", {
      p_email: email, p_organizacao: identidade.organizacao ?? "Org", p_plano: identidade.plano ?? "max",
      p_nivel: identidade.nivel ?? "5x",
      p_cifrado: Buffer.alloc(40, 1).toString("base64"), p_nonce: Buffer.alloc(12, 2).toString("base64"),
      p_organizacao_id: identidade.organizacaoId ?? null, p_account_uuid: identidade.accountUuid ?? null,
    });
    const conta = r.conta_id;
    await this.sql(
      `insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
       values ($1, 'five_hour', $2, now() + interval '3 hours', now(), 'api')
       on conflict (conta_id, tipo) do update set pct = excluded.pct, lido_em = now()`,
      [conta, pct5],
    );
    if (Object.keys(extra).length) {
      const sets = Object.keys(extra).map((k, i) => `${k} = $${i + 2}`).join(", ");
      await this.sql(`update public.contas set ${sets} where id = $1`, [conta, ...Object.values(extra)]);
    }
    return conta;
  }

  async config(chave, valor) {
    await this.sql(
      "insert into public.config (chave, valor) values ($1, $2::jsonb) on conflict (chave) do update set valor = excluded.valor",
      [chave, JSON.stringify(valor)],
    );
  }

  async atribuida(pc) {
    const [l] = await this.sql("select conta_id from public.atribuicao where computador_id = $1", [pc.pc]);
    return l?.conta_id ?? null;
  }
}
