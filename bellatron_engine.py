#!/usr/bin/env python3
"""
Bellatron v2.4 (WillexOS core)
- Reed-first truth
- Baseline-aware travel inference
- Option B + Option 2: windowed environment detection using nearest SNAPSHOT humidity per MOVE
- Installer recommendations
- Timeline + Episodes
- Confidence grading

Run:
  python bellatron_engine.py samples\\stress_mixed_conditions.txt
  python bellatron_engine.py samples\\stress_mixed_conditions.txt --json
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple, Any
from math import isfinite
import statistics as stats
from datetime import datetime, timezone
import argparse, pathlib, json, re

VERSION = "2.4"
ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

# -------------------------------------------------
# Parsing
# -------------------------------------------------

def parse_iso(ts: str) -> Optional[datetime]:
    if ISO_RE.match(ts):
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return None

def fmt_ts(dt: Optional[datetime]) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else "?"

def parse_kv(s: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for tok in s.split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            out[k] = v
    return out

@dataclass
class Event:
    ts: Optional[datetime]
    typ: str
    kv: Dict[str, str]
    line: int

    def f(self, k, d=float("nan")) -> float:
        try:
            return float(self.kv.get(k, d))
        except:
            return d

    def i(self, k, d=-1) -> int:
        try:
            return int(self.kv.get(k, d))
        except:
            return d

@dataclass
class ParsedLog:
    header: Dict[str, str]
    events: List[Event]

def parse_log(text: str) -> ParsedLog:
    header: Dict[str, str] = {}
    events: List[Event] = []
    for ln, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            header.update(parse_kv(line[1:]))
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 2:
            continue
        ts = parse_iso(parts[0])
        typ = parts[1]
        kv = parse_kv(parts[2] if len(parts) > 2 else "")
        events.append(Event(ts, typ, kv, ln))
    return ParsedLog(header, events)

# -------------------------------------------------
# Baselines
# -------------------------------------------------

@dataclass
class Baselines:
    closed: Optional[float] = None
    open: Optional[float] = None
    max_travel: Optional[float] = None
    learned: bool = False

def learn_baselines(events: List[Event]) -> Baselines:
    closed_vals: List[float] = []
    open_vals: List[float] = []
    travels: List[float] = []

    for e in events:
        if e.typ != "MOVE":
            continue
        if e.kv.get("end_reason") == "timeout":
            continue

        s, end = e.f("start_deg"), e.f("end_deg")
        if not (isfinite(s) and isfinite(end)):
            continue

        travels.append(abs(end - s))
        if e.kv.get("to") == "closed":
            closed_vals.append(end)
        elif e.kv.get("to") == "open":
            open_vals.append(end)

    bl = Baselines()
    if closed_vals:
        bl.closed = stats.median(closed_vals)
    if open_vals:
        bl.open = stats.median(open_vals)
    if travels:
        bl.max_travel = max(travels)

    bl.learned = bl.closed is not None and bl.max_travel is not None
    return bl

# -------------------------------------------------
# Snapshot correlation (Option 2)
# -------------------------------------------------

def build_snapshot_series(events: List[Event]) -> List[Tuple[datetime, float]]:
    series: List[Tuple[datetime, float]] = []
    for e in events:
        if e.typ != "SNAPSHOT":
            continue
        if e.ts is None:
            continue
        h = e.f("hum")
        if isfinite(h):
            series.append((e.ts, h))
    series.sort(key=lambda x: x[0])
    return series

def nearest_snapshot_humidity(series: List[Tuple[datetime, float]],
                              t: Optional[datetime],
                              max_age_s: int = 10 * 60) -> Optional[float]:
    if not series or t is None:
        return None

    lo, hi = 0, len(series) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if series[mid][0] < t:
            lo = mid + 1
        elif series[mid][0] > t:
            hi = mid - 1
        else:
            return series[mid][1]

    candidates = []
    if 0 <= hi < len(series):
        candidates.append(series[hi])
    if 0 <= lo < len(series):
        candidates.append(series[lo])

    best = None
    best_dt = None
    for ts0, hum0 in candidates:
        dt_s = abs((ts0 - t).total_seconds())
        if best_dt is None or dt_s < best_dt:
            best_dt = dt_s
            best = hum0

    if best_dt is not None and best_dt <= max_age_s:
        return best
    return None

# -------------------------------------------------
# Analysis
# -------------------------------------------------

@dataclass
class Features:
    good: int = 0
    marginal: int = 0
    latch_miss: int = 0
    hard_fail: int = 0
    drift: int = 0

    median_humidity: Optional[float] = None  # global
    slow_ratio: float = 1.0

    slow_close_humidity_median: Optional[float] = None
    slow_close_samples: int = 0

    intermittent_soft: bool = False
    intermittent_hard: bool = False

@dataclass
class Confidence:
    score: float
    level: str  # HIGH/MED/LOW
    reasons: List[str]

@dataclass
class Diagnosis:
    scores: Dict[str, float]
    recommendations: List[str]
    notes: List[str]
    confidence: Confidence
    timeline_events: List[Dict[str, Any]]
    episodes: List[Dict[str, Any]]

def _confidence_level(score: float) -> str:
    if score >= 0.75:
        return "HIGH"
    if score >= 0.50:
        return "MED"
    return "LOW"

def analyze(parsed: ParsedLog) -> Tuple[Baselines, Features, Diagnosis]:
    bl = learn_baselines(parsed.events)
    ft = Features()

    snap_series = build_snapshot_series(parsed.events)
    if snap_series:
        ft.median_humidity = stats.median([h for _, h in snap_series])

    closes = [e for e in parsed.events if e.typ == "MOVE" and e.kv.get("to") == "closed"]

    durs = sorted(e.i("duration_ms") for e in closes if e.i("duration_ms") > 0)
    base = None
    if durs:
        base = stats.median(durs[:max(1, len(durs)//3)])
        ft.slow_ratio = max(d / base for d in durs) if base > 0 else 1.0

    slow_hums: List[float] = []
    timeline: List[Dict[str, Any]] = []

    # thresholds (tune later if needed)
    SLOW_FACTOR = 1.3
    HUM_WET = 75.0

    for e in closes:
        reed = e.i("reed_end", -1)
        reed30 = e.i("reed_settle_30s", -1)
        reason = e.kv.get("end_reason", "")

        s, end = e.f("start_deg"), e.f("end_deg")
        tp = None
        if bl.max_travel and isfinite(s) and isfinite(end):
            tp = abs(end - s) / bl.max_travel

        dur = e.i("duration_ms", -1)
        is_slow = bool(base and dur > 0 and dur > base * SLOW_FACTOR)

        # humidity correlated to this MOVE (Option 2)
        hum_move = e.f("hum")
        hum_near = None
        if isfinite(hum_move):
            hum_near = hum_move
        else:
            hum_near = nearest_snapshot_humidity(snap_series, e.ts, max_age_s=10*60)

        if is_slow and hum_near is not None:
            slow_hums.append(hum_near)

        # classification
        outcome = "UNKNOWN"
        if reed == 1:
            if tp is None or tp >= 0.95:
                ft.good += 1
                outcome = "GOOD_CLOSE"
            elif tp >= 0.80:
                ft.marginal += 1
                outcome = "MARGINAL_CLOSE"
            else:
                ft.marginal += 1
                outcome = "MARGINAL_CLOSE"
        elif reed == 0:
            if tp is None:
                ft.hard_fail += 1
                outcome = "HARD_FAIL"
            elif tp < 0.60:
                ft.hard_fail += 1
                outcome = "HARD_FAIL"
            elif tp < 0.80:
                ft.latch_miss += 1
                outcome = "LATCH_MISS"
            else:
                ft.latch_miss += 1
                outcome = "LATCH_MISS"

        drifted = (reed == 1 and reed30 == 0)
        if drifted:
            ft.drift += 1

        timeline.append({
            "ts": e.ts.isoformat().replace("+00:00","Z") if e.ts else None,
            "outcome": outcome,
            "duration_ms": dur,
            "slow": is_slow,
            "hum_near": hum_near,
            "wet": (hum_near is not None and hum_near >= HUM_WET),
            "start_deg": s if isfinite(s) else None,
            "end_deg": end if isfinite(end) else None,
            "travel_pct": tp,
            "end_reason": reason,
            "reed_end": reed,
            "reed_settle_30s": reed30,
            "drift": drifted,
        })

    if slow_hums:
        ft.slow_close_samples = len(slow_hums)
        ft.slow_close_humidity_median = stats.median(slow_hums)

    if ft.hard_fail > 0 and (ft.good + ft.marginal) > 0:
        ft.intermittent_hard = True

    if (ft.slow_close_humidity_median is not None
        and ft.slow_close_humidity_median >= HUM_WET
        and ft.slow_ratio > SLOW_FACTOR):
        ft.intermittent_soft = True

    # scoring
    scores = {
        "environment_related_resistance": 0.0,
        "mechanical_drag_or_obstruction": 0.0,
        "bounce_back_or_force_issue": 0.0,
    }
    if ft.hard_fail or ft.latch_miss:
        scores["mechanical_drag_or_obstruction"] += 0.8
    if ft.intermittent_soft:
        scores["environment_related_resistance"] += 0.4
    if ft.drift:
        scores["bounce_back_or_force_issue"] += 0.3

    total = sum(scores.values())
    if total:
        for k in scores:
            scores[k] /= total

    # recommendations (installer-facing)
    recs: List[str] = []
    notes: List[str] = []

    if ft.hard_fail > 0:
        recs += [
            "Mechanical (priority): Inspect for physical obstruction (debris, stones, ice), leaf binding, or fouling at end-stops.",
            "Mechanical: Check hinges/rollers/bearings and gate geometry (sag, dropped leaf, tight spots across travel).",
            "Mechanical: Verify mechanical stops and latch alignment (a mis-set stop can mimic obstruction).",
            "Mechanical: Check operator manual release isn’t partially engaged and leaf moves freely by hand.",
        ]
        notes.append("Hard failures detected: reed did not confirm closed on some close attempts.")

    if ft.latch_miss > 0:
        recs += [
            "Latch-zone: Check magnet + reed alignment (mounting, gap, magnet strength).",
            "Latch-zone: Check latch/keep alignment and final closing force margin.",
            "Latch-zone: Check for bounce-back from ground stop or latch impact (can prevent reed confirmation).",
        ]

    if ft.intermittent_soft:
        recs += [
            "Environment: High humidity correlates with slow closes. Inspect lubrication, swelling timber/composite, and water ingress points.",
            "Environment: Check force/torque margin (marginal setups fail under wet/temperature changes).",
            "Environment: Check seals/drainage around track and operator enclosure; water + grit increases resistance.",
        ]
        notes.append("Soft intermittent detected: slow closes correlate with high humidity (nearest SNAPSHOT correlation).")

    if ft.drift > 0:
        recs += [
            "Post-close drift: Gate reaches closed then re-opens/rolls back — check latch holding, wind load, and closing force.",
            "Post-close drift: Inspect back-driving/rollback on operator and mechanical play in linkages.",
        ]
        notes.append("Drift detected: reed confirmed closed initially, but did not remain closed.")

    if not recs:
        recs.append("No clear fault pattern detected from this log. Capture more events or add INTENT signals (LAM/safety) via WillexOS controller for higher certainty.")

    # Episodes: group consecutive timeline events of certain classes
    episodes: List[Dict[str, Any]] = []

    def add_episode(kind: str, start_idx: int, end_idx: int):
        seg = timeline[start_idx:end_idx+1]
        t0 = seg[0].get("ts")
        t1 = seg[-1].get("ts")
        count = len(seg)
        episodes.append({
            "kind": kind,
            "start_ts": t0,
            "end_ts": t1,
            "count": count,
        })

    # Build episodes
    i = 0
    while i < len(timeline):
        o = timeline[i]["outcome"]
        slow_wet = bool(timeline[i]["slow"] and timeline[i]["wet"])

        if o == "HARD_FAIL":
            j = i
            while j+1 < len(timeline) and timeline[j+1]["outcome"] == "HARD_FAIL":
                j += 1
            add_episode("MECHANICAL_HARD_FAIL_WINDOW", i, j)
            i = j + 1
            continue

        if slow_wet:
            j = i
            while j+1 < len(timeline) and (timeline[j+1]["slow"] and timeline[j+1]["wet"]):
                j += 1
            add_episode("HUMIDITY_DRAG_WINDOW", i, j)
            i = j + 1
            continue

        if timeline[i]["drift"]:
            j = i
            while j+1 < len(timeline) and timeline[j+1]["drift"]:
                j += 1
            add_episode("POST_CLOSE_DRIFT_WINDOW", i, j)
            i = j + 1
            continue

        i += 1

    # Confidence grading
    reasons: List[str] = []
    score = 0.0

    closes_n = len(timeline)
    if closes_n >= 10:
        score += 0.20
        reasons.append(f"Good sample size: {closes_n} close events.")
    elif closes_n >= 5:
        score += 0.12
        reasons.append(f"Moderate sample size: {closes_n} close events.")
    else:
        score += 0.05
        reasons.append(f"Small sample size: {closes_n} close events.")

    if bl.learned:
        score += 0.15
        reasons.append("Baselines learned (travel geometry available).")
    else:
        reasons.append("Baselines not learned (reduced travel inference).")

    reed_known = sum(1 for t in timeline if t["reed_end"] in (0, 1))
    if closes_n:
        reed_cov = reed_known / closes_n
        if reed_cov >= 0.9:
            score += 0.15
            reasons.append("Reed coverage high (physical truth available on most events).")
        elif reed_cov >= 0.6:
            score += 0.08
            reasons.append("Reed coverage moderate.")
        else:
            reasons.append("Reed coverage low (reduced certainty).")

    # Dominance of top cause
    top = max(scores.values()) if scores else 0.0
    if top >= 0.8:
        score += 0.25
        reasons.append("Strongly dominant root cause signal.")
    elif top >= 0.6:
        score += 0.18
        reasons.append("Clear primary root cause signal.")
    else:
        score += 0.08
        reasons.append("Mixed/weak root cause separation.")

    # Event evidence adds confidence
    if ft.hard_fail > 0 or ft.latch_miss > 0:
        score += 0.10
        reasons.append("Failure evidence present (hard_fail/latch_miss).")
    if ft.intermittent_soft:
        score += 0.08
        reasons.append("Environment correlation evidence present (slow+wet window).")
    if ft.drift > 0:
        score += 0.05
        reasons.append("Post-close drift evidence present.")

    # clamp 0..1
    score = max(0.0, min(1.0, score))
    conf = Confidence(score=score, level=_confidence_level(score), reasons=reasons)

    dx = Diagnosis(
        scores=scores,
        recommendations=recs,
        notes=notes,
        confidence=conf,
        timeline_events=timeline,
        episodes=episodes,
    )
    return bl, ft, dx

# -------------------------------------------------
# Reporting
# -------------------------------------------------

def render_timeline_text(dx: Diagnosis) -> str:
    lines = []
    lines.append("Timeline (close attempts)")
    lines.append("-" * 72)
    for t in dx.timeline_events:
        ts_s = t["ts"] or "?"
        out = t["outcome"]
        dur = t["duration_ms"]
        slow = "SLOW" if t["slow"] else "    "
        wet = "WET" if t["wet"] else "   "
        hum = t["hum_near"]
        hum_s = f"{hum:.1f}" if hum is not None else "n/a"
        lines.append(f"{ts_s} | {out:14} | {dur:>6} ms | {slow} {wet} | hum~{hum_s}")
    lines.append("")
    lines.append("Episodes")
    lines.append("-" * 72)
    if not dx.episodes:
        lines.append("None")
    else:
        for e in dx.episodes:
            lines.append(f"{e['kind']}: {e['start_ts']} → {e['end_ts']}  (events={e['count']})")
    return "\n".join(lines)

def render_report(parsed: ParsedLog, bl: Baselines, ft: Features, dx: Diagnosis) -> str:
    h = parsed.header
    conf = dx.confidence
    return f"""Bellatron v{VERSION} (WillexOS)
