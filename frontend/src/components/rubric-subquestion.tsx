"use client";

import { Badge, Button, Card } from "@/components/ui";
import type { RubricCriterion, RubricSubquestion } from "@/lib/types";

type Props = {
  part: RubricSubquestion;
  points: RubricCriterion[];
  structured: boolean;
  onPartChange: (changes: Partial<RubricSubquestion>) => void;
  onPointChange: (id: string, changes: Partial<RubricCriterion>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRemoveSubtopic?: () => void;
};

const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100";

export function RubricSubquestionEditor({ part, points, structured, onPartChange, onPointChange, onAdd, onRemove, onRemoveSubtopic }: Props) {
  const allocated = Number(points.reduce((sum, point) => sum + point.maxMarks, 0).toFixed(2));
  const balanced = Math.abs(allocated - part.maxMarks) < 0.001;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100 bg-indigo-50/60 px-5 py-4">
        <h3 className="text-lg font-semibold text-indigo-950">{part.label}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">Full marks
            <input aria-label={`${part.label} full marks`} type="number" step="0.5" min="0.5" value={part.maxMarks} onChange={e => onPartChange({maxMarks: Number(e.target.value)})} className={`${input} !w-20 text-center font-semibold`} />
          </label>
          {onRemoveSubtopic && <Button type="button" variant="danger" size="sm" aria-label={`Remove subtopic ${part.label}`} onClick={onRemoveSubtopic}>Remove subtopic</Button>}
        </div>
      </div>
      <div className="space-y-4 p-5">
        <label className="block text-xs font-semibold text-slate-600">Question
          <textarea aria-label={`${part.label} question`} rows={2} value={part.prompt} onChange={e => onPartChange({prompt:e.target.value})} className={`${input} mt-2`} />
        </label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-slate-800">Original answer from marking script</h4><span className="text-xs text-slate-500">{part.maxMarks} marks</span></div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{part.originalAnswer || "No original answer saved. Regenerate from your script, or enter it below."}</p>
          <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer text-indigo-700">Correct extracted answer</summary><textarea aria-label={`${part.label} original answer`} rows={6} value={part.originalAnswer} onChange={e => onPartChange({originalAnswer:e.target.value})} className={`${input} mt-3`} /></details>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 px-5 py-3">
        <div><h4 className="text-sm font-semibold text-slate-900">How the {part.maxMarks} marks are divided</h4><p className="mt-1 text-xs text-slate-500">Award each row once. A common alternative earns the same marks as the original point.</p></div>
        <Badge tone={balanced ? "green" : "amber"}>{allocated} / {part.maxMarks} allocated</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] table-fixed text-left">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-[43%] px-5 py-3 font-semibold">Point from original answer</th><th className="w-20 px-2 py-3 font-semibold">Marks</th><th className="px-5 py-3 font-semibold">Common alternative answers</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{points.map((point, index) => (
            <tr key={point.id} className="align-top">
              <td className="space-y-2 px-5 py-4">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Point {index + 1}</span>
                <textarea aria-label={`${part.label} point ${index+1} original excerpt`} rows={3} value={point.sourceExcerpt ?? point.description} onChange={e => onPointChange(point.id, structured ? {sourceExcerpt:e.target.value} : {description:e.target.value})} className={input} />
                <details className="text-xs text-slate-500"><summary className="cursor-pointer text-indigo-700">Scoring guidance</summary>
                  <label className="mt-3 block">Award marks for<textarea aria-label={`${point.id} marking guidance`} rows={3} value={point.description} onChange={e => onPointChange(point.id,{description:e.target.value})} className={`${input} mt-1`} /></label>
                  {(point.scoringGuide || []).map((rule,i) => <label key={rule.marks} className="mt-3 block">{rule.marks} marks<textarea aria-label={`${point.id} rule for ${rule.marks} marks`} rows={3} value={rule.description} onChange={e => onPointChange(point.id,{scoringGuide:point.scoringGuide?.map((item,j) => j===i ? {...item,description:e.target.value}:item)})} className={`${input} mt-1`} /></label>)}
                  {!point.scoringGuide && <Button size="sm" className="mt-2" onClick={() => onPointChange(point.id,{scoringGuide:point.allowedPartialCredits.map(marks => ({marks,description:""}))})}>Add score explanations</Button>}
                  <label className="mt-3 block">Allowed scores<input aria-label={`${point.id} allowed scores`} key={`${point.id}-${point.maxMarks}`} defaultValue={point.allowedPartialCredits.join(", ")} onBlur={e => { const scores = [...new Set(e.target.value.split(',').map(v=>v.trim()).filter(Boolean).map(Number).filter(Number.isFinite))]; onPointChange(point.id,{allowedPartialCredits:scores,scoringGuide:scores.map(marks => point.scoringGuide?.find(rule=>rule.marks===marks) || {marks,description:""})}); }} className={`${input} mt-1`} /></label>
                </details>
                <button onClick={() => onRemove(point.id)} className="text-xs text-slate-400 hover:text-rose-600" aria-label={`Remove ${part.label} point ${index+1}`}>Remove point</button>
              </td>
              <td className="px-2 py-4"><input aria-label={`${part.label} point ${index+1} marks`} type="number" step="0.5" min="0.5" value={point.maxMarks} onChange={e => { const value = Number(e.target.value); const scores=[...new Set([...Array.from({length:Math.min(100,Math.max(0,Math.floor(value)))+1},(_,i)=>i),value])]; onPointChange(point.id,{maxMarks:value,allowedPartialCredits:scores,scoringGuide:scores.map(marks=>point.scoringGuide?.find(rule=>rule.marks===marks)||{marks,description:""})}); }} className={`${input} px-2 text-center font-semibold`} /></td>
              <td className="px-5 py-4"><textarea aria-label={`${part.label} point ${index+1} alternatives`} rows={5} key={`${point.id}-${point.acceptedAlternatives.join('|')}`} defaultValue={point.acceptedAlternatives.join('\n')} onBlur={e => onPointChange(point.id,{acceptedAlternatives:e.target.value.split('\n').map(v=>v.trim()).filter(Boolean)})} placeholder="A common equivalent answer for this specific point. One alternative per line." className={input} /><p className="mt-2 text-[11px] text-slate-400">Equivalent meaning · no extra marks</p></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-3"><Button size="sm" onClick={onAdd}>+ Add marking point to {part.label}</Button></div>
    </Card>
  );
}
