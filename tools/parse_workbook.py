#!/usr/bin/env python3
"""Extract seed + reference data from Course_Tracker.xlsx into js/seed.js and js/reference.js.

Standard library only (no openpyxl/pandas) — reads the .xlsx as the OOXML zip it is.
Re-run after editing the workbook:

    python3 tools/parse_workbook.py [path/to/Course_Tracker.xlsx]
"""

import json
import re
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NSR = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

DEFAULT_XLSX = Path.home() / "Gettysburg/year4/s1/Course_Tracker.xlsx"
OUT_DIR = Path(__file__).resolve().parent.parent / "js"

COURSES = ["CS440", "CS391", "CS360", "ENG216"]
ME = "Nick"

# The workbook stores classmates by first name only. Committing those to a public
# repo would publish them without their knowledge, so the seed ships initials.
# Set to "names" and re-run to keep full first names in your local copy.
ROSTER_MODE = "initials"

# Stable ids across re-runs, so regenerating seed.js produces a clean diff.
ID_NS = uuid.UUID("6f1d9c2e-0b7a-4c3f-9e51-2a8d4b6c7e10")


# --------------------------------------------------------------------------- xlsx

class Workbook:
    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        self.shared = self._shared_strings()
        self.sheets = self._sheet_index()

    def _shared_strings(self):
        if "xl/sharedStrings.xml" not in self.zip.namelist():
            return []
        root = ET.fromstring(self.zip.read("xl/sharedStrings.xml"))
        return ["".join(t.text or "" for t in si.iter(f"{NS}t")) for si in root.findall(f"{NS}si")]

    def _sheet_index(self):
        rels = {
            r.get("Id"): r.get("Target")
            for r in ET.fromstring(self.zip.read("xl/_rels/workbook.xml.rels"))
        }
        index = {}
        for sh in ET.fromstring(self.zip.read("xl/workbook.xml")).find(f"{NS}sheets"):
            target = rels[sh.get(f"{NSR}id")]
            if not target.startswith("xl/"):
                target = "xl/" + target.lstrip("/")
            index[sh.get("name")] = target
        return index

    def rows(self, sheet_name):
        """{row_number: {col_number: value}}. Formula cells are dropped — every
        computed column in this workbook is recomputed at runtime instead."""
        root = ET.fromstring(self.zip.read(self.sheets[sheet_name]))
        out = {}
        for c in root.iter(f"{NS}c"):
            if c.find(f"{NS}f") is not None:
                continue
            col, row = _ref(c.get("r"))
            value = self._cell_value(c)
            if value not in (None, ""):
                out.setdefault(row, {})[col] = value
        return out

    def _cell_value(self, c):
        kind = c.get("t")
        v = c.find(f"{NS}v")
        if kind == "s" and v is not None:
            return self.shared[int(v.text)]
        if kind == "inlineStr":
            node = c.find(f"{NS}is")
            return "".join(t.text or "" for t in node.iter(f"{NS}t")) if node is not None else None
        return v.text if v is not None else None


def _ref(ref):
    letters, row = re.match(r"([A-Z]+)(\d+)", ref).groups()
    col = 0
    for ch in letters:
        col = col * 26 + (ord(ch) - 64)
    return col, int(row)


def text(row, col):
    value = row.get(col)
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def date(row, col):
    """Excel serial -> 'YYYY-MM-DD'. The 1900 date system's epoch is 1899-12-30."""
    raw = row.get(col)
    if raw in (None, ""):
        return None
    try:
        return (datetime(1899, 12, 30) + timedelta(days=float(raw))).strftime("%Y-%m-%d")
    except ValueError:
        return None


def integer(row, col):
    raw = row.get(col)
    if raw in (None, ""):
        return None
    try:
        return int(round(float(raw)))
    except ValueError:
        return None


def make_id(*parts):
    return str(uuid.uuid5(ID_NS, "|".join(str(p) for p in parts)))


# --------------------------------------------------------------------------- sheets

def parse_course(wb, course, counter):
    """Course tabs: title banner row 1, headers row 2, data row 3+.
    Columns 8 (Days Left) and 10 (Start By) hold formulas and are never imported."""
    tasks = []
    for row_no, row in sorted(wb.rows(course).items()):
        if row_no < 3:
            continue
        name = text(row, 2)
        if not name:  # blank template row
            continue
        status = text(row, 6) or "Not Started"
        tasks.append({
            "id": make_id(course, name, row_no),
            "seq": next(counter),
            "task": name,
            "details": text(row, 3),
            "type": text(row, 4) or "Other",
            "priority": text(row, 5) or "Medium",
            "status": status,
            "due": date(row, 7),
            "estMin": integer(row, 9),
            "source": text(row, 11),
            "notes": text(row, 12),
            "added": date(row, 13),
            "completed": date(row, 14) if status == "Done" else None,
        })
    return tasks


