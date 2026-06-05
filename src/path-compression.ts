import { shortestUniquePrefix } from "./helpers.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { readdirSync, type Dirent } from "node:fs";

export interface CompressionMap {
  segments: string[];
  uniquePrefixes: string[];
  compressibleCount: number;
}

let cachedPath: string | null = null;
let cachedMap: CompressionMap | null = null;

export function getSiblingDirs(parentAbsPath: string): string[] {
  try {
    const entries: Dirent[] = readdirSync(parentAbsPath, { withFileTypes: true });
    const result: string[] = [];
    for (const d of entries) {
      if (d.isDirectory() && !d.name.startsWith(".")) {
        result.push(d.name);
      }
    }
    return result;
  } catch (error: unknown) {
    console.error("[pi-powerline] getSiblingDirs failed for", parentAbsPath, error);
    return [];
  }
}

export function buildCompressionMap(shortenedPath: string): CompressionMap {
  if (shortenedPath === cachedPath && cachedMap !== null) {
    return cachedMap;
  }

  // Split on / — handle ~/ prefix so first segment is "~"
  // Strip trailing slashes to avoid empty trailing segments
  const normalized = shortenedPath.replace(/\/+$/, "");
  const segments = normalized.split("/");
  const uniquePrefixes: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    uniquePrefixes.push("");
  }
  const home = process.env.HOME || "";

  // If path has <= 2 segments, nothing is compressible
  const compressibleCount = segments.length <= 2 ? 0 : segments.length - 2;

  // Index 0 (root/~) is never compressed
  uniquePrefixes[0] = segments[0] ?? "";

  // Compressible segments: index 1 through segments.length - 2
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === undefined) continue;
    // Reconstruct absolute parent path
    const parentParts = segments.slice(0, i);
    const parentPath = parentParts.map((s) => (s === "~" ? home : s)).join("/") || "/";
    const siblings = getSiblingDirs(parentPath);
    uniquePrefixes[i] = shortestUniquePrefix(seg, siblings);
  }

  // Last segment is never compressed
  if (segments.length > 1) {
    uniquePrefixes[segments.length - 1] = segments[segments.length - 1] ?? "";
  }

  const map: CompressionMap = {
    segments,
    uniquePrefixes,
    compressibleCount,
  };

  cachedPath = shortenedPath;
  cachedMap = map;
  return map;
}

export function compressPath(compressionMap: CompressionMap, levels: number): string {
  const { segments, uniquePrefixes, compressibleCount } = compressionMap;
  const clampedLevels = Math.max(0, Math.min(levels, compressibleCount));

  const result: string[] = [];
  // Compressible indices are 1 to segments.length - 2
  const compressibleStart = 1;
  const compressibleEnd = segments.length - 2;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    if (i >= compressibleStart && i <= compressibleEnd && i - compressibleStart < clampedLevels) {
      result.push(uniquePrefixes[i] ?? seg);
    } else {
      result.push(seg);
    }
  }

  return result.join("/");
}

export function compressPathToWidth(shortenedPath: string, maxWidth: number): string {
  const normalized = shortenedPath.replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (segments.length <= 2) return normalized;
  if (maxWidth <= 0) {
    const map = buildCompressionMap(normalized);
    return compressPath(map, map.compressibleCount);
  }

  const map = buildCompressionMap(normalized);

  for (let levels = 0; levels <= map.compressibleCount; levels++) {
    const result = compressPath(map, levels);
    if (visibleWidth(result) <= maxWidth) {
      return result;
    }
  }

  // Best effort: return fully compressed version
  return compressPath(map, map.compressibleCount);
}

export function invalidateCompressionCache(): void {
  cachedPath = null;
  cachedMap = null;
}
