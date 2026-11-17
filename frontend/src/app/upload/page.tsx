"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { formatBytes, loadImage, putBlob } from "@/lib/image-utils";
import { MAX_FILE_BYTES, MAX_IMAGES_PER_SCRIPT, MAX_SCRIPTS, nowIso, pseudonym, uid } from "@/lib/logic";
import { useStore } from "@/lib/store";
import type { PaperType, ScriptImage, UploadFailure } from "@/lib/types";

type Staged = {
  id: string;
  file: File;
  group: string; // grouping key (filename prefix or chosen script)
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
  const [paperType, setPaperType] = useState<PaperType>("STRUCTURED");
  const [target, setTarget] = useState<string>("new");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [realIds, setRealIds] = useState<Record<string, string>>({});
  const [simulateFailure, setSimulateFailure] = useState(false);
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
      st.error = `File is ${formatBytes(file.size)}; the maximum is 10 MB per image.`;
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

  async function loadSampleBatch() {
    const list: [string, string, string][] = [
      ["script1_page1.png", "studentA_p1.png", "s1p1"],
      ["script1_page3.png", "studentA_p3.png", "s1p3"],
      ["script1_page2.png", "studentA_p2.png", "s1p2"],
      ["script2_page1.png", "studentB_p1.png", "s2p1"],
      ["script2_page2.png", "studentB_p2.png", "s2p2"],
    ];
    const files = await Promise.all(
      list.map(async ([src, name]) => new File([await (await fetch(`/samples/${src}`)).blob()], name, { type: "image/png" })),
    );
    // two invalid files to demonstrate per-file validation
    files.push(new File(["%PDF-1.7 mock"], "studentB_p3.pdf", { type: "application/pdf" }));
    files.push(new File([new Uint8Array(11 * 1024 * 1024)], "studentA_p4.jpg", { type: "image/jpeg" }));
    await addFiles(files, [...list.map((l) => l[2]), undefined, undefined]);
  }

  // group staged files -> scripts, enforcing per-script and per-assessment limits
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

  function limitError(key: string, idx: number): string | undefined {
    const existing = mode === "single" && target !== "new" ? state.scripts.find((s) => s.id === target)?.images.length ?? 0 : 0;
    if (existing + idx + 1 > MAX_IMAGES_PER_SCRIPT) return `Script would exceed ${MAX_IMAGES_PER_SCRIPT} images.`;
    const newScripts = mode === "prefix" || target === "new" ? groups.length : 0;
    if (state.scripts.length + newScripts > MAX_SCRIPTS) return `Assessment would exceed ${MAX_SCRIPTS} scripts.`;
    void key;
    return undefined;
  }

  async function upload() {
    setBusy(true);
    const c = ensureCodes();
    const work = staged.filter((s) => s.state !== "done");
    const failSim = simulateFailure ? work.find((s) => !s.error)?.id : undefined;
    setStaged((p) => p.map((s) => (s.state !== "done" ? { ...s, state: "uploading", progress: 0 } : s)));

    // simulated transfer progress (frontend demo)
    for (let step = 1; step <= 10; step++) {
      await new Promise((r) => setTimeout(r, 120));
      setStaged((p) => p.map((s) => (s.state === "uploading" ? { ...s, progress: s.error || s.id === failSim ? Math.min(step * 10, 40) : step * 10 } : s)));
    }

    const failures: UploadFailure[] = [];
    const accepted = new Map<string, ScriptImage[]>();
    const finalState = new Map<string, Staged["state"]>();
    for (const [key, items] of groups) {
      const code = mode === "single" && target !== "new" ? codeFor(key) : c[key];
      let okIdx = 0;
      for (const s of items) {
        if (s.state === "done") continue;
        const err = s.error ?? (s.id === failSim ? "Network error: connection reset during transfer. Retry this file." : limitError(key, okIdx));
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
          pageNumber: 0,
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
        paperType,
        images,
      })),
      failures,
    );
    setStaged((p) => p.map((s) => ({ ...s, state: finalState.get(s.id) ?? s.state, progress: finalState.get(s.id) === "done" ? 100 : s.progress })));
    setSummary({ ok: [...accepted.values()].flat().length, failed: failures.length, scripts: [...accepted.keys()].map((k) => (mode === "single" && target !== "new" ? codeFor(k) : c[k])) });
    setBusy(false);
  }

  const retryFailed = () => {
    setSimulateFailure(false);
    setStaged((p) => p.filter((s) => s.state !== "done").map((s) => ({ ...s, state: "staged", progress: 0 })));
    setSummary(null);
  };

  const validCount = staged.filter((s) => !s.error && s.state !== "done").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Upload Scripts" />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
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
              className={`m-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50/50"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-indigo-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="mt-3 text-sm font-semibold text-slate-800">Drag &amp; drop script images here</div>
              <div className="mt-1 text-xs text-slate-500">JPEG or PNG • Max 10 MB per image • Up to 10 images per script • Up to 100 scripts per assessment</div>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" onClick={() => input.current?.click()}>Browse files</Button>
              </div>
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
          </Card>

          {summary && (
            <Alert tone={summary.failed ? "amber" : "green"} title={summary.failed ? `Batch PARTIAL_FAILURE: ${summary.ok} uploaded, ${summary.failed} failed` : `Batch COMPLETE: ${summary.ok} images uploaded`}>
              {summary.failed > 0 && "Successful images were kept. Fix or retry the failed files below; nothing else needs to be re-uploaded. "}
              {summary.scripts.length > 0 && (
                <>
                  Next: <Link className="font-semibold underline" href="/scripts">order pages and mask headers</Link> for {summary.scripts.join(", ")}.
                </>
              )}
            </Alert>
          )}

          <Card>
            <CardHeader
              title={`Staged files (${staged.length})`}
              sub="Each file is validated individually. A failed file never blocks the rest of the batch."
              right={
                <div className="flex gap-2">
                  {staged.some((s) => s.state === "failed") && !busy && (
                    <Button size="sm" onClick={retryFailed}>Retry failed</Button>
                  )}
                  {staged.length > 0 && !busy && (
                    <Button size="sm" variant="ghost" onClick={() => { setStaged([]); setSummary(null); }}>Clear</Button>
                  )}
                </div>
              }
            />
            {staged.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">No files staged yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {groups.map(([key, items]) => (
                  <div key={key} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">Script</span>
                      <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white">
                        {codeFor(key) || "pseudonym assigned on upload"}
                      </span>
                      {mode === "prefix" && <span className="text-xs text-slate-400">grouped from filename prefix &ldquo;{key}&rdquo;</span>}
                      {(mode === "prefix" || target === "new") && (
                        <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
                          <span>Student ID (identity map)</span>
                          <input
                            value={realIds[key] ?? ""}
                            onChange={(e) => setRealIds({ ...realIds, [key]: e.target.value })}
                            placeholder="optional, e.g. 245030X"
                            className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </label>
                      )}
                    </div>
                    <ul className="space-y-2">
                      {items.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                          <div className="h-12 w-9 shrink-0 overflow-hidden rounded border border-slate-200 bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {s.previewUrl && <img src={s.previewUrl} alt="" className="h-full w-full object-cover" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-slate-800">{s.file.name}</span>
                              <span className="text-[11px] text-slate-400">{formatBytes(s.file.size)} • {s.file.type || "unknown type"}</span>
                            </div>
                            {s.state === "uploading" && (
                              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-slate-200">
                                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${s.progress}%` }} />
                              </div>
                            )}
                            {s.error && <div className="mt-0.5 text-xs text-rose-600">{s.error}</div>}
                          </div>
                          {s.state === "done" && <Badge tone="green">SUCCESS</Badge>}
                          {s.state === "failed" && <Badge tone="red">FAILED</Badge>}
                          {s.state === "staged" && (s.error ? <Badge tone="red">Invalid</Badge> : <Badge tone="blue">Valid</Badge>)}
                          {s.state === "staged" && !busy && (
                            <Button size="sm" variant="ghost" aria-label={`Remove ${s.file.name}`} onClick={() => setStaged((p) => p.filter((x) => x.id !== s.id))}>✕</Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Paper type" sub="Select assessment script format" />
            <div className="grid grid-cols-2 gap-2 px-5 py-4">
              <button
                type="button"
                onClick={() => setPaperType("STRUCTURED")}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                  paperType === "STRUCTURED"
                    ? "border-indigo-600 bg-indigo-50 font-semibold text-indigo-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div>Handwritten / Essay</div>
                <div className="mt-0.5 text-[11px] font-normal text-slate-500">Written answers</div>
              </button>
              <button
                type="button"
                onClick={() => setPaperType("MCQ")}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                  paperType === "MCQ"
                    ? "border-indigo-600 bg-indigo-50 font-semibold text-indigo-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div>MCQ Bubble Sheet</div>
                <div className="mt-0.5 text-[11px] font-normal text-slate-500">Shaded bubble answers</div>
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Grouping" sub="How images are grouped into scripts" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "prefix"} onChange={() => setMode("prefix")} className="mt-1" />
                <span>
                  <span className="font-medium">By filename prefix</span>
                  <span className="block text-xs text-slate-500">e.g. studentA_p1.png, studentA_p2.png → one script</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "single"} onChange={() => setMode("single")} className="mt-1" />
                <span>
                  <span className="font-medium">All files into one script</span>
                  <select
                    disabled={mode !== "single"}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="new">New script (new pseudonym)</option>
                    {state.scripts.map((s) => (
                      <option key={s.id} value={s.id}>Add pages to {s.pseudonymousCode} ({s.images.length}/10)</option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader title="Upload" />
            <div className="space-y-3 px-5 py-4">
              <div className="text-sm text-slate-600">
                <b>{validCount}</b> valid file(s) in <b>{groups.length}</b> script group(s)
              </div>
              <Button variant="primary" className="w-full" disabled={busy || staged.every((s) => s.state === "done")} onClick={upload}>
                {busy ? "Uploading…" : "Upload batch"}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent upload failures" sub="Reported per file; successful images are never discarded" />
            {state.failures.length === 0 ? (
              <div className="px-5 py-4 text-xs text-slate-500">No failures.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {state.failures.slice(0, 8).map((f) => (
                  <li key={f.id} className="flex gap-2 px-5 py-2.5 text-xs">
                    <div className="flex-1">
                      <div className="font-medium text-slate-800">{f.fileName} <span className="font-mono text-slate-400">→ {f.scriptCode}</span></div>
                      <div className="text-rose-600">{f.reason}</div>
                    </div>
                    <button className="text-slate-400 hover:text-slate-700" onClick={() => actions.dismissFailure(f.id)} aria-label="Dismiss">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

