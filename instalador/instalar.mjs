#!/usr/bin/env node
// Instalador do Reveza AI: gestor de várias contas do assistente de código, com painel na nuvem da própria pessoa.
//   Etapas (numeradas só com as que rodam no caminho escolhido): conferência do computador, agente e mod, a nuvem
//   no Supabase com o painel na Vercel, serviço, painel no ar (e o domínio), contas, alertas e prova final.
//   A troca automática já vem ligada, antes do limite (avisa em 90%, troca em 95%): muda no painel.
//
//   npx github:dantaspaulo/reveza                 interativo
//   ... --atualizar                               atualiza agente, mod, banco e painel; contas, uso e configuração ficam
//   ... --sem-nuvem                               só neste computador: agente, mod e contas, sem painel online
//   ... --com-nuvem                               põe a nuvem e o painel numa instalação que estava só no computador
//   ... --ligar                                   liga este computador a uma instalação que já existe (código do painel)
//   ... --sombra                                  ao lado de outro gestor de contas, sem trocar nada (porta 7789)
//   ... --sair-da-sombra                          o outro gestor já parou: o Reveza passa a trocar (com --atualizar)
//   ... --importar <pasta>                        copia contas e uso de outro gestor (a origem não muda)
//   ... --demo                                    abre o painel com dados de exemplo, sem nuvem e sem mexer em conta
//   ... --doctor                                  confere a instalação
//   ... --desinstalar                             tira o serviço e o mod (logins, chave do cofre e nuvem ficam)
//   ... --dominio contas.meudominio.com           o painel no seu subdomínio (na instalação ou no --atualizar)
//   ... --dominio vercel                          o painel volta ao endereço gratuito da Vercel (<projeto>.vercel.app)
//   ... --idioma en                               perguntas em inglês
//   ... --sim                                     sem perguntas (lê SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN e REVEZA_* do ambiente)
//   ... --pasta <dir> | --sem-servico | --sem-react-bits | --versao | --ajuda
//
// Requisitos: Node 20+ e o Claude Code instalado (o Reveza funciona com o Claude Code). Instalar não apaga nada.
//
// Uso interno (o agente chama, com a atualização completa ligada): --publicar-nuvem --ref <projeto> [--partes funcoes,painel]
// publica as funções da nuvem e o painel desta versão, com os tokens pela entrada padrão (nunca em argumento ou ambiente).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Gerencia, provisionar, trocarSite } from "../nuvem/provisionar.mjs";
import { acharChatTelegram, segredoWebhook, testar } from "./lib/alertas.mjs";
import { dnsPronto, dominioPedido, dominioValido, passosDns } from "./lib/dominio.mjs";
import { computadorDoEmail, esperarComando, lerPublicacao, maisNova, pedirComando, registrarPublicacao, salvarAlerta, salvarTroca } from "./lib/nuvem.mjs";
import { etapasDoCaminho, manterNuvemPrevisto, numeroDaEtapa } from "./lib/etapas.mjs";
import { mostrarPaginaDoToken, PAGINA_TOKEN_SUPABASE, PAGINA_TOKEN_VERCEL } from "./lib/navegador.mjs";
import { construir, prepararPasta } from "./lib/painel.mjs";
import { esperarConta } from "./lib/prova.mjs";
import {
  acrescentarPath, ambienteLimpo, criarLancador, existe, gravarConfigLocal, gravarInstalacao, instalarMod, instalarPrograma, lerInstalacao,
  linhaPath, npm, portaOcupada, removerMod, rodar,
  copiarEstado, travarPublicacao, voltarAtualizacao,
} from "./lib/programa.mjs";
import { conferirToken, criarProjeto, organizacoes, projetos, REGIOES, regiaoSugerida } from "./lib/supabase.mjs";
import { emailValido, fraco, info, mascara, nao, negrito, numerarProximoTitulo, ok, perguntador, senhaForte, t, titulo, usarIdioma, verde } from "./lib/texto.mjs";
import { Vercel } from "./lib/vercel.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;
const REPO = "dantaspaulo/reveza";

// ── argumentos ────────────────────────────────────────────────────────────────
const FLAGS = ["--atualizar", "--sem-nuvem", "--com-nuvem", "--sair-da-sombra", "--ligar", "--sombra", "--importar", "--demo", "--doctor", "--desinstalar", "--idioma",
  "--sim", "--pasta", "--sem-servico", "--sem-react-bits", "--versao", "--ajuda", "--help", "-h", "--dominio", "--publicar-nuvem", "--ref", "--partes"];
const COM_VALOR = ["--importar", "--idioma", "--pasta", "--dominio", "--ref", "--partes"];
export function lerArgs(argv) {
  const a = { flags: new Set(), valores: {} };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!FLAGS.includes(x)) return { erro: `opção desconhecida: ${x}` };
    if (COM_VALOR.includes(x)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) return { erro: `${x} pede um valor` };
      a.valores[x] = argv[++i];
    } else a.flags.add(x);
  }
  return a;
}
const uso = () => readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n");

// ── caminhos ──────────────────────────────────────────────────────────────────
const HOME = os.homedir();
const BASE = process.env.REVEZA_HOME || path.join(HOME, ".reveza");
const ARQ_INST = path.join(BASE, "instalacao.json");
const BUILD = path.join(BASE, "painel-build");
const BIN = path.join(BASE, "bin");

function emailDoClaude() {
  try {
    const j = JSON.parse(readFileSync(path.join(HOME, ".claude.json"), "utf8"));
    return j.oauthAccount && j.oauthAccount.emailAddress ? String(j.oauthAccount.emailAddress).toLowerCase() : null;
  } catch { return null; }
}

// ── passos ────────────────────────────────────────────────────────────────────
async function conferir(ctx) {
  titulo(t("Conferência do computador", "Checking this computer"));
  // 20.19: o painel (vite 8) pede, e todo Node daí em diante tem a correção de argumento de .cmd no Windows (CVE-2024-27980)
  const [maior, menor] = process.versions.node.split(".").map(Number);
  if (maior < 20 || (maior === 20 && menor < 19)) throw new Error(t(`Node 20.19 ou mais novo é necessário (este tem ${process.versions.node}): https://nodejs.org`,
    `Node 20.19 or newer is required (this one is ${process.versions.node}): https://nodejs.org`));
  ok(`Node ${process.versions.node}, ${{ darwin: "macOS", linux: "Linux", win32: "Windows" }[process.platform] || process.platform}`);
  if (!existe(npm.replace(/\.cmd$/, ""))) throw new Error(t("npm não encontrado", "npm not found"));
  ctx.temClaude = existe("claude");
  if (ctx.temClaude) ok(t("Claude Code encontrado", "Claude Code found"));
  else nao(t("Claude Code não encontrado no PATH: o Reveza funciona com o Claude Code. Instale (https://claude.com/claude-code) e rode de novo para o mod e o login das contas.",
    "Claude Code not found on PATH: Reveza works with Claude Code. Install it (https://claude.com/claude-code) and run again for the mod and account logins."));
  const ocupada = await portaOcupada(7788);
  const nosso = ctx.inst && !ctx.inst.sombra;
  if (ocupada && !nosso && !ctx.sombra) {
    nao(t("Já existe um programa na porta 7788 (outro gestor de contas?).", "Something already listens on port 7788 (another account manager?)."));
    ctx.sombra = await ctx.p.sim(t("Instalar em modo sombra (lê e mostra o que faria, sem trocar conta)?", "Install in shadow mode (reads and shows what it would do, without switching)?"), true);
  }
  if (ctx.sairDaSombra && ocupada && ctx.inst?.sombra) {
    throw new Error(t("ainda há um programa na porta 7788: pare o outro gestor de contas antes de sair do modo sombra",
      "something still listens on port 7788: stop the other account manager before leaving shadow mode"));
  }
  if (ctx.sombra && ctx.inst?.sombra && !ctx.forcarSombra && !ocupada) {
    nao(t("O outro gestor de contas não está mais rodando.", "The other account manager is no longer running."));
    if (ctx.sairDaSombra || (await ctx.p.sim(t("Sair do modo sombra (o Reveza passa a trocar as contas)?", "Leave shadow mode (Reveza starts switching accounts)?"), false))) ctx.sombra = false;
  }
  if (ctx.sombra) ok(t("modo sombra: porta 7789, nenhuma troca de conta", "shadow mode: port 7789, no account switching"));
}

async function programa(ctx) {
  titulo(t("Agente e mod", "Agent and mod"));
  ctx.cli = instalarPrograma(RAIZ, ctx.app, { log: info });
  ok(t(`agente ${VERSAO} em ${ctx.app}`, `agent ${VERSAO} in ${ctx.app}`));
  const lanc = criarLancador(BIN, ctx.cli);
  ok(t(`comando reveza em ${lanc}`, `reveza command at ${lanc}`));
  const l = linhaPath(BIN);
  if (l && !(process.env.PATH || "").split(path.delimiter).includes(BIN)) {
    if (await ctx.p.sim(t(`Pôr o comando reveza no PATH (uma linha em ${l.arquivo})?`, `Put the reveza command on PATH (one line in ${l.arquivo})?`), !ctx.semPerguntas)) {
      if (acrescentarPath(BIN)) ok(t("PATH atualizado (vale nos terminais novos)", "PATH updated (applies to new terminals)"));
      else nao(t(`não consegui mudar o PATH: use ${l.linha}`, `could not change PATH: use ${l.linha}`));
    } else info(t(`Para usar o comando reveza: ${l.linha}`, `To use the reveza command: ${l.linha}`));
  }
  if (ctx.importar) {
    const de = path.resolve(ctx.importar.replace(/^~(?=$|\/)/, HOME));
    const r = reveza(ctx, ["importar", "--de", de, ...(ctx.sombra ? ["--sombra"] : [])], true);
    r.ok ? ok(t("contas e uso copiados (a origem não mudou)", "accounts and usage copied (the source did not change)"))
      : nao(t("a importação não terminou: veja a mensagem acima", "the import did not finish: see the message above"));
  }
}

