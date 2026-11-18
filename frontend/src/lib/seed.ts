// Clean initial state with standard questions and zero dummy scripts or runs.
import { nowIso } from "./logic";
import type { State } from "./types";

export const DEFAULT_QUESTIONS = [
  { id: "q1", number: "Q1", prompt: "", maxMarks: 5 },
  { id: "q2", number: "Q2", prompt: "", maxMarks: 5 },
  { id: "q3", number: "Q3", prompt: "", maxMarks: 5 },
  { id: "q4", number: "Q4", prompt: "", maxMarks: 5 },
];

export function buildSeed(): State {
  return {
    assessment: {
      id: "asm-mid-2026",
      title: "Mid Semester Examination 2026",
      course: "Object Oriented Programming",
      retentionDays: 90,
      questions: [...DEFAULT_QUESTIONS],
    },
    rubrics: [],
    scripts: [],
    failures: [],
    regions: [],
    answers: [],
    runs: [],
    identityMap: [],
    studentResults: {},
    reviewRequests: [],
    audit: [],
  };
}

export { nowIso };


