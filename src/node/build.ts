/* eslint-disable no-console */
import type { Options as CrittersOptions } from "critters"
import fs from "fs-extra"
import { JSDOM } from "jsdom"
import { blue, cyan, dim, gray, green, red, yellow } from "kolorist"
import { createRequire } from "module"
import PQueue from "p-queue"
import { dirname, isAbsolute, join, parse, relative } from "path"
import type { InlineConfig, Plugin, ResolvedConfig } from "vite"
import { build as viteBuild, mergeConfig, resolveConfig } from "vite"
import type { VitePluginPWAAPI } from "vite-plugin-pwa"
import { getCritters } from "./critical-css"
import { appendPreloadLinks, ViteSSRManifest } from "./preload-links"
import { buildLog, getSize } from "./utils"

export interface ViteSSGBuildOptions {
  /**
   * Rewrite scripts loading mode, only works for `type="module"`
   *
   * @default "sync"
   */
  script?: "sync" | "async" | "defer" | "async defer"

  /**
   * Built format
   *
   * @default "esm"
   */
  format?: "esm" | "cjs"

  /**
   * The path of main entry, relative to the project root
   *
   * @default "src/main.ts"
   */
  entry?: string

  /**
   * Applying formatter to the generated index file.
   *
   * @default "none"
   */
  formatting?: "minify" | "prettify" | "none"

  /**
   * Vite environment mode
   */
  mode?: string

  /**
   * Options for critters
   *
   * @see https://github.com/GoogleChromeLabs/critters
   */
  crittersOptions?: CrittersOptions | false

  /**
   * Size of generation processing queue.
   *
   * @default 20
   */
  concurrency?: number
}

// extend vite.config.ts
declare module "vite" {
  interface UserConfig {
    ssgOptions?: ViteSSGBuildOptions
  }
}

export interface PrerenderResult {
  html: string
  preload?: string[]
  routes?: string[]
  head?: {
    lang?: string
    title?: string
    elements?: (string | {
      type: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: Record<string, any>
    })[]
  }
}

export type PrerenderFunction = (context: { route: string }) => Promise<PrerenderResult>

export interface SetupPrerenderResult {
  root: string
  routes?: string[]
  dirStyle?: "flat" | "nested"
}

export type SetupPrerenderFunction = () => Promise<SetupPrerenderResult>

export type EntryFileExports = {
  prerender: PrerenderFunction
  setupPrerender?: SetupPrerenderFunction
}

export async function importEntryFile(path: string, ssgOut: string, format: "esm" | "cjs" = "esm") {
  buildLog(`Loading Entry file "${path}"`)

  if (format === "esm") {
    await fs.writeFile(join(ssgOut, "package.json"), JSON.stringify({ type: "module" }))

    return await import(path) as EntryFileExports
  } else {
    const _require = createRequire(import.meta.url)

    return _require(path) as EntryFileExports
  }
}

const createViteSSGPlugin = (root: string): Plugin => {
  return {
    name: "vite-ssg-plugin",
    transform: (src, id) => {
      if (id.endsWith(".jsx") || id.endsWith(".tsx")) {
        if (id.includes("pages")) {
          const __ssrModuleId = relative(root, id)
            .replace(/\\/g, "/")

          return `
            import { __ssrLoadedModules } from "vite-ssg-but-for-everyone";
            const __ssrModuleId = "${__ssrModuleId}";
            __ssrLoadedModules.push(__ssrModuleId);
            ${src}
          `
        }
      }

      return undefined
    },
  }
}

