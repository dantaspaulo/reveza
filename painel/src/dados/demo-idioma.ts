// Os dados da demonstração nascem em português; em inglês, nomes, organizações, projetos, modelos e e-mails de
// exemplo viram os equivalentes. Só textos de exemplo mudam: ids e números ficam iguais.

import type { Idioma } from "./tipos"

const EXATOS: Record<string, string> = {
  Administração: "Admin",
  Financeiro: "Finance",
  instalador: "installer",
  "Empresa Exemplo": "Example Company",
  Pessoal: "Personal",
  "Cliente A": "Client A",
  Laboratório: "Lab",
  Reserva: "Backup",
  "Automação n8n": "n8n automation",
  "Script do terminal": "Terminal script",
  "loja-online": "online-store",
  "api-pagamentos": "payments-api",
  estudos: "studies",
  "app-mobile": "mobile-app",
  "site-institucional": "company-site",
  "modelo-grande": "large-model",
  "modelo-medio": "medium-model",
  "modelo-rapido": "fast-model",
  "0,3 s": "0.3 s",
  "auto = ligada": "auto = on",
  "modo = limiar": "mode = threshold",
  "Desktop · diagnostico": "Desktop · diagnostics",
  "ordem de preferência": "preference order",
  "este aparelho": "this device",
  Agência: "Agency",
  Consultoria: "Consulting",
  Suporte: "Support",
  "Atendimento ao cliente": "Customer support",
}

const EMAILS: [string, string][] = [
  ["trabalho@exemplo.com", "work@example.com"],
  ["pessoal@exemplo.com", "personal@example.com"],
  ["cliente-a@exemplo.com", "client-a@example.com"],
  ["laboratorio@exemplo.com", "lab@example.com"],
  ["reserva@exemplo.com", "backup@example.com"],
  ["admin@exemplo.com", "admin@example.com"],
  ["financeiro@exemplo.com", "finance@example.com"],
  ["equipe@exemplo.com", "team@example.com"],
  [" · leitura", " · read-only"],
  [" · diagnostico", " · diagnostics"],
  ["@exemplo.com", "@example.com"],
  ["n8n.exemplo.com", "n8n.example.com"],
  ["reveza-exemplo", "reveza-example"],
  // as pastas de exemplo (0.17.0)
  ["/loja-online", "/online-store"],
  ["/api-pagamentos", "/payments-api"],
  ["/estudos", "/studies"],
  ["/app-mobile", "/mobile-app"],
  ["/site-institucional", "/company-site"],
  ["~/agentes/suporte", "~/agents/support"],
]

export function textoDemo(s: string, idioma: Idioma): string {
  if (idioma !== "en") return s
  if (s in EXATOS) return EXATOS[s]
  let r = s
  for (const [de, para] of EMAILS) if (r.includes(de)) r = r.split(de).join(para)
  return r
}

/** Cópia profunda com os textos de exemplo no idioma pedido. */
export function localizarDemo<T>(valor: T, idioma: Idioma): T {
  if (idioma !== "en") return valor
  const andar = (v: unknown): unknown => {
    if (typeof v === "string") return textoDemo(v, idioma)
    if (Array.isArray(v)) return v.map(andar)
    if (v && typeof v === "object") {
      const r: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) r[k] = andar(x)
      return r
    }
    return v
  }
  return andar(valor) as T
}
