import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Download, Film, Layers, X } from 'lucide-react';
import { exportThumbnailJpg } from '../canvas/quizRenderer';
import { ExportProgress, ExportResult, exportQuizVideo } from '../canvas/videoExporter';
import {
  QuizProject,
  computeProjectTimeline,
  getCanvasDimensions,
} from '../types/quiz';
import {
  canShareNatively,
  isAndroidNativeApp,
  saveOrDownloadBlob,
  shareBlobNatively,
} from '../utils/nativeDownload';

interface ExportVideoModalProps {
  isOpen: boolean;
  project: QuizProject;
  onClose: () => void;
}

type ExportScopeMode = 'full' | 'single' | 'splitBatch';

export const ExportVideoModal: React.FC<ExportVideoModalProps> = ({
  isOpen,
  project,
  onClose,
}) => {
  const [scopeMode, setScopeMode] = useState<ExportScopeMode>('full');
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<ExportProgress>({
    progress: 0,
    currentTime: 0,
    totalDuration: 0,
    statusText: '',
  });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [exportedFileName, setExportedFileName] = useState<string>('');
  const [batchDoneCount, setBatchDoneCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const startSingleOrFullExport = (mode: 'full' | 'single', slideIdx = 0) => {
    const activeProject = projectRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setBatchDoneCount(0);
    setStatus('rendering');
    setSaveNotice('');
    setErrorMsg('');

    const targetSlides =
      mode === 'single' && activeProject.slides[slideIdx]
        ? [activeProject.slides[slideIdx]]
        : activeProject.slides;

    void exportQuizVideo(
      targetSlides,
      activeProject.template,
      activeProject.timing,
      activeProject.audio,
      (p) => setProgress(p),
      controller.signal
    )
      .then(async (res) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(res.blob);
        const prefix =
          mode === 'single' ? `quiz-slide-${slideIdx + 1}` : 'youtube-short-quiz';
        const generatedName = `${prefix}-${Date.now()}.${res.extension || 'webm'}`;
        setResult(res);
        setVideoUrl(url);
        setExportedFileName(generatedName);
        setStatus('done');

        if (isAndroidNativeApp()) {
          setIsSaving(true);
          const saveRes = await saveOrDownloadBlob(res.blob, generatedName, res.mimeType);
          if (!controller.signal.aborted) {
            setIsSaving(false);
            if (saveRes.ok) {
              setSaveNotice(
                `تم حفظ الفيديو تلقائياً في التنزيلات: Downloads/ShortsQuizStudio/${saveRes.fileName || generatedName}`
              );
            } else if (saveRes.error) {
              setSaveNotice(`تعذر الحفظ التلقائي (${saveRes.error})، جرّب زر مشاركة / حفظ.`);
            }
          }
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير الفيديو');
        setStatus('error');
      });
  };

  const startSplitBatchExport = async () => {
    const activeProject = projectRef.current;
    if (activeProject.slides.length === 0) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setBatchDoneCount(0);
    setStatus('rendering');
    setSaveNotice('');
    setErrorMsg('');

    const totalCount = activeProject.slides.length;
    try {
      let lastRes: ExportResult | null = null;
      let lastFile = '';
      for (let i = 0; i < totalCount; i++) {
        if (controller.signal.aborted) return;
        const slide = activeProject.slides[i];
        const res = await exportQuizVideo(
          [slide],
          activeProject.template,
          activeProject.timing,
          activeProject.audio,
          (p) => {
            const overall = (i + p.progress) / totalCount;
            setProgress({
              progress: overall,
              currentTime: p.currentTime,
              totalDuration: p.totalDuration,
              statusText: `سؤال ${i + 1} من ${totalCount}: ${p.statusText || 'جارٍ التصدير...'}`,
            });
          },
          controller.signal
        );
        if (controller.signal.aborted) return;
        const fileName = `quiz-slide-${i + 1}-${Date.now()}.${res.extension || 'webm'}`;
        await saveOrDownloadBlob(res.blob, fileName, res.mimeType);
        lastRes = res;
        lastFile = fileName;
        setBatchDoneCount(i + 1);
      }

      if (lastRes && !controller.signal.aborted) {
        const url = URL.createObjectURL(lastRes.blob);
        setResult(lastRes);
        setVideoUrl(url);
        setExportedFileName(lastFile);
        setStatus('done');
        setSaveNotice(`تم تصدير وتنزيل ${totalCount} فيديوهات مستقلة بنجاح.`);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setErrorMsg(err instanceof Error ? err.message : 'فشل تصدير الدفعة');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setScopeMode('full');
      setSelectedSlideIdx(0);
      setStatus('idle');
      setResult(null);
      setExportedFileName('');
      setBatchDoneCount(0);
      setIsSaving(false);
      setSaveNotice('');
      setErrorMsg('');
      return;
    }

    // Default immediate full export — preserves existing behavior 100%
    setScopeMode('full');
    startSingleOrFullExport('full');

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const fileName =
    exportedFileName || `youtube-short-quiz-${Date.now()}.${result?.extension || 'webm'}`;

  const handleDownload = async () => {
    if (!result || isSaving) return;
    setIsSaving(true);
    setSaveNotice('');
    const res = await saveOrDownloadBlob(result.blob, fileName, result.mimeType);
    setIsSaving(false);
    if (res.ok) {
      setSaveNotice(
        res.savedNatively
          ? `تم حفظ الفيديو في مجلد التنزيلات: Downloads/ShortsQuizStudio/${res.fileName || fileName}`
          : 'بدأ تنزيل الفيديو على جهازك.'
      );
    } else if (res.error) {
      setSaveNotice(`تعذر حفظ الفيديو: ${res.error}`);
    }
  };

  const handleCaptureCover = async () => {
    if (isCapturingThumb) return;
    setIsCapturingThumb(true);
    try {
      const targetIdx = scopeMode === 'single' ? selectedSlideIdx : 0;
      const targetSlides =
        scopeMode === 'single' && project.slides[targetIdx]
          ? [project.slides[targetIdx]]
          : project.slides;
      const schedules = computeProjectTimeline(
        targetSlides,
        project.timing,
        project.audio,
        project.template
      );
      const sched = schedules[0];
      const captureTime = sched
        ? sched.startTime +
          sched.tThinkingStart +
          Math.min(1.1, project.timing.thinkingDuration * 0.25)
        : 0.5;
      const blob = await exportThumbnailJpg(
        targetSlides,
        project.template,
        project.timing,
        project.audio,
        captureTime
      );
      if (blob) {
        const thumbName = `quiz-cover-${Date.now()}.jpg`;
        const res = await saveOrDownloadBlob(blob, thumbName, 'image/jpeg');
        if (res.ok) {
          setSaveNotice('تم حفظ صورة الغلاف (JPG) بدقة الفيديو الكاملة.');
        }
      }
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const canNativeShare = !!result && canShareNatively(fileName, result.mimeType, result.blob);

  const handleShareVideo = async () => {
    if (!result || isSaving) return;
    try {
      setIsSaving(true);
      await shareBlobNatively(result.blob, fileName, result.mimeType, 'فيديو شورتس الأسئلة');
    } catch {
      // User cancelled share sheet
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelAndClose = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    onClose();
  };

  const handleSwitchScope = (nextScope: ExportScopeMode) => {
    if (nextScope === scopeMode && status !== 'idle') return;
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setScopeMode(nextScope);
    if (nextScope === 'full') {
      startSingleOrFullExport('full');
    } else {
      setStatus('idle');
      setSaveNotice('');
      setErrorMsg('');
    }
  };

  const dims = getCanvasDimensions(project.template);
  const ratioLabel = project.template.aspectRatio === '16:9' ? '16:9' : '9:16';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--panel)] border border-[var(--pline)] shadow-2xl overflow-hidden text-[var(--ptxt)] max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--pline)] shrink-0">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-[#00B050]" />
            <h3 className="text-base font-bold">
              تصدير الفيديو ({dims.width}×{dims.height})
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCancelAndClose}
            className="p-1.5 rounded-lg text-[var(--pmuted)] hover:text-[var(--ptxt)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {/* Optional Export Scope Switcher (Full by default) */}
          {project.slides.length > 1 && (
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <button
                type="button"
                onClick={() => handleSwitchScope('full')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'full'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                الفيديو الكامل
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('single')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'single'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                سؤال محدد
              </button>
              <button
                type="button"
                onClick={() => handleSwitchScope('splitBatch')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  scopeMode === 'splitBatch'
                    ? 'bg-[#00B050] text-white'
                    : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
                }`}
              >
                كل سؤال مستقل
              </button>
            </div>
          )}

          {/* Idle controls for single slide or split batch mode */}
          {status === 'idle' && scopeMode === 'single' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-[var(--ptxt)]">
                  اختر السؤال لتصديره كفيديو مستقل:
                </span>
                <select
                  value={selectedSlideIdx}
                  onChange={(e) => setSelectedSlideIdx(parseInt(e.target.value, 10))}
                  className="px-3 py-2 rounded-lg bg-[var(--panel)] border border-[var(--pline)] text-xs text-[var(--ptxt)] focus:border-[#00B050] focus:outline-none"
                >
                  {project.slides.map((sl, i) => (
                    <option key={sl.id} value={i}>
                      سؤال {i + 1}: {(sl.question || '').slice(0, 48)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => startSingleOrFullExport('single', selectedSlideIdx)}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                بدء تصدير السؤال {selectedSlideIdx + 1}
              </button>
            </div>
          )}

          {status === 'idle' && scopeMode === 'splitBatch' && (
            <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--pline)]">
              <div className="flex items-start gap-2 text-xs text-[var(--ptxt)] leading-relaxed">
                <Layers className="w-4 h-4 text-[#00B050] shrink-0 mt-0.5" />
                <span>
                  سيتم تجهيز وحفظ <strong>{project.slides.length} فيديوهات شورتس مستقلة</strong>{' '}
                  (سؤال واحد في كل فيديو) بنفس التصميم والأصوات تباعاً.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void startSplitBatchExport()}
                className="w-full py-2.5 rounded-xl bg-[#00B050] hover:bg-[#00c85b] text-white text-xs font-bold cursor-pointer"
              >
                تصدير وتنزيل كل الأسئلة ({project.slides.length} فيديو)
              </button>
            </div>
          )}

          {status === 'rendering' && (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="truncate">{progress.statusText || 'جارٍ التحضير...'}</span>
                <span className="font-mono-nums text-[#00B050] font-bold shrink-0">
                  {scopeMode === 'splitBatch'
                    ? `${Math.round(progress.progress * 100)}%`
                    : `${progress.currentTime.toFixed(1)} / ${progress.totalDuration.toFixed(1)} ث`}
                </span>
              </div>

              <div className="w-full h-2.5 rounded-full bg-[var(--surface)] overflow-hidden border border-[var(--pline)]">
                <div
                  className="h-full bg-[#00B050] transition-all duration-150"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>

              <p className="text-xs text-[var(--pmuted)] leading-relaxed">
                يتم الآن تسجيل الحركات والعداد ودمج جميع المؤثرات الصوتية بدقة عالية{' '}
                {ratioLabel}. يرجى إبقاء هذه النافذة مفتوحة حتى الاكتمال.
              </p>

              <button
                type="button"
                onClick={handleCancelAndClose}
                className="mt-2 w-full py-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] border border-[var(--pline)] text-xs font-semibold transition-colors cursor-pointer"
              >
                إلغاء التصدير
              </button>
            </div>
          )}

          {status === 'done' && videoUrl && result && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[#00B050]">
                <CheckCircle2 className="w-5 h-5" />
                <span>
                  {scopeMode === 'splitBatch'
                    ? `تم تجهيز وتنزيل ${batchDoneCount} فيديو بنجاح`
                    : 'تم تجهيز الفيديو بنجاح مع الأصوات'}
                </span>
              </div>

              <div className="w-full max-h-[320px] flex justify-center bg-black rounded-xl overflow-hidden border border-[var(--pline)]">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="h-[300px] w-auto object-contain"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--pmuted)]">
                <span>الصيغة: {result.extension.toUpperCase()}</span>
                <span className="font-mono-nums">
                  الحجم: {(result.blob.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>

              {saveNotice && (
                <div className="px-3 py-2 rounded-xl bg-[#00B050]/12 border border-[#00B050]/35 text-xs text-[#00B050] dark:text-[#6ee7b7] leading-relaxed break-all">
                  {saveNotice}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleDownload()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-[#00B050] hover:bg-[#00c85b] disabled:opacity-60 text-white text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isSaving ? 'جارٍ الحفظ...' : 'تنزيل الفيديو'}</span>
                </button>
                <button
                  type="button"
                  disabled={isCapturingThumb}
                  onClick={() => void handleCaptureCover()}
                  title="حفظ صورة غلاف JPG بدقة كاملة"
                  className="flex items-center gap-1.5 px-3 py-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] hover:border-[#00B050] disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-[#00B050]" />
                  <span>{isCapturingThumb ? '...' : 'غلاف JPG'}</span>
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleShareVideo()}
                    className="px-3.5 py-3 rounded-xl bg-[var(--surface)] border border-[#00B050]/40 disabled:opacity-60 text-[#00B050] dark:text-[#6ee7b7] text-xs font-bold transition-colors cursor-pointer"
                  >
                    مشاركة / حفظ
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCancelAndClose}
                  className="px-3.5 py-3 rounded-xl bg-[var(--surface)] border border-[var(--pline)] text-xs font-medium transition-colors cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-sm text-rose-400">{errorMsg}</p>
              <button
                type="button"
                onClick={handleCancelAndClose}
                className="w-full py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-xs font-semibold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