function reveza(ctx, args, mostrar = false, env) {
  return rodar(process.execPath, [ctx.cli, ...args], { mostrar, env: ambienteLimpo(env) });
}

/**
 * A troca de uma instalação nova, sem pergunta: automática LIGADA, antes do limite (avisa em 90%, troca em 95%).
 * Muda no painel, em Troca automática. Antes eram três a cinco perguntas, e o padrão deixava a troca desligada,
 * que é justamente o que a pessoa veio buscar (Paulo, 12/10/2026, para a 0.2.0).
 */
export const TROCA_PADRAO = Object.freeze({ auto: true, modo: "limiar", aviso: 90, troca: 95 });

/**
 * A troca que esta instalação grava: a padrão numa instalação nova. Atualizar, ligar a uma instalação que já existe e
 * importar de outro gestor não gravam nada aqui: fica a configuração que já vale (a do estado local, a da nuvem ou a
 * importada, que `trocaLocal` leva para a nuvem quando ela entra).
 */
export function trocaInicial({ ligar, atualizar, importar }) {
  return ligar || atualizar || importar ? null : { ...TROCA_PADRAO };
}

/** A configuração de troca em palavras, para a linha que a instalação mostra. */
export function descreverTroca({ auto, modo, aviso, troca }) {
  const como = modo === "limite" ? t("só quando a conta bate no limite", "only when the account hits its limit")
    : modo === "rodizio" ? t("rodízio entre as contas livres", "rotating among free accounts")
      : t(`antes do limite (avisa em ${aviso}%, troca em ${troca}%)`, `before the limit (warns at ${aviso}%, switches at ${troca}%)`);
  return `${auto ? t("troca automática ligada", "automatic switching on") : t("troca automática desligada", "automatic switching off")}, ${como}`;
}

async function nuvem(ctx) {
  titulo(t("A nuvem (Supabase)", "The cloud (Supabase)"));
  info(t("O painel, o cofre cifrado e a decisão de troca moram num projeto Supabase SEU. O plano grátis basta.",
    "The panel, the encrypted vault and the switching decision live in a Supabase project of YOURS. The free plan is enough."));
  info(t("O token do Supabase serve para criar o projeto, montar o banco e publicar as funções. É usado só agora e não fica guardado.",
    "The Supabase token is used to create the project, set up the database and publish the functions. It is used only now and is not stored."));
  // numa atualização o token é opcional (em branco, só este computador): a página não abre sozinha
  const opcional = !!(ctx.atualizar && ctx.inst?.nuvem);
  await mostrarPaginaDoToken(PAGINA_TOKEN_SUPABASE, {
    aviso: t(`Crie um token pessoal em ${PAGINA_TOKEN_SUPABASE} (Generate new token).`, `Create a personal token at ${PAGINA_TOKEN_SUPABASE} (Generate new token).`),
    abriu: t("Abri essa página no navegador.", "I opened that page in your browser."),
    interativo: !ctx.semPerguntas && !opcional, tokenDoAmbiente: !!process.env.SUPABASE_ACCESS_TOKEN, info,
  });
  if (opcional) {
    info(t("Para atualizar só este computador (sem mexer na nuvem e no painel), deixe em branco e tecle Enter.",
      "To update only this computer (leaving the cloud and the panel as they are), leave it blank and press Enter."));
  }
  let token = "";
  for (let i = 0; i < 3 && !token; i++) {
    token = await ctx.p.segredo(t("Token do Supabase:", "Supabase token:"), "SUPABASE_ACCESS_TOKEN");
    if (!token) break;
    const g = new Gerencia(token);
    const c = await conferirToken(g);
    if (!c.ok) { nao(c.erro); token = ""; }
  }
  if (!token && ctx.atualizar && ctx.inst?.nuvem) {
    // atualização só do computador: a nuvem e o painel que já estão no ar ficam como estão
    info(t("Sem token: a nuvem e o painel ficam como estão; o computador é atualizado.", "No token: the cloud and the panel stay as they are; this computer is updated."));
    if (ctx.dominioPedido !== undefined) {
      nao(t("o endereço do painel só muda com os tokens (a mudança é no painel e no login da nuvem): rode de novo com o token do Supabase",
        "the panel address only changes with the tokens (it changes the panel and the cloud login): run again with the Supabase token"));
    }
    ctx.manterNuvem = true;
    return;
  }
  if (!token) throw new Error(t("sem token do Supabase não dá para criar a nuvem (ou use --sem-nuvem)", "without a Supabase token the cloud cannot be created (or use --sem-nuvem)"));
  ok(t(`token aceito (${mascara(token)})`, `token accepted (${mascara(token)})`));
  ctx.gerencia = new Gerencia(token);

  if (ctx.atualizar && ctx.inst?.nuvem?.ref) {
    ctx.ref = ctx.inst.nuvem.ref;
  } else {
    const lista = await projetos(ctx.gerencia);
    const opcoes = [t("criar um projeto novo, só do Reveza (recomendado)", "create a new project just for Reveza (recommended)"), ...lista.map((p) => `${p.nome} (${p.ref}, ${p.regiao})`)];
    const i = await ctx.p.escolha(t("Projeto do Supabase", "Supabase project"), opcoes, process.env.REVEZA_SUPABASE_REF ? 0 : 1);
    if (process.env.REVEZA_SUPABASE_REF) ctx.ref = process.env.REVEZA_SUPABASE_REF;
    else if (i === 0) {
      const orgs = await organizacoes(ctx.gerencia);
      if (!orgs.length) throw new Error(t("o token não vê nenhuma organização", "the token sees no organization"));
      const o = orgs.length === 1 ? 0 : await ctx.p.escolha(t("Organização do Supabase onde criar o projeto", "Supabase organization to create the project in"), orgs.map((x) => x.nome), 1);
      const sugerida = regiaoSugerida();
      let regiao = await ctx.p.perguntar(t("Região do projeto (a sugerida é a mais perto, pelo fuso deste computador)", "Project region (the suggested one is the closest, by this computer's time zone)"), sugerida);
      if (!REGIOES.includes(regiao)) {
        nao(t(`região desconhecida: fico com ${sugerida}`, `unknown region: using ${sugerida}`));
        regiao = sugerida;
      }
      ctx.ref = await criarProjeto(ctx.gerencia, { org: orgs[o].slug, nome: "reveza", regiao });
      ok(t(`projeto criado (${ctx.ref}); a senha do banco é aleatória e não fica guardada`, `project created (${ctx.ref}); the database password is random and not stored`));
    } else ctx.ref = lista[i - 1].ref;
  }
  if (!/^[a-z0-9]{20}$/.test(ctx.ref || "")) throw new Error(t("projeto do Supabase inválido", "invalid Supabase project"));

  // a nuvem já se atualizou sozinha para uma versão mais nova que este instalador: não volta para trás (as migrações
  // reaplicáveis antigas passariam por cima das novas, e o "publicado" ficaria com a versão de antes)
  if (ctx.atualizar && !ctx.nuvemNova) {
    const daNuvem = await lerPublicacao(consultar(ctx)).then((c) => c.versao, () => null);
    if (maisNova(daNuvem, VERSAO)) {
      nao(t(`a nuvem já está na ${daNuvem}, mais nova que este instalador (${VERSAO}): a nuvem e o painel ficam como estão. Para mexer neles, use o instalador da ${daNuvem} ou mais novo.`,
        `the cloud is already on ${daNuvem}, newer than this installer (${VERSAO}): the cloud and the panel stay as they are. To change them, use the ${daNuvem} installer or newer.`));
      ctx.manterNuvem = true;
      return;
    }
  }

  if (ctx.nuvemNova) {
    titulo(t("  Administrador do painel", "  Panel administrator"));
    let email = process.env.REVEZA_ADMIN_EMAIL || emailDoClaude() || "";
    email = (await ctx.p.perguntar(t("Seu e-mail (é o login do painel)", "Your e-mail (the panel login)"), email)).toLowerCase();
    if (!emailValido(email)) throw new Error(t("e-mail inválido", "invalid e-mail"));
    let senha = "";
    for (let i = 0; i < 3; i++) {
      senha = await ctx.p.segredo(t("Senha do painel (12+ caracteres, com maiúscula, minúscula e número):", "Panel password (12+ characters, with upper, lower case and a number):"), "REVEZA_ADMIN_SENHA");
      if (!senhaForte(senha)) { nao(t("senha fraca", "weak password")); senha = ""; continue; }
      if (ctx.semPerguntas || process.env.REVEZA_ADMIN_SENHA) break;
      const de2 = await ctx.p.segredo(t("Repita a senha:", "Repeat the password:"));
      if (de2 === senha) break;
      nao(t("as duas senhas não bateram", "the two passwords did not match"));
      senha = "";
    }
    if (!senha) throw new Error(t("sem senha do administrador", "no administrator password"));
    ctx.admin = { email, senha };
    info(t("No primeiro login o painel pede a verificação em duas etapas (app autenticador).", "On first login the panel asks for two-step verification (authenticator app)."));

    titulo(t("  E-mail do painel (convites e recuperação de senha)", "  Panel e-mail (invites and password recovery)"));
    info(t("Sem envio próprio, o Supabase só manda e-mail a quem é da sua organização nele: convite para outra pessoa não chega.",
      "Without your own sender, Supabase only e-mails members of your organization there: invites to other people do not arrive."));
    if (await ctx.p.sim(t("Configurar agora o envio pelo Resend (grátis até 3 mil e-mails por mês; dá para fazer depois)?",
      "Set up sending through Resend now (free up to 3,000 e-mails a month; you can do it later)?"), false)) {
      const chave = await ctx.p.segredo(t("Chave da API do Resend (resend.com/api-keys):", "Resend API key (resend.com/api-keys):"), "REVEZA_RESEND_CHAVE");
      const remetente = await ctx.p.perguntar(t("Remetente (e-mail de um domínio verificado no Resend)", "Sender (an e-mail on a domain verified in Resend)"), "");
      if (chave && emailValido(remetente)) {
        ctx.smtp = { host: "smtp.resend.com", porta: 465, usuario: "resend", senha: chave, remetente };
        ctx.resendChave = chave;
      } else nao(t("ficou sem envio próprio: dá para configurar depois no Supabase (Authentication → SMTP)", "no own sender: set it later in Supabase (Authentication → SMTP)"));
    }
  }
}

