// Publica o painel (já compilado nesta máquina) na Vercel da pessoa, pela API REST: projeto, arquivos por hash,
// implantação de produção e domínio. Nada de chave do Supabase vai para a Vercel além da pública (já dentro do build).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { t } from "./texto.mjs";

const API = "https://api.vercel.com";

export class Vercel {
  constructor(token, { fetch: f = globalThis.fetch, equipe = null, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if (!token) throw new Error(t("falta o token da Vercel", "the Vercel token is missing"));
    this.token = token;
    this.fetch = f;
    this.equipe = equipe;
    this.esperar = esperar;
  }

  url(caminho) {
    if (!this.equipe) return API + caminho;
    return API + caminho + (caminho.includes("?") ? "&" : "?") + `teamId=${encodeURIComponent(this.equipe)}`;
  }

  async pedir(metodo, caminho, corpo, extra = {}) {
    const bruto = Buffer.isBuffer(corpo);
    const init = {
      method: metodo,
      headers: { Authorization: `Bearer ${this.token}`, ...(corpo !== undefined && !bruto ? { "Content-Type": "application/json" } : {}), ...extra },
      body: corpo === undefined ? undefined : bruto ? corpo : JSON.stringify(corpo),
    };
    // conexão que cai no meio (rede, proxy, servidor fechando a conexão ociosa): tenta de novo, sem duplicar nada,
    // porque os arquivos vão por hash e o resto é leitura ou criação que a própria API recusa em dobro
    let r;
    for (let tentativa = 0; ; tentativa++) {
      try {
        r = await this.fetch(this.url(caminho), init);
        break;
      } catch (e) {
        if (tentativa >= 2 || !/fetch failed|ECONNRESET|socket|other side closed/i.test(`${e.message} ${e.cause?.message ?? ""}`)) throw e;
        await this.esperar(500 * (tentativa + 1));
      }
    }
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!r.ok) {
      const msg = (dados && dados.error && dados.error.message) || String(texto).slice(0, 300);
      const e = new Error(`Vercel ${metodo} ${caminho.split("?")[0]}: ${r.status} ${msg}`);
      e.status = r.status;
      e.codigo = dados && dados.error && dados.error.code;
      throw e;
    }
    return dados;
  }

  async quemSou() {
    const u = await this.pedir("GET", "/v2/user");
    let equipes = [];
    try { equipes = ((await this.pedir("GET", "/v2/teams")).teams || []).map((t) => ({ id: t.id, slug: t.slug, nome: t.name })); } catch { /* token só da conta pessoal */ }
    return { usuario: u.user && (u.user.username || u.user.email), equipes, padrao: (u.user && u.user.defaultTeamId) || null };
  }

  /** Projeto pelo nome: pega o que existe ou cria (sem framework: o painel vai pronto). */
  async projeto(nome) {
    if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(nome)) throw new Error(t("nome de projeto: letras minúsculas, números e hífen", "project name: lowercase letters, numbers and hyphens"));
    try {
      const p = await this.pedir("GET", `/v9/projects/${encodeURIComponent(nome)}`);
      return { id: p.id, nome: p.name, novo: false };
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const p = await this.pedir("POST", "/v11/projects", { name: nome, framework: null });
    return { id: p.id, nome: p.name, novo: true };
  }

