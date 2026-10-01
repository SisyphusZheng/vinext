import type { Metadata } from "next";
import { getUser } from "../../lib/data";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  return { title: `user ${await getUser()}` };
}

export default async function Page() {
  const user = await getUser();
  return <p data-testid="user">{user}</p>;
}
