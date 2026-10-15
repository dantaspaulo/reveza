// A aba que o navegador tirou da memória para poupar recursos (a economia de memória do Chrome e do Edge, por exemplo)
// volta recarregada quando a pessoa clica nela. O aviso diz que nada parou e como evitar; "Entendi" não mostra mais.

import * as React from "react"
import { MoonIcon } from "lucide-react"
import { toast } from "sonner"

import { useT } from "@/i18n"

const CHAVE = "reveza-aviso-aba-descartada"

/** Avisar só quando o navegador conta que descartou a aba (document.wasDiscarded) e a pessoa ainda não disse "Entendi". */
export function precisaAvisarAba(doc: { wasDiscarded?: boolean }, guardado: Pick<Storage, "getItem"> | null): boolean {
  if (doc.wasDiscarded !== true) return false
  try {
    return guardado?.getItem(CHAVE) !== "1"
  } catch {
    return true
  }
}

function guardarEntendi() {
  try {
    localStorage.setItem(CHAVE, "1")
  } catch {
    /* sem armazenamento: o aviso volta na próxima vez que o navegador descartar a aba */
  }
}

function armazenamento(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function AvisoAbaDescartada() {
  const { t } = useT()
  React.useEffect(() => {
    if (!precisaAvisarAba(document as Document & { wasDiscarded?: boolean }, armazenamento())) return
    toast(t("app.abaDescansouTitulo"), {
      id: CHAVE,
      description: t("app.abaDescansouTexto"),
      icon: <MoonIcon className="size-4" />,
      duration: Infinity,
      action: { label: t("app.entendi"), onClick: guardarEntendi },
    })
  }, [t])
  return null
}
