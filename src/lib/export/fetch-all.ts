// PostgREST returns at most 1000 rows per request, so the export asks page by page until a page comes
// back short. `fetchPage(from, to)` is one ranged query (rows from..to, inclusive).
export const PAGE_SIZE = 1000;

export async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE,
  maxPages = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new Error("export is too large");
}
