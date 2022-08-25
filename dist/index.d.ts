declare const __ssrLoadedModules: {
    slice: () => string[];
    push: (moduleId: string) => void;
};

export { __ssrLoadedModules };
