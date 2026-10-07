export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group"
  );
}

// Addresses a group must never take: the site's own pages (a group called
// "Login" would otherwise be unreachable behind /login) and /demo, the demo
// group.
export const RESERVED_SLUGS = [
  "demo", "login", "join", "groups", "pending", "auth", "privacy",
  "forgot-password", "reset-password", "api", "admin",
];

// The web address for a new group's name, never a reserved one.
export function groupSlugFromName(name: string): string {
  const slug = slugify(name);
  return RESERVED_SLUGS.includes(slug) ? `${slug}-group` : slug;
}
