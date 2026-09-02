"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, CopyCheckIcon, UploadCloudIcon } from "lucide-react";
import { Button, cn } from "@cms/ui";

/**
 * Drag-and-drop upload for the media library.
 *
 * Two properties matter more than anything else here. The first is that a batch
 * survives its failures: each file is its own request, and a 30 MB screenshot
 * or a mistakenly dropped PDF marks itself failed and leaves the other nine
 * photographs to finish. Losing a whole drop because one file was wrong is the
 * behaviour that teaches people to upload one at a time. The second is that
 * every file reports where it has got to, because base64-encoding and uploading
 * a large image takes long enough that a silent interface looks broken.
 */

/** Matches `upload_media`. Checked here too, so a doomed 40 MB read never starts. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Three at a time.
 *
 * The server re-encodes each image into five widths in two formats, so an
 * unbounded fan-out from a folder drop is a self-inflicted load spike; one at a
 * time wastes the uplink while the server works.
 */
const CONCURRENCY = 3;

type UploadStatus = "queued" | "reading" | "uploading" | "processing" | "done" | "duplicate" | "error";

interface UploadItem {
  id: string;
  name: string;
  bytes: number;
  status: UploadStatus;
  /** 0–1, over the request body only; processing has no meaningful fraction. */
  progress: number;
  message?: string;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "Waiting",
  reading: "Reading",
  uploading: "Uploading",
  processing: "Processing",
  done: "Uploaded",
  duplicate: "Already in the library",
  error: "Failed",
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => {
      // `readAsDataURL` is the only browser API that base64-encodes a File
      // without a hand-rolled loop over an ArrayBuffer. The `data:...;base64,`
      // prefix it prepends is dropped here rather than on the server, so the
      // request body is exactly the bytes the capability expects.
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

interface UploadOutcome {
  duplicate: boolean;
}

function postUpload(
  body: { site: string; filename: string; contentBase64: string },
  onProgress: (fraction: number) => void,
): Promise<UploadOutcome> {
  return new Promise((resolve, reject) => {
    // XHR rather than fetch: `fetch` still cannot report upload progress in any
    // browser this app targets, and a 20 MB upload with no feedback is the
    // thing people cancel and retry.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));

    xhr.onload = () => {
      let parsed: { ok?: boolean; message?: string; deduped?: boolean } = {};
      try {
        parsed = JSON.parse(xhr.responseText) as typeof parsed;
      } catch {
        parsed = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.ok) {
        resolve({ duplicate: parsed.deduped === true });
        return;
      }
      reject(new Error(parsed.message ?? `The server refused the upload (${xhr.status}).`));
    };

    xhr.send(JSON.stringify(body));
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadDropzone({
  siteSlug,
  children,
}: {
  siteSlug: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  /**
   * `dragenter` and `dragleave` fire for every child element the pointer
   * crosses, so a boolean flipped by each one flickers. Counting entries and
   * exits is the standard fix and the only one that survives a grid of cards.
   */
  const dragDepth = useRef(0);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const queued: UploadItem[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        bytes: file.size,
        status: "queued",
        progress: 0,
      }));

      setItems((current) => [...queued, ...current]);

      let cursor = 0;
      let uploaded = 0;

      const worker = async () => {
        while (cursor < files.length) {
          const index = cursor++;
          const file = files[index]!;
          const item = queued[index]!;

          try {
            if (file.size > MAX_UPLOAD_BYTES) {
              throw new Error(
                `${formatBytes(file.size)} is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
              );
            }
            // Some sources hand over an empty `type`, so this rejects only what
            // the browser positively identifies as something else. The server
            // decodes the bytes and has the final say either way.
            if (file.type !== "" && !file.type.startsWith("image/")) {
              throw new Error(`${file.type} is not an image.`);
            }

            patch(item.id, { status: "reading" });
            const contentBase64 = await readAsBase64(file);

            patch(item.id, { status: "uploading", progress: 0 });
            const outcome = await postUpload(
              { site: siteSlug, filename: file.name, contentBase64 },
              (fraction) => {
                // Once the body is sent the server is still rescaling; holding
                // the bar at 100% while that happens reads as a hang.
                if (fraction >= 1) patch(item.id, { status: "processing", progress: 1 });
                else patch(item.id, { progress: fraction });
              },
            );

            uploaded += 1;
            patch(item.id, {
              status: outcome.duplicate ? "duplicate" : "done",
              progress: 1,
              message: outcome.duplicate
                ? "This site already had these exact bytes, so the existing asset was reused."
                : undefined,
            });
          } catch (error) {
            // Caught per file and never rethrown: one rejection must not
            // abandon the worker, or the rest of the batch dies with it.
            patch(item.id, {
              status: "error",
              message: error instanceof Error ? error.message : "The upload failed.",
            });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

      // Refreshed once for the batch rather than per file, so the grid does not
      // re-render underneath a queue that is still working.
      if (uploaded > 0) router.refresh();
    },
    [patch, router, siteSlug],
  );

  const pending = items.filter((item) => !["done", "duplicate", "error"].includes(item.status));
  const failed = items.filter((item) => item.status === "error");

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        // Without this the browser navigates to the dropped file instead.
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void start(Array.from(event.dataTransfer.files));
      }}
      className={cn(
        "relative rounded-lg transition-colors",
        dragging && "outline-2 outline-offset-4 outline-dashed outline-[var(--color-accent)]",
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)]">
          <p className="rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] shadow-sm">
            Drop to upload
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            void start(Array.from(event.target.files ?? []));
            // Reset so re-picking the same file fires `change` again.
            event.target.value = "";
          }}
        />
        <Button type="button" onClick={() => inputRef.current?.click()}>
          <UploadCloudIcon aria-hidden="true" />
          Upload images
        </Button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Or drag them anywhere on this page. Up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB each; a file
          this site already has is reused rather than stored twice.
        </p>
      </div>

      {items.length > 0 && (
        <section
          aria-label="Upload queue"
          className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <h2 className="text-sm font-medium text-[var(--color-ink)]">
              {pending.length > 0
                ? `Uploading ${pending.length} of ${items.length}`
                : `${items.length} file${items.length === 1 ? "" : "s"} processed`}
            </h2>
            {failed.length > 0 && (
              <span className="text-xs text-[var(--color-danger)]">
                {failed.length} failed — the rest completed
              </span>
            )}
            {pending.length === 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setItems([])}
              >
                Clear
              </Button>
            )}
          </header>

          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--color-ink)]">{item.name}</p>
                  <p
                    className={cn(
                      "text-xs",
                      item.status === "error"
                        ? "text-[var(--color-danger)]"
                        : "text-[var(--color-ink-muted)]",
                    )}
                  >
                    {STATUS_LABEL[item.status]}
                    {item.message ? ` — ${item.message}` : ` · ${formatBytes(item.bytes)}`}
                  </p>
                </div>

                {item.status === "error" ? (
                  <AlertTriangleIcon
                    className="size-4 shrink-0 text-[var(--color-danger)]"
                    aria-hidden="true"
                  />
                ) : item.status === "done" ? (
                  <CheckIcon className="size-4 shrink-0 text-[var(--color-ok)]" aria-hidden="true" />
                ) : item.status === "duplicate" ? (
                  <CopyCheckIcon
                    className="size-4 shrink-0 text-[var(--color-ink-muted)]"
                    aria-hidden="true"
                  />
                ) : (
                  <div
                    role="progressbar"
                    aria-label={`${item.name} upload progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--color-muted)]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {children}
    </div>
  );
}
