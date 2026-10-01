import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";

// connection() never settles inside vinext's layout/page probes, so a probe
// that calls this first must not hand its promise to the render.
export const getLive = cache(async (id: string) => {
  await connection();
  return `live-${id}`;
});

export const getUser = cache(async () => (await cookies()).get("user")?.value ?? "anonymous");

// Ported from Next.js: test/e2e/app-dir/metadata/app/cache-deduping/page.tsx
export const getRandom = cache(() => Math.random().toString());
