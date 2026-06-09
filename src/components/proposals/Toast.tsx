"use client";

import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

interface ToastProps {
  open: boolean;
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({
  open,
  message,
  tone = "info",
  onDismiss,
  durationMs = 4000,
}: ToastProps) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs, onDismiss]);

  if (!open) return null;

  const palette =
    tone === "success"
      ? "border-lime-500/40 bg-lime-950/60 text-lime-100"
      : tone === "error"
        ? "border-red-700/60 bg-red-950/60 text-red-100"
        : "border-zinc-700 bg-zinc-900 text-zinc-100";

  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;
  const iconColor =
    tone === "success"
      ? "text-lime-400"
      : tone === "error"
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 z-[60] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur sm:bottom-6 ${palette}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
      <p className="flex-1 text-sm">{message}</p>
      <button
        onClick={onDismiss}
        className="rounded p-0.5 hover:bg-white/10"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
