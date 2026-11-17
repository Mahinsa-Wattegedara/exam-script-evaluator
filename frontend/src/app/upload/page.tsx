"use client";
import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { formatBytes, loadImage, putBlob } from "@/lib/image-utils";
import { MAX_FILE_BYTES, MAX_IMAGES_PER_SCRIPT, MAX_SCRIPTS, nowIso, pseudonym, uid } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { ScriptImage, UploadFailure } from "@/lib/types";

type Staged = {
  id: string;
  file: File;
  group: string;
  sampleKey?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  error?: string;
  progress: number;
  state: "staged" | "uploading" | "done" | "failed";
};

const OK_TYPES = ["image/jpeg", "image/png"];
const OK_EXT = /\.(jpe?g|png)$/i;

function prefixOf(name: string) {
  const base = name.replace(/\.[^.]+$/, "");
  const m = base.match(/^(.*?)[_\- ]?(p|page)?\d+$/i);
  return (m && m[1]) || base;
}

export default function UploadPage() {
  const { state, actions } = useStore();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [mode, setMode] = useState<"prefix" | "single">("prefix");
  const [target, setTarget] = useState<string>("new");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [realIds, setRealIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ ok: number; failed: number; scripts: string[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const groupKey = (s: Staged) => (mode === "prefix" ? s.group : target);

  async function validate(file: File, sampleKey?: string): Promise<Staged> {
    const st: Staged = { id: uid("stg"), file, group: prefixOf(file.name), sampleKey, progress: 0, state: "staged" };
    if (!OK_TYPES.includes(file.type) || !OK_EXT.test(file.name)) {
      st.error = `Unsupported file type (${file.type || "unknown"}). Only JPEG and PNG images are accepted.`;
    } else if (file.size > MAX_FILE_BYTES) {
      st.error = `File is ${formatBytes(file.size)}; maximum is 10 MB per image.`;
    } else {
      st.previewUrl = URL.createObjectURL(file);
      try {
        const im = await loadImage(st.previewUrl);
        st.width = im.naturalWidth;
        st.height = im.naturalHeight;
      } catch {
        st.error = "The image could not be decoded (corrupted file).";
      }
    }
    return st;
  }

  async function addFiles(files: File[], sampleKeys: (string | undefined)[] = []) {
    const out = await Promise.all(files.map((f, i) => validate(f, sampleKeys[i])));
    setStaged((p) => [...p, ...out]);
    setSummary(null);
  }

  const groups = useMemo(() => {
    const g = new Map<string, Staged[]>();
    staged.forEach((s) => {
      const k = groupKey(s);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(s);
    });
    return [...g.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, mode, target]);

  function codeFor(key: string) {
    if (mode === "single" && target !== "new") return state.scripts.find((s) => s.id === target)?.pseudonymousCode ?? "?";
    return codes[key] ?? "";
  }

  function ensureCodes() {
    const next = { ...codes };
    groups.forEach(([k]) => {
      if (!next[k]) next[k] = pseudonym();
    });
    setCodes(next);
    return next;
  }

  function moveItem(key: string, fromIdx: number, toIdx: number) {
    const groupItems = staged.filter((s) => groupKey(s) === key);
    if (toIdx < 0 || toIdx >= groupItems.length) return;
    const moved = [...groupItems];
    const [item] = moved.splice(fromIdx, 1);
    moved.splice(toIdx, 0, item);

    // Reconstruct staged array with updated group order
    const otherItems = staged.filter((s) => groupKey(s) !== key);
    setStaged([...otherItems, ...moved]);
  }

  async function upload() {
    setBusy(true);
    const c = ensureCodes();
    const work = staged.filter((s) => s.state !== "done");
    setStaged((p) => p.map((s) => (s.state !== "done" ? { ...s, state: "uploading", progress: 0 } : s)));

    for (let step = 1; step <= 10; step++) {
      await new Promise((r) => setTimeout(r, 60));
      setStaged((p) => p.map((s) => (s.state === "uploading" ? { ...s, progress: s.error ? Math.min(step * 10, 40) : step * 10 } : s)));
    }

    const failures: UploadFailure[] = [];
    const accepted = new Map<string, ScriptImage[]>();
    const finalState = new Map<string, Staged["state"]>();
    for (const [key, items] of groups) {
      const code = mode === "single" && target !== "new" ? codeFor(key) : c[key];
      let okIdx = 0;
      for (const s of items) {
        if (s.state === "done") continue;
        const err = s.error;
        if (err) {
          failures.push({ id: uid("fail"), fileName: s.file.name, scriptCode: code, reason: err, at: nowIso() });
          finalState.set(s.id, "failed");
          continue;
        }
        const blobKey = uid("blob");
        await putBlob(blobKey, s.file).catch(() => undefined);
        if (!accepted.has(key)) accepted.set(key, []);
        accepted.get(key)!.push({
          id: uid("img"),
          fileName: s.file.name,
          fileFormat: s.file.type === "image/png" ? "PNG" : "JPEG",
          fileSizeBytes: s.file.size,
          originalUrl: URL.createObjectURL(s.file),
          maskStatus: "PENDING",
          pageNumber: okIdx + 1,
          width: s.width!,
          height: s.height!,
          sampleKey: s.sampleKey,
          blobKey,
        });
        okIdx++;
        finalState.set(s.id, "done");
      }
    }
    actions.addUploads(
      [...accepted.entries()].map(([key, images]) => ({
        scriptId: mode === "single" && target !== "new" ? target : undefined,
        code: mode === "single" && target !== "new" ? codeFor(key) : c[key],
        realStudentId: realIds[key],
        paperType: "STRUCTURED",
        images,
      })),
      failures,
    );
    setStaged((p) => p.map((s) => ({ ...s, state: finalState.get(s.id) ?? s.state, progress: finalState.get(s.id) === "done" ? 100 : s.progress })));
    setSummary({ ok: [...accepted.values()].flat().length, failed: failures.length, scripts: [...accepted.keys()].map((k) => (mode === "single" && target !== "new" ? codeFor(k) : c[k])) });
    setBusy(false);
  }

  const validCount = staged.filter((s) => !s.error && s.state !== "done").length;
  const attentionCount = staged.filter((s) => s.error || s.state === "failed").length;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header (Figma 19:226) */}
      <div>
        <h1 className="font-['Plus_Jakarta_Sans'] text-3xl font-bold tracking-tight text-[color:var(--x-ink,#111827)]">
          Script images
        </h1>
        <p className="mt-1 text-sm text-[color:var(--x-secondary,#4b5563)]">
          {state.assessment.title || "Mid-semester assessment"} / 48 scripts expected
        </p>
      </div>

      {/* Script Upload Drop Zone Card (Figma 121:3166) */}
      <div className="rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-8 shadow-sm space-y-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles([...e.dataTransfer.files]);
          }}
          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 rounded-2xl p-6 transition ${
            drag ? "bg-indigo-50 border-2 border-dashed border-indigo-500" : "bg-[color:var(--x-bg,#f5f6fa)]/50 border border-slate-200"
          }`}
        >
          <div className="flex items-center gap-5">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--x-primary100,#e0e3ff)] text-[color:var(--x-primary700,#3730a3)]">
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[color:var(--x-ink,#111827)]">
                Drop JPEG or PNG images here
              </div>
              <p className="mt-1 text-xs text-[color:var(--x-secondary,#4b5563)]">
                Up to 10 images per script · 10 MB per image · Maximum 100 scripts per assessment
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => input.current?.click()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[color:var(--x-border,#e4e7ef)] bg-white px-5 text-sm font-semibold text-[color:var(--x-primary700,#3730a3)] shadow-sm hover:bg-slate-50 transition"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Browse files
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Upload Limits Chips (Figma 121:3173) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-full bg-[color:var(--x-primary50,#f0f1ff)] px-4 py-2 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)]">
            10 images per script
          </div>
          <div className="flex items-center rounded-full bg-[color:var(--x-primary50,#f0f1ff)] px-4 py-2 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)]">
            10 MB per image
          </div>
          <div className="flex items-center rounded-full bg-[color:var(--x-primary50,#f0f1ff)] px-4 py-2 text-xs font-semibold text-[color:var(--x-primary700,#3730a3)]">
            100 scripts
          </div>
        </div>
      </div>

      {summary && (
        <Alert
          tone={summary.failed ? "amber" : "green"}
          title={summary.failed ? `Batch Upload: ${summary.ok} uploaded, ${summary.failed} failed` : `Upload Complete: ${summary.ok} images uploaded`}
        >
          {summary.failed > 0 && "Successful images were saved. Fix or retry the failed files below. "}
          {summary.scripts.length > 0 && (
            <>
              Next: <Link className="font-semibold underline" href="/scripts">approve transcripts and verify answers</Link> for {summary.scripts.join(", ")}.
            </>
          )}
        </Alert>
      )}

      {/* Script Files Table Card (Figma 121:3180) */}
      <div className="overflow-hidden rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--x-border,#e4e7ef)] bg-slate-50/70 text-xs font-normal text-[color:var(--x-secondary,#4b5563)]">
              <tr>
                <th className="px-6 py-3 w-8" />
                <th className="px-2 py-3 w-12" />
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Script</th>
                <th className="px-4 py-3">Page order</th>
                <th className="px-4 py-3">Upload status</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--x-border,#e4e7ef)]">
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-xs text-slate-500">
                    No files staged yet. Drag &amp; drop handwritten script images above to begin.
                  </td>
                </tr>
              ) : (
                groups.map(([key, items]) => {
                  const hasError = items.some((i) => i.error || i.state === "failed");
                  const scriptCode = codeFor(key) || key;
                  return (
                    <Fragment key={key}>
                      {/* Script Group Header (Figma 121:3189) */}
                      <tr className={hasError ? "bg-[color:var(--x-dangerTint,#fee2e2)]/40" : "bg-[color:var(--x-primary50,#f0f1ff)]"}>
                        <td colSpan={2} className="px-6 py-3">
                          <span className="font-mono text-xs font-bold text-[color:var(--x-primary700,#3730a3)]">
                            {scriptCode}
                          </span>
                        </td>
                        <td colSpan={5} className="px-4 py-3 text-xs text-[color:var(--x-secondary,#4b5563)]">
                          {items.length} page image{items.length > 1 ? "s" : ""}{hasError ? " · Needs attention" : ""}
                        </td>
                      </tr>

                      {/* File rows */}
                      {items.map((s, idx) => {
                        const isErr = !!s.error || s.state === "failed";
                        return (
                          <tr key={s.id} className={isErr ? "bg-rose-50/40" : "hover:bg-slate-50/50 transition"}>
                            {/* Grip icon */}
                            <td className="px-6 py-4 text-slate-400">
                              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                                <circle cx="9" cy="6" r="1.5" />
                                <circle cx="15" cy="6" r="1.5" />
                                <circle cx="9" cy="12" r="1.5" />
                                <circle cx="15" cy="12" r="1.5" />
                                <circle cx="9" cy="18" r="1.5" />
                                <circle cx="15" cy="18" r="1.5" />
                              </svg>
                            </td>
                            {/* Thumbnail */}
                            <td className="px-2 py-4">
                              <div className="size-10 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                {s.previewUrl ? (
                                  <img src={s.previewUrl} alt="" className="size-full object-cover" />
                                ) : (
                                  <div className="flex size-full items-center justify-center text-slate-400 text-xs">IMG</div>
                                )}
                              </div>
                            </td>
                            {/* File Name */}
                            <td className="px-4 py-4">
                              <div className="font-semibold text-[color:var(--x-ink,#111827)]">{s.file.name}</div>
                              <div className="text-xs text-[color:var(--x-secondary,#4b5563)]">{formatBytes(s.file.size)}</div>
                              {s.error && <div className="text-xs text-rose-600 mt-1">{s.error}</div>}
                            </td>
                            {/* Script Code */}
                            <td className="px-4 py-4 font-mono text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                              {scriptCode}
                            </td>
                            {/* Page Order */}
                            <td className="px-4 py-4 text-xs text-[color:var(--x-secondary,#4b5563)]">
                              {idx + 1} of {items.length}
                            </td>
                            {/* Status Pill */}
                            <td className="px-4 py-4">
                              {s.state === "done" && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-Moderatortint,#d1fae5)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                                  <span className="size-2 rounded-full bg-emerald-500" />
                                  Uploaded
                                </span>
                              )}
                              {isErr && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-dangerTint,#fee2e2)] px-2.5 py-1 text-xs font-semibold text-rose-800">
                                  <span className="size-2 rounded-full bg-rose-500" />
                                  Invalid / Too large
                                </span>
                              )}
                              {s.state === "staged" && !isErr && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--x-bg,#f5f6fa)] px-2.5 py-1 text-xs font-semibold text-[color:var(--x-ink,#111827)]">
                                  <span className="size-2 rounded-full bg-blue-500" />
                                  Ready
                                </span>
                              )}
                              {s.state === "uploading" && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                                  Uploading ({s.progress}%)
                                </span>
                              )}
                            </td>
                            {/* Actions (Move Up / Down or Delete) */}
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveItem(key, idx, idx - 1)}
                                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                  title="Move page up"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === items.length - 1}
                                  onClick={() => moveItem(key, idx, idx + 1)}
                                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                  title="Move page down"
                                >
                                  ▼
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setStaged((p) => p.filter((x) => x.id !== s.id))}
                                  className="ml-2 rounded-lg p-1 text-rose-500 hover:bg-rose-50"
                                  title="Remove file"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Bar (Figma 121:3199) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-[color:var(--x-border,#e4e7ef)] bg-white p-6 shadow-sm">
        <p className="font-['Inter'] text-base font-semibold text-[color:var(--x-ink,#111827)]">
          {validCount} scripts ready{attentionCount > 0 ? ` · ${attentionCount} file(s) need attention` : ""}
        </p>
        <button
          onClick={upload}
          disabled={busy || validCount === 0}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[color:var(--x-primary600,#4338ca)] px-6 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy ? "Uploading…" : "Prepare answers"}
        </button>
      </div>
    </div>
  );
}
