export type ViteSSRManifest = Record<string, string[]>

export function appendPreloadLinks(document: Document, modules: string[], ssrManifest: ViteSSRManifest) {
  const preloadLinks = modules
    .flatMap(id => ssrManifest[id])

  return [...(new Set(preloadLinks))]
    .map(preloadLink => appendPreloadLink(document, preloadLink))
}

function appendPreloadLink(document: Document, file: string) {
  if (file.endsWith(".js")) {
    const attrs = {
      rel: "modulepreload",
      crossOrigin: "",
      href: file,
    }

    appendLink(document, attrs)
    return attrs
  } else if (file.endsWith(".css")) {
    const attrs = {
      rel: "stylesheet",
      href: file,
    }

    appendLink(document, attrs)
    return attrs
  }

  return undefined
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