  /** Sobe cada arquivo pelo hash (o que a Vercel já tem não sobe de novo) e cria a implantação de produção. */
  async publicar(projeto, pasta, { log = () => {} } = {}) {
    const arquivos = listar(pasta);
    if (!arquivos.some((a) => a.arquivo === "index.html")) throw new Error(t("a pasta do painel não tem index.html (o build rodou?)", "the panel folder has no index.html (did the build run?)"));
    for (const a of arquivos) {
      const conteudo = readFileSync(path.join(pasta, a.arquivo));
      // o Content-Length sai sozinho do corpo (pôr à mão duplica o cabeçalho e o servidor fecha a conexão)
      await this.pedir("POST", "/v2/files", conteudo, { "Content-Type": "application/octet-stream", "x-vercel-digest": a.sha });
    }
    log(t(`${arquivos.length} arquivos enviados`, `${arquivos.length} files uploaded`));
    const d = await this.pedir("POST", "/v13/deployments", {
      name: projeto.nome, project: projeto.id, target: "production",
      files: arquivos.map((a) => ({ file: a.arquivo, sha: a.sha, size: a.tamanho })),
      projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, devCommand: null },
    });
    const principal = `${projeto.nome}.vercel.app`;
    let pronta = 0;
    for (let i = 0; i < 90; i++) {
      const e = await this.pedir("GET", `/v13/deployments/${encodeURIComponent(d.id)}`);
      if (e.readyState === "READY") {
        // o endereço principal do projeto pode chegar alguns segundos depois de pronta; os outros (com o nome da
        // equipe, ou o da própria implantação) costumam ficar atrás da proteção de acesso da Vercel
        const aliases = e.alias || [];
        if (aliases.includes(principal) || ++pronta > 10) {
          const alias = aliases.includes(principal) ? principal : aliases.find((x) => x.split(".")[0] === projeto.nome) || aliases[0] || e.url;
          return { id: d.id, url: `https://${alias}` };
        }
      }
      if (e.readyState === "ERROR" || e.readyState === "CANCELED") throw new Error(t(`a implantação terminou em ${e.readyState}`, `the deployment ended with status ${e.readyState}`));
      await this.esperar(2000);
    }
    throw new Error(t("a implantação não ficou pronta em 3 minutos", "the deployment was not ready after 3 minutes"));
  }

  /** Domínio próprio no projeto; devolve o registro de DNS que a pessoa cria (na Cloudflare ou onde estiver o domínio). */
  async adicionarDominio(projeto, dominio) {
    try {
      await this.pedir("POST", `/v10/projects/${encodeURIComponent(projeto.id)}/domains`, { name: dominio });
    } catch (e) {
      if (e.codigo !== "domain_already_in_use" && e.status !== 409) throw e;
      // já ligado a ESTE projeto (uma atualização anterior, ou ligado à mão): segue; em outro projeto: para
      const meu = await this.pedir("GET", `/v9/projects/${encodeURIComponent(projeto.id)}/domains/${encodeURIComponent(dominio)}`).catch(() => null);
      if (!meu && e.codigo === "domain_already_in_use") throw new Error(t(`${dominio} já está em outro projeto da Vercel`, `${dominio} is already in another Vercel project`));
    }
    return this.registroDns(dominio);
  }

  async registroDns(dominio) {
    const c = await this.pedir("GET", `/v6/domains/${encodeURIComponent(dominio)}/config`);
    const apex = dominio.split(".").length === 2;
    const cname = Array.isArray(c.recommendedCNAME) && c.recommendedCNAME.length
      ? [...c.recommendedCNAME].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0].value : "cname.vercel-dns.com";
    const ipv4 = Array.isArray(c.recommendedIPv4) && c.recommendedIPv4.length
      ? [].concat(c.recommendedIPv4.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0].value)[0] : "76.76.21.21";
    return {
      configurado: c.misconfigured === false,
      registro: apex ? { tipo: "A", nome: "@", valor: ipv4 } : { tipo: "CNAME", nome: dominio.split(".")[0], valor: cname.replace(/\.$/, "") },
    };
  }
}

/** Todos os arquivos da pasta, com caminho de barra normal, hash sha1 (o que a Vercel pede) e tamanho. */
export function listar(pasta, base = pasta) {
  const out = [];
  for (const nome of readdirSync(pasta).sort()) {
    const cheio = path.join(pasta, nome);
    const st = statSync(cheio);
    if (st.isDirectory()) out.push(...listar(cheio, base));
    else if (st.isFile()) {
      const conteudo = readFileSync(cheio);
      out.push({ arquivo: path.relative(base, cheio).split(path.sep).join("/"), sha: createHash("sha1").update(conteudo).digest("hex"), tamanho: st.size });
    }
  }
  return out;
}
