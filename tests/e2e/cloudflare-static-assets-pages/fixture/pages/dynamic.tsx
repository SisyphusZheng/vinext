export function getServerSideProps() {
  return { props: { generation: crypto.randomUUID() } };
}

export default function Dynamic({ generation }: { generation: string }) {
  return <p id="generation">{generation}</p>;
}
