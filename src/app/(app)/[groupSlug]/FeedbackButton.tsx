"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/feedback-email";
import { isStandalone } from "@/lib/open-file";
import { sendFeedback } from "./feedback-actions";

const MAX = 2000;

const PLACEHOLDERS: Record<FeedbackCategory, string> = {
  bug: "What happened, and what did you expect? Which page were you on?",
  idea: "What would you like Blocktime to do, or do better?",
  other: "Anything you'd like us to know.",
};

// A small "chat" at the bottom of the side menu: say what's wrong or what you'd like. It
// goes to hello@blocktime.group with your address as the reply-to.
export function FeedbackButton({ groupId, groupSlug }: { groupId: string; groupSlug: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"writing" | "sending" | "sent">("writing");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    textRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    if (message.trim().length < 3) {
      setError("Please write a few words first.");
      return;
    }
    setError(null);
    setState("sending");
    const result = await sendFeedback({
      groupId,
      groupSlug,
      category,
      message,
      page: pathname,
      userAgent: `${navigator.userAgent}${isStandalone() ? " | home-screen app" : ""}`.slice(0, 300),
    });
    if (result.ok) {
      setMessage("");
      setState("sent");
    } else {
      setState("writing");
      setError(result.error);
    }
  }

  function openPanel() {
    if (state === "sent") setState("writing");
    setOpen((value) => !value);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={openPanel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h-1A1.5 1.5 0 0 1 3 11.5v-7Z" />
        </svg>
        Feedback
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Send feedback"
          className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-900">Help us improve Blocktime</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700">
              ×
            </button>
          </div>

          {state === "sent" ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
                Thank you! Your message is on its way. If we have a question, we&apos;ll reply by email.
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="self-start rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
              <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
                Found a bug, or have an idea? Tell us. We read every message.
              </p>
              <div role="radiogroup" aria-label="Type of message" className="flex flex-wrap gap-1.5">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={category === c.key}
                    onClick={() => setCategory(c.key)}
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      category === c.key ? "bg-zinc-900 text-white" : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={textRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={MAX}
                rows={5}
                placeholder={PLACEHOLDERS[category]}
                aria-label="Your message"
                disabled={state === "sending"}
                className="w-full resize-none rounded-md border border-zinc-300 px-2 py-1.5 text-base text-zinc-900"
              />
              {message.length > MAX - 200 && (
                <p className="text-right text-xs text-zinc-500">
                  {message.length} / {MAX}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-800">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="submit"
                  disabled={state === "sending"}
                  className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                >
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                We add your name, your email (so we can reply), the page you are on and your device type to help find the problem.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
