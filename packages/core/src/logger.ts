/**
 * Structured logging, with nothing to install.
 *
 * `LOG_LEVEL` was plumbed through every environment file and read by nothing;
 * every log line in the system was a bare `console.error` with no level, no
 * name and no way to raise verbosity during an incident. This is the smallest
 * thing that fixes that: one JSON object per line, a level gate, and a
 * redaction pass so a caught error or a request object cannot carry a bearer
 * token, a client secret or a connection string into the container log.
 *
 * Redaction is by key name, recursively, and it is deliberately broad —
 * anything that *looks* like a credential is masked. A log line that says
 * `<redacted>` where a value would have helped is a mild inconvenience; a log
 * line that carries a live refresh token is a breach that outlives the token.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SENSITIVE_KEY =
  /(^|[_\-.])(authorization|auth|token|secret|password|passwd|pwd|key|credential|cookie|session|client_secret|code|database_url|dsn|api[_-]?key|private)([_\-.]|$)/i;

const MAX_DEPTH = 6;
const MAX_STRING = 2_000;

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(name: string): Logger;
}

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  return raw in LEVELS ? (raw as LogLevel) : "info";
}

/**
 * Whether a key names something that must never be printed.
 *
 * Whole-word within the usual separators so `key` matches `api_key` and
 * `keyPrefix` — the prefix is safe, but a rule with exceptions is a rule that
 * eventually prints the wrong one — while `monkey` does not.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z])([A-Z])/g, "$1_$2"));
}

/**
 * A copy of `value` safe to serialise.
 *
 * Errors become `{ name, message, stack? }` — the stack only at debug, because
 * a stack is where framework internals and file paths live. Cycles and depth
 * are bounded so a logged request object cannot hang the logger.
 */
export function redactForLog(value: unknown, level: LogLevel = "info", depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…<${value.length} chars>` : value;
  if (typeof value !== "object") return typeof value === "bigint" ? value.toString() : value;
  if (depth >= MAX_DEPTH) return "<depth limit>";
  if (seen.has(value)) return "<cycle>";
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message };
    if (level === "debug" && value.stack) out.stack = value.stack;
    if ("cause" in value && value.cause !== undefined) out.cause = redactForLog(value.cause, level, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactForLog(v, level, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? "<redacted>" : redactForLog(v, level, depth + 1, seen);
  }
  return out;
}

export interface LoggerOptions {
  /** Defaults to `LOG_LEVEL`, then `info`. */
  level?: LogLevel;
  /** Defaults to stderr, which is where a container runtime collects logs from. */
  write?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function emit(level: Exclude<LogLevel, "silent">, message: string, fields?: Record<string, unknown>): void {
    const threshold = LEVELS[options.level ?? configuredLevel()];
    if (LEVELS[level] < threshold) return;
    const record: Record<string, unknown> = { time: now().toISOString(), level, logger: name, message };
    if (fields) Object.assign(record, redactForLog(fields, level) as Record<string, unknown>);
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ time: record.time, level, logger: name, message, unserialisable: true });
    }
    write(line);
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (child) => createLogger(`${name}.${child}`, options),
  };
}

export const log = createLogger("cms");
