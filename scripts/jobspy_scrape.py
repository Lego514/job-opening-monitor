#!/usr/bin/env python3
"""Scrape the job-board long tail (Indeed / ZipRecruiter) via python-jobspy.

Why this exists
---------------
The monitor polls ~114 employer ATS boards directly, which is precise but blind
to the long tail: the small and mid-size employers — especially Delaware-local
ones — that never run their own Workday/Greenhouse board and only ever post to
Indeed or ZipRecruiter. This script is the only part of the pipeline that goes
through an aggregator, and it is deliberately kept OUTSIDE the Node run: it is
ToS-gray, fragile, and blockable, so it writes a JSON file and the Node adapter
(src/adapters/jobspy.ts) treats that file as optional. No file, no rows, no
failure.

Design constraints, all of them consequences of "this source may break":
  * a fixed, small query matrix (terms x locations), not an open-ended crawl;
  * every query is wrapped in try/except and attributed to ONE board, so a
    blocked Indeed never costs us ZipRecruiter's rows;
  * a global wall-clock budget (JOBSPY_BUDGET_SEC, default 150s) — queries left
    over when the budget runs out are skipped, not waited on, because the whole
    monitor run has a 15-minute cron to fit inside;
  * LinkedIn is OFF by default. It rate-limits hard without residential proxies
    (429 within a few queries), so it is opt-in via JOBSPY_SITES.

Output: one JSON file at $JOBSPY_OUT (default: a temp file, whose path is
printed) with rows shaped for src/adapters/jobspy.ts. Nothing is written into
the repo.

Usage:
    pip install -r scripts/jobspy-requirements.txt
    JOBSPY_OUT=/tmp/jobspy.json python scripts/jobspy_scrape.py

Env:
    JOBSPY_OUT          output path (default: temp file)
    JOBSPY_SITES        comma list (default: "indeed,zip_recruiter")
    JOBSPY_HOURS_OLD    recency window in hours (default: 72)
    JOBSPY_RESULTS      results wanted per query (default: 50)
    JOBSPY_BUDGET_SEC   wall-clock budget for the whole matrix (default: 150)
    JOBSPY_WORKERS      concurrent queries (default: 6)
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qsl, urlsplit, urlunsplit

# Search terms and locations are FIXED on purpose. This source is a supplement to
# the ATS adapters, not a replacement: a wider matrix costs runtime and raises the
# odds of being blocked, and the LLM stage downstream is what actually decides fit.
SEARCH_TERMS = [
    "data analyst",
    "business analyst",
    "data engineer",
    "software engineer",
    "analytics",
]

# (location, is_remote). Delaware first (top-choice), then the two commutable
# metros, then a nationwide remote sweep.
LOCATIONS: list[tuple[str, bool]] = [
    ("Wilmington, DE", False),
    ("Newark, DE", False),
    ("Philadelphia, PA", False),
    ("New York, NY", False),
    ("United States", True),
]


def _env_int(name: str, default: int) -> int:
    try:
        n = int(os.environ.get(name) or "")
        return n if n > 0 else default
    except ValueError:
        return default


# NB: every read here is `or default`, never `get(name, default)`. An unset repo
# Variable in GitHub Actions arrives as an env var set to the EMPTY STRING, not as
# an absent one — which silently configured zero boards on the first CI run
# ("[jobspy] 0 queries: 0 board(s)"). Empty means unset here.
SITES = [s.strip() for s in (os.environ.get("JOBSPY_SITES") or "indeed,zip_recruiter").split(",") if s.strip()]
HOURS_OLD = _env_int("JOBSPY_HOURS_OLD", 72)
RESULTS_WANTED = _env_int("JOBSPY_RESULTS", 50)
BUDGET_SEC = _env_int("JOBSPY_BUDGET_SEC", 150)
WORKERS = _env_int("JOBSPY_WORKERS", 6)

# Query params that IDENTIFY a posting rather than track it. Indeed's job URL is
# `indeed.com/viewjob?jk=<id>` — strip the query the way the Node urlkey does for
# ATS links and every Indeed row in the file collapses into one. Mirrors the
# allow-list in src/urlkey.ts; keep the two in sync.
ID_PARAMS = {"jk", "currentjobid"}


def normalized_url(url: str) -> str:
    """host + path + identifying query params, lowercased. "" when unusable.

    Same shape as normalizedUrlKey() in src/urlkey.ts, so a row deduped here and
    a row deduped there agree.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        u = urlsplit(raw)
    except ValueError:
        return ""
    if u.scheme not in ("http", "https") or not u.netloc:
        return ""
    host = u.netloc.lower().split("@")[-1]
    if host.startswith("www."):
        host = host[4:]
    path = u.path.rstrip("/").lower()
    keep = sorted(
        (k.lower(), v) for k, v in parse_qsl(u.query, keep_blank_values=False) if k.lower() in ID_PARAMS
    )
    query = "&".join(f"{k}={v}" for k, v in keep)
    return urlunsplit(("", "", f"{host}{path}", query, "")).lstrip("/") or f"{host}{path}"


def _clean(v) -> str:
    """pandas cell -> trimmed string ("" for NaN/None)."""
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    s = str(v).strip()
    return "" if s.lower() in ("nan", "none", "nat") else s


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _bool(v):
    if isinstance(v, bool):
        return v
    s = _clean(v).lower()
    if s in ("true", "1", "yes"):
        return True
    if s in ("false", "0", "no"):
        return False
    return None


