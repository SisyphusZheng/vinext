import type { Metadata } from "next";
import { getRandom } from "../../lib/data";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `random ${getRandom()}` };
}

export default function Page() {
  return <p data-testid="random">{getRandom()}</p>;
}
