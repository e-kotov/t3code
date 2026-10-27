// Regenerates apps/web/src/routeTree.gen.ts with the generator that the web Vite plugin runs, so
// an upstream merge can take upstream's tree and still list the fork's route files.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const web = resolve(import.meta.dirname, "../apps/web");
const plugin = createRequire(resolve(web, "package.json")).resolve(
  "@tanstack/router-plugin/package.json",
);
const { Generator, getConfig } = createRequire(plugin)("@tanstack/router-generator");
// Matches tanstackRouter({ autoCodeSplitting: true }) in apps/web/vite.config.ts.
const config = getConfig({ autoCodeSplitting: true }, web);
await new Generator({ config, root: web }).run();
