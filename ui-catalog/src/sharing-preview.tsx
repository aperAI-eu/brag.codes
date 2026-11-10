"use client";
import { GalleryPreview } from "./gallery-preview";
import { useEffect, useRef, useState } from "react";
import { SignInView, type AccountSummary, type SignInProvider } from "../../app/src/ui/access";
import { EventScannerView, type ScannerPhase } from "../../app/src/ui/event-scanner";
import { EventCaptureView } from "../../app/src/ui/share-capture";
import {
  ShareShell,
  ShareHomeView,
  LinkedEventsView,
  EventLinkedView,
  OwnProjectsView,
  ShareMessageView,
  RetainedProjectView,
  type ShareDestination,
} from "../../app/src/ui/share-work";
import {
  projectRecoveryText,
  UnfinishedProjectsView,
  UpgradeRecoveryView,
  ReauthenticationView,
} from "../../app/src/ui/share-recovery";
import type { ProjectFilter } from "../../app/src/ui/share-work";
import { usePitchPreview } from "./use-pitch-preview";
import { SharingControls } from "./sharing-controls";
import {
  identities,
  shareRoutes,
  type ShareRoute as Route,
  eventViews,
  fixtureTime,
  pastedEventFixture,
  seededAccount,
  type Scenario,
} from "./sharing-fixtures";

