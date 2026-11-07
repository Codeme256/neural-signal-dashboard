// Cloudflare's Lovable/Nitro build generates Wrangler configuration.
// Worker Previews require an explicit `previews` block, including when empty.
// Only change the generated file after the production build; never alter routes/assets.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const pointer = resolve(".wrangler/deploy/config.json");
if (!existsSync(pointer)) {
  throw new Error("Missing .wrangler/deploy/config.json after Vite build; cannot safely configure Cloudflare previews.");
}
const { configPath } = JSON.parse(readFileSync(pointer, "utf8"));
if (typeof configPath !== "string" || !configPath) {
  throw new Error("Generated Wrangler configuration pointer does not contain configPath.");
}
const generated = resolve(dirname(pointer), configPath);
if (!existsSync(generated)) {
  throw new Error("Generated Wrangler configuration not found at " + generated);
}
const cfg = JSON.parse(readFileSync(generated, "utf8"));
if (!cfg.previews) cfg.previews = {};
writeFileSync(generated, JSON.stringify(cfg, null, 2) + "\n");
console.log("Worker Preview configuration enabled in generated Wrangler file:", generated);
