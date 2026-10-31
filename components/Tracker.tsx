"use client";
import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  HelpCircle,
  LoaderCircle,
  LogOut,
  MapPin,
  ShieldCheck,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import Search, { type Place } from "./Search";
import { configured, supabase, workspace } from "../lib/supabase";
import { api } from "../lib/api";
import { TrackerStore } from "../lib/tracker-store";
const RoadMap = dynamic(() => import("./RoadMap"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <LoaderCircle className="spin" />
      Opening your map…
    </div>
  ),
});
export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Wrench size={23} strokeWidth={2.5} />
      </div>
      <div>
        <strong>
          SwiftFix<span>Tech</span>
        </strong>
        <small>UK LEAFLET TRACKER</small>
      </div>
    </div>
  );
}
export default function Tracker() {
  const [session, setSession] = useState<Session | null>(null),
    [checking, setChecking] = useState(true),
    [member, setMember] = useState(false),
    [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setSession(data.session);
        if (error) setAuthError(error.message);
        setChecking(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setMember(false);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session) {
      setMember(false);
      return;
    }
    let alive = true;
    setChecking(true);
    setAuthError("");
    api
      .membership()
      .then((allowed) => {
        if (alive) {
          setMember(allowed);
          if (!allowed)
            setAuthError(
              "Your account is not a member of the SwiftFix Tech workspace. Ask your administrator to grant access.",
            );
        }
      })
      .catch((e) => {
        if (alive) setAuthError(e.message);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);
  if (checking)
    return (
      <div className="auth-page">
        <Brand />
        <p className="auth-loading">
          <LoaderCircle className="spin" size={20} />
          Checking secure access…
        </p>
      </div>
    );
  if (session && member && configured)
    return (
      <Workspace
        key={session.user.id}
        email={session.user.email || "Team member"}
      />
    );
  return <SignIn signedIn={!!session} error={authError} />;
}
function SignIn({ signedIn, error }: { signedIn: boolean; error: string }) {
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  return (
    <div className="auth-page">
      <header>
        <Brand />
        <span className="private-label">
          <ShieldCheck size={15} />
          Private team workspace
        </span>
      </header>
      <div className="auth-grid">
        <section className="auth-copy">
          <div className="eyebrow">
            <span className="blue-dot" />
            SWIFTFIX TECH · UNITED KINGDOM
          </div>
          <h1>
            A little blue.
            <br />A lot of ground
            <br />
            <span>covered.</span>
          </h1>
          <p>
            Your team’s leaflet rounds, all on one map.
            <br />
            Mark a road, keep your place, pick up where you left off.
          </p>
          <div className="auth-proof">
            <span>
              <CheckCheck size={18} />
              Shared across your team
            </span>
            <span>
              <ShieldCheck size={18} />
              Automatically saved
            </span>
          </div>
          <div className="auth-map-art" aria-hidden="true">
            <div className="art-road r1" />
            <div className="art-road r2" />
            <div className="art-road r3" />
            <div className="art-road r4" />
            <span className="art-pin">
              <MapPin size={27} />
            </span>
            <span className="art-label">Every section counts.</span>
          </div>
        </section>
        <section className="signin-card">
          <div className="signin-icon">
            <MapPin size={26} />
          </div>
          <h2>
            {!configured
              ? "Connect your workspace"
              : signedIn
                ? "Workspace access"
                : "Welcome back"}
          </h2>
          <p>
            {!configured
              ? "Finish the service setup to open your private tracking map."
              : signedIn
                ? "This map is available to authorised SwiftFix Tech staff."
                : "Sign in to your SwiftFix Tech workspace. We’ll email you a secure sign-in link."}
          </p>
          {!configured ? (
            <div className="setup-note">
              <strong>Service configuration needed</strong>
              <p>
                Add the Supabase URL, publishable key and MapTiler key to your
                environment. Apply the SQL migration, import UK roads, and add
                staff membership using the included README.
              </p>
              <small>
                No tracking data is stored until Supabase is connected.
              </small>
            </div>
          ) : signedIn ? (
            <button
              className="primary-button"
              onClick={() => supabase?.auth.signOut()}
            >
              Sign out
            </button>
          ) : sent ? (
            <div className="email-sent" role="status">
              <CheckCheck size={25} />
              <strong>Check your inbox</strong>
              <p>
                If this email is registered, a sign-in link is on its way to{" "}
                {email}.
              </p>
              <button onClick={() => setSent(false)}>Use another email</button>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setFailure("");
                const { error } = await supabase!.auth.signInWithOtp({
                  email,
                  options: {
                    shouldCreateUser: false,
                    emailRedirectTo: window.location.origin,
                  },
                });
                setBusy(false);
                if (error) setFailure(error.message);
                else setSent(true);
              }}
            >
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@swiftfixtech.co.uk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="primary-button" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Send sign-in link
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          )}
          {(failure || error) && (
            <p className="form-error" role="alert">
              {failure || error}
            </p>
          )}
          <div className="signin-foot">
            <ShieldCheck size={15} />
            Invite-only access. Your team’s map stays private.
          </div>
        </section>
      </div>
      <footer className="auth-footer">
        <span>© {new Date().getFullYear()} SwiftFix Tech</span>
        <span>One team. Every road.</span>
      </footer>
    </div>
  );
}
export function Workspace({
  email,
  store: provided,
}: {
  email: string;
  store?: TrackerStore;
}) {
  const [store] = useState(() => provided || new TrackerStore(api));
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const [place, setPlace] = useState<Place | null>(null),
    [help, setHelp] = useState(false),
    [connected, setConnected] = useState(true);
  useEffect(() => {
    const offline = () => setConnected(false),
      online = () => {
        setConnected(true);
        void store.refresh();
      };
    setConnected(navigator.onLine);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 30_000);
    const channel = supabase
      ?.channel(`workspace:${workspace}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "workspaces",
          filter: `id=eq.${workspace}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [store]);
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(store.dismiss, 3500);
    return () => clearTimeout(t);
  }, [state.notice, store]);
  return (
    <div className="workspace">
      <header className="topbar">
        <Brand />
        <div className="header-divider" />
        <div className="workspace-title">
          <strong>UK Leaflet Tracker</strong>
          <span>Your coverage, at a glance.</span>
        </div>
        <Search onSelect={setPlace} />
        <div className="completed-counter">
          <span className="counter-icon">
            <CheckCheck size={21} />
          </span>
          <div>
            <strong data-testid="completed-count">
              {state.count.toLocaleString("en-GB")}
            </strong>
            <span>Completed road sections</span>
          </div>
        </div>
        <button
          className="avatar"
          title={`${email} · Sign out`}
          aria-label="Sign out"
          onClick={() => supabase?.auth.signOut()}
        >
          {email[0].toUpperCase()}
          <LogOut size={12} />
        </button>
      </header>
      <div className="map-toolbar">
        <div className="workspace-indicator">
          <span className="online-dot" />
          SwiftFix team workspace<span className="shared-tag">Shared map</span>
        </div>
        <div className="toolbar-actions">
          <span className={`save-state ${!connected ? "offline" : ""}`}>
            {!connected ? (
              "Offline"
            ) : state.pending ? (
              <>
                <LoaderCircle className="spin" size={13} />
                Saving {state.pending}…
              </>
            ) : state.error ? (
              "Attention needed"
            ) : state.loading ? (
              "Syncing map…"
            ) : (
              <>
                <Check size={14} />
                All changes saved
              </>
            )}
          </span>
          <span className="toolbar-divider" />
          <button
            disabled={!state.undo || state.pending > 0}
            onClick={store.undo}
            title="Undo your most recent change"
          >
            <Undo2 size={16} />
            Undo
          </button>
          <button
            className={help ? "help-button selected" : "help-button"}
            aria-label="How to use the map"
            onClick={() => setHelp(!help)}
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </div>
      <RoadMap
        roads={state.roads}
        completed={state.completed}
        place={place}
        loading={state.loading}
        onView={(b, z) => void store.load(b, z)}
        onMark={(r, c) => {
          if (connected) void store.mark(r, c);
        }}
      />
      <footer className="map-footer">
        <div>
          <span className="blue-line" />
          Completed
          <span className="legend-separator" />
          <span className="normal-line" />
          Not yet delivered
        </div>
        <span className="desktop-instructions">
          Click to mark <span>·</span> Right-click to remove
        </span>
        <span className="mobile-instructions">
          Tap to mark · Hold to remove
        </span>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          Road data: OpenStreetMap
          <ArrowUpRight size={11} />
        </a>
      </footer>
      {help && (
        <aside className="help-panel">
          <button
            className="close-button"
            aria-label="Close help"
            onClick={() => setHelp(false)}
          >
            <X size={18} />
          </button>
          <span className="eyebrow">QUICK GUIDE</span>
          <h2>Make your mark.</h2>
          <p>
            <strong>1. Find your area</strong>Search a UK postcode, street or
            town. Zoom in until individual road sections can be selected.
          </p>
          <p>
            <strong>2. Mark a section</strong>Click or tap a road. Blue means
            your team has delivered leaflets there.
          </p>
          <p>
            <strong>3. Made a mistake?</strong>Right-click a blue road, or hold
            it on mobile, then choose Remove Highlight. You can also use Undo.
          </p>
          <div className="help-note">
            <ShieldCheck size={18} />
            Every change saves to your shared team workspace.
          </div>
        </aside>
      )}
      {(state.error || state.notice || !connected) && (
        <div
          className={`toast ${state.error || !connected ? "toast-error" : ""}`}
          role={state.error ? "alert" : "status"}
        >
          {state.error ||
            (!connected
              ? "You’re offline. Reconnect before marking roads."
              : state.notice)}
          {state.error && (
            <button onClick={() => void store.refresh()}>Retry</button>
          )}
          <button aria-label="Dismiss notification" onClick={store.dismiss}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