async function perguntarPainel(ctx) {
  titulo(t("  Painel na Vercel", "  Panel on Vercel"));
  info(t("O token da Vercel serve para publicar o painel na sua conta. É usado só agora e não fica guardado.",
    "The Vercel token is used to publish the panel to your account. It is used only now and is not stored."));
  await mostrarPaginaDoToken(PAGINA_TOKEN_VERCEL, {
    aviso: t(`Crie em ${PAGINA_TOKEN_VERCEL} (Create).`, `Create it at ${PAGINA_TOKEN_VERCEL} (Create).`),
    abriu: t("Abri essa página no navegador.", "I opened that page in your browser."),
    interativo: !ctx.semPerguntas, tokenDoAmbiente: !!process.env.VERCEL_TOKEN, info,
  });
  const token = await ctx.p.segredo(t("Token da Vercel:", "Vercel token:"), "VERCEL_TOKEN");
  if (!token) throw new Error(t("sem token da Vercel não dá para publicar o painel (ou use --sem-nuvem)", "without a Vercel token the panel cannot be published (or use --sem-nuvem)"));
  let v = new Vercel(token);
  const eu = await v.quemSou();
  ok(t(`Vercel: ${eu.usuario}`, `Vercel: ${eu.usuario}`));
  let equipe = ctx.inst?.painel?.equipe ?? null;
  if (!ctx.inst?.painel && eu.equipes.length) {
    // padrão: a equipe padrão da conta (na Vercel de hoje, a conta pessoal também é uma equipe); REVEZA_VERCEL_EQUIPE escolhe
    const pedida = process.env.REVEZA_VERCEL_EQUIPE;
    const indice = pedida ? eu.equipes.findIndex((x) => x.id === pedida || x.slug === pedida) : eu.equipes.findIndex((x) => x.id === eu.padrao);
    const i = await ctx.p.escolha(t("Onde publicar na Vercel", "Where to publish on Vercel"), [t("conta pessoal", "personal account"), ...eu.equipes.map((x) => x.nome)], indice >= 0 ? indice + 2 : 1);
    equipe = i === 0 ? null : eu.equipes[i - 1].id;
  }
  ctx.vercel = new Vercel(token, { equipe });
  ctx.projetoVercel = ctx.inst?.painel?.projeto || (await ctx.p.perguntar(t("Nome do projeto na Vercel", "Vercel project name"), process.env.REVEZA_VERCEL_PROJETO || "reveza")).toLowerCase();
  if (!ctx.inst?.painel && ctx.dominioPedido !== undefined) {
    // --dominio na instalação: sem pergunta (vercel = o endereço gratuito da Vercel)
    ctx.dominio = ctx.dominioPedido;
  } else if (!ctx.inst?.painel) {
    const d = await ctx.p.escolha(t("Endereço do painel", "Panel address"), [
      t(`o da Vercel (${ctx.projetoVercel}.vercel.app)`, `Vercel's (${ctx.projetoVercel}.vercel.app)`),
      t("um subdomínio meu (ex.: contas.meudominio.com)", "a subdomain of mine (e.g. accounts.mydomain.com)"),
    ], 1);
    if (d === 1) {
      ctx.dominio = dominioValido(await ctx.p.perguntar(t("Subdomínio (ex.: contas.meudominio.com)", "Subdomain (e.g. accounts.mydomain.com)"), process.env.REVEZA_DOMINIO || ""));
      if (!ctx.dominio) nao(t("domínio inválido: fico com o da Vercel", "invalid domain: using Vercel's"));
    }
  } else {
    // atualização: --dominio (ou REVEZA_DOMINIO) liga, troca ou, com "vercel", tira o domínio; sem pedir, fica o de antes
    ctx.dominio = ctx.dominioPedido !== undefined ? ctx.dominioPedido : ctx.inst?.painel?.dominio || null;
  }
  ctx.equipe = equipe;
}

async function aplicarNuvem(ctx) {
  // Na primeira instalação o painel ainda não tem endereço: até publicar, o login só aceita voltar para o próprio
  // computador. Antes era <projeto>.vercel.app, um nome que pode ser de outra pessoa (a Vercel dá outro quando ele já
  // existe), e uma instalação que parasse no meio deixava o link de login apontando para lá (auditoria, 11/10/2026).
  ctx.siteProvisorio = ctx.inst?.painel?.url || "http://localhost:5173";
  const r = await provisionar({
    gerencia: ctx.gerencia, ref: ctx.ref, site: ctx.siteProvisorio, admin: ctx.admin || null, smtp: ctx.smtp, computador: ctx.nuvemNova, log: info,
  });
  ctx.url = r.url;
  ctx.anon = r.anon;
  ctx.adminId = r.adminId || ctx.inst?.nuvem?.adminId || null;
  ctx.vapidPublica = r.vapidPublica || ctx.inst?.nuvem?.vapidPublica || null;
  ok(t(`nuvem pronta em ${r.url} (${r.regiao})`, `cloud ready at ${r.url} (${r.regiao})`));
  if (r.computador) {
    const e = reveza(ctx, ["nuvem", "entrar", "--url", r.url, "--chave-publica", r.anon, "--email", r.computador.email], false, { REVEZA_SENHA: r.computador.senha });
    if (!e.ok) throw new Error(t(`não consegui guardar a identidade do computador: ${e.erro.slice(-200)}`, `could not store this computer's identity: ${e.erro.slice(-200)}`));
    ctx.emailComputador = r.computador.email;
    ok(t("identidade deste computador no chaveiro do sistema", "this computer's identity in the system keychain"));
    const c = reveza(ctx, ["cofre", "iniciar"]);
    c.ok ? ok(t("chave do cofre criada (só existe nos seus computadores)", "vault key created (exists only on your computers)"))
      : nao(t(`chave do cofre: ${c.erro.slice(-200)}`, `vault key: ${c.erro.slice(-200)}`));
  }
  // nuvem nova numa instalação que já existia: a troca que valia neste computador passa a valer na nuvem
  if (!ctx.troca && ctx.nuvemNova) ctx.troca = trocaLocal();
  if (ctx.troca && ctx.adminId) {
    await salvarTroca(consultar(ctx), ctx.adminId, { ...ctx.troca, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone });
    ok(`${descreverTroca(ctx.troca)}${t(": muda no painel, em Troca automática", ": change it in the panel, under Auto switch")}`);
  }
}

const consultar = (ctx) => (sql, parametros) => ctx.gerencia.sql(ctx.ref, sql, parametros);

/** A configuração de troca que já vale neste computador (estado do agente), no formato da nuvem. */
export function trocaLocal(arquivo = path.join(BASE, "estado.json")) {
  try {
    const c = JSON.parse(readFileSync(arquivo, "utf8")).config;
    if (!c || !["limite", "limiar", "rodizio"].includes(c.modo)) return null;
    const aviso = Number(c.aviso) || 90;
    const troca = Number(c.troca) || 95;
    return { auto: c.auto === true, modo: c.modo, ...(aviso < troca ? { aviso, troca } : { aviso: 90, troca: 95 }) };
  } catch {
    return null;
  }
}

async function servico(ctx) {
  titulo(t("Serviço", "Service"));
  if (ctx.semServico) nao(t("sem serviço (--sem-servico): rode `reveza rodar` para testar", "no service (--sem-servico): run `reveza rodar` to test"));
  else {
    const r = reveza(ctx, ["servico", "instalar", ...(ctx.sombra ? ["--sombra"] : [])]);
    r.ok ? ok(r.saida.trim()) : nao(t(`o serviço não subiu: ${(r.saida + r.erro).trim().slice(-300)}`, `the service did not start: ${(r.saida + r.erro).trim().slice(-300)}`));
    if (!r.ok && /systemctl.*ENOENT|Failed to connect to bus/i.test(r.erro + r.saida)) {
      info(t(`Sem systemd de usuário aqui: rode "${BIN}/reveza rodar" num terminal, ou ponha no crontab: @reboot ${BIN}/reveza rodar`,
        `No user systemd here: run "${BIN}/reveza rodar" in a terminal, or add to crontab: @reboot ${BIN}/reveza rodar`));
    }
  }
  if (ctx.sombra) info(t("O mod entra quando sair do modo sombra (dois mods nas mesmas sessões disputariam a linha de status e a retomada).",
    "The mod is added when leaving shadow mode (two mods in the same sessions would fight over the status line and resuming)."));
  else if (ctx.temClaude) {
    const m = instalarMod(ctx.app, { porta: 7788 });
    m.ok ? ok(t("mod nas sessões do Claude Code (vale nas sessões novas; /reveza mostra as contas)", "mod in Claude Code sessions (applies to new sessions; /reveza shows the accounts)"))
      : nao(t(`mod: ${m.erro}`, `mod: ${m.erro}`));
  }
}

/** A versão do agente que está respondendo na ponte local (pelo `reveza status --json` do programa instalado). */
function versaoRodando(ctx) {
  const r = reveza(ctx, ["status", "--json", ...(ctx.sombra ? ["--sombra"] : [])]);
  try {
    const e = JSON.parse(r.saida);
    return e.parado ? null : e.programa ?? null;
  } catch {
    return null;
  }
}

/**
 * Depois de atualizar: o agente novo precisa responder na porta local. Se não responder em 30 s, volta o programa
 * anterior e a configuração da cópia, sobe o serviço de novo e para com erro (nada se perde: contas e logins ficam).
 */
