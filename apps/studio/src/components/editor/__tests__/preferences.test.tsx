import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installLocalStorage, type FakeLocalStorage } from "@/test/local-storage";
import { useRemembered, useRememberedFlag } from "../preferences";

const LAYOUTS = ["split", "editor", "preview"] as const;

/** The namespace the module writes under; asserted rather than reimplemented. */
const LAYOUT_KEY = "cms.studio.editor.layout";
const GUTTER_KEY = "cms.studio.editor.gutter";

let storage: FakeLocalStorage;

beforeEach(() => {
  storage = installLocalStorage();
});

afterEach(() => {
  storage.restore();
});

describe("useRemembered", () => {
  it("uses the fallback when nothing has been stored", () => {
    const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    expect(result.current[0]).toBe("split");
  });

  it("adopts a stored value once mounted", () => {
    storage.entries.set(LAYOUT_KEY, "preview");
    const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    expect(result.current[0]).toBe("preview");
  });

  it("ignores a stored value that is no longer one of the choices", () => {
    // Preferences outlive the code that wrote them. A layout removed in a
    // later version is still sitting in somebody's browser, and applying it
    // would put the editor into a state the component cannot render.
    storage.entries.set(LAYOUT_KEY, "three-column");
    const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    expect(result.current[0]).toBe("split");
  });

  it("persists a choice under a namespaced key", () => {
    // A bare "layout" key is the kind of thing two features collide on later,
    // and the collision is silent in both directions.
    const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    act(() => result.current[1]("editor"));

    expect(result.current[0]).toBe("editor");
    expect(storage.entries.get(LAYOUT_KEY)).toBe("editor");
  });

  it("reads back a choice made in an earlier session", () => {
    // The round trip, not just each half: a write and a read that disagree
    // about the key would each pass their own test.
    const first = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    act(() => first.result.current[1]("preview"));
    first.unmount();

    const second = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
    expect(second.result.current[0]).toBe("preview");
  });

  /**
   * `localStorage` is not a plain object. Reading it throws outright in a
   * browser configured to block site data and in a cross-origin iframe, and
   * writing throws when the origin's quota is full. An unguarded access here
   * takes the whole editor down at mount — losing an author their draft over a
   * preference about pane widths.
   */
  describe("when the store is unusable", () => {
    it("falls back to the default rather than throwing on read", () => {
      storage.entries.set(LAYOUT_KEY, "preview");
      storage.failReads();

      const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
      expect(result.current[0]).toBe("split");
    });

    it("still honours the choice for this session when the write throws", () => {
      storage.failWrites();

      const { result } = renderHook(() => useRemembered("layout", LAYOUTS, "split"));
      act(() => result.current[1]("editor"));

      // A preference that cannot be persisted is still a preference now.
      expect(result.current[0]).toBe("editor");
    });
  });
});

describe("useRememberedFlag", () => {
  it("hands the caller a boolean and stores the strings the allow-list accepts", () => {
    const { result } = renderHook(() => useRememberedFlag("gutter", false));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    // "on"/"off" rather than "true"/"false": the stored value has to be one
    // `useRemembered` will accept back, or the flag silently never restores.
    expect(storage.entries.get(GUTTER_KEY)).toBe("on");

    act(() => result.current[1](false));
    expect(storage.entries.get(GUTTER_KEY)).toBe("off");
  });

  it("restores a stored flag", () => {
    storage.entries.set(GUTTER_KEY, "on");
    const { result } = renderHook(() => useRememberedFlag("gutter", false));
    expect(result.current[0]).toBe(true);
  });

  it("keeps the fallback when the stored value is not one of the two spellings", () => {
    storage.entries.set(GUTTER_KEY, "true");
    const { result } = renderHook(() => useRememberedFlag("gutter", false));
    expect(result.current[0]).toBe(false);
  });

  it("does not throw when the store is unreadable", () => {
    storage.failReads();
    const { result } = renderHook(() => useRememberedFlag("gutter", true));
    expect(result.current[0]).toBe(true);
  });
});
