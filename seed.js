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

const SEED = {
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
    { id: 'i_02', name: 'Lt. Khoury', active: true },
    { id: 'i_03', name: 'Maj. Saade', active: false }
  ],

  aircraft: [
    { id: 'a_r44_2', name: 'R44-2' },
    { id: 'a_r44', name: 'R44' }
  ],

  // MIF tables: one per aircraft type + phase. maneuvers have a factor (weight)
  // and stageMifs: { stage: requiredMIF } on the 1-4 grade scale (0 = not graded).
  mifTables: [
    {
      id: 'm_r44_2_contact',
      aircraftType: 'R44-2',
      phaseName: 'CONTACT',
      stages: ['S1', 'S2', 'S3'],
      maneuvers: [
        { name: 'Pre-flight / Walk-around', factor: 1.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Engine start & rotor engage', factor: 1.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Hover (translational)', factor: 2.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Hover (pedal turns)', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Straight & level', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Turns (constant rate)', factor: 1.5, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Climb / Descent', factor: 1.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Approach to hover', factor: 2.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Normal landing', factor: 2.0, stageMifs: { S1: 2, S2: 3, S3: 3 } },
        { name: 'Emergency — auto-rotation', factor: 2.5, stageMifs: { S1: 0, S2: 2, S3: 3 } }
      ]
    },
    {
      id: 'm_r44_2_confined',
      aircraftType: 'R44-2',
      phaseName: 'CONFINED AREAS',
      stages: ['S1', 'S2'],
      maneuvers: [
        { name: 'Spot selection / risk assessment', factor: 1.5, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Confined approach', factor: 2.5, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Confined departure', factor: 2.5, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Run-on landing', factor: 2.0, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Steep approach', factor: 2.0, stageMifs: { S1: 2, S2: 3 } }
      ]
    },
    {
      id: 'm_r44_contact',
      aircraftType: 'R44',
      phaseName: 'CONTACT',
      stages: ['S1', 'S2'],
      maneuvers: [
        { name: 'Pre-flight / Walk-around', factor: 1.0, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Hover (translational)', factor: 2.0, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Straight & level', factor: 1.5, stageMifs: { S1: 2, S2: 3 } },
        { name: 'Normal landing', factor: 2.0, stageMifs: { S1: 2, S2: 3 } }
      ]
    }
  ],

  evaluations: [
    {
      id: 'e_01', aircraftType: 'R44-2', studentId: 's_01', studentName: 'Cadet Aoun',
      instructorName: 'Capt. Haddad', phaseName: 'CONTACT', tripNumber: 'S1',
      date: 1714521600, flightYear: '2025-2026', duration: '1.2',
      finalGrade: 78.333, overallMifStatus: 'MEETS STANDARD',
      tripNotes: 'Good hover control. Watch pedal coordination in turns.',
      maneuverGrades: [
        { name: 'Pre-flight / Walk-around', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Engine start & rotor engage', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Hover (translational)', factor: 2.0, requiredMif: 2, studentGrade: 2 },
        { name: 'Hover (pedal turns)', factor: 1.5, requiredMif: 2, studentGrade: 2 },
        { name: 'Straight & level', factor: 1.5, requiredMif: 2, studentGrade: 3 },
        { name: 'Turns (constant rate)', factor: 1.5, requiredMif: 2, studentGrade: 2 },
        { name: 'Climb / Descent', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Approach to hover', factor: 2.0, requiredMif: 2, studentGrade: 2 },
        { name: 'Normal landing', factor: 2.0, requiredMif: 2, studentGrade: 2 },
        { name: 'Emergency — auto-rotation', factor: 2.5, requiredMif: 0, studentGrade: 0 }
      ]
    },
    {
      id: 'e_02', aircraftType: 'R44-2', studentId: 's_01', studentName: 'Cadet Aoun',
      instructorName: 'Lt. Khoury', phaseName: 'CONTACT', tripNumber: 'S2',
      date: 1717600000, flightYear: '2025-2026', duration: '1.4',
      finalGrade: 85.625, overallMifStatus: 'MEETS STANDARD',
      tripNotes: 'Marked improvement on pedal turns. Ready to progress.',
      maneuverGrades: [
        { name: 'Pre-flight / Walk-around', factor: 1.0, requiredMif: 3, studentGrade: 4 },
        { name: 'Engine start & rotor engage', factor: 1.0, requiredMif: 3, studentGrade: 3 },
        { name: 'Hover (translational)', factor: 2.0, requiredMif: 3, studentGrade: 3 },
        { name: 'Hover (pedal turns)', factor: 1.5, requiredMif: 3, studentGrade: 3 },
        { name: 'Straight & level', factor: 1.5, requiredMif: 3, studentGrade: 4 },
        { name: 'Turns (constant rate)', factor: 1.5, requiredMif: 3, studentGrade: 3 },
        { name: 'Climb / Descent', factor: 1.0, requiredMif: 3, studentGrade: 4 },
        { name: 'Approach to hover', factor: 2.0, requiredMif: 3, studentGrade: 3 },
        { name: 'Normal landing', factor: 2.0, requiredMif: 3, studentGrade: 3 },
        { name: 'Emergency — auto-rotation', factor: 2.5, requiredMif: 2, studentGrade: 2 }
      ]
    },
    {
      id: 'e_03', aircraftType: 'R44-2', studentId: 's_02', studentName: 'Cadet Boustani',
      instructorName: 'Capt. Haddad', phaseName: 'CONTACT', tripNumber: 'S1',
      date: 1715800000, flightYear: '2025-2026', duration: '1.1',
      finalGrade: 69.091, overallMifStatus: 'BELOW STANDARD',
      tripNotes: 'Below standard on hover and landing. Needs remedial sortie.',
      maneuverGrades: [
        { name: 'Pre-flight / Walk-around', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Engine start & rotor engage', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Hover (translational)', factor: 2.0, requiredMif: 2, studentGrade: 1 },
        { name: 'Hover (pedal turns)', factor: 1.5, requiredMif: 2, studentGrade: 2 },
        { name: 'Straight & level', factor: 1.5, requiredMif: 2, studentGrade: 3 },
        { name: 'Turns (constant rate)', factor: 1.5, requiredMif: 2, studentGrade: 2 },
        { name: 'Climb / Descent', factor: 1.0, requiredMif: 2, studentGrade: 3 },
        { name: 'Approach to hover', factor: 2.0, requiredMif: 2, studentGrade: 1 },
        { name: 'Normal landing', factor: 2.0, requiredMif: 2, studentGrade: 1 },
        { name: 'Emergency — auto-rotation', factor: 2.5, requiredMif: 0, studentGrade: 0 }
      ]
    }
  ],

  announcements: [
    {
      id: 'an_01', title: 'Phase check schedule', message: 'S2 phase checks begin next week. Bring logbooks.',
      targetRole: 'all', senderName: 'Admin Officer', timestamp: 1717000000, fileName: null, fileUrl: null
    },
    {
      id: 'an_02', title: 'Remedial focus', message: 'Cadets below standard require a standardisation check before progressing phases.',
      targetRole: 'instructor', senderName: 'Capt. Haddad', timestamp: 1717100000, fileName: null, fileUrl: null
    }
  ]
};
