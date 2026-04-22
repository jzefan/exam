"""Stress test: simulate N students concurrently taking + submitting an exam.

Measures the three hot paths — login, /start, /submit — under concurrent load.
Designed for ~150–200 virtual users on a laptop; scale down `--concurrency` for
smaller runs. Uses httpx + asyncio (no extra infra).

Usage:
    # Prepare a users file: one `username,password` per line
    python scripts/stress_test_exam.py \\
        --base-url http://localhost:8000 \\
        --exam-id <uuid> \\
        --users users.csv \\
        --concurrency 200 \\
        --ramp-seconds 3

Exit code: 0 if all phases complete with <1% errors, else 1.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class PhaseStats:
    name: str
    durations_ms: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def record(self, duration_ms: float) -> None:
        self.durations_ms.append(duration_ms)

    def fail(self, reason: str) -> None:
        self.errors.append(reason)

    def summary(self) -> dict[str, Any]:
        n = len(self.durations_ms)
        if n == 0:
            return {"name": self.name, "ok": 0, "errors": len(self.errors)}
        sorted_ms = sorted(self.durations_ms)
        return {
            "name": self.name,
            "ok": n,
            "errors": len(self.errors),
            "min_ms": round(sorted_ms[0], 1),
            "p50_ms": round(statistics.median(sorted_ms), 1),
            "p95_ms": round(sorted_ms[int(n * 0.95) - 1 if n > 1 else 0], 1),
            "p99_ms": round(sorted_ms[int(n * 0.99) - 1 if n > 1 else 0], 1),
            "max_ms": round(sorted_ms[-1], 1),
            "mean_ms": round(statistics.fmean(sorted_ms), 1),
        }


@dataclass
class StressResult:
    login: PhaseStats = field(default_factory=lambda: PhaseStats("login"))
    start: PhaseStats = field(default_factory=lambda: PhaseStats("start"))
    submit: PhaseStats = field(default_factory=lambda: PhaseStats("submit"))
    wall_seconds: float = 0.0


def load_users(path: str) -> list[tuple[str, str]]:
    users: list[tuple[str, str]] = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if not row or row[0].startswith("#"):
                continue
            if len(row) < 2:
                raise ValueError(f"bad user row (need username,password): {row}")
            users.append((row[0].strip(), row[1].strip()))
    if not users:
        raise ValueError(f"no users loaded from {path}")
    return users


def synthesize_answers(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build plausible answers for each question type so submit exercises Pass 1 grading."""
    answers: list[dict[str, Any]] = []
    for q in questions:
        qtype = q.get("type")
        qid = q["question_id"]
        if qtype == "choice":
            options = q.get("options") or []
            keys = [opt.get("key") or opt.get("id") or str(i) for i, opt in enumerate(options)]
            picked = random.sample(keys, 1) if keys else []
            answers.append({"question_id": qid, "answer_content": {"selected": picked}})
        elif qtype == "true_false":
            answers.append({"question_id": qid, "answer_content": {"value": random.choice([True, False])}})
        elif qtype == "fill_in":
            answers.append({"question_id": qid, "answer_content": {"blanks": ["stress"]}})
        else:
            # subjective / code / essay — synthetic text
            answers.append(
                {
                    "question_id": qid,
                    "answer_content": {"text": f"stress-test answer for {qid}"},
                }
            )
    return answers


