// Where clients, login links, codes and token pairs live. Two implementations: memoryStore (tests, development)
// and sqliteStore (./sqlite.ts, the default for apps). A store expires entries on its own clock; `take` reads and
// deletes in one step, which is what makes a code or refresh token single use.

export type Clock = () => number; // milliseconds since the epoch, like Date.now

export interface PutOptions {
  /** Seconds until the entry expires; none keeps it until it is deleted (registered clients). */
  ttl?: number;
  /** Whose entry this is, so that revokeSubject can find it. */
  subject?: string;
}

export interface Store {
  get(collection: string, key: string): Promise<unknown | undefined>;
  put(collection: string, key: string, value: unknown, options?: PutOptions): Promise<void>;
  /** Read and delete in one step: of two concurrent calls, only one gets the value. */
  take(collection: string, key: string): Promise<unknown | undefined>;
  delete(collection: string, key: string): Promise<void>;
  /** Delete every live entry of a subject and return what was deleted. */
  takeSubject(subject: string): Promise<Array<{ collection: string; value: unknown }>>;
  close?(): void;
}

type Entry = { value: string; expiresAt: number | null; subject: string | null };

/** Kept in memory only: everything is gone on restart. For tests and development. */
export function memoryStore(options: { now?: Clock } = {}): Store {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const id = (collection: string, key: string) => `${collection}\u0000${key}`;
  const live = (e: Entry | undefined) => (e && (e.expiresAt === null || e.expiresAt > now()) ? e : undefined);
  // Values are copied in and out, as a real store would, so a caller can't change what is stored by mutating it.
  const read = (e: Entry | undefined) => (e ? JSON.parse(e.value) : undefined);
  return {
    async get(collection, key) {
      return read(live(entries.get(id(collection, key))));
    },
    async put(collection, key, value, opts = {}) {
      entries.set(id(collection, key), {
        value: JSON.stringify(value),
        expiresAt: opts.ttl === undefined ? null : now() + opts.ttl * 1000,
        subject: opts.subject ?? null,
      });
    },
    async take(collection, key) {
      const k = id(collection, key);
      const e = live(entries.get(k));
      entries.delete(k);
      return read(e);
    },
    async delete(collection, key) {
      entries.delete(id(collection, key));
    },
    async takeSubject(subject) {
      const out: Array<{ collection: string; value: unknown }> = [];
      for (const [k, e] of entries) {
        if (e.subject !== subject) continue;
        entries.delete(k);
        if (live(e)) out.push({ collection: k.split("\u0000")[0]!, value: read(e) });
      }
      return out;
    },
  };
}
