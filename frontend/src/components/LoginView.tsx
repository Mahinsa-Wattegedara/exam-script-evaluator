"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import type { UserRole } from "@/lib/types";

interface LoginViewProps {
  onBack?: () => void;
  onSuccess?: () => void;
}

export function LoginView({ onBack, onSuccess }: LoginViewProps) {
  const router = useRouter();
  const { login, register } = useStore();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [role, setRole] = useState<UserRole>("TEACHER");
  const [username, setUsername] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  function fillDemo(user: string, pass: string, r: UserRole) {
    setUsername(user);
    setPassword(pass);
    setRole(r);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username/email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res =
        mode === "signin"
          ? await login(username, password, role)
          : await register({
              username,
              password,
              role,
              displayName: displayName.trim() || username.trim(),
            });
      if (!res.ok) {
        setError(res.error || "Email or password is incorrect. Check your details and try again.");
      } else {
        if (onSuccess) {
          onSuccess();
        } else {
          router.push("/");
        }
      }
    } catch {
      setError("Could not reach authentication service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col md:flex-row items-stretch relative font-sans selection:bg-[#4338ca] selection:text-white">
      {/* 1. Left Brand Panel (Figma: Auth/Brand panel) */}
      <div className="bg-[#14123b] md:w-[480px] lg:w-[540px] shrink-0 p-8 md:p-14 flex flex-col justify-between text-white relative overflow-hidden">
        <div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#e0e3ff] hover:text-white mb-10 transition-colors cursor-pointer group"
            >
              <svg className="size-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to overview & homepage
            </button>
          )}

          <div className="flex flex-col gap-5">
            <img src="/scriptx-logo.png" alt="ScriptX" className="h-10 w-auto object-contain self-start" />
            <p className="text-base sm:text-lg text-[rgba(255,255,255,0.85)] max-w-sm leading-relaxed">
              Evaluate scripts from scheme to release.
            </p>
          </div>
        </div>

        <div className="hidden md:flex flex-col gap-4 text-xs text-[rgba(224,227,255,0.7)] pt-12 border-t border-indigo-950/80">
          <p className="font-semibold text-white">Dual-Evaluator Examination Platform</p>
          <p>
            Features bounded multi-agent grading, human teacher oversight, and privacy-preserving student identity protection (NFR-01, NFR-02).
          </p>
          <span className="text-[11px] text-slate-400">© 2026 ScriptX</span>
        </div>
      </div>

      {/* 2. Right Form Panel (Figma: Form wrap) */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[480px] bg-white rounded-2xl p-8 shadow-[0px_1px_3px_0px_rgba(17,24,39,0.03),0px_4px_16px_0px_rgba(17,24,39,0.06)] border border-[#e4e7ef] flex flex-col gap-5">
          <div>
            <h2 className="text-[28px] font-bold text-[#111827] leading-tight">
              {mode === "signin" ? "Log in" : "Create account"}
            </h2>
            <p className="text-sm text-[#4b5563] mt-1">
              Use your work account. Role is set on your profile.
            </p>
          </div>

          {/* Quick Demo Credentials */}
          <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Instant Demo Logins
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fillDemo("dr.silva", "Teacher@123", "TEACHER")}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
              >
                Teacher (Dr. Silva)
              </button>
              <button
                type="button"
                onClick={() => fillDemo("245001K", "Student@123", "STUDENT")}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
              >
                Student (Kasun)
              </button>
              <button
                type="button"
                onClick={() => fillDemo("admin", "Admin@123", "TEACHER")}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
              >
                Admin
              </button>
            </div>
          </div>

          {/* Role Pill Switcher */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Workspace Role</label>
            <div className="grid grid-cols-2 gap-2 bg-[#f5f6fa] p-1 rounded-xl border border-[#e4e7ef]">
              <button
                type="button"
                onClick={() => setRole("TEACHER")}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  role === "TEACHER"
                    ? "bg-white text-[#4338ca] shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Teacher workspace
              </button>
              <button
                type="button"
                onClick={() => setRole("STUDENT")}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  role === "STUDENT"
                    ? "bg-white text-[#4338ca] shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Student workspace
              </button>
            </div>
          </div>

          {/* Error Banner (Figma: Alert / Danger) */}
          {error && (
            <div className="bg-[#fee2e2] border border-[#fca5a5] rounded-xl p-3.5 flex items-start gap-3 text-xs text-[#991b1b]">
              <span className="size-5 rounded-full bg-[#ef4444] text-white flex items-center justify-center font-bold shrink-0">
                !
              </span>
              <p className="leading-relaxed pt-0.5">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1">Full Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={role === "TEACHER" ? "Dr. S. Silva" : "Kasun Jayawardena"}
                  className="w-full h-12 px-3.5 rounded-xl border border-[#e4e7ef] bg-white text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#4338ca]"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-[#111827] mb-1">
                {role === "STUDENT" ? "Student ID / Username" : "Work email / Username"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={role === "STUDENT" ? "245001K" : "dr.silva"}
                required
                className="w-full h-12 px-3.5 rounded-xl border border-[#e4e7ef] bg-white text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#4338ca]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-semibold text-[#111827]">Password</label>
                <button
                  type="button"
                  onClick={() => alert("Password reset instructions: Please contact your institutional administrator or verify with the provided demo credentials.")}
                  className="text-xs font-medium text-[#4338ca] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full h-12 px-3.5 rounded-xl border border-[#e4e7ef] bg-white text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#4338ca]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="size-4 rounded border-slate-300 text-[#4338ca] focus:ring-[#4338ca]"
              />
              <label htmlFor="rememberMe" className="text-xs text-[#4b5563] cursor-pointer">
                Remember me
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 mt-2 bg-[#4338ca] hover:bg-[#3730a3] text-white font-semibold rounded-xl text-sm transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Signing in...
                </>
              ) : mode === "signin" ? (
                "Log in"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <div className="flex items-center justify-between text-xs text-[#4b5563] pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
              }}
              className="text-[#4338ca] font-semibold hover:underline cursor-pointer"
            >
              {mode === "signin" ? "New here? Register account" : "Already registered? Log in"}
            </button>
            <span>Help · Terms · Privacy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
