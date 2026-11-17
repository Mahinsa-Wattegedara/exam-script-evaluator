"use client";
// Renders a script page (or a region of it) with the header mask applied visually.
// The original image file is never altered; masking/cropping here is a view over it.
import type { Rect, ScriptImage } from "@/lib/types";

type Overlay = { id: string; rect: Rect; label: string; color: string; active?: boolean; onClick?: () => void };

export function PageImage({
  image,
  showMask = true,
  overlays = [],
  highlight,
  className = "",
  contain = false,
}: {
  image: ScriptImage;
  showMask?: boolean;
  overlays?: Overlay[];
  highlight?: Rect;
  className?: string;
  contain?: boolean;
}) {
  return (
    <div className={`relative select-none ${contain ? "h-full w-full flex items-center justify-center" : ""} ${className}`}>
      <div className={`relative ${contain ? "h-full max-h-full max-w-full flex items-center justify-center" : "w-full"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.originalUrl}
          alt={`Page ${image.pageNumber} (${image.fileName})`}
          className={contain ? "max-h-full max-w-full object-contain block" : "block h-auto w-full"}
          draggable={false}
        />
        {showMask && image.maskStatus === "MASKED" && image.maskRect && (
          <div
            className="absolute flex items-center justify-center gap-1.5 border-2 border-emerald-500 bg-slate-950/85 px-2 py-1 text-center shadow-lg backdrop-blur-[2px]"
            style={pos(image.maskRect)}
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
              ✓
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Identity Header Masked
            </span>
          </div>
        )}
        {overlays.map((o) => (
          <button
            type="button"
            key={o.id}
            onClick={o.onClick}
            className={`absolute border-2 text-left ${o.active ? "ring-4 ring-offset-0" : ""}`}
            style={{ ...pos(o.rect), borderColor: o.color, background: `${o.color}1a`, ["--tw-ring-color" as string]: `${o.color}55` }}
            aria-label={o.label}
          >
            <span className="absolute -top-0 left-0 px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: o.color }}>
              {o.label}
            </span>
          </button>
        ))}
        {highlight && <div className="pointer-events-none absolute bg-yellow-300/40 ring-2 ring-yellow-400" style={pos(highlight)} />}
      </div>
    </div>
  );
}

/** Shows only the region `rect` of the page, scaled to the container width. */
export function RegionCrop({ image, rect, highlight, zoom = 1 }: { image: ScriptImage; rect: Rect; highlight?: Rect; zoom?: number }) {
  const aspect = (rect.width * image.width) / (rect.height * image.height);
  return (
    <div style={{ width: `${zoom * 100}%` }}>
      <div className="relative w-full overflow-hidden bg-white" style={{ aspectRatio: String(aspect) }}>
        <div
          className="absolute"
          style={{
            width: `${(100 / rect.width) * 100}%`,
            left: `${(-rect.x / rect.width) * 100}%`,
            top: `${(-rect.y / rect.height) * 100}%`,
          }}
        >
          <PageImage image={image} highlight={highlight} />
        </div>
      </div>
    </div>
  );
}

export const pos = (r: Rect): React.CSSProperties => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` });

export const QUESTION_COLORS = ["#4f46e5", "#0891b2", "#c026d3", "#ea580c", "#16a34a", "#dc2626", "#7c3aed", "#0d9488", "#ca8a04", "#2563eb"];