async function conferirSubiu(ctx) {
  const porta = ctx.sombra ? 7789 : 7788;
  for (let i = 0; i < 30; i++) {
    if (versaoRodando(ctx) === VERSAO) return ok(t(`o agente ${VERSAO} está rodando`, `agent ${VERSAO} is running`));
    await new Promise((r) => setTimeout(r, 1000));
  }
  nao(t("o agente novo não respondeu em 30 s: voltando para a versão anterior", "the new agent did not answer in 30 s: going back to the previous version"));
  if (!voltarAtualizacao(ctx.app, BASE, ctx.copia)) throw new Error(t("não havia versão anterior para voltar; veja os logs em ~/.reveza/logs", "there was no previous version to go back to; see the logs in ~/.reveza/logs"));
  ctx.cli = path.join(ctx.app, "agente", "dist", "src", "cli.js");
  criarLancador(BIN, ctx.cli);
  reveza(ctx, ["servico", "instalar", ...(ctx.sombra ? ["--sombra"] : [])]);
  let voltou = false;
  for (let i = 0; i < 30 && !voltou; i++) {
    voltou = await portaOcupada(porta);
    if (!voltou) await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(voltou
    ? t(`a versão ${VERSAO} não subiu; voltei para a anterior, que está rodando. Contas e logins ficaram como estavam. Cópia: ${ctx.copia}`,
      `version ${VERSAO} did not start; went back to the previous one, which is running. Accounts and logins stayed as they were. Copy: ${ctx.copia}`)
    : t(`a versão ${VERSAO} não subiu e a anterior também não respondeu: rode reveza doctor. Cópia do estado: ${ctx.copia}`,
      `version ${VERSAO} did not start and the previous one did not answer either: run reveza doctor. State copy: ${ctx.copia}`));
}

async function painel(ctx) {
  titulo(t("Painel", "Panel"));
  prepararPasta(RAIZ, BUILD);
  const proj = await ctx.vercel.projeto(ctx.projetoVercel);
  const publicar = async (dominio, vercelHost) => {
    const b = construir(BUILD, { supabaseUrl: ctx.url, anon: ctx.anon, dominio, vercelHost, repo: REPO, versao: VERSAO, vapid: ctx.vapidPublica, reactBits: !ctx.semReactBits, log: info });
    if (b.componentes) info(t(`${b.componentes} componentes do React Bits nesta máquina`, `${b.componentes} React Bits components on this machine`));
    return await ctx.vercel.publicar(proj, b.dist, { log: info });
  };
  // atualização com o domínio já apontado: publica uma vez só, já com o redirecionamento
  const vercelAntes = ctx.inst?.painel?.urlVercel;
  let reg = null;
  let pronto = false;
  if (ctx.dominio && vercelAntes) {
    reg = await ctx.vercel.adicionarDominio(proj, ctx.dominio);
    pronto = reg.configurado || (await dnsPronto(ctx.dominio, reg.registro));
    // sem ninguém olhando (publicação da atualização completa, --sim), o endereço do painel não muda sozinho: se a
    // conferência do DNS falhar agora, segue o domínio que já era o do painel. Antes ele voltava para o da Vercel e
    // trocava o endereço do login e o CORS das funções (auditoria de segurança run-3).
    if (!pronto && ctx.semPerguntas && ctx.inst?.painel?.dominio === ctx.dominio) {
      nao(t(`não consegui conferir agora o DNS de ${ctx.dominio}; o painel continua nele (nada muda de endereço sem você)`,
        `could not check the ${ctx.dominio} DNS right now; the panel stays on it (no address changes without you)`));
      pronto = true;
    }
  }
  let pub = await publicar(pronto ? ctx.dominio : null, pronto ? new URL(vercelAntes).host : null);
  // atualização: o endereço do projeto na Vercel é o mesmo de antes (a implantação nova vai para ele)
  if (vercelAntes) pub = { ...pub, url: vercelAntes };
  ctx.urlVercel = pronto ? vercelAntes : pub.url;
  ok(t(`painel no ar: ${pub.url}`, `panel online: ${pub.url}`));
  let site = pronto ? `https://${ctx.dominio}` : pub.url;
  if (ctx.dominio && !pronto) {
    reg = reg || (await ctx.vercel.adicionarDominio(proj, ctx.dominio));
    pronto = reg.configurado || (await dnsPronto(ctx.dominio, reg.registro));
    if (!pronto) {
      console.log("");
      for (const l of passosDns(reg.registro, t)) console.log(`    ${l}`);
      if (!ctx.semPerguntas && (await ctx.p.sim(t("Já criou o registro? Eu confiro por até 5 minutos", "Created the record? I will check for up to 5 minutes"), true))) {
        for (let i = 0; i < 20 && !pronto; i++) {
          await new Promise((r) => setTimeout(r, 15000));
          pronto = (await dnsPronto(ctx.dominio, reg.registro)) || (await ctx.vercel.registroDns(ctx.dominio)).configurado;
        }
      }
    }
    if (pronto) {
      site = `https://${ctx.dominio}`;
      pub = await publicar(ctx.dominio, new URL(ctx.urlVercel).host);
      ok(t(`domínio próprio: ${site} (o endereço da Vercel redireciona para ele)`, `own domain: ${site} (the Vercel address redirects to it)`));
    } else nao(t(`o DNS de ${ctx.dominio} ainda não responde: o painel segue em ${pub.url}. Depois rode --atualizar para trocar.`,
      `${ctx.dominio} DNS does not answer yet: the panel stays at ${pub.url}. Later run --atualizar to switch.`));
  }
  if (site !== ctx.siteProvisorio) await trocarSite(ctx.gerencia, ctx.ref, site);
  ctx.site = site;
  // voltou para o endereço da Vercel: o domínio segue ligado ao projeto lá até a pessoa tirar
  const antes = ctx.inst?.painel?.dominio;
  if (antes && !ctx.dominio) {
    info(t(`O painel voltou para ${site}. ${antes} continua ligado ao projeto na Vercel: para tirar, Vercel → projeto → Settings → Domains, e apague o registro no DNS.`,
      `The panel is back at ${site}. ${antes} is still attached to the Vercel project: to remove it, Vercel → project → Settings → Domains, and delete the DNS record.`));
  }
}

/** A atualização completa já está ligada nesta instalação? (na dúvida, não: a oferta aparece) */
async function atualizacaoCompletaLigada(consulta) {
  try {
    const l = await consulta("select (valor ->> 'ligada')::boolean as ligada from public.config where chave = 'atualizacao_completa'");
    return Array.isArray(l) && l[0]?.ligada === true;
  } catch {
    return false;
  }
}

/** Os dados do painel que vão para a nuvem (qualquer computador da instalação consegue publicar com eles). */
function publicacaoDe(ctx) {
  return { projeto: ctx.projetoVercel, equipe: ctx.equipe ?? null, dominio: ctx.dominio || null, url: ctx.site, urlVercel: ctx.urlVercel ?? null, vapid: ctx.vapidPublica ?? null };
}

/** O texto da atualização completa: o que é, o que custa em segurança e como reduzir o alcance dos tokens. */
export function textoAtualizacaoCompleta() {
  return [
    t("Atualização completa (opcional). A nuvem já se atualiza sozinha, sem token nenhum. Para as funções da nuvem e o painel também irem sozinhos,",
      "Full update (optional). The cloud already updates itself, with no token at all. For the cloud functions and the panel to go by themselves too,"),
    t("os tokens do Supabase e da Vercel ficam na nuvem CIFRADOS com a chave do cofre: a nuvem guarda um texto que não lê, e só um computador seu abre.",
      "the Supabase and Vercel tokens are kept in the cloud ENCRYPTED with the vault key: the cloud stores text it cannot read, and only one of your computers opens it."),
    t("Atenção: quem tiver um computador desta instalação passa a ter esses tokens. Prefira tokens de alcance curto e com validade:",
      "Mind this: whoever has a computer of this installation gets these tokens. Prefer short-reach tokens with an expiry date:"),
    t("  Vercel: escopo só no time do painel e com validade (Account → Tokens);", "  Vercel: scoped to the panel's team only, with an expiry (Account → Tokens);"),
    t("  Supabase: com validade, se a página oferecer, e de uma conta que só tenha a organização do Reveza (o token alcança tudo o que a conta alcança).",
      "  Supabase: with an expiry if the page offers one, from an account that only has the Reveza organization (the token reaches everything the account reaches)."),
    t("Liga ou desliga depois: reveza atualizacao-completa ligar | desligar | status (ou Desligar, no painel).",
      "Turn it on or off later: reveza atualizacao-completa ligar | desligar | status (or Turn off, in the panel)."),
  ];
}

/**
 * A oferta no fim da instalação: guardar os tokens cifrados para a atualização completa. Padrão NÃO (e sem pergunta,
 * --sim ou sem terminal, fica desligada). Os tokens vão ao agente pela entrada padrão, nunca em argumento ou ambiente.
 */
export async function oferecerAtualizacaoCompleta({ p, tokens, rodarCli, mostrar = (l) => info(l) }) {
  if (!tokens?.supabase || !tokens?.vercel) return false;
  for (const l of textoAtualizacaoCompleta()) mostrar(l);
  if (!(await p.sim(t("Guardar os tokens cifrados para a atualização completa?", "Keep the encrypted tokens for the full update?"), false))) {
    mostrar(t("Atualização completa desligada: as funções e o painel novos pedem o passo manual (o painel mostra quando).",
      "Full update off: new functions and panel need the manual step (the panel shows when)."));
    return false;
  }
  const r = rodarCli(["atualizacao-completa", "ligar", "--stdin"], JSON.stringify({ supabase: tokens.supabase, vercel: tokens.vercel }));
  if (r.ok) ok(t("atualização completa ligada (tokens cifrados com a chave do cofre)", "full update on (tokens encrypted with the vault key)"));
  else nao(t(`não liguei a atualização completa: ${(r.erro || r.saida).trim().slice(-200)}`, `could not turn on the full update: ${(r.erro || r.saida).trim().slice(-200)}`));
  return r.ok;
}

/** Lê toda a entrada padrão (os tokens da publicação, que o agente manda por ela). */
function lerEntrada() {
  return new Promise((resolve, reject) => {
    let d = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (x) => { d += x; if (d.length > 64 * 1024) reject(new Error("entrada grande demais")); });
    process.stdin.on("end", () => resolve(d));
    process.stdin.on("error", reject);
  });
}

