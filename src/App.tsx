import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Film,
  FolderOpen,
  Layers,
  Lock,
  Moon,
  Music,
  Palette,
  Redo2,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { AiGeneratorPanel } from './components/AiGeneratorPanel';
import { AppLockScreen, ManageLockModal } from './components/AppLockGate';
import { AudioTimingPanel } from './components/AudioTimingPanel';
import { BulkImportPanel } from './components/BulkImportPanel';
import { ExportVideoModal } from './components/ExportVideoModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ProjectsModal } from './components/ProjectsModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ShortsPreviewStage } from './components/ShortsPreviewStage';
import { SlidesEditorPanel } from './components/SlidesEditorPanel';
import { TemplateDesignPanel } from './components/TemplateDesignPanel';
import {
  loadProjectFromStore,
  normalizeLoadedProject,
  saveProjectToStore,
} from './storage/projectStore';
import {
  QuestionSlide,
  QuizProject,
  STUDIO_THEME_ORDER,
  applyChannelThemePreset,
  applyStudioThemePreset,
  applyThemeBackgroundOnly,
  createDefaultProject,
  getCanvasDimensions,
  getTotalDuration,
} from './types/quiz';
import { isAppLockEnabled } from './utils/appLock';
import { setRootBackHandler } from './utils/androidBack';

type StudioTab = 'slides' | 'ai' | 'template' | 'audio' | 'import';
type MobileStageMode = 'compact' | 'expanded' | 'collapsed';

