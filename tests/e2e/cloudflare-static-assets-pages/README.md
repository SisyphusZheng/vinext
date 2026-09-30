# Pages Router Static Assets fixture

Run from the repository root after `vp install`:

```sh
PLAYWRIGHT_PROJECT=cloudflare-static-assets-pages vp exec playwright test
```

The project builds this checked-in fixture, prerenders its pages, packages the
Static Assets cache, and starts the built Worker in local workerd. Chromium
verifies client navigation without reloading the document. HTTP tests cover
static HTML, Pages data, dynamic paths, preview mode, immutable snapshots,
runtime-only routes, and private cache files.

The fixture reuses the installed `cf-app-basic` dependencies through a symlink
created by the Playwright server command. Its preview and revalidation API
routes are test controls; do not deploy them as public endpoints.
