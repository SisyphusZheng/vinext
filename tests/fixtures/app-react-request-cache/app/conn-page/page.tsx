import { getLive } from "../../lib/data";

export default async function Page() {
  const live = await getLive("page");
  return <p data-testid="live">{live}</p>;
}