def parse_personal(wb, counter):
    tasks = []
    for row_no, row in sorted(wb.rows("Personal").items()):
        if row_no < 3:
            continue
        name = text(row, 1)
        if not name:
            continue
        tasks.append({
            "id": make_id("Personal", name, row_no),
            "seq": next(counter),
            "task": name,
            "notes": text(row, 2),
            "due": date(row, 3),
            "priority": text(row, 4) or "Medium",
            "status": text(row, 5) or "Not Started",
        })
    return tasks


def anonymize(name):
    if not name or name == ME or ROSTER_MODE == "names":
        return name
    return name[0].upper() + "."


def parse_groups(wb):
    groups = []
    for row_no, row in sorted(wb.rows("CS440 Groups").items()):
        if not (3 <= row_no <= 14):
            continue
        members = [text(row, c) for c in (2, 3, 4, 5)]
        members = [m for m in members if m]
        groups.append({
            "group": text(row, 1),
            "members": [anonymize(m) for m in members],
            "facilitates": text(row, 6),
            "mine": ME in members,
        })
    return groups


def parse_cs440_schedule(wb):
    rows = []
    for row_no, row in sorted(wb.rows("CS440 Schedule").items()):
        if row_no < 4:
            continue
        facilitators = text(row, 7)
        rows.append({
            "wk": text(row, 1),
            "date": date(row, 2),
            "day": text(row, 3),
            # The workbook prefixes facilitated classes with a star; the star is
            # re-derived from `mine` at render time rather than baked into the text.
            "topic": text(row, 4).lstrip("★ ").strip(),
            "reading": text(row, 5),
            "seText": text(row, 6),
            "facilitators": facilitators,
            "due": text(row, 8),
            "mine": False,  # filled in by main(), from the actual roster
        })
    return rows


def parse_cs360_schedule(wb):
    rows = []
    for row_no, row in sorted(wb.rows("CS360 Schedule").items()):
        if row_no < 4:
            continue
        rows.append({
            "wk": text(row, 1),
            "date": date(row, 2),
            "topic": text(row, 3),
            "reading": text(row, 4),
            "due": text(row, 5),
        })
    return rows


# --------------------------------------------------------------------------- output

def js_module(banner, exports):
    lines = [
        "// GENERATED by tools/parse_workbook.py — do not edit by hand.",
        f"// {banner}",
        "",
    ]
    for name, value in exports.items():
        lines.append(f"export const {name} = {json.dumps(value, indent=2, ensure_ascii=False)};")
        lines.append("")
    return "\n".join(lines)


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not path.exists():
        sys.exit(f"Workbook not found: {path}")

    wb = Workbook(path)
    counter = iter(range(1, 100000))

    tasks = {course: parse_course(wb, course, counter) for course in COURSES}
    personal = parse_personal(wb, counter)
    groups = parse_groups(wb)
    cs440_schedule = parse_cs440_schedule(wb)
    cs360_schedule = parse_cs360_schedule(wb)

    my_groups = sorted({g["group"] for g in groups if g["mine"]})
    for row in cs440_schedule:
        row["mine"] = row["facilitators"] in my_groups

    grades = {course: {"items": [], "target": 0.93} for course in COURSES}

    (OUT_DIR / "seed.js").write_text(js_module(
        f"Source: {path.name}",
        {"seedTasks": tasks, "seedPersonal": personal, "seedGrades": grades},
    ))
    (OUT_DIR / "reference.js").write_text(js_module(
        f"Read-only reference data. Source: {path.name}  (roster mode: {ROSTER_MODE})",
        {
            "cs440Groups": groups,
            "myGroups": my_groups,
            "cs440Schedule": cs440_schedule,
            "cs360Schedule": cs360_schedule,
        },
    ))

    for course in COURSES:
        print(f"{course:8} {len(tasks[course]):3} tasks")
    print(f"{'Personal':8} {len(personal):3} tasks")
    print(f"{'Groups':8} {len(groups):3}  (mine: {', '.join(my_groups)})")
    print(f"{'CS440 sc':8} {len(cs440_schedule):3} rows  "
          f"({sum(1 for r in cs440_schedule if r['mine'])} facilitated by me)")
    print(f"{'CS360 sc':8} {len(cs360_schedule):3} rows")


if __name__ == "__main__":
    main()
