"use client";
import Link from "next/link";
import { Badge, Card, MaskBadge, PageHeader, Stepper } from "@/components/ui";
import { STAGES, orderedImages, scriptStage, scriptStatus } from "@/lib/logic";
import { useStore } from "@/lib/store";

export default function ScriptsPage() {
  const { state } = useStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Scripts"
        right={
          <Link href="/upload" className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Upload scripts
          </Link>
        }
      />
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {state.scripts.map((s) => {
          const st = scriptStage(state, s);
          const status = scriptStatus(state, s);
          const imgs = orderedImages(s);
          const regions = state.regions.filter((r) => r.scriptId === s.id).length;
          return (
            <Link key={s.id} href={`/scripts/${s.id}`} className="group">
              <Card className="overflow-hidden transition group-hover:border-indigo-300 group-hover:shadow-md">
                <div className="flex gap-2 overflow-hidden bg-slate-100 px-4 pt-4">
                  {imgs.slice(0, 4).map((im) => (
                    <div key={im.id} className="relative w-24 shrink-0 overflow-hidden rounded-t border border-b-0 border-slate-300 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.originalUrl} alt="" className="h-28 w-full object-cover object-top" />
                      {im.maskStatus === "MASKED" && im.maskRect && (
                        <div
                          className="absolute bg-slate-900"
                          style={{
                            top: `${im.maskRect.y * 1.21}%`,
                            height: `${im.maskRect.height * 1.21}%`,
                            left: `${im.maskRect.x}%`,
                            width: `${im.maskRect.width}%`,
                          }}
                        />
                      )}
                      <span className="absolute bottom-1 right-1 rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-600">p{im.pageNumber}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2.5 px-4 py-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">{s.pseudonymousCode}</span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <Stepper steps={STAGES} current={st} />
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{s.images.length} pages · {regions} regions</span>
                    <MaskBadge s={imgs[0]?.maskStatus ?? "PENDING"} />
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
