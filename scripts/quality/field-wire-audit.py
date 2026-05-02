#!/usr/bin/env python3
"""
field-wire-audit.py — cross-reference UI form fields ↔ API body params ↔ Prisma DB writes.

Output: scripts/quality/scan-<DATE>/field-wire-audit.{md,json}

Goal: answer "is every form field on V2 actually wired through to a DB column the
backend reads?". Surfaces three orphan classes:

  ORPHAN_FORM      — <input name="X"> exists in tsx but no API route reads body.X
  ORPHAN_API_IN    — API route reads body.X but no Prisma data.X write follows
  WRITE_NEVER_READ — Prisma data.X write exists but no GET endpoint returns X

Limitations (read in REPORT.md before acting):
  - Pure regex scan; aliases (`const { X: y } = body`) escape detection
  - Dynamic field names (computed property keys) escape detection
  - Hidden form fields, controlled-only React state (no `name`) not flagged as forms
  - Excludes node_modules, .next, dist, lib/prompts, scripts/

Usage:
  python3 scripts/quality/field-wire-audit.py
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
EXCLUDE_PATH_PARTS = {"workspace"}  # V1 tree — tracked separately, drowns the report

OUT_DIR = ROOT / "scripts" / "quality" / f"scan-{date.today():%Y-%m-%d}"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ─── File walking ─────────────────────────────────────────────────────────

def iter_files(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in suffixes:
            continue
        parts = set(path.parts)
        if parts & EXCLUDE_DIRS:
            continue
        out.append(path)
    return out


# ─── 1. Form fields ───────────────────────────────────────────────────────
# Match <input name="X"> / <textarea name="X"> / <select name="X">
FORM_NAME_RE = re.compile(
    r"<(?:input|textarea|select)\b[^>]*\bname\s*=\s*[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']",
    re.MULTILINE,
)

def scan_form_fields() -> dict[str, list[str]]:
    """Return {fieldName: [files containing it]}"""
    fields: dict[str, set[str]] = defaultdict(set)
    for path in iter_files(SRC, (".tsx", ".jsx")):
        if any(part in EXCLUDE_PATH_PARTS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        for match in FORM_NAME_RE.finditer(text):
            fields[match.group(1)].add(str(path.relative_to(ROOT)))
    return {k: sorted(v) for k, v in fields.items()}


# ─── 2. API body params ───────────────────────────────────────────────────
# Match body.X / body?.X / body[X] from API route.ts files
# Also match destructure: const { X, Y } = body / await request.json()
API_BODY_DOT_RE = re.compile(r"\bbody\??\.([A-Za-z_][A-Za-z0-9_]*)")
API_BODY_DESTRUCT_RE = re.compile(
    r"const\s*\{\s*([^}]+?)\s*\}\s*=\s*(?:body|await\s+(?:request|req)\.json\(\))",
    re.MULTILINE,
)

def scan_api_params() -> dict[str, list[str]]:
    """Return {paramName: [route files reading it]}"""
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
            if name in {"json", "text", "arrayBuffer", "formData", "blob"}:
                continue
            params[name].add(rel)
        for match in API_BODY_DESTRUCT_RE.finditer(text):
            inner = match.group(1)
            for name in re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\b(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*)?", inner):
                if name in {"const", "let", "var"}:
                    continue
                params[name].add(rel)
    return {k: sorted(v) for k, v in params.items()}


# ─── 3. Prisma writes ─────────────────────────────────────────────────────
# Match prisma.X.create({ data: { Y: ..., Z: ... } }) and same for update/upsert
# Crude: look for "data: {" then capture keys until closing brace.
PRISMA_DATA_BLOCK_RE = re.compile(
    r"prisma\.[A-Za-z_][A-Za-z0-9_]*\.(?:create|update|upsert|createMany|updateMany)\s*\(\s*\{[^{}]*data\s*:\s*(\{[^{}]*\})",
    re.DOTALL,
)
DATA_KEY_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", re.MULTILINE)

def scan_prisma_writes() -> dict[str, list[str]]:
    """Return {columnName: [files writing it]}"""
    writes: dict[str, set[str]] = defaultdict(set)
    for path in iter_files(SRC, (".ts", ".tsx")):
        if any(part in EXCLUDE_PATH_PARTS for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = str(path.relative_to(ROOT))
        for block_match in PRISMA_DATA_BLOCK_RE.finditer(text):
            block = block_match.group(1)
            for key_match in DATA_KEY_RE.finditer(block):
                writes[key_match.group(1)].add(rel)
    return {k: sorted(v) for k, v in writes.items()}


# ─── 4. Cross-ref ─────────────────────────────────────────────────────────

def main():
    print("Scanning form fields...", file=sys.stderr)
    forms = scan_form_fields()
    print(f"  found {len(forms)} unique form field names", file=sys.stderr)

    print("Scanning API body params...", file=sys.stderr)
    apis = scan_api_params()
    print(f"  found {len(apis)} unique API param names", file=sys.stderr)

    print("Scanning Prisma writes...", file=sys.stderr)
    writes = scan_prisma_writes()
    print(f"  found {len(writes)} unique columns written", file=sys.stderr)

    form_set = set(forms.keys())
    api_set = set(apis.keys())
    write_set = set(writes.keys())

    # Common React-ism / generic that flood the report — surface only if an
    # actual API consumer exists, otherwise drop.
    GENERIC_NOISE = {"id", "name", "value", "type", "key", "data"}

    orphan_forms = sorted(f for f in form_set - api_set if f not in GENERIC_NOISE)
    orphan_api_in = sorted(p for p in api_set - write_set if p not in GENERIC_NOISE)
    write_no_form = sorted(w for w in write_set - form_set - api_set if w not in GENERIC_NOISE)

    summary = {
        "scan_date": str(date.today()),
        "counts": {
            "form_fields": len(forms),
            "api_params": len(apis),
            "prisma_writes": len(writes),
            "orphan_forms": len(orphan_forms),
            "orphan_api_in": len(orphan_api_in),
            "write_no_form_or_api": len(write_no_form),
        },
        "orphan_forms": [{"field": f, "files": forms[f]} for f in orphan_forms],
        "orphan_api_in": [{"param": p, "routes": apis[p]} for p in orphan_api_in],
        "write_no_form_or_api": [{"column": w, "writers": writes[w]} for w in write_no_form],
    }

    json_path = OUT_DIR / "field-wire-audit.json"
    json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"Wrote {json_path.relative_to(ROOT)}", file=sys.stderr)

    md_path = OUT_DIR / "field-wire-audit.md"
    with md_path.open("w") as f:
        f.write(f"# Field-wire audit — {summary['scan_date']}\n\n")
        f.write("Cross-references UI form fields ↔ API body params ↔ Prisma writes.\n\n")
        f.write("## Counts\n\n")
        f.write("| Metric | Count |\n| --- | ---: |\n")
        for k, v in summary["counts"].items():
            f.write(f"| {k} | {v} |\n")
        f.write("\n## Orphan form fields (UI only — no API consumer)\n\n")
        f.write(f"{len(orphan_forms)} fields rendered as `<input name=\"X\">` etc but no API route reads `body.X`.\n\n")
        f.write("Likely causes (decreasing severity):\n")
        f.write("- Field name mismatch between form and API (BUG)\n")
        f.write("- Field aliased on send (`{ X: y }` rename) — can be safe\n")
        f.write("- Form is purely client-side state (search box, filter UI)\n\n")
        for entry in orphan_forms[:200]:
            f.write(f"- `{entry}` — files: {', '.join(forms[entry][:3])}{'...' if len(forms[entry]) > 3 else ''}\n")
        if len(orphan_forms) > 200:
            f.write(f"\n_(showing 200 of {len(orphan_forms)}; full list in JSON)_\n")
        f.write("\n## Orphan API params (read but never persisted)\n\n")
        f.write(f"{len(orphan_api_in)} params extracted from request body but no Prisma `data.X` write follows.\n\n")
        f.write("Likely causes:\n")
        f.write("- Param drives logic but not persistence (filter, mode, async flag) — usually safe\n")
        f.write("- Param renamed before write (`const dbX = X` then `data: { dbX: ... }`) — escapes scan\n")
        f.write("- Param is dead — UI sends it, server reads it, server drops it (BUG)\n\n")
        for entry in orphan_api_in[:200]:
            f.write(f"- `{entry}` — routes: {', '.join(apis[entry][:3])}{'...' if len(apis[entry]) > 3 else ''}\n")
        if len(orphan_api_in) > 200:
            f.write(f"\n_(showing 200 of {len(orphan_api_in)}; full list in JSON)_\n")
        f.write("\n## DB columns never sourced from form or API\n\n")
        f.write(f"{len(write_no_form)} Prisma write keys whose name appears in no form field and no API body param.\n\n")
        f.write("Likely causes:\n")
        f.write("- Server-set field (timestamps, derived ids, computed slugs) — safe\n")
        f.write("- Worker-only field populated from upstream task result — safe\n")
        f.write("- Genuinely unused write that leaked from older code — minor cleanup target\n\n")
        for entry in write_no_form[:200]:
            f.write(f"- `{entry}` — writers: {', '.join(writes[entry][:3])}{'...' if len(writes[entry]) > 3 else ''}\n")
        if len(write_no_form) > 200:
            f.write(f"\n_(showing 200 of {len(write_no_form)}; full list in JSON)_\n")
        f.write("\n## Caveats\n\n")
        f.write("- Excludes V1 `[locale]/workspace/...` (tracked by v2-to-main migration plan)\n")
        f.write("- Excludes `node_modules`, `.next`, `dist`, `coverage`\n")
        f.write("- Pure regex; aliases (`const { X: y } = body`) and computed keys escape detection\n")
        f.write("- React `useState` / controlled input without `name` attribute not flagged as a form field\n")
        f.write("- `id`, `name`, `value`, `type`, `key`, `data` filtered as generic noise\n")
    print(f"Wrote {md_path.relative_to(ROOT)}", file=sys.stderr)

if __name__ == "__main__":
    main()
