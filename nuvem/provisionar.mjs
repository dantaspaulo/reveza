// Monta a nuvem do Reveza num projeto Supabase da própria pessoa, pela Management API:
// banco (migrações em ordem), login seguro, Edge Functions, segredos, primeiro administrador e a identidade deste
// computador. Usado pelo instalador; também roda sozinho:
//   node provisionar.mjs --ref <projeto> --site https://painel.exemplo.com --admin <email>
// O token de acesso vem de SUPABASE_ACCESS_TOKEN. Nada de segredo é escrito em disco ou no log.

import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { randomBytes, generateKeyPairSync, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com";

// Login seguro. Os campos de plano pago (senha vazada, prazo de sessão) vão à parte: se o plano não deixar, segue.
export function configuracaoAuth({ site, smtp, turnstileSegredo }) {
  const base = {
    site_url: site,
    uri_allow_list: `${site}/**`,
    disable_signup: true,
    external_email_enabled: true,
    external_anonymous_users_enabled: false,
    mailer_autoconfirm: false,
    password_min_length: 12,
    password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    mfa_max_enrolled_factors: 10,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    security_update_password_require_reauthentication: true,
    jwt_exp: 3600,
  };
  if (smtp) {
    Object.assign(base, {
      smtp_host: smtp.host, smtp_port: String(smtp.porta), smtp_user: smtp.usuario, smtp_pass: smtp.senha,
      smtp_admin_email: smtp.remetente, smtp_sender_name: smtp.nome ?? "Reveza AI", smtp_max_frequency: 60,
    });
  }
  if (turnstileSegredo) {
    Object.assign(base, { security_captcha_enabled: true, security_captcha_provider: "turnstile",
      security_captcha_secret: turnstileSegredo });
  }
  const opcionais = [
    { password_hibp_enabled: true },
    { sessions_timebox: 7 * 24 * 3600 },
    { sessions_inactivity_timeout: 24 * 3600 },
  ];
  return { base, opcionais };
}

export function migracoes(dir = path.join(aqui, "migracoes")) {
  const todas = readdirSync(dir).filter((a) => a.endsWith(".sql") && !a.startsWith(".")).sort()
    .map((nome) => ({ nome, sql: readFileSync(path.join(dir, nome), "utf8") }));
  // as permissões fecham tudo o que nasceu antes: sempre por último, mesmo com migração de número maior
  return [...todas.filter((m) => !m.nome.startsWith("0099")), ...todas.filter((m) => m.nome.startsWith("0099"))];
}

const sha256 = (texto) => createHash("sha256").update(texto).digest("hex");
// O resumo não depende do fim de linha: um clone no Windows (core.autocrlf) tem CRLF, o pacote da tag tem LF, e o
// instalador, a função atualizar-nuvem e o agente precisam chegar ao mesmo resumo.
const hashDe = (sql) => sha256(sql.replace(/\r\n/g, "\n"));
/** Os resumos que valem para o mesmo arquivo: o de hoje (LF) e o que um clone com CRLF registrou antes da 0.3.1. */
export const hashesAceitos = (sql) => {
  const lf = sql.replace(/\r\n/g, "\n");
  return [sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))];
};
export const reaplicavel = (m) => /^-- reaplicável/m.test(m.sql);

// Registro das migrações aplicadas (nome e hash), fechado para o painel e para os computadores.
export const SQL_FECHAR_PADRAO = `alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;`;

export const SQL_REGISTRO = `create table if not exists public.reveza_migracoes (
  nome text primary key, hash text not null, aplicada_em timestamptz not null default now());
alter table public.reveza_migracoes enable row level security;
revoke all on public.reveza_migracoes from anon, authenticated;`;

/**
 * O que aplicar: migração nova entra; migração que mudou entra de novo se for reaplicável (só funções), e é recusada
 * se cria tabela (mudança de tabela vai numa migração nova); depois da primeira que entra, as reaplicáveis seguintes
 * entram também. Banco de antes do registro: as de tabela contam como feitas e as reaplicáveis rodam de novo. As
 * permissões (0099) fecham qualquer aplicação.
 */
