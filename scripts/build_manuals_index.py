#!/usr/bin/env python3
"""
build_manuals_index.py
=======================
Rebuild src/faa-rag/faa_index.js from the PDFs dropped in manuals/.

Design
------
- Each PDF is streamed page-by-page with `pdftotext -layout` (avoids loading
  ~500 MB into RAM).
- The citation LABEL is taken from the PDF's REAL title (detected from the
  first pages), NOT the filename -- filenames in manuals/ are often wrong
  (e.g. a PHAK pdf named "...25B..."). A TITLE->LABEL map + heuristics fix this.
- Every passage is stamped "[LABEL p.N]" where N is the PDF page number.
- Passages are mapped to TOPIC KEYS (the 39 already in faa_index.js, plus new
  keys created on demand). Mapping is keyword-based (mirrors faaRag.normalize()).
- To keep the bundle sane, we CAP passages per (topic, book) and total passages
  per topic.
- Existing entries in faa_index.js are PRESERVED. New PDF-sourced entries are
  merged in. If a PDF's label matches an existing book's label, its old entries
  for that book are REPLACED (repairs garbled OCR like the old UH-1 IPC).

Usage
-----
    python scripts/build_manuals_index.py [--dry-run]

Writes src/faa-rag/faa_index.js (overwrites). Commit the result + rebuild.
"""
import os, re, sys, json, subprocess, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANUALS = os.path.join(ROOT, "manuals")
OUT = os.path.join(ROOT, "src", "faa-rag", "faa_index.js")

# -------- tuning --------
MAX_PER_TOPIC_BOOK = 5      # cap passages per (topic, book label)
# (we do not hard-cap total per topic; the per-book cap already bounds it)

# Old book labels to DROP from the existing index because a clean PDF now
# provides the same (or better) coverage. e.g. the old "UH-1 IPC" entries were
# OCR-garbled; the UH-1 FTG PDF replaces them with clean text.
REPLACE_MAP = {
    "UH-1 IPC": "UH-1 FTG",
}

# -------- topic keyword rules (label -> regex on normalized passage) --------
# Order matters: first match wins. Mirrors faaRag.normalize() intent.
TOPIC_RULES = [
    ("Emergency - auto-rotation", r"autorotat"),
    ("Hover (pedal turns)", r"pedal turn|pedal.*hover|hover.*turn"),
    ("Hover (translational)", r"\bhover\b|hovering"),
    ("Pre-flight / Walk-around", r"preflight|pre-flight|walk.?around|before.?start"),
    ("Engine start & rotor engage", r"engine start|rotor engage|before leaving"),
    ("Straight & level", r"straight.*level|straight and level"),
    ("Turns (constant rate)", r"\bturn\b|constant rate"),
    ("Climb / Descent", r"climb|descent"),
    ("Approach to hover", r"approach to hover|hover.*approach"),
    ("Normal landing", r"normal landing|\brunning landing|run-on landing|landing"),
    ("Risk Management", r"risk management|risk"),
    ("Aeronautical Decision Making", r"aeronautical decision|aeronautical decision making|\badm\b|decision making"),
    ("Instrument Manoeuvres", r"instrument|imc|iimc|hood"),
    ("Control Touch", r"control touch|over-control|overcontrol|feel of the"),
    ("Interception", r"intercept"),
    ("Tracking", r"\btrack\b|tracking"),
    ("Holding Entry", r"holding entry"),
    ("Holding Procedure", r"holding"),
    ("Time control", r"time control|time-management"),
    ("Radio calls", r"radio call|radio communic|radio navigation|\bcomm\b"),
    ("Airspace surveillance", r"airspace|surveillance|lookout|traffic scan"),
    ("VFR approach", r"vfr approach"),
    ("Formation", r"formation|section|wing"),
    ("Navigation", r"navigation|pilotage|dead reckon|navigate"),
    ("Spot selection / risk assessment", r"spot selection|site selection|risk assessment"),
    ("Confined approach", r"confined.*approach|confined"),
    ("Confined departure", r"confined.*depart|confined.*takeoff"),
    ("Run-on landing", r"run-on|roll-on|running landing"),
    ("Steep approach", r"steep approach|steep angled|pinnacle|ridgeline"),
    ("Instructional technique", r"instruction|teach|coach|demonstrat|lesson|briefing|instruct"),
    ("Common errors", r"common error|common student|student error|frror|frrn"),
    ("Emergency procedures", r"emergency|malfunction|engine failure|ditching|egress"),
    ("Human factors", r"human factor|fatigue|spatial disorientation|situation awareness|workload"),
    ("Weather / wind", r"weather|wind shear|turbulence|thunderstorm|microburst"),
    ("Crew resource management", r"crew resource|\bcrm\b|crew coordination"),
    ("Lesson planning", r"lesson plan|syllabus|standardiz|curriculum"),
    ("Aerodynamics (rotor)", r"aerodynamic|vortex ring|settling with power|retreating blade|dissymmetry|translational lift"),
    ("Safety / accident prevention", r"safety|accident prevention|hazard"),
]

