import type { Options } from "critters"

export async function getCritters(outDir: string, options: Options = {}) {
  try {
    const { default: CrittersClass } = await import("critters")

    return new CrittersClass({
      path: outDir,
      external: true,
      pruneSource: false,
      mergeStylesheets: true,
      inlineFonts: true,
      preloadFonts: true,
      logLevel: "warn",
      ...options,
    })
  } catch (e) {
    return undefined
  }
}
