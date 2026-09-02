"use client";

import {
  autocompletion,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type KeyBinding,
} from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HashIcon,
  ImageIcon,
  KeyboardIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button, Spinner, Toolbar, ToolbarGroup, ToolbarSeparator, cn } from "@cms/ui";
import { countDocument, type DocumentCounts } from "./document-scan";
import { FindPanel } from "./find-panel";
import { findHighlighting } from "./find-state";
import {
  formatBytes,
  imageReference,
  looksLikeImage,
  placeholderFor,
  uploadImage,
} from "./image-upload";
import { richMarkdown } from "./markdown-decorations";
import { hasStructuralMarkup, htmlToMarkdown } from "./paste-html";
import { commandHint, ShortcutSheet, useModLabel } from "./shortcuts";
import {
  ALL_COMMANDS,
  BLOCK_COMMANDS,
  INLINE_COMMANDS,
  SLASH_COMMANDS,
  STRUCTURE_COMMANDS,
  type EditorCommand,
} from "./snippets";

/**
 * CodeMirror 6, wrapped without being fought.
 *
 * CodeMirror owns a DOM subtree and a document of its own, and React owns a
 * render function that runs whenever anything above it changes. The two only
 * coexist if the boundary is drawn in exactly one place: the view is created
 * once, on mount, and lives in a ref for the rest of the component's life.
 *
 * Two mistakes follow from getting that wrong, and both are common enough to
 * be worth naming:
 *
 *   - Recreating the `EditorView` when a prop changes. Every parent render
 *     would tear down the editor and build a new one, which throws away the
 *     selection, the scroll position and the focus, mid-sentence.
 *   - Driving the document from a React state variable — `value={markdown}` —
 *     and writing it back on every keystroke. React re-renders after the state
 *     update, the effect pushes the "new" text back into a view that already
 *     contains it, and the caret jumps to the end of the document. The
 *     document is not React state; it lives in the view, and changes travel
 *     *out* through `updateListener`.
 *
 * So this component takes `initialValue`, never `value`. The parent keeps
 * whatever copy it needs for saving and previewing, and nothing it does with
 * that copy can reach back in and disturb the caret.
 *
 * Everything the parent needs to *do* to the editor — scroll it to a heading,
 * ask which line is on screen, focus it — arrives through the imperative
 * handle below rather than through props, for the same reason.
 */

export interface EditorApi {
  focus(): void;
  /** Put the caret on a 1-based line, scroll it into view, and focus. */
  goToLine(line: number): void;
  /** Scroll a 1-based line to the top of the viewport, without moving focus. */
  scrollLineToTop(line: number): void;
  /** The 1-based line currently at the top of the viewport. */
  topVisibleLine(): number | null;
  /** The element that scrolls, for the parent to observe. */
  scrollElement(): HTMLElement | null;
  /** After the pane has been hidden and shown again. */
  remeasure(): void;
}

/**
 * The slash menu.
 *
 * The same commands as the toolbar, reachable without leaving the keyboard.
 * The trigger deliberately requires the slash to start a line or follow
 * whitespace, so "and/or" and "https://" do not open a menu mid-sentence.
 */
function slashCommands(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|\s)\/[a-z0-9]*/i);
  if (!before) return null;

  const offset = before.text.indexOf("/");
  if (offset < 0) return null;
  const from = before.from + offset;

  const options: Completion[] = SLASH_COMMANDS.map((command) => ({
    label: `/${command.id}`,
    detail: command.label,
    info: command.title,
    type: "keyword",
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      // Remove the typed "/faq" before running the command, so the skeleton is
      // inserted onto a clean line rather than after the trigger text.
      view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert: "" },
        selection: { anchor: applyFrom },
      });
      command.run(view);
    },
  }));

  return { from, options, validFor: /^\/[a-z0-9]*$/i };
}

