import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { formatTokens, shortenPath, stripAnsi, alignLeftRight } from "../helpers.js";
import { visibleWidth } from "@earendil-works/pi-tui";

describe("formatTokens", () => {
  it("returns '0' for zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns plain string for values under 1000", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal (1000)", () => {
    expect(formatTokens(1000)).toBe("1.0k");
  });

  it("formats thousands with one decimal (1500)", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });

  it("formats thousands with one decimal (9999)", () => {
    expect(formatTokens(9999)).toBe("10.0k");
  });

  it("formats ten-thousands as rounded k (10000)", () => {
    expect(formatTokens(10000)).toBe("10k");
  });

  it("formats near-million as rounded k (999999)", () => {
    expect(formatTokens(999999)).toBe("1000k");
  });

  it("formats millions with one decimal (1000000)", () => {
    expect(formatTokens(1000000)).toBe("1.0M");
  });

  it("formats ten-millions as rounded M (10000000)", () => {
    expect(formatTokens(10000000)).toBe("10M");
  });

  it("formats hundred-millions as rounded M (100000000)", () => {
    expect(formatTokens(100000000)).toBe("100M");
  });

  it("handles NaN", () => {
    expect(formatTokens(Number.NaN)).toBe("?");
  });

  it("handles Infinity", () => {
    expect(formatTokens(Infinity)).toBe("?");
  });

  it("handles negative numbers under 1000", () => {
    expect(formatTokens(-1)).toBe("-1");
  });

  it("handles negative numbers that are still under 1000", () => {
    expect(formatTokens(-1500)).toBe("-1500");
  });
});

describe("shortenPath", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  it("replaces HOME prefix with ~", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/user/Documents")).toBe("~/Documents");
  });

  it("returns path unchanged when HOME is not set", () => {
    expect(shortenPath("/home/user/Documents")).toBe("/home/user/Documents");
  });

  it("returns '~' when path equals HOME", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/user")).toBe("~");
  });

  it("handles path under HOME with nested directories", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/user/a/b/c")).toBe("~/a/b/c");
  });

  it("returns path unchanged when not under HOME", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/other/path")).toBe("/other/path");
  });

  it("handles empty string", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("")).toBe("");
  });

  it("uses USERPROFILE as fallback when HOME is not set", () => {
    process.env.USERPROFILE = "C:\\Users\\user";
    expect(shortenPath("C:\\Users\\user\\Desktop")).toBe("C:\\Users\\user\\Desktop");
  });

  it("no longer prefix-matches HOME-like directories (bugfix)", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/user2/file")).toBe("/home/user2/file");
  });
});

describe("stripAnsi", () => {
  it("returns string unchanged when no ANSI codes", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips a single ANSI code", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips multiple ANSI codes", () => {
    expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m\x1b[0m")).toBe("bold red");
  });

  it("strips 256-color codes", () => {
    expect(stripAnsi("\x1b[38;5;196mpink\x1b[0m")).toBe("pink");
  });

  it("strips background 256-color codes", () => {
    expect(stripAnsi("\x1b[48;5;226myellow bg\x1b[0m")).toBe("yellow bg");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("handles string with only ANSI codes", () => {
    expect(stripAnsi("\x1b[31m\x1b[0m")).toBe("");
  });

  it("preserves non-ANSI escape-like sequences", () => {
    expect(stripAnsi("hello [31mworld")).toBe("hello [31mworld");
  });

  it("handles mixed content with codes in between text", () => {
    expect(stripAnsi("a\x1b[1mb\x1b[0mc")).toBe("abc");
  });
});

describe("alignLeftRight", () => {
  it("left-right aligns when both fit with gap", () => {
    const result = alignLeftRight("left", "right", 20);
    expect(visibleWidth(result)).toBe(20);
    expect(result.startsWith("left")).toBe(true);
    expect(result.endsWith("right")).toBe(true);
  });

  it("truncates right when it does not fit", () => {
    const result = alignLeftRight("left", "verylongright", 10);
    expect(visibleWidth(result)).toBe(10);
    expect(result.startsWith("left")).toBe(true);
  });

  it("truncates left when it alone is too wide", () => {
    const result = alignLeftRight("verylongleft", "right", 5);
    expect(visibleWidth(result)).toBe(5);
  });

  it("handles width=0", () => {
    const result = alignLeftRight("left", "right", 0);
    expect(visibleWidth(result)).toBe(0);
  });

  it("handles exact fit with 2-char gap", () => {
    const result = alignLeftRight("ab", "cd", 6);
    expect(visibleWidth(result)).toBe(6);
    expect(result).toBe("ab  cd");
  });

  it("handles exact fit without gap (right truncated to nothing)", () => {
    const result = alignLeftRight("abcde", "right", 5);
    expect(visibleWidth(result)).toBe(5);
    expect(result).toBe("abcde");
  });

  it("uses visibleWidth for wide characters", () => {
    const result = alignLeftRight("你好", "right", 10);
    expect(visibleWidth(result)).toBe(10);
    expect(result.startsWith("你好")).toBe(true);
    // "right" is truncated to fit: visibleWidth("你好")=4, available=10-4-2=4
    expect(result).toContain("righ");
  });

  it("handles empty left and right", () => {
    const result = alignLeftRight("", "", 10);
    expect(visibleWidth(result)).toBe(10);
  });

  it("handles empty left", () => {
    const result = alignLeftRight("", "right", 10);
    expect(visibleWidth(result)).toBe(10);
    expect(result.endsWith("right")).toBe(true);
  });

  it("handles empty right", () => {
    const result = alignLeftRight("left", "", 10);
    expect(visibleWidth(result)).toBe(10);
    expect(result.startsWith("left")).toBe(true);
  });
});
