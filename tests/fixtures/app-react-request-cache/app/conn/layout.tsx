import { getLive } from "../../lib/data";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const live = await getLive("layout");
  return (
    <section>
      <p data-testid="live">{live}</p>
      {children}
    </section>
  );
}
