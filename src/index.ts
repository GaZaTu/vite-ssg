const __ssrLoadedModulesArray: string[] = []
const __ssrLoadedModules = {
  slice: () => {
    const copy = __ssrLoadedModulesArray.slice()
    __ssrLoadedModulesArray.length = 0
    return copy
  },
  push: (moduleId: string) => {
    __ssrLoadedModulesArray.push(moduleId)
  },
}

export {
  __ssrLoadedModules,
}
