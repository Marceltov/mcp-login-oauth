import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sqliteStore, type Store } from "../src/index.js";
import { FakeClock, bearer, setup, tokens } from "./helpers.js";

const SECRET = "a-secret-that-is-long-enough-for-the-store";
const dirs: string[] = [];
const opened: Store[] = [];

function file(): string {
  const dir = mkdtempSync(join(tmpdir(), "mlo-"));
  dirs.push(dir);
  return join(dir, "data", "oauth.sqlite");
}
function open(path: string, clock = new FakeClock(), secret = SECRET): Store {
  const s = sqliteStore({ path, secret, salt: "test-oauth", now: clock.now });
  opened.push(s);
  return s;
}

afterEach(() => {
  for (const s of opened.splice(0)) s.close?.();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("sqliteStore", () => {
  test("survives a restart", async () => {
    const path = file();
    await open(path).put("clients", "c1", { name: "Claude" });
    expect(await open(path).get("clients", "c1")).toEqual({ name: "Claude" });
  });

  test("entries expire on the store's clock", async () => {
    const clock = new FakeClock();
    const s = open(file(), clock);
    await s.put("codes", "k", 1, { ttl: 300 });
    clock.advance(299);
    expect(await s.get("codes", "k")).toBe(1);
    clock.advance(2);
    expect(await s.get("codes", "k")).toBeUndefined();
    expect(await s.take("codes", "k")).toBeUndefined();
  });

  test("take is single use", async () => {
    const s = open(file());
    await s.put("codes", "k", { v: 1 });
    expect(await s.take("codes", "k")).toEqual({ v: 1 });
    expect(await s.take("codes", "k")).toBeUndefined();
  });

  test("collections are apart", async () => {
    const s = open(file());
    await s.put("access", "k", "a");
    await s.put("refresh", "k", "r");
    expect(await s.get("access", "k")).toBe("a");
    expect(await s.get("refresh", "k")).toBe("r");
  });

  test("a changed secret turns every entry into a miss", async () => {
    const path = file();
    await open(path).put("clients", "c1", { name: "Claude" });
    expect(await open(path, new FakeClock(), "another-secret-that-is-long-enough!").get("clients", "c1")).toBeUndefined();
  });

  test("takeSubject returns and removes a subject's live entries only", async () => {
    const s = open(file());
    await s.put("access", "a1", "x", { subject: "u1" });
    await s.put("refresh", "r1", "y", { subject: "u1" });
    await s.put("access", "a2", "z", { subject: "u2" });
    const gone = await s.takeSubject("u1");
    expect(gone.map((g) => g.collection).sort()).toEqual(["access", "refresh"]);
    expect(await s.get("access", "a1")).toBeUndefined();
    expect(await s.get("access", "a2")).toBe("z");
  });

  test("the file holds no token, grant or subject in the clear", async () => {
    const path = file();
    const store = open(path);
    const { auth } = setup({ store });
    const { body } = await tokens(auth);
    expect(await auth.verify(bearer(body.access_token))).not.toBeNull();
    store.close?.();
    const raw = readFileSync(path).toString("latin1") + readFileSync(`${path}-wal`, { flag: "a+" }).toString("latin1");
    for (const secret of [body.access_token, body.refresh_token, "service-token", "user-1"]) expect(raw).not.toContain(secret);
  });

  test("refuses a short secret", () => {
    expect(() => sqliteStore({ path: ":memory:", secret: "short", salt: "x" })).toThrow(/at least 32/);
  });
});
