import { soundEngine } from '../audio/soundEngine';
import { QuestionSlide, SlideAudioClip } from '../types/quiz';

export type AiVoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
export type AiVoiceMode = 'questionOnly' | 'questionAndAnswer' | 'full';

export const AI_VOICE_OPTIONS: { id: AiVoiceName; label: string }[] = [
  { id: 'Kore', label: 'كوري (واضح واحترافي)' },
  { id: 'Puck', label: 'باك (حماسي سريع)' },
  { id: 'Charon', label: 'شارون (عميق رصين)' },
  { id: 'Zephyr', label: 'زيفير (هادئ سلس)' },
  { id: 'Fenrir', label: 'فنرير (جهوري قوي)' },
];

export class AiApiError extends Error {
  public readonly status: number;
  public readonly quotaExhausted: boolean;

  constructor(message: string, status = 500, quotaExhausted = false) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.quotaExhausted = quotaExhausted;
  }
}

const ENV_MAP = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const BUILD_API_BASE = (ENV_MAP.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
const EMBEDDED_APK_GEMINI_KEYS = (() => {
  const combined = [ENV_MAP.VITE_GEMINI_API_KEY || '', ENV_MAP.VITE_GEMINI_API_KEYS || ''].join('\n');
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of combined.split(/[\s,;]+/)) {
    const clean = part.trim();
    if (!clean || clean === 'MY_GEMINI_API_KEY' || seen.has(clean)) continue;
    seen.add(clean);
    list.push(clean);
  }
  return list;
})();

const APK_COOLDOWN_STORAGE_KEY = 'apk_gemini_key_cooldowns_v1';
const apkMemoryCooldowns = new Map<string, number>();

function getApkKeyCooldowns(): Record<string, number> {
  const out: Record<string, number> = {};
  apkMemoryCooldowns.forEach((v, k) => {
    out[k] = v;
  });
  if (typeof localStorage === 'undefined') return out;
  try {
    const raw = localStorage.getItem(APK_COOLDOWN_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return { ...parsed, ...out };
  } catch {
    return out;
  }
}

function setApkKeyCooldown(apiKey: string, untilMs: number): void {
  const keyTag = apiKey.slice(-8);
  apkMemoryCooldowns.set(keyTag, untilMs);
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = getApkKeyCooldowns();
    existing[keyTag] = untilMs;
    localStorage.setItem(APK_COOLDOWN_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // ignore
  }
}

function getNextUtcResetMs(): number {
  const now = new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    5,
    0
  );
  return Math.max(60_000, nextUtcMidnight - Date.now());
}

