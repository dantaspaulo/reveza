// Notificações deste navegador: o que ele suporta, a permissão, a inscrição de push (o aviso que chega com o painel
// fechado) e a notificação mostrada na hora. Cada falha vira um código de erros.* com o que a pessoa precisa fazer.

import { ErroPainel } from "@/dados/fonte"

/** "ios_instalar": iPhone ou iPad com o painel aberto no Safari; lá a notificação só existe no app da tela inicial. */
export type Suporte = "ok" | "ios_instalar" | "sem_suporte"

export function ehIos(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  // o iPad se apresenta como Mac; o que o entrega é a tela de toque
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
}

export function abertoComoApp(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

function semSuporte(): Suporte {
  return ehIos() && !abertoComoApp() ? "ios_instalar" : "sem_suporte"
}

/** Notificação do sistema mostrada enquanto o painel está aberto. */
export function suporteNotificacao(): Suporte {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "sem_suporte"
  return "Notification" in window ? "ok" : semSuporte()
}

/** Push: o aviso da nuvem que chega com o painel fechado (service worker + PushManager + Notification). */
export function suportePush(): Suporte {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "sem_suporte"
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "ok" : semSuporte()
}

/**
 * Pede a permissão de notificação. Chamar direto do clique, antes de qualquer outra espera: Safari e Firefox só
 * mostram o pedido dentro do gesto da pessoa.
 */
export async function pedirPermissao(suporte: Suporte = suporteNotificacao()): Promise<void> {
  if (suporte !== "ok") throw new ErroPainel(suporte === "ios_instalar" ? "notif_ios_instalar" : "notif_sem_suporte")
  if (Notification.permission === "granted") return
  if (Notification.permission === "denied") throw new ErroPainel("notif_bloqueada")
  const r = await Notification.requestPermission()
  if (r === "granted") return
  throw new ErroPainel(r === "denied" ? "notif_bloqueada" : "notif_sem_resposta")
}

/** O service worker do painel; registra na hora se ainda não estiver e espera ficar pronto (até `esperaMs`). */
export async function registroServiceWorker(esperaMs = 10_000): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new ErroPainel("notif_sem_suporte")
  try {
    if (!(await navigator.serviceWorker.getRegistration("/")))
      await navigator.serviceWorker.register("/sw.js", { scope: "/" })
  } catch (e) {
    throw new ErroPainel("notif_sem_service_worker", e instanceof Error ? e.message : undefined)
  }
  // sem service worker ativo o "ready" nunca resolve: sem o prazo, o botão ficava girando para sempre
  const pronto = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), esperaMs)),
  ])
  if (!pronto) throw new ErroPainel("notif_sem_service_worker")
  return pronto
}

/** A chave pública VAPID (base64url) nos bytes que o PushManager pede. */
export function chaveDeAplicacao(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.trim().replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function mesmosBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/**
 * Inscreve este aparelho no push com a chave pública da instalação e devolve a inscrição (endereço e chaves) para a
 * nuvem guardar. Uma inscrição antiga feita com outra chave é refeita (senão o navegador recusa a nova).
 */
export async function inscreverPush(chavePublica: string): Promise<PushSubscriptionJSON> {
  const suporte = suportePush()
  if (suporte !== "ok") throw new ErroPainel(suporte === "ios_instalar" ? "notif_ios_instalar" : "notif_sem_suporte")
  const registro = await registroServiceWorker()
  const chave = chaveDeAplicacao(chavePublica)
  let inscricao: PushSubscription
  try {
    const antiga = await registro.pushManager.getSubscription()
    if (antiga && mesmosBytes(antiga.options.applicationServerKey, chave)) inscricao = antiga
    else {
      await antiga?.unsubscribe()
      inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") throw new ErroPainel("notif_bloqueada")
    throw new ErroPainel("notif_inscricao_falhou", e instanceof Error ? e.message : undefined)
  }
  const json = inscricao.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new ErroPainel("notif_inscricao_falhou")
  return json
}

/** A inscrição de push deste aparelho, se houver (sem pedir nada à pessoa). */
export async function inscricaoAtual(): Promise<PushSubscription | null> {
  try {
    if (suportePush() !== "ok") return null
    const registro = await navigator.serviceWorker.getRegistration("/")
    return (await registro?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

/**
 * Mostra uma notificação do sistema agora, pelo service worker quando há (o único jeito no Chrome do Android) ou
 * direto. Devolve false se não deu (sem permissão ou sem suporte), sem lançar.
 */
export async function mostrarNotificacao(
  titulo: string,
  corpo: string,
  opcoes: { tag?: string; url?: string } = {}
): Promise<boolean> {
  if (suporteNotificacao() !== "ok" || Notification.permission !== "granted") return false
  const dados: NotificationOptions = {
    body: corpo,
    icon: "/icones/icone-192.png",
    badge: "/icones/icone-192.png",
    tag: opcoes.tag,
    data: { url: opcoes.url ?? "/" },
  }
  try {
    const registro = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined
    if (registro?.active) {
      await registro.showNotification(titulo, dados)
      return true
    }
  } catch {
    // cai na notificação direta
  }
  try {
    const n = new Notification(titulo, dados)
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/** Notificação de teste local (sem passar pela nuvem): pede a permissão e mostra. Lança com o código do problema. */
export async function notificacaoDeTeste(titulo: string, corpo: string): Promise<void> {
  await pedirPermissao()
  if (!(await mostrarNotificacao(titulo, corpo, { tag: "reveza-teste" }))) throw new ErroPainel("notif_sem_suporte")
}