# -------- title -> book label detection --------
def detect_label(text_first_pages):
    t = text_first_pages.lower()
    # explicit, high-confidence matches FIRST (filename/title based)
    if "pilot's encyclopedia of aeronautical" in t or "encyclopedia of aeronautical knowledge" in t:
        return "Pilot's Encyclopedia of Aeronautical Knowledge"
    if "instructing fundamentals" in t:
        return "Instructing Fundamentals"
    if "pilot's handbook of aeronautical knowledge" in t or "phak" in t:
        return "FAA PHAK"
    if "helicopter flying handbook" in t:
        return "FAA-H-8083-21B"
    if "helicopter instructor" in t:
        return "FAA-H-8083-4"
    if "aviation instructor" in t:
        return "FAA-H-8083-9"
    if "aircrew training manual" in t and "uh-1" in t:
        return "TC 1-211"
    if "flight training guide" in t and "uh-1" in t:
        return "UH-1 FTG"
    # fallback: try to pull an FAA doc number
    m = re.search(r"faa-?h-?8083-?(\d+[a-z]?)", t)
    if m:
        return f"FAA-H-8083-{m.group(1).upper()}"
    return None

def map_topic(text):
    tl = text.lower()
    for topic, pat in TOPIC_RULES:
        if re.search(pat, tl):
            return topic
    return None  # unmapped -> goes to a "General" catch-all? we skip unmapped to control size

def split_sentences(text):
    # keep passages reasonably sized: split on blank lines / task boundaries
    chunks = re.split(r"\n\s*\n|(?=TASK:)", text)
    out = []
    for c in chunks:
        c = re.sub(r"\s+", " ", c).strip()
        # drop pure page-footer / TOC garbage (lines that are mostly dots or numbers)
        if len(c) < 40:
            continue
        if re.fullmatch(r"[\d\s.\-]+", c):
            continue
        out.append(c)
    return out

def _pdf_pages(path):
    tmp = os.path.join(ROOT, "_pdfinfo.txt")
    try:
        subprocess.run(["pdfinfo", path], stdout=open(tmp, "wb"), stderr=subprocess.DEVNULL, timeout=60)
        with open(tmp, "r", encoding="utf-8", errors="replace") as fh:
            m = re.search(r"Pages:\s*(\d+)", fh.read())
        pages = int(m.group(1)) if m else 999
    except Exception:
        pages = 999
    finally:
        try: os.remove(tmp)
        except OSError: pass
    return pages

