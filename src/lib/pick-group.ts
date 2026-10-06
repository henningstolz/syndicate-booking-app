// Which group to open for someone who belongs to several: the one they used
// last if they are still in it, otherwise the one they joined first.
// `slugs` must already be in the order the person joined them.
export function pickGroupSlug(slugs: string[], lastUsed?: string | null) {
  if (lastUsed && slugs.includes(lastUsed)) return lastUsed;
  return slugs[0] ?? null;
}

// Remembered in the browser so the next sign-in lands in the same group.
// It only ever holds a group's web address (slug), and is checked against
// the groups the person actually belongs to before it is used.
export const LAST_GROUP_COOKIE = "bt_last_group";
