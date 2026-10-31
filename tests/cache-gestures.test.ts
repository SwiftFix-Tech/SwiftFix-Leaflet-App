import { it, expect, vi } from "vitest";
import { RequestCache } from "../lib/cache";
import { LongPress } from "../lib/gestures";
it("evicts LRU, retries failures, and expires cached data", async () => {
  vi.useFakeTimers();
  const cache = new RequestCache<number>(1, 100),
    fn = vi.fn(async () => 1);
  await cache.get("a", fn);
  await cache.get("a", fn);
  expect(fn).toHaveBeenCalledTimes(1);
  await cache.get("b", fn);
  await cache.get("a", fn);
  expect(fn).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(101);
  await cache.get("a", fn);
  expect(fn).toHaveBeenCalledTimes(4);
  await expect(
    cache.get("fail", async () => {
      throw Error("fail");
    }),
  ).rejects.toThrow();
  expect(await cache.get("fail", async () => 3)).toBe(3);
  vi.useRealTimers();
});
it("tap does not trigger long press, stationary hold does", () => {
  vi.useFakeTimers();
  const press = new LongPress(),
    fn = vi.fn();
  press.start(10, 10, fn);
  vi.advanceTimersByTime(150);
  press.cancel();
  expect(fn).not.toHaveBeenCalled();
  press.start(10, 10, fn);
  vi.advanceTimersByTime(550);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(press.fired).toBe(true);
  vi.useRealTimers();
});
it("dragging and multitouch cancellation suppress the long press", () => {
  vi.useFakeTimers();
  const press = new LongPress(),
    fn = vi.fn();
  press.start(0, 0, fn);
  press.move(10, 0);
  vi.advanceTimersByTime(1000);
  expect(fn).not.toHaveBeenCalled();
  press.start(0, 0, fn);
  press.cancel();
  vi.advanceTimersByTime(1000);
  expect(fn).not.toHaveBeenCalled();
  vi.useRealTimers();
});
