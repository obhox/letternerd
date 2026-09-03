/**
 * Embed providers, resolved to a click-to-load facade.
 *
 * The published HTML never contains a third-party iframe or script. A YouTube
 * iframe costs roughly half a megabyte and a fistful of long tasks before the
 * reader has decided they want the video, and the consuming site's Core Web
 * Vitals are the SEO surface we are optimising — spending them on a video most
 * readers never play is the trade running backwards. So the pipeline emits a
 * poster image and a button; hydrating that into a real player is the site's
 * job, at a moment the reader chose.
 *
 * Providers are a registry rather than a switch so that adding Vimeo or X is
 * one entry with no change to the transform.
 */

export interface EmbedInfo {
  provider: string;
  /** Provider-scoped id, e.g. a YouTube video id. */
  id: string;
  /** Where the button should send a reader who has JavaScript turned off. */
  watchUrl: string;
  posterUrl: string;
  posterWidth: number;
  posterHeight: number;
  title: string;
}

export interface EmbedProvider {
  provider: string;
  match: RegExp;
  build(url: URL): EmbedInfo | undefined;
}

const YOUTUBE_ID = /^[\w-]{11}$/;

function youtubeInfo(id: string): EmbedInfo {
  return {
    provider: "youtube",
    id,
    watchUrl: `https://www.youtube.com/watch?v=${id}`,
    // `hqdefault` is the one thumbnail size guaranteed to exist for every
    // video; the higher-resolution names 404 on older uploads, and a broken
    // poster is a worse facade than a slightly soft one.
    posterUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    posterWidth: 480,
    posterHeight: 360,
    title: "Play video",
  };
}

export const EMBED_PROVIDERS: EmbedProvider[] = [
  {
    provider: "youtube",
    match: /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i,
    build(url) {
      const id =
        url.hostname.toLowerCase().endsWith("youtu.be")
          ? url.pathname.slice(1)
          : url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")
            ? url.pathname.split("/")[2] ?? ""
            : (url.searchParams.get("v") ?? "");
      return YOUTUBE_ID.test(id) ? youtubeInfo(id) : undefined;
    },
  },
];

/**
 * Whether a URL is one a reader can be sent to.
 *
 * Only `http:` and `https:` qualify. The sanitiser would strip a `javascript:`
 * href anyway, but the fallback link for an unrecognised embed is built here,
 * and a pass that never constructs a dangerous link does not depend on a later
 * pass remembering to remove it.
 */
export function isWebUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Returns `undefined` for anything unrecognised rather than guessing.
 *
 * A facade built from a URL we do not understand would render a broken poster
 * and a button that plays nothing; the caller degrades to a plain link instead
 * and lints it, so the author finds out at publish time rather than the reader
 * finding out afterwards.
 */
export function resolveEmbed(
  rawUrl: string,
  providers: readonly EmbedProvider[] = EMBED_PROVIDERS,
): EmbedInfo | undefined {
  if (!isWebUrl(rawUrl)) return undefined;
  const url = new URL(rawUrl);

  for (const provider of providers) {
    if (provider.match.test(url.hostname)) return provider.build(url);
  }
  return undefined;
}