export async function build(cliOptions: Partial<ViteSSGBuildOptions> = {}, viteConfig: InlineConfig = {}) {
  const mode = process.env.MODE ?? process.env.NODE_ENV ?? cliOptions.mode ?? "production"
  const config = await resolveConfig(viteConfig, "build", mode)

  const cwd = process.cwd()
  const root = config.root ?? cwd
  const ssgOut = join(root, ".vite-ssg-temp")
  const outDir = config.build.outDir ?? "dist"
  const out = isAbsolute(outDir) ? outDir : join(root, outDir)

  const {
    script = "sync",
    entry = await detectSSREntry(root),
    formatting = (mode === "production") ? "minify" : "none",
    crittersOptions = {},
    format = "esm",
    concurrency = 20,
  } = Object.assign({}, config.ssgOptions || {}, cliOptions)

  if (fs.existsSync(ssgOut)) {
    await fs.remove(ssgOut)
  }

  process.env.VITE_SSG = "true"

  // client
  buildLog("Build for client...")
  await viteBuild(mergeConfig(viteConfig, {
    build: {
      ssrManifest: true,
    },
    mode: config.mode,
  }))

  const ssrEntry = await resolveAlias(config, entry)

  // server
  buildLog("Build for server...")
  await viteBuild(mergeConfig(viteConfig, {
    plugins: [
      createViteSSGPlugin(root),
    ],
    build: {
      ssr: ssrEntry,
      outDir: ssgOut,
      minify: true, // false
      cssCodeSplit: true, // false
      rollupOptions: {
        output: {
          entryFileNames: `[name].${(format === "esm") ? "mjs" : "cjs"}`,
          format,
        },
      },
    },
    mode: config.mode,
  }))

  const prefix = format === "esm" && process.platform === "win32" ? "file://" : ""
  const ext = format === "esm" ? ".mjs" : ".cjs"
  const entryFilePath = join(prefix, ssgOut, parse(ssrEntry).name + ext)

  const {
    prerender,
    setupPrerender = () => Promise.resolve({} as SetupPrerenderResult),
  } = await importEntryFile(entryFilePath, ssgOut, format)

  const prerenderConfig = await setupPrerender()

  buildLog("Rendering Pages...", prerenderConfig.routes?.length ?? 1)

  const critters = crittersOptions !== false ? await getCritters(outDir, crittersOptions) : undefined
  if (critters) {
    console.log(`${gray("[vite-ssg]")} ${blue("Critical CSS generation enabled via `critters`")}`)
  }

  const ssrManifest = JSON.parse(await fs.readFile(join(out, "ssr-manifest.json"), "utf-8")) as ViteSSRManifest
  let indexHTML = await fs.readFile(join(out, "index.html"), "utf-8")
  indexHTML = rewriteScripts(indexHTML, script)

  // @ts-expect-error just ignore it hasn't exports on its package
  // eslint-disable-next-line new-cap
  const queue = new PQueue.default({ concurrency })

  for (const route of prerenderConfig.routes ?? ["/"]) {
    queue.add(async () => {
      try {
        const appCtx = await prerender({ route })

        // need to resolve assets so render content first
        const renderedHTML = await renderHTML({
          indexHTML,
          root: prerenderConfig.root,
          ...appCtx,
        })

        // create jsdom from renderedHTML
        const jsdom = new JSDOM(renderedHTML)

        const head = jsdom.window.document.head

        if (appCtx.head?.lang) {
          head.lang = appCtx.head.lang
        }

        if (appCtx.head?.title) {
          head.title = appCtx.head.title
        }

        // render current page's preloadLinks
        appendPreloadLinks(jsdom.window.document, appCtx.preload ?? [], ssrManifest)

        // render head
        for (const element of appCtx.head?.elements ?? []) {
          if (typeof element === "string") {
            head.innerHTML = `${head.innerHTML}\n${element}`
          } else {
            head.appendChild(Object.assign(jsdom.window.document.createElement(element.type), element.props))
          }
        }

        let html = jsdom.serialize()
        if (critters) {
          html = await critters.process(html)
        }

        html = await formatHtml(html, formatting)

        const relativeRouteFile = `${(route.endsWith("/") ? `${route}index` : route).replace(/^\//g, "")}.html`
        const filename = prerenderConfig.dirStyle === "flat" ? relativeRouteFile : join(route.replace(/^\//g, ""), "index.html")

        await fs.ensureDir(join(out, dirname(filename)))
        await fs.writeFile(join(out, filename), html, "utf-8")
        config.logger.info(`${dim(`${outDir}/`)}${cyan(filename.padEnd(15, " "))}  ${dim(getSize(html))}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        throw new Error(`${gray("[vite-ssg]")} ${red(`Error on page: ${cyan(route)}`)}\n${err.stack}`)
      }
    })
  }

  await queue.start().onIdle()

  await fs.remove(ssgOut)

  // when `vite-plugin-pwa` is presented, use it to regenerate SW after rendering
  const pwaPlugin: VitePluginPWAAPI = config.plugins.find(i => i.name === "vite-plugin-pwa")?.api
  if (pwaPlugin && !pwaPlugin.disabled && pwaPlugin.generateSW) {
    buildLog("Regenerate PWA...")
    await pwaPlugin.generateSW()
  }

  console.log(`\n${gray("[vite-ssg]")} ${green("Build finished.")}`)

  // ensure build process always exits
  const waitInSeconds = 15
  const timeout = setTimeout(() => {
    console.log(`${gray("[vite-ssg]")} ${yellow(`Build process still running after ${waitInSeconds}s. There might be something misconfigured in your setup. Force exit.`)}`)
    process.exit(0)
  }, waitInSeconds * 1000)
  timeout.unref() // don't wait for timeout
}

async function detectSSREntry(root: string) {
  // pick the first script tag of type module as the entry
  const scriptSrcReg = /<script(?:.*?)src=["'](.+?)["'](?!<)(?:.*)>(?:[\n\r\s]*?)(?:<\/script>)/img
  const html = await fs.readFile(join(root, "index.html"), "utf-8")
  const scripts = [...html.matchAll(scriptSrcReg)] ?? []
  const [, entry] = scripts.find((matchResult) => {
    const [script] = matchResult
    const [, scriptType] = script.match(/.*\stype=(?:'|")?([^>'"\s]+)/i) ?? []
    return scriptType === "module"
  }) ?? []

  return entry ?? "src/main.ts"
}

async function resolveAlias(config: ResolvedConfig, entry: string) {
  const resolver = config.createResolver()
  const result = await resolver(entry, config.root)

  return result ?? join(config.root, entry)
}

function rewriteScripts(indexHTML: string, mode?: string) {
  if (!mode || mode === "sync") {
    return indexHTML
  }

  return indexHTML.replace(/<script type="module" /g, `<script type="module" ${mode} `)
}

async function renderHTML({
  root: rootContainerId,
  indexHTML,
  html: appHTML,
}: PrerenderResult & {
  indexHTML: string
  root: string
}) {
  const container = `<div id="${rootContainerId}"></div>`
  if (indexHTML.includes(container)) {
    return indexHTML
      .replace(container, `<div id="${rootContainerId}" data-ssg="true">${appHTML}</div>`)
  }

  const html5Parser = await import("html5parser")
  const ast = html5Parser.parse(indexHTML)
  let renderedOutput: string | undefined

  html5Parser.walk(ast, {
    enter: (node) => {
      if (!renderedOutput
          && node?.type === html5Parser.SyntaxKind.Tag
          && Array.isArray(node.attributes)
          && node.attributes.length > 0
          && node.attributes.some(attr => attr.name.value === "id" && attr.value?.value === rootContainerId)
      ) {
        const attributesStringified = [...node.attributes.map(({ name: { value: name }, value }) => `${name}="${value?.value}"`)].join(" ")
        const indexHTMLBefore = indexHTML.slice(0, node.start)
        const indexHTMLAfter = indexHTML.slice(node.end)

        renderedOutput = `${indexHTMLBefore}<${node.name} ${attributesStringified} ssg="true">${appHTML}</${node.name}>${indexHTMLAfter}`
      }
    },
  })

  if (!renderedOutput) {
    throw new Error(`Could not find a tag with id="${rootContainerId}" to replace it with server-side rendered HTML`)
  }

  return renderedOutput
}

async function formatHtml(html: string, formatting: ViteSSGBuildOptions["formatting"]) {
  switch (formatting) {
    case "minify": {
      const htmlMinifier = await import("html-minifier")

      return htmlMinifier.minify(html, {
        collapseWhitespace: true,
        caseSensitive: true,
        collapseInlineTagWhitespace: false,
        minifyJS: true,
        minifyCSS: true,
      })
    }

    case "prettify": {
      // @ts-expect-error dynamic import
      const { default: prettier } = await import("prettier/esm/standalone.mjs")
      // @ts-expect-error dynamic import
      const { default: parserHTML } = await import("prettier/esm/parser-html.mjs")

      return prettier.format(html, {
        semi: false,
        parser: "html",
        plugins: [parserHTML],
      })
    }

    default: {
      return html
    }
  }
}
