#!/usr/bin/env python3
"""Build a RAG index of FAA + UH-1 source passages for the maneuvers the
grading portal evaluates. Produces faa_index.json (loaded at runtime by
faaRag.js) so the AI generator cites real manuals instead of guessing.

Books:
  - FAA-H-8083-25B Pilot's Handbook of Aeronautical Knowledge (airplane-centric,
    but its ADM / risk-mgmt / aerodynamics chapters apply to rotorcraft)
  - UH-1 Instructor Pilot Course (US Army FTG, 551 pp) -- military helicopter

Maneuver names are keyed to the portal's MIF tables (store.js / seed.js).
"""
import json, re, os
from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "faa_index.json")

FAA_PDF = r"C:\Users\USER\Downloads\pilot_handbook.pdf"
UH1_PDF = r"C:\Users\USER\AppData\Local\hermes\cache\documents\doc_25a6afe8dd12_UH-1 Instructor pilot course Searchable.pdf"

# portal maneuver -> search terms (helicopter-relevant first)
QUERIES = {
    "Hover (translational)": ["hover", "translational lift", "effective translational lift"],
    "Hover (pedal turns)": ["antitorque", "pedal", "tail rotor", "pedal turn"],
    "Straight & level": ["straight-and-level", "straight and level", "attitude instrument flying"],
    "Turns (constant rate)": ["turns", "bank", "rate of turn", "constant rate", "standard rate turn"],
    "Climb / Descent": ["climb", "descent"],
    "Normal landing": ["normal approach", "landing", "approach", "hovering approach"],
    "Approach to hover": ["approach to hover", "hover", "terminating"],
    "Emergency - auto-rotation": ["autorotation", "autorotative", "emergency descent"],
    "Pre-flight / Walk-around": ["preflight", "pre-flight", "walkaround", "walk-around", "before starting"],
    "Engine start & rotor engage": ["engine start", "rotor engage", "starting", "rotor"],
    "Risk Management": ["risk management", "aeronautical decision making", "ADM", "PAVE", "risk", "hazard"],
    "Aeronautical Decision Making": ["aeronautical decision making", "decision making", "human factors"],
    # ---- Instrument / Nav / Formation maneuvers (added so those evals cite books) ----
    "Instrument Manoeuvres": ["instrument", "attitude instrument", "hood", "under the hood", "scan", "cross-check"],
    "Control Touch": ["smooth", "control touch", "overcontrolling", "anticipate", "small corrections", "settled"],
    "Interception": ["intercept", "intercepting", "course", "bearing"],
    "Tracking": ["tracking", "track", "maintain course", "wind correction"],
    "Holding Entry": ["holding", "hold", "procedure turn", "holding pattern", "entry"],
    "Holding Procedure": ["holding", "hold", "outbound", "inbound", "on radial", "fix"],
    "Time control": ["time", "time control", "time management", "clock", "eta", "leg time"],
    "Radio calls": ["radio", "communication", "call", "phraseology", "report"],
    "Airspace surveillance": ["airspace", "traffic", "lookout", "scan for traffic", "see and avoid", "surveillance"],
    "VFR approach": ["approach", "vfr", "visual approach", "traffic pattern", "circuit"],
    "Formation": ["formation", "section", "wing", "position keeping", "close trail"],
    "Navigation": ["navigation", "nav", "pilotage", "dead reckoning", "map", "chart"],
    # ---- Confined Area phase (R44-2) ----
    "Spot selection / risk assessment": ["site selection", "spot selection", "risk assessment", "confined area", "hazard", "survey", "recon", "landing site"],
    "Confined approach": ["confined area", "confined approach", "confined-area approach", "approach to confined", "tight approach", "obstacle", "hovering approach"],
    "Confined departure": ["confined departure", "confined area", "departure", "confined takeoff", "takeoff from confined", "vertical takeoff"],
    "Run-on landing": ["run-on landing", "roll-on landing", "running landing", "touchdown", "ground taxi"],
    "Steep approach": ["steep approach", "steep angled approach", "high approach", "precipitous", "confined approach"],
    # ---- General instructional technique / anything-useful categories ----
    # These let the AI cite the manuals for teaching method, errors, and theory
    # even when a debrief is not about a single graded maneuver.
    "Instructional technique": ["instruction", "teach", "demonstrate", "guided practice", "explanation", "brief", "coaching", "student", "learning", "proficiency", "method"],
    "Common errors": ["common error", "frequently", "often", "mistake", "error", "fault", "pilot error", "accident", "cause"],
    "Emergency procedures": ["emergency", "malfunction", "failure", "engine failure", "procedure", "survival", "ditching", "fire"],
    "Human factors": ["human factors", "fatigue", "stress", "attention", "situation awareness", "SA", "workload", "cognitive", "illusion", "spatial disorientation"],
    "Weather / wind": ["weather", "wind", "gust", "turbulence", "visibility", "ceiling", "thunderstorm", "wind shear", "microburst"],
    "Crew resource management": ["crew resource", "CRM", "crew", "resource management", "teamwork", "communication", "briefing"],
    "Lesson planning": ["lesson", "syllabus", "objective", "standardization", "curriculum", "stage", "evaluation", "check"],
    "Aerodynamics (rotor)": ["rotor", "aerodynamic", "translational lift", "vortex ring", "settling with power", "retreating blade", "dissymmetry", "gyroscopic", "flap", "drag"],
    "Safety / accident prevention": ["safety", "accident prevention", "hazard", "incident", "prevention", "risk", "mitigation"],
}

