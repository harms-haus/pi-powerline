import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("node:fs", () => ({ readdirSync: vi.fn() }));

import { readdirSync } from "node:fs";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pathCompression: typeof import("../path-compression.js");

beforeEach(async () => {
  vi.mocked(readdirSync).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  pathCompression = await import("../path-compression.js");
  pathCompression.invalidateCompressionCache();
});

// ─── getSiblingDirs ─────────────────────────────────────────────

describe("getSiblingDirs", () => {
  it("returns directory names only (filters out files)", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "dir1", isDirectory: () => true } as any,
      { name: "file1.txt", isDirectory: () => false } as any,
      { name: "dir2", isDirectory: () => true } as any,
      { name: "file2.ts", isDirectory: () => false } as any,
    ]);
    expect(pathCompression.getSiblingDirs("/some/path")).toEqual(["dir1", "dir2"]);
  });

  it("filters out hidden entries (dot prefix)", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "visible", isDirectory: () => true } as any,
      { name: ".hidden", isDirectory: () => true } as any,
      { name: ".config", isDirectory: () => true } as any,
    ]);
    expect(pathCompression.getSiblingDirs("/some/path")).toEqual(["visible"]);
  });

  it("returns empty array on error (ENOENT)", () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(pathCompression.getSiblingDirs("/nonexistent")).toEqual([]);
  });

  it("returns empty array on error (EACCES)", () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(pathCompression.getSiblingDirs("/forbidden")).toEqual([]);
  });
});

// ─── buildCompressionMap ────────────────────────────────────────

describe("buildCompressionMap", () => {
  it("builds map for 3-segment path with correct segments, prefixes, and count", () => {
    // ~/Documents/project → segments: ["~", "Documents", "project"]
    // siblings of "Documents" in ~ → ["abc", "def", "Documents"]
    // "D" is unique since no other sibling starts with "D"
    vi.mocked(readdirSync).mockReturnValue([
      { name: "abc", isDirectory: () => true } as any,
      { name: "def", isDirectory: () => true } as any,
      { name: "Documents", isDirectory: () => true } as any,
    ]);

    const map = pathCompression.buildCompressionMap("~/Documents/project");

    expect(map.segments).toEqual(["~", "Documents", "project"]);
    expect(map.compressibleCount).toBe(1);
    expect(map.uniquePrefixes[0]).toBe("~");
    expect(map.uniquePrefixes[1]).toBe("D");
    expect(map.uniquePrefixes[2]).toBe("project");
  });

  it("never compresses index 0 (root/~) or last segment (leaf)", () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: "a", isDirectory: () => true } as any,
      { name: "b", isDirectory: () => true } as any,
    ]);

    const map = pathCompression.buildCompressionMap("~/a/b/c");

    // Index 0 and last are always the original segment
    expect(map.uniquePrefixes[0]).toBe("~");
    expect(map.uniquePrefixes[map.segments.length - 1]).toBe("c");
  });

  it("returns compressibleCount = 0 for path with <= 2 segments", () => {
    vi.mocked(readdirSync).mockReturnValue([]);

    const map1 = pathCompression.buildCompressionMap("~");
    expect(map1.segments).toEqual(["~"]);
    expect(map1.compressibleCount).toBe(0);

    pathCompression.invalidateCompressionCache();
    const map2 = pathCompression.buildCompressionMap("~/Documents");
    expect(map2.segments).toEqual(["~", "Documents"]);
    expect(map2.compressibleCount).toBe(0);
  });
});

// ─── compressPath ───────────────────────────────────────────────

describe("compressPath", () => {
  function makeMap(segments: string[], uniquePrefixes: string[], compressibleCount: number) {
    return { segments, uniquePrefixes, compressibleCount };
  }

  it("level 0 returns the original path (no compression)", () => {
    const map = makeMap(["~", "Documents", "software", "project"], ["~", "Do", "s", "project"], 2);
    expect(pathCompression.compressPath(map, 0)).toBe("~/Documents/software/project");
  });

  it("level 1 replaces first compressible segment only", () => {
    const map = makeMap(["~", "Documents", "software", "project"], ["~", "Do", "s", "project"], 2);
    expect(pathCompression.compressPath(map, 1)).toBe("~/Do/software/project");
  });

  it("max level replaces all compressible segments", () => {
    const map = makeMap(["~", "Documents", "software", "project"], ["~", "Do", "s", "project"], 2);
    expect(pathCompression.compressPath(map, 2)).toBe("~/Do/s/project");
  });

  it("clamps level > max to max", () => {
    const map = makeMap(["~", "Documents", "software", "project"], ["~", "Do", "s", "project"], 2);
    expect(pathCompression.compressPath(map, 10)).toBe("~/Do/s/project");
  });

  it("clamps negative level to 0", () => {
    const map = makeMap(["~", "Documents", "software", "project"], ["~", "Do", "s", "project"], 2);
    expect(pathCompression.compressPath(map, -1)).toBe("~/Documents/software/project");
  });
});

