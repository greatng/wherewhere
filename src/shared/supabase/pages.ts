/** Fetch complete collections without silently hitting PostgREST's row limit. */
export async function pages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 500) {
    const r = await fetchPage(from, from + 499);
    if (r.error) throw r.error;
    const rows = r.data ?? [];
    result.push(...rows);
    if (rows.length < 500) return result;
  }
}