def _location(row) -> str:
    """jobspy gives a `location` column; fall back to its parts if it's blank."""
    loc = _clean(row.get("location"))
    if loc:
        return loc
    parts = [_clean(row.get(k)) for k in ("city", "state", "country")]
    return ", ".join(p for p in parts if p)


def to_rows(df, site: str) -> list[dict]:
    """DataFrame -> the normalized row shape src/adapters/jobspy.ts reads."""
    out = []
    if df is None or len(df) == 0:
        return out
    for rec in df.to_dict(orient="records"):
        url = _clean(rec.get("job_url"))
        if not url:
            continue
        out.append(
            {
                "site": _clean(rec.get("site")) or site,
                "id": _clean(rec.get("id")),
                "company": _clean(rec.get("company")),
                "title": _clean(rec.get("title")),
                "location": _location(rec),
                "url": url,
                # The employer's own application URL when the board exposes it —
                # better than an Indeed redirect for both the human and dedup.
                "url_direct": _clean(rec.get("job_url_direct")) or None,
                "date_posted": _clean(rec.get("date_posted"))[:10],
                "description": _clean(rec.get("description")),
                "is_remote": _bool(rec.get("is_remote")),
                "salary_min": _num(rec.get("min_amount")),
                "salary_max": _num(rec.get("max_amount")),
                "salary_interval": _clean(rec.get("interval")) or None,
            }
        )
    return out


def main() -> int:
    try:
        from jobspy import scrape_jobs
    except ImportError as e:  # pragma: no cover - environment problem, not a bug
        print(f"[jobspy] python-jobspy not installed ({e}); writing no file.", file=sys.stderr)
        return 1

    out_path = os.environ.get("JOBSPY_OUT") or os.path.join(
        tempfile.gettempdir(), "jobspy-jobs.json"
    )
    started = time.monotonic()
    deadline = started + BUDGET_SEC

    tasks = [
        (site, term, loc, remote)
        for site in SITES
        for term in SEARCH_TERMS
        for loc, remote in LOCATIONS
    ]
    print(
        f"[jobspy] {len(tasks)} queries: {len(SITES)} board(s) x {len(SEARCH_TERMS)} terms "
        f"x {len(LOCATIONS)} locations, {HOURS_OLD}h old, {RESULTS_WANTED}/query, "
        f"budget {BUDGET_SEC}s.",
        flush=True,
    )

    rows: list[dict] = []
    stats: dict[str, dict] = {s: {"rows": 0, "ok": 0, "failed": 0, "skipped": 0} for s in SITES}
    errors: dict[str, str] = {}

    def run_one(task):
        site, term, loc, remote = task
        if time.monotonic() > deadline:
            return site, None, "skipped (budget)"
        try:
            df = scrape_jobs(
                site_name=[site],
                search_term=term,
                location=loc,
                is_remote=remote,
                results_wanted=RESULTS_WANTED,
                hours_old=HOURS_OLD,
                country_indeed="USA",
                description_format="markdown",
                verbose=0,
            )
            return site, to_rows(df, site), None
        except Exception as e:  # one blocked board must never fail the run
            return site, None, f"{type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(run_one, t): t for t in tasks}
        for fut in as_completed(futures):
            site, got, err = fut.result()
            if err and err.startswith("skipped"):
                stats[site]["skipped"] += 1
                continue
            if err:
                stats[site]["failed"] += 1
                errors.setdefault(site, err)
                continue
            stats[site]["ok"] += 1
            stats[site]["rows"] += len(got or [])
            rows.extend(got or [])

    # Dedup within the file: the query matrix overlaps heavily (a Wilmington
    # "data analyst" and a Philadelphia "analytics" return many of the same reqs)
    # and jobspy does no deduping of its own. Keyed on the normalized URL, with
    # site:id as the fallback for a row whose URL won't parse.
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in rows:
        key = normalized_url(r["url_direct"] or r["url"]) or f'{r["site"]}:{r["id"]}'
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    # Rows with no employer name are useless downstream (the whole point is the
    # employer: sponsor lookup, tracker row, dedup). Drop them here, not in TS.
    named = [r for r in deduped if r["company"]]

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(named, f, ensure_ascii=False)

    for site in SITES:
        s = stats[site]
        note = f" — error: {errors[site][:120]}" if site in errors else ""
        # jobspy swallows a board's 403/429 and returns an empty frame rather than
        # raising, so "every query 'succeeded' and returned nothing" is the real
        # signature of being blocked. Say so, or the summary reads as "no jobs today".
        if not note and s["rows"] == 0 and s["ok"] > 0:
            note = " — 0 rows from every query: this board is almost certainly blocking us (see its 403/429 logs above)"
        print(
            f"[jobspy] {site}: {s['rows']} rows from {s['ok']}/{s['ok'] + s['failed'] + s['skipped']} "
            f"queries ({s['failed']} failed, {s['skipped']} skipped){note}",
            flush=True,
        )
    print(
        f"[jobspy] {len(named)} unique rows with a company (of {len(rows)} raw) "
        f"-> {out_path} in {time.monotonic() - started:.1f}s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
