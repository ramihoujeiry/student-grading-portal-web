#!/usr/bin/env python3
"""Extract FAA-reference passages from the Pilot's Handbook (FAA-H-8083-25B)
for the maneuvers the grading portal evaluates. Builds faa_index.json that the
web app can load at runtime to ground AI feedback in real FAA text (RAG)."""
import json, re, sys
from pypdf import PdfReader

PDF = r"C:\Users\USER\Downloads\pilot_handbook.pdf"
OUT = r"D:\grading-portal-web\faa-rag\faa_index.json"

# Map portal maneuver names -> FAA search terms (helicopter-relevant first,
# then the handbook's general topics). The PHAB is airplane-centric but its
# ADM / risk-mgmt / aerodynamics chapters apply to rotorcraft too.
QUERIES = {
    "Hover (translational)": ["hover", "translational lift", "effective translational lift"],
    "Hover (pedal turns)": ["antitorque", "pedal", "tail rotor"],
    "Straight & level": ["straight-and-level", "straight and level"],
    "Turns (constant rate)": ["turns", "bank", "rate of turn"],
    "Climb / Descent": ["climb", "descent"],
    "Normal landing": ["normal approach", "landing", "approach"],
    "Approach to hover": ["approach to hover", "hover", "terminating"],
    "Emergency - auto-rotation": ["autorotation", "autorotative", "emergency descent"],
    "Pre-flight / Walk-around": ["preflight", "pre-flight", "walkaround", "walk-around"],
    "Engine start & rotor engage": ["engine start", "rotor engage", "starting"],
    "Risk Management": ["risk management", "aeronautical decision making", "ADM", "PAVE", "risk"],
    "Aeronautical Decision Making": ["aeronautical decision making", "decision making", "human factors"],
}

def paragraphs(text):
    # split into rough paragraphs on blank lines / headings
    chunks = re.split(r"\n\s*\n", text)
    out = []
    for c in chunks:
        c = re.sub(r"\s+", " ", c).strip()
        if len(c) > 60:
            out.append(c)
    return out

print("Reading PDF (this is 54MB, may take a moment)...")
reader = PdfReader(PDF)
index = {}
total_pages = len(reader.pages)
print(f"Pages: {total_pages}")

# Pre-tokenize paragraphs per page once
page_paras = []
for i, page in enumerate(reader.pages):
    try:
        txt = page.extract_text() or ""
    except Exception as e:
        txt = ""
    page_paras.append(paragraphs(txt))

for maneuver, terms in QUERIES.items():
    hits = []
    term_re = re.compile("|".join(r"\b" + re.escape(t) + r"\b" for t in terms), re.I)
    for i, paras in enumerate(page_paras):
        for p in paras:
            if term_re.search(p):
                # clip very long paragraphs
                snippet = p[:700]
                hits.append({"page": i + 1, "text": snippet})
                if len(hits) >= 4:
                    break
        if len(hits) >= 4:
            break
    # de-dup by text
    seen = set(); uniq = []
    for h in hits:
        if h["text"] not in seen:
            seen.add(h["text"]); uniq.append(h)
    index[maneuver] = uniq[:4]
    print(f"  {maneuver}: {len(uniq)} passages")

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(index, f, indent=2, ensure_ascii=False)
print(f"Wrote {OUT}")
