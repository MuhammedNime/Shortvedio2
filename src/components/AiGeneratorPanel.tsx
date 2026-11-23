import React, { useState } from 'react';
import { Calculator, Loader2, Sparkles, Volume2 } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import {
  AI_VOICE_OPTIONS,
  AiVoiceMode,
  AiVoiceName,
  generateAiQuizSlides,
  generateSlideVoiceoverSafe,
} from '../services/aiClient';
import { QuestionSlide } from '../types/quiz';

interface AiGeneratorPanelProps {
  voiceName: AiVoiceName;
  onVoiceChange: (voice: AiVoiceName) => void;
  onInsertSlides: (
    slides: QuestionSlide[],
    mode: 'append' | 'replace',
    enableAutoSync: boolean,
    warningMessage?: string,
    applyMathTheme?: boolean
  ) => void;
}

const GENERAL_SUGGESTIONS = [
  'ثقافة عامة ومعلومات مذهلة',
  'عواصم ودول العالم',
  'أسئلة دينية وتاريخ إسلامي',
  'الفضاء والكواكب والعلوم',
];

const MATH_SUGGESTIONS = [
  'كسور وجذور تربيعية سهلة',
  'معادلات جبرية سريعة (قيمة س)',
  'قوى وأسس وحساب ذهني',
  'مساحة ومحيط الأشكال الهندسية',
];

const TRUE_FALSE_SUGGESTIONS = [
  'حقائق علمية مدهشة (صح أم خطأ)',
  'معلومات تاريخية وإسلامية',
  'معلومات غريبة عن جسم الإنسان',
  'عجائب الفضاء والطبيعة',
];

