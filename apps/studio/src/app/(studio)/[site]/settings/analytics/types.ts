/**
 * What the analytics settings page hands its client component.
 *
 * Timestamps are ISO strings rather than `Date`s: these props cross into the
 * browser bundle, where a `Date` renders in whichever locale produced it.
 *
 * There is deliberately no token field of any kind here, and there is nowhere
 * for one to come from — `list_connections` does not select the ciphertext
 * columns. This type is the last place that would have to be widened before a
 * credential could reach a browser, which is why it is written out by hand.
 */
export interface ConnectionView {
  id: string;
  provider: string;
  propertyUrl: string;
  scopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Negative is normal: it means the next read will renew the access token. */
  expiresInSeconds: number | null;
}

export interface CallbackNotice {
  tone: "ok" | "error";
  text: string;
}
