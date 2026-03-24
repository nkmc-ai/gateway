import { defineConfig } from "tsup";

export default defineConfig([
  // CLI binary entry
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
    external: ["better-sqlite3"],
  },
  // Library exports (for embedding in CLI)
  {
    entry: { server: "src/server.ts", config: "src/config.ts" },
    format: ["esm"],
    dts: false,
    external: ["better-sqlite3"],
  },
]);