/**
 * The writing surface.
 *
 * Three things here are doing most of the work, and they are worth naming
 * because they are what separates "a textarea with a monospace font" from
 * something an author will spend a day inside:
 *
 *   - A proportional face at 15px with a 1.7 line height. Markdown is prose,
 *     not code, and prose set in a monospace face at the interface's own 13px
 *     is tiring in a way people attribute to the writing rather than the tool.
 *     Monospace survives where it means something — code, URLs, the pipeline's
 *     directives — and nowhere else.
 *   - A capped measure, centred. A 27-inch display would otherwise give a
 *     220-character line, which the eye cannot track back from; 44rem is a
 *     shade over the 75 characters typography has settled on.
 *   - Deep bottom padding, so the line being written can sit in the middle of
 *     the screen instead of scraping along the bottom edge.
 */
const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
  },
  "&.cm-focused": { outline: "none" },

  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    fontSize: "0.9375rem",
    lineHeight: "1.7",
    overflow: "auto",
  },

  ".cm-content": {
    maxWidth: "44rem",
    margin: "0 auto",
    padding: "1.75rem 0.75rem 50vh",
    caretColor: "var(--color-ink)",
  },
  // Enough that a code block's background and the active-line tint clear the
  // text, and little enough that the measure above still means what it says.
  ".cm-line": { padding: "0 0.5rem" },

  ".cm-gutters": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink-faint)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.6875rem",
    border: "none",
  },
  ".cm-gutterElement": { paddingRight: "0.75rem" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-ink-muted)" },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--color-muted) 45%, transparent)",
  },

  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-ink)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--color-accent) 20%, transparent)",
  },
  ".cm-placeholder": { color: "var(--color-ink-faint)" },

  ".cm-tooltip": {
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
    boxShadow: "var(--shadow-overlay)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    fontFamily: "var(--font-sans)",
    fontSize: "0.8125rem",
    padding: "0.25rem 0.5rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-muted)",
    color: "var(--color-ink)",
  },
  ".cm-completionDetail": { color: "var(--color-ink-muted)", fontStyle: "normal" },
});

/** Reconfigured rather than rebuilt, so toggling the gutter keeps the view. */
const gutterCompartment = new Compartment();

function gutterExtension(on: boolean): Extension {
  return on ? [lineNumbers(), highlightActiveLineGutter()] : [];
}

/** Image files on a clipboard or a drag, ignoring everything else. */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter(looksLikeImage);
}

/** True where the caret sits inside code, and pasted text must stay literal. */
function insideCode(view: EditorView, position: number): boolean {
  let node = syntaxTree(view.state).resolveInner(position, -1);
  while (node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") {
      return true;
    }
    node = node.parent;
  }
  return false;
}

interface PendingImage {
  token: string;
  placeholder: string;
  filename: string;
  bytes: number;
  /** 0–1 over the request body; the server is still working at 1. */
  progress: number;
  assetId: string | null;
  error: string | null;
  alt: string;
  /** The author has committed their alt text and is waiting on the upload. */
  confirmed: boolean;
}

export interface MarkdownEditorProps {
  /**
   * The document to start from. Read once, on mount. Later changes are
   * ignored on purpose — see the note at the top of this file.
   */
  initialValue: string;
  onChange: (markdown: string) => void;
  /** Invoked on Ctrl/Cmd-S, which the editor swallows so the browser does not. */
  onSaveRequest?: () => void;
  /** Where uploads are filed. Required for paste and drop to work. */
  siteSlug: string;
  /** Set on mount, cleared on unmount. The parent's handle on the view. */
  apiRef?: { current: EditorApi | null };
  label?: string;
  placeholder?: string;
  className?: string;
}

/**
 * A toolbar control, with its shortcut in the tooltip and in its accessible
 * name — the binding is discoverable from the button that duplicates it.
 */
function CommandButton({
  command,
  mod,
  onRun,
  showLabel = false,
}: {
  command: EditorCommand;
  mod: string;
  onRun: (command: EditorCommand) => void;
  showLabel?: boolean;
}) {
  const hint = commandHint(command.title, command.key, mod);
  return showLabel ? (
    <Button size="sm" variant="ghost" title={hint} aria-label={hint} onClick={() => onRun(command)}>
      <command.icon aria-hidden="true" />
      {command.label}
    </Button>
  ) : (
    <Button
      size="icon"
      variant="ghost"
      title={hint}
      aria-label={hint}
      onClick={() => onRun(command)}
    >
      <command.icon aria-hidden="true" />
    </Button>
  );
}

