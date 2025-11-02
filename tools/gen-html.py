#!/usr/bin/env python3
# Read all data/*.json and write templates/<subject>.html for each subject
import json
from pathlib import Path
import sys
import re
from urllib.parse import quote
import tempfile
import os
import filecmp

DATA_DIR = Path("data")
TEMPLATES_DIR = Path("templates")

if not DATA_DIR.exists():
    print("data directory not found; run gen-wd-json.sh first", file=sys.stderr)
    raise SystemExit(1)

svg = (
    '<svg width="1em" height="1em" viewBox="0 0 24 30" fill="currentColor" '
    'style="vertical-align:middle; margin-left: -0.25em">'
    '<path class="cls-1" d="m21,12v6c0,1.6543-1.3457,3-3,3H6c-1.6543,0-3-1.3457-3-3V6c0-1.6543,1.3457-3,3-3h6c.55273,0,1,.44775,1,1s-.44727,1-1,1h-6c-.55176,0-1,.44873-1,1v12c0,.55127.44824,1,1,1h12c.55176,0,1-.44873,1-1v-6c0-.55225.44727-1,1-1s1,.44775,1,1Zm-1-9h-4c-.55273,0-1,.44775-1,1s.44727,1,1,1h1.58594l-9.29297,9.29297c-.39062.39062-.39062,1.02344,0,1.41406.19531.19531.45117.29297.70703.29297s.51172-.09766.70703-.29297l9.29297-9.29297v1.58594c0,.55225.44727,1,1,1s1-.44775,1-1v-4c0-.55225-.44727-1-1-1Z"/>'
    '</svg>'
)

def esc(s: str) -> str:
    return (s or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

def extract_leading_number(filename: str):
    if not filename:
        return 10**9
    m = re.match(r'^\s*0*([1-9]\d*|0)', filename)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return 10**9
    m2 = re.search(r'(\d+)', filename)
    if m2:
        try:
            return int(m2.group(1))
        except Exception:
            return 10**9
    return 10**9

TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

SUBJ_DISPLAY_MAP = {
    "wd": "Web Design",
    "pce": "Professional Communication and Ethics",
    "cfp": "Computational Foundation with Python",
    "mfca": "Mathematical Foundation for Computer Applications",
    "ciep": "Constitutional Law, Intellectual Property, Ethics",
    "mp": "Macro Programming",
}

for json_file in sorted(DATA_DIR.glob("*.json")):
    subj = json_file.stem
    try:
        data = json.loads(json_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Skipping {json_file}: invalid json ({e})", file=sys.stderr)
        continue

    units = data.get("units", [])
    subj_display = SUBJ_DISPLAY_MAP.get(subj, subj.replace('-', ' ').title())

    parts = []
    parts.append(f'<!-- generated from {json_file} -->')
    parts.append('<details>')
    parts.append('  <summary>')
    parts.append(f'    {esc(subj_display)}')
    parts.append(f'    <sup><a href="/sem-1/{esc(subj)}/" style="border-bottom: none;">{svg}</a></sup>')
    parts.append('  </summary>')
    parts.append('  <ul>')

    for unit in units:
        unit_id = unit.get("unit", "")
        parts.append('    <li>')
        parts.append('      <details>')
        parts.append(f'        <summary>Unit-{esc(str(unit_id))}</summary>')
        parts.append('        <ul>')
        parts.append('          <li>')
        for group in unit.get("groups", []):
            gtype = group.get("type", "")
            parts.append('            <details>')
            parts.append(f'              <summary>{esc(str(gtype))}</summary>')
            parts.append('              <ul>')
            files = group.get("files", []) or []
            files_sorted = sorted(
                files,
                key=lambda f: (extract_leading_number(f.get("filename", "")), f.get("filename", "") or "")
            )
            for file in files_sorted:
                link_text = file.get("linkText") or file.get("linkTitle") or file.get("title") or file.get("filename") or ""
                resource_url = file.get("url") or ""
                # Build pdf-viewer href that points to the separate Zola app's pdf-viewer template.
                # The viewer expects a 'file' param that can be an absolute URL pointing to the proxy stream.
                # Use the resource_url (which should already be proxy-based) and encode it.
                viewer_href = "/pdf-viewer/?file=" + quote(resource_url, safe='') + ("&title=" + quote(link_text, safe='') if link_text else "")
                parts.append(f'                <li><a href="{esc(viewer_href)}">{esc(link_text)}</a></li>')
            parts.append('              </ul>')
            parts.append('            </details>')
        parts.append('          </li>')
        parts.append('        </ul>')
        parts.append('      </details>')
        parts.append('    </li>')

    parts.append('  </ul>')
    parts.append('</details>')
    out_path = TEMPLATES_DIR / f"{subj}.html"
    content = "\n".join(parts) + "\n"
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(prefix=f".{subj}.", suffix=".tmp", dir=str(TEMPLATES_DIR))
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        # If target exists, compare and only replace when different
        if out_path.exists():
            if filecmp.cmp(tmp_path, out_path, shallow=False):
                print(f"Unchanged template {out_path}")
                os.remove(tmp_path)
            else:
                os.replace(tmp_path, out_path)
                print(f"Updated template {out_path}")
        else:
            os.replace(tmp_path, out_path)
            print(f"Wrote template {out_path}")
    except Exception as e:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        print(f"Failed to write {out_path}: {e}", file=sys.stderr)