def extract_pdf(path):
    """Yield (page_number, text) per page.
    Dumps the WHOLE pdf in ONE pdftotext call (fast) and splits on the
    form-feed (\\f) page separator. Reads the temp file with errors='replace'
    to avoid the Windows-1252/UTF-8 decode crash."""
    tmp = os.path.join(ROOT, "_pdf_full.txt")
    try:
        subprocess.run(["pdftotext", "-layout", path, tmp], stderr=subprocess.DEVNULL, timeout=300)
        with open(tmp, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except Exception:
        raw = ""
    finally:
        try: os.remove(tmp)
        except OSError: pass
    pages = raw.split("\f")
    first = "\f".join(pages[:4])
    for n, txt in enumerate(pages, start=1):
        yield n, txt
    extract_pdf._last_first = first

def build():
    if not shutil.which("pdftotext"):
        sys.exit("pdftotext not found on PATH")
    # load existing index
    existing = load_existing()
    existing_labels = set()
    for arr in existing.values():
        for s in arr:
            mm = re.match(r"^\[([^\]]+)\]", s)
            if mm:
                # label is everything before first p.
                lab = re.split(r"\bp\.\d", mm.group(1))[0].strip()
                existing_labels.add(lab)

    merged = {}  # topic -> list of "[LABEL p.N] text"
    # seed with existing (we will strip+re-add per-book to allow replacement)
    per_book_seen = {}  # (topic,label) -> count

    pdfs = [f for f in os.listdir(MANUALS) if f.lower().endswith(".pdf")]
    print(f"Found {len(pdfs)} PDFs in manuals/")
    for f in sorted(pdfs):
        path = os.path.join(MANUALS, f)
        # detect label from the PDF's first pages (temp-file read, no pipe decode)
        first = ""
        pages = _pdf_pages(path)
        tmp = os.path.join(ROOT, "_pg.txt")
        for n in range(1, min(pages, 4) + 1):
            try:
                subprocess.run(["pdftotext", "-layout", "-f", str(n), "-l", str(n), path, tmp],
                               stderr=subprocess.DEVNULL, timeout=60)
                with open(tmp, "r", encoding="utf-8", errors="replace") as fh:
                    first += fh.read() + "\n"
            except Exception:
                pass
        try: os.remove(tmp)
        except OSError: pass
        label = detect_label(first)
        if not label:
            # fallback to filename without ext, sanitized
            label = re.sub(r"\.[pP][dD][fF]$", "", f).strip()
            # collapse the messy FAA filename
            mm = re.search(r"(faa-?h-?8083-?\d+[a-z]?)", label, re.I)
            if mm:
                label = mm.group(1).upper().replace(" ", "-")
        print(f"  {f} -> label [{label}] ({pages} pp)")
        added = 0
        for n, txt in extract_pdf(path):
            for chunk in split_sentences(txt):
                topic = map_topic(chunk)
                if not topic:
                    continue
                key = (topic, label)
                if per_book_seen.get(key, 0) >= MAX_PER_TOPIC_BOOK:
                    continue
                per_book_seen[key] = per_book_seen.get(key, 0) + 1
                merged.setdefault(topic, []).append(f"[{label} p.{n}] {chunk}")
                added += 1
        print(f"      added {added} passages")

    # Now merge: for each topic, keep existing entries EXCEPT those whose book
    # label is being REPLACED by a PDF (see REPLACE_MAP), then append new PDF
    # entries. This drops the old garbled UH-1 IPC in favour of clean UH-1 FTG.
    replaced_labels = {lab for (_, lab) in per_book_seen.keys()}
    replaced_labels.update(REPLACE_MAP.keys())
    result = {}
    for topic, arr in existing.items():
        kept = []
        for s in arr:
            mm = re.match(r"^\[([^\]]+)\]", s)
            lab = re.split(r"\bp\.\d", mm.group(1))[0].strip() if mm else ""
            if lab in REPLACE_MAP:
                continue  # drop old (garbled/duplicate) version; PDF provides clean one
            kept.append(s)
        result[topic] = kept
    # append new
    for topic, arr in merged.items():
        result.setdefault(topic, []).extend(arr)
    # add any wholly-new topics
    for topic in merged:
        if topic not in result:
            result[topic] = merged[topic]

    # sort topics for stability
    out_topics = sorted(result.keys())
    write_index(result, out_topics)
    total = sum(len(v) for v in result.values())
    print(f"Wrote {OUT}: {len(out_topics)} topics, {total} passages")

def load_existing():
    """Parse the current faa_index.js into {topic: [str,...]}.
    The file body is valid JSON (keys+values are json.dumps'd), so parse it
    directly instead of fragile regex."""
    src = open(OUT, encoding="utf-8", errors="replace").read()
    body = src.split("=", 1)[1].rsplit(";", 1)[0].strip()
    try:
        data = json.loads(body)
    except Exception as e:
        # fallback: strip a trailing comma if present
        body = re.sub(r",\s*}", "}", body)
        data = json.loads(body)
    return {k: list(v) for k, v in data.items()}

def write_index(data, topics):
    lines = ['export const FAA_INDEX = {']
    for i, t in enumerate(topics):
        lines.append('  ' + json.dumps(t, ensure_ascii=False) + ': [')
        arr = data[t]
        for j, s in enumerate(arr):
            comma = ',' if j < len(arr) - 1 else ''
            lines.append('    ' + json.dumps(s, ensure_ascii=False) + comma)
        comma = ',' if i < len(topics) - 1 else ''
        lines.append('  ]' + comma)
    lines.append('};')
    lines.append('')
    open(OUT, "w", encoding="utf-8").write("\n".join(lines))

if __name__ == "__main__":
    build()
