#!/usr/bin/env python3
"""
validate.py — CI validator for SAT-Graph case-study datasets.

Checks (ERRORS fail the run; WARNINGS are reported, and fail only with --strict):

  E1. Referential integrity: every sourceVersionIds / producesVersionIds /
      terminatesVersionIds / producedByActionId / terminatedByActionId /
      itemId / textUnit.sourceId resolves to an existing entity.
  E2. Bidirectional coherence: version.producedByActionId <-> action.producesVersionIds
      and version.terminatedByActionId <-> action.terminatesVersionIds.
  E3. Interval well-formedness: start < end for every closed validityInterval.
  E4. Half-open boundary invariant: at every transition instant of a lineage,
      the terminated version and its successor do not overlap under [start, end).
  E5. sampleQueries execution: getValidVersions / getItemHistory are executed with
      a strict [start, end) resolver and compared against expectedResult.
      Date-only query arguments are interpreted as T00:00:00Z.

  W1. TextUnits with aspect "canonical" whose content looks like a placeholder
      ("[Full text of ...]").
  W2. Curated/extracted or translated TextUnits without a textUnitNature marker
      (heuristic: aspect in ratio/holding/facts and language != source language).

Usage:  python3 validate.py <data_dir> [--strict]
Exit code: 0 on success, 1 if any ERROR (or WARNING with --strict).
"""

import ast
import glob
import json
import os
import re
import sys
from datetime import datetime

# Avoid noisy BrokenPipeError when output is piped to head/less in a shell.
try:
    import signal
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (ImportError, AttributeError, ValueError):
    pass


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def at_instant(s: str) -> datetime:
    return ts(s if "T" in s else s + "T00:00:00Z")


def get_valid_versions(item_id, at_str, ds):
    """Strict [start, end) temporal resolution."""
    at = at_instant(at_str)
    out = []
    for v in ds["versions"]:
        if v["itemId"] != item_id:
            continue
        start = ts(v["validityInterval"][0])
        end = v["validityInterval"][1]
        if at >= start and (end is None or at < ts(end)):
            out.append(v["id"])
    return out


def get_item_history(item_id, ds):
    vids = {v["id"] for v in ds["versions"] if v["itemId"] == item_id}
    acts = [
        a for a in ds["actions"]
        if set(a.get("producesVersionIds") or []) & vids
        or set(a.get("terminatesVersionIds") or []) & vids
    ]
    return [a["id"] for a in sorted(acts, key=lambda a: a["eventTime"])]


def validate_file(path, errors, warnings):
    name = os.path.basename(path)
    ds = json.load(open(path, encoding="utf-8"))
    items = {i["id"] for i in ds.get("items", [])}
    vers = {v["id"]: v for v in ds.get("versions", [])}
    acts = {a["id"]: a for a in ds.get("actions", [])}

    def err(msg):
        errors.append(f"{name}: {msg}")

    def warn(msg):
        warnings.append(f"{name}: {msg}")

    # E1 — referential integrity
    for v in vers.values():
        if v["itemId"] not in items:
            err(f"version {v['id']} -> itemId inexistente")
        for fld in ("producedByActionId", "terminatedByActionId"):
            if v.get(fld) and v[fld] not in acts:
                err(f"version {v['id']} -> {fld} inexistente")
    for a in acts.values():
        for fld in ("sourceVersionIds", "producesVersionIds", "terminatesVersionIds"):
            for vid in a.get(fld) or []:
                if vid not in vers:
                    err(f"action {a['id']} -> {fld} contém id inexistente: {vid}")
    for t in ds.get("textUnits", []):
        sid = t.get("sourceId")
        if sid and sid not in vers and sid not in items and sid not in acts:
            err(f"textUnit {t.get('id', '?')} -> sourceId inexistente: {sid}")

    # E2 — bidirectional coherence
    for v in vers.values():
        for fld, inv in (("producedByActionId", "producesVersionIds"),
                         ("terminatedByActionId", "terminatesVersionIds")):
            aid = v.get(fld)
            if aid and v["id"] not in (acts.get(aid, {}).get(inv) or []):
                err(f"{fld} de {v['id']} sem inverso em {inv} da action")
    for a in acts.values():
        for fld, inv in (("producesVersionIds", "producedByActionId"),
                         ("terminatesVersionIds", "terminatedByActionId")):
            for vid in a.get(fld) or []:
                if vers.get(vid, {}).get(inv) != a["id"]:
                    err(f"{fld} de {a['id']} sem inverso em {inv} da version {vid}")

    # E3 — interval well-formedness
    for v in vers.values():
        s, e = v["validityInterval"]
        if e is not None and not ts(s) < ts(e):
            err(f"intervalo inválido (start >= end) em {v['id']}")

    # E4 — half-open boundary invariant per lineage transition
    for a in acts.values():
        for tid in a.get("terminatesVersionIds") or []:
            for pid in a.get("producesVersionIds") or []:
                t, p = vers.get(tid), vers.get(pid)
                if not t or not p or t["itemId"] != p["itemId"]:
                    continue
                end, start = t["validityInterval"][1], p["validityInterval"][0]
                if end is None or ts(end) != ts(start):
                    err(f"transição não contígua em {a['id']}: fim de {tid} != início de {pid}")

    # E5 — sampleQueries as executable tests
    for q in ds.get("sampleQueries", []):
        m = re.match(r"(getValidVersions|getItemHistory)\('([^']+)'(?:,\s*'([^']+)')?\)",
                     q.get("query", ""))
        if not m:
            warn(f"sampleQuery não parseável: {q.get('query', '')[:60]}")
            continue
        fn, item, at = m.groups()
        got = get_valid_versions(item, at, ds) if fn == "getValidVersions" \
            else get_item_history(item, ds)
        exp = q.get("expectedResult")
        if isinstance(exp, str):
            exp = ast.literal_eval(exp)
        exp = exp or []
        # getItemHistory has a defined ordering (eventTime, id); getValidVersions
        # is a set — result order is not part of the contract.
        same = (got == exp) if fn == "getItemHistory" else (sorted(got) == sorted(exp))
        if not same:
            err(f"sampleQuery divergente: {q['query'][:70]}\n"
                f"      esperado: {exp}\n      obtido  : {got}")

    # W1 — canonical placeholders
    for t in ds.get("textUnits", []):
        if t.get("aspect") == "canonical" and t.get("content", "").lstrip().startswith("[Full text"):
            warn(f"TextUnit 'canonical' é placeholder: {t.get('content', '')[:60]}...")

    # W2 — extractions/translations without textUnitNature
    for t in ds.get("textUnits", []):
        if t.get("aspect") in ("ratio", "holding", "facts") and \
                not (t.get("metadata") or {}).get("textUnitNature"):
            warn(f"TextUnit {t.get('aspect')} sem textUnitNature "
                 f"(tradução? extração?): {t.get('content', '')[:50]}...")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    data_dir = args[0] if args else "data"
    files = sorted(glob.glob(os.path.join(data_dir, "*.json")))
    if not files:
        print(f"nenhum .json em {data_dir}")
        sys.exit(1)

    errors, warnings = [], []
    for f in files:
        validate_file(f, errors, warnings)

    print(f"Arquivos validados: {len(files)}")
    for e in errors:
        print("  ERRO :", e)
    for w in warnings:
        print("  AVISO:", w)
    print(f"Resultado: {len(errors)} erro(s), {len(warnings)} aviso(s)")
    sys.exit(1 if errors or (strict and warnings) else 0)


if __name__ == "__main__":
    main()
