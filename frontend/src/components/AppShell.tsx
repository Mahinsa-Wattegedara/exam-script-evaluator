"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { LandingPage } from "@/components/LandingPage";
import { LoginView } from "@/components/LoginView";
import { Alert, Button } from "@/components/ui";
import { useStore } from "@/lib/store";

const TEACHER_NAV = [
  { href: "/", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/upload", label: "Upload", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" },
  { href: "/scripts", label: "Scripts", icon: "M7 3h7l5 5v13H7zM14 3v5h5" },
  { href: "/rubric", label: "Marking scheme", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
  { href: "/review", label: "Review queue", icon: "M4 6h16M4 12h10M4 18h7M17 14l2 2 4-4" },
  { href: "/contract", label: "Export contract", icon: "M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" },
];

const STUDENT_NAV = [
  {
    href: "/?tab=dashboard",
    tab: "dashboard",
    label: "Dashboard",
    icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z",
  },
  {
    href: "/?tab=marks",
    tab: "marks",
    label: "Marks and feedback",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    href: "/?tab=review",
    tab: "review",
    label: "Review requests",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, user, logout } = useStore();

  if (!user) {
    if (path === "/login" || searchParams.get("view") === "login") {
      return <LoginView onBack={() => router.push("/")} onSuccess={() => router.push("/")} />;
    }
    if (path === "/") {
      return <LandingPage onLogin={() => router.push("/login")} />;
    }
    return <LoginView onBack={() => router.push("/")} onSuccess={() => router.push("/")} />;
  }

  // If already authenticated and navigating to /login, redirect straight to workspace home
  useEffect(() => {
    if (user && path === "/login") {
      router.replace("/");
    }
  }, [user, path, router]);

  if (user && path === "/login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6fa]">
        <div className="text-sm font-semibold text-slate-500">Redirecting to workspace...</div>
      </div>
    );
  }

  const isTeacher = user.role === "TEACHER";
  const studentTab = searchParams.get("tab") || "dashboard";
  const pendingReviews = state.answers.filter((a) => a.routingStatus === "NEEDS_REVIEW").length;
  const studentRequestsCount = user.studentId
    ? state.reviewRequests.filter((r) => r.studentId === user.studentId).length
    : 0;

  const initials = user.displayName
    ? user.displayName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : isTeacher
      ? "TR"
      : "DS";

  // Explicit teacher-only routes. Students accessing these will see the restricted banner.
  const TEACHER_ONLY_ROUTES = ["/upload", "/scripts", "/rubric", "/review", "/contract"];
  const studentOnTeacherRoute =
    !isTeacher && TEACHER_ONLY_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));

  return (
    <div className="flex min-h-screen bg-[#f5f6fa]">
      {/* FIGMA XEYNERGY SIDEBAR */}
      <aside className="sticky top-0 flex h-screen w-[264px] shrink-0 flex-col bg-gradient-to-b from-[#14123b] via-[#14123b] to-[#2e298f] text-white z-30 shadow-lg">
        {/* Top Brand & User Card Section */}
        <div className="flex flex-col items-center gap-3 p-5 pb-3">
          {/* Brand Logo */}
          <div className="flex h-12 w-full items-center justify-center px-2">
            <Link href="/" className="flex items-center justify-center">
              <img
                src="/scriptx-logo.png"
                alt="ScriptX"
                className="h-9 w-auto max-w-[160px] object-contain"
              />
            </Link>
          </div>

          {/* User Card */}
          <div className="flex w-full flex-col items-center gap-2 rounded-2xl bg-white/5 p-3.5 border border-white/10 backdrop-blur-xs">
            <div className="relative size-11 overflow-hidden rounded-full ring-2 ring-indigo-400/50 shrink-0">
              <img
                src={isTeacher ? "/student-avatar.png" : "/student-avatar.png"}
                alt={user.displayName}
                className="size-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-white leading-tight">
                {user.displayName || (isTeacher ? "Dr. S. Silva" : "Demo Student1")}
              </div>
              <div className="mt-0.5 text-[10px] font-bold tracking-wider text-indigo-300 uppercase">
                {user.role}
              </div>
            </div>
          </div>
        </div>

        {/* Course Chip */}
        <div className="px-4 py-2">
          <div className="rounded-xl bg-[#3730a3] p-3 text-center text-xs text-white shadow-xs leading-snug">
            <div className="font-semibold text-white">Object Oriented Programming</div>
            <div className="text-indigo-200">Level 2 Semester 1</div>
            <div className="text-indigo-300 text-[11px]">2026</div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-1.5 px-4 py-3 overflow-y-auto" aria-label="Navigation">
          {isTeacher
            ? TEACHER_NAV.map((n) => {
                const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                      active
                        ? "bg-[#4338ca] text-white shadow-xs"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon d={n.icon} />
                    <span className="flex-1">{n.label}</span>
                    {n.href === "/review" && pendingReviews > 0 && (
                      <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-slate-900">
                        {pendingReviews}
                      </span>
                    )}
                  </Link>
                );
              })
            : STUDENT_NAV.map((n) => {
                const active = studentTab === n.tab;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                      active
                        ? "bg-[#4338ca] text-white shadow-xs"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon d={n.icon} />
                    <span className="flex-1">{n.label}</span>
                    {n.tab === "review" && studentRequestsCount > 0 && (
                      <span className="rounded-full bg-indigo-300/30 px-2 py-0.5 text-[10px] font-bold text-white">
                        {studentRequestsCount}
                      </span>
                    )}
                  </Link>
                );
              })}
        </nav>
      </aside>

      {/* MAIN CONTAINER */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* FIGMA XEYNERGY TOP BAR */}
        <header className="sticky top-0 z-20 flex h-18 lg:h-20 items-center justify-between border-b border-[#e4e7ef] bg-white px-8 shadow-2xs">
          {/* Breadcrumb / Title */}
          <div className="flex items-center gap-2.5 text-sm text-[#4b5563]">
            <span className="font-semibold text-[#111827]">Assessments</span>
            <span className="text-slate-400">›</span>
            <span className="text-[#6b7280]">
              {isTeacher ? "Teacher workspace" : "Student workspace"}
            </span>
          </div>

          {/* Search, Notifications & Workspace Indicator */}
          <div className="flex items-center gap-3">
            {/* Search Box */}
            <div className="relative hidden sm:flex items-center">
              <input
                type="text"
                placeholder="Search..."
                className="h-10 w-56 lg:w-72 rounded-xl border border-[#e4e7ef] bg-[#f5f6fa] pl-9 pr-3 text-xs text-slate-800 placeholder:text-[#6b7280] focus:border-indigo-500 focus:bg-white focus:outline-none transition"
              />
              <svg className="absolute left-3 size-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Bell Icon */}
            <div className="flex size-10 items-center justify-center rounded-xl border border-[#e4e7ef] text-slate-500 hover:bg-slate-50 cursor-pointer transition">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>

            {/* Role Label */}
            <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-[#4338ca]">
              {isTeacher ? "Teacher workspace" : "Student workspace"}
            </span>

            {/* Top Right Log out button */}
            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e4e7ef] bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition"
              title="Sign out of ScriptX"
            >
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-slate-500 group-hover:text-rose-600" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        </header>

        {/* PAGE CONTENT */}
        <main className="flex-1 p-6 lg:p-8">
          {studentOnTeacherRoute ? (
            <div className="mx-auto max-w-md space-y-4 py-12">
              <Alert tone="red" title="Access restricted">
                This page is available only to teachers.
              </Alert>
              <Button variant="primary" onClick={() => router.push("/")}>
                Back to Student Dashboard
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-xs text-slate-500">Loading...</div>}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}
