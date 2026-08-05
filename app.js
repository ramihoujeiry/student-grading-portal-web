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
      students: [], instructors: [], aircraft: [], mifTables: [], evaluations: [], announcements: [],

      // ui
      evalForm: blankEval(),
      showEvalModal: false,
      selectedEval: null,    // evaluation detail
      selectedStudent: null, // student profile
      aiForStudent: null,    // student id for AI on profile
      activeYear: '',        // school-year filter
      DURATIONS: [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0], // duration picker presets (h)
      toast: '',
      aiStudentId: '', aiResult: '', aiLoading: false
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
    evalPreview() {
      const mg = (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0);
      if (!mg.length) return { finalGrade: null, status: STATUS_PENDING, failCount: 0 };
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      let fail = 0;
      (this.evalForm.maneuverGrades || []).forEach(m => { if (m.studentGrade != null && m.requiredMif != null && m.studentGrade < m.requiredMif) fail++; });
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
      const map = {};
      this.evaluations.filter(e => e.flightYear === y).forEach(e => { (map[e.studentId] = map[e.studentId] || []).push(e); });
      return map;
    },
    isPending() { return this.role === 'pending'; },

    // per-student analytics for the Analytics tab (reuses buildPerformance from store.js)
    perStudentAnalytics() {
      const out = [];
      const byStudent = {};
      this.evaluations.forEach(e => { (byStudent[e.studentId] = byStudent[e.studentId] || []).push(e); });
      this.students.forEach(s => {
        const evals = (byStudent[s.id] || []).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
        const perf = buildPerformance(s, evals);
        out.push({
          id: s.id, name: s.name, active: s.active,
          avg: perf.overallScore ? perf.overallScore.toFixed(1) : '-',
          trend: perf.trend, trips: perf.evaluationCount,
          hours: evals.reduce((sum, e) => sum + (parseFloat(e.duration) || 0), 0),
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
    }
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
      this.evalForm.aircraftType = this.aircraft[0] ? this.aircraft[0].name : '';
      this.evalForm.studentId = this.students[0] ? this.students[0].id : '';
      this.evalForm.instructorName = (this.user && this.user.displayName) || (this.instructors[0] ? this.instructors[0].name : '');
      this.evalForm.duration = '1.0';
      this.onEvalDateChange(); // auto flight year from date
      this.showEvalModal = true;
      this.loadManeuversForForm();
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
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      const student = this.students.find(s => s.id === this.evalForm.studentId);
      const dateSec = Math.floor(Date.parse(this.evalForm.date) / 1000) || Math.floor(Date.now() / 1000);
      const ev = {
        id: this.evalForm.id || '',
        aircraftType: this.evalForm.aircraftType,
        studentId: this.evalForm.studentId,
        studentName: student ? student.name : '',
        instructorName: this.evalForm.instructorName,
        phaseName: this.evalForm.phaseName,
        tripNumber: this.evalForm.tripNumber,
        date: dateSec,
        flightYear: this.getFlightYear(dateSec), // auto from date
        duration: this.evalForm.duration,
        finalGrade: fg || 0,
        overallMifStatus: st,
        tripNotes: this.evalForm.tripNotes,
        maneuverGrades: (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0)
          .map(m => ({ name: m.name, factor: m.factor, requiredMif: m.requiredMif, studentGrade: m.studentGrade }))
      };
      await Store.saveEvaluation(ev);
      this.showEvalModal = false;
      this.toastMsg('Evaluation saved');
    },
    async deleteEval(e) { if (confirm('Delete this evaluation?')) await Store.deleteEvaluation(e.id); },
    studentName(id) { const s = this.students.find(x => x.id === id); return s ? s.name : '?'; },

    /* ---- detail views ---- */
    openEval(e) { this.selectedEval = e; },
    openStudent(s) { this.selectedStudent = s; this.aiForStudent = null; },
    closeDetail() { this.selectedEval = null; this.selectedStudent = null; this.aiForStudent = null; },
    evalForStudent(sid) { return this.evaluations.filter(e => e.studentId === sid).slice().sort((a, b) => (b.date || 0) - (a.date || 0)); },

    /* ---- AI feedback for a student profile ---- */
    runAIForStudent() {
      if (!this.selectedStudent) return;
      this.aiForStudent = this.selectedStudent.id;
      this.aiLoading = true;
      const student = this.selectedStudent;
      const evals = this.evaluations.filter(e => e.studentId === student.id);
      setTimeout(() => {
        const data = buildPerformance(student, evals);
        this.aiResult = generateFeedback(data);
        this.aiLoading = false;
      }, 30);
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
      setTimeout(() => {
        const data = buildPerformance(student, evals);
        this.aiResult = generateFeedback(data);
        this.aiLoading = false;
      }, 30);
    },
    copyAI() {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(this.aiResult).then(() => this.toastMsg('Copied to clipboard')).catch(() => {});
      else this.toastMsg('Copy not supported here');
    },

    /* ---- helpers ---- */
    fmt(sec) { return fmtDate(sec); },
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
    // school-year from a date: Sep->Jul belongs to that start year (e.g. 2025-2026)
    getFlightYear(sec) {
      const d = new Date((sec || Date.now() / 1000) * 1000);
      const y = d.getFullYear();
      const m = d.getMonth(); // 0=Jan
      const start = m >= 8 ? y : y - 1; // Sep(8)..Dec => start year; Jan..Aug => previous year
      return start + '-' + (start + 1);
    },
    onEvalDateChange() {
      const sec = Math.floor(Date.parse(this.evalForm.date) / 1000);
      if (!isNaN(sec)) this.evalForm.flightYear = this.getFlightYear(sec);
    }
  },
  mounted() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
    phaseName: 'CONTACT', tripNumber: 'S1', date: new Date().toISOString().slice(0, 10),
    flightYear: '2025-2026', duration: '', tripNotes: '', maneuverGrades: []
  };
}

app.mount('#app');
// expose for debugging/automation
window.__app = app;
