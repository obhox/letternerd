/**
 * Images dropped or pasted into the writing surface.
 *
 * The upload goes to `/api/media/upload`, which is the same route the media
 * library's dropzone posts to and which does nothing but unwrap the envelope
 * before handing the bytes to the `upload_media` capability. Nothing about
 * authorization, the size ceiling, deduplication or the derivative pipeline is
 * repeated here — an image inserted while writing and an image uploaded in the
 * library are the same asset, produced the same way.
 *
 * What is inserted is a `media://<id>` reference rather than a URL. The
 * pipeline resolves those at render time into whatever the delivery layer
 * currently emits, so a document written today keeps working when the CDN
 * hostname, the derivative widths or the output formats change. A pasted
 * absolute URL would freeze today's answer into the markdown.
 */

/** Matches `upload_media`. Checked here too, so a doomed read never starts. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** True for anything the browser positively identifies as a non-image. */
export function looksLikeImage(file: File): boolean {
  return file.type === "" || file.type.startsWith("image/");
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export interface UploadedImage {
  id: string;
  /** The asset was already in the library; the same id now serves both uses. */
  deduped: boolean;
}

/**
 * Upload one file and resolve with its asset id.
 *
 * XHR rather than `fetch`, for the same reason the library dropzone uses it:
 * `fetch` still cannot report upload progress, and a large photograph pasted
 * into a paragraph with no feedback is the thing people cancel and retry.
 */
export function uploadImage(
  siteSlug: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedImage> {
  return (async () => {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `${formatBytes(file.size)} is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
      );
    }
    if (!looksLikeImage(file)) {
      throw new Error(`${file.type || "That file"} is not an image.`);
    }

    const contentBase64 = await readAsBase64(file);

    return new Promise<UploadedImage>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/media/upload");
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };

      xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
      xhr.ontimeout = () => reject(new Error("The upload timed out."));

      xhr.onload = () => {
        let parsed: { ok?: boolean; message?: string; deduped?: boolean; id?: string } = {};
        try {
          parsed = JSON.parse(xhr.responseText) as typeof parsed;
        } catch {
          parsed = {};
        }
        if (xhr.status >= 200 && xhr.status < 300 && parsed.ok && typeof parsed.id === "string") {
          resolve({ id: parsed.id, deduped: parsed.deduped === true });
          return;
        }
        reject(new Error(parsed.message ?? `The server refused the upload (${xhr.status}).`));
      };

      xhr.send(
        JSON.stringify({
          site: siteSlug,
          filename: file.name.length > 0 ? file.name : "pasted-image.png",
          contentBase64,
        }),
      );
    });
  })();
}

/**
 * The text that stands in the document while an upload is in flight.
 *
 * An HTML comment, and not a half-written image. The obvious placeholder —
 * `![](uploading…)` — is an image with no alt text and an unresolvable target,
 * which is two of the three rules that refuse a publish; an author who pasted
 * a photograph and glanced at the checks panel would see the editor accusing
 * them of a blocking error it had just introduced itself. A comment is
 * inert: the sanitiser drops it, no lint looks at it, and it is visibly
 * temporary.
 *
 * The token is unique per upload so that concurrent pastes replace their own
 * placeholder, and it is located by searching the document at replacement
 * time rather than by remembering an offset — the author keeps typing while
 * the upload runs, and any offset captured beforehand is stale.
 */
export function placeholderFor(token: string, filename: string): string {
  return `<!-- uploading ${filename} (${token}) -->`;
}

/** Insert-time markdown for a finished upload. */
export function imageReference(assetId: string, alt: string): string {
  return `![${alt.replace(/[\r\n]+/g, " ").trim()}](media://${assetId})`;
}