export function MarkdownEditor({
  initialValue,
  onChange,
  onSaveRequest,
  siteSlug,
  apiRef,
  label = "Markdown body",
  placeholder = "Write in markdown. Type / for the authoring blocks, or use the toolbar.",
  className,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const mod = useModLabel();

  const [counts, setCounts] = useState<DocumentCounts>(() => countDocument(initialValue));
  const [docVersion, setDocVersion] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showGutter, setShowGutter] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);

  /**
   * The callbacks are read through refs rather than closed over.
   *
   * The editor is built once, so a handler captured at mount would keep
   * calling the first render's `onChange` forever — holding a stale `draft`
   * and quietly reverting saves. A ref updated on every render keeps the view
   * calling the current one without the view itself having to be rebuilt.
   */
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSaveRequest);
  const siteRef = useRef(siteSlug);
  const findOpenRef = useRef(findOpen);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSaveRequest;
    siteRef.current = siteSlug;
    findOpenRef.current = findOpen;
  });

  // Captured once so a re-render with a different `initialValue` cannot
  // retroactively become a document reset.
  const initialRef = useRef(initialValue);

  /**
   * The upload queue, mirrored.
   *
   * An upload resolves long after the render that started it, and the
   * completion handler has to see every item — including ones added while it
   * was in flight — so it reads the ref rather than the captured state.
   */
  const imagesRef = useRef<PendingImage[]>([]);
  const commit = useCallback((next: PendingImage[]) => {
    imagesRef.current = next;
    setImages(next);
  }, []);
  const patchImage = useCallback(
    (token: string, patch: Partial<PendingImage>) => {
      commit(
        imagesRef.current.map((item) => (item.token === token ? { ...item, ...patch } : item)),
      );
    },
    [commit],
  );

  /**
   * Swap a placeholder for something else, wherever it has drifted to.
   *
   * The author keeps typing while the upload runs, so the offset the
   * placeholder was inserted at is meaningless by the time it comes back. The
   * token is unique, so finding it in the current document is both correct and
   * cheap. A placeholder the author has deleted simply is not there, and the
   * insertion is dropped rather than forced back in at a guess.
   */
  const replacePlaceholder = useCallback((placeholder: string, text: string): boolean => {
    const view = viewRef.current;
    if (!view) return false;
    const at = view.state.doc.toString().indexOf(placeholder);
    if (at < 0) return false;
    view.dispatch({
      changes: { from: at, to: at + placeholder.length, insert: text },
      selection: EditorSelection.cursor(at + text.length),
    });
    return true;
  }, []);

  /** Insert once both halves are in: the asset id, and the author's alt text. */
  const finishImage = useCallback(
    (token: string) => {
      const item = imagesRef.current.find((entry) => entry.token === token);
      if (!item || item.assetId === null || !item.confirmed) return;
      replacePlaceholder(item.placeholder, imageReference(item.assetId, item.alt));
      commit(imagesRef.current.filter((entry) => entry.token !== token));
      viewRef.current?.focus();
    },
    [commit, replacePlaceholder],
  );

  const cancelImage = useCallback(
    (token: string) => {
      const item = imagesRef.current.find((entry) => entry.token === token);
      if (item) replacePlaceholder(item.placeholder, "");
      commit(imagesRef.current.filter((entry) => entry.token !== token));
      viewRef.current?.focus();
    },
    [commit, replacePlaceholder],
  );

  /**
   * Drop or paste of one or more images.
   *
   * The placeholder goes in immediately, at the caret or at the point of the
   * drop, so the author can see where the image will land and keep writing
   * around it. The alt text is asked for now rather than later: a missing alt
   * is one of the three findings that refuse a publish, and the cheapest place
   * to catch it is the moment the picture arrives, not twenty minutes later in
   * a refusal panel.
   */
  const startImageUploads = useCallback(
    (files: File[], at: number | null) => {
      const view = viewRef.current;
      if (!view || files.length === 0) return;

      const queued = files.map((file) => {
        const token = Math.random().toString(36).slice(2, 10);
        const filename = file.name.length > 0 ? file.name : "pasted image";
        return {
          file,
          item: {
            token,
            placeholder: placeholderFor(token, filename),
            filename,
            bytes: file.size,
            progress: 0,
            assetId: null,
            error: null,
            alt: "",
            confirmed: false,
          } satisfies PendingImage,
        };
      });

      const position = at ?? view.state.selection.main.head;
      const line = view.state.doc.lineAt(position);
      // An image belongs to a block of its own. If the caret is mid-sentence,
      // the placeholder starts a new paragraph rather than splitting one.
      const lead = position === line.from ? "" : "\n\n";
      const insert = `${lead}${queued.map((entry) => entry.item.placeholder).join("\n\n")}`;

      view.dispatch({
        changes: { from: position, insert },
        selection: EditorSelection.cursor(position + insert.length),
        scrollIntoView: true,
      });

      commit([...imagesRef.current, ...queued.map((entry) => entry.item)]);

      for (const { file, item } of queued) {
        uploadImage(siteRef.current, file, (fraction) =>
          patchImage(item.token, { progress: fraction }),
        ).then(
          (uploaded) => {
            patchImage(item.token, { assetId: uploaded.id, progress: 1 });
            finishImage(item.token);
          },
          (error: unknown) => {
            // The placeholder goes with it: a failed upload must not leave a
            // comment behind in the author's document.
            replacePlaceholder(item.placeholder, "");
            patchImage(item.token, {
              error: error instanceof Error ? error.message : "The upload failed.",
            });
          },
        );
      }
    },
    [commit, finishImage, patchImage, replacePlaceholder],
  );
  const startImageUploadsRef = useRef(startImageUploads);
  useEffect(() => {
    startImageUploadsRef.current = startImageUploads;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const bindings: KeyBinding[] = [
      ...ALL_COMMANDS.flatMap((command): KeyBinding[] =>
        command.key
          ? [
              {
                key: command.key,
                preventDefault: true,
                run: (view) => {
                  command.run(view);
                  return true;
                },
              },
            ]
          : [],
      ),
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      {
        key: "Mod-f",
        preventDefault: true,
        run: () => {
          setFindOpen(true);
          return true;
        },
      },
      {
        /*
         * The way out.
         *
         * A text editor that swallows Tab — and this one does not — is still a
         * keyboard trap if there is no key that moves focus out of it, and a
         * screen reader user who lands in the document has no other exit. So
         * Escape blurs the editor and puts focus on the pane itself, from
         * where Tab reaches the toolbar.
         *
         * It defers first to anything that owns Escape more urgently: an open
         * completion menu closes, and the find panel closes, before the focus
         * moves anywhere.
         */
        key: "Escape",
        run: (view) => {
          if (completionStatus(view.state) === "active") return false;
          if (findOpenRef.current) {
            setFindOpen(false);
            return true;
          }
          view.contentDOM.blur();
          wrapperRef.current?.focus();
          return true;
        },
      },
    ];

    const extensions: Extension[] = [
      /*
       * Ours first, and at the highest precedence.
       *
       * Keymaps are consulted in precedence order, so this is what guarantees
       * Ctrl-S saves the document rather than opening the browser's save
       * dialog, and that it keeps doing so whatever `defaultKeymap`, the
       * completion keymap or the markdown keymap bind now or later. None of
       * these keys collide with Enter or Backspace, so list continuation and
       * markup-aware deletion are left alone.
       */
      Prec.highest(keymap.of(bindings)),

      gutterCompartment.of(gutterExtension(false)),
      highlightActiveLine(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      placeholderExt(placeholder),

      /*
       * `markdownLanguage` rather than the default commonmark base, because
       * the publishing pipeline runs `remark-gfm`: tables, strikethrough and
       * task lists are part of the dialect an author is writing, and parsing
       * them as plain paragraphs here would leave the editor decorating a
       * different language from the one that ships.
       *
       * `codeLanguages` lets the parser recognise the language of a fenced
       * block, so ```ts is parsed as TypeScript rather than as opaque text.
       * `markdown()` installs its own keymap — Enter continues a list,
       * Backspace deletes markup, a URL pasted over a selection becomes a
       * link — at a precedence above the default one, so none of that is
       * re-implemented here.
       */
      markdown({ base: markdownLanguage, codeLanguages: languages }),

      /*
       * The decoration layer, and no `defaultHighlightStyle`.
       *
       * CodeMirror's stock highlighting is chromatic — blues, greens, reds for
       * code tokens — and this studio's palette is achromatic by construction.
       * Dropping in a rainbow inside fenced code blocks would be the one place
       * in the app where hue appears, so the source pane earns its hierarchy
       * the same way every other surface does: size, weight and contrast.
       */
      richMarkdown(),
      findHighlighting(),

      history(),
      // Only the slash menu completes. `override` replaces every other source,
      // which keeps a popup from appearing while somebody is writing prose.
      autocompletion({ override: [slashCommands] }),
      keymap.of([...historyKeymap, ...defaultKeymap]),

      theme,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),

      EditorView.domEventHandlers({
        paste: (event, view) => {
          const data = event.clipboardData;
          if (!data) return false;

          const files = imageFilesFrom(data);
          if (files.length > 0) {
            event.preventDefault();
            startImageUploadsRef.current(files, null);
            return true;
          }

          // Inside a code block, everything on the clipboard is literal.
          if (insideCode(view, view.state.selection.main.head)) return false;

          const text = data.getData("text/plain");

          /*
           * A URL over a selection is `markdown()`'s own paste handler, which
           * turns it into `[selection](url)`. Returning false hands it over
           * rather than reimplementing it here — and, more importantly, than
           * pre-empting it with the HTML branch below, because a link copied
           * from a browser puts an `<a>` on the clipboard too.
           */
          if (
            !view.state.selection.main.empty &&
            /^(https?:\/\/|mailto:|xmpp:|www\.)\S*$/.test(text.trim())
          ) {
            return false;
          }

          const html = data.getData("text/html");
          if (html.length > 0 && hasStructuralMarkup(html)) {
            const converted = htmlToMarkdown(html);
            // Nothing gained means nothing done: pasting the plain flavour
            // unchanged is better than a round-tripped copy of it.
            if (converted && converted !== text.trim()) {
              event.preventDefault();
              const range = view.state.selection.main;

              /*
               * Block markdown has to start a line.
               *
               * Pasting an article at the end of a sentence would otherwise
               * produce `…out properly.## Pasted heading`, which is not a
               * heading at all — it is a paragraph with hashes in it. Anything
               * multi-line is block content, so it gets a blank line above it
               * when the caret is mid-line, exactly as the toolbar's own block
               * insertions do.
               */
              const line = view.state.doc.lineAt(range.from);
              const midLine = range.from > line.from;
              const lead = converted.includes("\n") && midLine ? "\n\n" : "";
              const insert = `${lead}${converted}`;

              view.dispatch({
                changes: { from: range.from, to: range.to, insert },
                selection: EditorSelection.cursor(range.from + insert.length),
                scrollIntoView: true,
                userEvent: "input.paste",
              });
              return true;
            }
          }

          // Plain text, pasted as it is.
          return false;
        },

        dragenter: (event) => {
          if (imageFilesFrom(event.dataTransfer).length > 0) setDragging(true);
          return false;
        },
        dragover: (event) => {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
          return false;
        },
        dragleave: (event) => {
          // `relatedTarget` outside the editor is the only reliable "actually
          // left" signal; the event also fires crossing every child line.
          const to = event.relatedTarget;
          if (!(to instanceof Node) || !hostRef.current?.contains(to)) setDragging(false);
          return false;
        },
        drop: (event, view) => {
          const files = imageFilesFrom(event.dataTransfer);
          setDragging(false);
          if (files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
          startImageUploadsRef.current(files, at);
          return true;
        },
      }),

      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        onChangeRef.current(text);
        setCounts(countDocument(text));
        setDocVersion((version) => version + 1);
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: initialRef.current, extensions }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount only. Every prop this effect reads is either captured in a ref or
    // fixed for the life of the editor; adding them here is what would start
    // recreating the view mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The gutter is reconfigured into the running view rather than triggering a
  // rebuild, so turning line numbers on mid-paragraph costs nothing.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: gutterCompartment.reconfigure(gutterExtension(showGutter)),
    });
  }, [showGutter]);

  /** The handle the screen around this component drives the editor with. */
  useEffect(() => {
    if (!apiRef) return;

    const api: EditorApi = {
      focus: () => viewRef.current?.focus(),

      goToLine: (lineNumber) => {
        const view = viewRef.current;
        if (!view) return;
        const clamped = Math.min(Math.max(1, Math.round(lineNumber)), view.state.doc.lines);
        const line = view.state.doc.line(clamped);
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
        });
        view.focus();
      },

      scrollLineToTop: (lineNumber) => {
        const view = viewRef.current;
        if (!view) return;
        const clamped = Math.min(Math.max(1, Math.round(lineNumber)), view.state.doc.lines);
        const line = view.state.doc.line(clamped);
        // An effect rather than a manual `scrollTop`: it works for positions
        // that have not been rendered yet, which a coordinate read does not.
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
      },

      topVisibleLine: () => {
        const view = viewRef.current;
        if (!view) return null;
        const rect = view.scrollDOM.getBoundingClientRect();
        const position = view.posAtCoords({ x: rect.left + 12, y: rect.top + 2 }, false);
        return position === null ? null : view.state.doc.lineAt(position).number;
      },

      scrollElement: () => viewRef.current?.scrollDOM ?? null,

      remeasure: () => viewRef.current?.requestMeasure(),
    };

    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  const getView = useCallback(() => viewRef.current, []);

  function run(command: EditorCommand): void {
    const view = viewRef.current;
    if (view) command.run(view);
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        className,
      )}
    >
      {/*
        One row, never two.

        The strip is grouped — marks, then structure, then the pipeline's
        authoring blocks — with the groups separated rather than merely spaced,
        and it scrolls sideways instead of wrapping. A toolbar that wraps
        changes the height of the pane below it, which moves the text the
        author is reading; a toolbar that scrolls does not.
      */}
      <Toolbar aria-label="Markdown formatting" className="ui-scroll shrink-0 overflow-x-auto">
        <ToolbarGroup className="shrink-0">
          {INLINE_COMMANDS.map((command) => (
            <CommandButton key={command.id} command={command} mod={mod} onRun={run} />
          ))}
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup className="shrink-0">
          {STRUCTURE_COMMANDS.map((command) => (
            <CommandButton key={command.id} command={command} mod={mod} onRun={run} />
          ))}
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup className="shrink-0">
          {BLOCK_COMMANDS.map((command) => (
            <CommandButton key={command.id} command={command} mod={mod} onRun={run} showLabel />
          ))}
          <Button
            size="icon"
            variant="ghost"
            title="Insert an image — or paste or drop one straight in"
            aria-label="Insert an image"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon aria-hidden="true" />
          </Button>
        </ToolbarGroup>

        <ToolbarGroup className="ml-auto shrink-0">
          <Button
            size="icon"
            variant="ghost"
            title={commandHint("Find and replace", "Mod-f", mod)}
            aria-label={commandHint("Find and replace", "Mod-f", mod)}
            aria-expanded={findOpen}
            onClick={() => setFindOpen((open) => !open)}
          >
            <SearchIcon aria-hidden="true" />
          </Button>
        </ToolbarGroup>
      </Toolbar>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter(looksLikeImage);
          startImageUploads(files, null);
          // Reset so re-picking the same file fires `change` again.
          event.target.value = "";
        }}
      />

      {findOpen && (
        <FindPanel
          getView={getView}
          docVersion={docVersion}
          onClose={() => setFindOpen(false)}
        />
      )}

      {images.length > 0 && (
        <section
          aria-label="Images being inserted"
          className="flex shrink-0 flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2"
        >
          {images.map((image) => (
            <ImageRow
              key={image.token}
              image={image}
              onAltChange={(alt) => patchImage(image.token, { alt })}
              onConfirm={() => {
                patchImage(image.token, { confirmed: true });
                finishImage(image.token);
              }}
              onCancel={() => cancelImage(image.token)}
            />
          ))}
        </section>
      )}

      {/*
        React renders this element and nothing inside it. CodeMirror appends
        its own subtree here on mount and owns it from then on; giving React
        children to reconcile would put the two in a fight over the same DOM.
      */}
      <div ref={hostRef} className="ui-scroll relative min-h-0 flex-1 overflow-hidden" />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_oklch,var(--color-canvas)_70%,transparent)]">
          <p className="flex items-center gap-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium shadow-[var(--shadow-overlay)]">
            <ImageIcon className="size-4" aria-hidden="true" />
            Drop to upload and insert here
          </p>
        </div>
      )}

      {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} />}

      <footer className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-t border-[var(--color-border)] px-3 text-2xs whitespace-nowrap text-[var(--color-ink-muted)]">
        <span className="tabular-nums">
          {counts.words.toLocaleString()} {counts.words === 1 ? "word" : "words"}
        </span>
        {/* The first thing to go when the pane is narrow: a character count is
            the least useful of the three, and a wrapping status bar would
            change the height of the pane above it. */}
        <span className="hidden tabular-nums sm:inline">
          · {counts.characters.toLocaleString()} characters
        </span>
        <span className="tabular-nums">· {counts.readingMinutes} min read</span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* The label does not change with the state — a footer control that
              renames itself shifts everything beside it. The pressed state is
              carried by `aria-pressed` and by the filled variant. */}
          <Button
            size="sm"
            variant={showGutter ? "secondary" : "ghost"}
            aria-pressed={showGutter}
            title="Line numbers, to find the line a check reports"
            onClick={() => setShowGutter((on) => !on)}
          >
            <HashIcon aria-hidden="true" />
            Line numbers
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={shortcutsOpen}
            title="Keyboard shortcuts"
            onClick={() => setShortcutsOpen((open) => !open)}
          >
            <KeyboardIcon aria-hidden="true" />
            Shortcuts
          </Button>
        </div>
      </footer>
    </div>
  );
}

