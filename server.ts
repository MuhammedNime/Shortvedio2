import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = 3000;

const serverKeyCooldowns = new Map<string, number>();

function getConfiguredServerKeys(): string[] {
  const combined = [process.env.GEMINI_API_KEY || '', process.env.GEMINI_API_KEYS || ''].join('\n');
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of combined.split(/[\s,;]+/)) {
    const clean = part.trim();
    if (!clean || clean === 'MY_GEMINI_API_KEY' || seen.has(clean)) continue;
    seen.add(clean);
    keys.push(clean);
  }
  return keys;
}

function createAiClientForKey(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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

async function runServerAiWithRotation<T>(task: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const allKeys = getConfiguredServerKeys();
  if (allKeys.length === 0) {
    throw new Error('مفتاح GEMINI_API_KEY غير مضبوط في إعدادات البيئة.');
  }

  const now = Date.now();
  const activeKeys = allKeys.filter((k) => (serverKeyCooldowns.get(k) ?? 0) <= now);
  const candidates = activeKeys.length > 0 ? activeKeys : allKeys;

  let lastErr: unknown;
  for (const apiKey of candidates) {
    try {
      const ai = createAiClientForKey(apiKey);
      return await task(ai);
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
        serverKeyCooldowns.set(apiKey, Date.now() + getNextUtcResetMs());
        continue;
      }
      if (isQuotaOrRate) {
        serverKeyCooldowns.set(apiKey, Date.now() + 45_000);
        continue;
      }
      if (isAuth) {
        serverKeyCooldowns.set(apiKey, Date.now() + 24 * 60 * 60_000);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

function formatGeminiError(err: unknown): {
  status: number;
  message: string;
  quotaExhausted?: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const isDailyQuota =
    raw.includes('PerDay') ||
    raw.includes('per day') ||
    raw.includes('free_tier_requests');

  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid')
  ) {
    console.warn('[AI API Auth]', raw.slice(0, 200));
    return {
      status: 403,
      message:
        'تعذر التحقق من صلاحية مفتاح Gemini API (403). يرجى التحقق من المفتاح في لوحة Settings > Secrets.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    console.warn(
      '[AI API Quota]',
      isDailyQuota ? 'Daily free-tier quota exceeded' : 'Rate limited'
    );
    if (isDailyQuota) {
      return {
        status: 429,
        quotaExhausted: true,
        message:
          'اكتملت الحصة اليومية المجانية لتوليد الصوت (10 طلبات يومياً على الباقة المجانية). يمكنك تفعيل الفوترة لمفتاح API من Settings > Secrets لزيادة الحد اليومي، أو استخدام الأصوات المدمجة / رفع صوتك يدوياً.',
      };
    }
    return {
      status: 429,
      quotaExhausted: false,
      message: 'تم تجاوز حد الطلبات مؤقتاً (429). انتظر بضع ثوانٍ ثم أعد المحاولة.',
    };
  }
  console.error('[AI API Error]', raw.slice(0, 300));
  return {
    status: 500,
    message: raw || 'حدث خطأ غير متوقع أثناء الاتصال بخدمة الذكاء الاصطناعي.',
  };
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

async function startServer() {
  const app = express();
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const keys = getConfiguredServerKeys();
    res.json({ ok: true, hasGeminiKey: keys.length > 0, keyCount: keys.length });
  });

  // Generate Arabic quiz questions for YouTube Shorts
  app.post('/api/ai/generate-quiz', async (req, res) => {
    try {
      const { topic, count, difficulty, contentType } = req.body as {
        topic?: string;
        count?: number;
        difficulty?: string;
        contentType?: 'general' | 'math' | 'trueFalse';
      };

      const cleanTopic = (topic ?? '').trim();
      if (!cleanTopic) {
        res.status(400).json({ error: 'يرجى كتابة موضوع أو فكرة أو سؤال أولاً.' });
        return;
      }

      const safeCount = Math.max(1, Math.min(12, Math.round(Number(count) || 3)));
      const diffLabel = difficulty && difficulty.trim() ? difficulty.trim() : 'متنوع';
      const isTrueFalse = contentType === 'trueFalse';
      const isMath =
        !isTrueFalse &&
        (contentType === 'math' ||
          /رياضيات|جبر|معادل|كسر|كسور|جذر|جذور|حساب|هندسة|مثلث|مشتق|تكامل/i.test(cleanTopic));

      const mathGuidelines = isMath
        ? `\nملاحظات مهمة لأسئلة الرياضيات:
- ضع التعابير الرياضية والكسور والجذور والأسس بصيغة LaTeX واضحة بين علامتي دولار مثل: $\\frac{3}{4} + \\frac{1}{2}$ أو $\\sqrt{81}$ أو $2x + 5 = 15$ أو $5^{2}$.
- اجعل الخيارات الأربعة قصيرة وواضحة (سواء رقمية أو بصيغة LaTeX بين $...$).
- تأكد رياضياً 100% أن الخيار عند correctIndex هو الحل الصحيح الوحيد.`
        : '';

      const promptText = isTrueFalse
        ? `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
عدد الأسئلة المطلوبة: ${safeCount}
مستوى الصعوبة: ${diffLabel}

أنشئ ${safeCount} سؤالاً بنمط (صح أم خطأ) باللغة العربية الفصحى السلسة والمناسبة لفيديوهات الأسئلة.
أرجع مصفوفة JSON فقط (JSON Array) بدون أي نص إضافي خارج JSON، بحيث يحتوي كل عنصر على:
- badgeText: عنوان قصير للشارة العلوية (مثال: صح أم خطأ · سؤال 1)
- question: جملة خبرية أو سؤال قصير مشوق يحتمل الصواب أو الخطأ (أقل من 16 كلمة)
- options: مصفوفة تحتوي خيارين بالضبط هما ["صح", "خطأ"]
- correctIndex: 0 إذا كانت العبارة صحيحة، أو 1 إذا كانت خاطئة (نوّع بين 0 و 1)
- explanationText: تصحيح أو توضيح قصير جداً (أقل من 12 كلمة)`
        : `الموضوع أو الفكرة المطلوبة: "${cleanTopic}"
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

      const response = await runServerAiWithRotation((ai) =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'أنت خبير في إعداد أسئلة المسابقات والرياضيات لفيديوهات يوتيوب باللغة العربية. التزم بالدقة العلمية والرياضية، الاختصار الواضح، وتنويع موضع الإجابة الصحيحة بين 0 و 3.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                badgeText: {
                  type: Type.STRING,
                  description: 'عنوان قصير للشارة العلوية مثل: تحدي المعلومات · سؤال 1',
                },
                question: {
                  type: Type.STRING,
                  description: 'نص السؤال باللغة العربية واضح ومختصر',
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'أربعة خيارات بالضبط',
                },
                correctIndex: {
                  type: Type.INTEGER,
                  description: 'رقم فهرس الإجابة الصحيحة من 0 إلى 3',
                },
                explanationText: {
                  type: Type.STRING,
                  description: 'توضيح مختصر جداً للإجابة الصحيحة',
                },
              },
              required: ['badgeText', 'question', 'options', 'correctIndex', 'explanationText'],
            },
          },
        },
        })
      );

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
        res.status(502).json({ error: 'لم يتمكن الذكاء الاصطناعي من توليد أسئلة صالحة، حاول صياغة الفكرة بشكل أوضح.' });
        return;
      }

      res.json({ slides: normalized });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  // Generate Arabic TTS Voiceover WAV via Gemini 3.8 Flash Lite TTS
  app.post('/api/ai/tts', async (req, res) => {
    try {
      const { text, voiceName, style } = req.body as {
        text?: string;
        voiceName?: string;
        style?: string;
      };

      const rawText = (text ?? '').trim();
      const cleanText = normalizeLatexToSpokenArabic(rawText) || rawText;
      if (!cleanText) {
        res.status(400).json({ error: 'النص المطلوب تحويله إلى صوت فارغ.' });
        return;
      }

      const allowedVoices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
      const chosenVoice = allowedVoices.includes(voiceName ?? '') ? voiceName! : 'Kore';

      const response = await runServerAiWithRotation((ai) =>
        ai.models.generateContent({
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
        })
      );

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = parts.find((p) => p.inlineData?.data);
      const base64Audio = audioPart?.inlineData?.data;
      const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

      if (!base64Audio) {
        res.status(502).json({ error: 'تعذر توليد الصوت من النموذج حالياً.' });
        return;
      }

      // If model returns raw L16 PCM, wrap it in a standard 24kHz mono 16-bit WAV header
      let finalDataUrl = `data:${mimeType};base64,${base64Audio}`;
      if (mimeType.includes('L16') || mimeType.includes('pcm')) {
        const pcmBuf = Buffer.from(base64Audio, 'base64');
        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        const wavHeader = Buffer.alloc(44);
        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(36 + pcmBuf.length, 4);
        wavHeader.write('WAVE', 8);
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16); // PCM chunk size
        wavHeader.writeUInt16LE(1, 20); // PCM format
        wavHeader.writeUInt16LE(1, 22); // Mono
        wavHeader.writeUInt32LE(sampleRate, 24);
        wavHeader.writeUInt32LE(sampleRate * 2, 28); // Byte rate
        wavHeader.writeUInt16LE(2, 32); // Block align
        wavHeader.writeUInt16LE(16, 34); // Bits per sample
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(pcmBuf.length, 40);
        const wavBase64 = Buffer.concat([wavHeader, pcmBuf]).toString('base64');
        finalDataUrl = `data:audio/wav;base64,${wavBase64}`;
      }

      res.json({
        dataUrl: finalDataUrl,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({
        error: formatted.message,
        quotaExhausted: formatted.quotaExhausted,
      });
    }
  });

  const httpServer = http.createServer(app);

  // Mount Vite dev middleware or serve static production build
  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
export class ErrorOverlay {}
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    prune() {},
    dispose() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
`);
      });
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Shorts Quiz Studio server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
