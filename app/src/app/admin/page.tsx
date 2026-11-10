"use client";
import { useEffect, useState } from "react";
import { useAccount } from "../account-shell";
import { ModerationNavigation } from "../../ui/moderation";
import { AccessDeniedView } from "../../ui/access";
import EventsClient from "./events-client";
export default function Admin() {
  const { account, loading, failed, signOut } = useAccount();
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setOwner(null);
    window.addEventListener("brag:sign-out", clear);
    return () => window.removeEventListener("brag:sign-out", clear);
  }, []);
  useEffect(() => {
    if (account) setOwner(account.can_admin ? account.user.id : null);
  }, [account]);
  useEffect(() => {
    if (!owner && !loading && !account && !failed)
      window.location.replace("/sign-in?return_to=%2Fadmin");
  }, [loading, account, failed, owner]);
  return (
    <main className="access-main">
      {loading ? (
        <p>Checking admin access…</p>
      ) : account?.can_admin || (owner && !account) ? (
        <>
          <ModerationNavigation active="events" />
          <EventsClient key={account?.user.id || owner} active={!!account?.can_admin} />
        </>
      ) : (
        account && (
          <AccessDeniedView
            onHome={() => window.location.assign("/")}
            onSignOut={() => void signOut()}
          />
        )
      )}
    </main>
  );
}
