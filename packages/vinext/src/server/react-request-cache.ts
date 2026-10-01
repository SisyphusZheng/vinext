/**
 * One `React.cache()` scope shared by an App Router page's metadata and its
 * Flight render.
 *
 * React's server dispatcher only memoizes `cache()` while a Flight request is
 * active; outside of one, `getCacheForType()` hands back a fresh Map on every
 * call. vinext resolves generateMetadata()/generateViewport() before
 * `renderToReadableStream()` starts, so without a shared scope every
 * `cache()`-wrapped loader they call runs again in the Flight render, and
 * metadata can see different values from the page. Next.js resolves metadata
 * inside its Flight render, so both see one value.
 *
 * `enableReactRequestCache()` opens a request-owned cache that metadata and
 * the request's Flight renders share. React has no option to seed a Flight
 * request's cache, so this wraps the dispatcher's `getCacheForType()` once per
 * isolate. The wrapper defers to React when:
 *
 * - no page render has enabled the scope (route handlers, server action
 *   bodies, middleware, the Pages Router),
 * - the call runs inside a layout/page probe. Probes run components in an
 *   order a render never would (a layout before its page), in scopes where
 *   connection() never settles and dynamic usage stays local, so their values
 *   must not reach the render,
 * - the call runs inside `"use cache"` or `unstable_cache()`, which own the
 *   reuse of their results,
 * - the response has closed, so `after()` callbacks see React's behaviour
 *   outside a render, as in Next.js.
 *
 * React installs its dispatcher when the isolate creates its first Flight
 * request, so until then `cache()` keeps React's behaviour outside a render.
 *
 * @module
 */

import * as React from "react";
import { isInsideAnyCacheScope } from "vinext/shims/internal/headers-state";
import { getRequestContext, isInsideUnifiedScope } from "vinext/shims/unified-request-context";

type ReactAsyncDispatcher = {
  getCacheForType: (resourceType: () => unknown) => unknown;
};

const REACT_SERVER_INTERNALS_KEY =
  "__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";
// Registered globally so module instances from separate Vite environments or
// HMR never wrap the same dispatcher twice.
const DISPATCHER_WRAPPED = Symbol.for("vinext.reactRequestCache.wrapped");

function readActiveRequestCache(): Map<() => unknown, unknown> | null {
  if (!isInsideUnifiedScope()) return null;
  const ctx = getRequestContext();
  const cache = ctx.reactRequestCacheScope?.cache ?? null;
  // A probe's scope keeps its (possibly inactive) connectionProbe after the
  // probe returns, so its late continuations stay excluded too.
  if (
    cache === null ||
    ctx.connectionProbe !== null ||
    ctx.afterContext.responseClosed ||
    isInsideAnyCacheScope()
  ) {
    return null;
  }
  return cache;
}

function readReactAsyncDispatcher(): ReactAsyncDispatcher | null {
  const internals: unknown = Reflect.get(React, REACT_SERVER_INTERNALS_KEY);
  if (typeof internals !== "object" || internals === null) return null;
  const dispatcher: unknown = Reflect.get(internals, "A");
  if (typeof dispatcher !== "object" || dispatcher === null) return null;
  if (typeof Reflect.get(dispatcher, "getCacheForType") !== "function") return null;
  return dispatcher as ReactAsyncDispatcher;
}

function wrapReactAsyncDispatcher(): void {
  const dispatcher = readReactAsyncDispatcher();
  // React rejects a replaced dispatcher object ("only one RSC renderer"), so
  // wrap the method on the object it installed.
  if (dispatcher === null || Reflect.get(dispatcher, DISPATCHER_WRAPPED) === true) return;

  const getCacheForType = dispatcher.getCacheForType;
  dispatcher.getCacheForType = function (this: ReactAsyncDispatcher, resourceType) {
    const cache = readActiveRequestCache();
    if (cache === null) return getCacheForType.call(this, resourceType);
    // Same lookup as React's getCacheForType(), against the request's Map.
    let entry = cache.get(resourceType);
    if (entry === undefined) {
      entry = resourceType();
      cache.set(resourceType, entry);
    }
    return entry;
  };
  Reflect.set(dispatcher, DISPATCHER_WRAPPED, true);
}

/** Open the shared `React.cache()` scope for the current page request. */
export function enableReactRequestCache(): void {
  if (!isInsideUnifiedScope()) return;
  wrapReactAsyncDispatcher();
  // A context created before an HMR update may predate the scope field.
  const scope = (getRequestContext().reactRequestCacheScope ??= { cache: null });
  scope.cache ??= new Map();
}

/**
 * Drop the values cached so far, so a throwaway render (a PPR fallback-shell
 * warm-up) doesn't hand them to the render that replaces it.
 */
export function resetReactRequestCache(): void {
  if (!isInsideUnifiedScope()) return;
  const scope = getRequestContext().reactRequestCacheScope;
  if (scope) scope.cache = null;
}