/** As partes de --partes (funcoes, painel): só essas duas, e pelo menos uma. */
export function lerPartes(v) {
  const lista = String(v ?? "funcoes,painel").split(",").map((x) => x.trim()).filter(Boolean);
  if (!lista.length || lista.some((x) => x !== "funcoes" && x !== "painel")) throw new Error("--partes: funcoes, painel ou os dois");
  return { funcoes: lista.includes("funcoes"), painel: lista.includes("painel") };
}

/**
 * Publicar as funções da nuvem e o painel desta versão (o agente chama, no computador que pegou a vez, com a atualização
 * completa ligada). O mesmo caminho do instalador: provisionar (as migrações já entraram pela própria nuvem; o plano sai
 * vazio) e o painel compilado nesta máquina e publicado na Vercel da pessoa. A nuvem vem antes: só publica a versão em
 * que ela já está. Os dados do painel vêm da configuração da nuvem (painel_publicacao).
 */
async function publicarNuvem(ctx, a) {
  titulo(t(`Publicar as funções da nuvem e o painel da ${VERSAO}`, `Publish the cloud functions and the panel of ${VERSAO}`));
  if (process.stdin.isTTY) throw new Error(t("uso interno: os tokens chegam pela entrada padrão", "internal use: the tokens come through standard input"));
  const ref = a.valores["--ref"];
  if (!/^[a-z0-9]{20}$/.test(ref || "")) throw new Error(t("projeto do Supabase inválido (--ref)", "invalid Supabase project (--ref)"));
  const partes = lerPartes(a.valores["--partes"]);
  let tokens;
  try {
    tokens = JSON.parse(await lerEntrada());
  } catch {
    throw new Error(t("os tokens não chegaram pela entrada padrão", "the tokens did not arrive through standard input"));
  }
  if (typeof tokens?.supabase !== "string" || !tokens.supabase || typeof tokens?.vercel !== "string" || !tokens.vercel) {
    throw new Error(t("faltam os tokens do Supabase e da Vercel", "the Supabase and Vercel tokens are missing"));
  }
  const soltar = travarPublicacao(path.join(BASE, "publicando.json"));
  // código 75 (EX_TEMPFAIL): o agente entende "espere", não "falhou" (a primeira publicação segue e conta o resultado)
  if (!soltar) throw Object.assign(new Error(t("já há uma publicação em andamento neste computador", "a publication is already running on this computer")), { codigoSaida: 75 });
  try {
    await publicarComTokens(ctx, ref, partes, tokens);
  } finally {
    soltar();
  }
}

async function publicarComTokens(ctx, ref, partes, tokens) {
  ctx.gerencia = new Gerencia(tokens.supabase);
  ctx.ref = ref;
  const c = await lerPublicacao(consultar(ctx));
  if (c.versao !== VERSAO) {
    throw new Error(t(`a nuvem está na ${c.versao ?? "versão desconhecida"} e esta publicação é da ${VERSAO}: a nuvem se atualiza antes`,
      `the cloud is on ${c.versao ?? "an unknown version"} and this publication is ${VERSAO}: the cloud updates first`));
  }
  if (!c.painel?.url || !c.painel?.projeto) {
    throw new Error(t("a nuvem não tem os dados do painel: rode uma vez o instalador com --atualizar no computador que criou a instalação",
      "the cloud lacks the panel data: run the installer with --atualizar once on the computer that created the installation"));
  }
  ctx.url = `https://${ref}.supabase.co`;
  ctx.siteProvisorio = c.painel.url;
  ctx.vapidPublica = c.painel.vapid;
  if (partes.funcoes) {
    const r = await provisionar({ gerencia: ctx.gerencia, ref, site: c.painel.url, admin: null, computador: false, log: info });
    ctx.anon = r.anon;
    ok(t("funções da nuvem publicadas", "cloud functions published"));
  } else {
    ctx.anon = (await ctx.gerencia.chaves(ref)).anon;
    if (!ctx.anon) throw new Error(t("não consegui ler a chave pública do projeto", "could not read the project's public key"));
  }
  if (partes.painel) {
    ctx.vercel = new Vercel(tokens.vercel, { equipe: c.painel.equipe });
    ctx.projetoVercel = c.painel.projeto;
    ctx.equipe = c.painel.equipe;
    ctx.dominio = c.painel.dominio;
    ctx.inst = { painel: { url: c.painel.url, urlVercel: c.painel.urlVercel, projeto: c.painel.projeto, equipe: c.painel.equipe, dominio: c.painel.dominio } };
    await painel(ctx);
  }
  await registrarPublicacao(consultar(ctx), { versao: VERSAO, funcoes: partes.funcoes, painel: partes.painel, publicacao: partes.painel ? publicacaoDe(ctx) : null });
  ok(t(`publicado: ${[partes.funcoes && "funções", partes.painel && "painel"].filter(Boolean).join(" e ")} da ${VERSAO}`,
    `published: ${[partes.funcoes && "functions", partes.painel && "panel"].filter(Boolean).join(" and ")} of ${VERSAO}`));
}

async function contas(ctx) {
  titulo(t("Contas", "Accounts"));
  const atual = emailDoClaude();
  atual ? ok(t(`conta em uso no Claude Code: ${atual} (o agente adota sozinho)`, `account in use in Claude Code: ${atual} (the agent adopts it)`))
    : nao(t("nenhuma conta conectada no Claude Code ainda", "no account connected in Claude Code yet"));
  if (ctx.sombra || ctx.semServico || !ctx.temClaude || ctx.semPerguntas) {
    info(t("Para conectar outra conta depois: reveza contas conectar <e-mail> (ou pelo painel).", "To connect another account later: reveza contas conectar <e-mail> (or from the panel)."));
    return;
  }
  for (;;) {
    const email = (await ctx.p.perguntar(t("Mais uma conta do Claude para revezar? Digite o e-mail (Enter para seguir)", "One more Claude account to rotate? Type its e-mail (Enter to continue)"), "")).toLowerCase();
    if (!email) break;
    if (!emailValido(email)) { nao(t("e-mail inválido", "invalid e-mail")); continue; }
    info(t("O navegador abre o login oficial: entre com ESTA conta.", "The browser opens the official login: sign in with THIS account."));
    reveza(ctx, ["contas", "conectar", email], true);
  }
}

async function alertas(ctx) {
  titulo(t("Alertas", "Alerts"));
  if (!ctx.adminId || ctx.semPerguntas) return info(t("Canais de alerta: no painel, em Alertas.", "Alert channels: in the panel, under Alerts."));
  // o ntfy saiu dos canais (12/10/2026); a notificação no celular se liga no próprio painel, em Alertas
  const canais = ["telegram", "email", "webhook"];
  const i = await ctx.p.escolha(t("Onde receber os alertas (conta sem folga, login vencendo, computador parado)", "Where to get alerts (no free account, login expiring, computer stopped)"), [
    "Telegram", t("e-mail (Resend)", "e-mail (Resend)"), t("webhook (n8n, Make, script)", "webhook (n8n, Make, script)"),
    t("agora não (dá para fazer no painel, inclusive a notificação no celular)", "not now (can be done in the panel, including phone notifications)"),
  ], 4);
  if (i === 3) return;
  const canal = canais[i];
  let destino = {};
  let segredo = "";
  if (canal === "telegram") {
    info(t("1) No Telegram, fale com @BotFather, mande /newbot e copie o token.", "1) In Telegram, talk to @BotFather, send /newbot and copy the token."));
    segredo = await ctx.p.segredo(t("Token do bot (o que o @BotFather mostrou):", "Bot token (the one @BotFather showed):"));
    info(t("2) Abra o seu bot e mande qualquer mensagem (ex.: oi).", "2) Open your bot and send any message (e.g. hi)."));
    await ctx.p.perguntar(t("Enter quando tiver mandado", "Enter when sent"), "");
    const chats = await acharChatTelegram(segredo).catch((e) => { nao(e.message); return []; });
    if (!chats.length) return nao(t("não achei a conversa: configure depois no painel", "conversation not found: set it up later in the panel"));
    // mesmo com uma conversa só, confirma pelo nome: quem mandou mensagem ao bot antes da pessoa receberia os alertas
    const c = chats.length === 1 ? 0 : await ctx.p.escolha(t("Conversa", "Chat"), chats.map((x) => x.nome), 1);
    if (chats.length === 1 && !(await ctx.p.sim(t(`Mandar os alertas para "${chats[0].nome}"?`, `Send alerts to "${chats[0].nome}"?`), true))) {
      return nao(t("conversa não confirmada: configure depois no painel", "chat not confirmed: set it up later in the panel"));
    }
    destino = { chat_id: chats[c].id };
  } else if (canal === "email") {
    segredo = ctx.resendChave || (await ctx.p.segredo(t("Chave da API do Resend (resend.com/api-keys):", "Resend API key (resend.com/api-keys):")));
    destino = { de: await ctx.p.perguntar(t("Remetente (domínio verificado no Resend)", "Sender (domain verified in Resend)"), ctx.smtp?.remetente || ""), para: await ctx.p.perguntar(t("Para", "To"), ctx.admin?.email || "") };
  } else {
    destino = { url: await ctx.p.perguntar(t("Endereço https do webhook", "Webhook https address"), "") };
    segredo = segredoWebhook();
  }
  const r = await testar(canal, destino, segredo);
  if (!r.ok) return nao(t(`o teste não chegou (${r.erro}): configure no painel, em Alertas`, `the test did not arrive (${r.erro}): set it up in the panel, under Alerts`));
  ok(t("mensagem de teste enviada", "test message sent"));
  await salvarAlerta(consultar(ctx), ctx.adminId, { canal, destino, segredo });
  ok(t("canal salvo (o segredo fica no cofre do Supabase)", "channel saved (the secret stays in the Supabase vault)"));
  if (canal === "webhook") info(t(`Segredo da assinatura (cabeçalho X-Reveza-Assinatura, HMAC-SHA256): ${segredo}  Guarde agora: não aparece de novo.`,
    `Signature secret (X-Reveza-Assinatura header, HMAC-SHA256): ${segredo}  Save it now: it is not shown again.`));
}

