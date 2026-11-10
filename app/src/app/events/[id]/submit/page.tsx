import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authentication } from "../../../../lib/auth/runtime";
import { projectOperations } from "../../../../lib/projects/operations";
import { currentAccount, withUser } from "../../../../lib/auth/access";
import { database } from "../../../../lib/database/client";
import { runtimeConfig } from "../../../../lib/config/runtime";
import { readPublicEvent } from "../../../../lib/events/operations";
import { EventError, uuid } from "../../../../lib/events/validation";
import { ProjectError } from "../../../../lib/projects/validation";
import CaptureClient from "./submission-client";
import OwnerProjectClient from "../../../../deletion/owner-project-client";
export const dynamic = "force-dynamic";
export default async function Submit({
  params,
}: {
  params: Promise<{ id: string; draftId?: string }>;
}) {
  const { id, draftId } = await params;
  if (!uuid(id) || (draftId !== undefined && !uuid(draftId))) notFound();
  const [auth, db, config, requestHeaders] = await Promise.all([
    authentication(),
    database(),
    runtimeConfig(),
    headers(),
  ]);
  const account = await currentAccount(auth, db, requestHeaders);
  if (!account)
    redirect(
      "/sign-in?return_to=" +
        encodeURIComponent(`/events/${id}/submit${draftId ? "/" + draftId : ""}`),
    );
  try {
    if (draftId) {
      const { draft } = await projectOperations(auth, db, null, config.origin).read(
        new Headers(requestHeaders),
        draftId,
      );
      if (draft.event_id !== id) notFound();
      return <CaptureClient key={draftId} event={draft.event} selectedDraftId={draftId} />;
    }
    const { event } = await readPublicEvent(db, config.origin, id);
    const linked = await withUser(
      auth,
      db,
      requestHeaders,
      async (tx, owner) =>
        !!(await tx.authorEvent.findUnique({
          where: { ownerId_eventId: { ownerId: owner, eventId: id } },
        })),
    );
    return (
      <CaptureClient
        key="new"
        event={{ ...event, eligible: event.submissions_open }}
        linked={linked}
      />
    );
  } catch (error) {
    if (draftId && error instanceof ProjectError && error.status === 404) {
      const deleted = await withUser(auth, db, requestHeaders, async (tx, owner) => {
        const rows = await tx.$queryRaw<
          { project_id: string }[]
        >`SELECT x.project_id FROM brag.project_deletion x JOIN brag.project_draft d ON d.id=x.project_id WHERE x.project_id=${draftId}::uuid AND x.owner_id=${owner} AND d.event_id=${id}::uuid`;
        return rows.length === 1;
      });
      // Mount the receipt-only recovery path after a committed-but-lost DELETE.
      // Another owner still receives the same unavailable route, with no metadata.
      if (deleted) return <OwnerProjectClient id={draftId} />;
    }
    if ((error instanceof EventError || error instanceof ProjectError) && error.status === 404)
      notFound();
    throw error;
  }
}
