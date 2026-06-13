"use client";

export function DashboardHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between sm:pb-6 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl break-words">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-zinc-400 break-all">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 [&_a]:w-full sm:[&_a]:w-auto">
          {children}
        </div>
      )}
    </div>
  );
}
