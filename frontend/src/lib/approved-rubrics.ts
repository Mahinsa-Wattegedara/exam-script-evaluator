import type { Assessment, Question, RubricCriterion, RubricSubquestion } from "./types";

export type ApprovedRubric = {
  rubricId: string;
  assessmentId: string;
  questionId: string;
  version: number;
  approvedAt: string;
  approvedBy: string;
  question: Omit<Question, "id"> & {
    criteria: RubricCriterion[];
    subquestions: RubricSubquestion[];
    modelAnswerText: string;
  };
};

async function readResponse(response: Response): Promise<ApprovedRubric> {
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409) throw new Error("The saved rubric version changed. Load the saved approval, review it, then approve your changes.");
    const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail)
      ? data.detail.map((item: { msg: string; loc?: (string | number)[] }) => `${item.loc?.slice(1).join(".") || "Rubric"}: ${item.msg}`).join("; ")
      : "Could not save or load the approved rubric.";
    throw new Error(detail);
  }
  return data;
}

function path(assessmentId: string, questionId: string) {
  return `/api/rubric/approved/${encodeURIComponent(assessmentId)}/${encodeURIComponent(questionId)}`;
}

export async function loadApprovedRubric(assessmentId: string, questionId: string) {
  return readResponse(await fetch(path(assessmentId, questionId), { cache: "no-store", signal: AbortSignal.timeout(35000) }));
}

export async function saveApprovedRubric(assessment: Assessment, question: Question, criteria: RubricCriterion[], modelAnswerText: string, subquestions: RubricSubquestion[], expectedVersion: number) {
  if (!subquestions.length) throw new Error("Add the original answer and mark breakdown for each subquestion before approving.");
  const url = path(assessment.id, question.id);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(35000),
      body: JSON.stringify({
        assessmentTitle: assessment.title, course: assessment.course, expectedVersion,
        question: {
          number: question.number, prompt: question.prompt, maxMarks: question.maxMarks,
          modelAnswerText, subquestions,
          criteria: criteria.map(c => ({
            id: c.id, subquestionId: c.subquestionId, sourceExcerpt: c.sourceExcerpt,
            description: c.description, maxMarks: c.maxMarks, allowedPartialCredits: c.allowedPartialCredits,
            acceptedAlternatives: c.acceptedAlternatives, scoringGuide: c.scoringGuide,
          })),
        },
      }),
    });
  } catch {
    throw new Error("The save could not be confirmed. Use Load saved approval before retrying; Supabase may have completed the approval.");
  }
  const saved = await readResponse(response);
  // Confirm persistence via a separate read, using the exact version (not a racing latest).
  try {
    const stored = await readResponse(await fetch(`${url}?version=${saved.version}`, { cache: "no-store", signal: AbortSignal.timeout(35000) }));
    if (stored.rubricId !== saved.rubricId || stored.assessmentId !== assessment.id || stored.questionId !== question.id || stored.version !== saved.version) throw new Error("Saved rubric identity did not match.");
    return stored;
  } catch {
    throw new Error("The approval was saved, but could not be read back. Use Load saved approval to recover it before approving again.");
  }
}