async function runApkGeminiWithRotation<T>(apiTask: (apiKey: string) => Promise<T>): Promise<T> {
  if (EMBEDDED_APK_GEMINI_KEYS.length === 0) {
    throw new AiApiError(
      'مفتاح Gemini API غير مدمج في التطبيق.',
      0,
      false
    );
  }
  const now = Date.now();
  const cooldowns = getApkKeyCooldowns();
  const healthy = EMBEDDED_APK_GEMINI_KEYS.filter(
    (k) => (cooldowns[k.slice(-8)] ?? 0) <= now
  );
  const candidates = healthy.length > 0 ? healthy : EMBEDDED_APK_GEMINI_KEYS;

  let lastErr: unknown;
  for (const key of candidates) {
    try {
      return await apiTask(key);
    } catch (err) {
      lastErr = err;
      const raw = err instanceof Error ? err.message : String(err);
      const isDaily =
        raw.includes('PerDay') || raw.includes('per day') || raw.includes('free_tier_requests');
      const isQuotaOrRate = raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED');
      const isAuth =
        raw.includes('403') ||
        raw.includes('PERMISSION_DENIED') ||
        raw.includes('API_KEY_INVALID') ||
        raw.includes('API key not valid');

      if (isDaily) {
        setApkKeyCooldown(key, Date.now() + getNextUtcResetMs());
        continue;
      }
      if (isQuotaOrRate) {
        setApkKeyCooldown(key, Date.now() + 45_000);
        continue;
      }
      if (isAuth) {
        setApkKeyCooldown(key, Date.now() + 24 * 60 * 60_000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function isNativeApkRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    AndroidNativeBridge?: unknown;
  };
  return Boolean(w.Capacitor?.isNativePlatform?.() || w.AndroidNativeBridge);
}

function normalizeLatexToSpokenArabic(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    out = out.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, ' $1 على $2 ');
  }
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, ' الجذر التربيعي لـ $1 ');
  out = out.replace(/\^\{2\}|\^2|²/g, ' تربيع ');
  out = out.replace(/\^\{3\}|\^3|³/g, ' تكعيب ');
  out = out.replace(/\^\{([^{}]+)\}/g, ' أس $1 ');
  out = out.replace(/\^([0-9a-zA-Z])/g, ' أس $1 ');
  out = out.replace(/_\{([^{}]+)\}/g, ' $1 ');
  return out
    .replace(/\\times|×/g, ' ضرب ')
    .replace(/\\cdot/g, ' ضرب ')
    .replace(/\\div|÷/g, ' تقسيم ')
    .replace(/\\pm|±/g, ' زائد أو ناقص ')
    .replace(/\\pi|π/g, ' باي ')
    .replace(/\\theta|θ/g, ' ثيتا ')
    .replace(/\\alpha/g, ' ألفا ')
    .replace(/\\beta/g, ' بيتا ')
    .replace(/\\leq|≤/g, ' أصغر من أو يساوي ')
    .replace(/\\geq|≥/g, ' أكبر من أو يساوي ')
    .replace(/\\neq|≠/g, ' لا يساوي ')
    .replace(/\\approx|≈/g, ' يساوي تقريباً ')
    .replace(/\\infty|∞/g, ' ما لا نهاية ')
    .replace(/\\circ|\\degree|°/g, ' درجة ')
    .replace(/√/g, ' الجذر التربيعي لـ ')
    .replace(/%/g, ' بالمئة ')
    .replace(/−/g, ' ناقص ')
    .replace(/(\d|\s)-(\s|\d)/g, '$1 ناقص $2')
    .replace(/\\left|\\right/g, '')
    .replace(/\$/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\+/g, ' زائد ')
    .replace(/=/g, ' يساوي ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatGeminiClientError(err: unknown): AiApiError {
  const raw = err instanceof Error ? err.message : String(err);
  const isDailyQuota =
    raw.includes('PerDay') || raw.includes('per day') || raw.includes('free_tier_requests');
  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid')
  ) {
    return new AiApiError(
      'مفتاح Gemini API المدمج في التطبيق غير صالح أو مرفوض (403).',
      403,
      false
    );
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    if (isDailyQuota) {
      return new AiApiError(
        'اكتملت الحصة اليومية المجانية لتوليد الصوت (10 طلبات يومياً على الباقة المجانية).',
        429,
        true
      );
    }
    return new AiApiError('تم تجاوز حد الطلبات مؤقتاً (429). انتظر ثوانٍ وأعد المحاولة.', 429, false);
  }
  return new AiApiError(raw || 'تعذر الاتصال بخدمة Gemini.', 500, false);
}

