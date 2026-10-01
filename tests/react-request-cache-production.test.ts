// React.cache() in production App Router requests, through the real probes,
// metadata, Flight render and ISR cache. generateMetadata() and the render
// share one cache() scope, as in Next.js's single render; the layout/page
// probes must not take part in it.

import fs from "node:fs";
import path from "node:path";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import vinext from "../packages/vinext/src/index.js";
import { createIsolatedFixture } from "./helpers.js";

const FIXTURE_SOURCE_DIR = path.resolve(import.meta.dirname, "./fixtures/app-react-request-cache");
const RSC_HEADERS = { Accept: "text/x-component", RSC: "1" };
// Cache writes land after the response body ends, within this window.
const CACHE_WRITE_WINDOW_MS = 500;
// A render that awaits a promise a probe left suspended never responds.
const REQUEST_TIMEOUT_MS = 10_000;

type PageResponse = { body: string; cache: string | null; status: number };

describe("React.cache() in production page requests", () => {
  let baseUrl = "";
  let fixtureDir = "";
  let server: import("node:http").Server | undefined;

  beforeAll(async () => {
    fixtureDir = await createIsolatedFixture(FIXTURE_SOURCE_DIR, "vinext-react-request-cache-");
    fs.writeFileSync(path.join(fixtureDir, "package.json"), '{"private":true,"type":"module"}');
    const builder = await createBuilder({
      root: fixtureDir,
      configFile: false,
      plugins: [vinext({ appDir: fixtureDir })],
      logLevel: "silent",
    });
    await builder.buildApp();

    const { startProdServer } = await import("../packages/vinext/src/server/prod-server.js");
    ({ server } = await startProdServer({
      port: 0,
      outDir: path.join(fixtureDir, "dist"),
      noCompression: true,
    }));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    // React installs its server dispatcher with the first Flight request.
    await fetch(new URL("/", baseUrl), { headers: RSC_HEADERS }).then((res) => res.text());
  }, 120_000);

  afterAll(() => {
    server?.close();
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  async function get(
    pathname: string,
    options: { rsc?: boolean; user?: string } = {},
  ): Promise<PageResponse> {
    const headers: Record<string, string> = options.rsc ? { ...RSC_HEADERS } : {};
    if (options.user) headers.Cookie = `user=${options.user}`;
    const response = await fetch(new URL(pathname, baseUrl), {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      body: await response.text(),
      cache: response.headers.get("x-vinext-cache"),
      status: response.status,
    };
  }

  it.each([
    ["/conn", false, "live-layout"],
    ["/conn", true, "live-layout"],
    ["/conn-page", false, "live-page"],
    ["/conn-page", true, "live-page"],
  ])(
    "renders %s (RSC: %s) whose cache() loader awaits connection()",
    async (pathname, rsc, live) => {
      const response = await get(pathname, { rsc });
      expect(response.status).toBe(200);
      expect(response.body).toContain(live);
    },
  );

  it.each([
    ["a layout", "/user"],
    ["generateMetadata() and the page", "/metadata-user"],
  ])(
    "never stores or serves a cookies() read through cache() in %s",
    async (_, pathname) => {
      const users = ["alice", "bob", "carol", "dave"];
      for (const rsc of [true, false]) {
        for (const user of users) {
          const response = await get(pathname, { rsc, user });
          expect(response.status).toBe(200);
          expect(response.cache, `${user} (RSC: ${rsc})`).not.toBe("HIT");
          expect(response.body).toContain(user);
          for (const other of users) {
            if (other !== user) expect(response.body).not.toContain(other);
          }
          await new Promise((resolve) => setTimeout(resolve, CACHE_WRITE_WINDOW_MS));
        }
      }
    },
    30_000,
  );

  it.each([false, true])(
    "gives generateMetadata() and the page the same cache() value (RSC: %s)",
    async (rsc) => {
      const { body } = await get("/metadata-random", { rsc });
      const title = body.match(/random (0\.\d+)/)?.[1];
      const value = rsc
        ? body.match(/"data-testid":"random","children":"([^"]+)"/)?.[1]
        : body.match(/data-testid="random">([^<]+)</)?.[1];
      expect(title).toBeDefined();
      expect(value).toBe(title);
    },
  );
});
