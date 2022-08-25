const __ssrLoadedModulesArray = [];
const __ssrLoadedModules = {
  slice: () => {
    const copy = __ssrLoadedModulesArray.slice();
    __ssrLoadedModulesArray.length = 0;
    return copy;
  },
  push: (moduleId) => {
    __ssrLoadedModulesArray.push(moduleId);
  }
};

export { __ssrLoadedModules };
