"use client";

import { Suspense } from "react";
import { ProposalsPageInner } from "./ProposalsPageInner";

export default function ProposalsPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-zinc-500">Loading...</div>}>
      <ProposalsPageInner />
    </Suspense>
  );
}
