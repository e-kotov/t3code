// Regenerates apps/web/src/routeTree.gen.ts with the generator that the web Vite plugin runs, so
// an upstream merge can take upstream's tree and still list the fork's route files.
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const web = NodePath.resolve(import.meta.dirname, "../apps/web");
const plugin = NodeModule.createRequire(NodePath.resolve(web, "package.json")).resolve(
  "@tanstack/router-plugin/package.json",
);
const { Generator, getConfig } = NodeModule.createRequire(plugin)("@tanstack/router-generator");
// Matches tanstackRouter({ autoCodeSplitting: true }) in apps/web/vite.config.ts.
const config = getConfig({ autoCodeSplitting: true }, web);
await new Generator({ config, root: web }).run();
