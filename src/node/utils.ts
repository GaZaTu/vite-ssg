import { blue, gray, yellow } from "kolorist"

export type RouteDefinition = string | {
  path?: string
  children?: RouteDefinition[]
}

export function buildLog(text: string, count?: number) {
  // eslint-disable-next-line no-console
  console.log(`\n${gray("[vite-ssg]")} ${yellow(text)}${count ? blue(` (${count})`) : ""}`)
}

export function getSize(str: string) {
  return `${(str.length / 1024).toFixed(2)} KiB`
}

export function routesToPaths(routes?: Readonly<RouteDefinition[]>) {
  if (!routes) {
    return ["/"]
  }

  const getPaths = (routes: Readonly<RouteDefinition[]>, prefix = ""): string[] => {
    const paths = [] as string[]

    // remove trailing slash
    prefix = prefix.replace(/\/$/g, "")
    for (const route of routes) {
      if (typeof route === "string") {
        paths.push(route)
        continue
      }

      // eslint-disable-next-line prefer-const
      let { path, children } = route

      // check for leading slash
      if (prefix && path && !path.startsWith("/")) {
        path = `${prefix}${path ? `/${path}` : ""}`
      }

      if (path) {
        paths.push(path)
      }

      if (children) {
        paths.push(...getPaths(children, path))
      }
    }

    return paths
  }

  return [...(new Set(getPaths(routes)))]
}
