import { ImageResponse } from "next/og";

export const revalidate = 2;
export default async function Image() {
  const renderId = crypto.randomUUID();
  return new ImageResponse(<div style={{ display: "flex", background: "white" }}>{renderId}</div>, {
    status: 307,
    width: 600,
    height: 80,
    headers: {
      "Cache-Control": "private, max-age=300",
      "X-Render-Id": renderId,
    },
  });
}
