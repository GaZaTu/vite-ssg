# vite-ssg-but-for-everyone
https://github.com/antfu/vite-ssg but for everyone (including your mom)

## Motivation 🤔

Tried to get SSG (Static Site Generation) similar to that of the preact cli successor (whatever that is called again) but didn't find anything working with [Solid](https://www.solidjs.com/).
Tried https://vitejs.dev/guide/ssr.html for example and ye.

Eventually I found https://github.com/antfu/vite-ssg which basically did do what I wanted but only for Vue.
So I forked it, removed all the Vue specific stuff... and uhh basically changed everything (there really is not much left of the original 🤣).

Features I added in this fork:
  - Framework agnostic (if you're using [Vite](https://vitejs.dev/) chances are you can use this project for SSG)
    - includes preloading
  - Automatic CSP generation for nginx (inserts sha-256 hashes for inline script tags) (damn it feels good to get A+ on Mozilla Observatory)

## Setup 🚀

```diff
// package.json
{
  "scripts": {
-   "build": "vite build"
+   "build": "vite-ssg build"
  }
}
```

```diff
// vite.config.ts
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [
-   solid(),
+   solid({ ssr: true }),
  ],
})
```

```typescript
// src/index.tsx
import { __ssrLoadedModules } from "vite-ssg-but-for-everyone"
import type { EntryFileExports } from "vite-ssg-but-for-everyone/node"
import App from "./App"

const ROOT_ELEMENT_ID = "root"

if (typeof window !== "undefined") {
  const main = () => <App />
  const root = document.getElementById(ROOT_ELEMENT_ID)!

  if (import.meta.env.VITE_SSG) {
    const { hydrate } = await import("solid-js/web")
    hydrate(main, root)
  } else {
    const { render } = await import("solid-js/web")
    render(main, root)
  }
}

export const prerender: EntryFileExports["prerender"] = async context => {
  const main = () => <App url={context.route} />

  const { renderToStringAsync, generateHydrationScript } = await import("solid-js/web")
  return {
    html: await renderToStringAsync(main),
    head: {
      elements: [
        generateHydrationScript(),
      ],
    },
    preload: __ssrLoadedModules.slice(),
  }
}

export const setupPrerender: EntryFileExports["setupPrerender"] = async () => {
  const { default: routes } = await import("./routes")

  return {
    root: ROOT_ELEMENT_ID,
    routes: routes
      .map(r => {
        if (r.path === "**") {
          return "__404"
        }

        return String(r.path)
      })
      .filter(i => !i.includes(":") && !i.includes("*")),
    csp: {
      fileName: "csp.conf",
      fileType: "nginx-conf",
      template: "script-src 'self' {{INLINE_SCRIPT_HASHES}}; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; trusted-types *;",
    },
  }
}
```
