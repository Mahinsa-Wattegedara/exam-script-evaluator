"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!token) {
      setError("Missing or invalid password reset token. Please request a new reset link.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter them carefully.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not reset password. Your link may have expired.");
        return;
      }
      setSuccess(data.message || "Your password has been updated. You can now log in.");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not reach the authentication server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[460px] bg-white rounded-2xl p-8 shadow-[0px_1px_3px_0px_rgba(17,24,39,0.03),0px_4px_16px_0px_rgba(17,24,39,0.06)] border border-[#e4e7ef] space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-[#4338ca]">
            ScriptX Account Recovery
          </div>
          <Link href="/login" className="text-xs font-semibold text-[#4b5563] hover:text-[#111827]">
            ← Back to Log in
          </Link>
        </div>

        <div>
          <h1 className="font-heading text-2xl font-bold text-[#111827] leading-tight">
            Set a new password
          </h1>
          <p className="text-sm text-[#4b5563] mt-1">
            Choose a strong password of at least 8 characters for your ScriptX account.
          </p>
        </div>

        {!token && !success && (
          <div className="bg-[#fee2e2] border border-[#fca5a5] rounded-xl p-3.5 text-xs text-[#991b1b]">
            This recovery link is missing its token or is malformed. Request a new password reset link from the{" "}
            <Link href="/login" className="font-semibold underline">
              Log in page
            </Link>
            .
          </div>
        )}

        {error && (
          <div className="bg-[#fee2e2] border border-[#fca5a5] rounded-xl p-3.5 flex items-start gap-3 text-xs text-[#991b1b]">
            <span className="size-5 rounded-full bg-[#ef4444] text-white flex items-center justify-center font-bold shrink-0">
              !
            </span>
            <p className="leading-relaxed pt-0.5">{error}</p>
          </div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex items-start gap-3 text-xs text-emerald-900">
              <span className="size-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
                ✓
              </span>
              <p className="leading-relaxed pt-0.5">{success}</p>
            </div>
            <Link
              href="/login"
              className="w-full h-12 bg-[#4338ca] hover:bg-[#3730a3] text-white font-semibold rounded-xl text-sm transition-all shadow-sm flex items-center justify-center"
            >
              Continue to Log in →
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#111827] mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                disabled={!token || busy}
                className="w-full h-12 px-3.5 rounded-xl border border-[#e4e7ef] bg-white text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#4338ca] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#111827] mb-1">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                required
                minLength={8}
                disabled={!token || busy}
                className="w-full h-12 px-3.5 rounded-xl border border-[#e4e7ef] bg-white text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#4338ca] disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={!token || busy}
              className="w-full h-12 bg-[#4338ca] hover:bg-[#3730a3] text-white font-semibold rounded-xl text-sm transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {busy ? "Updating password..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-sm text-slate-500">
          Loading password recovery...
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
