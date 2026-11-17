"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageImage, RegionCrop } from "@/components/PageImage";
import {
  Alert,
  ApprovalBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  PageHeader,
  RoutingBadge,
  flagMeta,
  fmtTime,
} from "@/components/ui";
import { LOW_CONFIDENCE, activeVersion, regionsForAnswer, unresolvedFlags } from "@/lib/logic";
import { useStore } from "@/lib/store";

export default function TranscriptReviewPage() {
  const { state, actions } = useStore();
  const [filterScript, setFilterScript] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string>("");
  const [zoom, setZoom] = useState<number>(1);
  const [showFullPage, setShowFullPage] = useState<boolean>(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [viewVersionNum, setViewVersionNum] = useState<number | null>(null);
  const [newVerModal, setNewVerModal] = useState<boolean>(false);
  const [newVerReason, setNewVerReason] = useState<string>("Corrected OCR transcription text.");

  const filteredAnswers = useMemo(() => {
    return state.answers.filter((a) => filterScript === "ALL" || a.scriptId === filterScript);
  }, [state.answers, filterScript]);

  useEffect(() => {
    if (!filteredAnswers.length) return;
    if (!selectedId || !filteredAnswers.some((a) => a.id === selectedId)) {
      const firstNeedsReview = filteredAnswers.find((a) => a.routingStatus === "NEEDS_REVIEW");
      setSelectedId((firstNeedsReview ?? filteredAnswers[0]).id);
    }
  }, [filteredAnswers, selectedId]);

  const current = filteredAnswers.find((a) => a.id === selectedId) ?? filteredAnswers[0];
  const curVersion = useMemo(() => {
    if (!current) return undefined;
    if (viewVersionNum !== null) {
      return current.versions.find((v) => v.version === viewVersionNum) ?? activeVersion(current);
    }
    return activeVersion(current);
  }, [current, viewVersionNum]);

  useEffect(() => {
    setViewVersionNum(null);
    setSelectedSpanId(null);
  }, [selectedId]);

  const scriptOf = (scriptId: string) => state.scripts.find((s) => s.id === scriptId);
  const questionOf = (qid: string) => state.assessment.questions.find((q) => q.id === qid);

  if (!current || !curVersion) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transcript Review" />
        <EmptyState
          title="No answers available"
          action={
            <Link href="/scripts" className="rounded-md bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white">
              Go to Scripts
            </Link>
          }
        />
      </div>
    );
  }

  const script = scriptOf(current.scriptId)!;
  const question = questionOf(current.questionId)!;
  const regions = regionsForAnswer(state, current);
  const openFlags = unresolvedFlags(curVersion);
  const isEditable = curVersion.approvalStatus === "PENDING" && curVersion.version === current.activeVersion;
  const canApprove =
    isEditable &&
    openFlags.length === 0 &&
    (!current.blankDetected || current.blankConfirmed || current.routingStatus === "NOT_ATTEMPTED");
  const answerRuns = state.runs.filter((r) => r.answerId === current.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transcript Review"
        right={
          <select
            value={filterScript}
            onChange={(e) => setFilterScript(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            aria-label="Filter by script"
          >
            <option value="ALL">All scripts</option>
            {state.scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.pseudonymousCode}
              </option>
            ))}
          </select>
        }
      />

      <div className="flex flex-wrap gap-2">
        {filteredAnswers.map((a) => {
          const sc = scriptOf(a.scriptId);
          const q = questionOf(a.questionId);
          const active = a.id === current.id;
          return (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="font-mono">{sc?.pseudonymousCode}</span>
              <span>· {q?.number}</span>
              <span className="opacity-75">v{a.activeVersion}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Cropped Image */}
        <Card className="flex flex-col lg:col-span-6">
          <CardHeader
            title={`${script.pseudonymousCode} · ${question.number}`}
            sub={question.prompt}
            right={
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}>
                  −
                </Button>
                <span className="w-11 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
                <Button size="sm" onClick={() => setZoom((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}>
                  +
                </Button>
                <Button size="sm" onClick={() => setShowFullPage((v) => !v)}>
                  {showFullPage ? "Crop" : "Full page"}
                </Button>
              </div>
            }
          />

          <div className="checker flex-1 space-y-4 overflow-auto p-4" style={{ maxHeight: "680px" }}>
            {regions.map((r) => {
              const im = script.images.find((i) => i.id === r.imageId);
              if (!im) return null;
              return (
                <div key={r.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                    Part {r.sequenceOrder} · Page {im.pageNumber}
                  </div>
                  <div className="overflow-auto p-2">
                    {showFullPage ? (
                      <div style={{ width: `${zoom * 100}%` }}>
                        <PageImage image={im} highlight={r.bbox} />
                      </div>
                    ) : (
                      <RegionCrop image={im} rect={r.bbox} zoom={zoom} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Right: Transcript & Flags */}
        <div className="space-y-4 lg:col-span-6">
          <Card>
            <CardHeader
              title={`Transcript v${curVersion.version}`}
              right={
                <div className="flex items-center gap-2">
                  <ApprovalBadge s={curVersion.approvalStatus} />
                  <RoutingBadge s={current.routingStatus} />
                </div>
              }
            />

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Versions:</span>
                  {current.versions.map((v) => (
                    <button
                      key={v.version}
                      onClick={() => setViewVersionNum(v.version)}
                      className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${
                        v.version === curVersion.version ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      v{v.version}
                    </button>
                  ))}
                </div>
                {curVersion.approvalStatus === "APPROVED" && curVersion.version === current.activeVersion && (
                  <Button size="sm" onClick={() => setNewVerModal(true)}>
                    Edit (create v{current.activeVersion + 1})
                  </Button>
                )}
              </div>

              {current.blankDetected && !current.blankConfirmed && current.routingStatus !== "NOT_ATTEMPTED" && (
                <Alert tone="blue" title="Blank answer detected">
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => actions.confirmBlank(current.id)}>
                      Confirm blank attempt
                    </Button>
                    <Button size="sm" onClick={() => actions.markNotAttempted(current.id)}>
                      Mark not attempted
                    </Button>
                  </div>
                </Alert>
              )}

              {curVersion.flags.length > 0 && (
                <div className="space-y-2">
                  {curVersion.flags.map((f) => {
                    const meta = flagMeta[f.type];
                    return (
                      <div
                        key={f.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-xs ${
                          f.resolved ? "border-slate-200 bg-slate-50 text-slate-500" : "border-amber-200 bg-amber-50 text-slate-800"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Badge tone={f.resolved ? "green" : meta.tone}>{meta.label}</Badge>
                            {f.spanId && <span className="font-mono text-[11px]">{f.spanId}</span>}
                          </div>
                          <div>{f.message}</div>
                        </div>
                        {!f.resolved && (
                          <div className="flex gap-1.5">
                            {f.type === "UNSUPPORTED_CONTENT" && (
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => actions.routeManual(current.id, "Contains unsupported diagram.")}
                              >
                                Route to manual
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => actions.resolveFlag(current.id, f.id, "Verified by teacher.")}
                            >
                              Resolve
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {curVersion.spans.map((sp) => {
                  const lowConf = typeof sp.confidence === "number" && sp.confidence < LOW_CONFIDENCE;
                  return (
                    <div
                      key={sp.id}
                      onClick={() => setSelectedSpanId(sp.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                        selectedSpanId === sp.id ? "bg-indigo-50/60" : ""
                      }`}
                    >
                      <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{sp.id}</span>
                      <input
                        type="text"
                        disabled={!isEditable}
                        value={sp.text}
                        aria-label={`Span ${sp.id}`}
                        onChange={(e) => actions.editSpan(current.id, sp.id, e.target.value)}
                        className={`min-w-0 flex-1 rounded border px-2 py-1 text-sm ${
                          !isEditable
                            ? "border-transparent bg-transparent text-slate-800"
                            : lowConf
                              ? "border-amber-400 bg-white"
                              : "border-slate-200 bg-white"
                        }`}
                      />
                      <Badge tone={sp.confidence === "unknown" ? "slate" : lowConf ? "amber" : "green"}>
                        {sp.confidence === "unknown" ? "—" : `${Math.round(sp.confidence * 100)}%`}
                      </Badge>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">
                  {curVersion.approvalStatus === "APPROVED"
                    ? `Approved ${fmtTime(curVersion.approvedAt)}`
                    : openFlags.length > 0
                      ? `${openFlags.length} flag(s) remaining`
                      : "Ready to approve"}
                </span>
                {isEditable && (
                  <Button variant="success" size="sm" disabled={!canApprove} onClick={() => actions.approve(current.id)}>
                    Approve v{curVersion.version}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {answerRuns.length > 0 && (
            <Card>
              <CardHeader title="Downstream runs" />
              <ul className="divide-y divide-slate-100 text-xs">
                {answerRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <span>
                      {r.kind} · v{r.boundTranscriptVersion}
                    </span>
                    <Badge tone={r.isStale ? "red" : "green"}>{r.isStale ? "STALE" : "ACTIVE"}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={newVerModal}
        title={`Create version v${current.activeVersion + 1}`}
        onClose={() => setNewVerModal(false)}
        footer={
          <>
            <Button onClick={() => setNewVerModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                actions.startNewVersion(current.id, newVerReason || "Transcript edit");
                setNewVerModal(false);
              }}
            >
              Create v{current.activeVersion + 1}
            </Button>
          </>
        }
      >
        <label className="block text-xs font-medium text-slate-700">
          Reason
          <textarea
            rows={2}
            value={newVerReason}
            onChange={(e) => setNewVerReason(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          />
        </label>
      </Modal>
    </div>
  );
}
