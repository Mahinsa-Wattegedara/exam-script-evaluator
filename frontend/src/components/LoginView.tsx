"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { UserRole } from "@/lib/types";

export function LoginView() {
  const { login, register } = useStore();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [role, setRole] = useState<UserRole>("TEACHER");
  const [username, setUsername] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    setError("");
    const res =
      mode === "signin"
        ? await login(username, password, role)
        : await register({
            username,
            password,
            role,
            displayName: displayName.trim() || username.trim(),
          });
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Authentication failed.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-900">Exam Script Evaluator</h1>
          <p className="mt-1 text-xs text-slate-500">
            {mode === "signin" ? "Sign in to continue" : "Create a new account in Supabase"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">User type</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="User type">
              <button
                type="button"
                onClick={() => {
                  setRole("TEACHER");
                  setError("");
                }}
                className={`rounded-md py-1.5 text-xs font-medium transition ${
                  role === "TEACHER" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Teacher
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole("STUDENT");
                  setError("");
                }}
                className={`rounded-md py-1.5 text-xs font-medium transition ${
                  role === "STUDENT" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Student
              </button>
            </div>
          </div>

          {mode === "signup" && (
            <div>
              <label htmlFor="login-displayname" className="block text-xs font-medium text-slate-700">
                Full name
              </label>
              <input
                id="login-displayname"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={role === "TEACHER" ? "Dr. N. Perera" : "Amaya Perera"}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600"
              />
            </div>
          )}

          <div>
            <label htmlFor="login-username" className="block text-xs font-medium text-slate-700">
              {role === "STUDENT" ? "Student ID / Username" : "Username"}
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
              }}
              placeholder={role === "TEACHER" ? "dr.silva" : "245001K"}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-slate-700">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="••••••••"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={loading} className="w-full py-2 text-sm font-medium">
            {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="mt-4 text-center text-xs text-slate-500">
          {mode === "signin" ? (
            <>
              Need a new user?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                className="font-medium text-indigo-600 hover:underline"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError("");
                }}
                className="font-medium text-indigo-600 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