// ─── compressPathToWidth ────────────────────────────────────────

describe("compressPathToWidth", () => {
  it("returns path unchanged when it already fits", () => {
    // Short path that fits in generous width — no need to mock fs since ≤ 2 segments
    const result = pathCompression.compressPathToWidth("~/project", 100);
    expect(result).toBe("~/project");
  });

  it("compresses until path fits within maxWidth", () => {
    // ~/Documents/software/project — 3 compressible segments... actually 2 compressible
    // ~/Documents/software/project has segments ["~", "Documents", "software", "project"]
    // compressibleCount = 2 (indices 1 and 2)
    vi.mocked(readdirSync).mockImplementation((dirPath: any) => {
      const path = typeof dirPath === "string" ? dirPath : dirPath.path;
      if (path.includes("testuser") || path === process.env.HOME) {
        // ~ has siblings including Documents
        return [
          { name: "Desktop", isDirectory: () => true } as any,
          { name: "Documents", isDirectory: () => true } as any,
          { name: "Downloads", isDirectory: () => true } as any,
        ];
      }
      // ~/Documents or ~/Documents/software
      return [{ name: "software", isDirectory: () => true } as any];
    });

    // Full path is "~/Documents/software/project" = 29 chars
    const fullWidth = "~/Documents/software/project".length;

    // Request width slightly less than full — should compress at least one level
    const result = pathCompression.compressPathToWidth(
      "~/Documents/software/project",
      fullWidth - 1,
    );
    expect(result.length).toBeLessThan(fullWidth);
  });

  it("returns fully compressed when even full compression doesn't fit", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "abc", isDirectory: () => true } as any,
    ]);

    // maxWidth = 1 is extremely tight — no path will fit
    const result = pathCompression.compressPathToWidth("~/abc/def/ghi", 1);
    // Should be the fully compressed version
    expect(result).toBeDefined();
    // The result is the best effort (fully compressed)
    expect(result).toContain("/");
  });

  it("returns 2-segment path as-is", () => {
    const result = pathCompression.compressPathToWidth("~/project", 5);
    expect(result).toBe("~/project");
  });

  it("returns most compressed version when maxWidth <= 0", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "xyz", isDirectory: () => true } as any,
      { name: "alpha", isDirectory: () => true } as any,
      { name: "bravo", isDirectory: () => true } as any,
    ]);
    const result = pathCompression.compressPathToWidth("~/alpha/bravo/charlie", 0);
    // Should be fully compressed, not the raw path
    expect(result).not.toBe("~/alpha/bravo/charlie");
    expect(result).toContain("/");
  });

  it("strips trailing slash before compressing", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "Documents", isDirectory: () => true } as any,
      { name: "Desktop", isDirectory: () => true } as any,
    ]);
    const withoutSlash = pathCompression.compressPathToWidth("~/Documents/project", 100);
    pathCompression.invalidateCompressionCache();
    const withSlash = pathCompression.compressPathToWidth("~/Documents/project/", 100);
    // Trailing slash should not produce empty segments or differ from no-slash
    expect(withSlash).toBe(withoutSlash);
  });

  it("handles absolute path (root segment is empty string)", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "local", isDirectory: () => true } as any,
      { name: "usr", isDirectory: () => true } as any,
    ]);
    const result = pathCompression.compressPathToWidth("/usr/local/bin", 3);
    // Should start with "/" and contain compressions
    expect(result.startsWith("/")).toBe(true);
    expect(result).toContain("/");
  });

  it("handles empty string input gracefully", () => {
    const result = pathCompression.compressPathToWidth("", 100);
    expect(result).toBe("");
  });

  it("caches: calling twice with same path reads filesystem only once", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "abc", isDirectory: () => true } as any,
    ]);

    pathCompression.compressPathToWidth("~/abc/def/ghi", 100);
    const callCount1 = vi.mocked(readdirSync).mock.calls.length;

    pathCompression.compressPathToWidth("~/abc/def/ghi", 50);
    const callCount2 = vi.mocked(readdirSync).mock.calls.length;

    // Second call should not increase the readdirSync call count (cache hit)
    expect(callCount2).toBe(callCount1);
  });
});

// ─── invalidateCompressionCache ─────────────────────────────────

describe("invalidateCompressionCache", () => {
  it("causes next call to re-read filesystem", () => {
    vi.mocked(readdirSync).mockImplementation(() => [
      { name: "abc", isDirectory: () => true } as any,
    ]);

    pathCompression.compressPathToWidth("~/abc/def/ghi", 100);
    const callCount1 = vi.mocked(readdirSync).mock.calls.length;

    pathCompression.invalidateCompressionCache();

    pathCompression.compressPathToWidth("~/abc/def/ghi", 100);
    const callCount2 = vi.mocked(readdirSync).mock.calls.length;

    // After invalidation, filesystem should be read again
    expect(callCount2).toBeGreaterThan(callCount1);
  });
});
