"use client";

import { BrandLogo } from "../ui/brand";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { AccountMenu, type AccountSummary } from "../ui/access";
import { Button } from "../ui/components";

type Account = { user: AccountSummary; can_admin: boolean };
type AccessState = {
  account: Account | null;
  loading: boolean;
  failed: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};
const Context = createContext<AccessState | null>(null);
export function useAccount() {
  return useContext(Context)!;
}

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const response = await fetch("/api/v1/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (sequence.current === id) {
        setAccount(data.account);
        setFailed(false);
      }
    } catch {
      if (sequence.current === id) {
        setAccount(null);
        setFailed(true);
      }
    } finally {
      if (sequence.current === id) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      ++sequence.current;
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  const signOut = async () => {
    window.dispatchEvent(new Event("brag:sign-out"));
    setSignOutFailed(false);
    ++sequence.current;
    setAccount(null);
    try {
      const response = await fetch("/api/v1/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      window.location.assign("/");
    } catch {
      setFailed(true);
      setSignOutFailed(true);
    }
  };
  return (
    <Context value={{ account, loading, failed, signOut, refresh }}>
      <header className="access-header">
        <a href="/" className="brand">
          <BrandLogo />
        </a>
        {account ? (
          <AccountMenu
            user={account.user}
            canAdmin={account.can_admin}
            menuRef={menu}
            onNavigate={(destination) =>
              window.location.assign(
                destination === "home"
                  ? "/"
                  : ["projects", "events"].includes(destination)
                    ? "/my/" + destination
                    : "/" + destination,
              )
            }
            onSignOut={() => void signOut()}
          />
        ) : (
          !loading && (
            <a href={pathname === "/scan" ? "/sign-in?return_to=%2Fscan" : "/sign-in"}>Sign in</a>
          )
        )}
      </header>
      {(failed || signOutFailed) && (
        <p className="access-error" role="alert">
          {signOutFailed ? (
            <>
              Sign-out didn’t finish.{" "}
              <Button variant="quiet" onClick={() => void signOut()}>
                Try signing out again
              </Button>
            </>
          ) : (
            "Couldn’t check your session. Please retry before continuing."
          )}
        </p>
      )}
      {children}
    </Context>
  );
}
