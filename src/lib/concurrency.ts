// packages/cli/src/lib/concurrency.ts
//
// Bounded promise pool. Used by `bd batch` and `bd extract` so we don't open
// dozens of parallel /v1/export connections from a single CLI invocation.

export type PMapResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export type PMapOpts = {
  concurrency: number;
  continueOnError?: boolean;
};

export function pMap<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  opts: PMapOpts & { continueOnError: true },
): Promise<PMapResult<O>[]>;
export function pMap<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  opts: PMapOpts & { continueOnError?: false },
): Promise<O[]>;
export async function pMap<I, O>(
  items: readonly I[],
  fn: (item: I, index: number) => Promise<O>,
  opts: PMapOpts,
): Promise<O[] | PMapResult<O>[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const results: (O | PMapResult<O>)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]!, i);
        results[i] = opts.continueOnError ? { ok: true, value } : value;
      } catch (err) {
        if (opts.continueOnError) {
          results[i] = { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
        } else {
          throw err;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results as O[] | PMapResult<O>[];
}
