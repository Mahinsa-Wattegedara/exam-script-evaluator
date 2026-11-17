// Clean initial state with zero dummy scripts, questions, or runs.
import { nowIso } from "./logic";
import type { State } from "./types";

export function buildSeed(): State {
  return {
    assessment: {
      id: "asm-mid-2026",
      title: "Mid Semester Examination 2026",
      course: "",
      retentionDays: 90,
      questions: [],
    },
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

