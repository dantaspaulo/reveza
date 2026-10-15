// Projetos do Supabase pela Management API: listar, criar e escolher a região mais perto.
import { randomBytes } from "node:crypto";
import { t } from "./texto.mjs";

/** Região sugerida pelo fuso do computador (a pessoa pode trocar). */
export function regiaoSugerida(fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "") {
  if (/^America\/(Sao_Paulo|Fortaleza|Recife|Bahia|Belem|Manaus|Cuiaba|Campo_Grande|Porto_Velho|Boa_Vista|Rio_Branco|Maceio|Araguaina|Santarem|Noronha|Argentina|Buenos_Aires|Montevideo|Santiago|Asuncion|Lima|Bogota|Caracas|La_Paz|Guayaquil)/.test(fuso)) return "sa-east-1";
  if (/^America\/(Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Edmonton|Boise)/.test(fuso)) return "us-west-1";
  if (/^America\//.test(fuso)) return "us-east-1";
  if (/^Europe\/(London|Dublin|Lisbon)/.test(fuso)) return "eu-west-2";
  if (/^(Europe|Africa)\//.test(fuso)) return "eu-central-1";
  if (/^Asia\/(Tokyo|Seoul)/.test(fuso)) return "ap-northeast-1";
  if (/^Asia\/(Kolkata|Calcutta|Karachi|Dhaka)/.test(fuso)) return "ap-south-1";
  if (/^(Asia|Australia|Pacific)\//.test(fuso)) return "ap-southeast-1";
  return "us-east-1";
}

export const REGIOES = ["sa-east-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "eu-west-1", "eu-west-2",
  "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1", "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "ap-northeast-2", "ap-east-1"];

export async function organizacoes(gerencia) {
  const lista = await gerencia.pedir("GET", "/v1/organizations");
  return (Array.isArray(lista) ? lista : []).map((o) => ({ slug: o.slug || o.id, nome: o.name }));
}

export async function projetos(gerencia) {
  const lista = await gerencia.pedir("GET", "/v1/projects");
  return (Array.isArray(lista) ? lista : []).map((p) => ({
    ref: p.ref || p.id, nome: p.name, org: p.organization_slug || p.organization_id, regiao: p.region, status: p.status,
  }));
}

/**
 * Cria o projeto. A senha do banco é aleatória e não fica guardada em lugar nenhum: o Reveza não precisa dela
 * (fala com o banco pela Management API), e a pessoa pode trocá-la no painel do Supabase quando quiser.
 */
export async function criarProjeto(gerencia, { org, nome = "reveza", regiao }) {
  if (!/^[\w-]+$/.test(org || "")) throw new Error(t("organização inválida", "invalid organization"));
  if (!REGIOES.includes(regiao)) throw new Error(t("região desconhecida", "unknown region"));
  const p = await gerencia.pedir("POST", "/v1/projects", {
    name: nome, organization_slug: org, db_pass: randomBytes(24).toString("base64url"),
    region_selection: { type: "specific", code: regiao },
  });
  const ref = p.ref || p.id;
  if (!/^[a-z0-9]{20}$/.test(ref || "")) throw new Error(t("o Supabase não devolveu o projeto criado", "Supabase did not return the created project"));
  return ref;
}

/** O token de acesso diz quem é (conta pessoal) ou recusa; token de organização não lista nem cria projeto novo. */
export async function conferirToken(gerencia) {
  try {
    await gerencia.pedir("GET", "/v1/organizations");
    return { ok: true };
  } catch (e) {
    if (e.status === 401) return { ok: false, erro: t("token recusado (confira se copiou inteiro)", "token rejected (make sure you copied all of it)") };
    if (e.status === 403) return { ok: false, erro: t("este token não pode listar organizações: use um token pessoal (Account → Access Tokens)",
      "this token cannot list organizations: use a personal token (Account → Access Tokens)") };
    throw e;
  }
}
