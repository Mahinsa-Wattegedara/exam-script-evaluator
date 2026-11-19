"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Modal } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { DemoAccount, RuntimeSettings } from "@/lib/types";

const ACCOUNTS_KEY = "scriptx-admin-demo-accounts-v1";
const RUNTIME_KEY = "scriptx-admin-runtime-v1";

const DEFAULT_DEMO_ACCOUNTS: DemoAccount[] = [
  { id: "acc-teacher-01", name: "Demo Teacher1", identifier: "teacher.01", role: "Teacher", status: "Active" },
  { id: "acc-student-014", name: "S. Fernando", identifier: "student.014", role: "Student", status: "Active" },
  { id: "acc-student-021", name: "N. Silva", identifier: "student.021", role: "Student", status: "Active" },
  { id: "acc-admin-01", name: "Demo administrator", identifier: "admin.01", role: "Administrator", status: "Active" },
];

const DEFAULT_RUNTIME: RuntimeSettings = {
  maxBudgetUsd: "USD 5.00",
  estimatedSpendUsd: "USD 3.20",
  modelProfile: "Standard evaluation profile · version 3",
  retryPolicy: "One retry per model step",
  retentionDays: 90,
};

const RETENTION_OPTIONS = [30, 60, 90, 180, 365] as const;

function formatBudgetDenominator(raw: string): string {
  const num = raw.replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(num);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "5.00";
}

function AdminDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: "dashboard" | "accounts" | "runtime" =
    rawTab === "accounts" ? "accounts" : rawTab === "runtime" ? "runtime" : "dashboard";

  const { user } = useStore();

  const [accounts, setAccounts] = useState<DemoAccount[]>(DEFAULT_DEMO_ACCOUNTS);
  const [runtime, setRuntime] = useState<RuntimeSettings>(DEFAULT_RUNTIME);
  const [hydrated, setHydrated] = useState(false);

  // Accounts modal state
  const [addOpen, setAddOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<DemoAccount | null>(null);
  const [formName, setFormName] = useState("");
  const [formIdentifier, setFormIdentifier] = useState("");
  const [formRole, setFormRole] = useState<DemoAccount["role"]>("Student");
  const [formStatus, setFormStatus] = useState<DemoAccount["status"]>("Active");
  const [formError, setFormError] = useState("");

  // Save feedback
  const [runtimeSavedMsg, setRuntimeSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedAccounts = localStorage.getItem(ACCOUNTS_KEY);
      if (savedAccounts) {
        const parsed = JSON.parse(savedAccounts) as DemoAccount[];
        if (Array.isArray(parsed) && parsed.length > 0) setAccounts(parsed);
      }
      const savedRuntime = localStorage.getItem(RUNTIME_KEY);
      if (savedRuntime) {
        const parsedRt = JSON.parse(savedRuntime) as Partial<RuntimeSettings>;
        setRuntime((prev) => ({ ...prev, ...parsedRt }));
      }
    } catch {
      // Ignore storage parse failures and keep defaults
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch {
      // Ignore quota errors
    }
  }, [accounts, hydrated]);

  function openTab(tab: "dashboard" | "accounts" | "runtime") {
    setRuntimeSavedMsg(null);
    router.push(`/?tab=${tab}`);
  }

  function openAddModal() {
    setFormName("");
    setFormIdentifier("");
    setFormRole("Student");
    setFormStatus("Active");
    setFormError("");
    setAddOpen(true);
  }

  function openManageModal(acc: DemoAccount) {
    setEditingAccount(acc);
    setFormName(acc.name);
    setFormIdentifier(acc.identifier);
    setFormRole(acc.role);
    setFormStatus(acc.status);
    setFormError("");
  }

  function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = formName.trim();
    const cleanId = formIdentifier.trim();
    if (!cleanName || !cleanId) {
      setFormError("Both display name and demo identifier are required.");
      return;
    }

    if (editingAccount) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === editingAccount.id
            ? { ...a, name: cleanName, identifier: cleanId, role: formRole, status: formStatus }
            : a,
        ),
      );
      setEditingAccount(null);
    } else {
      setAccounts((prev) => [
        ...prev,
        {
          id: `acc-${Date.now().toString(36)}`,
          name: cleanName,
          identifier: cleanId,
          role: formRole,
          status: formStatus,
        },
      ]);
      setAddOpen(false);
    }
  }

  function handleDeleteAccount(id: string) {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setEditingAccount(null);
  }

  function handleSaveRuntime(e: React.FormEvent) {
    e.preventDefault();
    try {
      localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
    } catch {
      // Ignore quota errors
    }
    setRuntimeSavedMsg(
      `Saved runtime settings: ${runtime.maxBudgetUsd || "USD 5.00"} batch budget and ${runtime.retentionDays}-day retention window.`,
    );
  }

  /* --------------------------------------------------------------------------
   * VIEW 1: Administrator Dashboard (Figma 219:4146)
   * -------------------------------------------------------------------------- */
  if (activeTab === "dashboard") {
    return (
      <div className="space-y-6 max-w-6xl">
        {/* Profile Greeting */}
        <div className="flex items-center gap-4">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-indigo-100 bg-indigo-50">
            <img
              src="/student-avatar.png"
              alt={user?.displayName || "Demo Admin1"}
              className="size-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          </div>
          <div className="min-w-0">
            <h1 className="font-['Plus_Jakarta_Sans'] text-2xl sm:text-[32px] font-bold leading-tight text-[#111827]">
              Good day, {user?.displayName || "Demo Admin1"}
            </h1>
            <p className="mt-1 text-sm text-[#6b7280]">
              Administrator &nbsp;·&nbsp; ScriptX administration
            </p>
          </div>
        </div>

        {/* Navigation Action Cards */}
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#e4e7ef] bg-white p-5 sm:p-6 shadow-2xs">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-[#111827]">Demonstration accounts</h2>
              <p className="text-sm text-[#6b7280]">
                Manage the accounts used to demonstrate ScriptX.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openTab("accounts")}
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl bg-[#4338ca] px-6 text-sm sm:text-base font-semibold text-white hover:bg-[#3730a3] transition cursor-pointer"
            >
              Open accounts
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#e4e7ef] bg-white p-5 sm:p-6 shadow-2xs">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-[#111827]">Runtime and retention</h2>
              <p className="text-sm text-[#6b7280]">
                Data is kept for {runtime.retentionDays} days after an assessment closes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openTab("runtime")}
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl border border-[#e4e7ef] bg-white px-6 text-sm sm:text-base font-semibold text-[#3730a3] hover:bg-slate-50 transition cursor-pointer"
            >
              Open settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------------------
   * VIEW 2: Demonstration Accounts (Figma 124:797)
   * -------------------------------------------------------------------------- */
  if (activeTab === "accounts") {
    return (
      <div className="space-y-6 max-w-6xl">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-2xl sm:text-[32px] font-bold leading-tight text-[#111827]">
              Demonstration accounts
            </h1>
            <p className="mt-1.5 text-sm sm:text-base text-[#4b5563]">
              Prototype environment · Account and role management
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#4338ca] px-6 text-sm sm:text-base font-semibold text-white hover:bg-[#3730a3] transition cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
            </svg>
            Add demo account
          </button>
        </div>

        {/* Warning Banner (NFR-01 / Admin Boundary) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-[#fef3c7] p-5 sm:p-6">
          <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-[#d97706]" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="flex-1 text-sm sm:text-base text-[#111827]">
            Project administration does not grant access to course scripts, marking decisions, or student marks.
          </p>
          <button
            type="button"
            onClick={() => openTab("runtime")}
            className="shrink-0 text-left text-sm sm:text-base font-semibold text-[#3730a3] hover:underline cursor-pointer"
          >
            Open remaining work
          </button>
        </div>

        {/* Demo Accounts Table Card */}
        <div className="overflow-hidden rounded-2xl border border-[#e4e7ef] bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e4e7ef] bg-[#f9fafb] text-[13px] font-semibold text-[#6b7280]">
                  <th className="px-6 py-2.5">Name</th>
                  <th className="px-6 py-2.5">Demo identifier</th>
                  <th className="px-6 py-2.5">Role</th>
                  <th className="px-6 py-2.5">Status</th>
                  <th className="px-6 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e7ef] text-[15px] text-[#111827]">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-5 font-medium whitespace-nowrap">{acc.name}</td>
                    <td className="px-6 py-5 font-mono text-sm text-[#374151] whitespace-nowrap">{acc.identifier}</td>
                    <td className="px-6 py-5 whitespace-nowrap">{acc.role}</td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                          acc.status === "Active"
                            ? "bg-[#d1fae5] text-[#111827]"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <span
                          className={`size-2 rounded-full ${
                            acc.status === "Active" ? "bg-[#10b981]" : "bg-slate-400"
                          }`}
                        />
                        {acc.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openManageModal(acc)}
                        className="font-medium text-[#111827] hover:text-[#4338ca] transition cursor-pointer"
                      >
                        Manage account →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-sm text-[#6b7280]">
          Demonstration identities shown. No course results are available outside teacher workflows.
        </p>

        {/* Add / Manage Account Modal */}
        <Modal
          open={addOpen || Boolean(editingAccount)}
          title={editingAccount ? `Manage ${editingAccount.name}` : "Add demonstration account"}
          onClose={() => {
            setAddOpen(false);
            setEditingAccount(null);
          }}
        >
          <form onSubmit={handleSaveAccount} className="space-y-4">
            {formError && <Alert tone="red" title="Validation">{formError}</Alert>}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Display name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. K. Perera"
                className="w-full h-11 rounded-xl border border-[#e4e7ef] px-3 text-sm text-[#111827] focus:border-[#4338ca] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Demo identifier</label>
              <input
                type="text"
                value={formIdentifier}
                onChange={(e) => setFormIdentifier(e.target.value)}
                placeholder="e.g. student.032"
                className="w-full h-11 rounded-xl border border-[#e4e7ef] px-3 font-mono text-sm text-[#111827] focus:border-[#4338ca] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as DemoAccount["role"])}
                  className="w-full h-11 rounded-xl border border-[#e4e7ef] bg-white px-3 text-sm text-[#111827] focus:border-[#4338ca] focus:outline-none"
                >
                  <option value="Teacher">Teacher</option>
                  <option value="Student">Student</option>
                  <option value="Administrator">Administrator</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as DemoAccount["status"])}
                  className="w-full h-11 rounded-xl border border-[#e4e7ef] bg-white px-3 text-sm text-[#111827] focus:border-[#4338ca] focus:outline-none"
                >
                  <option value="Active">Active</option>
                  <option value="Paused">Paused</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              {editingAccount && accounts.length > 1 ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => handleDeleteAccount(editingAccount.id)}
                >
                  Remove account
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAddOpen(false);
                    setEditingAccount(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {editingAccount ? "Save changes" : "Add account"}
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  /* --------------------------------------------------------------------------
   * VIEW 3: Runtime and Retention Settings (Figma 124:929)
   * -------------------------------------------------------------------------- */
  const budgetDenom = formatBudgetDenominator(runtime.maxBudgetUsd);

  return (
    <form onSubmit={handleSaveRuntime} className="space-y-6 max-w-6xl">
      {/* Page Header */}
      <div>
        <h1 className="font-['Plus_Jakarta_Sans'] text-2xl sm:text-[32px] font-bold leading-tight text-[#111827]">
          Runtime settings
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-[#4b5563]">
          Demonstration environment · Changes apply to new grading runs
        </p>
      </div>

      {runtimeSavedMsg && (
        <Alert tone="green" title="Settings saved">
          {runtimeSavedMsg}
        </Alert>
      )}

      {/* Top Grid: Budget Input + Current Batch */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 rounded-2xl border border-[#e4e7ef] bg-white p-6 space-y-3 shadow-2xs">
          <h2 className="text-base font-semibold text-[#111827]">
            Maximum model-call budget per batch
          </h2>
          <div className="space-y-2 max-w-[448px]">
            <label
              htmlFor="batch-budget-input"
              className="block text-sm font-semibold text-[#111827]"
            >
              Batch budget limit
            </label>
            <input
              id="batch-budget-input"
              type="text"
              value={runtime.maxBudgetUsd}
              onChange={(e) => {
                setRuntimeSavedMsg(null);
                setRuntime((prev) => ({ ...prev, maxBudgetUsd: e.target.value }));
              }}
              placeholder="USD 5.00"
              className="h-12 w-full rounded-xl border border-[#e4e7ef] bg-white px-3.5 text-base text-[#111827] focus:border-[#4338ca] focus:outline-none transition"
            />
          </div>
        </div>

        <div className="lg:col-span-4 rounded-2xl border border-[#e4e7ef] bg-white p-6 space-y-2 shadow-2xs">
          <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[#111827]">
            Current batch
          </h2>
          <p className="text-base text-[#111827]">
            {runtime.estimatedSpendUsd} / {budgetDenom} estimated
          </p>
          <p className="text-sm text-[#6b7280] leading-relaxed">
            New calls stop when the configured budget is reached.
          </p>
        </div>
      </div>

      {/* Policy Fields Card */}
      <div className="rounded-2xl border border-[#e4e7ef] bg-white p-6 space-y-4 text-base text-[#4b5563] shadow-2xs">
        <p>Model configuration — {runtime.modelProfile}</p>
        <p>Retry policy — {runtime.retryPolicy}</p>
      </div>

      {/* Retention and Deletion Card */}
      <div className="rounded-2xl border border-[#e4e7ef] bg-white p-6 space-y-3 shadow-2xs">
        <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-semibold text-[#111827]">
          Retention and deletion
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-base text-[#4b5563]">
          <label htmlFor="retention-days-select">Retain data after assessment closure —</label>
          <select
            id="retention-days-select"
            value={runtime.retentionDays}
            onChange={(e) => {
              setRuntimeSavedMsg(null);
              setRuntime((prev) => ({ ...prev, retentionDays: Number(e.target.value) }));
            }}
            className="rounded-lg border border-[#e4e7ef] bg-white px-2.5 py-1 text-sm font-semibold text-[#111827] focus:border-[#4338ca] focus:outline-none cursor-pointer"
          >
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-[#6b7280]">
          Authorized deletion removes active scripts and derived content within 24 hours after the retention window.
        </p>
      </div>

      {/* Submit Action */}
      <div className="flex justify-end">
        <button
          type="submit"
          className="h-12 w-full sm:w-[264px] rounded-xl bg-[#4338ca] px-6 text-base font-semibold text-white hover:bg-[#3730a3] transition cursor-pointer"
        >
          Save settings
        </button>
      </div>
    </form>
  );
}

export function AdminDashboard() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading administrator workspace...</div>}>
      <AdminDashboardContent />
    </Suspense>
  );
}