function wrapPcmBase64ToWavDataUrl(base64Audio: string, mimeType: string): string {
  if (!mimeType.includes('L16') && !mimeType.includes('pcm')) {
    return `data:${mimeType};base64,${base64Audio}`;
  }
  const binary = atob(base64Audio);
  const pcmLen = binary.length;
  const rateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;

  const wavBytes = new Uint8Array(44 + pcmLen);
  const view = new DataView(wavBytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) wavBytes[offset + i] = s.charCodeAt(i);
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmLen, true);

  for (let i = 0; i < pcmLen; i++) {
    wavBytes[44 + i] = binary.charCodeAt(i);
  }

  let outBin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < wavBytes.length; i += CHUNK) {
    outBin += String.fromCharCode(...wavBytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(outBin)}`;
}

async function generateQuizDirectlyInApk(
  topic: string,
  count: number,
  difficulty: string,
  contentType: 'general' | 'math' | 'trueFalse'
): Promise<QuestionSlide[]> {
  try {
    const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');

    const safeCount = Math.max(1, Math.min(12, Math.round(Number(count) || 3)));
    const diffLabel = difficulty && difficulty.trim() ? difficulty.trim() : 'متنوع';
    const isTrueFalse = contentType === 'trueFalse';
    const isMath =
      !isTrueFalse &&
      (contentType === 'math' ||
        /رياضيات|جبر|معادل|كسر|كسور|جذر|جذور|حساب|هندسة|مثلث|مشتق|تكامل/i.test(topic));

    const mathGuidelines = isMath
      ? `\nملاحظات مهمة لأسئلة الرياضيات:
- ضع التعابير الرياضية والكسور والجذور والأسس بصيغة LaTeX واضحة بين علامتي دولار مثل: $\\frac{3}{4} + \\frac{1}{2}$ أو $\\sqrt{81}$ أو $2x + 5 = 15$ أو $5^{2}$.
- اجعل الخيارات الأربعة قصيرة وواضحة (سواء رقمية أو بصيغة LaTeX بين $...$).
- تأكد رياضياً 100% أن الخيار عند correctIndex هو الحل الصحيح الوحيد.`
      : '';

    const promptText = isTrueFalse
      ? `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الأسئلة المطلوبة: ${safeCount}
مستوى الصعوبة: ${diffLabel}

أنشئ ${safeCount} سؤالاً بنمط (صح أم خطأ) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: صح أم خطأ · سؤال 1)
- question: جملة خبرية أو سؤال قصير مشوق يحتمل الصواب أو الخطأ (أقل من 16 كلمة)
- options: مصفوفة تحتوي خيارين بالضبط هما ["صح", "خطأ"]
- correctIndex: 0 إذا كانت العبارة صحيحة، أو 1 إذا كانت خاطئة (نوّع بين 0 و 1)
- explanationText: تصحيح أو توضيح قصير جداً (أقل من 12 كلمة)`
      : `الموضوع أو الفكرة المطلوبة: "${topic}"
عدد الأسئلة المطلوبة: ${safeCount}
مستوى الصعوبة: ${diffLabel}
${mathGuidelines}