============================================================
Device: {h.get('device_id','?')}  FW: {h.get('fw','?')}  Schema: {h.get('log_schema','?')}

Confidence:
  level={conf.level}
  score={conf.score:.2f}

Baselines:
  closed={bl.closed}
  open={bl.open}
  max_travel={bl.max_travel}
  learned={bl.learned}

Close outcomes:
  good={ft.good}
  marginal={ft.marginal}
  latch_miss={ft.latch_miss}
  hard_fail={ft.hard_fail}
  drift_after_close={ft.drift}

Environment:
  median_humidity_global={ft.median_humidity}
  slow_ratio={ft.slow_ratio:.2f}
  slow_close_humidity_median={ft.slow_close_humidity_median}
  slow_close_samples={ft.slow_close_samples}

Intermittent:
  hard={ft.intermittent_hard}
  soft={ft.intermittent_soft}

Likely causes (normalized):
  environment_related_resistance={dx.scores['environment_related_resistance']:.2f}
  mechanical_drag_or_obstruction={dx.scores['mechanical_drag_or_obstruction']:.2f}
  bounce_back_or_force_issue={dx.scores['bounce_back_or_force_issue']:.2f}

Installer recommendations:
{chr(10).join([f"  - {r}" for r in dx.recommendations])}

Notes:
{chr(10).join([f"  - {n}" for n in dx.notes]) if dx.notes else "  - None"}

Confidence reasons:
{chr(10).join([f"  - {r}" for r in conf.reasons])}

{render_timeline_text(dx)}

Limitations:
  Standalone log analysis cannot confirm INTENT (command accepted) or safety inhibits.
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logfile", type=pathlib.Path)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    parsed = parse_log(args.logfile.read_text(encoding="utf-8", errors="replace"))
    bl, ft, dx = analyze(parsed)

    if args.json:
        print(json.dumps({
            "version": VERSION,
            "header": parsed.header,
            "baselines": asdict(bl),
            "features": asdict(ft),
            "diagnosis": {
                "scores": dx.scores,
                "recommendations": dx.recommendations,
                "notes": dx.notes,
                "confidence": asdict(dx.confidence),
                "timeline_events": dx.timeline_events,
                "episodes": dx.episodes,
            },
        }, indent=2))
    else:
        print(render_report(parsed, bl, ft, dx))

if __name__ == "__main__":
    main()
