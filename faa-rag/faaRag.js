/* =========================================================================
 * faaRag.js — light RAG layer that grounds the grading-portal AI feedback in
 * real FAA / UH-1 / Robinson FTG source text. The index is embedded in
 * faa_index.js (window.FAA_INDEX) and loaded via a plain <script> tag, so NO
 * fetch / service-worker / file:// dependency exists. (fetch fallback kept
 * only as a secondary path.) Works even when opened from disk or offline.
 * ========================================================================= */
(function (global) {
  let _index = null;
  let _loaded = false;
  let _status = 'idle'; // idle | ok | failed

  // Load the index. Prefer the embedded window.FAA_INDEX (no network needed);
  // fall back to fetching faa_index.json if embedding isn't present.
  async function loadIndex() {
    if (_loaded) return _index;
    _loaded = true;
    try {
      if (global.FAA_INDEX) {
        _index = global.FAA_INDEX;
        _status = _index ? 'ok' : 'failed';
        return _index;
      }
      const res = await fetch('faa-rag/faa_index.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _index = await res.json();
      _status = _index ? 'ok' : 'failed';
    } catch (e) {
      console.warn('FAA RAG index unavailable:', e.message);
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
    if (n.includes('vfr') && n.includes('approach')) return 'VFR approach';
    if (n.includes('formation') || n.includes('section') || n.includes('wing')) return 'Formation';
    if (n.includes('navigation') || n.includes('nav ') || n.includes('pilotage')) return 'Navigation';
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

    // 2) Always include risk-management + ADM passages for the readiness/ADM section.
    ['Risk Management', 'Aeronautical Decision Making'].forEach(k => {
      (idx[k] || []).forEach(p => {
        const { label, body } = extract(p);
        if (seen.has(body)) return;
        seen.add(body);
        blocks.push(`REFERENCE — ${k} (${label}):\n${body}`);
      });
    });

    if (!blocks.length) return '';
    return '\n\n--- REFERENCE SOURCE MATERIAL (FAA-H-8083-25B + UH-1 Instructor Pilot Course) ---\n' +
      blocks.join('\n\n') +
      '\n--- END REFERENCE ---\n' +
      'Use the above source material to anchor your coaching points where relevant. ' +
      'Cite the referenced manual when you reference a specific principle. Do not contradict FAA / UH-1 guidance.\n';
  }

  global.FaaRag = { loadIndex, buildFaaContext, normalize, status };
})(typeof window !== 'undefined' ? window : this);
