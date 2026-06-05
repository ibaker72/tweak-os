"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function subscribeStandalone(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getStandaloneSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Sidebar/footer install affordance for the PWA.
 * Listens for `beforeinstallprompt` (Chromium browsers); when unavailable, shows
 * a helper line so iOS Safari users know how to install.
 */
export function InstallAppButton() {
  const isStandalone = useSyncExternalStore(
    subscribeStandalone,
    getStandaloneSnapshot,
    getServerSnapshot
  );

  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setPromptEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isStandalone || installed) return null;

  async function handleInstall() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
    setPromptEvent(null);
  }

  if (!promptEvent) {
    return (
      <p className="px-1 text-[11px] leading-relaxed text-zinc-500">
        Use your browser menu to install this app.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={handleInstall}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-lime-500/40 hover:bg-lime-400/10 hover:text-lime-300"
    >
      <Download className="h-3.5 w-3.5" />
      Install App
    </button>
  );
}
