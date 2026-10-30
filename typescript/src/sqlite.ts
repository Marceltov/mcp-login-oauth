// The default store: its own SQLite file, next to the app's database but not in it (ADR 0003). Values are encrypted
// with AES-256-GCM, keys and subjects are stored as HMACs, so the file holds no usable token, grant or user id. Both
// keys are derived from the app's secret: a changed secret turns every entry into a miss, and clients sign in again.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Clock, PutOptions, Store } from "./store.js";

// Shipped migrations are never edited; add the next one.
const MIGRATIONS: string[] = [
  `CREATE TABLE entries (
     collection TEXT NOT NULL,
     key TEXT NOT NULL,
     value BLOB NOT NULL,
     subject TEXT,
     expires_at INTEGER,
     PRIMARY KEY (collection, key)
   );
   CREATE INDEX entries_subject ON entries (subject) WHERE subject IS NOT NULL;
   CREATE INDEX entries_expires ON entries (expires_at) WHERE expires_at IS NOT NULL;`,
];

export interface SqliteStoreOptions {
  /** The database file, e.g. `${DATA_DIR}/oauth.sqlite`. Its folder is created if missing. */
  path: string;
  /** The app's secret. At least 32 characters. */
  secret: string;
  /** Separates this app's keys from any other use of the same secret, e.g. "questlog-oauth". */
  salt: string;
  now?: Clock;
}

export function sqliteStore(options: SqliteStoreOptions): Store {
  const { path, secret, salt } = options;
  const now = options.now ?? Date.now;
  if (secret.length < 32) throw new Error("sqliteStore: the secret must be at least 32 characters");
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, salt, info, 32));
  const encKey = derive("mcp-login-oauth store values v1");
  const macKey = derive("mcp-login-oauth store keys v1");

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);

  const mac = (s: string) => createHmac("sha256", macKey).update(s).digest("base64url");
  // The collection is part of what is MACed, so the same key in two collections gives two rows.
  const rowKey = (collection: string, key: string) => mac(`${collection}\u0000${key}`);
  const seconds = () => Math.floor(now() / 1000);

  function seal(value: unknown, collection: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", encKey, iv);
    c.setAAD(Buffer.from(collection)); // a value can't be moved to another collection
    const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }

  function open(blob: Buffer, collection: string): unknown | undefined {
    try {
      const d = createDecipheriv("aes-256-gcm", encKey, blob.subarray(0, 12));
      d.setAAD(Buffer.from(collection));
      d.setAuthTag(blob.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8"));
    } catch {
      return undefined; // written under another secret: a miss, not an error
    }
  }

  const live = "(expires_at IS NULL OR expires_at > ?)";
  const q = {
    get: db.prepare(`SELECT value FROM entries WHERE collection = ? AND key = ? AND ${live}`),
    put: db.prepare(
      `INSERT INTO entries (collection, key, value, subject, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (collection, key) DO UPDATE SET value = excluded.value, subject = excluded.subject, expires_at = excluded.expires_at`,
    ),
    take: db.prepare(`DELETE FROM entries WHERE collection = ? AND key = ? RETURNING value, expires_at`),
    delete: db.prepare(`DELETE FROM entries WHERE collection = ? AND key = ?`),
    takeSubject: db.prepare(`DELETE FROM entries WHERE subject = ? RETURNING collection, value, expires_at`),
    purge: db.prepare(`DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?`),
  };
  let writes = 0;

  const alive = (expiresAt: number | null) => expiresAt === null || expiresAt > seconds();

  return {
    async get(collection, key) {
      const row = q.get.get(collection, rowKey(collection, key), seconds()) as { value: Buffer } | undefined;
      return row ? open(row.value, collection) : undefined;
    },
    async put(collection, key, value, opts: PutOptions = {}) {
      const expires = opts.ttl === undefined ? null : seconds() + opts.ttl;
      q.put.run(collection, rowKey(collection, key), seal(value, collection), opts.subject === undefined ? null : mac(`subject\u0000${opts.subject}`), expires);
      if (++writes % 100 === 0) q.purge.run(seconds()); // expired rows are invisible anyway; this keeps the file small
    },
    async take(collection, key) {
      const row = q.take.get(collection, rowKey(collection, key)) as { value: Buffer; expires_at: number | null } | undefined;
      return row && alive(row.expires_at) ? open(row.value, collection) : undefined;
    },
    async delete(collection, key) {
      q.delete.run(collection, rowKey(collection, key));
    },
    async takeSubject(subject) {
      const rows = q.takeSubject.all(mac(`subject\u0000${subject}`)) as Array<{ collection: string; value: Buffer; expires_at: number | null }>;
      return rows.flatMap((r) => {
        if (!alive(r.expires_at)) return [];
        const value = open(r.value, r.collection);
        return value === undefined ? [] : [{ collection: r.collection, value }];
      });
    },
    close() {
      db.close();
    },
  };
}

function migrate(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > MIGRATIONS.length) throw new Error(`sqliteStore: the database is at version ${version}, newer than this library (${MIGRATIONS.length})`);
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
