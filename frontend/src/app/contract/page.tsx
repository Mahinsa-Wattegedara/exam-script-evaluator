"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert, ApprovalBadge, Badge, Button, Card, CardHeader, PageHeader, RoutingBadge } from "@/components/ui";
import { activeVersion, buildAnswerReady } from "@/lib/logic";
import { useStore } from "@/lib/store";

export default function ContractPage() {
  const { state } = useStore();
  const [selectedAnswerId, setSelectedAnswerId] = useState<string>(state.answers[0]?.id ?? "");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [validationState, setValidationState] = useState<{
    status: "idle" | "checking" | "valid" | "invalid";
    message?: string;
    checkedKey?: string;
  }>({ status: "idle" });

  useEffect(() => {
    if (state.answers.length > 0 && !state.answers.some((a) => a.id === selectedAnswerId)) {
      setSelectedAnswerId(state.answers[0].id);
    }
  }, [state.answers, selectedAnswerId]);

  const selected = state.answers.find((a) => a.id === selectedAnswerId) ?? state.answers[0];
  const readyPayload = useMemo(
    () => (selected ? buildAnswerReady(state, selected) : null),
    [state, selected],
  );

  const allApprovedContracts = useMemo(
    () =>
      state.answers
        .map((a) => buildAnswerReady(state, a))
        .filter((c): c is NonNullable<typeof c> => c !== null),
    [state],
  );

  const payloadKey = readyPayload
    ? `${readyPayload.script_id}:${readyPayload.question_id}:v${readyPayload.transcript_version}:${readyPayload.approved_text.length}`
    : "";

  async function verifyAgainstBackend(payload = readyPayload) {
    if (!payload) return;
    const key = `${payload.script_id}:${payload.question_id}:v${payload.transcript_version}:${payload.approved_text.length}`;
    setValidationState({ status: "checking", checkedKey: key });
    try {
      const res = await fetch("/api/contract/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setValidationState({
          status: "invalid",
          message: data?.error || "Schema validation failed.",
          checkedKey: key,
        });
        return;
      }
      setValidationState({
        status: "valid",
        message: `Verified by FastAPI AnswerReadySchema v${data.schema_version} (${data.span_count} evidence spans, XML delimiters intact).`,
        checkedKey: key,
      });
    } catch (err) {
      setValidationState({
        status: "invalid",
        message: err instanceof Error ? err.message : "Could not reach backend validator.",
        checkedKey: key,
      });
    }
  }

  useEffect(() => {
    if (!readyPayload) {
      setValidationState({ status: "idle" });
      return;
    }
    void verifyAgainstBackend(readyPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  async function copyJson(label: string, value: unknown) {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopiedKey(label);
    setTimeout(() => setCopiedKey((cur) => (cur === label ? null : cur)), 1800);
  }

  function downloadJson(filename: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AnswerReady Output Contract"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={allApprovedContracts.length > 0 ? "green" : "slate"}>
              {allApprovedContracts.length} / {state.answers.length} Ready for Module 2
            </Badge>
            {allApprovedContracts.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  downloadJson(
                    `AnswerReady-bundle-${state.assessment.id || "assessment"}.json`,
                    {
                      exported_at: new Date().toISOString(),
                      assessment_id: state.assessment.id,
                      count: allApprovedContracts.length,
                      contracts: allApprovedContracts,
                    },
                  )
                }
              >
                Export all approved ({allApprovedContracts.length}) ↓
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader
            title="Answers"
            sub="Select an extracted answer to inspect its Module 1 → Module 2 handoff"
          />
          {state.answers.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 space-y-2">
              <p className="font-semibold text-slate-700">No extracted answers yet.</p>
              <p>
                Upload a script in{" "}
                <Link href="/upload" className="text-indigo-600 underline font-medium">
                  Upload
                </Link>{" "}
                and extract answers in{" "}
                <Link href="/scripts" className="text-indigo-600 underline font-medium">
                  Scripts
                </Link>{" "}
                to generate `AnswerReady` records.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {state.answers.map((a) => {
                const sc = state.scripts.find((s) => s.id === a.scriptId);
                const q = state.assessment.questions.find((qq) => qq.id === a.questionId);
                const v = activeVersion(a);
                const isSel = a.id === selected?.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAnswerId(a.id)}
                    className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition cursor-pointer ${
                      isSel ? "bg-indigo-50/80 font-medium" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {sc?.pseudonymousCode ?? a.scriptId} · {q?.number ?? a.questionId.toUpperCase()} (v{a.activeVersion})
                    </span>
                    <div className="flex items-center gap-1.5">
                      {v && <ApprovalBadge s={v.approvalStatus} />}
                      <RoutingBadge s={a.routingStatus} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-6 lg:col-span-7">
          <Card>
            <CardHeader
              title="AnswerReady JSON (Module 1 → Module 2)"
              sub="Includes NFR-04 <student_answer_transcript> delimited input for prompt-injection isolation"
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {readyPayload ? (
                    <>
                      <Badge tone="green">Ready · Delimited</Badge>
                      <Button
                        size="sm"
                        onClick={() => void copyJson("answerReady", readyPayload)}
                      >
                        {copiedKey === "answerReady" ? "✓ Copied" : "Copy JSON"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          downloadJson(
                            `AnswerReady-${readyPayload.pseudonymous_script_code}-${readyPayload.question_id}-v${readyPayload.transcript_version}.json`,
                            readyPayload,
                          )
                        }
                      >
                        Download .json
                      </Button>
                    </>
                  ) : (
                    <Badge tone="amber">Not AI-ready</Badge>
                  )}
                </div>
              }
            />
            <div className="p-5 space-y-4">
              {readyPayload ? (
                <>
                  {selected && selected.activeVersion > readyPayload.transcript_version && (
                    <Alert tone="amber" title={`Draft v${selected.activeVersion} pending review`}>
                      Showing the latest approved contract (<strong>v{readyPayload.transcript_version}</strong>). Once{" "}
                      <Link href={`/review?script=${selected.scriptId}`} className="underline font-semibold">
                        draft v{selected.activeVersion} is approved in Review
                      </Link>
                      , v{readyPayload.transcript_version} will be superseded and earlier evaluation runs marked stale.
                    </Alert>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      {validationState.status === "valid" && (
                        <Badge tone="green">Pydantic v2 Validated</Badge>
                      )}
                      {validationState.status === "checking" && (
                        <Badge tone="blue">Validating schema…</Badge>
                      )}
                      {validationState.status === "invalid" && (
                        <Badge tone="red">Validation Failed</Badge>
                      )}
                      <span className="text-slate-700">
                        {validationState.message || "Checking FastAPI AnswerReadySchema (extra='forbid')…"}
                      </span>
                    </div>
                    <Button size="sm" onClick={() => void verifyAgainstBackend(readyPayload)}>
                      Re-verify
                    </Button>
                  </div>

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
              ) : selected?.routingStatus === "MANUAL_MARKING" ? (
                <div className="text-xs text-slate-600">
                  This answer was routed to <strong>Manual Marking</strong>, so Module 1 withholds the{" "}
                  <code>AnswerReady</code> AI evaluation contract by design.
                </div>
              ) : selected?.routingStatus === "NOT_ATTEMPTED" ? (
                <div className="text-xs text-slate-600">
                  This question was confirmed as <strong>Not Attempted</strong>, so no AI evaluation contract is emitted.
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Approve the transcript in{" "}
                  <Link
                    href={selected ? `/review?script=${selected.scriptId}` : "/review"}
                    className="text-indigo-600 underline font-medium"
                  >
                    Review queue
                  </Link>{" "}
                  to generate the immutable <code>AnswerReady</code> record.
                </div>
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
                      No approved rubric version for this question yet. Go to{" "}
                      <Link href="/rubric" className="text-indigo-600 underline font-medium">
                        Marking scheme
                      </Link>{" "}
                      to define and approve criteria.
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
