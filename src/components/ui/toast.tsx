"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, X, Info } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const palette =
    item.tone === "success"
      ? "border-lime-500/40 bg-lime-950/80 text-lime-100"
      : item.tone === "error"
        ? "border-red-700/60 bg-red-950/80 text-red-100"
        : "border-zinc-700 bg-zinc-900/95 text-zinc-100";

  const Icon =
    item.tone === "error"
      ? AlertTriangle
      : item.tone === "success"
        ? CheckCircle2
        : Info;
  const iconColor =
    item.tone === "success"
      ? "text-lime-400"
      : item.tone === "error"
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur ${palette}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
      <p className="flex-1 text-sm">{item.message}</p>
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

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Silent fallback if a component renders outside the provider; better UX
    // than crashing the page.
    return {
      toast: (message: string) => {
        if (typeof window !== "undefined") {
          console.log("[toast]", message);
        }
      },
    };
  }
  return ctx;
}
