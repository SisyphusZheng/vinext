import { defineConfig } from "vite";
// Resolve workspace dependencies before the E2E runner creates the fixture's
// node_modules link, so this config also typechecks in a clean checkout.
import vinext from "../../../../packages/vinext/src/index.js";
import { cloudflare } from "../../../fixtures/cf-app-basic/node_modules/@cloudflare/vite-plugin/dist/index.mjs";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";

export default defineConfig({
  environments: { ssr: { build: { outDir: "dist/server" } } },
  plugins: [
    vinext({ prerender: true, cache: { cdn: staticAssetsAdapter() } }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});