أنشئ ${safeCount} سؤالاً باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: تحدي المعلومات · سؤال 1)
- question: نص السؤال القصير والمشوق (أقل من 15 كلمة)
- options: مصفوفة من 4 خيارات نصية قصيرة بالضبط
- correctIndex: رقم صحيح من 0 إلى 3 يمثل الإجابة الصحيحة
- explanationText: توضيح قصير جداً للإجابة (أقل من 12 كلمة)`;

    const response = await runApkGeminiWithRotation(async (apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      return ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'أنت خبير في إعداد أسئلة المسابقات والرياضيات لفيديوهات يوتيوب باللغة العربية. التزم بالدقة العلمية والرياضية، الاختصار الواضح، وتنويع موضع الإجابة الصحيحة.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                badgeText: { type: Type.STRING },
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanationText: { type: Type.STRING },
              },
              required: ['badgeText', 'question', 'options', 'correctIndex', 'explanationText'],
            },
          },
        },
      });
    });

    const rawText = (response.text ?? '[]').trim();
    const cleanedJson = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleanedJson) as Array<{
      badgeText?: string;
      question?: string;
      options?: string[];
      correctIndex?: number;
      explanationText?: string;
    }>;

    const normalized = parsed
      .filter(
        (item) =>
          item &&
          item.question &&
          Array.isArray(item.options) &&
          item.options.length >= (isTrueFalse ? 2 : 4)
      )
      .slice(0, safeCount)
      .map((item, idx) => {
        if (isTrueFalse) {
          const rawIdx = Number(item.correctIndex);
          const cIdx = (rawIdx === 1 ? 1 : 0) as 0 | 1;
          const o0 = String(item.options?.[0] ?? 'صح').trim() || 'صح';
          const o1 = String(item.options?.[1] ?? 'خطأ').trim() || 'خطأ';
          return {
            id: `ai-slide-${Date.now()}-${idx}`,
            slideType: 'trueFalse' as const,
            badgeText: (item.badgeText ?? `صح أم خطأ · ${idx + 1}`).trim(),
            question: item.question!.trim(),
            options: [o0, o1, '', ''] as [string, string, string, string],
            correctIndex: cIdx,
            explanationText: (item.explanationText ?? '').trim(),
          };
        }

        const opts = item.options!.slice(0, 4).map((o) => String(o).trim()) as [
          string,
          string,
          string,
          string
        ];
        const numIdx = Number(item.correctIndex);
        const cIdx = Math.max(0, Math.min(3, Math.round(Number.isFinite(numIdx) ? numIdx : 0))) as
          | 0
          | 1
          | 2
          | 3;
        return {
          id: `ai-slide-${Date.now()}-${idx}`,
          slideType: 'multiple' as const,
          badgeText: (item.badgeText ?? `السؤال ${idx + 1}`).trim(),
          question: item.question!.trim(),
          options: opts,
          correctIndex: cIdx,
          explanationText: (item.explanationText ?? '').trim(),
        };
      });

    if (normalized.length === 0) {
      throw new AiApiError('لم يتمكن الذكاء الاصطناعي من توليد أسئلة صالحة، حاول صياغة الفكرة بشكل أوضح.', 502);
    }
    return normalized;
  } catch (err) {
    if (err instanceof AiApiError) throw err;
    throw formatGeminiClientError(err);
  }
}

async function generateTtsDirectlyInApk(
  text: string,
  voiceName: AiVoiceName,
  fileName: string,
  style?: string
): Promise<SlideAudioClip> {
  const cleanText = normalizeLatexToSpokenArabic(text) || text.trim();
  if (!cleanText) {
    throw new AiApiError('النص المطلوب تحويله إلى صوت فارغ.', 400);
  }

  const allowedVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
  const chosenVoice = allowedVoices.includes(voiceName) ? voiceName : 'Kore';

  try {
    const { GoogleGenAI } = await import('@google/genai');

    const response = await runApkGeminiWithRotation(async (apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      return ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style:
                    style ||
                    'Clear, natural, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly without extra words',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: chosenVoice,
              },
            },
          },
        },
      });
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

    if (!base64Audio) {
      throw new AiApiError('تعذر توليد الصوت من النموذج حالياً.', 502);
    }

    const dataUrl = wrapPcmBase64ToWavDataUrl(base64Audio, mimeType);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    return {
      fileName,
      dataUrl,
      duration: duration > 0 ? duration : 1.5,
    };
  } catch (err) {
    if (err instanceof AiApiError) throw err;
    throw formatGeminiClientError(err);
  }
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (res.status === 403) {
      throw new AiApiError(
        'تم رفض الاتصال بالخادم (خطأ 403). تأكد من فتح التطبيق من داخل AI Studio وتحديث الصفحة، أو مراجعة مفتاح API في Settings > Secrets.',
        403,
        false
      );
    }
    throw new AiApiError(
      res.ok ? 'استجابة غير صالحة من الخادم.' : `تعذر الاتصال بالخادم (رمز ${res.status}).`,
      res.status,
      false
    );
  }
}

function buildApiUrl(path: string): string {
  return BUILD_API_BASE ? `${BUILD_API_BASE}${path}` : path;
}

async function fetchAi(path: string, payload: unknown): Promise<Response> {
  if (isNativeApkRuntime() && !BUILD_API_BASE) {
    throw new AiApiError(
      'ميزة الذكاء الاصطناعي داخل الـ APK تحتاج إضافة سر GEMINI_API_KEY في GitHub (Settings > Secrets and variables > Actions) قبل بناء الـ APK.',
      0,
      false
    );
  }
  try {
    return await fetch(buildApiUrl(path), {
      method: 'POST',
      credentials: BUILD_API_BASE ? 'omit' : 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AiApiError(
      'تعذر الوصول إلى خادم الذكاء الاصطناعي. تأكد من الاتصال بالإنترنت، أو أضف أسئلتك يدوياً / عبر الاستيراد السريع.',
      0,
      false
    );
  }
}

export async function generateAiQuizSlides(
  topic: string,
  count: number,
  difficulty: string,
  contentType: 'general' | 'math' | 'trueFalse' = 'general'
): Promise<QuestionSlide[]> {
  if (isNativeApkRuntime() && EMBEDDED_APK_GEMINI_KEYS.length > 0 && !BUILD_API_BASE) {
    return generateQuizDirectlyInApk(topic, count, difficulty, contentType);
  }

  const res = await fetchAi('/api/ai/generate-quiz', {
    topic,
    count,
    difficulty,
    contentType,
  });

  const data = await parseJsonSafe<{
    slides?: QuestionSlide[];
    error?: string;
    quotaExhausted?: boolean;
  }>(res);
  if (!res.ok || !data.slides) {
    throw new AiApiError(
      data.error || 'تعذر توليد الأسئلة من الخادم.',
      res.status,
      Boolean(data.quotaExhausted)
    );
  }
  return data.slides;
}

export async function generateSingleTtsClip(
  text: string,
  voiceName: AiVoiceName,
  fileName: string
): Promise<SlideAudioClip> {
  const consistentStyle =
    'Clear, steady, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly at a natural pace';
  return generateTtsClip(text, voiceName, fileName, consistentStyle);
}

export async function generateTtsClip(
  text: string,
  voiceName: AiVoiceName,
  fileName: string,
  style?: string
): Promise<SlideAudioClip> {
  if (isNativeApkRuntime() && EMBEDDED_APK_GEMINI_KEYS.length > 0 && !BUILD_API_BASE) {
    return generateTtsDirectlyInApk(text, voiceName, fileName, style);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchAi('/api/ai/tts', { text, voiceName, style });

      const data = await parseJsonSafe<{
        dataUrl?: string;
        error?: string;
        quotaExhausted?: boolean;
      }>(res);

      if (!res.ok || !data.dataUrl) {
        const errMsg = data.error || 'تعذر توليد الصوت بالذكاء الاصطناعي.';
        if (data.quotaExhausted || res.status === 403 || res.status === 400) {
          throw new AiApiError(errMsg, res.status, Boolean(data.quotaExhausted));
        }
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, res.status === 429 ? 2000 : 800));
          continue;
        }
        throw new AiApiError(errMsg, res.status, false);
      }

      const duration = await soundEngine.getAudioDuration(data.dataUrl);
      return {
        fileName,
        dataUrl: data.dataUrl,
        duration: duration > 0 ? duration : 1.5,
      };
    } catch (err) {
      if (err instanceof AiApiError && (err.quotaExhausted || err.status === 403 || err.status === 400)) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new AiApiError('تعذر توليد الصوت بالذكاء الاصطناعي.', 500, false);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VoiceoverResult {
  slide: QuestionSlide;
  warning?: string;
  quotaExhausted?: boolean;
}

export async function generateSlideVoiceoverSafe(
  slide: QuestionSlide,
  voiceName: AiVoiceName,
  mode: AiVoiceMode,
  onStep?: (label: string) => void
): Promise<VoiceoverResult> {
  const voiceover = {
    question: slide.voiceover?.question,
    options: [...(slide.voiceover?.options ?? [undefined, undefined, undefined, undefined])] as [
      SlideAudioClip | undefined,
      SlideAudioClip | undefined,
      SlideAudioClip | undefined,
      SlideAudioClip | undefined
    ],
    answer: slide.voiceover?.answer,
  };

  const consistentStyle =
    'Clear, steady, articulate Modern Standard Arabic quiz presenter; read only the exact provided text cleanly at a natural pace';

  try {
    if (slide.question.trim()) {
      onStep?.('جارٍ توليد صوت السؤال...');
      voiceover.question = await generateTtsClip(
        slide.question,
        voiceName,
        'ai-question.wav',
        consistentStyle
      );
    }

    if (mode === 'full') {
      const optCount = slide.slideType === 'trueFalse' ? 2 : 4;
      for (let i = 0; i < optCount; i++) {
        const optText = (slide.options[i] ?? '').trim();
        if (!optText) continue;
        await pause(280);
        onStep?.(`جارٍ توليد صوت الخيار ${i + 1} من ${optCount}...`);
        voiceover.options[i] = await generateTtsClip(
          optText,
          voiceName,
          `ai-option-${i + 1}.wav`,
          consistentStyle
        );
      }
    }

    if (mode === 'questionAndAnswer' || mode === 'full') {
      const correctOptText = (slide.options[slide.correctIndex] ?? '').trim();
      if (correctOptText) {
        await pause(280);
        onStep?.('جارٍ توليد صوت الإجابة الصحيحة...');
        const ansText = `الإجابة الصحيحة هي: ${correctOptText}`;
        voiceover.answer = await generateTtsClip(
          ansText,
          voiceName,
          'ai-answer.wav',
          consistentStyle
        );
      }
    }

    return {
      slide: { ...slide, voiceover },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر إكمال توليد الصوت.';
    const quotaExhausted = err instanceof AiApiError ? err.quotaExhausted : false;
    return {
      slide: { ...slide, voiceover },
      warning: message,
      quotaExhausted,
    };
  }
}
