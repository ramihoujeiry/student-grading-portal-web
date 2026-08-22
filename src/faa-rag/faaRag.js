/* =========================================================================
 * faaRag.js — light RAG layer that grounds the grading-portal AI feedback in
 * real FAA / UH-1 / Robinson FTG source text.
 *
 * PERF REMEDIATION (t_c6ab4fc3): this module is NOT loaded on the cold path.
 * store.js dynamic-imports it (and it in turn dynamic-imports the ~220KB index)
 * ONLY when AI Feedback / a debrief actually runs. The index never parses on
 * first paint.
 *
 * Exposes: FaaRag.loadIndex(), buildFaaContext(data), normalize(name), status()
 * ========================================================================= */

let _index = null;
let _loaded = false;
let _status = 'idle'; // idle | ok | failed

// Lazily load the index module (its own chunk). No eager fetch / global.
async function loadIndex() {
  if (_loaded) return _index;
  _loaded = true;
  try {
    const mod = await import('./faa_index.js');
    _index = mod.FAA_INDEX;
    _status = _index ? 'ok' : 'failed';
  } catch (e) {
    console.warn('FAA RAG index unavailable:', e && e.message);
    _index = null;
    _status = 'failed';
  }
  return _index;
}

// Status for the UI badge: 'ok' = manuals loaded & will be cited,
// 'failed' = index unreachable (debrief will be ungrounded).
function status() { return _status; }

// Normalize a portal maneuver name to the index keys we store.
function normalize(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n.includes('autorot')) return 'Emergency - auto-rotation';
  if (n.includes('hover') && n.includes('pedal')) return 'Hover (pedal turns)';
  if (n.includes('hover')) return 'Hover (translational)';
  if (n.includes('pre-flight') || n.includes('preflight') || n.includes('walk')) return 'Pre-flight / Walk-around';
  if (n.includes('engine start') || n.includes('rotor engage')) return 'Engine start & rotor engage';
  if (n.includes('straight')) return 'Straight & level';
  if (n.includes('turn')) return 'Turns (constant rate)';
  if (n.includes('climb') || n.includes('descent')) return 'Climb / Descent';
  if (n.includes('approach to hover')) return 'Approach to hover';
  if (n.includes('land')) return 'Normal landing';
  if (n.includes('risk')) return 'Risk Management';
  if (n.includes('decision') || n.includes('adm')) return 'Aeronautical Decision Making';
  // ---- Instrument / Nav / Formation ----
  if (n.includes('instrument') || n.includes('hood')) return 'Instrument Manoeuvres';
  if (n.includes('control touch') || n.includes('over-control') || n.includes('overcontrol')) return 'Control Touch';
  if (n.includes('intercept')) return 'Interception';
  if (n.includes('track') && !n.includes('track record')) return 'Tracking';
  if (n.includes('holding entry') || n.includes('hold entry')) return 'Holding Entry';
  if (n.includes('holding') || n.includes('hold procedure') || n.includes('procedure turn')) return 'Holding Procedure';
  if (n.includes('time control') || n.includes('time-management')) return 'Time control';
  if (n.includes('radio') || n.includes('call') || n.includes('comm')) return 'Radio calls';
  if (n.includes('airspace') || n.includes('surveillance') || n.includes('lookout') || n.includes('traffic scan')) return 'Airspace surveillance';
  if (n.includes("vfr") && n.includes("approach")) return "VFR approach";
  if (n.includes("formation") || n.includes("section") || n.includes("wing")) return "Formation";
  if (n.includes("navigation") || n.includes("nav ") || n.includes("pilotage")) return "Navigation";
  // ---- Confined Area phase ----
  if (n.includes("spot selection") || n.includes("risk assessment") || n.includes("site selection")) return "Spot selection / risk assessment";
  if (n.includes("confined") && n.includes("approach")) return "Confined approach";
  if (n.includes("confined") && (n.includes("departure") || n.includes("takeoff") || n.includes("depart"))) return "Confined departure";
  if (n.includes("run-on") || n.includes("roll-on") || n.includes("running landing")) return "Run-on landing";
  if (n.includes("steep approach") || n.includes("steep angled")) return "Steep approach";
  // ---- General instructional technique / anything-useful ----
  if (n.includes("instruction") || n.includes("teach") || n.includes("coach") || n.includes("demonstrat") || n.includes("lesson") || n.includes("briefing")) return "Instructional technique";
  if (n.includes("common error") || n.includes("pilot error") || n.includes("accident") || n.includes("mistake")) return "Common errors";
  if (n.includes("emergency") || n.includes("malfunction") || n.includes("engine failure") || n.includes("ditching")) return "Emergency procedures";
  if (n.includes("human factor") || n.includes("fatigue") || n.includes("spatial disorientation") || n.includes("situation awareness") || n.includes("workload")) return "Human factors";
  if (n.includes("weather") || n.includes("wind shear") || n.includes("turbulence") || n.includes("thunderstorm") || n.includes("microburst")) return "Weather / wind";
  if (n.includes("crew resource") || n.includes(" crm")) return "Crew resource management";
  if (n.includes("lesson plan") || n.includes("syllabus") || n.includes("standardiz") || n.includes("curriculum")) return "Lesson planning";
  if (n.includes("aerodynamic") || n.includes("vortex ring") || n.includes("settling with power") || n.includes("retreating blade") || n.includes("dissymmetry") || n.includes("translational lift")) return "Aerodynamics (rotor)";
  if (n.includes("safety") || n.includes("accident prevention") || n.includes("hazard prevention")) return "Safety / accident prevention";
  return name; // fall back to exact key
}