export function planoMigracoes(todas, feitas, bancoExiste, t = (pt) => pt) {
  const conhecidas = new Map(feitas);
  if (bancoExiste && conhecidas.size === 0) {
    for (const m of todas) if (!reaplicavel(m)) conhecidas.set(m.nome, hashDe(m.sql));
  }
  const aplicar = [];
  // Depois da primeira que roda, as reaplicáveis seguintes rodam de novo, em ordem: uma função definida em mais de uma
  // migração (a agente_vez_de_atualizar está na 0018, na 0020 e na 0021) voltaria ao corpo antigo se só a anterior
  // mudada rodasse. Foi o que a 0.3.1 fez: rodou só a 0020 e tirou da 0021 o portão da publicação (auditoria run-3).
  let depoisDeUma = false;
  for (const m of todas) {
    const antes = conhecidas.get(m.nome);
    const hash = hashDe(m.sql);
    const igual = antes !== undefined && hashesAceitos(m.sql).includes(antes);
    if (igual && !(depoisDeUma && reaplicavel(m))) continue;
    if (!igual && antes !== undefined && !reaplicavel(m)) {
      throw new Error(t(`${m.nome} mudou depois de aplicada e mexe em tabela: a mudança precisa ir numa migração nova`,
        `${m.nome} changed after it was applied and touches a table: the change must go in a new migration`));
    }
    aplicar.push({ ...m, hash });
    depoisDeUma = true;
  }
  const perm = todas.find((m) => m.nome.startsWith("0099"));
  if (aplicar.length && perm && !aplicar.some((m) => m.nome === perm.nome)) aplicar.push({ ...perm, hash: hashDe(perm.sql) });
  return aplicar;
}

