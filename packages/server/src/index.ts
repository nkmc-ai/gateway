import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

async function main() {
  const config = loadConfig();
  await startServer({ config });
}

main().catch((err) => {
  console.error("[nkmc] Fatal error:", err);
  process.exit(1);
});
