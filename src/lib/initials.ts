// The letters in the round account button: the first letter of the first and last
// word of the name ("Alex Brown" -> "AB", "Alex" -> "A"), or, with no name, the
// first letter of the email address. Pure, so it is tested.
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = (word: string) => Array.from(word)[0]?.toUpperCase() ?? "";
  if (words.length >= 2) return first(words[0]) + first(words[words.length - 1]);
  if (words.length === 1) return first(words[0]);
  const local = (email ?? "").trim();
  return local ? first(local) : "?";
}
