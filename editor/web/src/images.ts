const MAX_EDGE = 2400;

function slug(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cleanName(original: string, ext: string): string {
  let base = original.replace(/\.[^.]+$/, '');
  base = slug(base);
  if (!base || /^(img|image|photo|pxl|dsc|screenshot)?-?\d*$/.test(base) || base.length < 2) base = 'image';
  base = base.slice(0, 40).replace(/-+$/, '');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${base}-${stamp}-${rnd}.${ext}`;
}

async function decode(file: Blob): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return { w: bmp.width, h: bmp.height, draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h) };
  } catch {
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h) });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}

export interface PreparedImage {
  blob: Blob;
  name: string;
}

/** Downscales big photos (long edge 2400px), keeps PNG as PNG, otherwise JPEG at 0.85. Animated/vector formats pass through. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const type = file.type || '';
  if (type === 'image/gif' || type === 'image/svg+xml') {
    const ext = type === 'image/gif' ? 'gif' : 'svg';
    return { blob: file, name: cleanName(file.name, ext) };
  }
  const isPng = type === 'image/png';
  const dec = await decode(file);
  if (!dec) {
    const ext = isPng ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    return { blob: file, name: cleanName(file.name, ext) };
  }
  const long = Math.max(dec.w, dec.h);
  const scale = long > MAX_EDGE ? MAX_EDGE / long : 1;
  const passthrough = scale === 1 && (isPng || type === 'image/webp' || (type === 'image/jpeg' && file.size < 1.5 * 1024 * 1024));
  if (passthrough) return { blob: file, name: cleanName(file.name, isPng ? 'png' : type === 'image/webp' ? 'webp' : 'jpg') };
  const w = Math.round(dec.w * scale);
  const h = Math.round(dec.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (!isPng) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  dec.draw(ctx, w, h);
  const outType = isPng ? 'image/png' : 'image/jpeg';
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), outType, 0.85),
  );
  return { blob, name: cleanName(file.name, isPng ? 'png' : 'jpg') };
}
