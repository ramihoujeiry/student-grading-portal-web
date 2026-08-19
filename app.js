/* =========================================================================
 * app.js — Vue 3 SPA for the Student Grading Portal web app (Firebase-backed).
 * Auth-gated. Mirrors the Android app's role model (admin/instructor/viewer/pending).
 * ========================================================================= */

const { createApp } = Vue;

const app = createApp({
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
      toast: '',
      aiStudentId: '', aiResult: '', aiLoading: false,
      aiRagStatus: '', // '' | 'ok' (manuals cited) | 'failed' (index unreachable)
      ragReady: null,  // null = checking, true = index loaded, false = failed (set on mount)
      aiSingleResult: '', aiSingleLoading: false,
      // Ask-Data (private instructor copilot over grading data)
      askQuery: '', askResult: '', askLoading: false
    };
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

    // User management (admin only) — mirror Android UserManagementActivity
    pendingUsers() { return this.users.filter(u => (u.role || 'pending') === 'pending'); },
    allUsers() { return this.users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')); }
  },
  methods: {
    setTab(t) { this.tab = t; },
    toastMsg(m) { this.toast = m; setTimeout(() => { if (this.toast === m) this.toast = ''; }, 2200); },

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
    async addStudent() { const n = prompt('Student name:'); if (n) { await Store.addStudent(n); this.toastMsg('Student added'); } },
    async toggleStudentActive(s) { await Store.setStudentActive(s.id, !s.active); },
    async deleteStudent(s) { if (confirm('Delete ' + s.name + '?')) await Store.deleteStudent(s.id); },

    /* ---- instructors ---- */
    async addInstructor() { const n = prompt('Instructor name:'); if (n) { await Store.addInstructor(n); this.toastMsg('Instructor added'); } },
    async toggleInstructorActive(i) { await Store.setInstructorActive(i.id, !i.active); },
    async deleteInstructor(i) { if (confirm('Delete ' + i.name + '?')) await Store.deleteInstructor(i.id); },

    /* ---- aircraft ---- */
    async addAircraft() { const n = prompt('Aircraft type (e.g. R44-2):'); if (n) { await Store.addAircraft(n); this.toastMsg('Aircraft added'); } },
    async deleteAircraft(a) { if (confirm('Delete ' + a.name + '?')) await Store.deleteAircraft(a.id); },

    /* ---- MIF tables ---- */
    async addMifTable() {
      const aircraftType = prompt('Aircraft type (must match an added aircraft):', 'R44-2');
      const phaseName = prompt('Phase name (e.g. CONTACT):', 'CONTACT');
      if (!aircraftType || !phaseName) return;
      const stagesStr = prompt('Stages (comma separated, e.g. S1, S2, S3):', 'S1, S2, S3');
      const stages = stagesStr ? stagesStr.split(',').map(s => s.trim()).filter(Boolean) : ['S1'];
      await Store.addMifTable(aircraftType, phaseName, stages);
      this.toastMsg('MIF table added');
    },
    async addManeuver(t) {
      const name = prompt('Maneuver name:'); if (!name) return;
      const factor = parseFloat(prompt('Weight factor:', '1.0')) || 1.0;
      const stageMifs = {};
      t.stages.forEach(st => { const v = parseInt(prompt('Required MIF for ' + st + ' (0 = not graded this stage):', '2'), 10); stageMifs[st] = isNaN(v) ? 2 : v; });
      await Store.addManeuver(t.id, { name, factor, stageMifs });
    },
    async deleteManeuver(t, idx) { await Store.deleteManeuver(t.id, idx); },
    async deleteMifTable(t) { if (confirm('Delete table ' + t.phaseName + '?')) await Store.deleteMifTable(t.id); },

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
      if (t) {
        this.evalForm.maneuverGrades = t.maneuvers.map(m => ({
          name: m.name, factor: m.factor,
          requiredMif: m.stageMifs[this.evalForm.tripNumber] != null ? m.stageMifs[this.evalForm.tripNumber] : 2,
          studentGrade: 0
        }));
      } else this.evalForm.maneuverGrades = [];
    },
    onEvalContextChange() { this.loadManeuversForForm(); },
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
        this.toastMsg('Evaluation saved');
      } catch (err) {
        console.error('saveEval', err);
        this.toastMsg('Could not save evaluation: ' + (err && err.message ? err.message : 'unknown error'));
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
    async deleteEval(e) { if (confirm('Delete this evaluation?')) await Store.deleteEvaluation(e.id); },
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
      const evals = this.evaluations.filter(e => e.studentId === student.id);
      const data = buildPerformance(student, evals);
      // Warm the RAG index so status() is accurate, then call the model.
      let ragOk = false;
      try { if (typeof FaaRag !== 'undefined') { await FaaRag.loadIndex(); ragOk = (FaaRag.status() === 'ok'); } } catch (e) {}
      this.aiRagStatus = ragOk ? 'ok' : 'failed';
      // Try the online model first; fall back to the offline template on any problem.
      try {
        const cfg = await getAIConfig();
        if (cfg) {
          const text = await callAIModel(data, cfg);
          this.aiResult = text;
          this.aiLoading = false;
          return;
        }
      } catch (e) {
        console.warn('AI model call failed, using offline template:', e);
      }
      this.aiResult = await generateFeedback(data);
      this.aiLoading = false;
    },

    /* ---- AI debrief for a SINGLE evaluation (opened from the Evaluations list) ---- */
    async runAISingleEval() {
      const ev = this.selectedEval;
      if (!ev) { this.toastMsg('Open an evaluation first'); return; }
      this.aiSingleLoading = true;
      this.aiSingleResult = '';
      const data = buildSingleEvalData(ev);
      try {
        const cfg = await getAIConfig();
        if (cfg) {
          const prompt = await buildSingleEvalPrompt(data);
          // callAIModel expects {system,user}; reuse by temporarily swapping the prompt builder
          const text = await callAIModelWithPrompt(prompt, cfg);
          this.aiSingleResult = text;
          this.aiSingleLoading = false;
          return;
        }
      } catch (e) {
        console.warn('Single-eval AI call failed, using offline template:', e);
      }
      this.aiSingleResult = generateSingleEvalFeedback(data);
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
          'If the data does not contain the answer, say so plainly. Keep replies concise and practical. ' +
          'Do not invent students, grades, or maneuvers. If asked to list or rank, use tables or bullet lists.';
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
      const byStudent = {};
      this.students.forEach(s => { byStudent[s.id] = { name: s.name, evals: 0 }; });
      evs.forEach(e => { if (byStudent[e.studentId]) byStudent[e.studentId].evals++; });
      const weak = evs.filter(e => e.overallMifStatus === STATUS_BELOW_STANDARD);
      const meets = evs.filter(e => e.overallMifStatus === STATUS_MEETS_STANDARD);
      const recent = evs.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 25).map(e => ({
        student: (byStudent[e.studentId] && byStudent[e.studentId].name) || e.studentId,
        phase: e.phaseName, trip: e.tripNumber,
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
        students: Object.values(byStudent),
        aircraft: (this.aircraft || []).map(a => a.name),
        mifPhases: (this.mifTables || []).map(t => t.phaseName).filter(Boolean),
        recentEvaluations: recent
      };
    },

    /* ---- announcements ---- */
    async addAnnouncement() {
      const title = prompt('Announcement title:'); if (!title) return;
      const message = prompt('Message:') || '';
      const targetRole = prompt('Target (all / instructor / viewer):', 'all') || 'all';
      await Store.addAnnouncement({
        title, message, targetRole, senderName: this.user ? (this.user.displayName || this.user.email) : this.role,
        timestamp: Math.floor(Date.now() / 1000), fileName: null, fileUrl: null
      });
      this.toastMsg('Announcement posted');
    },
    async deleteAnnouncement(a) { if (confirm('Delete announcement?')) await Store.deleteAnnouncement(a.id); },

    /* ---- user management (admin only, mirror Android UserManagementActivity) ---- */
    async approveUser(u, role) { await Store.approveUser(u, role); this.toastMsg(u.name + ' → ' + role); },
    async changeUserRole(u) {
      const role = prompt('New role for ' + u.name + ' (viewer / instructor / admin):', u.role);
      if (role && ['viewer', 'instructor', 'admin'].includes(role)) { await Store.updateUserRole(u, role); this.toastMsg('Role updated'); }
    },
    async deleteUser(u) { if (confirm('Delete user ' + u.name + '? This removes their access.')) { await Store.deleteUser(u); this.toastMsg('User removed'); } },
    filterAnnouncements(list) { return list.filter(a => a.targetRole === 'all' || a.targetRole === this.role || this.role === 'admin'); },

    /* ---- CSV export (mirrors Android CsvExporter) ---- */
    exportCSV() {
      const rows = [['Student', 'Aircraft', 'Phase', 'Trip', 'Date', 'Instructor', 'Duration(h)', 'FinalGrade', 'MIF Status', 'FlightYear', 'TripNotes']];
      this.evaluations.slice().sort((a, b) => (a.date || 0) - (b.date || 0)).forEach(e => {
        rows.push([
          e.studentName || '', e.aircraftType || '', e.phaseName || '', e.tripNumber || '',
          this.fmt(e.date) || '', e.instructorName || '', e.duration || '',
          e.finalGrade != null ? e.finalGrade.toFixed(1) : '', e.overallMifStatus || '', e.flightYear || '',
          (e.tripNotes || '').replace(/[\n\r]+/g, ' ')
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
      this.toastMsg('Exported ' + (rows.length - 1) + ' evaluations to CSV');
    },

    /* ---- AI feedback ---- */
    runAI() {
      if (!this.aiStudentId) { this.toastMsg('Pick a student first'); return; }
      this.aiLoading = true;
      const student = this.students.find(s => s.id === this.aiStudentId);
      const evals = this.evaluations.filter(e => e.studentId === this.aiStudentId);
      setTimeout(async () => {
        const data = buildPerformance(student, evals);
        this.aiResult = await generateFeedback(data);
        this.aiLoading = false;
      }, 30);
    },
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
      const evals = this.evaluations.filter(e => e.studentId === s.id).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
      const perf = buildPerformance(s, evals);
      const analysis = generateFeedback(perf);
      const win = window.open('', '_blank');
      if (!win) { this.toastMsg('Allow popups to print the report'); return; }
      const rows = evals.map(e => `<tr><td>${e.aircraftType} · ${e.phaseName} ${e.tripNumber}</td><td>${this.fmt(e.date)}</td><td>${e.finalGrade != null ? e.finalGrade.toFixed(1) : '-'}</td><td>${e.overallMifStatus || ''}</td></tr>`).join('');
      win.document.write(`<!doctype html><html><head><title>${s.name} — Report</title>
        <style>body{font-family:system-ui,Arial;padding:24px;color:#111}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:13px}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px}@media print{button{display:none}}</style>
        </head><body><h1>${s.name}</h1><div>Avg ${perf.overallScore ? perf.overallScore.toFixed(1) : '-'} · Trend ${perf.trend} · Readiness ${perf.readiness} · ${evals.length} trips</div>
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=49').catch(() => {});
    // Warm the RAG index on load so the AI tab can show live status immediately.
    if (typeof FaaRag !== 'undefined') {
      FaaRag.loadIndex().then(() => { this.ragReady = (FaaRag.status() === 'ok'); })
        .catch(() => { this.ragReady = false; });
    } else {
      this.ragReady = false;
    }
    if (this.fbReady) {
      // Seed current user immediately in case the session is already restored
      // before the onAuthStateChanged listener attaches.
      if (auth && auth.currentUser) this.onUser(auth.currentUser);
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

app.mount('#app');
// expose for debugging/automation
window.__app = app;
