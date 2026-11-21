// GTA VI trophy earn-rate forecaster.
//
// Reads every case in the input directory and writes, for each trophy, five
// quantiles of its Exophase earn rate at the case's target: each trophy's rate,
// on the logit scale, is extrapolated along the log-time curve the house's
// reads describe, with the slope damped (growth saturates) and a band that
// widens with the horizon and the fit's own residual.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Trophy = {
  id: number;
  name: string;
  description: string;
  tier: "platinum" | "gold" | "silver" | "bronze";
  points: number;
  secret: boolean;
};

type Case = {
  id: string;
  at: string;
  target: string;
  horizon_minutes: number;
  levels: number[];
  game: { name: string; platform: string; release_date: string; source: string };
  trophies: Trophy[];
  history: {
    slot: string;
    at: string;
    players_tracked: number;
    trophies_earned: number;
    rates: (number | null)[];
  }[];
  notes?: string;
};

const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
const T_SMOOTH_HOURS = 12; // the log-time axis' scale
const DAMP = 0.6; // fraction of the fitted slope carried past the data

const clampPct = (v: number) => Math.min(99.99, Math.max(0.01, v));
const logit = (pct: number) => {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
};
const expit = (y: number) => 100 / (1 + Math.exp(-y));
const hoursOf = (iso: string) => Date.parse(iso) / 3600000;
const logTime = (hoursApart: number) => Math.log1p(Math.max(0, hoursApart) / T_SMOOTH_HOURS);

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((u, v) => u - v);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Point = { t: number; y: number };

function fitLine(points: Point[]) {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.t; sy += p.y; sxx += p.t * p.t; sxy += p.t * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  let ss = 0;
  for (const p of points) {
    const r = p.y - (a + b * p.t);
    ss += r * r;
  }
  return { a, b, sd: Math.max(0.05, Math.sqrt(ss / Math.max(1, n - 2))), n };
}

// The reads where a trophy's rate actually moved: Exophase refreshes on its own
// clock, so most reads repeat the page before them.
function seriesOf(c: Case, t0: number, idx: number): Point[] {
  const out: Point[] = [];
  let lastRate: number | null = null;
  for (const read of c.history) {
    const r = read.rates[idx];
    if (r == null) continue;
    if (lastRate == null || r !== lastRate) {
      out.push({ t: logTime(hoursOf(read.at) - t0), y: logit(r) });
      lastRate = r;
    }
  }
  return out;
}

function forecastCase(c: Case): { id: number; q: number[] }[] {
  const t0 = hoursOf(c.history[0].at);
  const tAt = hoursOf(c.at);
  const tTarget = hoursOf(c.target);
  const horizonDays = Math.max(0.02, (tTarget - tAt) / 24);
  const xAt = logTime(tAt - t0);
  const xTarget = logTime(tTarget - t0);
  const span = Math.max(0, xTarget - xAt);

  const fits = c.trophies.map((tr, idx) => {
    const pts = seriesOf(c, t0, idx);
    const fit = fitLine(pts.slice(-60));
    const last = pts.length ? pts[pts.length - 1] : null;
    return { tr, pts, fit, last };
  });

  const slopeByTier = new Map<string, number[]>();
  const allSlopes: number[] = [];
  for (const f of fits) {
    if (f.fit && Number.isFinite(f.fit.b)) {
      allSlopes.push(f.fit.b);
      const k = f.tr.tier;
      if (!slopeByTier.has(k)) slopeByTier.set(k, []);
      slopeByTier.get(k)!.push(f.fit.b);
    }
  }
  const bGlobal = median(allSlopes);

  return fits.map((f) => {
    const lastRate = f.last ? f.last.y : logit(1);
    const bTier = median(slopeByTier.get(f.tr.tier) ?? []);
    let b: number;
    let sd: number;
    if (f.fit && f.pts.length >= 4) {
      b = 0.65 * f.fit.b + 0.35 * bTier;
      sd = f.fit.sd;
    } else if (f.pts.length >= 3) {
      b = bTier;
      sd = 0.35;
    } else {
      b = 0.4 * (Number.isFinite(bTier) ? bTier : bGlobal);
      sd = 0.6;
    }
    if (!Number.isFinite(b)) b = 0;

    const xLast = f.last ? f.last.t : 0;
    const yAt = lastRate + b * DAMP * (xAt - xLast);
    const yTarget = yAt + b * DAMP * span;

    const rw = 0.42 * Math.sqrt(horizonDays);
    const extrap = 0.35 * Math.abs(b) * span;
    const sigma = Math.min(3.2, Math.max(0.18, Math.sqrt(sd * sd + rw * rw + extrap * extrap)));

    const q = Z.map((z) => expit(yTarget + z * sigma)).map((v, i, arr) =>
      Math.round(Math.min(99.99, Math.max(0.01, i > 0 ? Math.max(v, arr[i - 1]) : v)) * 10000) / 10000
    );
    return { id: f.tr.id, q };
  });
}

function main() {
  const inDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const files = readdirSync(inDir).filter((f) => f.endsWith(".in")).sort();
  if (!files.length) throw new Error(`no .in cases in ${inDir}`);
  for (const file of files) {
    const c = JSON.parse(readFileSync(join(inDir, file), "utf8")) as Case;
    const rows = forecastCase(c);
    writeFileSync(join(outDir, `${c.id}.out`), JSON.stringify({ trophies: rows }), "utf8");
  }
}

main();
