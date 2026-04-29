export interface LineDiff {
  oldLines: { line: string; status: "same" | "removed" }[];
  newLines: { line: string; status: "same" | "added" }[];
}

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  status: "added" | "removed" | "changed" | "unchanged";
}

/**
 * Simple line-level diff via Longest Common Subsequence. Adequate for short
 * prompts; not optimal for long texts.
 */
export function lineDiff(oldText: string, newText: string): LineDiff {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const oldLines: LineDiff["oldLines"] = [];
  const newLines: LineDiff["newLines"] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      oldLines.push({ line: a[i], status: "same" });
      newLines.push({ line: b[j], status: "same" });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      oldLines.push({ line: a[i], status: "removed" });
      i++;
    } else {
      newLines.push({ line: b[j], status: "added" });
      j++;
    }
  }
  while (i < m) {
    oldLines.push({ line: a[i++], status: "removed" });
  }
  while (j < n) {
    newLines.push({ line: b[j++], status: "added" });
  }
  return { oldLines, newLines };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )) return false;
  }
  return true;
}

export function fieldDiff(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldDiff[] {
  const o = oldData ?? {};
  const n = newData ?? {};
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
  return keys.map((field) => {
    const inOld = field in o;
    const inNew = field in n;
    if (!inOld && inNew) return { field, oldValue: undefined, newValue: n[field], status: "added" };
    if (inOld && !inNew) return { field, oldValue: o[field], newValue: undefined, status: "removed" };
    return {
      field,
      oldValue: o[field],
      newValue: n[field],
      status: deepEqual(o[field], n[field]) ? "unchanged" : "changed",
    };
  });
}