type AccountData = ReturnType<typeof seededAccount>;
export function SharingPreview({
  route,
  navigate,
}: {
  route: string;
  navigate: (route: string) => void;
}) {
  const screen = shareRoutes.includes(route as Route) ? (route as Route) : "home";
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [upgradeCopied, setUpgradeCopied] = useState(false);
  const [upgradeDiscarded, setUpgradeDiscarded] = useState(false);
  const [reauthMessage, setReauthMessage] = useState("");
  const [reauthBlocked, setReauthBlocked] = useState(false);
  const [reauthReady, setReauthReady] = useState(false);
  const [reauthIdentity, setReauthIdentity] = useState("alex");
  const recoveryGeneration = useRef(0);
  const [identityId, setIdentityId] = useState("alex");
  const [user, setUser] = useState<AccountSummary | null>(null);
  const [accounts, setAccounts] = useState<Record<string, AccountData>>({
    alex: seededAccount("empty", "alex"),
    sam: seededAccount("empty", "sam"),
  });
  const [scenario, setScenario] = useState<Scenario>("empty");
  const [clock, setClock] = useState(fixtureTime);
  const [closed, setClosed] = useState<string[]>([]);
  const [suspended, setSuspended] = useState<string[]>([]);
  const [provider, setProvider] = useState<SignInProvider | null>(null);
  const [authError, setAuthError] = useState("");
  const [returnTo, setReturnTo] = useState<Route>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [repeated, setRepeated] = useState(false);
  const [scanPhase, setScanPhase] = useState<ScannerPhase>("idle");
  const [scanValue, setScanValue] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const failEvent = useRef(false);
  const pendingEvent = useRef<string | null>(null);
  const events = eventViews(clock, closed, suspended);
  const account = user ? accounts[user.id] : null;
  const linkedEvents = events.filter((event) => account?.links.includes(event.id));
  const eligible = linkedEvents.filter((event) => event.state === "open");
  const selected = events.find((event) => event.id === selectedId);
  const {
    stage,
    setStage,
    fields,
    setFields,
    retained,
    setRetained,
    readOnly,
    saved,
    legacy,
    canSave,
    upgradeRequired,
    requireUpgrade,
    transcript,
    draftId,
    loadProject,
    retry,
    failProcessing,
    rejectAgentWrite,
    recorder,
    agent,
    agentReview,
    finishReason,
    language,
    setLanguage,
    busy,
    error: captureError,
    clearCapture,
    save,
    stop,
    failNextSave,
  } = usePitchPreview(
    user,
    selected,
    (project) => {
      setAccounts((current) => ({
        ...current,
        [project.ownerId]: {
          ...current[project.ownerId],
          projects: [
            ...current[project.ownerId].projects.filter((row) => row.id !== project.id),
            project,
          ],
        },
      }));
    },
    screen === "submit",
  );
  // Keep seeded account summaries in sync with simulated job transitions. Dirty editor
  // fields remain local until owner save; these projections are not persisted DB state.
  useEffect(() => {
    if (!user || !draftId) return;
    const recovery =
      stage === "transcribing" || stage === "structuring"
        ? "preparing"
        : stage === "proposal"
          ? "ready"
          : stage === "failed"
            ? "failed"
            : undefined;
    if (!recovery && !(stage === "typed" && saved)) return;
    setAccounts((current) => ({
      ...current,
      [user.id]: {
        ...current[user.id],
        projects: current[user.id].projects.map((project) =>
          project.id !== draftId
            ? project
            : {
                ...project,
                recovery,
                unfinished: !!recovery,
                status:
                  recovery === "preparing"
                    ? "Preparing pitch"
                    : recovery === "ready"
                      ? "Ready for review"
                      : recovery === "failed"
                        ? "Pitch failed · recovery available"
                        : project.legacy
                          ? "Existing draft"
                          : "Confirmed",
              },
        ),
      },
    }));
  }, [stage, draftId, user?.id, saved]);
  const latest = useRef({ user, events });
  latest.current = { user, events };
  const go = (target: Route) => {
    if (menuRef.current) menuRef.current.open = false;
    navigate(target);
  };
  const begin = (eventId: string) => {
    if (retained) {
      go("submit");
      return;
    }
    clearCapture();
    setSelectedId(eventId);
    go("submit");
  };
  const startSeparate = () => {
    clearCapture();
    if (eligible.length === 1) begin(eligible[0].id);
    else if (eligible.length > 1) go("choose");
    else navigatePage("scan");
  };
  const share = () => go("share");
  const navigatePage = (target: ShareDestination) => {
    if (target === "scan") {
      setScanPhase("idle");
      setScanMessage("");
      setScanValue("");
    }
    go(target);
  };
  const privateRoute = !["home", "slop", "sign-in", "provider", "reauth"].includes(screen);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);
  useEffect(() => {
    if (screen !== "submit" || stage !== "proposal") return;
    mainRef.current?.focus();
    mainRef.current?.scrollIntoView({ block: "start" });
  }, [screen, stage]);
  useEffect(() => {
    if (privateRoute && !user) {
      setReturnTo(screen);
      go("sign-in");
      return;
    }
    if (screen === "submit" && user && upgradeRequired) {
      go("upgrade");
      return;
    }
    if (screen === "share" && user) {
      if (retained) go("submit");
      else if (account?.projects.some((project) => project.unfinished)) go("unfinished");
      else if (eligible.length === 1) begin(eligible[0].id);
      else if (eligible.length > 1) go("choose");
      else navigatePage("scan");
    }
  });
  useEffect(() => {
    if (screen !== "scan") {
      setScanPhase("idle");
      pendingEvent.current = null;
    }
  }, [screen]);
  useEffect(() => {
    if (scanPhase !== "resolving" || !user || screen !== "scan") return;
    const ownerId = user.id;
    const timer = setTimeout(() => {
      if (latest.current.user?.id !== ownerId) return;
      const event = latest.current.events.find((item) => item.id === pendingEvent.current);
      if (!event || event.state === "suspended" || failEvent.current) {
        const offline = failEvent.current;
        failEvent.current = false;
        setScanPhase("error");
        setScanMessage(
          offline
            ? "We couldn’t link the event. Check your connection and try again; nothing was linked."
            : "This event is unavailable. Scan or paste another public event link.",
        );
        return;
      }
      setRepeated(accounts[ownerId].links.includes(event.id));
      setAccounts((current) => ({
        ...current,
        [ownerId]: {
          ...current[ownerId],
          links: [...new Set([...current[ownerId].links, event.id])],
        },
      }));
      // Linking a second event must not move an in-progress project to that event.
      if (!retained) setSelectedId(event.id);
      setLinkedId(event.id);
      go("linked");
    }, 400);
    return () => clearTimeout(timer);
  }, [scanPhase, user, screen]);
  const resolve = (id: string | null) => {
    if (!user) {
      setReturnTo("scan");
      go("sign-in");
      return;
    }
    if (screen !== "scan") {
      setScanMessage("Open Scan another event first, then use a scan simulation.");
      navigatePage("scan");
      return;
    }
    if (scanPhase === "resolving") return;
    if (!id) {
      setScanPhase("error");
      setScanValue("");
      setScanMessage(
        "That QR is not a supported, whitelisted public event link. Try another link; personal tickets are not accepted.",
      );
      return;
    }
    pendingEvent.current = id;
    setScanPhase("resolving");
    setScanMessage("Finding and linking your event…");
  };
  const signOut = () => {
    if (retained && !window.confirm("Sign out and discard the unsaved project in this preview?"))
      return;
    clearCapture();
    setUser(null);
    setProvider(null);
    setSelectedId(null);
    go("home");
  };
  const changeScenario = (next: Scenario) => {
    clearCapture();
    setFilter("all");
    setScenario(next);
    setSelectedId(null);
    setClosed([]);
    setSuspended([]);
    setClock(fixtureTime);
    setAccounts((current) => ({ ...current, [identityId]: seededAccount(next, identityId) }));
    go("home");
  };
  const openProject = (id: string) => {
    if (
      retained &&
      !window.confirm(
        "Switch projects and discard unsaved changes in this tab? Previously received work stays in your account.",
      )
    )
      return;
    const project = account?.projects.find((row) => row.id === id);
    if (!project) return;
    loadProject(project);
    setSelectedId(project.eventId);
    go("submit");
  };
  const discardProject = () => {
    if (saved || !window.confirm("Discard this unfinished project? This cannot be undone.")) return;
    if (user && draftId)
      setAccounts((current) => ({
        ...current,
        [user.id]: {
          ...current[user.id],
          projects: current[user.id].projects.filter((project) => project.id !== draftId),
        },
      }));
    clearCapture();
    go("projects");
  };
  const linked = events.find((event) => event.id === linkedId);
  if (screen === "slop")
    return <GalleryPreview onExit={() => go("home")} exitLabel="Back to brag" />;
  return (
    <>
      <SharingControls
        userId={identityId}
        scenario={scenario}
        clock={clock}
        language={language}
        providerPending={screen === "provider" && provider !== null}
        recording={stage === "recording" && !!user}
        agentSimulation={agent.simulation}
        recoveryMode={screen === "reauth"}
        processing={stage === "transcribing" || stage === "structuring"}
        savedProject={saved && !!user}
        onFailProcessing={failProcessing}
        onStaleAgent={rejectAgentWrite}
        onUpgrade={() => {
          if (!user || screen !== "submit") return;
          recoveryGeneration.current += 1;
          requireUpgrade();
          setUpgradeCopied(false);
          setUpgradeDiscarded(false);
          go("upgrade");
        }}
        onBlockedAuth={() => {
          if (!user) return;
          setReauthMessage("");
          setReauthIdentity(user.id);
          setReauthReady(false);
          setReauthBlocked(true);
          setReturnTo(screen);
          setUser(null);
          go("reauth");
        }}
        onReauthReady={(different) => {
          setReauthIdentity(different ? (identityId === "alex" ? "sam" : "alex") : identityId);
          setReauthReady(true);
        }}
        onUser={(id) => {
          recoveryGeneration.current += 1;
          clearCapture();
          setIdentityId(id);
          setUser(null);
          setProvider(null);
          setReturnTo("home");
          setSelectedId(null);
          setScenario("empty");
          go("home");
        }}
        onScenario={changeScenario}
        onExpire={() => {
          setUser(null);
          setProvider(null);
          setAuthError("Your session expired. Sign in again to continue.");
        }}
        onReset={() => {
          if (!window.confirm("Reset all fictional accounts, linked events and projects?")) return;
          clearCapture();
          setUser(null);
          setProvider(null);
          setSelectedId(null);
          setScenario("empty");
          setClock(fixtureTime);
          setClosed([]);
          setSuspended([]);
          setAccounts({ alex: seededAccount("empty", "alex"), sam: seededAccount("empty", "sam") });
          go("home");
        }}
        onTime={setClock}
        onLanguage={setLanguage}
        onLogin={() => {
          const identity = identities.find((item) => item.id === identityId);
          if (!provider || !identity) return;
          setUser(identity);
          setProvider(null);
          setAuthError("");
          go(returnTo);
        }}
        onLoginFailure={() => {
          setProvider(null);
          setAuthError("Sign-in is unavailable. Try again or choose another provider.");
          go("sign-in");
        }}
        onCameraDenied={() => {
          setScanPhase("error");
          setScanMessage("Camera access was denied. Paste the public event link below.");
        }}
        onScan={resolve}
        onOffline={() => {
          failEvent.current = true;
        }}
        onSaveFailure={failNextSave}
        onClose={() => setClosed((items) => [...new Set([...items, selectedId ?? "demo-night"])])}
        onSuspend={() =>
          setSuspended((items) => [...new Set([...items, selectedId ?? "demo-night"])])
        }
        onWarning={recorder.simulateWarning}
        onLimit={recorder.simulateLimit}
      />
      <ShareShell
        user={user}
        mainRef={mainRef}
        menuRef={menuRef}
        onNavigate={navigatePage}
        onSignIn={() => {
          setReturnTo("home");
          go("sign-in");
        }}
        onSignOut={signOut}
      >
        {screen === "home" && (
          <>
            <ShareHomeView
              user={user}
              liveEvents={eligible}
              projectCount={account?.projects.length ?? 0}
              eventCount={linkedEvents.length}
              onShare={share}
              onNavigate={navigatePage}
            />
            {user && retained && (
              <RetainedProjectView
                onResume={() => go("submit")}
                onDiscard={() => {
                  if (window.confirm("Discard the unsaved project? Saved projects will remain."))
                    clearCapture();
                }}
              />
            )}
          </>
        )}
        {screen === "sign-in" && (
          <SignInView
            error={authError}
            onProvider={(value) => {
              setProvider(value);
              go("provider");
            }}
            onCancel={() => {
              setProvider(null);
              setReturnTo("home");
              go("home");
            }}
          />
        )}
        {screen === "provider" && (
          <ShareMessageView
            title={provider ? `Continue with ${provider}` : "This sign-in attempt expired."}
            message={
              provider
                ? "Complete the fictional sign-in using the catalogue controls above. No provider is contacted."
                : "Start sign-in again to continue."
            }
            action={provider ? "Cancel sign-in" : "Sign in again"}
            onAction={() => {
              setProvider(null);
              go("sign-in");
            }}
            onHome={() => go("home")}
          />
        )}
        {user && screen === "account" && (
          <ShareMessageView
            title={user.name}
            message={`${user.email} · Ordinary author account. Event linking does not grant an admin role.`}
            onHome={() => go("home")}
          />
        )}
        {user && (screen === "choose" || screen === "events") && (
          <LinkedEventsView
            events={linkedEvents}
            choosing={screen === "choose"}
            onChoose={begin}
            onScan={() => navigatePage("scan")}
            onHome={() => go("home")}
          />
        )}
        {user && screen === "unfinished" && (
          <UnfinishedProjectsView
            projects={account?.projects.filter((project) => project.unfinished) ?? []}
            events={events}
            onOpen={openProject}
            onNew={startSeparate}
            onHome={() => go("home")}
          />
        )}
        {screen === "reauth" && (
          <ReauthenticationView
            blocked={reauthBlocked}
            checking={false}
            message={reauthMessage}
            onOpen={() => setReauthBlocked(true)}
            onCheck={() => {
              if (!reauthReady) {
                setReauthMessage(
                  "You are still signed out. Finish signing in in the other tab, then check again.",
                );
                return;
              }
              const identity = identities.find((item) => item.id === reauthIdentity)!;
              const same = identity.id === identityId;
              if (!same) {
                recoveryGeneration.current += 1;
                clearCapture();
                setSelectedId(null);
                setIdentityId(identity.id);
              }
              setUser(identity);
              setReauthReady(false);
              go(same ? returnTo : "home");
            }}
          />
        )}
        {user && screen === "upgrade" && (
          <UpgradeRecoveryView
            text={projectRecoveryText(fields)}
            hasRecording={["recording", "paused", "held"].includes(stage)}
            copied={upgradeCopied}
            onManualCopy={setUpgradeCopied}
            discarded={upgradeDiscarded}
            onCopy={async () => {
              const version = recoveryGeneration.current;
              try {
                await navigator.clipboard.writeText(projectRecoveryText(fields));
                if (version === recoveryGeneration.current) setUpgradeCopied(true);
              } catch {
                /* Visible manual-copy fallback remains available. */
              }
            }}
            onDiscard={() => {
              if (!window.confirm("Discard unsaved text and recording before reloading?")) return;
              clearCapture();
              requireUpgrade();
              setUpgradeDiscarded(true);
            }}
            onReload={() => {
              if (
                !upgradeDiscarded &&
                (!upgradeCopied || ["recording", "paused", "held"].includes(stage))
              )
                return;
              clearCapture();
              go("home");
            }}
          />
        )}
        {user && screen === "projects" && (
          <OwnProjectsView
            projects={account?.projects ?? []}
            events={events}
            filter={filter}
            onFilter={setFilter}
            onOpen={openProject}
            onShare={share}
            onHome={() => go("home")}
          />
        )}
        {user && screen === "scan" && (
          <EventScannerView
            phase={scanPhase}
            message={scanMessage}
            value={scanValue}
            onStart={() => {
              setScanPhase("scanning");
              setScanMessage(
                "Camera simulation active. Use a scan fixture above; no camera is opened.",
              );
            }}
            onStop={() => {
              setScanPhase("idle");
              setScanMessage("Camera stopped. You can paste a link instead.");
            }}
            onChange={setScanValue}
            onResolve={() => resolve(pastedEventFixture(scanValue, window.location.origin))}
            onCancel={() => go("home")}
          />
        )}
        {user && screen === "linked" && linked && (
          <EventLinkedView
            event={linked}
            repeated={repeated}
            resumePending={retained}
            onContinue={() => begin(linked.id)}
            onScan={() => navigatePage("scan")}
            onHome={() => go("home")}
          />
        )}
        {user && screen === "submit" && selected && account?.links.includes(selected.id) && (
          <EventCaptureView
            event={selected}
            stage={stage}
            fields={fields}
            readOnly={readOnly}
            saved={saved}
            legacy={legacy}
            canSave={canSave}
            transcript={transcript}
            onRetry={retry}
            onDiscard={discardProject}
            recorder={recorder}
            agent={agent.view}
            agentReview={agentReview}
            finishReason={finishReason}
            busy={busy}
            error={captureError}
            onChange={(value) => {
              setFields(value);
              setRetained(true);
            }}
            onMethod={(method) => {
              if (selected.state !== "open") return;
              setStage(method);
              setRetained(true);
            }}
            onStop={stop}
            onSave={save}
            onBack={() => go("home")}
            onProjects={() => go("projects")}
            onAnother={() => {
              clearCapture();
              share();
            }}
          />
        )}
        {user &&
          ((screen === "submit" && (!selected || !account?.links.includes(selected.id))) ||
            (screen === "linked" && !linked)) && (
            <ShareMessageView
              title="Choose your event first."
              message="Start sharing to link or choose an event that is accepting submissions."
              action="Share your work"
              onAction={share}
              onHome={() => go("home")}
            />
          )}
      </ShareShell>
    </>
  );
}
