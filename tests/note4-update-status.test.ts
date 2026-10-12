import { expect, it, vi } from "vitest";
import { Note4UpdateStatus } from "../integrations/nido-family/src/note4-update-status.js";
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
it("checks in the background once an hour and compares each device independently", async () => {
  let now = 0;
  const latest = vi.fn(async () => ({ version: "nido-ota-0.4.8" }));
  const updates = new Note4UpdateStatus(latest, () => now);
  expect(updates.status("nido-ota-0.4.7").updateAvailable).toBe(false);
  updates.status("nido-ota-0.4.7");
  await flush();
  expect(latest).toHaveBeenCalledTimes(1);
  expect(updates.status("nido-ota-0.4.7")).toEqual({
    updateAvailable: true,
    availableVersion: "nido-ota-0.4.8",
  });
  for (const version of [undefined, "invalid", "nido-ota-0.4.8", "nido-ota-0.10.0"])
    expect(updates.status(version).updateAvailable).toBe(false);
  now = 3599999;
  updates.status();
  await flush();
  expect(latest).toHaveBeenCalledTimes(1);
  now = 3600000;
  updates.status();
  await flush();
  expect(latest).toHaveBeenCalledTimes(2);
});
it("retains successful metadata on failure, rate limits retries and clears outdated notices", async () => {
  let now = 0;
  const latest = vi
    .fn()
    .mockResolvedValueOnce({ version: "nido-ota-0.4.8" })
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce({ version: "nido-ota-0.4.7" });
  const updates = new Note4UpdateStatus(latest, () => now);
  updates.status();
  await flush();
  now = 3600000;
  updates.status();
  await flush();
  expect(updates.status("nido-ota-0.4.7").updateAvailable).toBe(true);
  expect(latest).toHaveBeenCalledTimes(2);
  now = 7200000;
  updates.status();
  await flush();
  expect(updates.status("nido-ota-0.4.7").updateAvailable).toBe(false);
});
it("does not wait for GitHub or start another request while one is in flight", async () => {
  let now = 0;
  let resolve!: (value: { version: string }) => void;
  const latest = vi.fn(
    () =>
      new Promise<{ version: string }>((r) => {
        resolve = r;
      }),
  );
  const updates = new Note4UpdateStatus(latest, () => now);
  expect(updates.status("nido-ota-0.4.7").updateAvailable).toBe(false);
  await flush();
  now = 3600000;
  updates.status();
  await flush();
  expect(latest).toHaveBeenCalledTimes(1);
  resolve({ version: "nido-ota-0.4.8" });
  await flush();
  expect(updates.status("nido-ota-0.4.7").updateAvailable).toBe(true);
});
