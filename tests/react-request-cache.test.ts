import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vite-plus/test";

const execFileAsync = promisify(execFile);

type ScenarioResults = {
  beforeFirstFlightRequest: string[];
  sharedScope: { calls: string[]; sameValue: boolean };
  concurrentRequests: { calls: string[]; isolated: boolean };
  notEnabled: string[];
  cacheScopes: string[];
  nestedScope: string[];
  thrownError: { calls: string[]; sameError: boolean };
  responseClosed: string[];
  reset: string[];
};

// React's server dispatcher only exists under the `react-server` condition, so
// these scenarios run real React Flight in a subprocess (see
// tests/app-render-dependency.test.ts).
async function runScenarios(): Promise<ScenarioResults> {
  const shimsSrc = path.resolve(import.meta.dirname, "../packages/vinext/src/shims");
  const script = String.raw`
    import React from "react";
    import { createServer } from "vite";
    import { renderToReadableStream } from "./node_modules/@vitejs/plugin-rsc/dist/vendor/react-server-dom/server.edge.js";

    const vite = await createServer({
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      mode: "production",
      resolve: { alias: { "vinext/shims": ${JSON.stringify(shimsSrc)} } },
      server: { middlewareMode: true },
      // Load React's server build in the source modules too.
      ssr: { resolve: { conditions: ["react-server"], externalConditions: ["react-server"] } },
    });

    try {
      const { enableReactRequestCache, resetReactRequestCache } = await vite.ssrLoadModule(
        "/packages/vinext/src/server/react-request-cache.ts",
      );
      const {
        closeAfterResponse,
        createRequestContext,
        runWithRequestContext,
        runWithUnifiedStateMutation,
      } = await vite.ssrLoadModule("/packages/vinext/src/shims/unified-request-context.ts");
      const { getOrCreateAls } = await vite.ssrLoadModule(
        "/packages/vinext/src/shims/internal/als-registry.ts",
      );
      const unstableCacheAls = getOrCreateAls("vinext.unstableCache.als");
      const useCacheAls = getOrCreateAls("vinext.cacheRuntime.contextAls");

      async function renderFlight(model) {
        const stream = renderToReadableStream(model, null, { onError: () => "digest" });
        const reader = stream.getReader();
        while (!(await reader.read()).done) {}
      }

      function createLoader(calls) {
        return React.cache(async (id) => {
          calls.push(id);
          return { id };
        });
      }

      // Probe a layout, resolve its generateMetadata(), then render it in
      // Flight, the order an App Router page request runs them in.
      async function runPageRequest(load, id, options = {}) {
        return runWithRequestContext(createRequestContext(), async () => {
          if (options.enable !== false) enableReactRequestCache();
          async function Layout() {
            const release = await load(id);
            return React.createElement("p", null, release.id);
          }
          async function generateMetadata() {
            const release = await load(id);
            return { title: release.id };
          }
          await Layout();
          await generateMetadata();
          let rendered;
          await renderFlight(
            React.createElement(async function Page() {
              rendered = await load(id);
              return React.createElement(Layout);
            }),
          );
          return rendered;
        });
      }

      const results = {};

      {
        const calls = [];
        await runPageRequest(createLoader(calls), "first");
        results.beforeFirstFlightRequest = calls;
      }

      {
        const calls = [];
        const load = createLoader(calls);
        let probed;
        const rendered = await runWithRequestContext(createRequestContext(), async () => {
          enableReactRequestCache();
          probed = await load("v22");
          await load("v22");
          let value;
          await renderFlight(
            React.createElement(async function Page() {
              value = await load("v22");
              return null;
            }),
          );
          return value;
        });
        results.sharedScope = { calls, sameValue: probed === rendered };
      }

      {
        const calls = [];
        const load = createLoader(calls);
        const [a, b] = await Promise.all([
          runPageRequest(load, "v22"),
          runPageRequest(load, "v22"),
        ]);
        results.concurrentRequests = { calls, isolated: a !== b };
      }

      {
        const calls = [];
        await runPageRequest(createLoader(calls), "v22", { enable: false });
        results.notEnabled = calls;
      }

      {
        const calls = [];
        const load = createLoader(calls);
        await runWithRequestContext(createRequestContext(), async () => {
          enableReactRequestCache();
          await load("request");
          await unstableCacheAls.run(true, () => load("request"));
          await useCacheAls.run({ variant: "default" }, () => load("request"));
          await load("request");
        });
        results.cacheScopes = calls;
      }

      {
        const calls = [];
        const load = createLoader(calls);
        await runWithRequestContext(createRequestContext(), async () => {
          await runWithUnifiedStateMutation(
            () => {},
            async () => {
              enableReactRequestCache();
              await load("nested");
            },
          );
          await load("nested");
        });
        results.nestedScope = calls;
      }

      {
        const calls = [];
        const load = React.cache((id) => {
          calls.push(id);
          throw new Error("not found");
        });
        let probeError;
        let renderError;
        await runWithRequestContext(createRequestContext(), async () => {
          enableReactRequestCache();
          try {
            load("missing");
          } catch (error) {
            probeError = error;
          }
          await renderFlight(
            React.createElement(function Page() {
              try {
                load("missing");
              } catch (error) {
                renderError = error;
              }
              return null;
            }),
          );
        });
        results.thrownError = { calls, sameError: probeError === renderError };
      }

      {
        const calls = [];
        const load = createLoader(calls);
        const ctx = createRequestContext();
        await runWithRequestContext(ctx, async () => {
          enableReactRequestCache();
          await load("after");
          await closeAfterResponse(ctx);
          await load("after");
        });
        results.responseClosed = calls;
      }

      {
        const calls = [];
        const load = createLoader(calls);
        await runWithRequestContext(createRequestContext(), async () => {
          enableReactRequestCache();
          await load("warm-up");
          resetReactRequestCache();
          enableReactRequestCache();
          await load("warm-up");
          await load("warm-up");
        });
        results.reset = calls;
      }

      process.stdout.write(JSON.stringify(results));
    } finally {
      await vite.close();
    }
  `;

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions", "react-server", "--input-type=module", "-e", script],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, NODE_ENV: "production" },
      timeout: 30_000,
    },
  );
  return JSON.parse(stdout) as ScenarioResults;
}