async def run_user(
    client: httpx.AsyncClient,
    username: str,
    password: str,
    exam_id: str,
    ramp_seconds: float,
    think_seconds: float,
    result: StressResult,
) -> None:
    # Ramp: spread /start over ramp_seconds to avoid lockstep thundering herd.
    await asyncio.sleep(random.uniform(0, ramp_seconds))

    # Phase 1: login
    t0 = time.perf_counter()
    try:
        r = await client.post("/api/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        token = r.json()["access_token"]
        result.login.record((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        result.login.fail(f"{username}: {exc!r}")
        return

    headers = {"Authorization": f"Bearer {token}"}

    # Phase 2: start exam — returns the question list
    t0 = time.perf_counter()
    try:
        r = await client.post(f"/api/student/exams/{exam_id}/start", headers=headers)
        r.raise_for_status()
        start_body = r.json()
        result.start.record((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        result.start.fail(f"{username}: {exc!r}")
        return

    questions = start_body.get("questions") or []
    answers = synthesize_answers(questions)

    # Think time: students don't submit instantly. Spreads submit over a window
    # so we stress-test submit concurrency rather than lockstep bursts.
    await asyncio.sleep(random.uniform(0, think_seconds))

    # Phase 3: submit
    t0 = time.perf_counter()
    try:
        r = await client.post(
            f"/api/student/exams/{exam_id}/submit",
            headers=headers,
            json={"answers": answers},
        )
        r.raise_for_status()
        result.submit.record((time.perf_counter() - t0) * 1000)
    except Exception as exc:
        result.submit.fail(f"{username}: {exc!r}")


def format_report(result: StressResult, total_users: int) -> str:
    lines = [
        "=" * 64,
        f"Stress test complete in {result.wall_seconds:.1f}s · {total_users} virtual users",
        "=" * 64,
    ]
    for phase in (result.login, result.start, result.submit):
        s = phase.summary()
        if "p50_ms" not in s:
            lines.append(f"[{s['name']:<6}] ok={s['ok']:<4} errors={s['errors']}  (no timings)")
            continue
        lines.append(
            f"[{s['name']:<6}] ok={s['ok']:<4} errors={s['errors']:<3} "
            f"p50={s['p50_ms']:>7.1f}ms  p95={s['p95_ms']:>7.1f}ms  "
            f"p99={s['p99_ms']:>7.1f}ms  max={s['max_ms']:>7.1f}ms"
        )
    # Show up to 5 sample errors per phase
    for phase in (result.login, result.start, result.submit):
        if phase.errors:
            lines.append(f"-- {phase.name} error samples --")
            for err in phase.errors[:5]:
                lines.append(f"  {err}")
            if len(phase.errors) > 5:
                lines.append(f"  ... {len(phase.errors) - 5} more")
    return "\n".join(lines)


async def main_async(args: argparse.Namespace) -> int:
    users = load_users(args.users)
    if args.concurrency > len(users):
        print(
            f"warn: --concurrency={args.concurrency} > available users={len(users)}; "
            f"capping to {len(users)}",
            file=sys.stderr,
        )
    picked = random.sample(users, min(args.concurrency, len(users)))

    result = StressResult()
    limits = httpx.Limits(max_connections=args.concurrency + 20, max_keepalive_connections=50)
    timeout = httpx.Timeout(args.timeout)

    t_start = time.perf_counter()
    async with httpx.AsyncClient(base_url=args.base_url, limits=limits, timeout=timeout) as client:
        # Light preflight: fail fast if the server is unreachable.
        try:
            r = await client.get("/api/health")
            r.raise_for_status()
        except Exception as exc:
            print(f"preflight failed ({args.base_url}/api/health): {exc!r}", file=sys.stderr)
            return 2

        await asyncio.gather(
            *(
                run_user(
                    client,
                    username,
                    password,
                    args.exam_id,
                    args.ramp_seconds,
                    args.think_seconds,
                    result,
                )
                for username, password in picked
            )
        )
    result.wall_seconds = time.perf_counter() - t_start

    print(format_report(result, len(picked)))

    total_attempted = len(picked) * 3
    total_errors = len(result.login.errors) + len(result.start.errors) + len(result.submit.errors)
    error_rate = total_errors / total_attempted if total_attempted else 1.0
    if error_rate >= 0.01:
        print(f"FAIL: error rate {error_rate:.2%} >= 1%", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Concurrent exam stress test")
    p.add_argument("--base-url", default="http://localhost:8000")
    p.add_argument("--exam-id", required=True, help="UUID of the exam under test")
    p.add_argument("--users", required=True, help="CSV file: username,password per line")
    p.add_argument("--concurrency", type=int, default=200)
    p.add_argument(
        "--ramp-seconds",
        type=float,
        default=3.0,
        help="Spread /start calls over this window (mirrors FE entry jitter)",
    )
    p.add_argument(
        "--think-seconds",
        type=float,
        default=5.0,
        help="Max random delay between start and submit to avoid lockstep bursts",
    )
    p.add_argument("--timeout", type=float, default=30.0)
    p.add_argument("--seed", type=int, default=None)
    return p


def main() -> int:
    args = build_parser().parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
