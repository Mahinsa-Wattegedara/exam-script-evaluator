"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LoginView } from "@/components/LoginView";
import { Alert, Button } from "@/components/ui";
import { useStore } from "@/lib/store";

const TEACHER_NAV = [
  { href: "/", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/upload", label: "Upload", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" },
  { href: "/scripts", label: "Scripts", icon: "M7 3h7l5 5v13H7zM14 3v5h5" },
  { href: "/review", label: "Review", icon: "M4 6h16M4 12h10M4 18h7M17 14l2 2 4-4" },
  { href: "/contract", label: "Export contract", icon: "M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" },
];

const STUDENT_NAV = [
  { href: "/", label: "My results", icon: "M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { state, user, logout } = useStore();

  if (!user) {
    return <LoginView />;
  }

  const isTeacher = user.role === "TEACHER";
  const navItems = isTeacher ? TEACHER_NAV : STUDENT_NAV;
  const pending = state.answers.filter((a) => a.routingStatus === "NEEDS_REVIEW").length;
  const studentOnTeacherRoute = !isTeacher && path !== "/";

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-sm font-semibold text-slate-900">Exam Evaluator</div>
          <div className="text-xs text-slate-500">{isTeacher ? "Teacher workspace" : "Student portal"}</div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-3" aria-label="Navigation">
          {navItems.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon d={n.icon} />
                <span className="flex-1">{n.label}</span>
                {isTeacher && n.href === "/review" && pending > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 text-[11px] font-semibold text-amber-800">{pending}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm font-medium text-slate-700">
            {isTeacher && state.assessment.course ? (
              <>
                {state.assessment.course} · <span className="text-slate-500">{state.assessment.title}</span>
              </>
            ) : (
              <span className="text-slate-800">{state.assessment.title}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600">
              {user.displayName} <span className="text-slate-400">({user.role === "TEACHER" ? "Teacher" : "Student"})</span>
            </span>
            <button
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">
          {studentOnTeacherRoute ? (
            <div className="mx-auto max-w-md space-y-4 py-12">
              <Alert tone="red" title="Access restricted">
                This page is available only to teachers.
              </Alert>
              <Button variant="primary" onClick={() => router.push("/")}>
                Back to my results
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
