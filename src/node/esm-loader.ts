/* eslint-disable */

export function resolve(specifier: string, context: any, nextResolve: (s: string) => any) {
  const { parentURL } = context
  const url = new URL(specifier, parentURL).href

  if (specifier.endsWith(".css")) {
    return {
      shortCircuit: true,
      url,
    }
  }

  return nextResolve(specifier)
}

export function load(url: string, context: any, nextLoad: (u: string) => any) {
  if (url.endsWith(".css")) {
    return {
      shortCircuit: true,
      format: "module",
      source: "",
    }
  }

  return nextLoad(url)
}
