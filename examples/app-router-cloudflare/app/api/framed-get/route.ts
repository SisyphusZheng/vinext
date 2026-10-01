import { NextRequest } from "next/server";

// Workers hands a GET sent with Content-Length a non-null body; Next.js never
// lets user code see one, so rebuilding the request must not throw either.
export async function GET(request: NextRequest) {
  const url = new URL("/api/framed-get", request.url);
  return Response.json({
    bodyNull: request.body === null,
    requestBodyNull: new Request(url, request).body === null,
    nextRequestBodyNull: new NextRequest(url, request).body === null,
  });
}
