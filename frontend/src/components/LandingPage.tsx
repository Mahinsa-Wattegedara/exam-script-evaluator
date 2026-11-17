"use client";
import Link from "next/link";
import React from "react";

interface LandingPageProps {
  onLogin: () => void;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] text-[#111827] flex flex-col font-sans selection:bg-[#4338ca] selection:text-white">
      {/* 1. Public / Marketing Top Nav */}
      <header className="sticky top-0 z-50 bg-[#14123b] h-[72px] px-6 lg:px-12 flex items-center justify-between border-b border-indigo-950/60 shadow-md">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 group">
            <img
              src="/scriptx-logo.png"
              alt="ScriptX"
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
            />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#e0e3ff]">
            <button
              type="button"
              onClick={() => scrollTo("how-it-works")}
              className="hover:text-white transition-colors cursor-pointer"
            >
              How it works
            </button>
            <button
              type="button"
              onClick={() => scrollTo("pipeline")}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Pipeline
            </button>
            <button
              type="button"
              onClick={() => scrollTo("roles")}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Roles
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLogin}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold bg-white text-[#3730a3] hover:bg-slate-100 border border-[#e4e7ef] transition-all shadow-xs"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold bg-[#4338ca] text-white hover:bg-[#3730a3] transition-all shadow-sm"
          >
            Open ScriptX
          </button>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="bg-[#14123b] text-white pt-16 pb-24 px-6 lg:px-16 overflow-hidden relative">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Copy */}
          <div className="lg:col-span-7 flex flex-col items-start gap-6">
            <div className="inline-flex items-center gap-2 bg-[#4338ca]/30 border border-[#4338ca]/50 rounded-full px-3.5 py-1 text-xs font-semibold text-[#e0e3ff]">
              <span className="size-2 rounded-full bg-[#818cf8] animate-pulse"></span>
              Exam script evaluation
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-bold tracking-tight leading-[1.15]">
              Mark scripts from{" "}
              <span className="text-[#818cf8] underline decoration-[#4338ca] underline-offset-8">
                scheme
              </span>{" "}
              to release
            </h1>

            <p className="text-base sm:text-lg text-[rgba(224,227,255,0.9)] max-w-xl leading-relaxed">
              ScriptX guides teachers through upload, transcripts, dual marking and review — then releases results students can see.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={onLogin}
                className="px-6 py-3.5 rounded-xl font-semibold text-base bg-[#4338ca] text-white hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/25 cursor-pointer"
              >
                Log in to ScriptX
              </button>
              <button
                type="button"
                onClick={() => scrollTo("pipeline")}
                className="px-6 py-3.5 rounded-xl font-semibold text-base bg-white/10 hover:bg-white/15 text-[#e0e3ff] border border-white/20 transition-all cursor-pointer"
              >
                See the pipeline
              </button>
            </div>

            <p className="text-xs text-[rgba(224,227,255,0.7)] pt-2">
              Built for Teacher, Student and Administrator workspaces
            </p>
          </div>

          {/* Right Column: Hero Visual (Pipeline Stepper Preview) */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-full max-w-[500px] bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 text-slate-900 relative">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Progress</h3>
                  <p className="text-xs text-slate-500">Live dual-evaluation pipeline</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#dbeafe] text-blue-900">
                    <span className="size-2 rounded-full bg-blue-600"></span>
                    Evaluator A
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ffedd5] text-amber-900">
                    <span className="size-2 rounded-full bg-amber-600"></span>
                    Evaluator B
                  </span>
                </div>
              </div>

              {/* Steps Mockup */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { name: "Scheme", status: "Approved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                  { name: "Upload", status: "Extracted", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                  { name: "Transcripts", status: "Verified", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                  { name: "Marking", status: "Dual score", tone: "bg-blue-50 text-blue-700 border-blue-200" },
                  { name: "Review", status: "Needs review", tone: "bg-amber-50 text-amber-800 border-amber-300 font-bold" },
                  { name: "Release", status: "Ready", tone: "bg-slate-50 text-slate-600 border-slate-200" },
                ].map((s, idx) => (
                  <div key={idx} className={`p-2.5 rounded-xl border ${s.tone} flex flex-col gap-1`}>
                    <span className="text-xs font-semibold">{s.name}</span>
                    <span className="text-[11px] opacity-80">{s.status}</span>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span className="font-medium">Assessments pipeline · dual evaluators</span>
                <span className="font-bold text-indigo-700">6 Stages Active</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Pipeline Section */}
      <section id="pipeline" className="bg-[#eef2ff] py-20 px-6 lg:px-16 scroll-mt-12">
        <div className="max-w-7xl mx-auto flex flex-col gap-12">
          <div>
            <span className="text-xs font-bold tracking-wider uppercase text-[#4338ca]">Pipeline</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-2">
              From scheme to release in six stages
            </h2>
            <p className="text-slate-600 text-base sm:text-lg mt-2">
              Each stage maps to a screen in ScriptX — no dead ends.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                step: 1,
                title: "Scheme",
                desc: "Define questions, marks and criteria",
                icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2",
              },
              {
                step: 2,
                title: "Upload",
                desc: "Add script page images per student",
                icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
              },
              {
                step: 3,
                title: "Transcripts",
                desc: "Approve extracted text before marking",
                icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
              },
              {
                step: 4,
                title: "Marking",
                desc: "Evaluators A and B score independently",
                icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
              },
              {
                step: 5,
                title: "Review",
                desc: "Resolve disagreements in the review queue",
                icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
              },
              {
                step: 6,
                title: "Release",
                desc: "Publish marks and feedback to students",
                icon: "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z",
              },
            ].map((st) => (
              <div
                key={st.step}
                className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col items-center text-center gap-3 transition-transform hover:-translate-y-1"
              >
                <div className="size-10 rounded-xl bg-indigo-50 border border-indigo-100 text-[#4338ca] flex items-center justify-center font-bold">
                  <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={st.icon} />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{st.title}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-snug">{st.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Roles Section */}
      <section id="roles" className="bg-white py-20 px-6 lg:px-16 scroll-mt-12">
        <div className="max-w-7xl mx-auto flex flex-col gap-12">
          <div>
            <span className="text-xs font-bold tracking-wider uppercase text-[#4338ca]">Roles</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-2">Features by role</h2>
            <p className="text-slate-600 text-base sm:text-lg mt-2">
              One workspace per role — access is set on your account after log in.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Teacher */}
            <div className="p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex flex-col gap-4">
                <div className="size-12 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
                  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900">Teacher</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Run assessments through the pipeline
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Approve transcripts before marking
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Decide marks, release results, resolve student requests
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onLogin}
                className="mt-8 text-sm font-semibold text-[#4338ca] hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                Open teacher workspace →
              </button>
            </div>

            {/* Student */}
            <div className="p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex flex-col gap-4">
                <div className="size-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900">Student</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> View released marks and feedback
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Submit a review request on a question
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Track request status after release
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onLogin}
                className="mt-8 text-sm font-semibold text-[#4338ca] hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                View student results →
              </button>
            </div>

            {/* Administrator */}
            <div className="p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div className="flex flex-col gap-4">
                <div className="size-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900">Administrator</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Manage demonstration accounts
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Control runtime budget
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-600 font-bold">•</span> Set retention settings
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onLogin}
                className="mt-8 text-sm font-semibold text-[#4338ca] hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                Open admin settings →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Dual Evaluator Section */}
      <section className="bg-[#f5f6fa] py-20 px-6 lg:px-16 border-t border-slate-200/60">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 flex flex-col gap-4">
            <span className="text-xs font-bold tracking-wider uppercase text-[#4338ca]">Dual Evaluators</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Two evaluators, one teacher decision
            </h2>
            <p className="text-slate-600 text-base sm:text-lg leading-relaxed">
              Evaluator A and Evaluator B mark independently. When marks disagree, the answer enters the review queue. The teacher sets the final mark and feedback.
            </p>
          </div>

          <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#dbeafe] text-blue-900">
                <span className="size-2 rounded-full bg-blue-600"></span>
                Evaluator A
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffedd5] text-amber-900">
                <span className="size-2 rounded-full bg-amber-600"></span>
                Evaluator B
              </span>
            </div>
            <p className="text-sm font-medium text-slate-700">
              Review queue · teacher sets final mark
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Automatic escalation guarantees no score averaging or unverified marks.
            </p>
          </div>
        </div>
      </section>

      {/* 6. How it works Section */}
      <section id="how-it-works" className="bg-white py-20 px-6 lg:px-16 scroll-mt-12">
        <div className="max-w-7xl mx-auto flex flex-col gap-12">
          <div>
            <span className="text-xs font-bold tracking-wider uppercase text-[#4338ca]">How It Works</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-2">
              Start an assessment in four steps
            </h2>
            <p className="text-slate-600 text-base sm:text-lg mt-2">
              The same flow teachers use on Assessments, upload and release screens.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { num: 1, text: "Set up the assessment and marking scheme" },
              { num: 2, text: "Upload scripts and approve transcripts" },
              { num: 3, text: "Review dual-evaluator marks" },
              { num: 4, text: "Release results to students" },
            ].map((item) => (
              <div key={item.num} className="flex items-start gap-4 p-5 rounded-2xl bg-[#f5f6fa] border border-slate-200/80">
                <div className="size-9 rounded-full bg-[#e0e3ff] text-[#4338ca] font-bold flex items-center justify-center shrink-0">
                  {item.num}
                </div>
                <p className="text-sm font-semibold text-slate-800 leading-snug pt-1">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Final CTA Section */}
      <section className="bg-[#14123b] text-white py-16 px-6 lg:px-16 border-t border-indigo-950">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="text-2xl font-bold text-white">Continue in your workspace</h3>
            <p className="text-sm text-[rgba(224,227,255,0.9)] mt-1">
              Log in with your work account. Role is set on your profile.
            </p>
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="px-8 py-3.5 rounded-xl font-semibold text-base bg-[#4338ca] text-white hover:bg-indigo-700 transition-all shadow-md shrink-0 cursor-pointer"
          >
            Log in
          </button>
        </div>
      </section>

      {/* 8. Public / Marketing Footer */}
      <footer className="bg-[#14123b] text-slate-400 py-12 px-6 lg:px-16 border-t border-indigo-950/80 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start justify-between gap-8">
          <div className="flex flex-col gap-3">
            <img src="/scriptx-logo.png" alt="ScriptX" className="h-7 w-auto object-contain" />
            <p className="text-slate-400 max-w-xs">
              ScriptX — Teacher-supervised exam evaluation platform for handwritten scripts.
            </p>
          </div>

          <div className="flex flex-wrap gap-12">
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-white text-sm">Product</span>
              <button type="button" onClick={() => scrollTo("how-it-works")} className="hover:text-white text-left cursor-pointer">
                How it works
              </button>
              <button type="button" onClick={() => scrollTo("pipeline")} className="hover:text-white text-left cursor-pointer">
                Pipeline
              </button>
              <button type="button" onClick={() => scrollTo("roles")} className="hover:text-white text-left cursor-pointer">
                Roles
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-semibold text-white text-sm">Workspaces</span>
              <button type="button" onClick={onLogin} className="hover:text-white text-left cursor-pointer">
                Teacher workspace
              </button>
              <button type="button" onClick={onLogin} className="hover:text-white text-left cursor-pointer">
                Student workspace
              </button>
              <button type="button" onClick={onLogin} className="hover:text-white text-left cursor-pointer">
                Admin console
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-semibold text-white text-sm">System</span>
              <span>Help · Terms · Privacy</span>
              <span>© 2026 ScriptX. All rights reserved.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
