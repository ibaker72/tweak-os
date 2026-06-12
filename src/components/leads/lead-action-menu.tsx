"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  ExternalLink,
  FileText,
  CheckCircle2,
  Archive,
  Trash2,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Action = "archive" | "restore" | "soft_delete" | "mark_contacted";

interface LeadActionMenuProps {
  leadId: string;
  /** Show "Restore" instead of "Archive" / "Delete" — used in Archived view. */
  showRestore?: boolean;
  /** Hide "Generate Proposal" if there's no website to audit/propose against. */
  hasWebsite?: boolean;
  /** Hide "Mark Contacted" if the lead is already contacted. */
  alreadyContacted?: boolean;
  /** Called after a successful mutation. Use this to remove the row optimistically. */
  onActionComplete?: (action: Action) => void;
}

export function LeadActionMenu({
  leadId,
  showRestore = false,
  hasWebsite = true,
  alreadyContacted = false,
  onActionComplete,
}: LeadActionMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function runAction(action: Action) {
    if (busyAction) return;
    setBusyAction(action);
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, action }),
      });
      if (!res.ok) {
        throw new Error("Request failed");
      }
      const successMessage =
        action === "archive"
          ? "Lead archived"
          : action === "restore"
            ? "Lead restored"
            : action === "soft_delete"
              ? "Lead deleted"
              : "Lead marked contacted";
      toast(successMessage, "success");
      onActionComplete?.(action);
      router.refresh();
    } catch (err) {
      console.error(err);
      const errorMessage =
        action === "archive"
          ? "Could not archive lead"
          : action === "soft_delete"
            ? "Could not delete lead"
            : "Could not update lead";
      toast(errorMessage, "error");
    } finally {
      setBusyAction(null);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Lead actions"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            onSelect={() => router.push(`/leads/${leadId}`)}
          >
            <ExternalLink className="h-4 w-4" />
            Open Lead
          </DropdownMenuItem>
          {hasWebsite && (
            <DropdownMenuItem
              onSelect={() => router.push(`/proposals?lead_id=${leadId}`)}
            >
              <FileText className="h-4 w-4" />
              Generate Proposal
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {!alreadyContacted && !showRestore && (
            <DropdownMenuItem
              disabled={busyAction !== null}
              onSelect={(e) => {
                e.preventDefault();
                runAction("mark_contacted");
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Contacted
            </DropdownMenuItem>
          )}
          {showRestore ? (
            <DropdownMenuItem
              disabled={busyAction !== null}
              onSelect={(e) => {
                e.preventDefault();
                runAction("restore");
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={busyAction !== null}
              onSelect={(e) => {
                e.preventDefault();
                runAction("archive");
              }}
            >
              <Archive className="h-4 w-4" />
              Archive / Dismiss
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            destructive
            disabled={busyAction !== null}
            onSelect={(e) => {
              e.preventDefault();
              setConfirmDelete(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete Lead
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lead?"
        description="Delete this lead permanently? This cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
        busy={busyAction === "soft_delete"}
        onConfirm={() => runAction("soft_delete")}
      />
    </>
  );
}
