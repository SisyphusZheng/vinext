import type { NextApiRequest, NextApiResponse } from "next";

export default async function revalidate(_req: NextApiRequest, res: NextApiResponse) {
  // A fixed path in a local test fixture, never a public revalidation endpoint.
  await res.revalidate("/posts/first");
  res.json({ revalidated: true });
}
