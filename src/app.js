/* =========================================================================
 * app.js — Vue 3 SPA for the Student Grading Portal web app (Firebase-backed).
 * Auth-gated. Mirrors the Android app's role model (admin/instructor/viewer/pending).
 * ========================================================================= */

import { createApp } from 'vue';
import { FIREBASE_READY } from './firebase-config.js';
import {
  COL,
  STATUS_MEETS_STANDARD, STATUS_BELOW_STANDARD, STATUS_PENDING,
  Auth, Store, getRag, fmtDate, calcFinalGrade, calcMifStatus,
  buildPerformance,
  buildSingleEvalData, buildSingleEvalPrompt,
  getAIConfig, callAIModel, callAIModelWithPrompt, getCurrentUser
} from './store.js';

export const app = createApp({
  data() {
    return {
      tab: 'dashboard',
      // auth
      user: null,            // firebase user
      role: 'pending',
      authMode: 'login',     // login | register
      authEmail: '', authPass: '', authName: '',
      authError: '', authBusy: false,
      fbReady: FIREBASE_READY,

      // collections (live from Firestore)
      students: [], instructors: [], aircraft: [], mifTables: [], evaluations: [], announcements: [], users: [],

      // dashboard filters (mirror Android DashboardActivity)
      dashStudent: 'All Cadets', dashAircraft: 'All Aircraft',
      dashStart: '', dashEnd: '',
      // training progress search (page removed; fields kept harmless)
      tpSearch: '', tpAircraft: 'All Aircraft',
      evStudent: 'All Cadets', evAircraft: 'All Aircraft', evPhase: 'All Phases', evYear: 'All Years', evSearch: '',
      analyticsStudent: '',  // student filter on the Analytics page

      // ui
      evalForm: blankEval(),
      durationH: '01', durationM: '00',   // duration picker mirrors Android HH:MM
      showEvalModal: false,
      saving: false,         // in-flight save guard (blocks double-save on slow connection)
      overwriteClash: null,  // existing eval the chosen trip already graded
      overwritePending: null,// eval object staged for overwrite-confirm
      selectedEval: null,    // evaluation detail
      selectedStudent: null, // student profile
      aiForStudent: null,    // student id for AI on profile
      activeYear: '',        // school-year filter
      DURATIONS: [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0], // duration picker presets (h)
      toast: '', toastType: 'info',
      aiStudentId: '', aiResult: '', aiLoading: false,
      aiRagStatus: '', // '' | 'ok' (manuals cited) | 'failed' (index unreachable)
      ragReady: null,  // null = checking, true = index loaded, false = failed (set on mount)
      aiSingleResult: '', aiSingleLoading: false,
      // Ask-Data (private instructor copilot over grading data)
      askQuery: '', askResult: '', askLoading: false,

      // bulk grade entry (audit item 5): one tap sets every maneuver to N
      bulkGrade: 0,
      // user preference: light / dark theme (persisted to localStorage)
      theme: 'dark',
      // CSV import (audit item 11): mirror of exportCSV with validation + preview
      importCsv: { open: false, text: '', parsed: null, error: '' },
      // AI status badge (audit item 13): 'live' | 'offline' | 'checking'
      aiBadge: 'checking',
      // Generic in-app dialog (replaces native prompt()/confirm()) — audit item 2
      dlg: { open: false, mode: 'input', title: '', message: '', label: '', value: '', fields: null, busy: false, confirmText: 'Confirm', pending: null },

      // Analytics drill-down (audit item 10): which weak-maneuver rows are expanded
      weakExpanded: {},
      // Feedback channel + lightweight local usage analytics (audit item 9)
      feedback: { open: false, text: '', role: '', busy: false, done: false, error: '' },
      analytics: []   // rolling event log (localStorage-backed, privacy-respecting)
      // UI density preference (compact mode saves screen space on phones at the ramp)
      , uiDensity: 'comfortable',
      // Full-dataset JSON backup/restore (offline disaster recovery)
      backup: { busy: false, msg: '', error: '' }
    };
  },
  watch: {
    // Persist the theme preference whenever it changes (localStorage only; no
    // round-trip to Firestore — it's a pure client preference).
    theme(t) {
      try { localStorage.setItem('sgp.theme', t); } catch (e) {}
      this._applyTheme(t);
    },
    // Persist UI density (compact / comfortable) — pure client preference.
    uiDensity(t) {
      try { localStorage.setItem('sgp.density', t); } catch (e) {}
      this._applyDensity(t);
    },
    // Lightweight, privacy-respecting usage analytics (audit item 9): log a tab
    // open event locally. No PII, no network — just an anonymous event counter
    // used to surface "what got used" in the dashboard activity card.
    tab(t) { this.logEvent('tab:' + t); }
  },
  computed: {
    loggedIn() { return !!this.user; },
    isAdmin() { return this.role === 'admin'; },
    isViewer() { return this.role === 'viewer'; },
    canEdit() { return this.role !== 'viewer' && this.role !== 'pending'; },

    stats() {
      const ev = this.evaluations;
      const meets = ev.filter(e => e.overallMifStatus === STATUS_MEETS_STANDARD).length;
      const below = ev.filter(e => e.overallMifStatus === STATUS_BELOW_STANDARD).length;
      const avg = ev.length ? (ev.reduce((s, e) => s + (e.finalGrade || 0), 0) / ev.length).toFixed(1) : '0.0';
      return { students: this.students.length, instructors: this.instructors.length, evals: ev.length, meets, below, avg };
    },
    evalsByStudent() {
      const map = {};
      this.evaluations.forEach(e => { (map[e.studentId] = map[e.studentId] || []).push(e); });
      return map;
    },
    tablesByAircraft() {
      const map = {};
      this.mifTables.forEach(t => { (map[t.aircraftType] = map[t.aircraftType] || []).push(t); });
      return map;
    },
    currentTable() {
      return this.mifTables.find(t => t.aircraftType === this.evalForm.aircraftType && t.phaseName === this.evalForm.phaseName) || null;
    },
    // active only — inactive students/instructors must not appear in the New Evaluation pickers (mirrors Android)
    activeStudents() { return (this.students || []).filter(s => s.active !== false); },
    activeInstructors() { return (this.instructors || []).filter(i => i.active !== false); },
    evalPreview() {
      const mg = (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0);
      if (!mg.length) return { finalGrade: null, status: STATUS_PENDING, failCount: 0 };
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      let fail = 0;
      (this.evalForm.maneuverGrades || []).forEach(m => { if (m.studentGrade != null && m.studentGrade !== 0 && m.requiredMif != null && m.studentGrade < m.requiredMif) fail++; });
      return { finalGrade: fg, status: st, failCount: fail };
    },

    // available school years (sorted desc), defaulting to the most recent
    years() {
      const set = new Set();
      this.evaluations.forEach(e => { if (e.flightYear) set.add(e.flightYear); });
      this.students.forEach(s => (s.activeYears || []).forEach(y => set.add(y)));
      return Array.from(set).sort().reverse();
    },
    activeYearResolved() { return this.activeYear || this.years[0] || ''; },

    // year-scoped views so a student's data never mixes across school years.
    // A student belongs to a year if: their activeYears includes it, OR they have
    // an evaluation in that year (mirrors Android, which derives years from evals),
    // OR they are unassigned (no activeYears and no evals) -> shown in the active year
    // so legacy students aren't lost.
    studentsInYear() {
      const y = this.activeYearResolved;
      return this.students.filter(s => {
        const ay = s.activeYears || [];
        if (ay.length) return ay.includes(y);
        const hasEvalInYear = this.evaluations.some(e => e.studentId === s.id && e.flightYear === y);
        if (hasEvalInYear) return true;
        const hasAnyEval = this.evaluations.some(e => e.studentId === s.id);
        // unassigned (no activeYears, no evals) -> show in active year
        return !hasAnyEval;
      });
    },
    evalsByStudentInYear() {
      const y = this.activeYearResolved;
      // Free-text search across useful fields (date, student, phase, instructor, aircraft, trip,
      // grade, MIF status, flight year) — deliberately EXCLUDES tripNotes (IP comments).
      const q = (this.evSearch || '').trim().toLowerCase();
      const searchable = (e) => {
        if (!q) return true;
        const dateStr = (typeof e.date === 'number') ? new Date(e.date * 1000).toISOString().slice(0, 10) : '';
        const hay = [
          e.studentName, e.phaseName, e.instructorName, e.aircraftType, e.tripNumber,
          e.finalGrade != null ? String(e.finalGrade) : '', e.overallMifStatus, e.flightYear, dateStr
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      };
      // Apply the Evaluations-page filters (student / aircraft / phase / school year / search).
      const evs = this.evaluations.filter(e => {
        if (this.evYear && this.evYear !== 'All Years' && e.flightYear !== this.evYear) return false;
        else if ((!this.evYear || this.evYear === 'All Years') && e.flightYear !== y) return false;
        if (this.evStudent && this.evStudent !== 'All Cadets' && e.studentName !== this.evStudent) return false;
        if (this.evAircraft && this.evAircraft !== 'All Aircraft' && e.aircraftType !== this.evAircraft) return false;
        if (this.evPhase && this.evPhase !== 'All Phases' && e.phaseName !== this.evPhase) return false;
        if (!searchable(e)) return false;
        return true;
      });
      const map = {};
      evs.forEach(e => { (map[e.studentId] = map[e.studentId] || []).push(e); });
      return map;
    },
    evalsSortedByDate() {
      // Flat, date-sorted (most recent first) view of the filtered evaluations.
      // Reuses evalsByStudentInYear's filtering (year/student/aircraft/phase/search),
      // flattens the per-student groups, and sorts by date descending.
      const out = [];
      Object.values(this.evalsByStudentInYear).forEach(arr => out.push(...arr));
      return out.sort((a, b) => (b.date || 0) - (a.date || 0));
    },
    // Unique phase names available for the Evaluations filter dropdown.
    phaseOptions() {
      const set = new Set();
      this.evaluations.forEach(e => { if (e.phaseName) set.add(e.phaseName); });
      this.mifTables.forEach(t => { if (t.phaseName) set.add(t.phaseName); });
      return Array.from(set).sort();
    },
    isPending() { return this.role === 'pending'; },

    // per-student analytics for the Analytics tab (reuses buildPerformance from store.js)
    perStudentAnalytics() {
      const out = [];
      const byStudent = {};
      this.evaluations.forEach(e => { (byStudent[e.studentId] = byStudent[e.studentId] || []).push(e); });
      this.students.forEach(s => {
        if (this.analyticsStudent && s.id !== this.analyticsStudent) return;
        const evals = (byStudent[s.id] || []).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
        const perf = buildPerformance(s, evals);
        out.push({
          id: s.id, name: s.name, active: s.active,
          avg: perf.overallScore ? perf.overallScore.toFixed(1) : '-',
          trend: perf.trend, trips: perf.evaluationCount,
          hours: evals.reduce((sum, e) => sum + this.parseHours(e.duration), 0),
          weak: perf.weakManeuvers.slice(0, 3).map(w => w.name),
          readiness: perf.readiness,
          mif: perf.overallMifStatus || '-'
        });
      });
      // sort: most trips first, then name
      return out.sort((a, b) => (b.trips - a.trips) || (a.name || '').localeCompare(b.name || ''));
    },

    // Failed items: per student, maneuvers scored below required MIF (mirrors Android FailedItemsActivity)
    failedItems() {
      const out = [];
      const byStudent = {};
      this.evaluations.forEach(e => { (byStudent[e.studentId] = byStudent[e.studentId] || []).push(e); });
      this.students.forEach(s => {
        if (this.analyticsStudent && s.id !== this.analyticsStudent) return;
        const tally = {}; // maneuver -> {count, required}
        (byStudent[s.id] || []).forEach(e => (e.maneuverGrades || []).forEach(m => {
          if (m.studentGrade != null && m.studentGrade !== 0 && m.requiredMif != null && m.studentGrade < m.requiredMif) {
            if (!tally[m.name]) tally[m.name] = { count: 0, required: m.requiredMif };
            tally[m.name].count++;
          }
        }));
        const items = Object.keys(tally).map(n => ({ name: n, count: tally[n].count, required: tally[n].required }))
          .sort((a, b) => b.count - a.count);
        if (items.length) out.push({ id: s.id, name: s.name, items });
      });
      return out;
    },

    // Dashboard filtered evaluations (mirror Android DashboardActivity student/aircraft/date filters)
    dashFilteredEvals() {
      const y = this.activeYearResolved;
      let list = this.evaluations.filter(e => e.flightYear === y);
      if (this.dashStudent && this.dashStudent !== 'All Cadets')
        list = list.filter(e => e.studentName === this.dashStudent);
      if (this.dashAircraft && this.dashAircraft !== 'All Aircraft')
        list = list.filter(e => e.aircraftType === this.dashAircraft);
      if (this.dashStart) list = list.filter(e => (e.date || 0) >= Math.floor(Date.parse(this.dashStart) / 1000));
      if (this.dashEnd) list = list.filter(e => (e.date || 0) <= Math.floor(Date.parse(this.dashEnd) / 1000) + 86399);
      return list;
    },
    dashTotalHours() {
      return this.dashFilteredEvals.reduce((sum, e) => sum + this.parseHours(e.duration), 0);
    },
    // Which school years actually have data behind them (for the Dashboard
    // "year coverage" context). Distinct flightYear values across evals/students.
    dashCoveredYears() {
      const set = new Set();
      this.evaluations.forEach(e => { if (e.flightYear) set.add(e.flightYear); });
      return Array.from(set).sort().reverse();
    },

    // User management (admin only) — mirror Android UserManagementActivity
    pendingUsers() { return this.users.filter(u => (u.role || 'pending') === 'pending'); },
    allUsers() { return this.users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')); },

    // Class Readiness board (dashboard widget, audit item 9/10 reuse): readiness
    // verdict per student using the same buildPerformance engine as AI Feedback.
    classReadiness() {
      const out = [];
      this.students.forEach(s => {
        if (this.analyticsStudent && s.id !== this.analyticsStudent) return;
        const evals = this.evalsByStudent[s.id] || [];
        if (!evals.length) return;
        const perf = buildPerformance(s, evals.slice().sort((a, b) => (a.date || 0) - (b.date || 0)));
        out.push({ id: s.id, name: s.name, readiness: perf.readiness, trend: perf.trend, avg: perf.overallScore ? perf.overallScore.toFixed(1) : '-', weak: perf.weakManeuvers.length });
      });
      // READY first, then RECOVERING, REMEDIAL, INSUFFICIENT_DATA; by name within group
      const order = { READY: 0, RECOVERING: 1, REMEDIAL: 2, INSUFFICIENT_DATA: 3 };
      return out.sort((a, b) => (order[a.readiness] - order[b.readiness]) || (a.name || '').localeCompare(b.name || ''));
    },

    // Most-recent evaluations (across the dashboard's active filters) for the
    // dashboard activity feed. Sorted newest-first, capped for the widget.
    dashRecent() {
      return this.dashFilteredEvals.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 10);
    },

    // Class-wide maneuver difficulty (Analytics "Cohort difficulty" widget):
    // aggregate every scored maneuver across ALL students' evaluations, then
    // rank by (a) share of grades below required MIF and (b) average grade.
    // Surfaces the maneuvers the *cohort* struggles with most — actionable for
    // syllabus emphasis. Reuses the same grade/required-MIF math as grading.
    classManeuverDifficulty() {
      const tally = {}; // name -> {sum, w, below, n, req}
      this.evaluations.forEach(e => (e.maneuverGrades || []).forEach(m => {
        if (m.studentGrade == null || m.studentGrade === 0) return;
        const f = m.factor || 1;
        if (!tally[m.name]) tally[m.name] = { sum: 0, w: 0, below: 0, n: 0, req: (m.requiredMif != null ? m.requiredMif : 0) };
        const t = tally[m.name];
        t.sum += (m.studentGrade || 0) * f;
        t.w += f;
        t.n += 1;
        if (m.requiredMif != null && m.studentGrade < m.requiredMif) t.below += 1;
      }));
      const out = Object.keys(tally).map(name => {
        const t = tally[name];
        const avg = t.w ? t.w : 0;
        return { name, avg: Math.round((t.sum / (t.w || 1)) * 10) / 10, belowPct: t.n ? Math.round((t.below / t.n) * 100) : 0, below: t.below, n: t.n, req: t.req };
      });
      // Hardest first: most % below MIF, then lowest average.
      return out.sort((a, b) => (b.belowPct - a.belowPct) || (a.avg - b.avg)).slice(0, 12);
    }
  },
  methods: {
    setTab(t) { this.tab = t; },
    // toastMsg(message, type) — type is 'info' (default), 'success', or 'error'.
    // Errors stay visible longer (4s vs 2.2s) and get a distinct red style so a
    // failed save is never missed and color is never the only signal.
    toastMsg(m, type) {
      this.toast = m; this.toastType = type || 'info';
      const ms = type === 'error' ? 4000 : 2200;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { if (this.toast === m) { this.toast = ''; this.toastType = 'info'; } }, ms);
    },

    /* ---- auth ---- */
    async doLogin() {
      if (!this.fbReady) { this.authError = 'Firebase is not configured (apiKey missing).'; return; }
      this.authBusy = true; this.authError = '';
      try { await Auth.login(this.authEmail, this.authPass); }
      catch (e) { this.authError = e.message || 'Login failed'; }
      this.authBusy = false;
    },
    async doRegister() {
      if (!this.fbReady) { this.authError = 'Firebase is not configured (apiKey missing).'; return; }
      if (!this.authName.trim()) { this.authError = 'Enter your full name.'; return; }
      this.authBusy = true; this.authError = '';
      try {
        await Auth.register(this.authEmail, this.authPass, this.authName.trim());
        this.authError = '';
        this.toastMsg('Account created. Verify your email, then log in.');
        this.authMode = 'login';
      } catch (e) { this.authError = e.message || 'Registration failed'; }
      this.authBusy = false;
    },
    async doLogout() { await Auth.logout(); },

    async onUser(u) {
      if (!u) { this.user = null; this.role = 'pending'; this.students = []; this.instructors = []; this.aircraft = []; this.mifTables = []; this.evaluations = []; this.announcements = []; return; }
      // Mirror the Android app's login contract:
      //  - email must be verified
      //  - role must exist and not be 'pending'
      if (!u.emailVerified) {
        this.authError = 'Please verify your email before logging in. Check your inbox.';
        await Auth.logout();
        return;
      }
      this.user = u;
      // Self-heal: ensure a users/{uid} doc exists (e.g. registered before
      // Firestore rules were deployed). Creates a pending doc if missing so
      // the admin sees them in the Users tab.
      try { await Auth.upsertUserDoc(u); } catch (e) { /* non-fatal */ }
      const role = await Auth.roleOf(u.uid);
      this.role = role;
      if (!role || role === 'pending') {
        this.authError = 'Your account is pending approval. Please contact an administrator.';
        await Auth.logout();
        return;
      }
      // real-time listeners
      Store.watch(COL.students, l => this.students = l, { orderBy: 'name', activeOnly: false });
      Store.watch(COL.instructors, l => this.instructors = l, { orderBy: 'name', activeOnly: false });
      Store.watch(COL.aircraft, l => this.aircraft = l, { orderBy: 'name' });
      Store.watch(COL.mifTables, l => this.mifTables = l);
      Store.watch(COL.evaluations, l => this.evaluations = l);
      Store.watch(COL.announcements, l => this.announcements = l.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
      if (role === 'admin') Store.watch(COL.users, l => this.users = l);
      // first admin seeds an empty project
      if (role === 'admin') await Store.seedIfEmpty(u);
    },

    /* ---- students ---- */
    addStudent() { this.openForm({ title: 'Add student', fields: [{ key: 'name', label: 'Student name' }], onOk: async (v) => { await Store.addStudent(v.name); this.toastMsg('Student added'); } }); },
    async toggleStudentActive(s) { await Store.setStudentActive(s.id, !s.active); },
    deleteStudent(s) { this.openConfirm({ title: 'Delete student', message: 'Delete ' + s.name + '? This cannot be undone.', confirmText: 'Delete', onOk: async () => { await Store.deleteStudent(s.id); } }); },

    /* ---- instructors ---- */
    addInstructor() { this.openForm({ title: 'Add instructor', fields: [{ key: 'name', label: 'Instructor name' }], onOk: async (v) => { await Store.addInstructor(v.name); this.toastMsg('Instructor added'); } }); },
    async toggleInstructorActive(i) { await Store.setInstructorActive(i.id, !i.active); },
    deleteInstructor(i) { this.openConfirm({ title: 'Delete instructor', message: 'Delete ' + i.name + '?', confirmText: 'Delete', onOk: async () => { await Store.deleteInstructor(i.id); } }); },

    /* ---- aircraft ---- */
    addAircraft() { this.openForm({ title: 'Add aircraft type', fields: [{ key: 'name', label: 'Aircraft type (e.g. R44-2)' }], onOk: async (v) => { await Store.addAircraft(v.name); this.toastMsg('Aircraft added'); } }); },
    deleteAircraft(a) { this.openConfirm({ title: 'Delete aircraft', message: 'Delete ' + a.name + '?', confirmText: 'Delete', onOk: async () => { await Store.deleteAircraft(a.id); } }); },

    /* ---- MIF tables ---- */
    addMifTable() {
      this.openForm({
        title: 'Add MIF table',
        fields: [
          { key: 'aircraftType', label: 'Aircraft type (must match an added aircraft)', value: 'R44-2' },
          { key: 'phaseName', label: 'Phase name (e.g. CONTACT)', value: 'CONTACT' },
          { key: 'stages', label: 'Stages (comma separated, e.g. S1, S2, S3)', value: 'S1, S2, S3' }
        ],
        onOk: async (v) => {
          if (!v.aircraftType || !v.phaseName) return;
          const stages = v.stages.split(',').map(s => s.trim()).filter(Boolean);
          await Store.addMifTable(v.aircraftType, v.phaseName, stages.length ? stages : ['S1']);
          this.toastMsg('MIF table added');
        }
      });
    },
    addManeuver(t) {
      const stageFields = (t.stages || []).map(st => ({ key: 'mif_' + st, label: 'Required MIF for ' + st + ' (0 = not graded this stage)', value: '2', type: 'number' }));
      this.openForm({
        title: 'Add maneuver to ' + t.phaseName,
        fields: [
          { key: 'name', label: 'Maneuver name' },
          { key: 'factor', label: 'Weight factor', value: '1.0', type: 'number' },
          ...stageFields
        ],
        onOk: async (v) => {
          if (!v.name) return;
          const factor = parseFloat(v.factor) || 1.0;
          const stageMifs = {};
          (t.stages || []).forEach(st => { const x = parseInt(v['mif_' + st], 10); stageMifs[st] = isNaN(x) ? 2 : x; });
          await Store.addManeuver(t.id, { name: v.name, factor, stageMifs });
        }
      });
    },
    async deleteManeuver(t, idx) { await Store.deleteManeuver(t.id, idx); },
    deleteMifTable(t) { this.openConfirm({ title: 'Delete MIF table', message: 'Delete table ' + t.phaseName + '?', confirmText: 'Delete', onOk: async () => { await Store.deleteMifTable(t.id); } }); },

    /* ---- evaluations ---- */
    openNewEval() {
      this.evalForm = blankEval();
      // NOTE: do NOT auto-select student/aircraft/phase/instructor. The original Android app
      // requires the user to explicitly pick these four (MainActivity.prepareSave blocks save
      // until all are chosen). Leaving them unselected lets the saveEval() guard enforce that.
      this.durationH = '01'; this.durationM = '00';
      this.evalForm.duration = '01:00';
      this.onEvalDateChange(); // auto flight year from date
      this.showEvalModal = true;
      // When the user picks an aircraft+phase, load its MIF table / maneuvers and auto-suggest the next trip.
      const load = () => {
        const t = this.mifTables.find(x => x.aircraftType === this.evalForm.aircraftType && x.phaseName === this.evalForm.phaseName);
        if (t) {
          this.loadManeuversForForm();
          this.suggestTrip();
        }
      };
      this.$nextTick(load);
    },
    loadManeuversForForm() {
      const t = this.currentTable;
      if (!t) { this.evalForm.maneuverGrades = []; return; }
      // Preserve any grades already entered when only the stage (trip number)
      // changes -- otherwise switching S1->S2 wipes the whole score sheet.
      const prev = {};
      (this.evalForm.maneuverGrades || []).forEach(m => { if (m && m.name != null) prev[m.name] = m.studentGrade; });
      this.evalForm.maneuverGrades = t.maneuvers.map(m => ({
        name: m.name, factor: m.factor,
        // onEvalContextChange drives this via $nextTick so v-model has settled
        // the trip number first -- fixes the stale-MIF silent wrong-grade bug.
        requiredMif: m.stageMifs[this.evalForm.tripNumber] != null ? m.stageMifs[this.evalForm.tripNumber] : 2,
        studentGrade: prev[m.name] != null ? prev[m.name] : 0
      }));
    },
    // $nextTick guarantees evalForm.tripNumber is updated by v-model before we
    // recompute per-stage required MIF -- fixes the stale-MIF grade bug.
    onEvalContextChange() {
      this.$nextTick(() => this.loadManeuversForForm());
    },
    async saveEval() {
      // Block double-save: on a slow connection an instructor can tap Save several times
      // before Firestore confirms, and each tap created a duplicate trip. This guard makes
      // the first tap win and ignores the rest until the save resolves (or the user resets).
      if (this.saving) return;
      // Mirror the original Android app's required-field check (MainActivity.prepareSave):
      // student, aircraft, phase and instructor must be selected before saving.
      // (Trip number is auto-suggested, not a required blank field.)
      if (!this.evalForm.studentId || !this.evalForm.aircraftType || !this.evalForm.phaseName || !this.evalForm.instructorName) {
        this.toastMsg('Please fill in all required fields (student, aircraft, phase, instructor)');
        return;
      }
      const ev = this.buildEvalFromForm();
      // Warn if this student already has an evaluation for this exact trip (would overwrite).
      // Re-check live in case one slipped in during a previous slow save.
      const clash = this.existingTripCheck(ev);
      if (clash) { this.overwriteClash = clash; this.overwritePending = ev; }
      else await this.persistEval(ev);
    },
    // Next sortie auto-suggestion (Android fetchSuggestedTrip): after the student's highest
    // S# in this aircraft+phase, suggest S(n+1); S1 if none.
    suggestTrip() {
      const { studentId, aircraftType, phaseName } = this.evalForm;
      if (!studentId || !aircraftType || !phaseName) return;
      const nums = this.evaluations
        .filter(e => e.studentId === studentId && e.aircraftType === aircraftType && e.phaseName === phaseName)
        .map(e => parseInt(String(e.tripNumber || '').replace(/[^0-9]/g, ''), 10))
        .filter(n => !isNaN(n));
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      this.evalForm.tripNumber = 'S' + next;
    },
    // Copy the most recent evaluation's maneuver grades for this student+aircraft+phase
    // as a starting point (last-trip prefill). Still fully editable. (audit item 5)
    copyLastTrip() {
      const { studentId, aircraftType, phaseName } = this.evalForm;
      if (!studentId || !aircraftType || !phaseName) { this.toastMsg('Pick student, aircraft and phase first'); return; }
      const prev = this.evaluations
        .filter(e => e.studentId === studentId && e.aircraftType === aircraftType && e.phaseName === phaseName)
        .slice().sort((a, b) => (b.date || 0) - (a.date || 0))[0];
      const mg = (this.evalForm.maneuverGrades || []);
      if (prev && prev.maneuverGrades && prev.maneuverGrades.length) {
        const byName = {};
        prev.maneuverGrades.forEach(m => { byName[m.name] = m; });
        this.evalForm.maneuverGrades = mg.map(m => {
          const src = byName[m.name];
          return src ? { ...m, studentGrade: src.studentGrade || 0 } : m;
        });
        this.toastMsg('Copied grades from ' + (prev.phaseName || '') + ' ' + (prev.tripNumber || 'last trip'));
      } else {
        this.toastMsg('No previous trip found to copy');
      }
    },
    // Bulk-set every maneuver to the chosen grade (1-4) in one tap. (audit item 5)
    applyBulkGrade(n) {
      this.bulkGrade = n;
      (this.evalForm.maneuverGrades || []).forEach(m => { m.studentGrade = n; });
    },
    clearBulkGrade() {
      this.bulkGrade = 0;
      (this.evalForm.maneuverGrades || []).forEach(m => { m.studentGrade = 0; });
    },
    // Recompute whether the currently-selected trip would overwrite an existing eval.
    updateTripClash() {
      const ev = this.buildEvalFromForm();
      this.overwriteClash = this.existingTripCheck(ev);
    },
    existingTripCheck(ev) {
      if (!ev.studentId || !ev.phaseName || !ev.tripNumber) return null;
      return this.evaluations.find(e =>
        e.studentId === ev.studentId && e.phaseName === ev.phaseName && e.tripNumber === ev.tripNumber);
    },
    confirmOverwrite() {
      const ev = this.overwritePending;
      this.overwriteClash = null; this.overwritePending = null;
      if (ev && !this.saving) this.persistEval(ev);
    },
    cancelOverwrite() {
      this.overwriteClash = null; this.overwritePending = null;
    },
    async persistEval(ev) {
      if (this.saving) return;        // extra safety net
      this.saving = true;
      try {
        await Store.saveEvaluation(ev);
        this.showEvalModal = false;
        this.logEvent('eval:saved', ev.phaseName + ' ' + ev.tripNumber);
        this.toastMsg('Evaluation saved', 'success');
      } catch (err) {
        console.error('saveEval', err);
        // Keep the modal open so the instructor can retry; surface a clear, retry-oriented message.
        this.toastMsg('Could not save evaluation — check your connection and try again. (' + (err && err.message ? err.message : 'unknown error') + ')', 'error');
      } finally {
        this.saving = false;       // re-enable Save (modal stays open so fixable errors can be retried)
      }
    },
    buildEvalFromForm() {
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      const student = this.students.find(s => s.id === this.evalForm.studentId);
      const dateSec = Math.floor(Date.parse(this.evalForm.date) / 1000) || Math.floor(Date.now() / 1000);
      return {
        id: this.evalForm.id || '',
        aircraftType: this.evalForm.aircraftType,
        studentId: this.evalForm.studentId,
        studentName: student ? student.name : '',
        instructorName: this.evalForm.instructorName,
        phaseName: this.evalForm.phaseName,
        tripNumber: this.evalForm.tripNumber,
        date: dateSec,
        flightYear: this.getFlightYear(dateSec),
        duration: this.evalForm.duration,
        finalGrade: fg || 0,
        overallMifStatus: st,
        tripNotes: this.evalForm.tripNotes,
        maneuverGrades: (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0)
          .map(m => ({ name: m.name, factor: m.factor, requiredMif: m.requiredMif, studentGrade: m.studentGrade }))
      };
    },
    // Build a print-ready eval object from the live New-Evaluation form (so it can be printed/previewed
    // before saving), then open the Android-style PDF view.
    printFormEval() {
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      const student = this.students.find(s => s.id === this.evalForm.studentId);
      const dateSec = Math.floor(Date.parse(this.evalForm.date) / 1000) || Math.floor(Date.now() / 1000);
      const ev = {
        studentName: student ? student.name : '',
        aircraftType: this.evalForm.aircraftType,
        phaseName: this.evalForm.phaseName,
        tripNumber: this.evalForm.tripNumber,
        date: dateSec,
        duration: this.evalForm.duration,
        instructorName: this.evalForm.instructorName,
        finalGrade: fg != null ? fg : 0,
        overallMifStatus: st,
        tripNotes: this.evalForm.tripNotes,
        maneuverGrades: (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0)
          .map(m => ({ name: m.name, factor: m.factor, requiredMif: m.requiredMif, studentGrade: m.studentGrade }))
      };
      this.printEval(ev);
    },
    deleteEval(e) { this.openConfirm({ title: 'Delete evaluation', message: 'Delete this evaluation? This cannot be undone.', confirmText: 'Delete', onOk: async () => { await Store.deleteEvaluation(e); } }); },
    studentName(id) { const s = this.students.find(x => x.id === id); return s ? s.name : '?'; },

    /* ---- detail views ---- */
    openEval(e) { this.selectedEval = e; },
    openStudent(s) { this.selectedStudent = s; this.aiForStudent = null; },
    closeDetail() { this.selectedEval = null; this.selectedStudent = null; this.aiForStudent = null; },
    evalForStudent(sid) { return this.evaluations.filter(e => e.studentId === sid).slice().sort((a, b) => (b.date || 0) - (a.date || 0)); },

    /* ---- AI feedback for a student profile ---- */
    async runAIForStudent() {
      // Resolve the student from the AI tab dropdown (aiStudentId) or a opened profile.
      const student = this.selectedStudent
        || (this.aiStudentId ? this.students.find(s => s.id === this.aiStudentId) : null);
      if (!student) { this.toastMsg('Pick a student first'); return; }
      this.aiForStudent = student.id;
      this.aiLoading = true;
      this.aiResult = '';
      this.aiRagStatus = '';
      this.logEvent('ai:used');
      const evals = this.evaluations.filter(e => e.studentId === student.id);
      const data = buildPerformance(student, evals);
      // Warm the RAG index so the grounding badge is accurate, then call the live model.
      let ragOk = false;
      try { const FaaRag = await getRag(); await FaaRag.loadIndex(); ragOk = (FaaRag.status() === 'ok'); } catch (e) {}
      this.aiRagStatus = ragOk ? 'ok' : 'failed';
      // Live AI debrief only — no offline template fallback.
      const cfg = await getAIConfig();
      if (!cfg) {
        this.aiResult = '⚠️ No AI endpoint configured. Set config/ai in Firestore, or enable the LAN Pi proxy.';
        this.aiLoading = false;
        return;
      }
      try {
        const text = await callAIModel(data, cfg);
        this.aiResult = text;
        this.aiRagStatus = (this.aiRagStatus === 'ok') ? 'ok' : 'online';
      } catch (e) {
        console.warn('AI model call failed:', e);
        this.aiResult = '⚠️ Could not reach the AI model (' + (e.message || e) + '). Make sure the Pi AI proxy is online, or try again shortly.';
      }
      this.aiLoading = false;
    },

    /* ---- AI debrief for a SINGLE evaluation (opened from the Evaluations list) ---- */
    async runAISingleEval() {
      const ev = this.selectedEval;
      if (!ev) { this.toastMsg('Open an evaluation first'); return; }
      this.aiSingleLoading = true;
      this.aiSingleResult = '';
      const data = buildSingleEvalData(ev);
      // Live AI debrief only — no offline template fallback.
      const cfg = await getAIConfig();
      if (!cfg) {
        this.aiSingleResult = '⚠️ No AI endpoint configured. Set config/ai in Firestore, or enable the LAN Pi proxy.';
        this.aiSingleLoading = false;
        return;
      }
      try {
        const prompt = await buildSingleEvalPrompt(data);
        const text = await callAIModelWithPrompt(prompt, cfg);
        this.aiSingleResult = text;
      } catch (e) {
        console.warn('Single-eval AI call failed:', e);
        this.aiSingleResult = '⚠️ Could not reach the AI model (' + (e.message || e) + '). Make sure the Pi AI proxy is online, or try again shortly.';
      }
      this.aiSingleLoading = false;
    },

    /* ---- Ask-Data: private instructor copilot over the grading data ----
       Builds a compact snapshot of what the logged-in user already has in
       memory (students, evaluations, MIF tables) and asks the live AI model
       a natural-language question about it. No Firebase Admin key needed. */
    async askData() {
      const q = (this.askQuery || '').trim();
      if (!q) { this.toastMsg('Type a question first'); return; }
      this.askLoading = true;
      this.askResult = '';
      try {
        const cfg = await getAIConfig();
        if (!cfg) throw new Error('no AI endpoint configured');
        const snap = this.buildDataSnapshot();
        const system = 'You are an instructor operations assistant for a flight-school grading system. ' +
          'You are given a JSON snapshot of the current grading data (students, evaluations, MIF tables). ' +
          'Answer the instructor\'s question using ONLY the data provided. Be specific and cite names/numbers. ' +
          'Each student entry has a `totalHours` field (decimal hours, sum of that student\'s evaluation durations). ' +
          'Each recent evaluation has a `duration` field formatted as "HH:MM" and a `notes` field with the ' +
          'instructor\'s free-text trip notes (coach comments, safety items, remarks). Use both to answer ' +
          'flight-hour / flight-time and notes questions. If the data does not contain the answer, say so plainly. ' +
          'Keep replies concise and practical. Do not invent students, grades, or maneuvers. ' +
          'If asked to list or rank, use tables or bullet lists.';
        const user = 'GRADING DATA SNAPSHOT:\n' + JSON.stringify(snap) + '\n\nQUESTION: ' + q;
        const text = await callAIModelWithPrompt({ system, user }, cfg);
        this.askResult = text;
      } catch (e) {
        console.warn('askData failed:', e);
        this.askResult = '⚠️ Could not reach the AI model (' + (e.message || e) + '). ' +
          'Make sure the Pi AI proxy is online, or try again shortly.';
      }
      this.askLoading = false;
    },
    /* Compact, query-friendly view of the in-memory grading data. */
    buildDataSnapshot() {
      const evs = this.evaluations || [];
      const parseHours = (dur) => {
        if (!dur || typeof dur !== 'string') return 0;
        const m = dur.match(/(\d+):(\d+)/);
        if (!m) return 0;
        return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
      };
      const byStudent = {};
      this.students.forEach(s => { byStudent[s.id] = { name: s.name, evals: 0, totalHours: 0 }; });
      evs.forEach(e => {
        const b = byStudent[e.studentId];
        if (b) { b.evals++; b.totalHours += parseHours(e.duration); }
      });
      const weak = evs.filter(e => e.overallMifStatus === STATUS_BELOW_STANDARD);
      const meets = evs.filter(e => e.overallMifStatus === STATUS_MEETS_STANDARD);
      const recent = evs.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 25).map(e => ({
        student: (byStudent[e.studentId] && byStudent[e.studentId].name) || e.studentId,
        phase: e.phaseName, trip: e.tripNumber,
        duration: e.duration || null,
        notes: e.tripNotes || '',
        finalGrade: e.finalGrade, mif: e.overallMifStatus, date: fmtDate ? fmtDate(e.date) : e.date
      }));
      return {
        counts: {
          students: this.students.length,
          instructors: this.instructors.length,
          aircraft: this.aircraft.length,
          evaluations: evs.length,
          belowMIF: weak.length,
          meetsMIF: meets.length
        },
        students: Object.values(byStudent).map(s => ({ name: s.name, evals: s.evals, totalHours: Math.round(s.totalHours * 10) / 10 })),
        aircraft: (this.aircraft || []).map(a => a.name),
        mifPhases: (this.mifTables || []).map(t => t.phaseName).filter(Boolean),
        recentEvaluations: recent
      };
    },

    /* ---- announcements ---- */
    addAnnouncement() {
      this.openForm({
        title: 'Post announcement',
        fields: [
          { key: 'title', label: 'Title' },
          { key: 'message', label: 'Message', type: 'textarea' },
          { key: 'targetRole', label: 'Target (all / instructor / viewer)', value: 'all' }
        ],
        onOk: async (v) => {
          if (!v.title) return;
          await Store.addAnnouncement({
            title: v.title, message: v.message || '', targetRole: v.targetRole || 'all',
            senderName: this.user ? (this.user.displayName || this.user.email) : this.role,
            timestamp: Math.floor(Date.now() / 1000), fileName: null, fileUrl: null
          });
          this.toastMsg('Announcement posted');
        }
      });
    },
    deleteAnnouncement(a) { this.openConfirm({ title: 'Delete announcement', message: 'Delete "' + (a.title || '') + '"?', confirmText: 'Delete', onOk: async () => { await Store.deleteAnnouncement(a.id); } }); },

    /* ---- user management (admin only, mirror Android UserManagementActivity) ---- */
    async approveUser(u, role) { await Store.approveUser(u, role); this.toastMsg(u.name + ' → ' + role); },
    changeUserRole(u) {
      this.openForm({
        title: 'Change role for ' + u.name,
        fields: [{ key: 'role', label: 'Role (viewer / instructor / admin)', value: u.role || 'viewer' }],
        onOk: async (v) => {
          if (v.role && ['viewer', 'instructor', 'admin'].includes(v.role)) { await Store.updateUserRole(u, v.role); this.toastMsg('Role updated'); }
        }
      });
    },
    deleteUser(u) { this.openConfirm({ title: 'Remove user', message: 'Delete user ' + u.name + '? This removes their access.', confirmText: 'Delete', onOk: async () => { await Store.deleteUser(u); this.toastMsg('User removed'); } }); },
    filterAnnouncements(list) { return list.filter(a => a.targetRole === 'all' || a.targetRole === this.role || this.role === 'admin'); },

    /* ---- CSV export (mirrors Android CsvExporter) ---- */
    exportCSV() {
      const rows = [['Student', 'Aircraft', 'Phase', 'Trip', 'Date', 'Instructor', 'Duration(h)', 'FinalGrade', 'MIF Status', 'FlightYear', 'TripNotes', 'Maneuvers']];
      this.evalsSortedByDate.slice().reverse().forEach(e => {
        const maneuvers = (e.maneuverGrades || []).filter(m => m && m.studentGrade != null && m.studentGrade !== 0)
          .map(m => ({ name: m.name, req: m.requiredMif, grade: m.studentGrade, factor: m.factor }));
        rows.push([
          e.studentName || '', e.aircraftType || '', e.phaseName || '', e.tripNumber || '',
          this.fmt(e.date) || '', e.instructorName || '', e.duration || '',
          e.finalGrade != null ? e.finalGrade.toFixed(1) : '', e.overallMifStatus || '', e.flightYear || '',
          (e.tripNotes || '').replace(/[\n\r]+/g, ' '),
          JSON.stringify(maneuvers)
        ]);
      });
      const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
      const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'evaluations_' + (this.activeYearResolved || 'all') + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.logEvent('csv:export');
      this.toastMsg('Exported ' + (rows.length - 1) + ' filtered evaluations to CSV');
    },

    /* ---- CSV import (mirror of exportCSV) — audit item 11 ----
       Parses the export format, validates rows against known students/aircraft,
       shows a preview + error report, and (on confirm) bulk-saves to Firestore. */
    openImport() { this.importCsv = { open: true, text: '', parsed: null, error: '' }; },
    closeImport() { this.importCsv = { open: false, text: '', parsed: null, error: '' }; },
    // Re-parse the textarea whenever it changes (live validation/preview).
    parseImportCsv() {
      const raw = (this.importCsv.text || '').trim();
      if (!raw) { this.importCsv.parsed = null; this.importCsv.error = ''; return; }
      try {
        const lines = raw.split(String.fromCharCode(10)); // split on LF
        const rows = lines.map(r => r.split(','));
        // tolerate CRLF; drop fully-empty trailing rows
        while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
        if (rows.length < 2) { this.importCsv.error = 'Need a header row plus at least one data row.'; this.importCsv.parsed = null; return; }
        const header = rows[0].map(h => h.trim().toLowerCase());
        const idx = {};
        ['student', 'aircraft', 'phase', 'trip', 'date', 'instructor', 'duration(h)', 'finalgrade', 'mif status', 'flightyear', 'maneuvers'].forEach(h => { idx[h] = header.indexOf(h) });
        if (idx.student < 0 || idx.aircraft < 0 || idx.phase < 0 || idx.trip < 0) {
          this.importCsv.error = 'Header must include: Student, Aircraft, Phase, Trip (and ideally Date, Instructor, Duration(h), FinalGrade, MIF Status, FlightYear, Maneuvers).';
          this.importCsv.parsed = null; return;
        }
        const unq = (s) => (s || '').trim();
        const studentNames = new Set((this.students || []).map(s => s.name));
        const aircraftNames = new Set((this.aircraft || []).map(a => a.name));
        const evals = [], errors = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (r.length === 1 && !unq(r[0])) continue;
          const get = (h) => (idx[h] >= 0 ? unq(r[idx[h]]) : '');
          const studentName = get('student'), aircraftType = get('aircraft'), phaseName = get('phase'), tripNumber = get('trip');
          if (!studentName || !aircraftType || !phaseName || !tripNumber) { errors.push('Row ' + (i + 1) + ': missing Student/Aircraft/Phase/Trip.'); continue; }
          const student = (this.students || []).find(s => s.name === studentName);
          if (!student) { errors.push('Row ' + (i + 1) + ': unknown student "' + studentName + '" (add them first).'); }
          if (!aircraftNames.has(aircraftType)) { errors.push('Row ' + (i + 1) + ': unknown aircraft "' + aircraftType + '".'); }
          const dateStr = get('date');
          let dateSec = 0;
          if (dateStr) { const t = Date.parse(dateStr); dateSec = isNaN(t) ? 0 : Math.floor(t / 1000); }
          const fg = parseFloat(get('finalgrade'));
          const ev = {
            studentId: student ? student.id : '',
            studentName, aircraftType, phaseName, tripNumber,
            date: dateSec,
            instructorName: get('instructor'),
            duration: get('duration(h)'),
            finalGrade: isNaN(fg) ? 0 : fg,
            overallMifStatus: get('mif status') || '',
            flightYear: get('flightyear') || (dateSec ? this.getFlightYear(dateSec) : this.activeYearResolved),
            maneuverGrades: (() => {
              if (idx.maneuvers < 0) return [];
              try {
                const arr = JSON.parse(unq(r[idx.maneuvers]));
                return (Array.isArray(arr) ? arr : []).map(m => ({
                  name: m.name || '',
                  factor: m.factor != null ? Number(m.factor) : 1.0,
                  requiredMif: m.req != null ? Number(m.req) : 0,
                  studentGrade: m.grade != null ? Number(m.grade) : 0
                }));
              } catch (e) { return []; }
            })(),
            tripNotes: unq(r[header.indexOf('tripnotes') >= 0 ? header.indexOf('tripnotes') : (idx['mif status'] >= 0 ? idx['mif status'] + 1 : -1)]) || ''
          };
          // Detect a duplicate (same student+phase+trip) so the import overwrites instead of duping.
          const clash = this.evaluations.find(e => e.studentId === ev.studentId && e.phaseName === ev.phaseName && e.tripNumber === ev.tripNumber);
          if (clash) ev.id = clash.id;
          evals.push(ev);
        }
        this.importCsv.parsed = { evals, errors, total: evals.length, dupes: evals.filter(e => e.id).length };
        this.importCsv.error = '';
      } catch (e) {
        this.importCsv.error = 'Could not parse CSV: ' + (e.message || e);
        this.importCsv.parsed = null;
      }
    },
    async confirmImport() {
      const p = this.importCsv.parsed;
      if (!p || !p.evals.length) return;
      try {
        const n = await Store.bulkSaveEvaluations(p.evals);
        this.toastMsg('Imported ' + n + ' evaluation(s)');
        this.closeImport();
      } catch (e) {
        this.importCsv.error = 'Import failed: ' + (e && e.message ? e.message : e);
      }
    },

    /* ---- Print/PDF the currently filtered evaluation list (export) ---- */
    printEvalList() {
      const evs = this.evalsByStudentInYear; // grouped map studentId -> [eval]
      const esc = (s) => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const rows = [];
      Object.keys(evs).forEach(sid => evs[sid].forEach(e => {
        rows.push('<tr><td>' + esc(this.studentName(sid)) + '</td><td>' + esc(e.aircraftType) +
          '</td><td>' + esc(e.phaseName + ' ' + e.tripNumber) + '</td><td>' + esc(this.fmt(e.date)) +
          '</td><td>' + esc(e.instructorName || '') + '</td><td>' + (e.finalGrade != null ? Number(e.finalGrade).toFixed(1) : '-') +
          '</td><td>' + esc(e.overallMifStatus || '') + '</td></tr>');
      }));
      if (!rows.length) { this.toastMsg('No evaluations to print for the current filter'); return; }
      const win = window.open('', '_blank');
      if (!win) { this.toastMsg('Allow popups to print'); return; }
      win.document.write('<!doctype html><html><head><title>Evaluations ' + esc(this.activeYearResolved) + '</title><meta charset="utf-8">' +
        '<style>body{font-family:system-ui,Arial;padding:20px;color:#111}h1{font-size:18px;margin:0 0 4px}' +
        '.sub{color:#666;font-size:12px;margin-bottom:12px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}' +
        'th{background:#eef}@media print{button{display:none}}</style></head><body>' +
        '<h1>Evaluations — ' + esc(this.activeYearResolved) + '</h1>' +
        '<div class="sub">' + rows.length + ' evaluation(s) · filters: ' + esc(this.evStudent) + ' / ' + esc(this.evAircraft) + ' / ' + esc(this.evPhase) + '</div>' +
        '<table><thead><tr><th>Student</th><th>Aircraft</th><th>Trip</th><th>Date</th><th>Instructor</th><th>Final</th><th>MIF</th></tr></thead><tbody>' +
        rows.join('') + '</tbody></table><button onclick="window.print()" style="margin-top:16px;padding:10px 16px">Print / Save as PDF</button></body></html>');
      win.document.close();
    },

    /* ---- user preference: light / dark theme ---- */
    _applyTheme(t) {
      const root = document.documentElement;
      if (t === 'light') root.classList.add('light-theme');
      else root.classList.remove('light-theme');
    },
    toggleTheme() { this.theme = (this.theme === 'dark') ? 'light' : 'dark'; },
    // Apply the UI density preference as a root class (compact = tighter spacing).
    _applyDensity(t) {
      const root = document.documentElement;
      if (t === 'compact') root.classList.add('compact');
      else root.classList.remove('compact');
    },
    setDensity(t) { this.uiDensity = t; },

    /* ---- Full-dataset JSON backup / restore (offline disaster recovery) ----
       Exports the entire grading dataset (students, instructors, aircraft, MIF
       tables, evaluations, announcements) as a single JSON file. Restore
       re-imports it into Firestore via Store.importAll (users are excluded for
       safety). Useful for an offline copy or a clean re-seed after a bad import. */
    backupExport() {
      const ds = {
        app: 'student-grading-portal-web',
        version: 1,
        exportedAt: new Date().toISOString(),
        year: this.activeYearResolved,
        students: this.students, instructors: this.instructors, aircraft: this.aircraft,
        mifTables: this.mifTables, evaluations: this.evaluations, announcements: this.announcements
      };
      const blob = new Blob([JSON.stringify(ds, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'grading-backup_' + (this.activeYearResolved || 'all') + '_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.logEvent('backup:export');
      this.backup.msg = 'Exported ' + (this.evaluations.length + this.students.length + this.aircraft.length + this.mifTables.length) + ' records to JSON';
      this.backup.error = '';
      this.toastMsg('Backup exported');
    },
    backupImportFile(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          if (!data || typeof data !== 'object' || !Array.isArray(data.evaluations)) throw new Error('not a valid backup file');
          this._pendingBackup = data;
          this.openConfirm({
            title: 'Restore backup?',
            message: 'This will OVERWRITE the ' + (data.year || 'current') + ' dataset with ' +
              ((data.evaluations || []).length + (data.students || []).length) + ' records from the backup. ' +
              'Students, instructors, aircraft, MIF tables, evaluations and announcements will be replaced. ' +
              'User accounts are NOT changed. This cannot be undone — export a fresh backup first if unsure.',
            confirmText: 'Restore',
            onOk: async () => {
              this.backup.busy = true; this.backup.error = '';
              try {
                const n = await Store.importAll(this._pendingBackup);
                this.backup.msg = 'Restored ' + n + ' records';
                this.backup.error = '';
                this.toastMsg('Backup restored (' + n + ' records)');
                this.logEvent('backup:import');
              } catch (e) {
                this.backup.error = 'Restore failed: ' + (e && e.message ? e.message : e);
              } finally { this.backup.busy = false; this._pendingBackup = null; }
            }
          });
        } catch (e) {
          this.backup.error = 'Could not read backup: ' + (e && e.message ? e.message : e);
        }
      };
      reader.readAsText(file);
      try { ev.target.value = ''; } catch (e) {} // allow re-picking the same file
    },

    /* ---- clear device-local analytics + feedback (privacy) ---- */
    clearLocalData() {
      this.openConfirm({
        title: 'Clear local data?',
        message: 'This removes usage analytics and feedback stored on THIS device only (no server data is touched).',
        confirmText: 'Clear',
        onOk: () => {
          try { localStorage.removeItem('sgp.analytics'); localStorage.removeItem('sgp.feedback'); this.analytics = []; } catch (e) {}
          this.toastMsg('Local data cleared');
        }
      });
    },
    // Reflect the offline/online AI status in the header badge (audit item 13).
    _setAiBadge(status) { this.aiBadge = status; },

    /* ---- generic in-app dialog (replaces native prompt/confirm) — audit item 2 ---- */
    // Single text input dialog.
    openInput(opts) { this.dlg = { open: true, mode: 'input', title: opts.title || '', message: opts.message || '', label: opts.label || '', value: opts.value || '', fields: null, busy: false, confirmText: opts.confirmText || 'OK', pending: { type: 'input', onOk: opts.onOk } }; },
    // Multi-field form dialog (fields: [{key,label,value?,type?}]); onOk receives a values object.
    openForm(opts) { this.dlg = { open: true, mode: 'form', title: opts.title || '', message: '', label: '', value: '', fields: (opts.fields || []).map(f => ({ key: f.key, label: f.label, value: f.value != null ? f.value : '', type: f.type || 'text' })), busy: false, confirmText: opts.confirmText || 'Save', pending: { type: 'form', onOk: opts.onOk } }; },
    // Confirmation dialog (destructive actions).
    openConfirm(opts) { this.dlg = { open: true, mode: 'confirm', title: opts.title || 'Confirm', message: opts.message || '', label: '', value: '', fields: null, busy: false, confirmText: opts.confirmText || 'Confirm', pending: { type: 'confirm', onOk: opts.onOk } }; },
    dlgCancel() { this.dlg.open = false; this.dlg.pending = null; },
    async dlgConfirm() {
      const p = this.dlg.pending; if (!p) return;
      this.dlg.busy = true;
      try {
        if (p.type === 'input') {
          const v = (this.dlg.value || '').trim();
          if (!v) { this.dlg.busy = false; return; }
          if (p.onOk) await p.onOk(v);
        } else if (p.type === 'form') {
          const vals = {};
          (this.dlg.fields || []).forEach(f => { vals[f.key] = (f.type === 'number' ? f.value : (f.value || '').trim()); });
          if (p.onOk) await p.onOk(vals);
        } else if (p.type === 'confirm') {
          if (p.onOk) await p.onOk();
        }
        this.dlg.open = false; this.dlg.pending = null;
      } catch (e) {
        this.toastMsg('Error: ' + (e && e.message ? e.message : e));
      } finally { this.dlg.busy = false; }
    },
    // Display label for the MIF status (audit item 6 — clearer wording, data unchanged).
    statusLabel(s) {
      if (s === STATUS_MEETS_STANDARD) return 'Meets MIF';
      if (s === STATUS_BELOW_STANDARD) return 'Below MIF';
      return s || 'Pending';
    },

    /* ---- lightweight local usage analytics (audit item 9) ----
       Privacy-respecting: only anonymous *event counts* are kept in localStorage
       (no PII, no network call, no Firebase write). Surfaces "what got used" in
       the dashboard activity card. Firestore could be swapped in later behind an
       admin gate; for now this stays 100% client-side. */
    loadAnalytics() {
      try { this.analytics = JSON.parse(localStorage.getItem('sgp.analytics') || '[]'); }
      catch (e) { this.analytics = []; }
    },
    logEvent(type, detail) {
      try {
        const ev = { t: type, at: Date.now(), d: detail || '' };
        const all = JSON.parse(localStorage.getItem('sgp.analytics') || '[]');
        all.push(ev);
        // keep the last 200 events so storage stays tiny
        if (all.length > 200) all.splice(0, all.length - 200);
        localStorage.setItem('sgp.analytics', JSON.stringify(all));
        this.analytics = all;
      } catch (e) { /* storage full / disabled — non-fatal */ }
    },
    // Human-readable recent-activity summary for the dashboard card.
    recentActivity() {
      const now = Date.now();
      const dayMs = 86400000;
      const since = now - 14 * dayMs;
      const recent = (this.analytics || []).filter(e => e.at >= since);
      const counts = {};
      recent.forEach(e => { counts[e.t] = (counts[e.t] || 0) + 1; });
      const labels = {
        'eval:saved': 'Evaluations saved', 'tab:analytics': 'Analytics opened',
        'tab:ai': 'AI debriefs opened', 'feedback:sent': 'Feedback sent',
        'ai:used': 'AI debriefs run', 'csv:export': 'CSV exports'
      };
      return Object.keys(counts).map(t => ({ label: labels[t] || t, n: counts[t] }))
        .sort((a, b) => b.n - a.n).slice(0, 5);
    },

    /* ---- in-app feedback channel (audit item 9) ---- */
    openFeedback() { this.feedback = { open: true, text: '', role: this.role || '', busy: false, done: false, error: '' }; },
    closeFeedback() { this.feedback = { open: false, text: '', role: '', busy: false, done: false, error: '' }; },
    async submitFeedback() {
      const msg = (this.feedback.text || '').trim();
      if (!msg) { this.feedback.error = 'Please type a short note first.'; return; }
      this.feedback.busy = true; this.feedback.error = '';
      try {
        // Stored locally only (anonymous, no account link) for now — the same
        // shape can be POSTed to Firestore/feedback later without UI changes.
        const entry = { at: Date.now(), role: this.feedback.role || 'unknown', text: msg };
        const all = JSON.parse(localStorage.getItem('sgp.feedback') || '[]');
        all.push(entry);
        localStorage.setItem('sgp.feedback', JSON.stringify(all));
        this.logEvent('feedback:sent');
        this.feedback.done = true;
        setTimeout(() => { if (this.feedback.done) this.closeFeedback(); }, 1800);
      } catch (e) {
        this.feedback.error = 'Could not send feedback: ' + (e && e.message ? e.message : e);
      } finally { this.feedback.busy = false; }
    },

    /* ---- analytics drill-down (audit item 10) ----
       Expand a weak-maneuver row to reveal that maneuver's own trend + status. */
    toggleWeak(key) { this.weakExpanded = { ...this.weakExpanded, [key]: !this.weakExpanded[key] }; },
    maneuverAvg(studentId, name) {
      const evs = (this.evaluations || []).filter(e => e.studentId === studentId);
      let sum = 0, w = 0;
      evs.forEach(e => (e.maneuverGrades || []).forEach(m => {
        if (m.name === name && m.factor) { sum += (m.studentGrade || 0) * m.factor; w += m.factor; }
      }));
      return w ? (sum / w).toFixed(1) : '—';
    },
    // Per-maneuver SVG trend (same honest-range logic as the student chart).
    maneuverTrendChart(studentId, name, w = 240, h = 50) {
      const evs = (this.evaluations || [])
        .filter(e => e.studentId === studentId)
        .slice().sort((a, b) => (a.date || 0) - (b.date || 0));
      const pts = [];
      evs.forEach(e => (e.maneuverGrades || []).forEach(m => { if (m.name === name) pts.push(m.studentGrade || 0); }));
      if (pts.length < 2) return null;
      let min = Math.min(...pts), max = Math.max(...pts);
      if (min === max) { min -= 5; max += 5; } else { const pad = (max - min) * 0.15; min -= pad; max += pad; }
      const span = (max - min) || 1;
      const step = w / (pts.length - 1);
      const xy = pts.map((v, i) => [i * step, h - ((v - min) / span) * (h - 8) - 4]);
      const path = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = path + ` L${w} ${h} L0 ${h} Z`;
      return { path, area, w, h, last: pts[pts.length - 1] };
    },

    // Readiness verdict label for the Class Readiness board (item 9 reuse).
    readinessLabel(r) {
      return ({
        READY: 'Ready', RECOVERING: 'Recovering', REMEDIAL: 'Remedial', INSUFFICIENT_DATA: 'New'
      })[r] || r;
    },

    /* ---- AI feedback ---- */
    copyAI() {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(this.aiResult).then(() => this.toastMsg('Copied to clipboard')).catch(() => {});
      else this.toastMsg('Copy not supported here');
    },

    /* ---- helpers ---- */
    fmt(sec) { return fmtDate(sec); },
    fmtDateTime(sec) { if (!sec) return '—'; const d = new Date(sec * 1000); return d.toISOString().slice(0, 10); },
    // parse a duration string (Android "HH:MM" or legacy decimal "1.5") into decimal hours
    parseHours(str) { if (str == null) return 0; const s = String(str); if (s.includes(':')) { const p = s.split(':'); return (parseInt(p[0], 10) || 0) + (parseInt(p[1], 10) || 0) / 60; } return parseFloat(s) || 0; },
    gradeColor(g) { return g >= 85 ? 'good' : g >= 70 ? 'ok' : 'bad'; },
    statusColor(s) { return s === STATUS_MEETS_STANDARD ? 'good' : s === STATUS_BELOW_STANDARD ? 'bad' : 'pending'; },
    // descriptive labels for the 1-4 grading scale (replaces bare numbers)
    gradeLabel(n) { return ({ 1: '1 · Needs work', 2: '2 · Below', 3: '3 · Good', 4: '4 · Excellent' })[n] || ''; },
    // class for a grade button: on (selected) + meets/below vs required MIF
    gradeBtnClass(m, n) {
      const cls = {};
      if (m.studentGrade === n) {
        cls.on = true;
        cls.meets = n >= (m.requiredMif || 0);
        cls.below = n < (m.requiredMif || 0);
      }
      return cls;
    },
    // tap a number to select (highlight); tap again to clear it
    toggleGrade(m, n) { m.studentGrade = (m.studentGrade === n) ? 0 : n; },

    // school-year from a date: Sep->Jul belongs to that start year (e.g. 2025-2026)
    getFlightYear(sec) {
      const d = new Date((sec || Date.now() / 1000) * 1000);
      const y = d.getFullYear();
      const m = d.getMonth(); // 0=Jan, 6=July
      // Android YearUtils: flight year starts July 1 (e.g. Jul 2025 -> Jun 2026 = "2025-2026")
      const start = m >= 6 ? y : y - 1;
      return start + '-' + (start + 1);
    },
    onEvalDateChange() {
      const sec = Math.floor(Date.parse(this.evalForm.date) / 1000);
      if (!isNaN(sec)) this.evalForm.flightYear = this.getFlightYear(sec);
    },
    onDurationChange() { this.evalForm.duration = (this.durationH || '00') + ':' + (this.durationM || '00'); },
    // SVG line chart of a student's grade trend (mirrors Android MPAndroidChart). Returns {path, area, w, h}.
    // Uses the ACTUAL grade range with light padding (not a forced 60-100 window) so the curve is honest:
    // a student scoring 70-80 won't look like it's spiking across the full scale, and sub-60 grades won't clip.
    trendChart(sid, w = 240, h = 60) {
      const evs = this.evaluations.filter(e => e.studentId === sid).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
      if (!evs.length) return null;
      const pts = evs.map(e => e.finalGrade || 0);
      let min = Math.min(...pts), max = Math.max(...pts);
      if (min === max) { min -= 5; max += 5; }       // flat line -> give it vertical room
      else { const pad = (max - min) * 0.15; min -= pad; max += pad; }  // pad so endpoints aren't on the edges
      const span = (max - min) || 1;
      const step = pts.length > 1 ? w / (pts.length - 1) : 0;
      const xy = pts.map((v, i) => [pts.length > 1 ? i * step : w / 2, h - ((v - min) / span) * (h - 8) - 4]);
      const path = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = path + ` L${w} ${h} L0 ${h} Z`;
      return { path, area, w, h, last: pts[pts.length - 1] };
    },
    // print-friendly per-student report -> window.print() (PDF via browser)
    async printStudent(s) {
      if (!s) return;
      const y = this.activeYearResolved;   // school-year scope (defaults to most recent)
      const evals = this.evaluations.filter(e => e.studentId === s.id && (!y || e.flightYear === y)).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
      const perf = buildPerformance(s, evals);
      perf.yearScope = y;   // so the AI debrief is explicitly year-scoped
      // Live AI debrief only — never the offline template.
      let analysis = '';
      try {
        const cfg = await getAIConfig();
        if (cfg) analysis = await callAIModel(perf, cfg);
      } catch (e) {
        analysis = '⚠️ Live AI debrief unavailable (' + (e.message || e) + '). Open the student profile and re-run AI Feedback to retry.';
      }
      const win = window.open('', '_blank');
      if (!win) { this.toastMsg('Allow popups to print the report'); return; }
      const rows = evals.map(e => `<tr><td>${e.aircraftType} · ${e.phaseName} ${e.tripNumber}</td><td>${this.fmt(e.date)}</td><td>${e.finalGrade != null ? e.finalGrade.toFixed(1) : '-'}</td><td>${e.overallMifStatus || ''}</td></tr>`).join('');
      win.document.write(`<!doctype html><html><head><title>${s.name} — Report</title>
        <style>body{font-family:system-ui,Arial;padding:24px;color:#111}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:13px}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px}@media print{button{display:none}}</style>
        <h1>${s.name}</h1><div>School Year: ${y || 'all'} · Avg ${perf.overallScore ? perf.overallScore.toFixed(1) : '-'} · Trend ${perf.trend} · Readiness ${perf.readiness} · ${evals.length} trips</div>
        <table><thead><tr><th>Trip</th><th>Date</th><th>Final</th><th>MIF</th></tr></thead><tbody>${rows}</tbody></table>
        <h3 style="margin-top:18px">AI Performance Analysis</h3><pre>${analysis.replace(/</g, '&lt;')}</pre>
        <button onclick="window.print()" style="margin-top:16px;padding:10px 16px">Print / Save as PDF</button></body></html>`);
      win.document.close();
    },
    // Print a SINGLE evaluation as a PDF that mirrors the original Android Evaluation Details screen.
    // Accepts a saved evaluation OR the live evalForm (so the New Evaluation screen can preview/print too).
    printEval(ev) {
      if (!ev) return;
      const win = window.open('', '_blank');
      if (!win) { this.toastMsg('Allow popups to print the evaluation'); return; }
      const INDIGO = '#1A237E', LIGHT = '#E8EAF6', DIV = '#E0E0E0';
      const esc = s => (s == null ? '' : String(s)).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const dateStr = this.fmt(ev.date);
      const dur = ev.duration || '';
      const grade = (ev.finalGrade != null) ? Number(ev.finalGrade).toFixed(1) : '-';
      const status = ev.overallMifStatus || '-';
      const trip = (ev.phaseName || '') + ' ' + (ev.tripNumber || '');
      const notes = (ev.tripNotes && ev.tripNotes.trim()) ? esc(ev.tripNotes) : 'No notes provided.';
      const mg = (ev.maneuverGrades || []).map(m => `
        <div style="display:flex;align-items:center;padding:12px 16px;background:#FFFFFF;border-bottom:1px solid #EEE">
          <div style="flex:6;color:#212121;font-size:14px">${esc(m.name)}</div>
          <div style="flex:2;text-align:center;color:#757575;font-size:14px">${m.requiredMif != null ? m.requiredMif : ''}</div>
          <div style="flex:2;text-align:center;font-weight:bold;font-size:14px">${m.studentGrade != null ? m.studentGrade : ''}</div>
        </div>`).join('');
      const rows = (ev.maneuverGrades && ev.maneuverGrades.length) ? mg
        : `<div style="padding:12px 16px;color:#757575">No maneuver grades recorded.</div>`;
      win.document.write(`<!doctype html><html><head><title>${esc(ev.studentName || 'Evaluation')} — Evaluation</title>
        <meta charset="utf-8">
        <style>
          *{box-sizing:border-box} body{margin:0;font-family:system-ui,Arial,sans-serif;background:#F5F7FA;color:#111}
          .bar{background:${INDIGO};color:#fff;padding:14px 18px;font-size:18px;font-weight:600}
          .wrap{padding:16px}
          .card{background:#fff;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.12);padding:16px;margin-bottom:16px}
          .name{color:${INDIGO};font-size:22px;font-weight:700}
          .trip{font-size:16px;margin-top:2px}
          .row{display:flex;margin-top:4px}
          .row .lbl{flex:1;font-size:14px}
          .row .dur{font-size:14px}
          .ins{font-size:14px;font-style:italic;margin-top:4px}
          .hr{height:1px;background:${DIV};margin:12px 0}
          .gstats{display:flex}
          .gstats > div{flex:1}
          .gstats .k{font-size:12px}
          .gstats .v{font-size:24px;font-weight:700;color:${INDIGO}}
          .gstats .v2{font-size:16px;font-weight:700}
          .sec{color:${INDIGO};font-size:14px;font-weight:700;margin-bottom:8px}
          .notes{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:16px;color:#424242;font-size:14px;margin-bottom:16px;white-space:pre-wrap}
          .thead{display:flex;padding:8px 16px;background:${LIGHT};font-weight:700;color:${INDIGO};font-size:12px}
          .thead > div:nth-child(1){flex:6} .thead > div:nth-child(2){flex:2;text-align:center} .thead > div:nth-child(3){flex:2;text-align:center}
          .sheet{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden}
          .fab{position:fixed;right:16px;bottom:16px;background:${INDIGO};color:#fff;border:none;padding:14px 20px;border-radius:30px;font-size:15px;cursor:pointer;box-shadow:0 3px 8px rgba(0,0,0,.3)}
          @media print{.bar{position:static}.fab{display:none}body{background:#fff}}
        </style></head>
        <body>
          <div class="bar">Evaluation Details</div>
          <div class="wrap">
            <div class="card">
              <div class="name">${esc(ev.studentName || 'Student Name')}</div>
              <div class="trip">${esc(trip)}</div>
              <div class="row"><div class="lbl">Date: ${esc(dateStr)}</div><div class="dur">Duration: ${esc(dur)} h</div></div>
              <div class="ins">Instructor: ${esc(ev.instructorName || '-')}</div>
              <div class="hr"></div>
              <div class="gstats">
                <div><div class="k">Final Grade</div><div class="v">${grade}</div></div>
                <div><div class="k">Status</div><div class="v2">${esc(status)}</div></div>
              </div>
            </div>
            <div class="sec">INSTRUCTOR NOTES</div>
            <div class="notes">${notes}</div>
            <div class="thead"><div>MANEUVER</div><div>MIF</div><div>GRADE</div></div>
            <div class="sheet">${rows}</div>
          </div>
          <button class="fab" onclick="window.print()">Print PDF</button>
        </body></html>`);
      win.document.close();
    },
  },
  mounted() {
    // Restore the saved theme preference (default dark) and apply it.
    try { const t = localStorage.getItem('sgp.theme'); if (t === 'light' || t === 'dark') this.theme = t; } catch (e) {}
    this._applyTheme(this.theme);
    // Restore the saved density preference (default comfortable) and apply it.
    try { const d = localStorage.getItem('sgp.density'); if (d === 'compact' || d === 'comfortable') this.uiDensity = d; } catch (e) {}
    this._applyDensity(this.uiDensity);
    // Load the rolling local usage-analytics log (audit item 9).
    this.loadAnalytics();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=65').catch(() => {});
    // Warm the RAG index on load so the AI tab can show live status immediately.
    // Also drive the header AI badge (audit item 13): reflect live vs offline-template.
    // RAG index is loaded lazily (dynamic import in store.getRag) only when a
    // debrief runs. We just reflect 'checking' here so the UI doesn't block.
    this.ragReady = null;
    this._setAiBadge('checking');
    if (this.fbReady) {
      // Seed current user immediately in case the session is already restored
      // before the onAuthStateChanged listener attaches.
      if (getCurrentUser()) this.onUser(getCurrentUser());
      Auth.onUser(u => this.onUser(u));
    }
  },
});

function blankEval() {
  return {
    id: '', aircraftType: '', studentId: '', instructorName: '',
    phaseName: '', tripNumber: '', date: new Date().toISOString().slice(0, 10),
    flightYear: '2025-2026', duration: '', tripNotes: '', maneuverGrades: []
  };
}

// NOTE: mount is performed by src/main.js after Vue + Firebase + RAG are wired.
// Expose for debugging/automation.
if (typeof window !== 'undefined') window.__app = app;
