'use strict';

const child_process = require('child_process');
const crypto = require('crypto');
const fs = require('fs-extra');
const jsdom = require('jsdom');
const kolorist = require('kolorist');
const module$1 = require('module');
const PQueue = require('p-queue');
const path = require('path');
const vite = require('vite');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e["default"] : e; }

const fs__default = /*#__PURE__*/_interopDefaultLegacy(fs);
const PQueue__default = /*#__PURE__*/_interopDefaultLegacy(PQueue);

async function getCritters(outDir, options = {}) {
  try {
    const { default: CrittersClass } = await import('critters');
    return new CrittersClass({
      path: outDir,
      external: true,
      pruneSource: false,
      mergeStylesheets: true,
      inlineFonts: true,
      preloadFonts: true,
      logLevel: "warn",
      ...options
    });
  } catch (e) {
    return void 0;
  }
}

function appendPreloadLinks(document, modules, ssrManifest) {
  const preloadLinks = modules.flatMap((id) => ssrManifest[id]);
  return [...new Set(preloadLinks)].map((preloadLink) => appendPreloadLink(document, preloadLink));
}
function appendPreloadLink(document, file) {
  if (file.endsWith(".js")) {
    const attrs = {
      rel: "modulepreload",
      crossOrigin: "",
      href: file
    };
    appendLink(document, attrs);
    return attrs;
  } else if (file.endsWith(".css")) {
    const attrs = {
      rel: "stylesheet",
      href: file
    };
    appendLink(document, attrs);
    return attrs;
  }
  return void 0;
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
${kolorist.gray("[vite-ssg]")} ${kolorist.yellow(text)}${count ? kolorist.blue(` (${count})`) : ""}`);
}
function getSize(str) {
  return `${(str.length / 1024).toFixed(2)} KiB`;
}

const join = (...paths) => {
  return path.join(...paths).replaceAll("\\", "/");
};
const INLINE_SCRIPT_HASHES_KEY = "{{INLINE_SCRIPT_HASHES}}";
async function importEntryFile(path, ssgOut, format = "esm") {
  buildLog(`Loading Entry file "${path}"`);
  if (format === "esm") {
    await fs__default.writeFile(join(ssgOut, "package.json"), JSON.stringify({ type: "module" }));
    return await import(path);
  } else {
    const _require = module$1.createRequire((typeof document === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : (document.currentScript && document.currentScript.src || new URL('chunks/build.cjs', document.baseURI).href)));
    return _require(path);
  }
}
const createViteSSGPlugin = (root) => {
  return {
    name: "vite-ssg-plugin",
    transform: (src, id) => {
      if (!id.endsWith(".jsx") && !id.endsWith(".tsx")) {
        return void 0;
      }
      if (id.includes("index") || id.includes("main")) {
        return void 0;
      }
      const __ssrModuleId = path.relative(root, id).replace(/\\/g, "/");
      return `
        import { __ssrLoadedModules } from "vite-ssg-but-for-everyone";
        const __ssrModuleId = "${__ssrModuleId}";
        __ssrLoadedModules.push(__ssrModuleId);
        ${src}
      `;
    }
  };
};
async function build(cliOptions = {}, viteConfig = {}) {
  const mode = process.env.MODE ?? process.env.NODE_ENV ?? cliOptions.mode ?? "production";
  const config = await vite.resolveConfig(viteConfig, "build", mode);
  const cwd = process.cwd();
  const root = config.root ?? cwd;
  const ssgOut = join(root, ".vite-ssg-temp");
  const outDir = config.build.outDir ?? "dist";
  const out = path.isAbsolute(outDir) ? outDir : join(root, outDir);
  const {
    script = "sync",
    entry = await detectSSREntry(root),
    formatting = mode === "production" ? "minify" : "none",
    crittersOptions = {},
    format = "esm",
    concurrency = 20
  } = Object.assign({}, config.ssgOptions || {}, cliOptions);
  if (fs__default.existsSync(ssgOut)) {
    await fs__default.remove(ssgOut);
  }
  process.env.VITE_SSG = "true";
  buildLog("Build for client...");
  await vite.build(vite.mergeConfig(viteConfig, {
    build: {
      ssrManifest: true
    },
    mode: config.mode
  }));
  const ssrEntry = await resolveAlias(config, entry);
  buildLog("Build for server...");
  await vite.build(vite.mergeConfig(viteConfig, {
    plugins: [
      createViteSSGPlugin(root)
    ],
    build: {
      ssr: ssrEntry,
      outDir: ssgOut,
      minify: false,
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
  const entryFilePath = join(prefix, ssgOut, path.parse(ssrEntry).name + ext);
  const prerenderFilePath = new URL(`${path.dirname(entryFilePath)}/__prerender.mjs`);
  console.log("prerenderFilePath", prerenderFilePath);
  await fs__default.writeFile(prerenderFilePath, `
    import { prerender } from "./${path.basename(entryFilePath)}"

    process.on("message", async context => {
      process.send(await prerender(context))
    })
  `);
  const prerender = async (context) => {
    const child = child_process.fork(prerenderFilePath);
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("message", resolve);
      child.send(context);
    });
  };
  const {
    setupPrerender = () => Promise.resolve({})
  } = await importEntryFile(entryFilePath, ssgOut, format);
  const prerenderConfig = await setupPrerender();
  buildLog("Rendering Pages...", prerenderConfig.routes?.length ?? 1);
  const critters = crittersOptions !== false ? await getCritters(outDir, crittersOptions) : void 0;
  if (critters) {
    console.log(`${kolorist.gray("[vite-ssg]")} ${kolorist.blue("Critical CSS generation enabled via `critters`")}`);
  }
  const ssrManifest = JSON.parse(await fs__default.readFile(join(out, "ssr-manifest.json"), "utf-8"));
  let indexHTML = await fs__default.readFile(join(out, "index.html"), "utf-8");
  indexHTML = rewriteScripts(indexHTML, script);
  const inlineScriptHashes = [];
  const queue = new PQueue__default.default({ concurrency });
  for (const route of prerenderConfig.routes ?? ["/"]) {
    queue.add(async () => {
      try {
        const appCtx = await prerender({ route });
        const renderedHTML = await renderHTML({
          indexHTML,
          root: prerenderConfig.root,
          ...appCtx
        });
        const jsdom$1 = new jsdom.JSDOM(renderedHTML);
        const head = jsdom$1.window.document.head;
        if (appCtx.head?.lang) {
          head.lang = appCtx.head.lang;
        }
        if (appCtx.head?.title) {
          head.title = appCtx.head.title;
        }
        appendPreloadLinks(jsdom$1.window.document, appCtx.preload ?? [], ssrManifest);
        for (const element of appCtx.head?.elements ?? []) {
          if (typeof element === "string") {
            head.innerHTML = `${head.innerHTML}
${element}`;
          } else {
            head.appendChild(Object.assign(jsdom$1.window.document.createElement(element.type), element.props));
          }
        }
        if (prerenderConfig.csp) {
          const inlineScriptTags = jsdom$1.window.document.querySelectorAll("script:not([src])");
          for (let i = 0; i < inlineScriptTags.length; i++) {
            const inlineScriptTag = inlineScriptTags.item(i);
            const inlineScriptTagAsString = `<script>${inlineScriptTag.innerHTML}<\/script>`;
            const inlineScriptTagAsFormattedString = await formatHtml(inlineScriptTagAsString, formatting);
            const inlineScript = inlineScriptTagAsFormattedString.replace("<script>", "").replace("<\/script>", "");
            const inlineScriptHash = crypto.createHash("sha256").update(inlineScript).digest("base64");
            inlineScriptHashes.push(inlineScriptHash);
          }
        }
        let html = jsdom$1.serialize();
        if (critters) {
          html = await critters.process(html);
        }
        html = await formatHtml(html, formatting);
        const relativeRouteFile = `${(route.endsWith("/") ? `${route}index` : route).replace(/^\//g, "")}.html`;
        const filename = prerenderConfig.dirStyle === "flat" ? relativeRouteFile : join(route.replace(/^\//g, ""), "index.html");
        await fs__default.ensureDir(join(out, path.dirname(filename)));
        await fs__default.writeFile(join(out, filename), html, "utf-8");
        config.logger.info(`${kolorist.dim(`${outDir}/`)}${kolorist.cyan(filename.padEnd(15, " "))}  ${kolorist.dim(getSize(html))}`);
      } catch (err) {
        throw new Error(`${kolorist.gray("[vite-ssg]")} ${kolorist.red(`Error on page: ${kolorist.cyan(route)}`)}
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
      await fs__default.ensureDir(join(out, path.dirname(csp.fileName)));
      await fs__default.writeFile(join(out, csp.fileName), fileContent, "utf-8");
    }
  }
  await fs__default.remove(ssgOut);
  const pwaPlugin = config.plugins.find((i) => i.name === "vite-plugin-pwa")?.api;
  if (pwaPlugin && !pwaPlugin.disabled && pwaPlugin.generateSW) {
    buildLog("Regenerate PWA...");
    await pwaPlugin.generateSW();
  }
  console.log(`
${kolorist.gray("[vite-ssg]")} ${kolorist.green("Build finished.")}`);
  const waitInSeconds = 15;
  const timeout = setTimeout(() => {
    console.log(`${kolorist.gray("[vite-ssg]")} ${kolorist.yellow(`Build process still running after ${waitInSeconds}s. There might be something misconfigured in your setup. Force exit.`)}`);
    process.exit(0);
  }, waitInSeconds * 1e3);
  timeout.unref();
}
async function detectSSREntry(root) {
  const scriptSrcReg = /<script(?:.*?)src=["'](.+?)["'](?!<)(?:.*)>(?:[\n\r\s]*?)(?:<\/script>)/img;
  const html = await fs__default.readFile(join(root, "index.html"), "utf-8");
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

exports.build = build;
