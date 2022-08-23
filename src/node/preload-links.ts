export type ViteSSRManifest = Record<string, string[]>

export function appendPreloadLinks(document: Document, modules: string[], ssrManifest: ViteSSRManifest) {
  const preloadLinks = modules
    .flatMap(id => ssrManifest[id])

  for (const preloadLink of [...(new Set(preloadLinks))]) {
    appendPreloadLink(document, preloadLink)
  }
}

function appendPreloadLink(document: Document, file: string) {
  if (file.endsWith(".js")) {
    appendLink(document, {
      rel: "modulepreload",
      crossOrigin: "",
      href: file,
    })
  } else if (file.endsWith(".css")) {
    appendLink(document, {
      rel: "stylesheet",
      href: file,
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function appendLink(document: Document, attrs: Record<string, any>) {
  const exists = document.head.querySelector(`link[href='${attrs.file}']`)
  if (exists) {
    return
  }

  const link = document.createElement("link")
  for (const [key, value] of Object.entries(attrs)) {
    link.setAttribute(key, value)
  }
  document.head.appendChild(link)
}
