import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n from "./i18n";

// Pin the test locale so assertions on user-facing text are deterministic.
// Existing tests assert against English strings, so default to en here.
void i18n.changeLanguage("en");

afterEach(() => {
  cleanup();
});

// jsdom does not implement Pointer Capture; stub it for BboxOverlay drag tests.
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function () {};
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
}

// jsdom may lack ResizeObserver depending on version.
if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver })
    .ResizeObserver = StubResizeObserver;
}
