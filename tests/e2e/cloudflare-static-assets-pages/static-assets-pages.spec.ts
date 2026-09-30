import { expect, test, type APIResponse } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixture = path.resolve("tests/e2e/cloudflare-static-assets-pages/fixture");
const cacheDir = path.join(fixture, "dist/client/_vinext/static-cache");

function expectHit(response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()["x-vinext-cache"]).toBe("HIT");
}

// Next.js stores and serves both HTML and page data for prerendered Pages routes:
// https://github.com/vercel/next.js/blob/canary/test/e2e/prerender.test.ts
test("prerendered Pages HTML and navigation JSON are build-time cache hits", async ({
  request,
}) => {
  const buildId = fs.readFileSync(path.join(fixture, "dist/server/BUILD_ID"), "utf8").trim();
  for (const pathname of [
    "/posts/first",
    "/posts/second",
    "/posts/caf%C3%A9",
    "/posts/with%20space",
  ]) {
    const response = await request.get(`${pathname}?source=first`);
    expectHit(response);
    const html = await response.text();
    expect(html).toContain('id="render-source">build-time</p>');
    const data = await request.get(`/_next/data/${buildId}${pathname}.json?source=second`);
    expectHit(data);
    const props = await data.json();
    expect(props.pageProps.source).toBe("build-time");
    expect(html).toContain(props.pageProps.generation);
  }
});

test("automatically static pages are served from the packaged HTML", async ({ request }) => {
  for (const suffix of ["", "?source=nav"]) {
    const response = await request.get(`/${suffix}`);
    expectHit(response);
    expect(await response.text()).toContain('id="render-source">build-time</p>');
  }
});

test("client navigation reuses build-time page data without a document reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => {
    const router = window.next?.router;
    return router && "isReady" in router && router.isReady;
  });
  await page.evaluate(() => Reflect.set(window, "__staticAssetsNoReload", true));
  const dataResponse = page.waitForResponse((response) =>
    /\/_next\/data\/[^/]+\/posts\/first\.json/.test(response.url()),
  );
  await page.getByRole("link", { name: "First post" }).click();
  expect((await dataResponse).headers()["x-vinext-cache"]).toBe("HIT");
  await expect(page.locator("#render-source")).toHaveText("build-time");
  await expect(page.getByRole("heading", { name: "Post: first" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__staticAssetsNoReload"))).toBe(true);
});

test("finite ISR and on-demand revalidation leave the packaged snapshot unchanged", async ({
  request,
}) => {
  const initial = await request.get("/posts/first");
  expectHit(initial);
  const snapshot = await initial.text();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect((await request.get("/api/revalidate")).status()).toBe(200);
  const response = await request.get("/posts/first");
  expectHit(response);
  expect(await response.text()).toBe(snapshot);
});

test("SSR and unlisted fallback paths render at runtime without being persisted", async ({
  request,
}) => {
  for (const pathname of ["/dynamic", "/posts/unlisted"]) {
    const first = await request.get(pathname);
    const second = await request.get(pathname);
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect(first.headers()["x-vinext-cache"]).not.toBe("HIT");
    expect(second.headers()["x-vinext-cache"]).not.toBe("HIT");
    expect(await second.text()).not.toBe(await first.text());
  }
});

test("preview bypasses the prerendered page", async ({ request }) => {
  expect((await request.get("/api/preview")).status()).toBe(200);
  const response = await request.get("/posts/first");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-vinext-cache"]).not.toBe("HIT");
  expect(await response.text()).toContain('id="render-source">preview</p>');
});

// https://github.com/vercel/next.js/blob/canary/test/e2e/500-page/500-page-build.test.ts
test("a prerendered custom 500 preserves the server error status", async ({ request }) => {
  for (const pathname of ["/dynamic?fail=1", "/500"]) {
    const response = await request.get(pathname);
    expect(response.status()).toBe(500);
    expect(response.headers()["x-vinext-cache"]).toBe("HIT");
    const html = await response.text();
    expect(html).toContain("Static Assets server error");
    expect(html).toContain('id="render-source">build-time</p>');
  }
});

test("a prerendered 404 retains source response cookies without persisting them", async ({
  request,
}) => {
  const response = await request.get("/dynamic?missing=1");
  expect(response.status()).toBe(404);
  expect(response.headers()["x-vinext-cache"]).toBe("HIT");
  expect(response.headers()["set-cookie"]).toContain("session=expired");
  expect(response.headers()["x-not-found-source"]).toBe("dynamic-page");
  expect(await response.text()).toContain('id="render-source">build-time</p>');

  const other = await request.get("/missing-page");
  expect(other.status()).toBe(404);
  expect(other.headers()["set-cookie"]).toBeUndefined();
  expect(other.headers()["x-not-found-source"]).toBeUndefined();
});

test("private artifacts remain inaccessible and the custom 404 keeps its status", async ({
  request,
}) => {
  const artifacts = fs.readdirSync(cacheDir);
  expect(artifacts).toContain("index.json");
  for (const artifact of artifacts) {
    const response = await request.get(`/_vinext/static-cache/${artifact}`);
    expect(response.status(), artifact).toBe(404);
  }
  const missing = await request.get("/missing-page");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["x-vinext-cache"]).toBe("HIT");
  const html = await missing.text();
  expect(html).toContain("Static Assets page not found");
  expect(html).toContain('id="render-source">build-time</p>');
});

// Next.js keeps the prerendered not-found document separate from runtime errors.
// https://github.com/vercel/next.js/blob/canary/test/e2e/500-page/500-page-build.test.ts
test("custom _error uses its 404 snapshot without reusing it for server errors", async ({
  request,
}) => {
  const missing = await request.get("http://localhost:4217/missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["x-vinext-cache"]).toBe("HIT");
  expect(await missing.text()).toContain('id="render-source">build-time</p>');

  const failure = await request.get("http://localhost:4217/dynamic?fail=1");
  expect(failure.status()).toBe(500);
  expect(failure.headers()["x-vinext-cache"]).not.toBe("HIT");
  expect(await failure.text()).toContain('id="render-source">runtime</p>');
});

// Domain contexts can change defaultLocale and generated links even for the
// same locale. Generic build snapshots must not be aliased across domains.
test("i18n domains render their own context instead of a locale-only snapshot", async ({
  request,
}) => {
  for (const [host, defaultLocale] of [
    ["en.example", "en"],
    ["fr.example", "fr"],
  ]) {
    const response = await request.get("http://localhost:4217/en", { headers: { Host: host } });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-vinext-cache"]).not.toBe("HIT");
    const html = await response.text();
    expect(html).toContain('id="locale">en</p>');
    expect(html).toContain(`id="default-locale">${defaultLocale}</p>`);
  }
});
