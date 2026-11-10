import { notFound } from "next/navigation";
import PublicationClient from "../../../../../publication/client";
import { uuid } from "../../../../../lib/events/validation";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid(id)) notFound();
  return <PublicationClient id={id} />;
}
