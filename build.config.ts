import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: [
    { input: "src/index", name: "index" },
    { input: "src/node/cli", name: "node/cli" },
    { input: "src/node", name: "node" },
    { input: "src/node/loader", name: "loader" },
  ],
  clean: true,
  declaration: true,
  rollup: {
    emitCJS: true,
    inlineDependencies: true,
  },
})
