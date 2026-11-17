// Image helpers (browser only).
import type { Rect, ScriptImage } from "./types";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be decoded"));
    img.src = src;
  });
}

/** Produces a header-masked copy. The original image is never modified (M1-01, M1-02). */
export async function createMaskedCopy(src: string, rect: Rect): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#111827";
  ctx.fillRect(
    (rect.x / 100) * canvas.width,
    (rect.y / 100) * canvas.height,
    (rect.width / 100) * canvas.width,
    (rect.height / 100) * canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.95);
}

/** Converts a ScriptImage into a header-masked base64 JPEG payload safe for external AI provider calls. */
export async function imageToMaskedBase64(image: ScriptImage): Promise<{ mimeType: string; base64Data: string }> {
  const dataUrl =
    image.maskStatus === "MASKED" && image.maskRect
      ? image.maskedUrl || (await createMaskedCopy(image.originalUrl, image.maskRect))
      : await (async () => {
          const img = await loadImage(image.originalUrl);
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL("image/jpeg", 0.95);
        })();

  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = header?.match(/data:([^;]+);/);
  return {
    mimeType: mimeMatch?.[1] || "image/jpeg",
    base64Data: base64Data || "",
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---- tiny IndexedDB store so uploaded files survive a page reload in the demo ----
const DB = "m1-demo-files";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putBlob(key: string, blob: Blob) {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction("files").objectStore("files").get(key);
    req.onsuccess = () => res(req.result as Blob | undefined);
    req.onerror = () => rej(req.error);
  });
}
export async function clearBlobs() {
  const db = await openDb();
  await new Promise<void>((res) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").clear();
    tx.oncomplete = () => res();
  });
}

/** Crops a normalized (0-100%) bounding box from a header-masked ScriptImage and returns base64 JPEG. */
export async function cropRegionToBase64(
  image: ScriptImage,
  rect: Rect,
): Promise<{ mimeType: string; base64Data: string }> {
  const maskedSrc =
    image.maskStatus === "MASKED" && image.maskRect
      ? image.maskedUrl || (await createMaskedCopy(image.originalUrl, image.maskRect))
      : image.originalUrl;
  const img = await loadImage(maskedSrc);
  const sx = Math.max(0, Math.floor((rect.x / 100) * img.naturalWidth));
  const sy = Math.max(0, Math.floor((rect.y / 100) * img.naturalHeight));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.ceil((rect.width / 100) * img.naturalWidth)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.ceil((rect.height / 100) * img.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  const [, base64Data = ""] = dataUrl.split(",", 2);
  return { mimeType: "image/jpeg", base64Data };
}

