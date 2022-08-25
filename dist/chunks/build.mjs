import { createHash } from 'crypto';
import fs from 'fs-extra';
import { JSDOM } from 'jsdom';
import { gray, yellow, blue, dim, cyan, red, green } from 'kolorist';
import { createRequire } from 'module';
import PQueue from 'p-queue';
import { isAbsolute, parse, dirname, join as join$1, relative } from 'path';
import { resolveConfig, build as build$1, mergeConfig } from 'vite';

async function getCritters(outDir, options = {}) {
  try {
    const { default: CrittersClass } = await import('critters');
    return new CrittersClass({
      path: outDir,
      logLevel: "warn",
      external: true,
      pruneSource: true,
      inlineFonts: true,
      preloadFonts: true,
      ...options
    });
  } catch (e) {
    return void 0;
  }
}

function appendPreloadLinks(document, modules, ssrManifest) {
  const preloadLinks = modules.flatMap((id) => ssrManifest[id]);
  for (const preloadLink of [...new Set(preloadLinks)]) {
    appendPreloadLink(document, preloadLink);
  }
}
function appendPreloadLink(document, file) {
  if (file.endsWith(".js")) {
    appendLink(document, {
      rel: "modulepreload",
      crossOrigin: "",
      href: file
    });
  } else if (file.endsWith(".css")) {
    appendLink(document, {
      rel: "stylesheet",
      href: file
    });
  }
}
function appendLink(document, attrs) {
  const exists = document.head.querySelector(`link[href='${attrs.file}']`);
  if (exists) {
    return;
  }
  const link = document.createElement("link");
  for (const [key, value] of Object.entries(attrs)) {
    link.setAttribute(key, value);
  }
  document.head.appendChild(link);
}

function buildLog(text, count) {
  console.log(`
${gray("[vite-ssg]")} ${yellow(text)}${count ? blue(` (${count})`) : ""}`);
}
function getSize(str) {
  return `${(str.length / 1024).toFixed(2)} KiB`;
}

