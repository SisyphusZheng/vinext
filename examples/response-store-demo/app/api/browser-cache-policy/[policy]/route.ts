const policies: Record<string, Record<string, string>> = {
  browser: {
    "Cache-Control": "max-age=10",
    "Cloudflare-CDN-Cache-Control": "max-age=3600",
  },
  shared: { "Cache-Control": "public, max-age=10, s-maxage=3600, stale-while-revalidate=60" },
  independent: {
    "Cache-Control": "max-age=10, stale-while-revalidate=60",
    "CDN-Cache-Control": "max-age=3600",
  },
  private: {
    "Cache-Control": "private, max-age=10",
    "Cloudflare-CDN-Cache-Control": "max-age=3600",
  },
  middleware: { "Cache-Control": "max-age=10", "Cloudflare-CDN-Cache-Control": "max-age=3600" },
  config: { "Cache-Control": "max-age=10", "Cloudflare-CDN-Cache-Control": "max-age=3600" },
  "no-cache": { "Cache-Control": "public, max-age=10, no-cache", "Cloudflare-CDN-Cache-Control": "max-age=3600" },
  "no-store": { "Cache-Control": "no-store" },
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ policy: string }> },
) {
  const { policy } = await params;
  const headers = policies[policy];
  return headers
    ? Response.json({ policy }, { headers })
    : new Response("Not found", { status: 404 });
}