// Build an FAA-grounded context block from a performance analysis object.
// `data` is the shape returned by buildPerformance() in store.js.
async function buildFaaContext(data) {
  const idx = await loadIndex();
  if (!idx) return '';
  const blocks = [];
  const seen = new Set();

  // normalizer: a passage may be a string "[BOOK p.N] ..." (combined index)
  // or an object {page, text} (legacy FAA-only index). Return (label, body).
  function extract(p) {
    if (typeof p === 'string') {
      const m = p.match(/^\[([^\]]+)\]\s*/);
      return m ? { label: m[1], body: p.slice(m[0].length) } : { label: '', body: p };
    }
    return { label: (p.page ? 'p.' + p.page : ''), body: p.text || '' };
  }

  // 1) Weak maneuvers (below required MIF) — highest priority.
  (data.weakManeuvers || []).slice(0, 5).forEach(w => {
    const key = normalize(w.name);
    const passages = idx[key];
    if (passages && passages.length) {
      passages.forEach(p => {
        const { label, body } = extract(p);
        if (seen.has(body)) return;
        seen.add(body);
        blocks.push(`REFERENCE — ${w.name} (${label}):\n${body}`);
      });
    }
  });

  // 2) Always include general instructional-technique + safety + ADM passages
  // so every debrief can lean on the manuals for teaching method, common
  // errors, human factors and risk management — not only weak maneuvers.
  ['Risk Management', 'Aeronautical Decision Making', 'Instructional technique',
   'Common errors', 'Safety / accident prevention', 'Human factors',
   'Crew resource management'].forEach(k => {
    (idx[k] || []).slice(0, 4).forEach(p => {
      const { label, body } = extract(p);
      if (seen.has(body)) return;
      seen.add(body);
      blocks.push(`REFERENCE — ${k} (${label}):\n${body}`);
    });
  });

  if (!blocks.length) return '';
  return '\n\n--- REFERENCE SOURCE MATERIAL (FAA-H-8083-25B + UH-1 Instructor Pilot Course + Robinson FTG) ---\n' +
    blocks.join('\n\n') +
    '\n--- END REFERENCE ---\n' +
    'Use the above source material to anchor your coaching points where relevant. ' +
    'Cite the referenced manual when you reference a specific principle. Do not contradict FAA / UH-1 / Robinson guidance.\n';
}

export const FaaRag = { loadIndex, buildFaaContext, normalize, status };
