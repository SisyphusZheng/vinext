import { NEXTJS_CACHE_HEADER, VINEXT_CACHE_HEADER } from "vinext/internal/server/headers";
import { isNonCacheableCacheControl, splitCacheControlDirectives } from "vinext/shims/cdn-cache";

export type SharedResponseStage = {
  headers: Headers;
  status: number;
  requiresBrowserRevalidation: boolean;
};

const CLOUDFLARE_EDGE_POLICY_HEADER = "Cloudflare-CDN-Cache-Control";
export const SHARED_RESPONSE_STAGE_HEADER = "x-vinext-cloudflare-shared-response-stage";
const PRIVATE_RESPONSE_HEADERS = new Set([
  SHARED_RESPONSE_STAGE_HEADER,
  CLOUDFLARE_EDGE_POLICY_HEADER.toLowerCase(),
  "cdn-cache-control",
  "cache-tag",
  VINEXT_CACHE_HEADER.toLowerCase(),
  NEXTJS_CACHE_HEADER.toLowerCase(),
]);

export function finalizeGatewayResponse(
  response: Response,
  sharedResponses: Map<string, SharedResponseStage>,
  cacheStatusHeader = "CF-Cache-Status",
): Response {
  const provenance = response.headers.get(SHARED_RESPONSE_STAGE_HEADER);
  const sharedResponse = provenance === null ? undefined : sharedResponses.get(provenance);
  const usedSharedResponseStage = sharedResponse !== undefined;
  // The marker is reserved for adapter-internal provenance. If outer response
  // composition replaces it, fail closed rather than forwarding shared cache
  // policy on a response whose origin can no longer be authenticated.
  const sharedResponseStageCollision = provenance !== null && !usedSharedResponseStage;
  const cacheControl = response.headers.get("Cache-Control");
  // Adding Vary selectors (including App Router's framework selectors) only
  // narrows downstream reuse. Every other header and the status must survive
  // unchanged before the gateway can retain an explicit browser lifetime.
  const vary = new Set(
    (response.headers.get("Vary") ?? "")
      .toLowerCase()
      .split(",")
      .map((name) => name.trim()),
  );
  const preservesBrowserPolicy =
    sharedResponse !== undefined &&
    !sharedResponse.requiresBrowserRevalidation &&
    cacheControl !== null &&
    cacheControl !== "public, max-age=0, must-revalidate" &&
    !response.headers.has("Set-Cookie") &&
    response.status === sharedResponse.status &&
    [...response.headers].every(
      ([name, value]) =>
        PRIVATE_RESPONSE_HEADERS.has(name) ||
        name === "vary" ||
        sharedResponse.headers.get(name) === value,
    ) &&
    [...sharedResponse.headers].every(
      ([name, value]) =>
        PRIVATE_RESPONSE_HEADERS.has(name) ||
        (name === "vary"
          ? value
              .toLowerCase()
              .split(",")
              .every((field) => vary.has(field.trim()))
          : response.headers.get(name) === value),
    );
  if (
    !response.headers.has(CLOUDFLARE_EDGE_POLICY_HEADER) &&
    !usedSharedResponseStage &&
    !sharedResponseStageCollision
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete(SHARED_RESPONSE_STAGE_HEADER);
  headers.delete(CLOUDFLARE_EDGE_POLICY_HEADER);
  if (usedSharedResponseStage || sharedResponseStageCollision) {
    for (const name of PRIVATE_RESPONSE_HEADERS) headers.delete(name);
    // The full invocation identity is private to the response cache. Even when
    // this request is unchanged, another visitor can take a different branch
    // through middleware, so downstream shared caches must never reuse it.
    const directives = splitCacheControlDirectives(cacheControl ?? "");
    if (cacheControl && !directives.some((directive) => /^no-store$/i.test(directive))) {
      // no-cache permits shared storage too. Only no-store can skip this;
      // qualified private directives do not make the whole response private.
      headers.set(
        "Cache-Control",
        [
          "private",
          ...directives.filter((directive) => !/^(?:public|private)(?:\s*=|$)/i.test(directive)),
        ].join(", "),
      );
    }
    if (!preservesBrowserPolicy && !isNonCacheableCacheControl(cacheControl ?? "", "browser")) {
      headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    }
  }
  const cacheStatus = sharedResponse?.headers.get(cacheStatusHeader);
  if (cacheStatus) {
    headers.set(VINEXT_CACHE_HEADER, cacheStatus);
    headers.set(NEXTJS_CACHE_HEADER, cacheStatus);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
