interface AndroidNativeBridgeApi {
  requestAudioPermission?: () => boolean;
  beginSaveFile?: (fileName: string, mimeType: string) => string;
  appendSaveChunk?: (uploadId: string, base64Chunk: string) => boolean;
  finishSaveFile?: (uploadId: string) => string;
  finishShareFile?: (uploadId: string) => string;
  saveFile?: (base64Data: string, fileName: string, mimeType: string) => string;
  shareFile?: (base64Data: string, fileName: string, mimeType: string) => string;
}

function getAndroidBridge(): AndroidNativeBridgeApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AndroidNativeBridge?: AndroidNativeBridgeApi };
  return w.AndroidNativeBridge ?? null;
}

export function isAndroidNativeApp(): boolean {
  return Boolean(getAndroidBridge()?.saveFile || getAndroidBridge()?.beginSaveFile);
}

export function canShareNatively(fileName: string, mimeType: string, blob: Blob): boolean {
  if (getAndroidBridge()?.shareFile || getAndroidBridge()?.finishShareFile) return true;
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const testFile = new File([blob], fileName, { type: mimeType });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  }
  return false;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const marker = result.indexOf(';base64,');
      resolve(marker >= 0 ? result.slice(marker + 8) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function streamBlobToAndroidBridge(
  bridge: AndroidNativeBridgeApi,
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<string | null> {
  if (!bridge.beginSaveFile || !bridge.appendSaveChunk) return null;
  const uploadId = bridge.beginSaveFile(fileName, mimeType);
  if (!uploadId) return null;

  const CHUNK_SIZE = 512 * 1024; // 512 KB chunks prevent OOM on large videos
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    const slice = blob.slice(offset, Math.min(offset + CHUNK_SIZE, blob.size));
    const b64 = await blobToBase64(slice);
    const ok = bridge.appendSaveChunk(uploadId, b64);
    if (!ok) {
      throw new Error('تعذر كتابة بيانات الملف على الجهاز');
    }
  }
  return uploadId;
}

export async function saveOrDownloadBlob(
  blob: Blob,
  fileName: string,
  mimeType?: string
): Promise<{ savedNatively: boolean; ok: boolean; fileName?: string; error?: string }> {
  const bridge = getAndroidBridge();
  const safeMime = mimeType || blob.type || 'application/octet-stream';

  if (bridge?.beginSaveFile && bridge?.appendSaveChunk && bridge?.finishSaveFile) {
    try {
      const uploadId = await streamBlobToAndroidBridge(bridge, blob, fileName, safeMime);
      if (uploadId) {
        const raw = bridge.finishSaveFile(uploadId);
        const parsed = JSON.parse(raw) as { ok?: boolean; fileName?: string; error?: string };
        return {
          savedNatively: true,
          ok: Boolean(parsed.ok),
          fileName: parsed.fileName ?? fileName,
          error: parsed.error,
        };
      }
    } catch (err) {
      return {
        savedNatively: true,
        ok: false,
        error: err instanceof Error ? err.message : 'تعذر حفظ الملف',
      };
    }
  }

  if (bridge?.saveFile) {
    const base64 = await blobToBase64(blob);
    const raw = bridge.saveFile(base64, fileName, safeMime);
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean; fileName?: string; error?: string };
      return {
        savedNatively: true,
        ok: Boolean(parsed.ok),
        fileName: parsed.fileName ?? fileName,
        error: parsed.error,
      };
    } catch {
      return { savedNatively: true, ok: true, fileName };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { savedNatively: false, ok: true, fileName };
}

export async function shareBlobNatively(
  blob: Blob,
  fileName: string,
  mimeType: string,
  title = 'فيديو شورتس الأسئلة'
): Promise<boolean> {
  const bridge = getAndroidBridge();
  const safeMime = mimeType || blob.type || 'application/octet-stream';

  if (bridge?.beginSaveFile && bridge?.appendSaveChunk && bridge?.finishShareFile) {
    const uploadId = await streamBlobToAndroidBridge(bridge, blob, fileName, safeMime);
    if (uploadId) {
      const raw = bridge.finishShareFile(uploadId);
      try {
        const parsed = JSON.parse(raw) as { ok?: boolean };
        return Boolean(parsed.ok);
      } catch {
        return true;
      }
    }
  }

  if (bridge?.shareFile) {
    const base64 = await blobToBase64(blob);
    const raw = bridge.shareFile(base64, fileName, safeMime);
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean };
      return Boolean(parsed.ok);
    } catch {
      return true;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: mimeType });
    await navigator.share({ title, files: [file] });
    return true;
  }
  return false;
}