/** O estado do agente que está rodando (`reveza status --json`), ou null. */
function estadoDoAgente(ctx) {
  const r = reveza(ctx, ["status", "--json", ...(ctx.sombra ? ["--sombra"] : [])]);
  try {
    const e = JSON.parse(r.saida);
    return e && !e.parado ? e : null;
  } catch {
    return null;
  }
}

async function prova(ctx) {
  titulo(t("Prova final", "Final check"));
  // o serviço acabou de subir: dá até 15 s para a ponte local responder antes do doctor
  for (let i = 0; i < 15 && !ctx.semServico && !(await portaOcupada(ctx.sombra ? 7789 : 7788)); i++) await new Promise((r) => setTimeout(r, 1000));
  // a conta que a nuvem mandou chega na primeira busca do agente: espera ela (até 60 s) antes de conferir
  if (!ctx.semServico) {
    const e = await esperarConta(() => estadoDoAgente(ctx));
    if (e.esperou) {
      (e.chegou ? ok : nao)(e.chegou ? t(`a conta que a nuvem mandou chegou ao assistente (${e.esperou} s)`, `the account the cloud assigned reached the assistant (${e.esperou} s)`)
        : t(`a conta que a nuvem mandou não chegou em ${e.esperou} s: o doctor abaixo diz o que fazer`, `the account the cloud assigned did not arrive in ${e.esperou} s: the doctor below says what to do`));
    }
  }
  // a prova só confere (--so-ver): consertar aqui esconderia o que a instalação deixou de fazer
  reveza(ctx, ["doctor", "--so-ver", ...(ctx.sombra ? ["--sombra"] : [])], true);
  if (!ctx.gerencia || ctx.semServico || !ctx.emailComputador) return;
  let pc = null;
  for (let i = 0; i < 15 && !pc; i++) {
    pc = await computadorDoEmail(consultar(ctx), ctx.emailComputador);
    if (!pc) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!pc) return nao(t("o computador ainda não apareceu na nuvem (o agente busca a cada 5 s): confira com reveza doctor", "this computer has not shown up in the cloud yet (the agent polls every 5 s): check with reveza doctor"));
  ok(t("este computador apareceu na nuvem", "this computer showed up in the cloud"));
  if (ctx.sombra || !ctx.adminId) return;
  const id = await pedirComando(consultar(ctx), ctx.adminId, pc, "atualizar");
  const e = await esperarComando(consultar(ctx), id);
  e && e.estado === "feito" ? ok(t("um comando do painel chegou a este computador e voltou", "a panel command reached this computer and came back"))
    : nao(t("o comando de teste não voltou a tempo: confira em Saúde, no painel", "the test command did not come back in time: check Health in the panel"));
}

// ── modos especiais ───────────────────────────────────────────────────────────
async function demo(ctx) {
  titulo(t("Painel em modo demonstração (dados de exemplo, nada é instalado)", "Panel in demo mode (sample data, nothing is installed)"));
  prepararPasta(RAIZ, BUILD);
  let r = rodar(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps"], { cwd: BUILD, mostrar: true });
  if (!r.ok) throw new Error("npm ci");
  if (!ctx.semReactBits) rodar(process.execPath, ["scripts/baixar-react-bits.mjs"], { cwd: BUILD, mostrar: true });
  info(t("Abrindo http://localhost:5173/?demo=1 (Ctrl+C para sair)", "Opening http://localhost:5173/?demo=1 (Ctrl+C to quit)"));
  rodar(npm, ["run", "dev", "--", "--open", "/?demo=1"], { cwd: BUILD, mostrar: true });
}

async function doctor(ctx) {
  titulo(t("Conferência da instalação", "Installation check"));
  if (!ctx.inst) return nao(t("nada instalado ainda", "nothing installed yet"));
  ctx.cli = path.join(ctx.inst.app, "agente", "dist", "src", "cli.js");
  reveza(ctx, ["doctor", ...(ctx.inst.sombra ? ["--sombra"] : [])], true);
  if (ctx.inst.nuvem?.url) {
    const r = await fetch(`${ctx.inst.nuvem.url}/auth/v1/health`, { headers: { apikey: ctx.inst.nuvem.anon } }).catch(() => null);
    r && r.ok ? ok(t("nuvem responde", "cloud answers")) : nao(t("a nuvem não respondeu", "the cloud did not answer"));
  }
  if (ctx.inst.painel?.url) {
    const r = await fetch(ctx.inst.painel.url, { redirect: "manual" }).catch(() => null);
    if (!r) return nao(t("o painel não respondeu", "the panel did not answer"));
    const faltam = ["content-security-policy", "strict-transport-security", "permissions-policy"].filter((h) => !r.headers.get(h));
    r.status < 400 ? ok(t(`painel responde (${r.status})`, `panel answers (${r.status})`)) : nao(t(`painel respondeu ${r.status}`, `panel answered ${r.status}`));
    faltam.length ? nao(t(`cabeçalhos de segurança faltando: ${faltam.join(", ")}`, `missing security headers: ${faltam.join(", ")}`)) : ok(t("cabeçalhos de segurança no lugar", "security headers in place"));
  }
}

async function desinstalar(ctx) {
  titulo(t("Desinstalar", "Uninstall"));
  if (ctx.inst) {
    ctx.cli = path.join(ctx.inst.app, "agente", "dist", "src", "cli.js");
    if (existsSync(ctx.cli)) {
      const r = reveza(ctx, ["servico", "remover"]);
      r.ok ? ok(r.saida.trim()) : nao(r.erro.trim());
    }
  }
  removerMod() ? ok(t("mod removido", "mod removed")) : nao(t("o mod não estava instalado", "the mod was not installed"));
  console.log("");
  info(t(`Ficaram: ${BASE} (os logins de cada conta, uso, estado), o projeto no Supabase e o projeto na Vercel.`, `Kept: ${BASE} (each account's login, usage, state), the Supabase project and the Vercel project.`));
  // a auditoria de 11/10/2026 notou que a mensagem calava o que fica com poder: a chave do cofre e o computador ativo
  info(t("A chave do cofre e a senha deste computador ficam no chaveiro do sistema (\"Reveza AI\"), e o computador segue ativo na nuvem.",
    "The vault key and this computer's password stay in the system keychain (\"Reveza AI\"), and the computer stays active in the cloud."));
  if (ctx.inst?.nuvem) {
    info(t("Se este computador sai de vez: no painel, Computadores → Revogar; depois apague a pasta acima e os itens \"Reveza AI\" do chaveiro.",
      "If this computer is leaving for good: in the panel, Computers → Revoke; then delete the folder above and the \"Reveza AI\" keychain items."));
  }
  info(t("A conta em uso no Claude Code continua conectada.", "The account in use in Claude Code stays connected."));
}

/**
 * Código de acesso que o painel mostra em Computadores → Ligar computador novo (rvzc_, desde a 0.2.0): o endereço da
 * nuvem, a chave pública e o e-mail e a senha da identidade PENDENTE do computador novo. Não abre o cofre: só deixa
 * este computador pedir para entrar (a chave do cofre vem cifrada para ele depois que a pessoa digita, num computador
 * que já usa o Reveza, o código que aparece aqui). Os de antes (rvzl_, que levava a frase do cofre, e rvzpc_) não
 * valem mais: voltam marcados como antigos, para a mensagem pedir um código novo.
 */
export function lerCodigoDeAcesso(codigo) {
  const m = /^(rvzc|rvzpc|rvzl)_([A-Za-z0-9_-]+)$/.exec(String(codigo || "").trim());
  if (!m) return null;
  if (m[1] !== "rvzc") return { antigo: true };
  try {
    const a = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
    if (!a || ![a.u, a.k, a.e, a.s].every((x) => typeof x === "string" && x)) return null;
    return { url: a.u, anon: a.k, email: a.e, senha: a.s };
  } catch {
    return null;
  }
}

async function ligar(ctx) {
  titulo(t("Ligar este computador a uma instalação que já existe", "Join this computer to an existing installation"));
  info(t("No painel: Computadores → Ligar computador novo. Cole aqui o código de acesso (rvzc_...).",
    "In the panel: Computers → Link new computer. Paste the access code (rvzc_...) here."));
  info(t("Ele só deixa este computador PEDIR para entrar: não abre o cofre. Depois aparece aqui um código de 12 caracteres para digitar no computador que já usa o Reveza.",
    "It only lets this computer ASK to join: it does not open the vault. Then a 12-character code shows up here, to type on the computer that already uses Reveza."));
  const codigo = await ctx.p.segredo(t("Código de acesso:", "Access code:"), "REVEZA_CODIGO");
  const doCodigo = lerCodigoDeAcesso(codigo);
  if (doCodigo?.antigo) {
    throw new Error(t("este código é de uma versão antiga do painel (levava a frase do cofre) e não vale mais: gere um código novo no painel (Computadores → Ligar computador novo)",
      "this code comes from an old panel version (it carried the vault phrase) and is no longer accepted: generate a new code in the panel (Computers → Link new computer)"));
  }
  if (codigo && !doCodigo) throw new Error(t("código de acesso inválido (copie de novo do painel)", "invalid access code (copy it again from the panel)"));
  const url = doCodigo?.url ?? (await ctx.p.perguntar(t("Endereço da nuvem (https://....supabase.co)", "Cloud address (https://....supabase.co)"), process.env.REVEZA_URL || ""));
  const anon = doCodigo?.anon ?? (await ctx.p.perguntar(t("Chave pública", "Public key"), process.env.REVEZA_CHAVE_PUBLICA || ""));
  const email = doCodigo?.email ?? (await ctx.p.perguntar(t("E-mail do computador", "Computer e-mail"), process.env.REVEZA_EMAIL_COMPUTADOR || ""));
  const senha = doCodigo?.senha ?? (await ctx.p.segredo(t("Senha do computador:", "Computer password:"), "REVEZA_SENHA"));
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || !anon || !emailValido(email) || !senha) throw new Error(t("dados incompletos", "incomplete data"));
  const e = reveza(ctx, ["nuvem", "entrar", "--url", url, "--chave-publica", anon, "--email", email], false, { REVEZA_SENHA: senha });
  if (!e.ok) throw new Error(e.erro.slice(-300));
  ok(t("identidade guardada no chaveiro do sistema", "identity stored in the system keychain"));
  // o computador novo pede para entrar: mostra o código aqui e espera a chave do cofre chegar cifrada para ele
  const l = reveza(ctx, ["ligar", "--idioma", t("pt-BR", "en")], true);
  if (!l.ok) throw new Error(t("a chave do cofre não chegou (veja a mensagem acima): gere outro código no painel e rode de novo",
    "the vault key did not arrive (see the message above): generate another code in the panel and run again"));
  ok(t("chave do cofre recebida (cifrada só para este computador)", "vault key received (encrypted for this computer only)"));
  ctx.ligado = { url, anon };
}

