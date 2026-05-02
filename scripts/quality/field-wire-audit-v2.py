#!/usr/bin/env python3
"""
field-wire-audit-v2.py — v2 of field audit, adds frontend mutation body scan.

Pipeline:
  1. Frontend mutations: extract keys from `body: JSON.stringify({ X, Y, Z })`
  2. API routes: extract `body.X` / destructured `{X}` reads
  3. Cross-ref the two:
       SENT_NOT_READ — frontend sends X, server route at same URL doesn't read it
       READ_NOT_SENT — server reads X, no frontend mutation sends it (suspect dead)

Excludes false-positives (reserved words, generic noise, framework keys).
Excludes V1 [locale]/workspace/ tree.

Output: scripts/quality/scan-<DATE>/field-wire-audit-v2.{md,json}
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "src"
EXCLUDE_DIRS = {"node_modules", ".next", "dist", "build", ".turbo", "coverage"}
EXCLUDE_PATH_PARTS = {"workspace"}  # V1
OUT_DIR = ROOT / "scripts" / "quality" / f"scan-{date.today():%Y-%m-%d}"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Reserved / generic / framework keys that flood the report.
NOISE = {
    # JS/TS reserved
    "true", "false", "null", "undefined", "void", "const", "let", "var",
    # Generic React/HTML
    "id", "name", "value", "type", "key", "data", "ref", "src", "alt",
    "title", "label", "role", "tag", "field", "items", "list",
    # Common method noise from regex
    "json", "text", "arrayBuffer", "formData", "blob",
    # Single-letter / loop vars
    "i", "j", "k", "l", "m", "n", "x", "y", "z",
    # Catch-all keywords
    "V2", "V1", "all", "any",
}


def iter_files(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    if not root.exists():
        return out
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if set(path.parts) & EXCLUDE_DIRS:
            continue
        out.append(path)
    return out


# ─── 1. Frontend mutation body keys ───────────────────────────────────────
# Match: body: JSON.stringify({ key1, key2: value, [computedKey]: ... })
# Keep simple: capture keys inside one balanced { } after JSON.stringify(
BODY_STRINGIFY_RE = re.compile(
    r"body\s*:\s*JSON\.stringify\s*\(\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}",
    re.MULTILINE | re.DOTALL,
)
KEY_RE = re.compile(r"(?:^|,)\s*(?:\.\.\.[A-Za-z_]\w*|\[[^\]]+\]|([A-Za-z_]\w*))(?:\s*:|\s*[,}])")


def scan_frontend_body_keys() -> dict[str, list[str]]:
    """Return {keyName: [files sending it]}"""
    keys: dict[str, set[str]] = defaultdict(set)
    for path in iter_files(SRC, (".ts", ".tsx")):
        if any(part in EXCLUDE_PATH_PARTS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = str(path.relative_to(ROOT))
        for body_match in BODY_STRINGIFY_RE.finditer(text):
            inner = body_match.group(1)
            for key_match in KEY_RE.finditer(inner):
                if not key_match.group(1):  # spread or computed
                    continue
                name = key_match.group(1)
                if name in NOISE:
                    continue
                keys[name].add(rel)
    return {k: sorted(v) for k, v in keys.items()}


# ─── 2. API route reads ───────────────────────────────────────────────────
# Catches: body.X / body?.X / payload.X / payload?.X — covers the common
# `const payload = await request.json()` aliasing pattern.
API_BODY_DOT_RE = re.compile(r"\b(?:body|payload)\??\.([A-Za-z_]\w*)")
API_BODY_DESTRUCT_RE = re.compile(
    r"const\s*\{\s*([^}]+?)\s*\}\s*=\s*(?:body|payload|await\s+(?:request|req)\.json\(\))",
    re.MULTILINE,
)


def scan_api_reads() -> dict[str, list[str]]:
    params: dict[str, set[str]] = defaultdict(set)
    api_dir = SRC / "app" / "api"
    if not api_dir.exists():
        return {}
    for path in iter_files(api_dir, (".ts", ".tsx")):
        if path.name not in ("route.ts", "route.tsx"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = str(path.relative_to(ROOT))
        for match in API_BODY_DOT_RE.finditer(text):
            name = match.group(1)
            if name in NOISE:
                continue
            params[name].add(rel)
        for match in API_BODY_DESTRUCT_RE.finditer(text):
            for name in re.findall(r"\b([A-Za-z_]\w*)\b(?:\s*:\s*[A-Za-z_]\w*)?", match.group(1)):
                if name in NOISE:
                    continue
                params[name].add(rel)
    return {k: sorted(v) for k, v in params.items()}


def main():
    print("Scanning frontend mutation body keys...", file=sys.stderr)
    sent = scan_frontend_body_keys()
    print(f"  found {len(sent)} unique keys sent from frontend", file=sys.stderr)

    print("Scanning API route reads...", file=sys.stderr)
    read = scan_api_reads()
    print(f"  found {len(read)} unique keys read by API routes", file=sys.stderr)

    sent_set = set(sent.keys())
    read_set = set(read.keys())
    sent_not_read = sorted(sent_set - read_set)
    read_not_sent = sorted(read_set - sent_set)
    matched = sent_set & read_set

    summary = {
        "scan_date": str(date.today()),
        "counts": {
            "frontend_keys_sent": len(sent),
            "api_keys_read": len(read),
            "matched": len(matched),
            "sent_not_read": len(sent_not_read),
            "read_not_sent": len(read_not_sent),
        },
        "sent_not_read": [{"key": k, "files": sent[k]} for k in sent_not_read],
        "read_not_sent": [{"key": k, "routes": read[k]} for k in read_not_sent],
    }

    json_path = OUT_DIR / "field-wire-audit-v2.json"
    json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"Wrote {json_path.relative_to(ROOT)}", file=sys.stderr)

    md_path = OUT_DIR / "field-wire-audit-v2.md"
    with md_path.open("w") as f:
        f.write(f"# Field-wire audit v2 — {summary['scan_date']}\n\n")
        f.write("Cross-references frontend mutation body keys ↔ API route reads.\n")
        f.write("Excludes V1 `[locale]/workspace/` tree, generic noise, JS reserved words.\n\n")
        f.write("## Counts\n\n")
        f.write("| Metric | Count |\n| --- | ---: |\n")
        for k, v in summary["counts"].items():
            f.write(f"| {k} | {v} |\n")

        f.write("\n## SENT_NOT_READ — frontend sends but no API reads\n\n")
        f.write(f"{len(sent_not_read)} keys appear in `body: JSON.stringify({{...}})` ")
        f.write("but no API route reads `body.X`.\n\n")
        f.write("**This is the highest-signal bucket.** A real positive here means:\n")
        f.write("- Field name typo on the server side (BUG)\n")
        f.write("- Field accidentally renamed mid-refactor (BUG)\n")
        f.write("- Server expected the field but the read line was deleted (BUG)\n\n")
        f.write("False-positive sources to ignore manually:\n")
        f.write("- Server destructures with rename: `const { sent: dbCol } = body` (escapes v2 scan)\n")
        f.write("- Server passes whole `body` object downstream without `.X` access\n")
        f.write("- Field consumed by middleware before reaching route handler\n\n")
        for entry in sent_not_read[:300]:
            files = sent[entry][:2]
            f.write(f"- `{entry}` — sent from: {', '.join(files)}{'...' if len(sent[entry]) > 2 else ''}\n")
        if len(sent_not_read) > 300:
            f.write(f"\n_(showing 300 of {len(sent_not_read)}; full list in JSON)_\n")

        f.write("\n## READ_NOT_SENT — API reads but no frontend sends\n\n")
        f.write(f"{len(read_not_sent)} keys read from `body.X` in some route but no frontend mutation\n")
        f.write("scanned sends them.\n\n")
        f.write("Likely causes (decreasing severity):\n")
        f.write("- Server reads it, sender is in `useStoryboards.ts` or other hook not via `body: JSON.stringify` pattern (regex miss)\n")
        f.write("- Sender uses `requestJsonWithError` / `requestTaskResponseWithError` helper that wraps body inside (regex miss)\n")
        f.write("- Genuinely dead API param — handler reads it but no caller (CLEANUP)\n")
        f.write("- Param read only when triggered from worker / cron / external system (BY DESIGN)\n\n")
        for entry in read_not_sent[:300]:
            routes = read[entry][:2]
            f.write(f"- `{entry}` — routes: {', '.join(routes)}{'...' if len(read[entry]) > 2 else ''}\n")
        if len(read_not_sent) > 300:
            f.write(f"\n_(showing 300 of {len(read_not_sent)}; full list in JSON)_\n")

    print(f"Wrote {md_path.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
