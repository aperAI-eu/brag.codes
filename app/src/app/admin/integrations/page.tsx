"use client";
import { useEffect } from "react";
import { useAccount } from "../../account-shell";
import { AccessDeniedView } from "../../../ui/access";
import { ModerationNavigation } from "../../../ui/moderation";
import SettingsClient from "./settings-client";
export default function Integrations() {
  const { account, loading, failed, signOut } = useAccount();
  useEffect(() => {
    if (!loading && !account && !failed)
      window.location.replace("/sign-in?return_to=%2Fadmin%2Fintegrations");
  }, [loading, account, failed]);
  return (
    <main className="access-main">
      {loading ? (
        <p>Checking admin access…</p>
      ) : account?.can_admin ? (
        <>
          <ModerationNavigation active="integrations" />
          <SettingsClient key={account.user.id} />
        </>
      ) : account ? (
        <AccessDeniedView
          onHome={() => window.location.assign("/")}
          onSignOut={() => void signOut()}
        />
      ) : failed ? (
        <p role="alert">Could not check your account. Refresh to retry.</p>
      ) : null}
    </main>
  );
}