/**
 * Atualização só do programa deste computador, sem perguntar token nenhum: computador que entrou numa instalação pelo
 * código do painel (a nuvem dele não tem `ref`) não cuida da nuvem nem do painel, quem cuida é o computador que criou a
 * instalação. Antes ele pedia o token do Supabase (12/10/2026, MacBook do Paulo).
 */
export function soEsteComputador(inst, atualizar) {
  return !!atualizar && !!inst?.nuvem && !inst.nuvem.ref;
}

/** O que vai no instalacao.json, com o que a instalação já sabe (gravado depois do serviço e de novo no fim). */
export function dadosDaInstalacao(ctx, inst) {
  return {
    versao: VERSAO, app: ctx.app, sombra: !!ctx.sombra, semServico: !!ctx.semServico, atualizadoEm: new Date().toISOString(),
    instaladoEm: inst?.instaladoEm || new Date().toISOString(),
    nuvem: ctx.url ? { ref: ctx.ref, url: ctx.url, anon: ctx.anon, adminId: ctx.adminId, vapidPublica: ctx.vapidPublica } : ctx.ligado || inst?.nuvem || null,
    painel: ctx.site ? { url: ctx.site, urlVercel: ctx.urlVercel, projeto: ctx.projetoVercel, equipe: ctx.equipe, dominio: ctx.dominio || null } : inst?.painel || null,
  };
}

/**
 * Instalação existente sem nuvem continua sem nuvem numa atualização ou sem perguntas (--com-nuvem liga a nuvem).
 */
export function semNuvemPrevisto({ inst, semNuvem, comNuvem, atualizar, semPerguntas }) {
  return !!semNuvem || (!!inst && !inst.nuvem && !comNuvem && (!!atualizar || !!semPerguntas));
}

/**
 * O computador em que o Reveza roda e não há instalacao.json: até a 0.6.0 ele só era gravado no último passo, e uma
 * instalação que parava depois do serviço deixava o --atualizar recusando para sempre (WSL, 13/10/2026). Quem
 * reconhece é o instalador novo, que todo agente antigo chama no Atualizar do painel: nenhuma versão fica presa.
 * O sinal de que o Reveza rodou aqui é o ponte.json (o agente grava ao subir, desde a 0.1.0); a pasta do programa vem
 * do comando reveza (aponta para o cli.js instalado, também com --pasta) ou da pasta padrão. Serviço e nuvem se
 * completam depois, perguntando ao programa novo (completarRecuperada).
 */
export function instalacaoNoDisco({ base, bin, padrao = path.join(base, "app"), ler = (f) => readFileSync(f, "utf8"), haArquivo = existsSync }) {
  let ponte;
  try { ponte = JSON.parse(ler(path.join(base, "ponte.json"))); } catch { return null; }
  if (!ponte || typeof ponte !== "object") return null;
  const candidatas = [];
  for (const nome of ["reveza", "reveza.cmd"]) {
    try {
      const cli = /"([^"]+cli\.js)"/.exec(ler(path.join(bin, nome)))?.[1];
      const app = cli?.replace(/[\\/]agente[\\/]dist[\\/]src[\\/]cli\.js$/, "");
      if (app && app !== cli) candidatas.push(app);
    } catch { /* sem esse lançador */ }
  }
  candidatas.push(padrao);
  const app = candidatas.find((a) => haArquivo(path.join(a, "agente", "dist", "src", "cli.js")));
  if (!app) return null;
  return { app, sombra: ponte.sombra === true, semServico: false, nuvem: null, painel: null, recuperada: true };
}

/**
 * O que a instalação reconhecida no disco não sabia, respondido pelo programa novo (`servico status --json` e
 * `nuvem identidade`). O serviço só conta se o gerenciador responde: no WSL sem systemd a unidade existe no disco e
 * nunca roda, e instalar o serviço ali faria a atualização voltar atrás depois de 30 s. O modo sombra sai do serviço,
 * a não ser que a conferência já tenha decidido. Sem resposta, fica o que já se sabia.
 */
export function completarRecuperada(inst, { servico, identidade } = {}, { semServico = false, sombra = false, sombraDecidida = false } = {}) {
  const temServico = servico?.instalado === true && servico.gerenciador !== false;
  return {
    ...inst,
    semServico: semServico || !temServico,
    sombra: !sombraDecidida && temServico && typeof servico.sombra === "boolean" ? servico.sombra : sombra,
    nuvem: identidade?.url && identidade?.chavePublica ? { url: identidade.url, anon: identidade.chavePublica } : inst.nuvem,
  };
}

