import OwnerProjectClient from "../../../../deletion/owner-project-client";
export default async function OwnerProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerProjectClient id={id} />;
}
