import { expect, test } from "@playwright/test";

// Next.js stores route revalidation separately from response headers:
// https://github.com/vercel/next.js/blob/v16.2.7/packages/next/src/build/templates/app-route.ts
// https://github.com/vercel/next.js/blob/v16.2.7/test/e2e/app-dir/app-routes/app-custom-routes.test.ts
// Reproduced against next@16.2.7 build/start; these fixtures set no provider headers.
export function testRouteHandlerStoragePolicies(): void {
  for (const kind of ["api", "metadata"] as const) {
    for (const [scenario, apiPolicy, cached] of [
      ["header-only", "public, max-age=3600", false],
      ["short-browser", "public, max-age=1", true],
      ["long-browser", "public, max-age=3600", true],
      ["private", "private, max-age=300", true],
      ["no-store", "no-store", true],
      ["control", undefined, true],
      ["force-static", "private, max-age=300", true],
      ["infinite", "no-store", true],
      ["request-read", "public, max-age=300", false],
    ] as const) {
      if (kind === "metadata" && ["header-only", "control", "infinite"].includes(scenario))
        continue;
      const policy =
        kind === "metadata" && scenario === "request-read" ? "private, max-age=300" : apiPolicy;
      test(`framework storage ignores browser policy: ${kind} ${scenario}`, async ({
        baseURL,
        request,
        page,
      }) => {
        test.setTimeout(45_000);
        test.skip(
          process.env.VINEXT_E2E_CACHE_BACKEND === "workers-cache" &&
            !baseURL?.startsWith("https://"),
          "Workers Cache storage requires the deployed edge",
        );
        const url =
          kind === "api"
            ? `${baseURL}/api/storage-policy/${scenario}`
            : `${baseURL}/metadata-storage/${scenario}/opengraph-image`;
        const read = async () => {
          const response = await request.get(url, { headers: { "x-visitor": "alice" } });
          expect(response.status()).toBe(200);
          if (policy !== undefined) expect(response.headers()["cache-control"]).toBe(policy);
          const body =
            kind === "api"
              ? await response.json()
              : {
                  renderId: response.headers()["x-render-id"],
                  visitor: response.headers()["x-visitor"],
                };
          if (kind === "metadata")
            expect([...(await response.body()).subarray(0, 4)]).toEqual([137, 80, 78, 71]);
          expect(body.renderId).toEqual(expect.any(String));
          if (scenario === "request-read") expect(body.visitor).toBe("alice");
          if (kind === "metadata" && scenario === "force-static")
            expect(body.visitor).toBe("anonymous");
          return {
            renderId: body.renderId as string,
            hit: [
              response.headers()["x-vinext-cache"],
              response.headers()["cf-cache-status"],
            ].includes("HIT"),
          };
        };
        let first = await read();
        if (cached) {
          await expect
            .poll(
              async () => {
                first = await read();
                return first.hit;
              },
              { timeout: 15_000 },
            )
            .toBe(true);
          const head = await request.head(url);
          expect(head.status()).toBe(200);
          if (policy !== undefined) expect(head.headers()["cache-control"]).toBe(policy);
          expect(await head.body()).toHaveLength(0);
          const regenerates =
            scenario === "long-browser" || (kind === "metadata" && scenario === "force-static");
          if (scenario === "short-browser" || regenerates) {
            await new Promise((resolve) => setTimeout(resolve, 3_200));
          }
          if (regenerates) {
            await expect
              .poll(async () => (await read()).renderId, { timeout: 15_000 })
              .not.toBe(first.renderId);
          } else {
            expect((await read()).renderId).toBe(first.renderId);
          }
        } else {
          const second = await read();
          expect(second.hit).toBe(false);
          expect(second.renderId).not.toBe(first.renderId);
        }
        if (scenario === "no-store") {
          const path = new URL(url).pathname;
          const invalidated = process.env.VINEXT_E2E_CACHE_BACKEND
            ? await request.post(`${baseURL}/api/revalidate-path`, { data: { path } })
            : await request.get(`${baseURL}/api/revalidate-isr?path=${encodeURIComponent(path)}`);
          expect(invalidated.ok()).toBe(true);
          await expect
            .poll(async () => (await read()).renderId, { timeout: 15000 })
            .not.toBe(first.renderId);
        }
        if (policy !== undefined) {
          const browserResponse = await page.goto(url);
          expect(browserResponse?.headers()["cache-control"]).toBe(policy);
        }
      });
    }
  }
}
