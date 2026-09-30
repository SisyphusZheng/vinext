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

test("cached pages preserve Document status and content type without replaying cookies", async ({
  request,
}) => {
  const response = await request.get("/accepted");
  expect(response.status()).toBe(202);
  expect(response.headers()["x-vinext-cache"]).toBe("HIT");
  expect(response.headers()["content-type"]).toBe("application/xhtml+xml; charset=utf-8");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(await response.text()).toContain("Accepted static page");
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
  // This path list exists only at build time. Its finite TTL must not turn
  // immutable packaged entries into misses that rerun runtime getStaticPaths.
  const buildOnly = await request.get("http://localhost:4217/fr/posts/first/");
  expectHit(buildOnly);
  expect(await buildOnly.text()).toContain('id="render-source">build-time</p>');
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

// Next.js caches terminal GSP results, including redirect props and null notFound entries.
// https://github.com/vercel/next.js/blob/canary/test/e2e/prerender.test.ts
test("build-time redirects stay immutable for HTML and data", async ({ request }) => {
  const buildId = fs.readFileSync(path.join(fixture, "dist/server/BUILD_ID"), "utf8").trim();
  const redirect = await request.get("/redirect", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["location"]).toBe("/posts/first?from=build");
  expect(redirect.headers()["x-vinext-cache"]).toBe("HIT");
  const data = await request.get(`/_next/data/${buildId}/redirect.json`);
  expectHit(data);
  expect(await data.json()).toMatchObject({
    pageProps: {
      __N_REDIRECT: "/posts/first?from=build",
      __N_REDIRECT_STATUS: 307,
    },
  });
});

test("build-time notFound results stay immutable for HTML and data", async ({ request }) => {
  const buildId = fs.readFileSync(path.join(fixture, "dist/server/BUILD_ID"), "utf8").trim();
  const removed = await request.get("/removed");
  expect(removed.status()).toBe(404);
  expect(removed.headers()["x-vinext-cache"]).toBe("HIT");
  expect(await removed.text()).toContain("Static Assets page not found");
  const removedData = await request.get(`/_next/data/${buildId}/removed.json`);
  expect(removedData.status()).toBe(404);
  expect(removedData.headers()["x-vinext-cache"]).toBe("HIT");
  expect(await removedData.json()).toEqual({ notFound: true });
});

test("locale-prefixed static pages and getStaticPaths variants use their build snapshots", async ({
  request,
}) => {
  const errorFixture = path.resolve("tests/e2e/cloudflare-static-assets-pages/error-fixture");
  const buildId = fs.readFileSync(path.join(errorFixture, "dist/server/BUILD_ID"), "utf8").trim();
  for (const pathname of ["/fr", "/fr/posts/first", "/fr/posts/string", "/fr/posts/french-only"]) {
    const response = await request.get(`http://localhost:4217${pathname}`);
    expectHit(response);
    expect(await response.text()).toContain('id="locale">fr</p>');
  }
  const data = await request.get(`http://localhost:4217/_next/data/${buildId}/fr/posts/first.json`);
  expectHit(data);
  expect(await data.json()).toMatchObject({ pageProps: { locale: "fr", source: "build-time" } });
  const unlistedLocale = await request.get("http://localhost:4217/posts/french-only");
  expect(unlistedLocale.status()).toBe(404);
  const missing = await request.get("http://localhost:4217/fr/missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["x-vinext-cache"]).toBe("HIT");
  expect(await missing.text()).toContain('id="render-source">build-time</p>');
});

test("cached internal redirects preserve client navigation", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => {
    const router = window.next?.router;
    return router && "isReady" in router && router.isReady;
  });
  await page.evaluate(() => Reflect.set(window, "__redirectNoReload", true));
  await page.evaluate(async () => {
    const router = window.next?.router;
    if (!router || !("push" in router)) throw new Error("Pages router is not ready");
    await router.push("/redirect");
  });
  await expect(page).toHaveURL(/\/posts\/first\?from=build$/);
  await expect(page.locator("#render-source")).toHaveText("build-time");
  expect(await page.evaluate(() => Reflect.get(window, "__redirectNoReload"))).toBe(true);
});

// Ported from Next.js: test/e2e/prerender.test.ts (encoded paths)
// https://github.com/vercel/next.js/blob/canary/test/e2e/prerender.test.ts
test("equivalent encodings hit the same snapshot while escaped delimiters stay distinct", async ({
  request,
}) => {
  const buildId = fs.readFileSync(path.join(fixture, "dist/server/BUILD_ID"), "utf8").trim();
  for (const [slug, encodings] of [
    ["first", ["first", "%66irst"]],
    ["café", ["caf%C3%A9", "caf%c3%a9"]],
    ["a/b", ["a%2Fb", "a%2fb"]],
    ["a%2Fb", ["a%252Fb"]],
    ["a?b", ["a%3Fb"]],
    ["a#b", ["a%23b"]],
    ["a\\b", ["a%5Cb"]],
    ["%66irst", ["%2566irst"]],
  ] as const) {
    let generation: string | undefined;
    for (const encoded of encodings) {
      const html = await request.get(`/posts/${encoded}`);
      expectHit(html);
      const data = await request.get(`/_next/data/${buildId}/posts/${encoded}.json`);
      expectHit(data);
      const props = (await data.json()).pageProps;
      expect(props.slug).toBe(slug);
      expect(props.source).toBe("build-time");
      expect(await html.text()).toContain(props.generation);
      if (generation) expect(props.generation).toBe(generation);
      generation = props.generation;
    }
  }
});

test("default-locale paths named after locales keep their own terminal snapshots", async ({
  request,
}) => {
  const errorFixture = path.resolve("tests/e2e/cloudflare-static-assets-pages/error-fixture");
  const buildId = fs.readFileSync(path.join(errorFixture, "dist/server/BUILD_ID"), "utf8").trim();
  const redirect = await request.get("http://localhost:4217/en/fr/", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["location"]).toBe("/posts/first/?from=default-fr");
  expect(redirect.headers()["x-vinext-cache"]).toBe("HIT");
  const data = await request.get(`http://localhost:4217/_next/data/${buildId}/en/fr.json`);
  expectHit(data);
  expect((await data.json()).pageProps.__N_REDIRECT).toBe("/posts/first/?from=default-fr");
  const notFound = await request.get(`http://localhost:4217/_next/data/${buildId}/en/en.json`);
  expect(notFound.status()).toBe(404);
  expect(notFound.headers()["x-vinext-cache"]).toBe("HIT");
  expect(await notFound.json()).toEqual({ notFound: true });
  const frenchRoot = await request.get("http://localhost:4217/fr/");
  expectHit(frenchRoot);
  expect(await frenchRoot.text()).toContain('id="locale">fr</p>');
});

test("locale snapshots share encoded and trailing-slash request identities", async ({
  request,
}) => {
  const errorFixture = path.resolve("tests/e2e/cloudflare-static-assets-pages/error-fixture");
  const buildId = fs.readFileSync(path.join(errorFixture, "dist/server/BUILD_ID"), "utf8").trim();
  for (const prefix of ["", "/en", "/fr"]) {
    for (const slug of ["first", "%66irst"]) {
      const response = await request.get(`http://localhost:4217${prefix}/posts/${slug}/`);
      expectHit(response);
      expect(await response.text()).toContain('id="render-source">build-time</p>');
      const data = await request.get(
        `http://localhost:4217/_next/data/${buildId}${prefix}/posts/${slug}.json`,
      );
      expectHit(data);
      expect((await data.json()).pageProps.locale).toBe(prefix === "/fr" ? "fr" : "en");
    }
  }
});

test("rewrites serve public assets but cannot expose private cache artifacts", async ({
  request,
}) => {
  const artifacts = fs.readdirSync(cacheDir);
  for (const phase of ["before", "after", "fallback"]) {
    for (const [pathname, body] of [
      ["visible.txt", "Public fixture asset\n"],
      ["%76isible.txt", "Public fixture asset\n"],
      ["caf%c3%a9.txt", "Unicode public fixture asset\n"],
    ]) {
      const publicAsset = await request.get(`/${phase}/${pathname}`);
      expect(publicAsset.status()).toBe(200);
      expect(await publicAsset.text()).toBe(body);
    }
    for (const artifact of artifacts) {
      for (const directory of ["_vinext", "%5fvinext"]) {
        const response = await request.get(`/${phase}/${directory}/static-cache/${artifact}`);
        expect(response.status(), `${phase}/${directory}/${artifact}`).toBe(404);
      }
    }
  }
});
