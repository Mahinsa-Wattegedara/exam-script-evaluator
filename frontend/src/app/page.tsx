"use client";
import Link from "next/link";
import { StudentDashboard } from "@/components/StudentDashboard";
import { Badge, Button, Card, CardHeader, PageHeader, Stepper, fmtTime } from "@/components/ui";
import { STAGES, orderedImages, scriptStage, scriptStatus } from "@/lib/logic";
import { useStore } from "@/lib/store";

export default function Overview() {
  const { state, user, actions } = useStore();
  if (user?.role === "STUDENT") {
    return <StudentDashboard />;
  }
  const { answers, scripts, assessment } = state;
  const count = (f: (s: (typeof answers)[number]["routingStatus"]) => boolean) => answers.filter((a) => f(a.routingStatus)).length;

  const awaitingReviewCount =
    count((s) => s === "NEEDS_REVIEW") +
    scripts.filter((s) => {
      if (s.paperType !== "MCQ" || !s.mcqExtraction || s.mcqExtraction.verified) return false;
      return s.mcqExtraction.items.some(
        (i) =>
          i.selectedOption === "BLANK" ||
          i.selectedOption === "MULTIPLE" ||
          (typeof i.confidence === "number" && i.confidence < 0.8),
      );
    }).length;

  const approvedCount =
    count((s) => s === "READY_FOR_AI") +
    scripts.filter((s) => s.paperType === "MCQ" && s.mcqExtraction?.verified).length;

  const stats = [
    { label: "Scripts", value: `${scripts.length}`, tone: "text-slate-900" },
    { label: "Awaiting review", value: `${awaitingReviewCount}`, tone: "text-amber-600" },
    { label: "Approved", value: `${approvedCount}`, tone: "text-emerald-600" },
    { label: "Manual / skipped", value: `${count((s) => s === "MANUAL_MARKING" || s === "NOT_ATTEMPTED")}`, tone: "text-violet-600" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        right={
          <div className="flex gap-2">
            <Link href="/upload" className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              Upload scripts
            </Link>
            <Link href="/review" className="rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              Review transcripts
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="px-4 py-3.5">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${s.tone}`}>{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Scripts" />
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Script</th>
                <th className="px-3 py-2 font-medium">Pages</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Progress</th>
                <th className="px-3 py-2 font-medium">Answers</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scripts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-500">
                    No scripts uploaded yet.
                  </td>
                </tr>
              ) : (
                scripts.map((s) => {
                  const st = scriptStage(state, s);
                  const status = scriptStatus(state, s);
                  const ans = answers.filter((a) => a.scriptId === s.id);
                  const approved = ans.filter((a) => a.routingStatus !== "NEEDS_REVIEW").length;
                  const answersCol =
                    s.paperType === "MCQ"
                      ? s.mcqExtraction
                        ? `${s.mcqExtraction.items.length} MCQs`
                        : "—"
                      : ans.length
                        ? `${approved}/${ans.length}`
                        : "—";
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="font-mono text-[13px] font-semibold">{s.pseudonymousCode}</div>
                        <div className="text-[11px] text-slate-400">{fmtTime(s.uploadedAt)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-700">
                        {orderedImages(s).length} pages
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Stepper steps={STAGES} current={st} />
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{answersCol}</td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/scripts/${s.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader
            title="Questions"
            right={
              <Button size="sm" onClick={() => actions.addQuestion()}>
                + Add question
              </Button>
            }
          />
          {assessment.questions.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-500">
              No questions added yet. Click &ldquo;+ Add question&rdquo; or run AI Auto-Segment on an uploaded script.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {assessment.questions.map((q) => (
                <li key={q.id} className="flex gap-3 px-5 py-2.5 text-sm">
                  <span className="font-mono font-semibold text-indigo-600">{q.number}</span>
                  <span className="flex-1 text-slate-700">{q.prompt}</span>
                  <span className="text-xs text-slate-400">{q.maxMarks}m</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
