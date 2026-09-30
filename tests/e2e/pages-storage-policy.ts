import { expect, test } from "@playwright/test";

// Verified against next@16.2.7 production, HTML and _next/data requests.
// https://github.com/vercel/next.js/blob/v16.2.7/test/e2e/getserversideprops/test/index.test.ts
export function testPagesStoragePolicies(fallbackBaseURL?: string): void {
  test("Pages API storage ignores browser policy", async ({ baseURL, request }) => {
    const base = baseURL ?? fallbackBaseURL;
    const url = `${base}/api/pages-storage-policy/header-only`;
    const read = async () => {
      const response = await request.get(url);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("public, max-age=3600");
      return (await response.json()).renderId as string;
    };
    expect(await read()).not.toBe(await read());
  });
  for (const [scenario, policy] of [
    ["short-browser", "public, max-age=1"],
    ["long-browser", "private, max-age=300"],
    ["no-store", "no-store"],
    ["gssp", "public, max-age=3600"],
  ] as const) {
    test(`Pages storage ignores browser policy: ${scenario}`, async ({
      baseURL,
      request,
      page,
    }) => {
      test.setTimeout(45_000);
      const base = baseURL ?? fallbackBaseURL;
      test.skip(
        process.env.VINEXT_E2E_CACHE_BACKEND === "workers-cache" && !base?.startsWith("https://"),
        "Workers Cache storage requires the deployed edge",
      );
      const url = `${base}/storage-policy/${scenario}`;
      const read = async () => {
        const response = await request.get(url);
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toBe(policy);
        const html = await response.text();
        const json = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
        expect(json).toBeTruthy();
        const data = JSON.parse(json!);
        expect(data.props.pageProps.renderId).toEqual(expect.any(String));
        return {
          renderId: data.props.pageProps.renderId as string,
          buildId: data.buildId as string,
        };
      };
      const first = await read();
      const dataURL = `${base}/_next/data/${first.buildId}/storage-policy/${scenario}.json`;
      const readData = async () => {
        const dataResponse = await request.get(dataURL);
        expect(dataResponse.status()).toBe(200);
        return (await dataResponse.json()).pageProps.renderId as string;
      };
      const dataId = await readData();
      if (scenario === "gssp") {
        expect((await read()).renderId).not.toBe(first.renderId);
        expect(await readData()).not.toBe(dataId);
      } else {
        expect((await read()).renderId).toBe(first.renderId);
        expect(await readData()).toBe(dataId);
        await new Promise((resolve) => setTimeout(resolve, 3200));
        if (scenario === "long-browser") {
          await expect
            .poll(async () => (await read()).renderId, { timeout: 15000 })
            .not.toBe(first.renderId);
          await expect.poll(readData, { timeout: 15000 }).not.toBe(dataId);
        } else {
          expect((await read()).renderId).toBe(first.renderId);
          expect(await readData()).toBe(dataId);
        }
      }
      const browserResponse = await page.goto(url);
      expect(browserResponse?.headers()["cache-control"]).toBe(policy);
      await expect(page.getByTestId("storage-render-id")).toHaveText(/^[a-f0-9-]{36}$/);
    });
  }
}