/**
 * One image waiting on its alt text.
 *
 * The upload and the question run in parallel: there is no reason to make an
 * author watch a progress bar before they can type the sentence describing
 * their own picture, and by the time they have, the id is usually back.
 */
function ImageRow({
  image,
  onAltChange,
  onConfirm,
  onCancel,
}: {
  image: PendingImage;
  onAltChange: (alt: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (image.error !== null) {
    return (
      <div role="alert" className="flex items-center gap-2 text-xs">
        <XIcon className="size-3.5 shrink-0 text-[var(--color-danger)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{image.filename}</span> was not inserted — {image.error}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Dismiss
        </Button>
      </div>
    );
  }

  const ready = image.assetId !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        {ready ? (
          <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Spinner size="sm" />
        )}
        <span className="max-w-40 truncate font-medium" title={image.filename}>
          {image.filename}
        </span>
        <span className="text-[var(--color-ink-muted)] tabular-nums">
          {ready
            ? formatBytes(image.bytes)
            : image.progress >= 1
              ? "processing…"
              : `${Math.round(image.progress * 100)}%`}
        </span>
      </span>

      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-xs text-[var(--color-ink-secondary)]">Alt text</span>
        <input
          ref={inputRef}
          type="text"
          value={image.alt}
          onChange={(event) => onAltChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && image.alt.trim().length > 0) {
              event.preventDefault();
              onConfirm();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="What does this image show?"
          className="ui-focus-ring h-7 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
        />
      </label>

      <Button size="sm" disabled={image.alt.trim().length === 0} onClick={onConfirm}>
        {image.confirmed && !ready ? "Waiting for the upload…" : "Insert"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>

      <p className="w-full text-2xs text-[var(--color-ink-muted)]">
        An image with no alt text is one of the three findings that refuse a publish, so it is
        asked for here rather than discovered later. Cancelling removes the placeholder; the
        upload itself stays in the media library.
      </p>
    </div>
  );
}
