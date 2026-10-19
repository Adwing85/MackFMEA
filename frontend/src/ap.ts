import type { AP } from "./types";

// Aufgabenpriorität nach AIAG & VDA (DFMEA) – identisch zu backend/app/services/ap.py
const O_BANDS: [number, number][] = [
  [8, 10],
  [6, 7],
  [4, 5],
  [2, 3],
  [1, 1],
];
const D_BANDS: [number, number][] = [
  [7, 10],
  [5, 6],
  [2, 4],
  [1, 1],
];
const TABLE: Record<string, string[]> = {
  "9-10": ["HHHH", "HHHH", "HHHM", "HMLL", "LLLL"],
  "7-8": ["HHHH", "HHHM", "HMMM", "MMLL", "LLLL"],
  "4-6": ["HHMM", "MMML", "MLLL", "LLLL", "LLLL"],
  "2-3": ["MMLL", "LLLL", "LLLL", "LLLL", "LLLL"],
};

const clamp = (v: number) => Math.max(1, Math.min(10, Math.round(v)));
const band = (v: number, bands: [number, number][]) => bands.findIndex(([lo, hi]) => v >= lo && v <= hi);

export function actionPriority(severity: number, occurrence: number, detection: number): AP {
  const s = clamp(severity);
  if (s === 1) return "L";
  const sBand = s >= 9 ? "9-10" : s >= 7 ? "7-8" : s >= 4 ? "4-6" : "2-3";
  return TABLE[sBand][band(clamp(occurrence), O_BANDS)][band(clamp(detection), D_BANDS)] as AP;
}