const join = (...paths) => {
  return join$1(...paths).replaceAll("\\", "/");
};
const INLINE_SCRIPT_HASHES_KEY = "{{INLINE_SCRIPT_HASHES}}";
async function importEntryFile(path, ssgOut, format = "esm") {
  buildLog(`Loading Entry file "${path}"`);
  if (format === "esm") {
    await fs.writeFile(join(ssgOut, "package.json"), JSON.stringify({ type: "module" }));
    return await import(path);
  } else {
    const _require = createRequire(import.meta.url);
    return _require(path);
  }
}
const createViteSSGPlugin = (root) => {
  return {
    name: "vite-ssg-plugin",
    transform: (src, id) => {
      if (id.endsWith(".jsx") || id.endsWith(".tsx")) {
        if (id.includes("src/pages")) {
          const __ssrModuleId = relative(root, id).replace(/\\/g, "/");
          return `
            import { __ssrLoadedModules } from "vite-ssg-but-for-everyone";
            const __ssrModuleId = "${__ssrModuleId}";
            __ssrLoadedModules.push(__ssrModuleId);
            ${src}
          `;
        }
      }
      return void 0;
    }
  };
};
async function build(cliOptions = {}, viteConfig = {}) {
  const mode = process.env.MODE ?? process.env.NODE_ENV ?? cliOptions.mode ?? "production";
  const config = await resolveConfig(viteConfig, "build", mode);
  const cwd = process.cwd();
  const root = config.root ?? cwd;
  const ssgOut = join(root, ".vite-ssg-temp");
  const outDir = config.build.outDir ?? "dist";
  const out = isAbsolute(outDir) ? outDir : join(root, outDir);
  const {
    script = "sync",
    entry = await detectSSREntry(root),
    formatting = mode === "production" ? "minify" : "none",
    crittersOptions = {},
    format = "esm",
    concurrency = 20
  } = Object.assign({}, config.ssgOptions || {}, cliOptions);
  if (fs.existsSync(ssgOut)) {
    await fs.remove(ssgOut);
  }
  process.env.VITE_SSG = "true";
  buildLog("Build for client...");
  await build$1(mergeConfig(viteConfig, {
    build: {
      ssrManifest: true
    },
    mode: config.mode
  }));
  const ssrEntry = await resolveAlias(config, entry);
  buildLog("Build for server...");
  await build$1(mergeConfig(viteConfig, {
    plugins: [
      createViteSSGPlugin(root)
    ],
    build: {
      ssr: ssrEntry,
      outDir: ssgOut,
      minify: true,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          entryFileNames: `[name].${format === "esm" ? "mjs" : "cjs"}`,
          format
        }
      }
    },
    mode: config.mode
  }));
  const prefix = format === "esm" && process.platform === "win32" ? "file://" : "";
  const ext = format === "esm" ? ".mjs" : ".cjs";
  const entryFilePath = join(prefix, ssgOut, parse(ssrEntry).name + ext);
  const {
    prerender,
    setupPrerender = () => Promise.resolve({})
  } = await importEntryFile(entryFilePath, ssgOut, format);
  const prerenderConfig = await setupPrerender();
  buildLog("Rendering Pages...", prerenderConfig.routes?.length ?? 1);
  const critters = crittersOptions !== false ? await getCritters(outDir, crittersOptions) : void 0;
  if (critters) {
    console.log(`${gray("[vite-ssg]")} ${blue("Critical CSS generation enabled via `critters`")}`);
  }
  const ssrManifest = JSON.parse(await fs.readFile(join(out, "ssr-manifest.json"), "utf-8"));
  let indexHTML = await fs.readFile(join(out, "index.html"), "utf-8");
  indexHTML = rewriteScripts(indexHTML, script);
  const inlineScriptHashes = [];
  const queue = new PQueue.default({ concurrency });
  for (const route of prerenderConfig.routes ?? ["/"]) {
    queue.add(async () => {
      try {
        const appCtx = await prerender({ route });
        const renderedHTML = await renderHTML({
          indexHTML,
          root: prerenderConfig.root,
          ...appCtx
        });
        const jsdom = new JSDOM(renderedHTML);
        const head = jsdom.window.document.head;
        if (appCtx.head?.lang) {
          head.lang = appCtx.head.lang;
        }
        if (appCtx.head?.title) {
          head.title = appCtx.head.title;
        }
        appendPreloadLinks(jsdom.window.document, appCtx.preload ?? [], ssrManifest);
        for (const element of appCtx.head?.elements ?? []) {
          if (typeof element === "string") {
            head.innerHTML = `${head.innerHTML}
${element}`;
          } else {
            head.appendChild(Object.assign(jsdom.window.document.createElement(element.type), element.props));
          }
        }
        if (prerenderConfig.csp) {
          const inlineScriptTags = jsdom.window.document.querySelectorAll("script:not([src])");
          for (let i = 0; i < inlineScriptTags.length; i++) {
            const inlineScriptTag = inlineScriptTags.item(i);
            const inlineScriptTagAsString = `<script>${inlineScriptTag.innerHTML}<\/script>`;
            const inlineScriptTagAsFormattedString = await formatHtml(inlineScriptTagAsString, formatting);
            const inlineScript = inlineScriptTagAsFormattedString.replace("<script>", "").replace("<\/script>", "");
            const inlineScriptHash = createHash("sha256").update(inlineScript).digest("base64");
            inlineScriptHashes.push(inlineScriptHash);
          }
        }
        let html = jsdom.serialize();
        if (critters) {
          html = await critters.process(html);
        }
        html = await formatHtml(html, formatting);
        const relativeRouteFile = `${(route.endsWith("/") ? `${route}index` : route).replace(/^\//g, "")}.html`;
        const filename = prerenderConfig.dirStyle === "flat" ? relativeRouteFile : join(route.replace(/^\//g, ""), "index.html");
        await fs.ensureDir(join(out, dirname(filename)));
        await fs.writeFile(join(out, filename), html, "utf-8");
        config.logger.info(`${dim(`${outDir}/`)}${cyan(filename.padEnd(15, " "))}  ${dim(getSize(html))}`);
      } catch (err) {
        throw new Error(`${gray("[vite-ssg]")} ${red(`Error on page: ${cyan(route)}`)}
${err.stack}`);
      }
    });
  }
  await queue.start().onIdle();
  if (prerenderConfig.csp) {
    const csp = prerenderConfig.csp;
    if (csp.fileType === "nginx-conf") {
      const hashesAsString = [...new Set(inlineScriptHashes)].map((hash) => `'sha256-${hash}'`).join(" ");
      const headerValue = csp.template.replace(INLINE_SCRIPT_HASHES_KEY, hashesAsString);
      const fileContent = `add_header Content-Security-Policy "${headerValue}";
`;
      await fs.ensureDir(join(out, dirname(csp.fileName)));
      await fs.writeFile(join(out, csp.fileName), fileContent, "utf-8");
    }
  }
  await fs.remove(ssgOut);
  const pwaPlugin = config.plugins.find((i) => i.name === "vite-plugin-pwa")?.api;
  if (pwaPlugin && !pwaPlugin.disabled && pwaPlugin.generateSW) {
    buildLog("Regenerate PWA...");
    await pwaPlugin.generateSW();
  }
  console.log(`
${gray("[vite-ssg]")} ${green("Build finished.")}`);
  const waitInSeconds = 15;
  const timeout = setTimeout(() => {
    console.log(`${gray("[vite-ssg]")} ${yellow(`Build process still running after ${waitInSeconds}s. There might be something misconfigured in your setup. Force exit.`)}`);
    process.exit(0);
  }, waitInSeconds * 1e3);
  timeout.unref();
}
async function detectSSREntry(root) {
  const scriptSrcReg = /<script(?:.*?)src=["'](.+?)["'](?!<)(?:.*)>(?:[\n\r\s]*?)(?:<\/script>)/img;
  const html = await fs.readFile(join(root, "index.html"), "utf-8");
  const scripts = [...html.matchAll(scriptSrcReg)];
  const [, entry] = scripts.find((matchResult) => {
    const [script] = matchResult;
    const [, scriptType] = script.match(/.*\stype=(?:'|")?([^>'"\s]+)/i) ?? [];
    return scriptType === "module";
  }) ?? [];
  return entry ?? "src/main.ts";
}
async function resolveAlias(config, entry) {
  const resolver = config.createResolver();
  const result = await resolver(entry, config.root);
  return result ?? join(config.root, entry);
}
function rewriteScripts(indexHTML, mode) {
  if (!mode || mode === "sync") {
    return indexHTML;
  }
  return indexHTML.replace(/<script type="module" /g, `<script type="module" ${mode} `);
}
async function renderHTML({
  root: rootContainerId,
  indexHTML,
  html: appHTML
}) {
  const container = `<div id="${rootContainerId}"></div>`;
  if (indexHTML.includes(container)) {
    return indexHTML.replace(container, `<div id="${rootContainerId}" data-ssg="true">${appHTML}</div>`);
  }
  const html5Parser = await import('html5parser');
  const ast = html5Parser.parse(indexHTML);
  let renderedOutput;
  html5Parser.walk(ast, {
    enter: (node) => {
      if (!renderedOutput && node?.type === html5Parser.SyntaxKind.Tag && Array.isArray(node.attributes) && node.attributes.length > 0 && node.attributes.some((attr) => attr.name.value === "id" && attr.value?.value === rootContainerId)) {
        const attributesStringified = [...node.attributes.map(({ name: { value: name }, value }) => `${name}="${value?.value}"`)].join(" ");
        const indexHTMLBefore = indexHTML.slice(0, node.start);
        const indexHTMLAfter = indexHTML.slice(node.end);
        renderedOutput = `${indexHTMLBefore}<${node.name} ${attributesStringified} ssg="true">${appHTML}</${node.name}>${indexHTMLAfter}`;
      }
    }
  });
  if (!renderedOutput) {
    throw new Error(`Could not find a tag with id="${rootContainerId}" to replace it with server-side rendered HTML`);
  }
  return renderedOutput;
}
async function formatHtml(html, formatting) {
  switch (formatting) {
    case "minify": {
      const htmlMinifier = await import('html-minifier');
      return htmlMinifier.minify(html, {
        collapseWhitespace: true,
        caseSensitive: true,
        collapseInlineTagWhitespace: false,
        minifyJS: true,
        minifyCSS: true
      });
    }
    case "prettify": {
      const { default: prettier } = await import('prettier/esm/standalone.mjs');
      const { default: parserHTML } = await import('prettier/esm/parser-html.mjs');
      return prettier.format(html, {
        semi: false,
        parser: "html",
        plugins: [parserHTML]
      });
    }
    default: {
      return html;
    }
  }
}

export { build as b };
