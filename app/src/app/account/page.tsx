"use client";
import { useAccount } from "../account-shell";
export default function Account() {
  const { account, loading } = useAccount();
  return (
    <main className="access-main">
      <section className="access-card">
        <h1>My account</h1>
        {loading ? (
          <p>Checking your session…</p>
        ) : account ? (
          <>
            <p>{account.user.name}</p>
            <p>{account.user.email}</p>
            <p className="small muted">Your account ID</p>
            <code>{account.user.id}</code>
            <p className="small muted">
              This sign-in email is private. Recovery and public contact settings are coming later.
            </p>
          </>
        ) : (
          <a href="/sign-in?return_to=%2Faccount">Sign in to view your account</a>
        )}
      </section>
    </main>
  );
}
