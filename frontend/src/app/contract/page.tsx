"use client";
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

        <Card className="lg:col-span-7">
          <CardHeader
            title="AnswerReady JSON"
            right={readyPayload ? <Badge tone="green">Ready</Badge> : <Badge tone="amber">Pending approval</Badge>}
          />
          <div className="p-5">
            {readyPayload ? (
              <pre className="max-h-[500px] overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-300">
                {JSON.stringify(readyPayload, null, 2)}
              </pre>
            ) : (
              <div className="text-xs text-slate-500">Approve the transcript in Review to generate the AnswerReady record.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
