import { createClient } from "@/lib/supabase/server";
import { getGroupBySlug } from "@/lib/groups";
import { memberColor } from "@/lib/member-colors";
import { createInvite } from "./actions";
import { CopyLinkButton } from "./CopyLinkButton";

type MemberRow = {
  user_id: string;
  display_name: string | null;
  role: string;
};

type InviteRow = {
  id: string;
  role: string;
  created_at: string;
};

export default async function MembersPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const { groupSlug } = await params;
  const supabase = await createClient();

  const group = await getGroupBySlug(supabase, groupSlug);
  if (!group) {
    // The layout already redirects before we get here.
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id, display_name, role")
      .eq("group_id", group.id)
      .order("created_at")
      .returns<MemberRow[]>(),
    supabase
      .from("invites")
      .select("id, role, created_at")
      .eq("group_id", group.id)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .returns<InviteRow[]>(),
  ]);

  const memberList = members ?? [];
  const isAdmin =
    memberList.find((m) => m.user_id === user?.id)?.role === "admin";
  const siteUrl = process.env.SITE_URL ?? "";

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Members</h2>
        {memberList.map((member, i) => (
          <div
            key={member.user_id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${memberColor(i).dot}`}
              />
              <span className="text-sm text-zinc-900">
                {member.display_name ?? "Member"}
              </span>
            </div>
            <span className="text-xs font-medium text-zinc-500 uppercase">
              {member.role}
            </span>
          </div>
        ))}
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500">
            Invite someone
          </h2>
          <div className="flex gap-2">
            <form action={createInvite}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="groupSlug" value={groupSlug} />
              <input type="hidden" name="role" value="member" />
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Invite a member
              </button>
            </form>
            <form action={createInvite}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="groupSlug" value={groupSlug} />
              <input type="hidden" name="role" value="admin" />
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Invite an admin
              </button>
            </form>
          </div>

          {invites && invites.length > 0 && (
            <div className="flex flex-col gap-2">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2"
                >
                  <span className="text-xs text-zinc-600">
                    {invite.role === "admin"
                      ? "Admin invite"
                      : "Member invite"}{" "}
                    — not yet used
                  </span>
                  <CopyLinkButton url={`${siteUrl}/join/${invite.id}`} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
