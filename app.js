/* =========================================================================
 * app.js — Vue 3 client-side SPA for the Student Grading Portal web PWA.
 * No build step, no backend. Talks to store.js (localStorage).
 * ========================================================================= */

const { createApp } = Vue;

const app = createApp({
  data() {
    return {
      tab: 'dashboard',
      role: 'admin',            // local role switcher (admin | instructor | viewer)
      db: DB,                   // live reference to store DB
      // form state for evaluations
      evalForm: blankEval(),
      showEvalModal: false,
      // misc ui
      toast: '',
      // ai feedback
      aiStudentId: '',
      aiResult: '',
      aiLoading: false
    };
  },
  computed: {
    isAdmin() { return this.role === 'admin'; },
    isViewer() { return this.role === 'viewer'; },
    canEdit() { return this.role !== 'viewer'; },

    currentTable() {
      if (!this.db || !this.db.mifTables) return null;
      return this.db.mifTables.find(t => t.aircraftType === this.evalForm.aircraftType && t.phaseName === this.evalForm.phaseName) || null;
    },

    students() { return this.db.students; },
    instructors() { return this.db.instructors; },
    aircraft() { return this.db.aircraft; },
    mifTables() { return this.db.mifTables; },
    evaluations() { return this.db.evaluations; },
    announcements() { return this.db.announcements; },

    activeStudents() { return this.db.students.filter(s => s.active); },
    activeInstructors() { return this.db.instructors.filter(i => i.active); },

    // dashboard stats
    stats() {
      const ev = this.db.evaluations;
      const meets = ev.filter(e => e.overallMifStatus === STATUS_MEETS_STANDARD).length;
      const below = ev.filter(e => e.overallMifStatus === STATUS_BELOW_STANDARD).length;
      const avg = ev.length ? (ev.reduce((s, e) => s + (e.finalGrade || 0), 0) / ev.length).toFixed(1) : '0.0';
      return { students: this.db.students.length, instructors: this.db.instructors.length, evals: ev.length, meets, below, avg };
    },

    // grouped evaluations for the evaluations tab (by student)
    evalsByStudent() {
      const map = {};
      this.db.evaluations.forEach(e => {
        (map[e.studentId] = map[e.studentId] || []).push(e);
      });
      return map;
    },

    // mif tables grouped by aircraft
    tablesByAircraft() {
      const map = {};
      this.db.mifTables.forEach(t => {
        (map[t.aircraftType] = map[t.aircraftType] || []).push(t);
      });
      return map;
    },

    // live preview while building an evaluation
    evalPreview() {
      const mg = (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0);
      if (!mg.length) return { finalGrade: null, status: STATUS_PENDING, failCount: 0 };
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      let fail = 0;
      (this.evalForm.maneuverGrades || []).forEach(m => {
        if (m.studentGrade != null && m.requiredMif != null && m.studentGrade < m.requiredMif) fail++;
      });
      return { finalGrade: fg, status: st, failCount: fail };
    }
  },
  methods: {
    setTab(t) { this.tab = t; },
    setRole(r) { this.role = r; this.toastMsg('Viewing as ' + r); },

    toastMsg(m) { this.toast = m; setTimeout(() => { if (this.toast === m) this.toast = ''; }, 2200); },

    save() { persist(); this.toastMsg('Saved to this device'); },
    resetData() {
      if (confirm('Reset all data to the sample set? This clears changes on this device only.')) {
        resetDB(); this.db = DB; this.toastMsg('Data reset to sample');
      }
    },
    exportJSON() {
      const blob = new Blob([JSON.stringify(this.db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'grading-portal-backup.json';
      a.click();
      this.toastMsg('Exported backup JSON');
    },
    importJSON(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.students) throw new Error('not a portal backup');
          DB = data; persist(); this.db = DB;
          this.toastMsg('Imported backup');
        } catch (err) { alert('Invalid backup file.'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    },

    /* ---- students ---- */
    addStudent() {
      const name = prompt('Student name:');
      if (!name) return;
      this.db.students.push({ id: uid('s'), name, active: true, activeYears: ['2025-2026'] });
      this.save();
    },
    toggleStudentActive(s) { s.active = !s.active; this.save(); },
    deleteStudent(s) {
      if (!confirm('Delete ' + s.name + '?')) return;
      this.db.students = this.db.students.filter(x => x.id !== s.id);
      this.save();
    },

    /* ---- instructors ---- */
    addInstructor() {
      const name = prompt('Instructor name:');
      if (!name) return;
      this.db.instructors.push({ id: uid('i'), name, active: true });
      this.save();
    },
    toggleInstructorActive(i) { i.active = !i.active; this.save(); },
    deleteInstructor(i) { if (confirm('Delete ' + i.name + '?')) { this.db.instructors = this.db.instructors.filter(x => x.id !== i.id); this.save(); } },

    /* ---- aircraft ---- */
    addAircraft() {
      const name = prompt('Aircraft type (e.g. R44-2):');
      if (!name) return;
      this.db.aircraft.push({ id: uid('a'), name });
      this.save();
    },
    deleteAircraft(a) { if (confirm('Delete ' + a.name + '?')) { this.db.aircraft = this.db.aircraft.filter(x => x.id !== a.id); this.save(); } },

    /* ---- MIF tables ---- */
    phaseFor(aircraftType) {
      const ac = this.db.aircraft.find(a => a.name === aircraftType);
      return ac ? ac.name : aircraftType;
    },
    addMifTable() {
      const aircraftType = prompt('Aircraft type (must match an added aircraft):', 'R44-2');
      const phaseName = prompt('Phase name (e.g. CONTACT):', 'CONTACT');
      if (!aircraftType || !phaseName) return;
      const stagesStr = prompt('Stages (comma separated, e.g. S1, S2, S3):', 'S1, S2, S3');
      const stages = stagesStr ? stagesStr.split(',').map(s => s.trim()).filter(Boolean) : ['S1'];
      this.db.mifTables.push({ id: uid('m'), aircraftType, phaseName, stages, maneuvers: [] });
      this.save();
    },
    addManeuver(t) {
      const name = prompt('Maneuver name:');
      if (!name) return;
      const factor = parseFloat(prompt('Weight factor:', '1.0')) || 1.0;
      const stageMifs = {};
      t.stages.forEach(st => {
        const v = parseInt(prompt('Required MIF for ' + st + ' (0 = not graded this stage):', '70'), 10);
        stageMifs[st] = isNaN(v) ? 70 : v;
      });
      t.maneuvers.push({ name, factor, stageMifs });
      this.save();
    },
    deleteManeuver(t, m) { t.maneuvers = t.maneuvers.filter(x => x !== m); this.save(); },
    deleteMifTable(t) { if (confirm('Delete table ' + t.phaseName + '?')) { this.db.mifTables = this.db.mifTables.filter(x => x.id !== t.id); this.save(); } },

    /* ---- evaluations ---- */
    openNewEval() {
      this.evalForm = blankEval();
      this.evalForm.aircraftType = this.db.aircraft[0] ? this.db.aircraft[0].name : '';
      this.evalForm.studentId = this.db.students[0] ? this.db.students[0].id : '';
      this.evalForm.instructorName = this.db.instructors[0] ? this.db.instructors[0].name : '';
      this.showEvalModal = true;
      this.loadManeuversForForm();
    },
    loadManeuversForForm() {
      const t = this.currentTable;
      if (t) {
        this.evalForm.maneuverGrades = t.maneuvers.map(m => ({
          name: m.name,
          factor: m.factor,
          requiredMif: m.stageMifs[this.evalForm.tripNumber] != null ? m.stageMifs[this.evalForm.tripNumber] : 70,
          studentGrade: 0
        }));
      } else {
        this.evalForm.maneuverGrades = [];
      }
    },
    onEvalContextChange() { this.loadManeuversForForm(); },
    saveEval() {
      const fg = calcFinalGrade(this.evalForm.maneuverGrades);
      const st = calcMifStatus(this.evalForm.maneuverGrades);
      const student = this.db.students.find(s => s.id === this.evalForm.studentId);
      const ev = {
        id: this.evalForm.id || uid('e'),
        aircraftType: this.evalForm.aircraftType,
        studentId: this.evalForm.studentId,
        studentName: student ? student.name : '',
        instructorName: this.evalForm.instructorName,
        phaseName: this.evalForm.phaseName,
        tripNumber: this.evalForm.tripNumber,
        date: Math.floor(Date.parse(this.evalForm.date) / 1000) || Math.floor(Date.now() / 1000),
        flightYear: this.evalForm.flightYear,
        duration: this.evalForm.duration,
        finalGrade: fg || 0,
        overallMifStatus: st,
        tripNotes: this.evalForm.tripNotes,
        maneuverGrades: (this.evalForm.maneuverGrades || []).filter(m => m.studentGrade != null && m.studentGrade !== 0)
          .map(m => ({ name: m.name, factor: m.factor, requiredMif: m.requiredMif, studentGrade: m.studentGrade }))
      };
      const idx = this.db.evaluations.findIndex(x => x.id === ev.id);
      if (idx >= 0) this.db.evaluations[idx] = ev; else this.db.evaluations.push(ev);
      this.save();
      this.showEvalModal = false;
      this.toastMsg('Evaluation saved');
    },
    deleteEval(e) { if (confirm('Delete this evaluation?')) { this.db.evaluations = this.db.evaluations.filter(x => x.id !== e.id); this.save(); } },
    studentName(id) { const s = this.db.students.find(x => x.id === id); return s ? s.name : '?'; },

    /* ---- announcements ---- */
    addAnnouncement() {
      const title = prompt('Announcement title:');
      if (!title) return;
      const message = prompt('Message:') || '';
      const targetRole = prompt('Target (all / instructor / viewer):', 'all') || 'all';
      this.db.announcements.unshift({
        id: uid('an'), title, message, targetRole, senderName: this.role,
        timestamp: Math.floor(Date.now() / 1000), fileName: null, fileUrl: null
      });
      this.save();
      this.toastMsg('Announcement posted');
    },
    deleteAnnouncement(a) { if (confirm('Delete announcement?')) { this.db.announcements = this.db.announcements.filter(x => x.id !== a.id); this.save(); } },
    filterAnnouncements(list) {
      return list.filter(a => a.targetRole === 'all' || a.targetRole === this.role || this.role === 'admin');
    },

    /* ---- AI feedback ---- */
    runAI() {
      if (!this.aiStudentId) { this.toastMsg('Pick a student first'); return; }
      this.aiLoading = true;
      const student = this.db.students.find(s => s.id === this.aiStudentId);
      const evals = this.db.evaluations.filter(e => e.studentId === this.aiStudentId);
      setTimeout(() => { // keep UI responsive
        const data = buildPerformance(student, evals);
        this.aiResult = generateFeedback(data);
        this.aiLoading = false;
      }, 30);
    },
    copyAI() {
      const done = () => this.toastMsg('Copied to clipboard');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(this.aiResult).then(done).catch(() => {});
      else this.toastMsg('Copy not supported here');
    },

    /* ---- helpers ---- */
    fmt(sec) { return fmtDate(sec); },
    gradeColor(g) { return g >= 85 ? 'good' : g >= 70 ? 'ok' : 'bad'; },
    statusColor(s) { return s === STATUS_MEETS_STANDARD ? 'good' : s === STATUS_BELOW_STANDARD ? 'bad' : 'pending'; }
  },
  mounted() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
});

function blankEval() {
  return {
    id: '', aircraftType: '', studentId: '', instructorName: '',
    phaseName: 'CONTACT', tripNumber: 'S1', date: new Date().toISOString().slice(0, 10),
    flightYear: '2025-2026', duration: '', tripNotes: '', maneuverGrades: []
  };
}

app.mount('#app');
