import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import {
  AI_VOICE_OPTIONS,
  AiApiError,
  AiVoiceMode,
  AiVoiceName,
  generateSingleTtsClip,
  generateSlideVoiceoverSafe,
} from '../services/aiClient';
import { readFileAsDataUrl } from '../storage/projectStore';
import {
  ImageChallengeMode,
  QuestionSlide,
  SlideAudioClip,
  SlideDifficulty,
  SlideType,
} from '../types/quiz';
import { MathFieldInput } from './MathFieldInput';
import { MicRecordButton } from './MicRecordButton';

interface SlidesEditorPanelProps {
  slides: QuestionSlide[];
  activeIndex: number;
  aiVoiceName: AiVoiceName;
  onAiVoiceChange: (voice: AiVoiceName) => void;
  onSelectSlide: (idx: number) => void;
  onUpdateSlide: (idx: number, updated: QuestionSlide) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (idx: number) => void;
  onDeleteSlide: (idx: number) => void;
  onReorderSlide?: (fromIdx: number, toIdx: number) => void;
  onUpdateAllSlides?: (updater: (slides: QuestionSlide[]) => QuestionSlide[]) => void;
}

const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د'];

export const SlidesEditorPanel: React.FC<SlidesEditorPanelProps> = ({
  slides,
  activeIndex,
  aiVoiceName,
  onAiVoiceChange,
  onSelectSlide,
  onUpdateSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onReorderSlide,
  onUpdateAllSlides,
}) => {
  const activeSlide = slides[activeIndex] ?? slides[0];
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [voiceMode, setVoiceMode] = useState<AiVoiceMode>('full');
  const [isVoicing, setIsVoicing] = useState(false);
  const [voicingTarget, setVoicingTarget] = useState<string | null>(null);
  const [voiceStepText, setVoiceStepText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [mathTarget, setMathTarget] = useState<'question' | 0 | 1 | 2 | 3 | null>(null);

  if (!activeSlide) return null;

  const handleGenerateSlideAiVoice = async () => {
    if (!activeSlide.question.trim()) return;
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    setVoiceError('');
    setIsVoicing(true);
    setVoicingTarget('all');
    setVoiceStepText('جارٍ التوليد...');
    try {
      const res = await generateSlideVoiceoverSafe(
        activeSlide,
        aiVoiceName,
        voiceMode,
        (step) => setVoiceStepText(step)
      );
      onUpdateSlide(activeIndex, res.slide);
      if (res.warning) {
        setVoiceError(res.warning);
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'تعذر توليد الصوت');
    } finally {
      setIsVoicing(false);
      setVoicingTarget(null);
      setVoiceStepText('');
    }
  };

  const setClipOnSlide = (
    slideIdx: number,
    baseSlide: QuestionSlide,
    target: 'question' | 'answer' | 0 | 1 | 2 | 3,
    clip: SlideAudioClip | undefined
  ): QuestionSlide => {
    const currentVoiceover = baseSlide.voiceover ?? {};
    let nextSlide: QuestionSlide;

    if (target === 'question') {
      nextSlide = {
        ...baseSlide,
        voiceover: { ...currentVoiceover, question: clip },
      };
    } else if (target === 'answer') {
      nextSlide = {
        ...baseSlide,
        voiceover: { ...currentVoiceover, answer: clip },
      };
    } else {
      const nextOpts = [
        ...(currentVoiceover.options ?? [undefined, undefined, undefined, undefined]),
      ] as [
        SlideAudioClip | undefined,
        SlideAudioClip | undefined,
        SlideAudioClip | undefined,
        SlideAudioClip | undefined
      ];
      nextOpts[target] = clip;
      nextSlide = {
        ...baseSlide,
        voiceover: { ...currentVoiceover, options: nextOpts },
      };
    }

    onUpdateSlide(slideIdx, nextSlide);
    return nextSlide;
  };

  const handleGenerateSingleFieldVoice = async (target: 'question' | 'answer' | 0 | 1 | 2 | 3) => {
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    let textToSpeak = '';
    let fileName = 'ai-clip.wav';

    if (target === 'question') {
      textToSpeak = activeSlide.question.trim();
      fileName = 'ai-question.wav';
    } else if (target === 'answer') {
      const ansOpt = activeSlide.options[activeSlide.correctIndex] || '';
      textToSpeak = `الإجابة الصحيحة هي: ${ansOpt}`;
      fileName = 'ai-answer.wav';
    } else {
      textToSpeak = activeSlide.options[target]?.trim() || '';
      fileName = `ai-option-${target + 1}.wav`;
    }

    if (!textToSpeak) {
      setVoiceError('اكتب النص أولاً قبل توليد الصوت.');
      return;
    }

    setVoiceError('');
    setIsVoicing(true);
    setVoicingTarget(String(target));
    try {
      const clip = await generateSingleTtsClip(textToSpeak, aiVoiceName, fileName);
      setClipOnSlide(activeIndex, activeSlide, target, clip);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'تعذر توليد الصوت');
    } finally {
      setIsVoicing(false);
      setVoicingTarget(null);
    }
  };

  const handleBatchGenerateMissingVoices = async () => {
    if (isVoicing) return;
    try {
      soundEngine.getContext();
    } catch {
      // ignore
    }
    setVoiceError('');
    setIsVoicing(true);
    setVoicingTarget('batch');

    try {
      let generatedCount = 0;
      for (let sIdx = 0; sIdx < slides.length; sIdx++) {
        let workingSlide: QuestionSlide = {
          ...slides[sIdx],
          voiceover: {
            question: slides[sIdx].voiceover?.question,
            options: [
              ...(slides[sIdx].voiceover?.options ?? [undefined, undefined, undefined, undefined]),
            ] as [
              SlideAudioClip | undefined,
              SlideAudioClip | undefined,
              SlideAudioClip | undefined,
              SlideAudioClip | undefined
            ],
            answer: slides[sIdx].voiceover?.answer,
          },
        };

        if (workingSlide.question.trim() && !workingSlide.voiceover?.question) {
          setVoiceStepText(`سؤال ${sIdx + 1}/${slides.length}: السؤال...`);
          const clip = await generateSingleTtsClip(
            workingSlide.question,
            aiVoiceName,
            `ai-q-${sIdx + 1}.wav`
          );
          workingSlide = setClipOnSlide(sIdx, workingSlide, 'question', clip);
          generatedCount += 1;
          await new Promise((r) => setTimeout(r, 240));
        }

        if (voiceMode === 'full') {
          const optCount = workingSlide.slideType === 'trueFalse' ? 2 : 4;
          for (let oIdx = 0; oIdx < optCount; oIdx++) {
            const optText = workingSlide.options[oIdx]?.trim();
            if (optText && !workingSlide.voiceover?.options?.[oIdx]) {
              setVoiceStepText(`سؤال ${sIdx + 1}/${slides.length}: خيار ${oIdx + 1}...`);
              const clip = await generateSingleTtsClip(
                optText,
                aiVoiceName,
                `ai-s${sIdx + 1}-opt${oIdx + 1}.wav`
              );
              workingSlide = setClipOnSlide(
                sIdx,
                workingSlide,
                oIdx as 0 | 1 | 2 | 3,
                clip
              );
              generatedCount += 1;
              await new Promise((r) => setTimeout(r, 240));
            }
          }
        }

        if ((voiceMode === 'questionAndAnswer' || voiceMode === 'full') && !workingSlide.voiceover?.answer) {
          const ansOpt = workingSlide.options[workingSlide.correctIndex]?.trim() || '';
          if (ansOpt) {
            setVoiceStepText(`سؤال ${sIdx + 1}/${slides.length}: الحل...`);
            const clip = await generateSingleTtsClip(
              `الإجابة الصحيحة هي: ${ansOpt}`,
              aiVoiceName,
              `ai-s${sIdx + 1}-ans.wav`
            );
            workingSlide = setClipOnSlide(sIdx, workingSlide, 'answer', clip);
            generatedCount += 1;
            await new Promise((r) => setTimeout(r, 240));
          }
        }
      }

      if (generatedCount === 0) {
        setVoiceError('جميع المقاطع الصوتية المطلوبة موجودة بالفعل على كل الأسئلة.');
      }
    } catch (err) {
      if (err instanceof AiApiError && err.quotaExhausted) {
        setVoiceError(err.message);
      } else {
        setVoiceError(err instanceof Error ? err.message : 'تعذر إكمال التوليد الجماعي للأصوات.');
      }
    } finally {
      setIsVoicing(false);
      setVoicingTarget(null);
      setVoiceStepText('');
    }
  };

  const handleShuffleOptions = () => {
    const indices = [0, 1, 2, 3];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }
    const nextOptions = indices.map((i) => activeSlide.options[i]) as [
      string,
      string,
      string,
      string
    ];
    const nextCorrect = indices.indexOf(activeSlide.correctIndex) as 0 | 1 | 2 | 3;
    const prevVoOpts = activeSlide.voiceover?.options;
    const nextVoOpts = prevVoOpts
      ? (indices.map((i) => prevVoOpts[i]) as [
          SlideAudioClip | undefined,
          SlideAudioClip | undefined,
          SlideAudioClip | undefined,
          SlideAudioClip | undefined
        ])
      : undefined;

    onUpdateSlide(activeIndex, {
      ...activeSlide,
      options: nextOptions,
      correctIndex: nextCorrect,
      voiceover: activeSlide.voiceover
        ? { ...activeSlide.voiceover, options: nextVoOpts }
        : undefined,
    });
  };

  const updateOption = (optIdx: number, value: string) => {
    const nextOptions: [string, string, string, string] = [...activeSlide.options] as [
      string,
      string,
      string,
      string
    ];
    nextOptions[optIdx] = value;
    onUpdateSlide(activeIndex, { ...activeSlide, options: nextOptions });
  };

  const handleUploadVoiceover = async (
    target: 'question' | 'answer' | 0 | 1 | 2 | 3,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const duration = await soundEngine.getAudioDuration(dataUrl);
    const clip: SlideAudioClip = {
      fileName: file.name,
      dataUrl,
      duration,
    };

    setClipOnSlide(activeIndex, activeSlide, target, clip);
    e.target.value = '';
  };

  const handleUploadSlideImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    onUpdateSlide(activeIndex, {
      ...activeSlide,
      imageDataUrl: dataUrl,
      imageName: file.name,
    });
    e.target.value = '';
  };

  const removeVoiceover = (target: 'question' | 'answer' | 0 | 1 | 2 | 3) => {
    setClipOnSlide(activeIndex, activeSlide, target, undefined);
  };

  const qClip = activeSlide.voiceover?.question;
  const ansClip = activeSlide.voiceover?.answer;

  return (
    <div className="flex flex-col gap-5">
      {/* Slide Strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--pmuted)]">
            شرائح الأسئلة ({slides.length})
          </span>
          <button
            type="button"
            onClick={onAddSlide}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00B050]/15 hover:bg-[#00B050]/25 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/45 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ سؤال جديد</span>
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {slides.map((s, idx) => {
            const isActive = idx === activeIndex;
            return (
              <div
                key={s.id}
                className={`flex items-center rounded-lg border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-[#00B050] text-white border-[#00B050]'
                    : 'bg-[var(--surface)] text-[var(--ptxt)] border-[var(--pline)] hover:border-[var(--gold)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSlide(idx)}
                  className="px-3 py-2 text-xs font-bold whitespace-nowrap cursor-pointer"
                >
                  سؤال {idx + 1}
                </button>
                {slides.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSlide(idx);
                    }}
                    title={`حذف السؤال ${idx + 1}`}
                    aria-label={`حذف السؤال ${idx + 1}`}
                    className={`pl-2 pr-1 py-2 transition-colors cursor-pointer ${
                      isActive ? 'text-white/85 hover:text-white' : 'text-[var(--pmuted)] hover:text-rose-400'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Slide Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--pline)] pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-[var(--ptxt)]">
            تعديل السؤال {activeIndex + 1}
          </h2>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            <button
              type="button"
              onClick={() => {
                if ((activeSlide.slideType || 'multiple') === 'multiple') return;
                const opts = [...activeSlide.options] as [string, string, string, string];
                if (!opts[2]) opts[2] = 'خيار 3';
                if (!opts[3]) opts[3] = 'خيار 4';
                onUpdateSlide(activeIndex, {
                  ...activeSlide,
                  slideType: 'multiple',
                  options: opts,
                });
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                (activeSlide.slideType || 'multiple') === 'multiple'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              4 خيارات
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeSlide.slideType === 'trueFalse') return;
                const opts = [...activeSlide.options] as [string, string, string, string];
                const isDefaultSample =
                  !opts[0] ||
                  opts[0] === 'الجواب الصحيح' ||
                  opts[0] === 'الخيار الأول' ||
                  opts[1] === 'خيار خاطئ 1';
                if (isDefaultSample) {
                  opts[0] = 'صح';
                  opts[1] = 'خطأ';
                } else {
                  opts[0] = opts[0] || 'صح';
                  opts[1] = opts[1] || 'خطأ';
                }
                const nextCorrect = (activeSlide.correctIndex > 1 ? 0 : activeSlide.correctIndex) as
                  | 0
                  | 1;
                onUpdateSlide(activeIndex, {
                  ...activeSlide,
                  slideType: 'trueFalse' as SlideType,
                  options: opts,
                  correctIndex: nextCorrect,
                });
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                activeSlide.slideType === 'trueFalse'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              صح أم خطأ ✓✗
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isVoicing}
            onClick={() => void handleGenerateSlideAiVoice()}
            title="توليد تعليق صوتي بالذكاء الاصطناعي (السؤال + الخيارات + الحل)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#00B050]/18 hover:bg-[#00B050]/30 disabled:opacity-50 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/45 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {voicingTarget === 'all' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{voicingTarget === 'all' ? voiceStepText : 'توليد صوت ذكي'}</span>
          </button>

          {activeSlide.slideType !== 'trueFalse' && (
            <button
              type="button"
              onClick={handleShuffleOptions}
              title="خلط ترتيب الخيارات عشوائياً"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>خلط</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onDuplicateSlide(activeIndex)}
            title="تكرار السؤال"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>تكرار</span>
          </button>

          {onReorderSlide && slides.length > 1 && (
            <div className="flex items-center rounded-md border border-[var(--pline)] bg-[var(--surface)] overflow-hidden">
              <button
                type="button"
                disabled={activeIndex <= 0}
                onClick={() => onReorderSlide(activeIndex, activeIndex - 1)}
                title="نقل الشريحة للأمام (السابق)"
                aria-label="نقل الشريحة للأمام"
                className="p-1.5 text-[var(--ptxt)] hover:bg-[#00B050]/15 disabled:opacity-35 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={activeIndex >= slides.length - 1}
                onClick={() => onReorderSlide(activeIndex, activeIndex + 1)}
                title="نقل الشريحة للخلف (التالي)"
                aria-label="نقل الشريحة للخلف"
                className="p-1.5 text-[var(--ptxt)] hover:bg-[#00B050]/15 disabled:opacity-35 border-r border-[var(--pline)] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {slides.length > 1 ? (
            <button
              type="button"
              onClick={() => onDeleteSlide(activeIndex)}
              title="حذف هذا السؤال"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-rose-500/12 hover:bg-rose-500/22 text-rose-400 border border-rose-500/35 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                onUpdateSlide(activeIndex, {
                  ...activeSlide,
                  badgeText: 'السؤال 1',
                  question: '',
                  imageDataUrl: undefined,
                  imageName: undefined,
                  imageChallengeMode: 'normal',
                  options:
                    activeSlide.slideType === 'trueFalse'
                      ? ['صح', 'خطأ', '', '']
                      : ['', '', '', ''],
                  correctIndex: 0,
                  explanationText: '',
                  voiceover: undefined,
                })
              }
              title="مسح حقول السؤال الحالي"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>تفريغ</span>
            </button>
          )}
        </div>
      </div>

      {/* Unified AI Voiceover & Scope Selector + Batch All Slides */}
      <div className="flex flex-col gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--pmuted)] whitespace-nowrap">
            صوت المذيع الموحد:
          </span>
          <select
            value={aiVoiceName}
            disabled={isVoicing}
            onChange={(e) => onAiVoiceChange(e.target.value as AiVoiceName)}
            className="px-2.5 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--gold)] font-bold focus:border-[#00B050] focus:outline-none"
          >
            {AI_VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--pline)]/70">
          <span className="text-[11px] text-[var(--pmuted)] whitespace-nowrap">
            نطاق التوليد الذكي:
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-[var(--panel)] border border-[var(--pline)]">
            <button
              type="button"
              disabled={isVoicing}
              onClick={() => setVoiceMode('questionAndAnswer')}
              className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                voiceMode === 'questionAndAnswer'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              السؤال والحل (2)
            </button>
            <button
              type="button"
              disabled={isVoicing}
              onClick={() => setVoiceMode('full')}
              className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer ${
                voiceMode === 'full'
                  ? 'bg-[#00B050] text-white'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              {activeSlide.slideType === 'trueFalse'
                ? 'السؤال + الخيارين + الحل (4)'
                : 'السؤال + 4 خيارات + الحل (6)'}
            </button>
          </div>
        </div>

        {slides.length > 1 && (
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--pline)]/70">
            <span className="text-[11px] text-[var(--pmuted)]">
              توليد الأصوات الناقصة لجميع الأسئلة ({slides.length}) دفعة واحدة
            </span>
            <button
              type="button"
              disabled={isVoicing}
              onClick={() => void handleBatchGenerateMissingVoices()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-50 text-white text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {voicingTarget === 'batch' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span>{voicingTarget === 'batch' ? voiceStepText : 'توليد الصوت للكل'}</span>
            </button>
          </div>
        )}
      </div>

      {voiceError && (
        <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
          {voiceError}
        </div>
      )}

      {/* Question Text + MathLive Toggle + Per-Slide Question Audio */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[var(--ptxt)]">نص السؤال</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMathTarget((t) => (t === 'question' ? null : 'question'))}
              title="فتح محرر معادلات الرياضيات (MathLive)"
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                mathTarget === 'question'
                  ? 'bg-[#00B050] text-white border-[#00B050]'
                  : 'bg-[var(--surface)] hover:border-[var(--gold)] border-[var(--pline)] text-[var(--gold)]'
              }`}
            >
              <Calculator className="w-3 h-3" />
              <span>معادلة ∑</span>
            </button>

            <input
              ref={(el) => {
                fileInputsRef.current['question'] = el;
              }}
              type="file"
              accept="audio/*"
              onChange={(e) => void handleUploadVoiceover('question', e)}
              className="hidden"
            />
            {qClip ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.getContext();
                    void soundEngine.playClip(qClip, 1);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40 text-[11px] font-medium cursor-pointer"
                >
                  <Play className="w-3 h-3" />
                  <span className="font-mono-nums">{qClip.duration.toFixed(1)} ث</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeVoiceover('question')}
                  title="حذف صوت السؤال"
                  className="p-1 rounded text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isVoicing}
                  onClick={() => void handleGenerateSingleFieldVoice('question')}
                  title="توليد صوت ذكي للسؤال"
                  className="p-1.5 rounded bg-[#00B050]/15 hover:bg-[#00B050]/28 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40 cursor-pointer disabled:opacity-50"
                >
                  {voicingTarget === 'question' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                </button>
                <MicRecordButton
                  label="تسجيل"
                  fileNameBase={`mic-q-${activeIndex + 1}`}
                  disabled={isVoicing}
                  onRecorded={(clip) =>
                    setClipOnSlide(activeIndex, activeSlide, 'question', clip)
                  }
                  onError={(msg) => setVoiceError(msg)}
                />
                <button
                  type="button"
                  onClick={() => fileInputsRef.current['question']?.click()}
                  title="رفع ملف صوتي للسؤال"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-[11px] font-medium cursor-pointer"
                >
                  <Upload className="w-3 h-3 text-[#00B050]" />
                  <span>ملف</span>
                </button>
              </>
            )}
          </div>
        </div>
        <textarea
          rows={2}
          value={activeSlide.question}
          onChange={(e) =>
            onUpdateSlide(activeIndex, { ...activeSlide, question: e.target.value })
          }
          placeholder="اكتب السؤال هنا... أو استخدم زر (معادلة ∑) لإدراج الكسور والجذور"
          className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-sm text-[var(--ptxt)] placeholder:text-[var(--pmuted)] resize-none leading-relaxed"
        />
        {mathTarget === 'question' && (
          <MathFieldInput
            initialText={activeSlide.question}
            mode="insertIntoText"
            onApply={(nextText) =>
              onUpdateSlide(activeIndex, { ...activeSlide, question: nextText })
            }
            onClose={() => setMathTarget(null)}
          />
        )}

        {/* Optional Question Illustration Image */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <input
            ref={(el) => {
              fileInputsRef.current['slideImage'] = el;
            }}
            type="file"
            accept="image/*"
            onChange={(e) => void handleUploadSlideImage(e)}
            className="hidden"
          />

          {activeSlide.imageDataUrl ? (
            <div className="flex flex-col gap-2 w-full p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={activeSlide.imageDataUrl}
                    alt="صورة السؤال"
                    className={`w-9 h-9 rounded-md object-cover border border-[var(--pline)] shrink-0 ${
                      activeSlide.imageChallengeMode && activeSlide.imageChallengeMode !== 'normal'
                        ? 'blur-[2px]'
                        : ''
                    }`}
                  />
                  <span className="text-[11px] text-[var(--ptxt)] truncate">
                    {activeSlide.imageName || 'صورة توضيحية للسؤال'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSlide(activeIndex, {
                      ...activeSlide,
                      imageDataUrl: undefined,
                      imageName: undefined,
                      imageChallengeMode: 'normal',
                    })
                  }
                  title="حذف الصورة التوضيحية"
                  className="p-1.5 rounded-md text-rose-400 hover:bg-rose-500/15 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-col gap-1.5 pt-1.5 border-t border-[var(--pline)]/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[var(--gold)]">
                    تحدي الصورة المموّهة:
                  </span>
                  <select
                    value={activeSlide.imageChallengeMode || 'normal'}
                    onChange={(e) =>
                      onUpdateSlide(activeIndex, {
                        ...activeSlide,
                        imageChallengeMode: e.target.value as ImageChallengeMode,
                      })
                    }
                    className="px-2 py-1 rounded-md bg-[var(--panel)] border border-[var(--pline)] text-[11px] text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                  >
                    <option value="normal">عادي (واضحة فوراً)</option>
                    <option value="blurToClear">مموّهة وتنكشف عند الجواب 🔍</option>
                    <option value="gradualClear">توضح تدريجياً أثناء العد ⏳</option>
                  </select>
                </div>

                {activeSlide.imageChallengeMode && activeSlide.imageChallengeMode !== 'normal' && (
                  <label className="flex items-center gap-2 text-[11px] text-[var(--pmuted)]">
                    <span className="whitespace-nowrap">درجة التمويه:</span>
                    <input
                      type="range"
                      min={12}
                      max={48}
                      step={2}
                      value={activeSlide.imageBlurStrength ?? 28}
                      onChange={(e) =>
                        onUpdateSlide(activeIndex, {
                          ...activeSlide,
                          imageBlurStrength: parseInt(e.target.value, 10),
                        })
                      }
                      className="flex-1 h-1"
                    />
                    <span className="font-mono-nums text-[var(--ptxt)]">
                      {activeSlide.imageBlurStrength ?? 28}
                    </span>
                  </label>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputsRef.current['slideImage']?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[11px] font-medium text-[var(--pmuted)] hover:text-[var(--ptxt)] transition-colors cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>+ إضافة صورة للسؤال (عادي أو تحدي صورة مموّهة 🔍)</span>
            </button>
          )}
        </div>
      </div>

      {/* Options + Green Correct Selector + MathLive + Per-Option AI & Upload Audio */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-[var(--ptxt)]">
            {activeSlide.slideType === 'trueFalse'
              ? 'خيارا صح أو خطأ (حدد الإجابة الصحيحة)'
              : 'الخيارات الأربعة (اضغط ✨ لتوليد صوت أي خيار بالذكاء الاصطناعي)'}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {(activeSlide.slideType === 'trueFalse' ? [0, 1] : [0, 1, 2, 3]).map((optIdx) => {
            const isCorrect = activeSlide.correctIndex === optIdx;
            const optClip = activeSlide.voiceover?.options?.[optIdx];
            const inputKey = `opt-${optIdx}`;
            const isMathOpen = mathTarget === optIdx;

            return (
              <div key={optIdx} className="flex flex-col gap-1.5">
                <div
                  className={`flex items-center gap-1.5 p-1.5 rounded-xl border transition-colors ${
                    isCorrect
                      ? 'bg-[#00B050]/12 border-[#00B050]'
                      : 'bg-[var(--surface)] border-[var(--pline)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSlide(activeIndex, {
                        ...activeSlide,
                        correctIndex: optIdx as 0 | 1 | 2 | 3,
                      })
                    }
                    title="تحديد كإجابة صحيحة"
                    className={`flex items-center justify-center gap-1 min-w-[48px] h-9 px-2 rounded-lg text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                      isCorrect
                        ? 'bg-[#00B050] text-white'
                        : 'bg-[var(--panel)] text-[var(--pmuted)] hover:text-[var(--ptxt)] border border-[var(--pline)]'
                    }`}
                  >
                    {isCorrect ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>صحيح</span>
                      </>
                    ) : (
                      <span>{OPTION_LETTERS[optIdx]}</span>
                    )}
                  </button>

                  <input
                    type="text"
                    value={activeSlide.options[optIdx]}
                    onChange={(e) => updateOption(optIdx, e.target.value)}
                    placeholder={isCorrect ? 'الجواب الصحيح' : `خيار خاطئ ${optIdx + 1}`}
                    className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-sm text-[var(--ptxt)] placeholder:text-[var(--pmuted)] focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => setMathTarget(isMathOpen ? null : (optIdx as 0 | 1 | 2 | 3))}
                    title="كتابة معادلة رياضيات لهذا الخيار"
                    className={`p-1.5 rounded-lg border shrink-0 cursor-pointer ${
                      isMathOpen
                        ? 'bg-[#00B050] text-white border-[#00B050]'
                        : 'bg-[var(--panel)] border-[var(--pline)] hover:border-[var(--gold)] text-[var(--gold)]'
                    }`}
                  >
                    <Calculator className="w-3.5 h-3.5" />
                  </button>

                  <input
                    ref={(el) => {
                      fileInputsRef.current[inputKey] = el;
                    }}
                    type="file"
                    accept="audio/*"
                    onChange={(e) =>
                      void handleUploadVoiceover(optIdx as 0 | 1 | 2 | 3, e)
                    }
                    className="hidden"
                  />

                  {optClip ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.getContext();
                          void soundEngine.playClip(optClip, 1);
                        }}
                        title="تشغيل صوت الخيار"
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40 text-[11px] font-mono-nums cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        <span>{optClip.duration.toFixed(1)}ث</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeVoiceover(optIdx as 0 | 1 | 2 | 3)}
                        title="حذف الصوت"
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isVoicing}
                        onClick={() => void handleGenerateSingleFieldVoice(optIdx as 0 | 1 | 2 | 3)}
                        title="توليد صوت ذكي لهذا الخيار"
                        className="p-1.5 rounded-lg bg-[#00B050]/15 border border-[#00B050]/40 hover:bg-[#00B050]/30 text-[#00B050] dark:text-[#6ee7b7] cursor-pointer disabled:opacity-50"
                      >
                        {voicingTarget === String(optIdx) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <MicRecordButton
                        compact
                        fileNameBase={`mic-s${activeIndex + 1}-opt${optIdx + 1}`}
                        disabled={isVoicing}
                        onRecorded={(clip) =>
                          setClipOnSlide(activeIndex, activeSlide, optIdx as 0 | 1 | 2 | 3, clip)
                        }
                        onError={(msg) => setVoiceError(msg)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputsRef.current[inputKey]?.click()}
                        title="رفع صوت لهذا الخيار"
                        className="p-1.5 rounded-lg bg-[var(--panel)] border border-[var(--pline)] hover:border-[var(--gold)] text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isMathOpen && (
                  <MathFieldInput
                    initialText={activeSlide.options[optIdx]}
                    mode="replace"
                    onApply={(nextLatex) => updateOption(optIdx, nextLatex)}
                    onClose={() => setMathTarget(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional Top Badge & Explanation Note + Answer Audio */}
      <div className="flex flex-col gap-3 border-t border-[var(--pline)] pt-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--pmuted)]">
              صوت وتوضيح الناتج الصحيح (اختياري)
            </span>
            <div className="flex items-center gap-1.5">
              <input
                ref={(el) => {
                  fileInputsRef.current['answer'] = el;
                }}
                type="file"
                accept="audio/*"
                onChange={(e) => void handleUploadVoiceover('answer', e)}
                className="hidden"
              />
              {ansClip ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.getContext();
                      void soundEngine.playClip(ansClip, 1);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[#00B050]/18 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40 text-[11px] font-medium cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span className="font-mono-nums">{ansClip.duration.toFixed(1)} ث</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVoiceover('answer')}
                    title="حذف صوت الحل"
                    className="p-1 rounded text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isVoicing}
                    onClick={() => void handleGenerateSingleFieldVoice('answer')}
                    title="توليد صوت ذكي للحل"
                    className="p-1.5 rounded bg-[#00B050]/15 hover:bg-[#00B050]/28 text-[#00B050] dark:text-[#6ee7b7] border border-[#00B050]/40 cursor-pointer disabled:opacity-50"
                  >
                    {voicingTarget === 'answer' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                  </button>
                  <MicRecordButton
                    label="تسجيل"
                    fileNameBase={`mic-s${activeIndex + 1}-ans`}
                    disabled={isVoicing}
                    onRecorded={(clip) =>
                      setClipOnSlide(activeIndex, activeSlide, 'answer', clip)
                    }
                    onError={(msg) => setVoiceError(msg)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputsRef.current['answer']?.click()}
                    title="رفع صوت الحل"
                    className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-[var(--ptxt)] text-[11px] font-medium cursor-pointer"
                  >
                    <Upload className="w-3 h-3 text-[#00B050]" />
                    <span>ملف</span>
                  </button>
                </>
              )}
            </div>
          </div>
          <input
            type="text"
            value={activeSlide.explanationText ?? ''}
            onChange={(e) =>
              onUpdateSlide(activeIndex, {
                ...activeSlide,
                explanationText: e.target.value,
              })
            }
            placeholder="معلومة سريعة مع كشف الجواب..."
            className="w-full px-3.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--pmuted)]">
              عنوان الشارة العلوية (إذا فعّلتها في القالب)
            </span>
            {onUpdateAllSlides && slides.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const raw = (activeSlide.badgeText || 'السؤال 1').trim();
                    const prefix = raw.replace(/\s*\d+\s*$/, '').trim() || 'السؤال';
                    onUpdateAllSlides((all) =>
                      all.map((sl, i) => ({ ...sl, badgeText: `${prefix} ${i + 1}` }))
                    );
                  }}
                  title="ترقيم جميع الشرائح بنفس البادئة (مثل: السؤال 1، السؤال 2...)"
                  className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] text-[10px] font-bold text-[#00B050] dark:text-[#6ee7b7] cursor-pointer whitespace-nowrap"
                >
                  ترقيم الكل تلقائياً
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const txt = activeSlide.badgeText;
                    onUpdateAllSlides((all) => all.map((sl) => ({ ...sl, badgeText: txt })));
                  }}
                  title="تطبيق نفس نص الشارة على جميع الأسئلة"
                  className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--pline)] hover:border-[var(--gold)] text-[10px] font-bold text-[var(--ptxt)] cursor-pointer whitespace-nowrap"
                >
                  نسخ للكل
                </button>
              </div>
            )}
          </div>
          <input
            type="text"
            value={activeSlide.badgeText}
            onChange={(e) =>
              onUpdateSlide(activeIndex, { ...activeSlide, badgeText: e.target.value })
            }
            placeholder="مثال: السؤال 1"
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] focus:border-[#00B050] focus:outline-none text-xs text-[var(--ptxt)] placeholder:text-[var(--pmuted)]"
          />
        </div>

        {/* Optional Per-Slide Difficulty Pill */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-[var(--pmuted)] whitespace-nowrap">
            شارة الصعوبة (اختياري):
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)]">
            {(
              [
                { id: 'none', label: 'بدون', dot: '' },
                { id: 'easy', label: 'سهل', dot: '#22C55E' },
                { id: 'medium', label: 'متوسط', dot: '#F59E0B' },
                { id: 'hard', label: 'صعب', dot: '#EF4444' },
              ] as { id: SlideDifficulty; label: string; dot: string }[]
            ).map((d) => {
              const active = (activeSlide.difficulty || 'none') === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() =>
                    onUpdateSlide(activeIndex, { ...activeSlide, difficulty: d.id })
                  }
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#00B050] text-white'
                      : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                  }`}
                >
                  {d.dot && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: active ? '#FFFFFF' : d.dot }}
                    />
                  )}
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
