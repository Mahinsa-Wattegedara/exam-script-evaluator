"use client";
import { useEffect, useRef } from "react";
import type { ApprovalStatus, FlagType, MaskStatus, RoutingStatus } from "@/lib/types";

type Tone = "slate" | "indigo" | "green" | "amber" | "red" | "blue" | "violet";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const routingBadge: Record<RoutingStatus, { tone: Tone; label: string }> = {
  NOT_EXTRACTED: { tone: "slate", label: "Not extracted" },
  NEEDS_REVIEW: { tone: "amber", label: "Needs teacher review" },
  READY_FOR_AI: { tone: "green", label: "Approved · ready for grading" },
  MANUAL_MARKING: { tone: "violet", label: "Manual marking" },
  NOT_ATTEMPTED: { tone: "slate", label: "Not attempted" },
};
export function RoutingBadge({ s }: { s: RoutingStatus }) {
  return <Badge tone={routingBadge[s].tone}>{routingBadge[s].label}</Badge>;
}

export function ApprovalBadge({ s }: { s: ApprovalStatus }) {
  const map: Record<ApprovalStatus, Tone> = { PENDING: "amber", APPROVED: "green", SUPERSEDED: "slate" };
  return <Badge tone={map[s]}>{s}</Badge>;
}

export function MaskBadge({ s }: { s: MaskStatus }) {
  if (s === "MASKED") return <Badge tone="green">Header masked</Badge>;
  if (s === "NO_HEADER") return <Badge tone="blue">No header</Badge>;
  return <Badge tone="amber">Mask pending</Badge>;
}

export const flagMeta: Record<FlagType, { tone: Tone; label: string }> = {
  UNCLEAR_CHAR: { tone: "amber", label: "Unclear characters" },
  MISSING_PAGE: { tone: "red", label: "Missing page / region" },
  UNSUPPORTED_CONTENT: { tone: "violet", label: "Unsupported content" },
  BLANK_ANSWER: { tone: "blue", label: "Blank answer detected" },
  EXTRACTION_FAILED: { tone: "red", label: "Extraction failed" },
};

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; req?: string[]; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "success"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className = "", ...p }: BtnProps) {
  const v = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
    secondary: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50 disabled:text-rose-300",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed ${v} ${s} ${className}`} />;
}

export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Script lifecycle">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current - 1;
        return (
          <li key={s} className="flex items-center gap-1" title={s}>
            <span
              className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                done ? (now ? "bg-indigo-600 text-white" : "bg-emerald-500 text-white") : "bg-slate-200 text-slate-500"
              }`}
            >
              {done && !now ? "✓" : i + 1}
            </span>
            {i < steps.length - 1 && <span className={`h-0.5 w-4 ${i < current - 1 ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      {body && <p className="mt-1 max-w-md text-xs text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    ref.current?.querySelector<HTMLElement>("textarea,input,button")?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} className={`w-full ${maxWidth} rounded-xl bg-white shadow-xl max-h-[92vh] flex flex-col`}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5 text-sm font-semibold">
          <span>{title}</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-slate-700">{children}</div>
        {footer && <div className="shrink-0 flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "green"; title: string; children?: React.ReactNode }) {
  const c = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-rose-200 bg-rose-50 text-rose-900",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${c}`} role={tone === "red" ? "alert" : "status"}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-[13px] opacity-90">{children}</div>}
    </div>
  );
}

export function fmtTime(iso?: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

