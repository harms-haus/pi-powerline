import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";

// Mutable backing fields for the state mock
let mockCurrentCwd: string | undefined;
let mockApi: { exec: ReturnType<typeof vi.fn> } | undefined;
let mockRequestRefresh: ReturnType<typeof vi.fn>;

vi.mock("../state", () => ({
  get currentCwd() {
    return mockCurrentCwd;
  },
  get api() {
    return mockApi;
  },
  get requestRefresh() {
    return mockRequestRefresh;
  },
}));

// Dynamic import so mock is applied before evaluation
const { colorCodeGitChanges, clearGitTimer, refreshGitDiff, debouncedRefreshGitDiff } =
  await vi.mocked(await import("../git"));

const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
} as unknown as Theme;

beforeEach(() => {
  mockCurrentCwd = undefined;
  mockApi = undefined;
  mockRequestRefresh = vi.fn();
  clearGitTimer();
});

afterEach(() => {
  clearGitTimer();
  vi.useRealTimers();
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
    clearGitTimer();
    const { gitChanges } = await import("../git");
    expect(gitChanges).toBeNull();
  });
});

describe("refreshGitDiff", () => {
  it("does nothing when currentCwd is undefined", async () => {
    mockCurrentCwd = undefined;
    mockApi = { exec: vi.fn() };
    await refreshGitDiff();
    expect(mockApi.exec).not.toHaveBeenCalled();
  });

  it("does nothing when api is undefined", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = undefined;
    await refreshGitDiff();
  });

  it("parses git diff shortstat and updates gitChanges", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: " 5 files changed, 120 insertions(+), 30 deletions(-)",
      }),
    };

    await refreshGitDiff();

    expect(mockApi.exec).toHaveBeenCalledWith("git", ["diff", "--shortstat", "HEAD"], {
      cwd: "/home/user/project",
      timeout: 5000,
    });

    // gitChanges should have been updated
    const { gitChanges } = await import("../git");
    expect(gitChanges).toEqual({ insertions: 120, deletions: 30 });
    expect(mockRequestRefresh).toHaveBeenCalled();
  });

  it("parses insertions-only shortstat", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: " 2 files changed, 50 insertions(+)",
      }),
    };

    await refreshGitDiff();

    const { gitChanges } = await import("../git");
    expect(gitChanges).toEqual({ insertions: 50, deletions: 0 });
  });

  it("parses deletions-only shortstat", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: " 1 file changed, 10 deletions(-)",
      }),
    };

    await refreshGitDiff();

    const { gitChanges } = await import("../git");
    expect(gitChanges).toEqual({ insertions: 0, deletions: 10 });
  });

  it("sets gitChanges to null when exit code is non-zero", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 128,
        stdout: "fatal: not a git repository",
      }),
    };

    await refreshGitDiff();

    const { gitChanges } = await import("../git");
    expect(gitChanges).toBeNull();
    expect(mockRequestRefresh).toHaveBeenCalled();
  });

  it("sets gitChanges to null on empty output", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: "",
      }),
    };

    await refreshGitDiff();

    const { gitChanges } = await import("../git");
    expect(gitChanges).toBeNull();
  });

  it("handles exec error gracefully", async () => {
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockRejectedValue(new Error("spawn failed")),
    };

    await refreshGitDiff();

    const { gitChanges } = await import("../git");
    expect(gitChanges).toBeNull();
    expect(mockRequestRefresh).toHaveBeenCalled();
  });

  it("prevents concurrent invocations (in-flight guard)", async () => {
    mockCurrentCwd = "/home/user/project";
    let resolveFirst: () => void;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    mockApi = {
      exec: vi.fn().mockImplementation(() => firstCall.then(() => ({ code: 0, stdout: "" }))),
    };

    // Start two concurrent refreshGitDiff calls
    const p1 = refreshGitDiff();
    const p2 = refreshGitDiff();

    // Only the first call should have triggered exec
    expect(mockApi.exec).toHaveBeenCalledOnce();

    // Resolve the first call
    resolveFirst!();
    await p1;
    await p2;

    // After resolution, gitDiffInFlight should be false again
    expect(mockRequestRefresh).toHaveBeenCalled();
  });
});

describe("debouncedRefreshGitDiff", () => {
  it("calls refreshGitDiff after debounce delay", async () => {
    vi.useFakeTimers();
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: " 1 file changed, 5 insertions(+)",
      }),
    };

    debouncedRefreshGitDiff();

    // Not yet called
    expect(mockApi.exec).not.toHaveBeenCalled();

    // Advance past debounce
    vi.advanceTimersByTime(500);
    await vi.advanceTimersByTimeAsync(0);

    // Now it should have been called
    expect(mockApi.exec).toHaveBeenCalled();
  });

  it("debounces multiple rapid calls — only one refreshGitDiff runs", async () => {
    vi.useFakeTimers();
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: "",
      }),
    };

    debouncedRefreshGitDiff();
    vi.advanceTimersByTime(200);
    debouncedRefreshGitDiff();
    vi.advanceTimersByTime(200);
    debouncedRefreshGitDiff();

    vi.advanceTimersByTime(500);
    await vi.advanceTimersByTimeAsync(0);

    // Only one call should have been made (last debounce wins)
    expect(mockApi.exec).toHaveBeenCalledOnce();
  });

  it("clearGitTimer cancels the debounced call", async () => {
    vi.useFakeTimers();
    mockCurrentCwd = "/home/user/project";
    mockApi = {
      exec: vi.fn().mockResolvedValue({ code: 0, stdout: "" }),
    };

    debouncedRefreshGitDiff();
    clearGitTimer();

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Should NOT have been called — timer was cleared
    expect(mockApi.exec).not.toHaveBeenCalled();
  });
});
