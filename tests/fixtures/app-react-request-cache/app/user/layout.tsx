import { getUser } from "../../lib/data";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <section>
      <p data-testid="user">{user}</p>
      {children}
    </section>
  );
}
