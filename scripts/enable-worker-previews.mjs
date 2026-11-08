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

// Wrangler deploy reads this generated config, not dashboard-only settings.
// Upsert our production D1 binding without replacing other app bindings,
// routes, assets, environment settings or existing D1 databases.
const telegramD1 = {
  binding: "TRADEPULSE_DB",
  database_name: "tradepulse-telegram",
  database_id: "3d9bb1bf-f57f-4ec1-b60f-f0f5a62204d6",
};
if (cfg.d1_databases !== undefined && !Array.isArray(cfg.d1_databases)) {
  throw new Error("Generated Wrangler d1_databases is not an array.");
}
cfg.d1_databases = [
  ...(cfg.d1_databases ?? []).filter((item) => item.binding !== telegramD1.binding),
  telegramD1,
];
writeFileSync(generated, JSON.stringify(cfg, null, 2) + "\n");
console.log("Worker Preview configuration and TradePulse D1 binding enabled in generated Wrangler file:", generated);
