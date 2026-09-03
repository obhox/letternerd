import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library's auto-cleanup only registers itself when the test globals
// are installed. This suite runs without them, so unmounting is done here —
// otherwise every rendered tree stays in the document and `getByRole` starts
// matching an element from a previous test.
afterEach(() => {
  cleanup();
});
