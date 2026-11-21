import type { Question, RubricCriterion, RubricSubquestion } from "./types";

export type ImportedQuestion = {
  question: Question;
  criteria: RubricCriterion[];
  modelAnswerText?: string;
  subquestions?: RubricSubquestion[];
};

// Expected lines: Q1 | Question prompt | 10, followed by C1 | Criterion | 4.
export function parseMarkingScheme(text: string): ImportedQuestion[] {
  const questions: ImportedQuestion[] = [];
  let current: ImportedQuestion | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split("|").map((part) => part.trim());
    const questionMatch = /^Q(\d+)$/i.exec(parts[0]);
    const criterionMatch = /^C(\d+)$/i.exec(parts[0]);

    if (questionMatch && parts.length >= 3) {
      const maxMarks = Number(parts[parts.length - 1]);
      const prompt = parts.slice(1, -1).join(" | ");
      if (!prompt || !Number.isFinite(maxMarks) || maxMarks <= 0) {
        throw new Error(`Invalid question line: ${line}`);
      }
      const number = `Q${questionMatch[1]}`;
      if (questions.some((item) => item.question.number === number)) {
        throw new Error(`${number} appears more than once.`);
      }
      current = {
        question: { id: `q${questionMatch[1]}`, number, prompt, maxMarks },
        criteria: [],
      };
      questions.push(current);
      continue;
    }

    if (criterionMatch && current && parts.length >= 3) {
      const maxMarks = Number(parts[parts.length - 1]);
      const description = parts.slice(1, -1).join(" | ");
      if (!description || !Number.isFinite(maxMarks) || maxMarks < 0) {
        throw new Error(`Invalid criterion line: ${line}`);
      }
      const id = `C${criterionMatch[1]}`;
      if (current.criteria.some((criterion) => criterion.id === id)) {
        throw new Error(`${id} appears more than once in ${current.question.number}.`);
      }
      current.criteria.push({
        id,
        description,
        maxMarks,
        allowedPartialCredits: [0, maxMarks],
        acceptedAlternatives: [],
      });
      continue;
    }

    throw new Error(`Could not read this line: ${line}`);
  }

  if (questions.length === 0) throw new Error("No questions found. Use the format shown below.");
  if (questions.some((item) => item.criteria.length === 0)) {
    throw new Error("Each question needs at least one criterion.");
  }
  return questions;
}
