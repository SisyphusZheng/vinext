import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";

export default defineConfig({
  environments: { ssr: { build: { outDir: "dist/server" } } },
  plugins: [
    vinext({ prerender: true, cache: { cdn: staticAssetsAdapter() } }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});
