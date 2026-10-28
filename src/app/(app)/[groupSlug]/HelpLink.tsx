import { SUPPORT_EMAIL } from "@/lib/legal";

// "Help": opens an email to support with the group's name already in the subject.
export function HelpLink({ groupName }: { groupName: string }) {
  const subject = encodeURIComponent(`Blocktime help: ${groupName}`);
  return (
    <a
      href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}
      className="mt-2 flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.25" />
        <path d="M7.9 7.8a2.2 2.2 0 1 1 3.1 2c-.7.4-1 .8-1 1.6M10 13.6v.1" strokeLinecap="round" />
      </svg>
      Help
    </a>
  );
}
