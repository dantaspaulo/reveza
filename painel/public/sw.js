// Service worker do painel do Reveza AI: casca offline e recebimento de push.
// - Navegação: rede primeiro; sem rede, a casca (index.html) guardada. Os dados nunca são guardados aqui: a leitura da
//   nuvem (outro domínio) passa direto, e o painel mostra "sem conexão" quando ela falha.
// - Arquivos do build (/assets/*, com nome por conteúdo): cache primeiro.
// - Push: mostra a notificação que a nuvem mandar ({titulo, corpo, url}, cifrada para este aparelho); o clique abre só
//   caminhos do próprio painel.

const VERSAO = "reveza-v2"
const CASCA = ["/", "/index.html", "/manifest.webmanifest", "/icones/icone.svg", "/icones/icone-192.png"]

// O service worker não enxerga o localStorage: para o texto do aviso sem corpo, segue o idioma do sistema.
// pt-BR é o padrão do produto quando não há navigator.
function idiomaDoSistema() {
  const nav = self.navigator
  const lista = (nav && nav.languages && nav.languages.length ? nav.languages : [nav ? nav.language : ""]).filter(Boolean)
  if (lista.length === 0) return "pt-BR"
  return lista.some((l) => String(l).toLowerCase().startsWith("pt")) ? "pt-BR" : "en"
}

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((c) => c.addAll(CASCA))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request
  if (pedido.method !== "GET") return
  const url = new URL(pedido.url)
  if (url.origin !== self.location.origin) return

  if (pedido.mode === "navigate") {
    evento.respondWith(
      fetch(pedido)
        .then((resposta) => {
          // só a casca do painel vira a cópia offline (um 404 ou o robots.txt não podem tomar o lugar dela)
          const tipo = resposta.headers.get("content-type") || ""
          if (resposta.ok && resposta.type === "basic" && tipo.startsWith("text/html")) {
            const copia = resposta.clone()
            caches.open(VERSAO).then((c) => c.put("/index.html", copia))
          }
          return resposta
        })
        .catch(() => caches.match("/index.html").then((r) => r || Response.error()))
    )
    return
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icones/")) {
    evento.respondWith(
      caches.match(pedido).then(
        (guardado) =>
          guardado ||
          fetch(pedido).then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone()
              caches.open(VERSAO).then((c) => c.put(pedido, copia))
            }
            return resposta
          })
      )
    )
  }
})

self.addEventListener("push", (evento) => {
  const ler = () => {
    try {
      return evento.data ? evento.data.json() : {}
    } catch {
      return { corpo: evento.data ? evento.data.text() : "" }
    }
  }
  const dados = ler()
  const titulo = typeof dados.titulo === "string" && dados.titulo ? dados.titulo : "Reveza AI"
  // aviso sem texto (inscrição antiga, sem as chaves): ao menos diz para abrir o painel
  const corpo =
    typeof dados.corpo === "string" && dados.corpo
      ? dados.corpo
      : idiomaDoSistema() === "pt-BR"
        ? "Algo pede atenção no painel."
        : "Something needs your attention in the panel."
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: corpo,
      icon: "/icones/icone-192.png",
      badge: "/icones/icone-192.png",
      tag: typeof dados.tag === "string" ? dados.tag : undefined,
      data: { url: typeof dados.url === "string" ? dados.url : "/" },
    })
  )
})

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close()
  const destino = new URL(evento.notification.data?.url || "/", self.location.origin)
  // só caminhos do próprio painel
  const caminho = destino.origin === self.location.origin ? destino.pathname + destino.search : "/"
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (new URL(j.url).origin === self.location.origin && "focus" in j) {
          j.navigate(caminho)
          return j.focus()
        }
      }
      return self.clients.openWindow(caminho)
    })
  )
})
