import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/http.ts", "src/proxy.ts", "src/testing.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