BOOKS = [("FAA-H-8083-25B", FAA_PDF), ("UH-1 IPC", UH1_PDF), ("Robinson FTG", os.path.join(HERE, "books", "ftg_book.pdf"))]


# Auto-discover any extra PDFs dropped into faa-rag/books/ (future books you
# send). They are indexed automatically -- no code change needed.
_books_dir = os.path.join(HERE, "books")
if os.path.isdir(_books_dir):
    _known = {os.path.normcase(os.path.abspath(p)) for _, p in BOOKS}
    for _f in sorted(os.listdir(_books_dir)):
        if _f.lower().endswith(".pdf"):
            _p = os.path.join(_books_dir, _f)
            if os.path.normcase(os.path.abspath(_p)) not in _known:
                BOOKS.append((os.path.splitext(_f)[0], _p))


def paragraphs(text):
    chunks = re.split(r"\n\s*\n", text)
    out = []
    for c in chunks:
        c = re.sub(r"\s+", " ", c).strip()
        if len(c) < 80 or len(c) > 900:
            continue
        # drop table-of-contents / leader-dot lines ("Time Zones.....16-3")
        if re.search(r"\.{3,}", c):
            continue
        # drop page-footnote / reference lines ("Page 16-3", "Figure 2-1.", "p. 2-4")
        if re.match(r"^(page|figure|fig\.|p\.|ch\.|chapter|\(\d)", c, re.I):
            continue
        # drop pure navigation-history narrative (not teaching content)
        if re.search(r"\b(prehistoric|world war|federal aviation act of 195\d|19\d\d|macracken|first pilot license|airmail|patco|de regulation|wright brothers|19\d2|18\d\d)\b", c, re.I):
            continue
        # drop lines that are mostly numbers / codes / OCR garbage
        letters = sum(ch.isalpha() for ch in c)
        if letters / max(len(c), 1) < 0.55:
            continue
        out.append(c)
    return out


# terms that, when present, signal a passage is NOT instructional maneuver content
_NOISE_TERMS = re.compile(
    r"\b(prehistoric|world war|federal aviation act|macracken|airmail|patco|"
    r"deregulation|wright brothers|inaugural|postal service|war department|"
    r"first pilot license|first airmail|history of flight|countless lives)\b", re.I)


def _score(p, terms):
    """Higher = more on-topic. Counts distinct matched terms, weighted."""
    low = p.lower()
    s = 0
    for t in terms:
        if re.search(r"\b" + re.escape(t) + r"\b", low):
            s += 1 + min(len(t) / 12.0, 1.0)  # longer terms weigh a bit more
    return s


def extract(book, pdf_path, index, hits_per_maneuver=10):
    if not os.path.exists(pdf_path):
        print(f"  [skip] {book}: not found at {pdf_path}")
        return
    print(f"Reading {book}: {pdf_path}")
    try:
        reader = PdfReader(pdf_path)
    except Exception as e:
        print(f"  [error] {book}: {e}")
        return
    pages = reader.pages
    print(f"  pages: {len(pages)}")

    page_paras = []
    for i, page in enumerate(pages):
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        page_paras.append(paragraphs(txt))

    for maneuver, terms in QUERIES.items():
        term_re = re.compile("|".join(r"\b" + re.escape(t) + r"\b" for t in terms), re.I)
        scored = []
        for i, paras in enumerate(page_paras):
            for p in paras:
                if _NOISE_TERMS.search(p):
                    continue
                if term_re.search(p):
                    s = _score(p, terms)
                    if s > 0:
                        snippet = f"[{book} p.{i+1}] " + p[:700]
                        scored.append((s, snippet))
        # keep the highest-scoring, de-duped passages
        seen = set()
        uniq = []
        for s, h in sorted(scored, key=lambda x: -x[0]):
            core = h.split("] ", 1)[-1]
            if core in seen:
                continue
            seen.add(core)
            uniq.append(h)
            if len(uniq) >= hits_per_maneuver:
                break
        index.setdefault(maneuver, [])
        index[maneuver].extend(uniq)
        print(f"  {maneuver}: +{len(uniq)} ({book})")


def main():
    index = {}
    for book, path in BOOKS:
        extract(book, path, index)
    # final de-dup across books per maneuver
    for m in index:
        seen = set(); uniq = []
        for h in index[m]:
            core = h.split("] ", 1)[-1]
            if core not in seen:
                seen.add(core); uniq.append(h)
        index[m] = uniq[:15]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    total = sum(len(v) for v in index.values())
    print(f"\nWrote {OUT} ({total} passages across {len(index)} maneuvers)")


if __name__ == "__main__":
    main()
