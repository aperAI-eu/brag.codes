import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authentication } from "../../lib/auth/runtime";
import OwnerProjectClient from "../../deletion/owner-project-client";
import { currentAccount, withUser } from "../../lib/auth/access";
import { database } from "../../lib/database/client";
import { runtimeConfig } from "../../lib/config/runtime";
import { projectOperations } from "../../lib/projects/operations";
import { ProjectError } from "../../lib/projects/validation";
import { uuid } from "../../lib/events/validation";
import CaptureClient from "../events/[id]/submit/submission-client";
export const dynamic = "force-dynamic";
export default async function Submit({ params }: { params: Promise<{ draftId?: string }> }) {
  const { draftId } = await params;
  if (draftId !== undefined && !uuid(draftId)) notFound();
  const [auth, db, config, requestHeaders] = await Promise.all([
    authentication(),
    database(),
    runtimeConfig(),
    headers(),
  ]);
  if (!(await currentAccount(auth, db, requestHeaders)))
    redirect(
      "/sign-in?return_to=" + encodeURIComponent("/submit" + (draftId ? "/" + draftId : "")),
    );
  if (draftId) {
    try {
      const { draft } = await projectOperations(auth, db, null, config.origin).read(
        new Headers(requestHeaders),
        draftId,
      );
      if (draft.event_id !== null) notFound();
    } catch (error) {
      if (error instanceof ProjectError && error.status === 404) {
        const deleted = await withUser(auth, db, requestHeaders, async (tx, owner) => {
          const rows = await tx.$queryRaw<
            { project_id: string }[]
          >`SELECT x.project_id FROM brag.project_deletion x JOIN brag.project_draft d ON d.id=x.project_id WHERE x.project_id=${draftId}::uuid AND x.owner_id=${owner} AND d.event_id IS NULL`;
          return rows.length === 1;
        });
        if (deleted) return <OwnerProjectClient id={draftId} />;
        notFound();
      }
      throw error;
    }
  }
  return <CaptureClient key={draftId ?? "new"} event={null} selectedDraftId={draftId} />;
}