describe("React.cache() request scope", () => {
  let results: ScenarioResults;

  beforeAll(async () => {
    results = await runScenarios();
  }, 60_000);

  it("keeps React's behaviour until the isolate creates its first Flight request", () => {
    // React installs its server dispatcher with the first Flight request, so
    // only the render memoizes here.
    expect(results.beforeFirstFlightRequest).toEqual(["first", "first", "first"]);
  });

  it("runs a cache() loader once across the probe, generateMetadata and the Flight render", () => {
    expect(results.sharedScope).toEqual({ calls: ["v22"], sameValue: true });
  });

  it("gives each concurrent request its own scope", () => {
    expect(results.concurrentRequests).toEqual({ calls: ["v22", "v22"], isolated: true });
  });

  it("keeps React's behaviour outside an enabled page render", () => {
    // The probe and generateMetadata each get a fresh cache; the render
    // memoizes within itself.
    expect(results.notEnabled).toEqual(["v22", "v22", "v22"]);
  });

  it('leaves "use cache" and unstable_cache() scopes to React', () => {
    expect(results.cacheScopes).toEqual(["request", "request", "request"]);
  });

  it("shares a scope enabled inside a nested request scope with its parent", () => {
    expect(results.nestedScope).toEqual(["nested"]);
  });

  it("rethrows an error cached during the probe in the render, as one render would", () => {
    expect(results.thrownError).toEqual({ calls: ["missing"], sameError: true });
  });

  it("stops sharing once the response has closed", () => {
    expect(results.responseClosed).toEqual(["after", "after"]);
  });

  it("drops cached values on reset", () => {
    expect(results.reset).toEqual(["warm-up", "warm-up"]);
  });
});
