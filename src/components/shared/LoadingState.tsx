import { cn } from "@/lib/utils";

interface LoadingStateProps {
  variant: "table" | "cards" | "detail" | "editor";
  rows?: number;
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded bg-zinc-800", className)}
    />
  );
}

function TableSkeleton({ rows = 5 }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      {/* Header */}
      <div className="flex gap-4 border-b border-zinc-800 bg-zinc-900/80 px-4 py-3">
        <SkeletonBar className="h-3 w-24" />
        <SkeletonBar className="h-3 w-20" />
        <SkeletonBar className="h-3 w-32" />
        <SkeletonBar className="h-3 w-16" />
        <SkeletonBar className="h-3 w-20" />
      </div>
      {/* Rows */}
      <div className="divide-y divide-zinc-800/50">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <SkeletonBar className="h-3 w-28" />
            <SkeletonBar className="h-3 w-16" />
            <SkeletonBar className="h-3 w-36" />
            <SkeletonBar className="h-3 w-12" />
            <SkeletonBar className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-6"
        >
          <SkeletonBar className="mb-3 h-3 w-20" />
          <SkeletonBar className="mb-2 h-7 w-16" />
          <SkeletonBar className="h-2 w-12" />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <SkeletonBar className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <SkeletonBar className="h-5 w-48" />
          <SkeletonBar className="h-3 w-32" />
        </div>
      </div>
      {/* Content blocks */}
      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-3/4" />
        <SkeletonBar className="h-3 w-5/6" />
      </div>
      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-2/3" />
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Main editor area */}
      <div className="flex-1 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        <SkeletonBar className="h-4 w-40" />
        <SkeletonBar className="h-48 w-full" />
        <div className="flex gap-2">
          <SkeletonBar className="h-8 w-20" />
          <SkeletonBar className="h-8 w-20" />
        </div>
      </div>
      {/* Sidebar */}
      <div className="w-full space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 lg:w-64">
        <SkeletonBar className="h-4 w-24" />
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-3/4" />
        <SkeletonBar className="mt-4 h-4 w-20" />
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function LoadingState({ variant, rows = 5 }: LoadingStateProps) {
  switch (variant) {
    case "table":
      return <TableSkeleton rows={rows} />;
    case "cards":
      return <CardsSkeleton />;
    case "detail":
      return <DetailSkeleton />;
    case "editor":
      return <EditorSkeleton />;
  }
}