export default function App() {
  const [project, setProject] = useState<QuizProject>(() => createDefaultProject());
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>('slides');
  const [tabHistory, setTabHistory] = useState<StudioTab[]>([]);
  const [mobileStageMode, setMobileStageMode] = useState<MobileStageMode>('compact');
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [studioDark, setStudioDark] = useState(true);
  const [isLocked, setIsLocked] = useState(() => isAppLockEnabled());
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const hasLocalMutationRef = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const pastRef = useRef<QuizProject[]>([]);
  const futureRef = useRef<QuizProject[]>([]);
  const lastHistoryPushTimeRef = useRef(0);

  const navigateToTab = useCallback((nextTab: StudioTab) => {
    setActiveTab((prev) => {
      if (prev !== nextTab) {
        setTabHistory((hist) => [...hist.slice(-10), prev]);
      }
      return nextTab;
    });
  }, []);

  useEffect(() => {
    return setRootBackHandler(() => {
      if (isExportOpen) {
        setIsExportOpen(false);
        return true;
      }
      if (isProjectsOpen) {
        setIsProjectsOpen(false);
        return true;
      }
      if (isLockModalOpen) {
        setIsLockModalOpen(false);
        return true;
      }
      if (mobileStageMode !== 'compact') {
        setMobileStageMode('compact');
        return true;
      }
      if (tabHistory.length > 0) {
        const prevTab = tabHistory[tabHistory.length - 1];
        setTabHistory((hist) => hist.slice(0, -1));
        setActiveTab(prevTab);
        return true;
      }
      if (activeTab !== 'slides') {
        setActiveTab('slides');
        return true;
      }
      return false;
    });
  }, [isExportOpen, isProjectsOpen, isLockModalOpen, mobileStageMode, tabHistory, activeTab]);

  useEffect(() => {
    const root = document.documentElement;
    if (studioDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [studioDark]);

  const updateProject = useCallback(
    (updater: (prev: QuizProject) => QuizProject, immediateHistory = false) => {
      hasLocalMutationRef.current = true;
      setProject((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        const now = Date.now();
        if (immediateHistory || now - lastHistoryPushTimeRef.current > 450 || pastRef.current.length === 0) {
          pastRef.current = [...pastRef.current.slice(-39), prev];
          lastHistoryPushTimeRef.current = now;
        }
        futureRef.current = [];
        setCanUndo(pastRef.current.length > 0);
        setCanRedo(false);
        return next;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const prevSnapshot = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [projectRef.current, ...futureRef.current].slice(0, 40);
    setProject(prevSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, prevSnapshot.slides.length - 1)));
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const nextSnapshot = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-39), projectRef.current];
    setProject(nextSnapshot);
    setActiveSlideIndex((idx) => Math.min(idx, Math.max(0, nextSnapshot.slides.length - 1)));
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
        (target as HTMLInputElement).type !== 'range' &&
        (target as HTMLInputElement).type !== 'checkbox' &&
        (target as HTMLInputElement).type !== 'color';
      if (isTextInput) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    void loadProjectFromStore().then((loaded) => {
      if (!hasLocalMutationRef.current) {
        setProject(loaded);
      }
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => {
      void saveProjectToStore(project);
    }, 380);
    return () => clearTimeout(timer);
  }, [project, isLoaded]);

  useEffect(() => {
    const flushSave = () => {
      if (isLoaded) {
        void saveProjectToStore(projectRef.current);
      }
    };
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('pagehide', flushSave);
      window.removeEventListener('beforeunload', flushSave);
    };
  }, [isLoaded]);

  const audioSyncSigRef = useRef('');
  useEffect(() => {
    if (!isLoaded) return;
    const urls: string[] = [];
    if (project.template.introHookAudio?.dataUrl) {
      urls.push(
        `h:${project.template.introHookAudio.dataUrl.slice(0, 32)}:${project.template.introHookAudio.dataUrl.length}`
      );
    }
    (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
      (slot) => {
        const cfg = project.audio[slot];
        if (cfg?.sourceType === 'custom' && cfg.customDataUrl) {
          urls.push(`a:${slot}:${cfg.customDataUrl.slice(0, 32)}:${cfg.customDataUrl.length}`);
        }
      }
    );
    project.slides.forEach((s, si) => {
      if (s.voiceover?.question?.dataUrl) {
        urls.push(`q${si}:${s.voiceover.question.dataUrl.slice(0, 32)}:${s.voiceover.question.dataUrl.length}`);
      }
      if (s.voiceover?.answer?.dataUrl) {
        urls.push(`an${si}:${s.voiceover.answer.dataUrl.slice(0, 32)}:${s.voiceover.answer.dataUrl.length}`);
      }
      s.voiceover?.options?.forEach((o, oi) => {
        if (o?.dataUrl) {
          urls.push(`o${si}_${oi}:${o.dataUrl.slice(0, 32)}:${o.dataUrl.length}`);
        }
      });
    });

    if (urls.length === 0) {
      audioSyncSigRef.current = '';
      return;
    }

    const sig = urls.join('|');
    if (audioSyncSigRef.current === sig) return;
    audioSyncSigRef.current = sig;

    let cancelled = false;
    const decodeCtx =
      typeof OfflineAudioContext !== 'undefined'
        ? new OfflineAudioContext(1, 1, 48000)
        : undefined;

    void soundEngine
      .syncProjectAudioDurations(project.slides, project.audio, project.template, decodeCtx)
      .then((synced) => {
        if (cancelled) return;
        setProject((prev) => {
          let changed = false;
          const nextSlides = prev.slides.map((s, idx) => {
            const ss = synced.slides[idx];
            if (!s.voiceover || !ss?.voiceover) return s;
            const qChanged =
              s.voiceover.question?.dataUrl &&
              ss.voiceover.question &&
              Math.abs((s.voiceover.question.duration || 0) - ss.voiceover.question.duration) > 0.02;
            const ansChanged =
              s.voiceover.answer?.dataUrl &&
              ss.voiceover.answer &&
              Math.abs((s.voiceover.answer.duration || 0) - ss.voiceover.answer.duration) > 0.02;
            const optsChanged = Boolean(
              s.voiceover.options?.some(
                (o, oi) =>
                  o?.dataUrl &&
                  ss.voiceover?.options?.[oi] &&
                  Math.abs((o.duration || 0) - ss.voiceover.options[oi]!.duration) > 0.02
              )
            );
            if (!qChanged && !ansChanged && !optsChanged) return s;
            changed = true;
            return { ...s, voiceover: ss.voiceover };
          });

          const nextAudio = { ...prev.audio };
          (['questionEnter', 'optionEnter', 'countdownTick', 'suspense', 'correctReveal', 'bgMusic'] as const).forEach(
            (slot) => {
              const pCfg = prev.audio[slot];
              const sCfg = synced.audio[slot];
              if (
                pCfg?.sourceType === 'custom' &&
                pCfg.customDataUrl &&
                sCfg?.duration &&
                Math.abs((pCfg.duration ?? 0) - sCfg.duration) > 0.02
              ) {
                changed = true;
                nextAudio[slot] = { ...pCfg, duration: sCfg.duration };
              }
            }
          );

          let nextTemplate = prev.template;
          if (
            prev.template.introHookAudio?.dataUrl &&
            synced.template.introHookAudio &&
            Math.abs((prev.template.introHookAudio.duration || 0) - synced.template.introHookAudio.duration) >
              0.02
          ) {
            changed = true;
            nextTemplate = { ...prev.template, introHookAudio: synced.template.introHookAudio };
          }

          return changed
            ? { ...prev, slides: nextSlides, audio: nextAudio, template: nextTemplate }
            : prev;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, project.slides, project.audio, project.template]);

  const totalDuration = getTotalDuration(
    project.slides,
    project.timing,
    project.audio,
    project.template
  );
  const canvasDims = getCanvasDimensions(project.template);

  const handleUpdateSlide = useCallback(
    (idx: number, updated: QuestionSlide) => {
      updateProject((prev) => {
        const nextSlides = [...prev.slides];
        nextSlides[idx] = updated;
        return { ...prev, slides: nextSlides };
      });
    },
    [updateProject]
  );

  const handleAddSlide = useCallback(() => {
    updateProject((prev) => {
      const nextNum = prev.slides.length + 1;
      const newSlide: QuestionSlide = {
        id: `slide-${Date.now()}`,
        badgeText: `السؤال ${nextNum}`,
        question: 'اكتب نص السؤال الجديد هنا',
        options: ['الجواب الصحيح', 'خيار خاطئ 1', 'خيار خاطئ 2', 'خيار خاطئ 3'],
        correctIndex: 0,
        explanationText: '',
      };
      const nextSlides = [...prev.slides, newSlide];
      setActiveSlideIndex(nextSlides.length - 1);
      return { ...prev, slides: nextSlides };
    }, true);
  }, [updateProject]);

  const handleDuplicateSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        const source = prev.slides[idx];
        if (!source) return prev;
        const copy: QuestionSlide = {
          ...source,
          id: `slide-${Date.now()}`,
          options: [...source.options] as [string, string, string, string],
        };
        const nextSlides = [
          ...prev.slides.slice(0, idx + 1),
          copy,
          ...prev.slides.slice(idx + 1),
        ];
        setActiveSlideIndex(idx + 1);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleDeleteSlide = useCallback(
    (idx: number) => {
      updateProject((prev) => {
        if (prev.slides.length <= 1) return prev;
        const nextSlides = prev.slides.filter((_, i) => i !== idx);
        setActiveSlideIndex((curr) => Math.min(curr, nextSlides.length - 1));
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleReorderSlide = useCallback(
    (fromIdx: number, toIdx: number) => {
      updateProject((prev) => {
        if (
          fromIdx === toIdx ||
          fromIdx < 0 ||
          toIdx < 0 ||
          fromIdx >= prev.slides.length ||
          toIdx >= prev.slides.length
        ) {
          return prev;
        }
        const nextSlides = [...prev.slides];
        const [moved] = nextSlides.splice(fromIdx, 1);
        nextSlides.splice(toIdx, 0, moved);
        setActiveSlideIndex(toIdx);
        return { ...prev, slides: nextSlides };
      }, true);
    },
    [updateProject]
  );

  const handleUpdateAllSlides = useCallback(
    (updater: (slides: QuestionSlide[]) => QuestionSlide[]) => {
      updateProject((prev) => ({ ...prev, slides: updater(prev.slides) }), true);
    },
    [updateProject]
  );

  const handleCycleChannelTheme = useCallback(() => {
    updateProject((prev) => {
      const currentIdx = STUDIO_THEME_ORDER.indexOf(prev.template.presetId);
      const nextId =
        STUDIO_THEME_ORDER[(currentIdx + 1) % STUDIO_THEME_ORDER.length];
      const mode = prev.template.themeApplyMode || 'bgOnly';
      return {
        ...prev,
        template:
          mode === 'full'
            ? applyStudioThemePreset(prev.template, nextId)
            : applyThemeBackgroundOnly(prev.template, nextId),
      };
    }, true);
  }, [updateProject]);

  const handleToggleAspectRatio = useCallback(() => {
    updateProject(
      (prev) => ({
        ...prev,
        template: {
          ...prev.template,
          aspectRatio: prev.template.aspectRatio === '16:9' ? '9:16' : '16:9',
        },
      }),
      true
    );
  }, [updateProject]);

  const navTabs: { id: StudioTab; label: string }[] = [
    { id: 'slides', label: 'الأسئلة' },
    { id: 'ai', label: 'توليد ذكي' },
    { id: 'template', label: 'القالب والتصميم' },
    { id: 'audio', label: 'الأصوات والتوقيت' },
    { id: 'import', label: 'استيراد سريع' },
  ];

  if (isLocked) {
    return <AppLockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="h-[100dvh] lg:h-screen flex flex-col bg-[var(--page)] text-[var(--ptxt)] overflow-hidden">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-3 lg:gap-8 px-3.5 lg:px-6 h-13 lg:h-16 border-b border-[var(--pline)] bg-[var(--panel)] shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="font-display text-sm sm:text-base lg:text-lg font-extrabold tracking-tight text-[var(--ptxt)] whitespace-nowrap shrink-0"
        >
          استوديو شورتس الأسئلة
        </a>

        {/* Zone 2: 5 single-line navigation links (Desktop / Tablet) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-[var(--pmuted)]">
          {navTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigateToTab(tab.id)}
                className={`relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[var(--ptxt)] font-bold' : 'hover:text-[var(--ptxt)]'
                }`}
              >
                {tab.label}
                {active && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#00B050] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-1.5 lg:gap-2 px-3 lg:px-4 py-1.5 lg:py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-xs lg:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Film className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
            <span>تصدير الفيديو</span>
          </button>
        </div>
      </header>

      {/* Main Studio Workspace: Single Unified Phone Layout on < lg, Split Studio on lg+ */}
      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-[440px_1fr] min-h-0 overflow-hidden">
        {/* Active Editor Panel (Bottom scrollable half on Mobile, Right column on RTL Desktop) */}
        <aside
          className={`order-2 lg:order-1 ${
            mobileStageMode === 'expanded' ? 'hidden lg:flex' : 'flex flex-1 min-h-0'
          } flex-col bg-[var(--panel)] lg:border-l border-t lg:border-t-0 border-[var(--pline)] min-h-0`}
        >
          {/* Unboxed workspace metadata strip + lock + light/dark toggle */}
          <div className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2 px-3.5 py-2 lg:px-5 lg:py-2.5 border-b border-[var(--pline)] text-[11px] lg:text-xs text-[var(--pmuted)] shrink-0">
            <div className="flex items-center gap-1.5 lg:gap-2">
              <span>{project.slides.length} أسئلة</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-nums">
                {canvasDims.width}×{canvasDims.height}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-nums">{totalDuration.toFixed(1)} ث</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 border border-[var(--pline)] rounded-md bg-[var(--surface)] px-1 py-0.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="تراجع (Ctrl+Z)"
                  className="p-1 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="إعادة (Ctrl+Y)"
                  className="p-1 text-[var(--ptxt)] disabled:opacity-30 hover:text-[#00B050] cursor-pointer disabled:cursor-default"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsProjectsOpen(true)}
                title="مكتبة المشاريع المحفوظة"
                className="flex items-center gap-1 text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] hover:underline cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>المشاريع</span>
              </button>
              <PWAInstallButton />
              <button
                type="button"
                onClick={() => setIsLockModalOpen(true)}
                title="قفل الخصوصية الشخصي (كلمة مرور التطبيق)"
                className="flex items-center gap-1 text-[11px] font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 text-[#00B050]" />
                <span>القفل</span>
              </button>
              <button
                type="button"
                onClick={() => setStudioDark((d) => !d)}
                title={studioDark ? 'التبديل للوضع الفاتح الدافئ' : 'التبديل للوضع الداكن'}
                className="flex items-center gap-1 text-[11px] font-semibold text-[var(--pmuted)] hover:text-[var(--ptxt)] cursor-pointer"
              >
                {studioDark ? <Sun className="w-3.5 h-3.5 text-[var(--gold)]" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{studioDark ? 'فاتح' : 'داكن'}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 lg:p-5 overscroll-contain">
            {aiNotice && (
              <div className="mb-4 flex items-start justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs text-amber-300 leading-relaxed">
                <span>{aiNotice}</span>
                <button
                  type="button"
                  onClick={() => setAiNotice(null)}
                  className="text-amber-300 hover:text-white font-bold px-1 cursor-pointer shrink-0"
                  aria-label="إغلاق التنبيه"
                >
                  ×
                </button>
              </div>
            )}

            {activeTab === 'slides' && (
              <SlidesEditorPanel
                slides={project.slides}
                activeIndex={activeSlideIndex}
                aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                onAiVoiceChange={(voice) =>
                  updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                }
                onSelectSlide={setActiveSlideIndex}
                onUpdateSlide={handleUpdateSlide}
                onAddSlide={handleAddSlide}
                onDuplicateSlide={handleDuplicateSlide}
                onDeleteSlide={handleDeleteSlide}
                onReorderSlide={handleReorderSlide}
                onUpdateAllSlides={handleUpdateAllSlides}
              />
            )}

            {activeTab === 'ai' && (
              <AiGeneratorPanel
                voiceName={project.preferredAiVoice ?? 'Kore'}
                onVoiceChange={(voice) =>
                  updateProject((prev) => ({ ...prev, preferredAiVoice: voice }), true)
                }
                onInsertSlides={(newSlides, mode, enableAutoSync, warningMessage, applyMathTheme) => {
                  const targetIdx = mode === 'replace' ? 0 : project.slides.length;
                  updateProject((prev) => {
                    const updatedSlides =
                      mode === 'replace' ? newSlides : [...prev.slides, ...newSlides];
                    return {
                      ...prev,
                      slides: updatedSlides,
                      template: applyMathTheme
                        ? applyChannelThemePreset(prev.template, 'channelMath')
                        : prev.template,
                      timing: enableAutoSync
                        ? { ...prev.timing, autoSyncWithAudio: true }
                        : prev.timing,
                    };
                  }, true);
                  setAiNotice(warningMessage ?? null);
                  setActiveSlideIndex(targetIdx);
                  setActiveTab('slides');
                }}
              />
            )}

            {activeTab === 'template' && (
              <TemplateDesignPanel
                template={project.template}
                timing={project.timing}
                aiVoiceName={project.preferredAiVoice ?? 'Kore'}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onChange={(nextTemplate, immediate = true) =>
                  updateProject((prev) => ({ ...prev, template: nextTemplate }), immediate)
                }
                onTimingChange={(nextTiming) =>
                  updateProject((prev) => ({ ...prev, timing: nextTiming }), true)
                }
              />
            )}

            {activeTab === 'audio' && (
              <AudioTimingPanel
                audio={project.audio}
                timing={project.timing}
                onAudioChange={(nextAudio) =>
                  updateProject((prev) => ({ ...prev, audio: nextAudio }), true)
                }
                onTimingChange={(nextTiming) =>
                  updateProject((prev) => ({ ...prev, timing: nextTiming }))
                }
              />
            )}

            {activeTab === 'import' && (
              <BulkImportPanel
                project={project}
                onReplaceSlides={(newSlides) => {
                  updateProject((prev) => ({ ...prev, slides: newSlides }), true);
                  setActiveSlideIndex(0);
                }}
                onAppendSlides={(moreSlides) => {
                  updateProject(
                    (prev) => ({
                      ...prev,
                      slides: [...prev.slides, ...moreSlides],
                    }),
                    true
                  );
                }}
                onImportFullProject={(loaded) => {
                  updateProject(() => normalizeLoadedProject(loaded), true);
                  setActiveSlideIndex(0);
                }}
              />
            )}
          </div>
        </aside>

        {/* Live Stage (Docked Top on Mobile, Left Column on RTL Desktop) */}
        <section
          className={`order-1 lg:order-2 flex flex-col items-center justify-center bg-[var(--page)] overflow-hidden ${
            mobileStageMode === 'expanded'
              ? 'flex-1 min-h-0'
              : mobileStageMode === 'collapsed'
              ? 'shrink-0 lg:flex-1 lg:min-h-0'
              : 'h-[245px] sm:h-[285px] shrink-0 lg:h-auto lg:flex-1 lg:min-h-0'
          }`}
        >
          <ShortsPreviewStage
            slides={project.slides}
            activeSlideIndex={activeSlideIndex}
            template={project.template}
            timing={project.timing}
            audio={project.audio}
            isExporting={isExportOpen}
            mobileStageMode={mobileStageMode}
            onChangeMobileStageMode={setMobileStageMode}
            onToggleSafeGuides={() =>
              updateProject(
                (prev) => ({
                  ...prev,
                  template: {
                    ...prev.template,
                    showSafeGuides: !prev.template.showSafeGuides,
                  },
                }),
                true
              )
            }
            onToggleAspectRatio={handleToggleAspectRatio}
            onCycleChannelTheme={handleCycleChannelTheme}
            onActiveSlideChange={setActiveSlideIndex}
            onUpdateTemplate={(nextTemplate) =>
              updateProject((prev) => ({ ...prev, template: nextTemplate }))
            }
          />
        </section>
      </main>

      {/* Native Phone Bottom Navigation Bar (< md / mobile) */}
      <nav
        aria-label="أقسام الاستوديو"
        className="md:hidden grid grid-cols-5 border-t border-[var(--pline)] bg-[var(--panel)] shrink-0 pb-[env(safe-area-inset-bottom)]"
      >
        {[
          { id: 'slides', label: 'الأسئلة', icon: Layers },
          { id: 'ai', label: 'ذكاء', icon: Sparkles },
          { id: 'template', label: 'القالب', icon: Palette },
          { id: 'audio', label: 'الأصوات', icon: Music },
          { id: 'import', label: 'استيراد', icon: Film },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id && mobileStageMode !== 'expanded';
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                navigateToTab(t.id as StudioTab);
                if (mobileStageMode === 'expanded') {
                  setMobileStageMode('compact');
                }
              }}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-bold transition-colors cursor-pointer ${
                active
                  ? 'text-[#00B050] dark:text-[#6ee7b7]'
                  : 'text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              {active && (
                <span className="absolute top-0 inset-x-3 h-0.5 rounded-b-full bg-[#00B050]" />
              )}
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Video Export Modal */}
      <ExportVideoModal
        isOpen={isExportOpen}
        project={project}
        onClose={() => setIsExportOpen(false)}
      />

      {/* Multi-Project Library Modal */}
      <ProjectsModal
        isOpen={isProjectsOpen}
        currentProject={project}
        onClose={() => setIsProjectsOpen(false)}
        onSelectProject={(loaded) => {
          updateProject(() => normalizeLoadedProject(loaded), true);
          setActiveSlideIndex(0);
          setAiNotice(null);
        }}
        onRenameCurrent={(name) =>
          updateProject((prev) => ({ ...prev, name }), true)
        }
      />

      {/* Personal Passcode Lock Management Modal */}
      <ManageLockModal
        isOpen={isLockModalOpen}
        onClose={() => setIsLockModalOpen(false)}
        onLockNow={() => setIsLocked(true)}
      />

      <OfflineIndicator />
    </div>
  );
}
