import type { NextApiRequest, NextApiResponse } from "next";

export default function preview(_req: NextApiRequest, res: NextApiResponse) {
  // This endpoint belongs to the local test fixture only.
  res.setPreviewData({});
  res.json({ preview: true });
}
