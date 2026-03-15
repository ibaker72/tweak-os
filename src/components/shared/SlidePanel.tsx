"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: "md" | "lg" | "xl";
}

const widthClasses: Record<"md" | "lg" | "xl", string> = {
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
};

export function SlidePanel({
  open,
  onClose,
  title,
  children,
  width = "lg",
}: SlidePanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 h-full w-full border-l border-zinc-800 bg-zinc-950 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-300",
            widthClasses[width]
          )}
        >
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-4 sm:px-6">
              <Dialog.Title className="text-base font-semibold text-zinc-100 sm:text-lg">
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                  <X className="h-5 w-5" />
                  <span className="sr-only">Close</span>
                </button>
              </Dialog.Close>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