// ── principal ─────────────────────────────────────────────────────────────────
async function main() {
  const a = lerArgs(process.argv.slice(2));
  if (a.erro) {
    console.error(`${a.erro}\n\n${uso()}`);
    process.exit(2);
  }
  const tem = (f) => a.flags.has(f);
  usarIdioma(a.valores["--idioma"] || "pt");
  if (tem("--versao")) return console.log(VERSAO);
  if (tem("--ajuda") || tem("--help") || tem("-h")) return console.log(`Reveza AI ${VERSAO}\n\n${uso()}`);
  console.log(`\n${verde("◆ Reveza AI")} ${fraco(`v${VERSAO}`)}  ${fraco(t("gestor de contas do assistente de código", "account manager for your coding assistant"))}`);

  let inst = lerInstalacao(ARQ_INST);
  const semPerguntas = tem("--sim") || !process.stdin.isTTY;
  let pedidoDeDominio;
  try {
    pedidoDeDominio = dominioPedido(a.valores["--dominio"], process.env);
  } catch (e) {
    console.error(`\n  ${t("Parei", "Stopped")}: ${e.message}\n`);
    process.exit(2);
  }
  const ctx = {
    inst, semPerguntas, p: perguntador({ semPerguntas }),
    app: a.valores["--pasta"] ? path.resolve(a.valores["--pasta"]) : inst?.app || path.join(BASE, "app"),
    atualizar: tem("--atualizar"), sombra: tem("--sombra") || !!inst?.sombra, forcarSombra: tem("--sombra"), sairDaSombra: tem("--sair-da-sombra"),
    importar: a.valores["--importar"],
    semNuvem: semNuvemPrevisto({ inst, semNuvem: tem("--sem-nuvem"), comNuvem: tem("--com-nuvem"), atualizar: tem("--atualizar"), semPerguntas }),
    nuvemNova: !inst?.nuvem, semServico: tem("--sem-servico"), semReactBits: tem("--sem-react-bits"),
    dominioPedido: pedidoDeDominio,
  };
  try {
    if (tem("--publicar-nuvem")) return await publicarNuvem({ ...ctx, semPerguntas: true }, a);
    if (tem("--demo")) return await demo(ctx);
    if (tem("--doctor")) return await doctor(ctx);
    if (tem("--desinstalar")) return await desinstalar(ctx);
    if (ctx.atualizar && !inst && !tem("--ligar")) {
      inst = instalacaoNoDisco({ base: BASE, bin: BIN });
      if (!inst) throw new Error(t("não há instalação para atualizar: rode sem --atualizar", "nothing to update: run without --atualizar"));
      ctx.inst = inst;
      if (!a.valores["--pasta"]) ctx.app = inst.app;
      ctx.sombra = tem("--sombra") || inst.sombra;
      ctx.semNuvem = semNuvemPrevisto({ inst, semNuvem: tem("--sem-nuvem"), comNuvem: tem("--com-nuvem"), atualizar: true, semPerguntas });
      info(t(`O Reveza roda neste computador, mas falta o instalacao.json (instalação que parou no meio): reconheci o programa em ${inst.app} e sigo com a atualização.`,
        `Reveza runs on this computer, but instalacao.json is missing (an installation that stopped halfway): found the program in ${inst.app}, updating it.`));
    } else if (ctx.atualizar && !inst) throw new Error(t("não há instalação para atualizar: rode sem --atualizar", "nothing to update: run without --atualizar"));
    // computador novo: entra numa instalação que já existe (código do painel) ou cria uma nova
    ctx.ligar = tem("--ligar") || (!inst && /^rvz(c|l|pc)_/.test(process.env.REVEZA_CODIGO || ""));
    if (!inst && !ctx.ligar && !ctx.atualizar && !ctx.importar && !tem("--com-nuvem") && !tem("--sem-nuvem") && !ctx.semPerguntas) {
      const i = await ctx.p.escolha(t("Este computador", "This computer"), [
        t("vai entrar numa instalação que já existe (tenho o código do painel)", "joins an existing installation (I have the panel code)"),
        t("cria uma instalação nova (primeiro computador)", "creates a new installation (first computer)"),
      ], 2);
      ctx.ligar = i === 0;
    }
    if (!ctx.atualizar && inst && !ctx.ligar) {
      ctx.atualizar = await ctx.p.sim(t("Já existe uma instalação aqui. Atualizar (mantém contas, uso e configuração)?", "There is already an installation here. Update it (keeps accounts, usage and settings)?"), true);
      if (!ctx.atualizar) throw new Error(t("para instalar do zero, use --desinstalar antes", "to install from scratch, run --desinstalar first"));
    }

    ctx.soEsteComputador = soEsteComputador(inst, ctx.atualizar);
    ctx.manterNuvem = manterNuvemPrevisto({ atualizar: ctx.atualizar, temNuvem: !!inst?.nuvem, semPerguntas: ctx.semPerguntas,
      tokenNoAmbiente: !!process.env.SUPABASE_ACCESS_TOKEN });
    const planejar = () => { ctx.etapas = etapasDoCaminho(ctx); };
    const etapa = (id) => numerarProximoTitulo(numeroDaEtapa(ctx.etapas, id));
    planejar();

    const sombraAntes = ctx.sombra;
    etapa("conferir");
    await conferir(ctx);
    const sombraDecidida = ctx.forcarSombra || ctx.sairDaSombra || ctx.sombra !== sombraAntes;
    if (inst) {
      // antes de mexer em qualquer coisa: cópia conferida do estado (contas, logins, uso, configuração, identidade)
      ctx.copia = copiarEstado(BASE, `antes-${VERSAO}`);
      ok(t(`cópia do estado antes de atualizar: ${ctx.copia}`, `state copy before updating: ${ctx.copia}`));
    }
    etapa("programa");
    await programa(ctx);
    if (inst?.recuperada) {
      // o programa novo responde o que o instalacao.json diria: se há serviço (e o gerenciador funciona), sombra e nuvem
      const json = (args) => { try { return JSON.parse(reveza(ctx, args).saida.trim().split("\n").pop()); } catch { return undefined; } };
      const servicoAtual = json(["servico", "status", "--json"]);
      Object.assign(inst, completarRecuperada(inst, { servico: servicoAtual, identidade: json(["nuvem", "identidade"]) },
        { semServico: ctx.semServico, sombra: ctx.sombra, sombraDecidida }));
      ctx.semServico = inst.semServico;
      ctx.sombra = inst.sombra;
      ctx.semNuvem = semNuvemPrevisto({ inst, semNuvem: tem("--sem-nuvem"), comNuvem: tem("--com-nuvem"), atualizar: true, semPerguntas: ctx.semPerguntas });
      ctx.nuvemNova = !inst.nuvem;
      ctx.soEsteComputador = soEsteComputador(inst, ctx.atualizar);
      ctx.manterNuvem = manterNuvemPrevisto({ atualizar: ctx.atualizar, temNuvem: !!inst.nuvem, semPerguntas: ctx.semPerguntas,
        tokenNoAmbiente: !!process.env.SUPABASE_ACCESS_TOKEN });
      planejar();
      if (servicoAtual?.instalado && servicoAtual.gerenciador === false) {
        nao(t("o serviço está no disco, mas o gerenciador de serviços não responde (WSL sem systemd?): sigo sem serviço",
          "the service is on disk, but the service manager does not answer (WSL without systemd?): continuing without a service"));
      }
      ok(t(`instalação reconhecida: ${inst.semServico ? "sem serviço" : "com serviço"}${inst.sombra ? ", modo sombra" : ""}, ${inst.nuvem ? "ligada à nuvem" : "sem nuvem"}`,
        `installation recognized: ${inst.semServico ? "no service" : "with service"}${inst.sombra ? ", shadow mode" : ""}, ${inst.nuvem ? "joined to the cloud" : "no cloud"}`));
    }
    if (ctx.ligar) {
      etapa("ligar");
      await ligar(ctx);
    } else if (ctx.importar) info(t("Troca: fica a configuração importada (ajuste no painel).", "Switching: the imported settings stay (adjust in the panel)."));
    ctx.troca = trocaInicial(ctx);
    if (ctx.soEsteComputador) {
      info(t("Computador ligado a uma instalação: atualizo só o programa deste computador. A nuvem se atualiza pelo painel (Atualizar a nuvem); funções e painel, pela atualização completa ou no computador que criou a instalação.",
        "Computer joined to an installation: only this computer's program is updated. The cloud updates from the panel (Update the cloud); functions and panel, through the full update or on the computer that created the installation."));
      if (ctx.dominioPedido !== undefined) nao(t("--dominio vale no computador que criou a instalação (ele tem os dados do projeto e pede os tokens)", "--dominio applies on the computer that created the installation (it has the project data and asks for the tokens)"));
    } else if (!ctx.semNuvem && !ctx.ligar) {
      ctx.manterNuvem = false;
      etapa("nuvem");
      await nuvem(ctx);
      // sem token numa atualização, a nuvem e o painel ficam como estão: as etapas seguintes saem com o total novo
      planejar();
      if (!ctx.manterNuvem) {
        await perguntarPainel(ctx);
        await aplicarNuvem(ctx);
      }
    } else if (ctx.troca) {
      gravarConfigLocal(path.join(BASE, "estado.json"), { auto: ctx.troca.auto, modo: ctx.troca.modo, aviso: ctx.troca.aviso, troca: ctx.troca.troca });
      ok(`${descreverTroca(ctx.troca)}${t(", neste computador (com --com-nuvem ela passa para o painel)", ", on this computer (with --com-nuvem it moves to the panel)")}`);
    }
    etapa("servico");
    await servico(ctx);
    // o agente já está de pé: a instalação passa a existir agora, não só no último passo. Antes, uma instalação que
    // parava daqui em diante (painel, contas, alertas, uma pergunta fechada no meio) deixava o computador funcionando e
    // sem o instalacao.json, e o --atualizar recusava para sempre ("não há instalação para atualizar", 13/10/2026)
    gravarInstalacao(ARQ_INST, dadosDaInstalacao(ctx, inst));
    if (ctx.atualizar && !ctx.semServico) await conferirSubiu(ctx);
    if (ctx.gerencia && ctx.vercel) {
      etapa("painel");
      await painel(ctx);
      // o que está no ar e os dados do painel: qualquer computador da instalação passa a conseguir publicar
      try {
        await registrarPublicacao(consultar(ctx), { versao: VERSAO, publicacao: publicacaoDe(ctx) });
      } catch (e) {
        nao(t(`não registrei na nuvem o que está no ar (${e.message}): o painel pode pedir o passo manual na próxima versão`,
          `could not record in the cloud what is online (${e.message}): the panel may ask for the manual step on the next version`));
      }
    }
    // computador ligado: as contas vêm da nuvem (o cofre), nada para conectar aqui
    if (!ctx.atualizar && !ctx.ligar) {
      etapa("contas");
      await contas(ctx);
    }
    if (ctx.nuvemNova && ctx.gerencia) {
      etapa("alertas");
      await alertas(ctx);
    }
    // a oferta da atualização completa (padrão não), com os tokens que esta instalação acabou de usar
    const completa = ctx.gerencia && ctx.vercel ? await atualizacaoCompletaLigada(consultar(ctx)) : false;
    if (completa) info(t("Atualização completa ligada: as funções e o painel novos vão sozinhos (reveza atualizacao-completa status).",
      "Full update on: new functions and panel go by themselves (reveza atualizacao-completa status)."));
    else if (ctx.gerencia && ctx.vercel) {
      await oferecerAtualizacaoCompleta({
        p: ctx.p,
        tokens: { supabase: ctx.gerencia.token, vercel: ctx.vercel.token },
        rodarCli: (args, entrada) => rodar(process.execPath, [ctx.cli, ...args], { env: ambienteLimpo(), entrada }),
      });
    }
    ctx.p.fechar();
    etapa("prova");
    await prova(ctx);

    gravarInstalacao(ARQ_INST, dadosDaInstalacao(ctx, inst));

    titulo(t(`Pronto: Reveza AI ${VERSAO}`, `Done: Reveza AI ${VERSAO}`));
    if (ctx.site) console.log(`  ${t("Painel", "Panel")}: ${verde(ctx.site)}  ${fraco(ctx.admin ? `(${ctx.admin.email})` : "")}`);
    console.log(`  ${t("No terminal", "In the terminal")}: ${verde("reveza status")}, ${verde("reveza contas")}, ${verde("reveza uso")}, ${verde("reveza doctor")}`);
    console.log(`  ${t("Nas sessões do Claude Code", "In Claude Code sessions")}: ${verde("/reveza")}`);
    // resumo da conversa (agente/src/resumo.ts): o agente aplica na conta em uso e a cada troca
    if (!ctx.sombra) console.log(`  ${t("Resumo da conversa", "Conversation summary")}: ${t("nas contas que não são 20x, o Claude Code resume a conversa perto de 180 mil tokens (evita sessão travada e faz a conta durar mais). Mudar:", "on accounts that are not 20x, Claude Code summarizes the conversation near 180k tokens (avoids stuck sessions and makes the account last longer). Change it:")} ${verde("reveza resumo 300k")} ${t("ou", "or")} ${verde("reveza resumo desligar")}`);
    if (ctx.sombra) console.log(`  ${negrito(t("Modo sombra", "Shadow mode"))}: ${t("nada troca. Quando parar o outro gestor, rode --atualizar: ele pergunta se sai do modo sombra.", "nothing switches. After stopping the other manager, run --atualizar: it asks whether to leave shadow mode.")}`);
    console.log(fraco(t("  Cada pessoa responde pelo uso das próprias contas e pelos termos do serviço de IA que usa.\n", "  Each person is responsible for the use of their own accounts and for the terms of the AI service they use.\n")));
  } catch (e) {
    ctx.p.fechar();
    const causa = e.cause && e.cause.message ? ` (${e.cause.message})` : "";
    console.error(`\n  ${t("Parei", "Stopped")}: ${e.message}${causa}\n`);
    if (process.env.REVEZA_DEPURAR) console.error(e.stack, e.cause);
    process.exit(Number.isInteger(e.codigoSaida) ? e.codigoSaida : 1);
  }
}

const chamado = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (chamado === fileURLToPath(import.meta.url)) main();
