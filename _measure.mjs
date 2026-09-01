// Measure buildFaaContext output size for a realistic student.
import { FaaRag } from './src/faa-rag/faaRag.js';

// Simulate a student with several weak maneuvers (the high-passage case).
const data = {
  studentName: 'charbel assaf',
  evaluationCount: 30,
  overallScore: 74.2,
  trend: 'DECLINING', trendDelta: -4.1,
  volatility: 6.2,
  overallMifStatus: 'Below Standard',
  weakManeuvers: [
    { name: 'Hover (translational)', avgGrade: 61, requiredMif: 80, trend: 'DECLINING' },
    { name: 'Hover (pedal turns)', avgGrade: 65, requiredMif: 80, trend: 'FLAT' },
    { name: 'Confined approach', avgGrade: 68, requiredMif: 80, trend: 'DECLINING' },
    { name: 'Steep approach', avgGrade: 70, requiredMif: 80, trend: 'FLAT' },
    { name: 'Auto-rotation', avgGrade: 72, requiredMif: 80, trend: 'IMPROVING' },
  ],
  bestManeuver: 'Straight & level',
  practicalScores: { 'Straight & level': 88 },
  phaseScores: { 'Contact': 76, 'Confined': 70 },
  noteThemes: ['trim', 'heading', 'crosscheck'],
  instructorNotes: ['watch trim', 'improve crosscheck', 'heading control'],
  readiness: 'REMEDIAL',
};

const rag = await FaaRag.buildFaaContext(data);
console.log('RAG block chars:', rag.length);
console.log('RAG block lines:', rag.split('\n').length);
console.log('--- sample tail ---');
console.log(rag.slice(-300));