export function sqlRegistrar(nome, hash, t = (pt) => pt) {
  if (!/^[0-9a-z_.]+$/.test(nome) || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(t("migração com nome inesperado", "migration with an unexpected name"));
  return `insert into public.reveza_migracoes (nome, hash) values ('${nome}', '${hash}') ` +
    `on conflict (nome) do update set hash = excluded.hash, aplicada_em = now()`;
}

export class Gerencia {
  constructor(token, { fetch: f = globalThis.fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), t = (pt) => pt } = {}) {
    if (!token) throw new Error(t("falta o token de acesso do Supabase", "the Supabase access token is missing"));
    this.token = token;
    this.fetch = f;
    this.esperar = esperar;
  }

  async pedir(metodo, caminho, corpo, extra = {}) {
    const r = await this.fetch(API + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${this.token}`, ...(corpo && !(corpo instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...extra },
      body: corpo instanceof FormData ? corpo : corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!r.ok) {
      const msg = (dados && dados.message) || String(texto).slice(0, 300);
      const e = new Error(`${metodo} ${caminho.split("?")[0]}: ${r.status} ${msg}`);
      e.status = r.status;
      throw e;
    }
    return dados;
  }

  projeto(ref) { return this.pedir("GET", `/v1/projects/${ref}`); }

  async esperarAtivo(ref, tentativas = 60, t = (pt) => pt) {
    for (let i = 0; i < tentativas; i++) {
      const p = await this.projeto(ref);
      if (p.status === "ACTIVE_HEALTHY") return p;
      await this.esperar(10_000);
    }
    throw new Error(t("o projeto não ficou pronto em 10 minutos", "the project was not ready after 10 minutes"));
  }

  // `parametros` vão à parte do texto ($1, $2...): é assim que segredo entra no banco, porque o texto do SQL pode ficar
  // no histórico de consultas (pg_stat_statements não troca literal de bloco DO por $n).
  sql(ref, query, parametros) {
    return this.pedir("POST", `/v1/projects/${ref}/database/query`, parametros ? { query, parameters: parametros } : { query });
  }

  configAuth(ref, campos) { return this.pedir("PATCH", `/v1/projects/${ref}/config/auth`, campos); }

  segredos(ref, lista) { return this.pedir("POST", `/v1/projects/${ref}/secrets`, lista); }

  async chaves(ref) {
    const lista = await this.pedir("GET", `/v1/projects/${ref}/api-keys?reveal=true`);
    const achar = (nome) => (lista.find((k) => k.name === nome) || {}).api_key;
    return { anon: achar("anon"), servico: achar("service_role") };
  }

  async publicarFuncao(ref, slug, dir, verifyJwt) {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", name: slug, verify_jwt: verifyJwt }));
    for (const { nome, conteudo } of pacoteFuncao(dir)) form.append("file", new Blob([conteudo]), nome);
    return this.pedir("POST", `/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`, form);
  }
}

// Arquivos de uma função como vão para o Supabase: os dela e o comum, com o import ajustado para a mesma pasta.
export function pacoteFuncao(dir) {
  const comum = path.join(path.dirname(dir), "_comum");
  const arquivos = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((nome) => ({ nome, conteudo: readFileSync(path.join(dir, nome), "utf8").replaceAll("../_comum/", "./") }));
  if (existsSync(comum)) {
    for (const nome of readdirSync(comum).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      arquivos.push({ nome, conteudo: readFileSync(path.join(comum, nome), "utf8") });
    }
  }
  return arquivos;
}

// Par de chaves VAPID para o push do celular: a privada como JWK (segredo da função), a pública em base64url.
export function chavesVapid() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-65);
  return { privada: JSON.stringify(jwk), publica: Buffer.from(pub).toString("base64url") };
}

// verify_jwt de cada função: as que recebem chamada de fora sem login (API pública com chave própria, ou o pg_cron com o
// segredo dele) ficam false e conferem dentro.
export const FUNCOES = { convite: true, "computador-novo": true, alertas: false, api: false, "atualizar-nuvem": false };

export async function provisionar({ gerencia, ref, site, admin, smtp, turnstileSegredo, computador: criarComputador = true,
  log = () => {}, fetch: f = globalThis.fetch, t = (pt) => pt }) {
  log(t("Esperando o projeto ficar pronto", "Waiting for the project to be ready"));
  const projeto = await gerencia.esperarAtivo(ref, 60, t);
  const url = `https://${ref}.supabase.co`;

  log(t("Criando o banco (tabelas, segurança de linha, funções)", "Creating the database (tables, row-level security, functions)"));
  const existe = await gerencia.sql(ref, "select to_regclass('public.contas') is not null as existe");
  const jaTem = Array.isArray(existe) && existe[0] && existe[0].existe;
  await gerencia.sql(ref, SQL_REGISTRO);
  // Antes de qualquer migração: função criada a partir daqui nasce fechada para anon e authenticated (na primeira
  // instalação, até o 0099 rodar, o padrão do Supabase deixaria tudo executável por quem tem a chave pública).
  await gerencia.sql(ref, SQL_FECHAR_PADRAO);
  const registro = await gerencia.sql(ref, "select nome, hash from public.reveza_migracoes");
  const feitas = new Map((Array.isArray(registro) ? registro : []).map((r) => [r.nome, r.hash]));
  const plano = planoMigracoes(migracoes(), feitas, jaTem, t);
  for (const m of plano) {
    await gerencia.sql(ref, m.sql);
    await gerencia.sql(ref, sqlRegistrar(m.nome, m.hash, t));
  }
  log(plano.length ? t(`Banco: ${plano.map((m) => m.nome).join(", ")}`, `Database: ${plano.map((m) => m.nome).join(", ")}`)
    : t("Banco já estava em dia", "Database was already up to date"));

  log(t("Configurando o login (senha forte, duas etapas, sem cadastro aberto)", "Setting up login (strong password, two-step verification, no open sign-up)"));
  const { base, opcionais } = configuracaoAuth({ site, smtp, turnstileSegredo });
  await gerencia.configAuth(ref, base);
  const recusados = [];
  for (const o of opcionais) {
    try { await gerencia.configAuth(ref, o); } catch (e) { recusados.push(Object.keys(o)[0]); }
  }
  if (recusados.length) log(t(`Do plano pago, ficaram de fora: ${recusados.join(", ")}`, `Left out (paid plan only): ${recusados.join(", ")}`));

  log(t("Publicando as funções da nuvem", "Publishing the cloud functions"));
  const raizFuncoes = path.join(aqui, "funcoes");
  for (const [slug, jwt] of Object.entries(FUNCOES)) {
    const dir = path.join(raizFuncoes, slug);
    if (existsSync(dir)) await gerencia.publicarFuncao(ref, slug, dir, jwt);
  }
  const cron = randomBytes(32).toString("hex");
  // As chaves do push só nascem uma vez: trocar invalida a inscrição de todo celular já ligado.
  const existentes = await gerencia.pedir("GET", `/v1/projects/${ref}/secrets`).catch(() => []);
  const nomes = new Set((Array.isArray(existentes) ? existentes : []).map((x) => x.name));
  const vapid = nomes.has("VAPID_PUBLICA") && nomes.has("VAPID_PRIVADA") ? null : chavesVapid();
  await gerencia.segredos(ref, [
    { name: "REVEZA_SITE", value: site }, { name: "REVEZA_CRON", value: cron },
    ...(vapid ? [{ name: "VAPID_PUBLICA", value: vapid.publica }, { name: "VAPID_PRIVADA", value: vapid.privada }] : []),
  ]);
  // O pg_cron chama a função de alertas com estes dois segredos (lidos do Vault pelo próprio banco).
  await gravarSegredosVault(gerencia, ref, { reveza_url: url, reveza_cron: cron }, t);

  const { anon, servico } = await gerencia.chaves(ref);
  if (!anon || !servico) throw new Error(t("não consegui ler as chaves do projeto", "could not read the project's keys"));

  let adminCriado = null;
  if (admin) {
    log(t("Criando o primeiro administrador", "Creating the first administrator"));
    adminCriado = await garantirUsuario(f, url, servico, gerencia, ref, admin.email, admin.senha, t);
    await gerencia.sql(ref, `insert into public.membros (user_id, papel) values ('${adminCriado}', 'admin') on conflict (user_id) do update set papel = 'admin'`);
  }

  let computador = null;
  if (criarComputador) {
    log(t("Criando a identidade deste computador", "Creating this computer's identity"));
    computador = {
      email: `pc-${randomBytes(6).toString("hex")}@computadores.reveza.invalid`,
      senha: randomBytes(36).toString("base64url"),
    };
    const pcId = await criarUsuario(f, url, servico, computador.email, computador.senha, t);
    await gerencia.sql(ref, `insert into public.membros (user_id, papel) values ('${pcId}', 'computador') on conflict do nothing;
      insert into public.computadores (user_id, nome, sistema, versao) values ('${pcId}', 'Computador novo', 'pendente', '') on conflict (user_id) do nothing`);
  }

  return { url, anon, regiao: projeto.region, computador, adminId: adminCriado, vapidPublica: vapid ? vapid.publica : null };
}

// Endereço do painel mudou (domínio próprio depois do da Vercel): login e funções passam a aceitar só o novo.
export async function trocarSite(gerencia, ref, site, t = (pt) => pt) {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) throw new Error(t("endereço do painel inválido", "invalid panel address"));
  await gerencia.configAuth(ref, { site_url: site, uri_allow_list: `${site}/**` });
  await gerencia.segredos(ref, [{ name: "REVEZA_SITE", value: site }]);
}

// O valor de cada segredo vai como parâmetro, nunca no texto do SQL (auditoria, 11/10/2026).
export async function gravarSegredosVault(gerencia, ref, pares, t = (pt) => pt) {
  for (const [nome, valor] of Object.entries(pares)) {
    if (!/^[a-z_]+$/.test(nome) || typeof valor !== "string" || !valor) throw new Error(t("segredo do Vault inválido", "invalid Vault secret"));
    const linhas = await gerencia.sql(ref, "select id from vault.secrets where name = $1", [nome]);
    const id = Array.isArray(linhas) && linhas[0] ? linhas[0].id : null;
    if (id) await gerencia.sql(ref, "select vault.update_secret($1::uuid, $2::text) is null as ok", [id, valor]);
    else await gerencia.sql(ref, "select vault.create_secret($1::text, $2::text) is not null as ok", [valor, nome]);
  }
}

// Instalação que caiu no meio e rodou de novo: o administrador já existe; a senha passa a ser a digitada agora.
async function garantirUsuario(f, url, servico, gerencia, ref, email, senha, t = (pt) => pt) {
  try {
    return await criarUsuario(f, url, servico, email, senha, t);
  } catch (e) {
    if (e.status !== 422) throw e;
    const linhas = await gerencia.sql(ref, `select id from auth.users where email = '${email.toLowerCase()}'`);
    const id = Array.isArray(linhas) && linhas[0] && linhas[0].id;
    if (!/^[0-9a-f-]{36}$/.test(id || "")) throw e;
    const r = await f(`${url}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: senha }),
    });
    if (!r.ok) throw new Error(t(`atualizar o administrador: ${r.status}`, `updating the administrator: ${r.status}`));
    return id;
  }
}

async function criarUsuario(f, url, servico, email, senha, t = (pt) => pt) {
  if (!/^[^@\s'"]+@[^@\s'"]+\.[^@\s'"]+$/.test(email)) throw new Error(t("e-mail inválido", "invalid email"));
  const r = await f(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, email_confirm: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(t(`criar usuário: ${r.status} ${d.msg || d.message || ""}`.trim(), `creating user: ${r.status} ${d.msg || d.message || ""}`.trim()));
    e.status = r.status;
    throw e;
  }
  if (!/^[0-9a-f-]{36}$/.test(d.id || "")) throw new Error(t("criar usuário: resposta sem id", "creating user: response without an id"));
  return d.id;
}

// Uso direto (o instalador importa as funções acima).
// Chamado direto (e não importado)? Pelo caminho de verdade dos dois lados: a comparação de import.meta.url com
// `file://${argv[1]}` falhava calada no Windows e em pasta com espaço ou acento, e o script saía sem fazer nada.
function chamadoDireto() {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (chamadoDireto()) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const ref = arg("--ref");
  const site = arg("--site");
  if (!ref || !site) {
    console.error("uso: SUPABASE_ACCESS_TOKEN=... node provisionar.mjs --ref <projeto> --site https://painel [--admin email]");
    process.exit(2);
  }
  const email = arg("--admin");
  const senha = process.env.REVEZA_ADMIN_SENHA;
  if (email && (!senha || senha.length < 12)) {
    console.error("defina REVEZA_ADMIN_SENHA (12+ caracteres) para criar o administrador");
    process.exit(2);
  }
  const r = await provisionar({
    gerencia: new Gerencia(process.env.SUPABASE_ACCESS_TOKEN), ref, site,
    admin: email ? { email, senha } : null, log: (m) => console.log(`· ${m}`),
  });
  console.log(JSON.stringify({ url: r.url, anon: r.anon, computador: r.computador.email }, null, 2));
}