export const AiGeneratorPanel: React.FC<AiGeneratorPanelProps> = ({
  voiceName,
  onVoiceChange,
  onInsertSlides,
}) => {
  const [contentType, setContentType] = useState<'general' | 'math' | 'trueFalse'>('general');
  const [autoApplyMathTheme, setAutoApplyMathTheme] = useState(true);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(2);
  const [difficulty, setDifficulty] = useState('متوسط');
  const [withVoice, setWithVoice] = useState(true);
  const [voiceMode, setVoiceMode] = useState<AiVoiceMode>('full');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const suggestions =
    contentType === 'math'
      ? MATH_SUGGESTIONS
      : contentType === 'trueFalse'
        ? TRUE_FALSE_SUGGESTIONS
        : GENERAL_SUGGESTIONS;

  const handleGenerate = async (insertMode: 'append' | 'replace') => {
    const trimmed = topic.trim();
    if (!trimmed) {
      setErrorMsg('يرجى كتابة فكرة أو موضوع أو سؤال أولاً.');
      return;
    }

    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }

    setErrorMsg('');
    setIsGenerating(true);
    setStatusText(`جارٍ تأليف ${count} أسئلة بالذكاء الاصطناعي...`);

    try {
      const slides = await generateAiQuizSlides(trimmed, count, difficulty, contentType);
      const shouldApplyMath = contentType === 'math' && autoApplyMathTheme;

      if (withVoice) {
        const resultSlides: QuestionSlide[] = [];
        let quotaWarning: string | undefined;

        for (let i = 0; i < slides.length; i++) {
          if (quotaWarning) {
            resultSlides.push(slides[i]);
            continue;
          }

          const res = await generateSlideVoiceoverSafe(
            slides[i],
            voiceName,
            voiceMode,
            (stepLabel) =>
              setStatusText(`السؤال ${i + 1} من ${slides.length}: ${stepLabel}`)
          );
          resultSlides.push(res.slide);

          if (res.warning) {
            quotaWarning = res.warning;
          }
        }

        onInsertSlides(resultSlides, insertMode, true, quotaWarning, shouldApplyMath);
      } else {
        onInsertSlides(slides, insertMode, false, undefined, shouldApplyMath);
      }

      setStatusText('');
      setTopic('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء التوليد، حاول مجدداً.'
      );
      setStatusText('');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-bold text-[var(--ptxt)]">
          توليد الأسئلة والصوت بالذكاء الاصطناعي
        </h2>
        <p className="text-xs text-[var(--pmuted)] leading-relaxed">
          أنشئ أسئلة ثقافية أو معادلات رياضيات بالرموز والكسور، مع توليد صوت المذيع
          للسؤال والخيارات الأربعة والحل تلقائياً.
        </p>
      </div>

      {/* Content Mode Switch: General vs True/False vs Math */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setContentType('general')}
            className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              contentType === 'general'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>ثقافة (4 خيارات)</span>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setContentType('trueFalse')}
            className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              contentType === 'trueFalse'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            <span>صح أم خطأ ✓✗</span>
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => setContentType('math')}
            className={`flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              contentType === 'math'
                ? 'bg-[#00B050] text-white'
                : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>رياضيات 🧮</span>
          </button>
        </div>

        {contentType === 'math' && (
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#00B050]/10 border border-[#00B050]/35 cursor-pointer">
            <input
              type="checkbox"
              checked={autoApplyMathTheme}
              onChange={(e) => setAutoApplyMathTheme(e.target.checked)}
              className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
            />
            <span className="text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7]">
              تطبيق خلفية سبورة الرياضيات وكشف (3 حمر + أخضر) تلقائياً
            </span>
          </label>
        )}
      </div>

      {/* Topic / Idea input */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-[var(--ptxt)]">
          {contentType === 'math'
            ? 'موضوع الرياضيات أو الدرس المطلوب'
            : contentType === 'trueFalse'
              ? 'موضوع تحدي صح أم خطأ'
              : 'فكرة الفيديو أو الموضوع'}
        </label>
        <textarea
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={isGenerating}
          placeholder={
            contentType === 'math'
              ? 'مثال: جمع الكسور والجذور التربيعية للمرحلة الإعدادية...'
              : contentType === 'trueFalse'
                ? 'مثال: حقائق علمية وجغرافية غريبة بصيغة صح أم خطأ...'
                : 'مثال: 3 أسئلة دينية سهلة عن الأنبياء أو الثقافة العامة...'
          }
          className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-sm text-[var(--ptxt)] placeholder:text-[var(--pmuted)] resize-none leading-relaxed"
        />

        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={isGenerating}
              onClick={() => setTopic(s)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] transition-colors cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Count & Difficulty */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--ptxt)]">
            <span>عدد الأسئلة</span>
            <span className="font-mono-nums text-[#00B050] font-bold">{count}</span>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            {[1, 2, 3, 5, 8].map((n) => (
              <button
                key={n}
                type="button"
                disabled={isGenerating}
                onClick={() => setCount(n)}
                className={`flex-1 py-1.5 rounded-md text-xs font-mono-nums font-bold transition-colors cursor-pointer ${
                  count === n
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--ptxt)]">مستوى الصعوبة</span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            {['سهل', 'متوسط', 'صعب'].map((lvl) => (
              <button
                key={lvl}
                type="button"
                disabled={isGenerating}
                onClick={() => setDifficulty(lvl)}
                className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                  difficulty === lvl
                    ? 'bg-[var(--panel)] text-[var(--gold)] border border-[var(--pline)]'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Voiceover Settings */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-[#00B050]" />
            <span className="text-xs font-bold text-[var(--ptxt)]">
              توليد تعليق صوتي بالذكاء الاصطناعي
            </span>
          </div>
          <input
            type="checkbox"
            checked={withVoice}
            disabled={isGenerating}
            onChange={(e) => setWithVoice(e.target.checked)}
            className="w-4 h-4 accent-[#00B050] rounded cursor-pointer"
          />
        </label>

        {withVoice && (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-[var(--pline)]">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">نبرة المذيع الصوتي</span>
              <select
                value={voiceName}
                disabled={isGenerating}
                onChange={(e) => onVoiceChange(e.target.value as AiVoiceName)}
                className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
              >
                {AI_VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--pmuted)]">
                نطاق التعليق الصوتي (الباقة المجانية 10 مقاطع يومياً / المدفوعة مفتوحة)
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[var(--panel)] border border-[var(--pline)]">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('questionOnly')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    voiceMode === 'questionOnly'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  السؤال فقط (1)
                </button>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('questionAndAnswer')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    voiceMode === 'questionAndAnswer'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  السؤال والحل (2)
                </button>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setVoiceMode('full')}
                  className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    voiceMode === 'full'
                      ? 'bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  {contentType === 'trueFalse' ? '+خيارين (4)' : '+4 خيارات (6)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {statusText && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#00B050]/12 border border-[#00B050]/35 text-xs text-[#00B050] dark:text-[#6ee7b7]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>{statusText}</span>
        </div>
      )}

      {errorMsg && (
        <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
          {errorMsg}
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={isGenerating}
          onClick={() => void handleGenerate('replace')}
          className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>توليد واستبدال الأسئلة</span>
        </button>

        <button
          type="button"
          disabled={isGenerating}
          onClick={() => void handleGenerate('append')}
          className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-[var(--surface)] hover:border-[var(--gold)] disabled:opacity-50 text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
        >
          <span>توليد وإضافة للقائمة</span>
        </button>
      </div>
    </div>
  );
};
