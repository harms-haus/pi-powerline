import { describe, it, expect } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatGitChanges, colorCodeGitChanges, clearGitTimer } from "../git";

const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
} as unknown as Theme;

describe("formatGitChanges", () => {
  it("returns empty string for null", () => {
    expect(formatGitChanges(null)).toBe("");
  });

  it("returns empty string when both insertions and deletions are zero", () => {
    expect(formatGitChanges({ insertions: 0, deletions: 0 })).toBe("");
  });

  it("formats both insertions and deletions", () => {
    expect(formatGitChanges({ insertions: 388, deletions: 245 })).toBe("+388 -245");
  });

  it("formats only insertions when deletions are zero", () => {
    expect(formatGitChanges({ insertions: 42, deletions: 0 })).toBe("+42");
  });

  it("formats only deletions when insertions are zero", () => {
    expect(formatGitChanges({ insertions: 0, deletions: 7 })).toBe("-7");
  });
});

describe("colorCodeGitChanges", () => {
  it("returns dim-colored empty string for null", () => {
    expect(colorCodeGitChanges(null, mockTheme)).toBe("[dim]");
  });

  it("returns dim-colored empty string when both insertions and deletions are zero", () => {
    expect(colorCodeGitChanges({ insertions: 0, deletions: 0 }, mockTheme)).toBe("[dim]");
  });

  it("applies green to insertions and red to deletions when both are present", () => {
    expect(colorCodeGitChanges({ insertions: 388, deletions: 245 }, mockTheme)).toBe(
      "[success]+388 [error]-245",
    );
  });

  it("applies green to insertions when deletions are zero", () => {
    expect(colorCodeGitChanges({ insertions: 42, deletions: 0 }, mockTheme)).toBe("[success]+42");
  });

  it("applies red to deletions when insertions are zero", () => {
    expect(colorCodeGitChanges({ insertions: 0, deletions: 7 }, mockTheme)).toBe("[error]-7");
  });
});

describe("clearGitTimer", () => {
  it("resets gitChanges to null", async () => {
    // clearGitTimer always sets gitChanges to null, so we verify
    // the exported gitChanges is null after calling it.
    clearGitTimer();

    // Re-import to get the updated value
    const { gitChanges } = await import("../git");
    expect(gitChanges).toBeNull();
  });
});
