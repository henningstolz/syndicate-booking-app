import { createClient } from "@/lib/supabase/server";
import { AcceptInviteForm } from "./AcceptInviteForm";
import { JoinAuthForm } from "./JoinAuthForm";

export const dynamic = "force-dynamic";

type InviteInfo = {
  group_id: string;
  group_slug: string;
  group_name: string;
  role: string;
  is_valid: boolean;
  label: string | null;
  status: "valid" | "used" | "revoked" | "expired";
};

const NOT_VALID_TEXT: Record<InviteInfo["status"], string> = {
  valid: "",
  used: "This invite link has already been used.",
  revoked: "This invite link was cancelled.",
  expired: "This invite link has expired.",
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const { inviteId } = await params;
  const supabase = await createClient();

  const { data: info } = await supabase
    .rpc("get_invite_info", { invite_id: inviteId })
    .returns<InviteInfo[]>()
    .maybeSingle();

  if (!info || !info.is_valid) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Invite not valid
        </h1>
        <p className="max-w-xs text-sm text-zinc-600">
          {info ? NOT_VALID_TEXT[info.status] : "This invite link doesn't exist."}{" "}
          Ask whoever sent it for a new one.
        </p>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Join {info.group_name}
      </h1>
      <p className="text-sm text-zinc-600">
        {info.label ? `${info.label}, you've` : "You've"} been invited as{" "}
        {info.role === "admin" ? "an admin" : "a member"}.
      </p>

      {user ? (
        <AcceptInviteForm inviteId={inviteId} />
      ) : (
        <JoinAuthForm inviteId={inviteId} />
      )}
    </main>
  );
}
