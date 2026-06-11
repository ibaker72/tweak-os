"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Mail, Send, Loader2, AlertTriangle, FileText, User2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface EmailProposalPayload {
  recipientName: string;
  recipientEmail: string;
  subject: string;
  message: string;
  attachPdf: boolean;
  sendToOwnerOnly: boolean;
}

interface EmailProposalModalProps {
  open: boolean;
  onClose: () => void;
  defaultSubject: string;
  defaultMessage: string;
  defaultRecipientName?: string;
  defaultRecipientEmail?: string;
  onSend: (payload: EmailProposalPayload) => Promise<{ ok: boolean; error?: string }>;
  /** Whether the proposal is currently empty — disables send buttons. */
  proposalEmpty?: boolean;
}

export function EmailProposalModal(props: EmailProposalModalProps) {
  if (!props.open) return null;
  // Remount the form when the modal opens so default values flow in cleanly,
  // avoiding the "setState inside useEffect" anti-pattern.
  return <EmailProposalModalForm {...props} />;
}

function EmailProposalModalForm({
  open,
  onClose,
  defaultSubject,
  defaultMessage,
  defaultRecipientName = "",
  defaultRecipientEmail = "",
  onSend,
  proposalEmpty = false,
}: EmailProposalModalProps) {
  const [recipientName, setRecipientName] = useState(defaultRecipientName);
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipientEmail);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [attachPdf, setAttachPdf] = useState(true);
  const [sending, setSending] = useState<"" | "test" | "real">("");
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());
  const subjectValid = subject.trim().length > 0;
  const recipientNameValid = recipientName.trim().length > 0;
  const sendRealDisabled =
    !recipientNameValid || !emailValid || !subjectValid || proposalEmpty || !!sending;
  const sendTestDisabled = !subjectValid || proposalEmpty || !!sending;

  async function dispatch(test: boolean) {
    setError(null);
    if (!test && !recipientNameValid) {
      setError("Recipient name is required");
      return;
    }
    setSending(test ? "test" : "real");
    try {
      const result = await onSend({
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        subject: subject.trim(),
        message,
        attachPdf,
        sendToOwnerOnly: test,
      });
      if (!result.ok) {
        setError(result.error || "Failed to send.");
        setSending("");
        return;
      }
      setSending("");
      if (!test) onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send.";
      setError(msg);
      setSending("");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && !sending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(e) => sending && e.preventDefault()}
          onPointerDownOutside={(e) => sending && e.preventDefault()}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <Mail className="h-5 w-5 text-lime-400" />
              Email Proposal
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                disabled={!!sending}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-5 py-5">
            {proposalEmpty && (
              <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/40 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-sm text-amber-200">
                  The proposal is empty. Fill in at least one section before sending.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <User2 className="h-3 w-3" /> Recipient Name <span className="text-red-400">*</span>
                </label>
                <Input
                  className="mt-1.5"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Joe Owner"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Recipient Email <span className="text-red-400">*</span>
                </label>
                <Input
                  className="mt-1.5"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="joe@business.com"
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Subject <span className="text-red-400">*</span>
              </label>
              <Input
                className="mt-1.5"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Website + Local SEO Plan for Client"
              />
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Email Message
              </label>
              <Textarea
                className="mt-1.5"
                rows={8}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hey there, I put together a quick plan..."
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                The full proposal preview is appended below this note when the email is delivered.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm hover:border-zinc-700">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-lime-400"
              />
              <FileText className="h-4 w-4 text-lime-400" />
              <span className="flex-1 text-zinc-200">
                Attach branded PDF copy of the proposal
              </span>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/40 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch(true)}
              disabled={sendTestDisabled}
            >
              {sending === "test" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending test...
                </>
              ) : (
                <>
                  <User2 className="h-4 w-4" />
                  Send Test To Myself
                </>
              )}
            </Button>
            <Button onClick={() => dispatch(false)} disabled={sendRealDisabled}>
              {sending === "real" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send Proposal
                </>
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
