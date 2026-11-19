"use client";
import Link from "next/link";
import { useState } from "react";
import { ApprovalBadge, Badge, Card, CardHeader, PageHeader, RoutingBadge } from "@/components/ui";
import { activeVersion, buildAnswerReady } from "@/lib/logic";
import { useStore } from "@/lib/store";

export default function ContractPage() {
  const { state } = useStore();
  const [selectedAnswerId, setSelectedAnswerId] = useState<string>(state.answers[0]?.id ?? "");

  const selected = state.answers.find((a) => a.id === selectedAnswerId) ?? state.answers[0];
  const readyPayload = selected ? buildAnswerReady(state, selected) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="AnswerReady Output Contract" />

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader title="Answers" />
          <div className="divide-y divide-slate-100">
            {state.answers.map((a) => {
              const sc = state.scripts.find((s) => s.id === a.scriptId);
              const q = state.assessment.questions.find((qq) => qq.id === a.questionId);
              const v = activeVersion(a);
              const isSel = a.id === selected?.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedAnswerId(a.id)}
                  className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition ${
                    isSel ? "bg-indigo-50/80 font-medium" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {sc?.pseudonymousCode} · {q?.number} (v{a.activeVersion})
                  </span>
                  <div className="flex items-center gap-1.5">
                    {v && <ApprovalBadge s={v.approvalStatus} />}
                    <RoutingBadge s={a.routingStatus} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-7">
          <Card>
            <CardHeader
              title="AnswerReady JSON (Module 1 → Module 2)"
              sub="Includes NFR-04 <student_answer_transcript> delimited input for prompt-injection isolation"
              right={readyPayload ? <Badge tone="green">Ready · Delimited</Badge> : <Badge tone="amber">Pending approval</Badge>}
            />
            <div className="p-5 space-y-4">
              {readyPayload ? (
                <>
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-950">
                        NFR-04 Delimited Model Input (Untrusted Answer Guardrail)
                      </span>
                      <Badge tone="indigo">XML Delimited</Badge>
                    </div>
                    <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-amber-200 whitespace-pre-wrap">
                      {readyPayload.delimited_text}
                    </pre>
                  </div>
                  <pre className="max-h-[360px] overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-300">
                    {JSON.stringify(readyPayload, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="text-xs text-slate-500">Approve the transcript in Review to generate the AnswerReady record.</div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="RubricSnapshot JSON (Module 2 → Evaluators)"
              sub="Immutable criterion IDs, descriptions, and score bounds (SRS Section 4.3)"
              right={
                selected && state.rubrics.some((r) => r.questionId === selected.questionId && r.approved) ? (
                  <Badge tone="green">Approved</Badge>
                ) : (
                  <Badge tone="amber">Pending Rubric Approval</Badge>
                )
              }
            />
            <div className="p-5">
              {(() => {
                const appR = selected ? state.rubrics.find((r) => r.questionId === selected.questionId && r.approved) : null;
                if (!appR) {
                  return (
                    <div className="text-xs text-slate-500">
                      No approved rubric version for this question yet. Go to <Link href="/rubric" className="text-indigo-600 underline font-medium">Marking scheme</Link> to define and approve criteria.
                    </div>
                  );
                }
                const snap = {
                  contract: "RubricSnapshot",
                  schema_version: "1.0",
                  assessment_id: state.assessment.id,
                  question_id: appR.questionId,
                  rubric_version: appR.version,
                  approved_at: appR.approvedAt,
                  approved_by: appR.approvedBy,
                  criteria: appR.criteria,
                  model_answer_supplement: appR.modelAnswerText || undefined,
                };
                return (
                  <pre className="max-h-[360px] overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-cyan-300">
                    {JSON.stringify(snap, null, 2)}
                  </pre>
                );
              })()}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
