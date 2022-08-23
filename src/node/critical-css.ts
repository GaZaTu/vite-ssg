import type { Options } from "critters"

export async function getCritters(outDir: string, options: Options = {}) {
  try {
    const { default: CrittersClass } = await import("critters")

    return new CrittersClass({
      path: outDir,
      logLevel: "warn",
      external: true,
      pruneSource: true,
      inlineFonts: true,
      preloadFonts: true,
      ...options,
    })
  } catch (e) {
    return undefined
  }
}
