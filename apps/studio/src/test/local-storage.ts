/**
 * A `localStorage` the tests control.
 *
 * jsdom under this runner exposes a `window.localStorage` that is a bare
 * object with none of the Storage methods on it, so anything reading it gets a
 * TypeError rather than a value — which is coincidentally the same shape as
 * the failure the studio guards against, and therefore useless for proving the
 * guard works. Every localStorage-dependent test installs this instead, so the
 * store's behaviour is stated in the test rather than inherited from the
 * environment.
 *
 * The throwing modes are the real ones: a browser configured to block site
 * data throws `SecurityError` on read, and a full origin throws
 * `QuotaExceededError` on write.
 */

export interface FakeLocalStorage {
  /** What the page has actually persisted. */
  readonly entries: Map<string, string>;
  /** Make every subsequent read throw, as a blocked-cookies browser does. */
  failReads(): void;
  /** Make every subsequent write throw, as a full origin does. */
  failWrites(): void;
  /** Put back whatever `window.localStorage` was before. */
  restore(): void;
}

export function installLocalStorage(): FakeLocalStorage {
  const entries = new Map<string, string>();
  let readError: Error | null = null;
  let writeError: Error | null = null;

  const storage = {
    get length() {
      return entries.size;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      if (readError) throw readError;
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (writeError) throw writeError;
      entries.set(key, String(value));
    },
    removeItem(key: string): void {
      if (writeError) throw writeError;
      entries.delete(key);
    },
    clear(): void {
      if (writeError) throw writeError;
      entries.clear();
    },
  };

  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => storage,
  });

  return {
    entries,
    failReads() {
      readError = new DOMException("The operation is insecure.", "SecurityError");
    },
    failWrites() {
      writeError = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
    restore() {
      if (original) Object.defineProperty(window, "localStorage", original);
      else Reflect.deleteProperty(window, "localStorage");
    },
  };
}
