#!/usr/bin/env python3
"""
field-wire-audit-v3.py — adds two patterns v2 missed:

  1. mutationFn payload type: `mutationFn: async (input: { X: T, Y: U }) => ...`
     Frontend often defines an inline TS type for the mutation payload then
     passes the whole object via `body: JSON.stringify(payload)`. v2 only
     looked at `body: JSON.stringify({ X, Y })` literal-object form.

  2. Inline fetch in components: `fetch(url, { body: JSON.stringify({...}) })`
     outside of `mutations/` files (e.g. signin/signup/admin pages).

Plus everything v2 already did.

Output: scripts/quality/scan-<DATE>/field-wire-audit-v3.{md,json}
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

NOISE = {
    "true", "false", "null", "undefined", "void", "const", "let", "var",
    "id", "name", "value", "type", "key", "data", "ref", "src", "alt",
    "title", "label", "role", "tag", "field", "items", "list",
    "json", "text", "arrayBuffer", "formData", "blob",
    "i", "j", "k", "l", "m", "n", "x", "y", "z",
    "V2", "V1", "all", "any", "string", "number", "boolean", "object",
    "input",  # ts-prune flagged this is an unused export, not a body key
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


# ─── 1a. Frontend body: JSON.stringify({...}) literal ─────────────────────
BODY_LITERAL_RE = re.compile(
    r"body\s*:\s*JSON\.stringify\s*\(\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}",
    re.MULTILINE | re.DOTALL,
)
KEY_IN_OBJ_RE = re.compile(r"(?:^|,)\s*(?:\.\.\.[A-Za-z_]\w*|\[[^\]]+\]|([A-Za-z_]\w*))(?:\s*:|\s*[,}])")


# ─── 1b. mutationFn payload type ──────────────────────────────────────────
# Match `mutationFn: async (NAME: { ... type body ... }) =>`
# Capture the inline type body, then extract `KEY?:` / `KEY:` keys.
MUTATIONFN_PAYLOAD_RE = re.compile(
    r"mutationFn\s*:\s*async\s*\(\s*[A-Za-z_]\w*\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\)\s*=>",
    re.MULTILINE | re.DOTALL,
)
# Inside the captured type body: `KEY?:` or `KEY:` (TS object type syntax)
TYPE_KEY_RE = re.compile(r"\b([A-Za-z_]\w*)\s*\??\s*:")


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

        # 1a: literal object stringify
        for m in BODY_LITERAL_RE.finditer(text):
            for km in KEY_IN_OBJ_RE.finditer(m.group(1)):
                if km.group(1):
                    name = km.group(1)
                    if name not in NOISE:
                        keys[name].add(rel)

        # 1b: mutationFn payload type — only credit if the file also stringifies
        # the payload (otherwise the type is just a contract, not a real send)
        if "JSON.stringify" not in text:
            continue
        for m in MUTATIONFN_PAYLOAD_RE.finditer(text):
            type_body = m.group(1)
            for km in TYPE_KEY_RE.finditer(type_body):
                name = km.group(1)
                if name not in NOISE:
                    keys[name].add(rel)

    return {k: sorted(v) for k, v in keys.items()}


# ─── 2. API route reads ───────────────────────────────────────────────────
API_BODY_DOT_RE = re.compile(r"\b(?:body|payload)\??\.([A-Za-z_]\w*)")
API_BODY_DESTRUCT_RE = re.compile(
    r"const\s*\{\s*([^}]+?)\s*\}\s*=\s*(?:body|payload|await\s+(?:request|req)\.json\(\))",
    re.MULTILINE,
)
# (body as { X?: T }).X  /  (payload as ...).X — escape regex pattern from v2
API_BODY_CAST_RE = re.compile(r"\((?:body|payload)\s+as\s+\{[^}]*\}\)\.([A-Za-z_]\w*)")


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
            if name not in NOISE:
                params[name].add(rel)
        for match in API_BODY_DESTRUCT_RE.finditer(text):
            for name in re.findall(r"\b([A-Za-z_]\w*)\b(?:\s*:\s*[A-Za-z_]\w*)?", match.group(1)):
                if name not in NOISE:
                    params[name].add(rel)
        for match in API_BODY_CAST_RE.finditer(text):
            name = match.group(1)
            if name not in NOISE:
                params[name].add(rel)
    return {k: sorted(v) for k, v in params.items()}


def main():
    print("Scanning frontend send keys (literal + mutationFn type)...", file=sys.stderr)
    sent = scan_frontend_body_keys()
    print(f"  {len(sent)} unique keys sent from frontend", file=sys.stderr)

    print("Scanning API route reads (body + payload + cast)...", file=sys.stderr)
    read = scan_api_reads()
    print(f"  {len(read)} unique keys read by API routes", file=sys.stderr)

    sent_set = set(sent.keys())
    read_set = set(read.keys())
    sent_not_read = sorted(sent_set - read_set)
    read_not_sent = sorted(read_set - sent_set)
    matched = sent_set & read_set

    summary = {
        "scan_date": str(date.today()),
        "scan_version": "v3",
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

    json_path = OUT_DIR / "field-wire-audit-v3.json"
    json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"Wrote {json_path.relative_to(ROOT)}", file=sys.stderr)

    md_path = OUT_DIR / "field-wire-audit-v3.md"
    with md_path.open("w") as f:
        f.write(f"# Field-wire audit v3 — {summary['scan_date']}\n\n")
        f.write("v2 + (a) `mutationFn: async (p: {X,Y}) => ...; body: JSON.stringify(p)` payload-type extraction, ")
        f.write("(b) `(body as ...).X` cast-pattern reads.\n\n")
        f.write("## Counts\n\n")
        f.write("| Metric | v2 | v3 | Δ |\n| --- | ---: | ---: | ---: |\n")
        v2 = {"frontend_keys_sent": 54, "api_keys_read": 155, "matched": 45, "sent_not_read": 9, "read_not_sent": 110}
        for k, v in summary["counts"].items():
            d = v - v2.get(k, 0)
            f.write(f"| {k} | {v2.get(k, '?')} | {v} | {'+' if d > 0 else ''}{d} |\n")

        f.write("\n## SENT_NOT_READ — frontend sends but no API route reads\n\n")
        f.write(f"{len(sent_not_read)} keys.\n\n")
        for entry in sent_not_read:
            files = sent[entry][:2]
            f.write(f"- `{entry}` — sent from: {', '.join(files)}{'...' if len(sent[entry]) > 2 else ''}\n")

        f.write("\n## READ_NOT_SENT — API reads but no frontend send caught\n\n")
        f.write(f"{len(read_not_sent)} keys.\n\n")
        for entry in read_not_sent[:200]:
            routes = read[entry][:2]
            f.write(f"- `{entry}` — routes: {', '.join(routes)}{'...' if len(read[entry]) > 2 else ''}\n")
        if len(read_not_sent) > 200:
            f.write(f"\n_(showing 200 of {len(read_not_sent)}; full list in JSON)_\n")

    print(f"Wrote {md_path.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
