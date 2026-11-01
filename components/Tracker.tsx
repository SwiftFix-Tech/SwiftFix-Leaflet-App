"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Download,
  HardDrive,
  HelpCircle,
  LoaderCircle,
  Undo2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import Search, { type Place } from "./Search";
import { api } from "../lib/api";
import { MAX_BACKUP_BYTES } from "../lib/backup";
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
  return <Workspace />;
}
export function Workspace({ store: provided }: { store?: TrackerStore }) {
  const [store] = useState(() => provided || new TrackerStore(api));
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const [place, setPlace] = useState<Place | null>(null),
    [help, setHelp] = useState(false),
    [online, setOnline] = useState(true),
    [backupBusy, setBackupBusy] = useState(false),
    [message, setMessage] = useState(""),
    [backupError, setBackupError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void store.load([-0.18, 51.57, -0.15, 51.6], 13);
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    const network = () => {
      setOnline(navigator.onLine);
      refresh();
    };
    setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    const unsubscribe = api.subscribe(refresh);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [store]);
  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(store.dismiss, 3500);
    return () => clearTimeout(timer);
  }, [state.notice, store]);
  async function exportBackup() {
    setBackupBusy(true);
    setBackupError("");
    setMessage("");
    try {
      await store.settled();
      const backup = await api.exportBackup(),
        blob = new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `swiftfix-leaflets-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `Backup downloaded: ${backup.roads.length.toLocaleString("en-GB")} completed road sections.`,
      );
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : "Could not export backup.",
      );
    } finally {
      setBackupBusy(false);
    }
  }
  async function importBackup(file: File) {
    setBackupBusy(true);
    setBackupError("");
    setMessage("");
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error("Backup exceeds the 50 MiB limit.");
      const text = await file.text();
      await store.settled();
      const result = await api.importBackup(text);
      store.clearUndo();
      await store.refresh();
      setMessage(
        `Imported ${result.added} road sections. Skipped ${result.skipped} duplicates. Existing roads kept.`,
      );
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "Could not import backup. No changes were saved.",
      );
    } finally {
      setBackupBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const error = backupError || state.error;
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
      </header>
      <div className="storage-warning" role="note">
        <HardDrive size={15} />
        <span>
          Saved only in this browser. Clearing browser data can erase progress.
          Other devices and browsers do not sync automatically. Export regular
          backups.
        </span>
      </div>
      <div className="map-toolbar">
        <div className="workspace-indicator">
          <span className="online-dot" />
          This browser<span className="shared-tag">Local storage</span>
          <span className="save-state">
            {state.pending ? (
              <>
                <LoaderCircle className="spin" size={13} />
                Saving…
              </>
            ) : error ? (
              "Attention needed"
            ) : backupBusy ? (
              "Processing backup…"
            ) : state.loading ? (
              "Loading…"
            ) : (
              <>
                <Check size={14} />
                Saved locally
              </>
            )}
            {!online && " · Map offline"}
          </span>
        </div>
        <div className="toolbar-actions">
          <button
            disabled={!state.undo || state.pending > 0 || backupBusy}
            onClick={store.undo}
            title="Undo your most recent change"
          >
            <Undo2 size={16} />
            Undo
          </button>
          <span className="toolbar-divider" />
          <button
            disabled={backupBusy}
            onClick={() => void exportBackup()}
            title="Download all completed roads"
          >
            <Download size={16} />
            Export Backup
          </button>
          <button
            disabled={backupBusy}
            onClick={() => fileInput.current?.click()}
            title="Merge a JSON backup; existing roads are kept"
          >
            <Upload size={16} />
            Import Backup
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label="Import backup file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBackup(file);
            }}
          />
          <button
            className="help-button"
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
          if (!backupBusy) void store.mark(r, c);
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
            town. Zoom in to select individual road sections.
          </p>
          <p>
            <strong>2. Mark a section</strong>Click or tap a road. Blue means
            leaflets have been delivered there.
          </p>
          <p>
            <strong>3. Made a mistake?</strong>Right-click a blue road, or hold
            it on mobile, then choose Remove Highlight. Undo also saves the
            reverse change.
          </p>
          <p>
            <strong>4. Keep a backup</strong>Export Backup downloads every
            completed section and its geometry. Import Backup merges a saved
            file, skips existing IDs and rejects invalid or conflicting data.
          </p>
          <div className="help-note">
            <HardDrive size={18} />
            Progress is stored in IndexedDB on this browser and device. Export a
            backup before clearing browser data or changing devices.
          </div>
        </aside>
      )}
      {(error || state.notice || message) && (
        <div
          className={`toast ${error ? "toast-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || message || state.notice}
          {state.error && !backupError && (
            <button onClick={() => void store.refresh()}>Retry</button>
          )}
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              store.dismiss();
              setBackupError("");
              setMessage("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
