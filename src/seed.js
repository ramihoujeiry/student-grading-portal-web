/* =========================================================================
 * seed.js — sample data so the app is useful on first load.
 * Mirrors the Firestore models in the Android "Student Grading Portal".
 * All IDs are plain strings; dates are unix-seconds (matches Firestore Timestamp.seconds).
 *
 * SCALING NOTE: in the Android app a maneuver's "required MIF" is on the SAME
 * 1-4 grade scale as the student grade (StudentGradingPortal compares
 * studentGrade < mif). So MIF values here are 1-4 (e.g. required MIF 3 =
 * "must score 3 or above"). 0 means "not graded at this stage".
 * ========================================================================= */

export const SEED = {
  // Local role switcher (replaces Firebase Auth in this client-side build).
  // role: admin | instructor | viewer | pending
  users: [
    { uid: 'u_admin', name: 'Admin Officer', email: 'admin@squadron', role: 'admin' },
    { uid: 'u_inst1', name: 'Capt. Haddad', email: 'haddad@squadron', role: 'instructor' },
    { uid: 'u_inst2', name: 'Lt. Khoury', email: 'khoury@squadron', role: 'instructor' },
    { uid: 'u_view', name: 'OCU Viewer', email: 'viewer@squadron', role: 'viewer' }
  ],

  students: [
    { id: 's_01', name: 'Cadet Aoun', active: true, activeYears: ['2025-2026'] },
    { id: 's_02', name: 'Cadet Boustani', active: true, activeYears: ['2025-2026'] },
    { id: 's_03', name: 'Cadet Daher', active: false, activeYears: ['2024-2025'] }
  ],

  instructors: [
    { id: 'i_01', name: 'Capt. Haddad', active: true },
    { id: 'i_02', name: 'Lt. Khoury', active: true }
  ],

  aircraft: [
    { id: 'a_r44', name: 'R44-2' }
  ],

  mifTables: [
    {
      id: 'R44-2_Phase 1', aircraftType: 'R44-2', phaseName: 'Phase 1', stages: ['S1'],
      maneuvers: []
    }
  ],

  evaluations: [
    {
      id: 'e_01', studentId: 's_01', aircraftType: 'R44-2', phaseName: 'Phase 1',
      tripNumber: 'T-01', date: Math.floor(Date.now() / 1000) - 86400 * 7,
      flightYear: '2025-2026', duration: '01:10', instructorName: 'Capt. Haddad',
      overallMifStatus: 'MEETS STANDARD', finalGrade: 82,
      tripNotes: 'Solid first trip. Watch power management in the hover.',
      maneuverGrades: [
        { name: 'Hover (translational)', studentGrade: 3, requiredMif: 3, factor: 1 },
        { name: 'Straight & level', studentGrade: 4, requiredMif: 3, factor: 1 }
      ]
    }
  ],

  announcements: [
    { id: 'an_01', timestamp: Math.floor(Date.now() / 1000) - 3600, text: 'Welcome to the grading portal.' }
  ]
};
