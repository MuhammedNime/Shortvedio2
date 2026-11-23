import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Monitor,
  Move,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { saveOrDownloadBlob } from '../utils/nativeDownload';
import {
  DragTargetId,
  StageElementHitbox,
  clearRendererCaches,
  collectSoundEventsInInterval,
  ensureQuizFontsLoaded,
  exportThumbnailJpg,
  getSlideTimeInfo,
  preloadTemplateBackground,
  preloadTimerVideo,
  renderQuizFrame,
} from '../canvas/quizRenderer';
import {
  AudioSettings,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getIntroHookDuration,
  getSlidesContentDuration,
  getTotalDuration,
} from '../types/quiz';

interface ShortsPreviewStageProps {
  slides: QuestionSlide[];
  activeSlideIndex: number;
  template: TemplateSettings;
  timing: TimingSettings;
  audio: AudioSettings;
  isExporting?: boolean;
  mobileStageMode?: 'compact' | 'expanded' | 'collapsed';
  onChangeMobileStageMode?: (mode: 'compact' | 'expanded' | 'collapsed') => void;
  onToggleSafeGuides: () => void;
  onToggleAspectRatio?: () => void;
  onCycleChannelTheme: () => void;
  onActiveSlideChange?: (idx: number) => void;
  onUpdateTemplate?: (next: TemplateSettings) => void;
}

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped % 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

export const ShortsPreviewStage: React.FC<ShortsPreviewStageProps> = ({
  slides,
  activeSlideIndex,
  template,
  timing,
  audio,
  isExporting = false,
  mobileStageMode = 'compact',
  onChangeMobileStageMode,
  onToggleSafeGuides,
  onToggleAspectRatio,
  onCycleChannelTheme,
  onActiveSlideChange,
  onUpdateTemplate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hideControlsOverlay, setHideControlsOverlay] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dragMode, setDragMode] = useState(false);
  const [activeDragTarget, setActiveDragTarget] = useState<DragTargetId | null>(null);

  const { width: canvasW, height: canvasH } = getCanvasDimensions(template);
  const isWide = template.aspectRatio === '16:9';
  const totalDuration = getTotalDuration(slides, timing, audio, template);

  const timeRef = useRef(0);
  const totalDurationRef = useRef(totalDuration);
  const hasUserScrubbedRef = useRef(false);
  const hasInitializedTimeRef = useRef(false);
  const isExternallySelectedSlideRef = useRef(false);
  const isScrubSlideSyncRef = useRef(false);
  const forceFirstTickRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isMutedRef = useRef(false);
  const playSessionRef = useRef(0);
  const slidesRef = useRef(slides);
  const templateRef = useRef(template);
  const timingRef = useRef(timing);
  const audioRef = useRef(audio);
  const dragModeRef = useRef(dragMode);
  const activeDragTargetRef = useRef<DragTargetId | null>(activeDragTarget);
  const hitboxesRef = useRef<StageElementHitbox[]>([]);
  const dragSessionRef = useRef<{
    target: DragTargetId;
    startCanvasX: number;
    startCanvasY: number;
    startTemplate: TemplateSettings;
  } | null>(null);

  slidesRef.current = slides;
  templateRef.current = template;
  timingRef.current = timing;
  audioRef.current = audio;
  totalDurationRef.current = totalDuration;
  isMutedRef.current = isMuted;
  dragModeRef.current = dragMode;
  activeDragTargetRef.current = activeDragTarget;

  const drawPreviewFrame = (
    ctx: CanvasRenderingContext2D,
    t: number,
    s = slidesRef.current,
    tpl = templateRef.current,
    tm = timingRef.current,
    au = audioRef.current
  ) => {
    const nextHitboxes: StageElementHitbox[] = [];
    renderQuizFrame(
      ctx,
      t,
      s,
      tpl,
      tm,
      au,
      true,
      dragModeRef.current
        ? { dragMode: true, activeTarget: activeDragTargetRef.current }
        : undefined,
      nextHitboxes
    );
    hitboxesRef.current = nextHitboxes;
  };

  const syncTimeUi = (sec: number, dur = totalDurationRef.current, syncReact = true) => {
    timeRef.current = sec;
    if (rangeInputRef.current) {
      rangeInputRef.current.value = String(sec);
    }
    if (timeLabelRef.current) {
      timeLabelRef.current.textContent = `${formatTimecode(sec)} / ${formatTimecode(dur)}`;
    }
    if (syncReact) {
      setCurrentTime(sec);
    }
  };

  useEffect(() => {
    if (isExporting) {
      setIsPlaying(false);
      setDragMode(false);
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
    }
  }, [isExporting]);

  useEffect(() => {
    let alive = true;
    const redrawWithFreshFontCache = () => {
      if (!alive) return;
      clearRendererCaches();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current);
      }
    };

    void ensureQuizFontsLoaded(template.fontFamily).then(redrawWithFreshFontCache);
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', redrawWithFreshFontCache);
    }
    return () => {
      alive = false;
      if (typeof document !== 'undefined' && document.fonts) {
        document.fonts.removeEventListener('loadingdone', redrawWithFreshFontCache);
      }
    };
  }, [template.fontFamily]);

  useEffect(() => {
    void Promise.all([preloadTemplateBackground(template, slides), preloadTimerVideo()]).then(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { alpha: false });
      if (ctx) {
        drawPreviewFrame(ctx, timeRef.current, slides, template, timing, audio);
      }
    });
  }, [template, slides, timing, audio, canvasW, canvasH, dragMode, activeDragTarget]);

  useEffect(() => {
    if (!hasInitializedTimeRef.current && !hasUserScrubbedRef.current && !isPlayingRef.current) {
      hasInitializedTimeRef.current = true;
      const schedules = computeProjectTimeline(slides, timing, audio, template);
      const sched = schedules[activeSlideIndex] ?? schedules[0];
      if (sched) {
        const showcaseTime = Math.min(
          totalDuration,
          sched.startTime + sched.tThinkingStart + Math.min(1.1, timing.thinkingDuration * 0.25)
        );
        syncTimeUi(showcaseTime, totalDuration, true);
      }
    }
  }, [slides, timing, audio, template, activeSlideIndex, totalDuration]);

  useEffect(() => {
    if (totalDuration > 0 && timeRef.current > totalDuration) {
      syncTimeUi(totalDuration, totalDuration, true);
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx) {
      drawPreviewFrame(ctx, timeRef.current, slides, template, timing, audio);
    }
  }, [slides, template, timing, audio, totalDuration, canvasW, canvasH, dragMode, activeDragTarget]);

  const prevSlideIdxRef = useRef(activeSlideIndex);
  useEffect(() => {
    if (prevSlideIdxRef.current !== activeSlideIndex && !isPlayingRef.current) {
      if (isScrubSlideSyncRef.current) {
        isScrubSlideSyncRef.current = false;
      } else {
        isExternallySelectedSlideRef.current = true;
        const schedules = computeProjectTimeline(slides, timing, audio, template);
        const sched = schedules[activeSlideIndex];
        const target = sched
          ? sched.startTime + sched.tThinkingStart + Math.min(1.1, timing.thinkingDuration * 0.25)
          : 0;
        const clamped = Math.min(totalDuration, target);
        syncTimeUi(clamped, totalDuration, true);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (ctx) {
          drawPreviewFrame(ctx, clamped, slides, template, timing, audio);
        }
      }
    }
    prevSlideIdxRef.current = activeSlideIndex;
  }, [activeSlideIndex, timing, audio, totalDuration, slides, template]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const sessionId = ++playSessionRef.current;

    if (!isPlaying) {
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
      return;
    }

    let canceled = false;
    const isStale = () => canceled || !isPlayingRef.current || playSessionRef.current !== sessionId;

    const startPlayback = async () => {
      let activeSlides = slidesRef.current;
      let activeAudio = audioRef.current;
      let activeTemplate = templateRef.current;

      const synced = await soundEngine.syncProjectAudioDurations(
        slidesRef.current,
        audioRef.current,
        templateRef.current
      );
      if (isStale()) return;
      activeSlides = synced.slides;
      activeAudio = synced.audio;
      activeTemplate = synced.template;

      if (!isMutedRef.current) {
        void soundEngine.startBgMusic(activeAudio.bgMusic).then((src) => {
          if (isStale() && src) {
            soundEngine.stopBgMusic();
          }
        });
      }

      if (isStale()) return;

      let rafId = 0;
      const startMediaTime = timeRef.current;
      const startPerfMs = performance.now();
      let lastUiSyncPerf = startPerfMs;
      let isFirstTick = true;

      const tick = (now: number) => {
        if (isStale()) return;

        const useSynced = activeSlides.length === slidesRef.current.length;
        const curSlides = useSynced ? activeSlides : slidesRef.current;
        const curAudio = useSynced ? activeAudio : audioRef.current;
        const curTemplate = useSynced ? activeTemplate : templateRef.current;

        const rawPrevT = timeRef.current;
        const useFirstMargin = isFirstTick || forceFirstTickRef.current;
        // Ensure events sitting right at play/step start time fire synchronously with first frame
        const prevT = useFirstMargin ? rawPrevT - 0.001 : rawPrevT;
        isFirstTick = false;
        forceFirstTickRef.current = false;

        let nextT = startMediaTime + Math.max(0, (now - startPerfMs) / 1000);
        const maxDur = getTotalDuration(curSlides, timingRef.current, curAudio, curTemplate);

        if (nextT >= maxDur) {
          nextT = maxDur;
          syncTimeUi(nextT, maxDur, true);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { alpha: false });
          if (ctx) {
            drawPreviewFrame(ctx, nextT, curSlides, curTemplate, timingRef.current, curAudio);
          }
          setIsPlaying(false);
          soundEngine.stopBgMusic();
          soundEngine.stopAllSfxAndVoice();
          return;
        }

        if (!isMutedRef.current) {
          const events = collectSoundEventsInInterval(
            prevT,
            nextT,
            curSlides,
            timingRef.current,
            curAudio,
            curTemplate
          );
          const duckIfNeeded = (durSec: number) => {
            if (timingRef.current.autoDuckMusic !== false && durSec > 0.25) {
              soundEngine.duckBgMusic(undefined, durSec, timingRef.current.bgMusicDuckRatio ?? 0.22);
            }
          };

          for (const ev of events) {
            const s = curSlides[ev.slideIndex];
            const maxDur = ev.maxDuration;
            if (ev.type === 'introHook') {
              const hookSfx = curTemplate.introHookSfx ?? 'whoosh';
              const hasHookVoice = Boolean(curTemplate.introHookAudio?.dataUrl);
              if (hookSfx && hookSfx !== 'none') {
                const ctx = soundEngine.getContext();
                soundEngine.playBuiltInSfx(
                  hookSfx,
                  hasHookVoice ? 0.42 : 0.72,
                  ctx,
                  ctx.destination,
                  ctx.currentTime,
                  false,
                  1.6,
                  hasHookVoice ? Math.min(0.28, maxDur ?? 0.28) : maxDur
                );
              }
              if (curTemplate.introHookAudio?.dataUrl) {
                const dur = Math.min(maxDur ?? 99, curTemplate.introHookAudio.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  curTemplate.introHookAudio,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDur
                );
              }
            } else if (ev.type === 'questionEnter') {
              if (s?.voiceover?.question?.dataUrl) {
                const dur = Math.min(maxDur ?? 99, s.voiceover.question.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  s.voiceover.question,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDur
                );
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.questionEnter, undefined, undefined, undefined, false, maxDur);
              }
            } else if (ev.type === 'optionEnter') {
              const oIdx = ev.optionIndex ?? 0;
              const oClip = s?.voiceover?.options?.[oIdx];
              if (oClip?.dataUrl) {
                const dur = Math.min(maxDur ?? 99, oClip.duration || 1.0);
                duckIfNeeded(dur);
                void soundEngine.playClip(oClip, 1, undefined, undefined, undefined, 'voice', maxDur);
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.optionEnter, undefined, undefined, undefined, false, maxDur);
              }
            } else if (ev.type === 'countdownTick') {
              void soundEngine.playSlot(
                curAudio.countdownTick,
                undefined,
                undefined,
                undefined,
                !!ev.urgent,
                maxDur ?? 0.88
              );
            } else if (ev.type === 'suspense') {
              void soundEngine.playSlot(
                curAudio.suspense,
                undefined,
                undefined,
                undefined,
                false,
                maxDur ?? Math.max(0.25, timingRef.current.suspenseDuration ?? 1.6),
                timingRef.current.suspenseDuration
              );
            } else if (ev.type === 'correctReveal') {
              if (s?.voiceover?.answer?.dataUrl) {
                const dur = Math.min(maxDur ?? 99, s.voiceover.answer.duration || 1.2);
                duckIfNeeded(dur);
                void soundEngine.playClip(
                  s.voiceover.answer,
                  1,
                  undefined,
                  undefined,
                  undefined,
                  'voice',
                  maxDur
                );
              } else {
                soundEngine.stopActiveVoice();
                void soundEngine.playSlot(curAudio.correctReveal, undefined, undefined, undefined, false, maxDur);
              }
            }
          }
        }

        const shouldSyncReact = now - lastUiSyncPerf >= 250;
        if (shouldSyncReact) {
          lastUiSyncPerf = now;
        }
        syncTimeUi(nextT, maxDur, shouldSyncReact);

        const info = getSlideTimeInfo(
          nextT,
          curSlides,
          timingRef.current,
          curAudio,
          curTemplate
        );
        if (info && onActiveSlideChange && info.slideIndex !== prevSlideIdxRef.current) {
          prevSlideIdxRef.current = info.slideIndex;
          onActiveSlideChange(info.slideIndex);
        }

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (ctx) {
          drawPreviewFrame(ctx, nextT, curSlides, curTemplate, timingRef.current, curAudio);
        }

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(rafId);
      };
    };

    let stopRaf: (() => void) | undefined;
    void startPlayback().then((cleanup) => {
      if (isStale()) {
        cleanup?.();
        return;
      }
      stopRaf = cleanup;
    });

    return () => {
      canceled = true;
      playSessionRef.current += 1;
      stopRaf?.();
      setCurrentTime(timeRef.current);
      soundEngine.stopBgMusic();
      soundEngine.stopAllSfxAndVoice();
    };
  }, [isPlaying, onActiveSlideChange]);

  const handleTogglePlay = () => {
    soundEngine.getContext();
    if (
      !isPlaying &&
      (!hasUserScrubbedRef.current ||
        isExternallySelectedSlideRef.current ||
        timeRef.current >= totalDuration - 0.05)
    ) {
      hasUserScrubbedRef.current = true;
      isExternallySelectedSlideRef.current = false;
      const schedules = computeProjectTimeline(slides, timing, audio, template);
      const sched = schedules[activeSlideIndex];
      const startAt =
        timeRef.current >= totalDuration - 0.05
          ? 0
          : activeSlideIndex === 0 && template.showIntroHook
            ? 0
            : sched
              ? sched.startTime
              : 0;
      timeRef.current = startAt;
      setCurrentTime(startAt);
      forceFirstTickRef.current = true;
    }
    setIsPlaying((p) => !p);
  };

  const handleRestart = () => {
    soundEngine.getContext();
    soundEngine.stopAllSfxAndVoice();
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    forceFirstTickRef.current = true;
    timeRef.current = 0;
    setCurrentTime(0);
    if (onActiveSlideChange && activeSlideIndex !== 0) {
      isScrubSlideSyncRef.current = true;
      onActiveSlideChange(0);
    }
    setIsPlaying(true);
  };

  const handlePlayCurrentSlide = () => {
    soundEngine.getContext();
    soundEngine.stopAllSfxAndVoice();
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[activeSlideIndex] ?? schedules[0];
    const target = sched ? sched.startTime : 0;
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    forceFirstTickRef.current = true;
    timeRef.current = target;
    setCurrentTime(target);
    setIsPlaying(true);
  };

  const handleStepSlide = (delta: number) => {
    const nextIdx = Math.max(0, Math.min(slides.length - 1, activeSlideIndex + delta));
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[nextIdx];
    if (sched && onActiveSlideChange) {
      soundEngine.getContext();
      soundEngine.stopAllSfxAndVoice();
      hasUserScrubbedRef.current = true;
      isExternallySelectedSlideRef.current = false;
      isScrubSlideSyncRef.current = true;
      forceFirstTickRef.current = true;
      onActiveSlideChange(nextIdx);
      timeRef.current = sched.startTime;
      setCurrentTime(sched.startTime);
      setIsPlaying(true);
    }
  };

  const handleScrub = (val: number) => {
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    soundEngine.stopAllSfxAndVoice();
    setIsPlaying(false);
    syncTimeUi(val, totalDuration, true);
    const info = getSlideTimeInfo(val, slides, timing, audio, template);
    if (info && onActiveSlideChange && info.slideIndex !== activeSlideIndex) {
      isScrubSlideSyncRef.current = true;
      onActiveSlideChange(info.slideIndex);
    }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx) {
      drawPreviewFrame(ctx, val, slides, template, timing, audio);
    }
  };

  const clientToCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width / canvasW, rect.height / canvasH);
    const drawnW = canvasW * scale;
    const drawnH = canvasH * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;
    return {
      x: ((clientX - rect.left - offsetX) / Math.max(1, drawnW)) * canvasW,
      y: ((clientY - rect.top - offsetY) / Math.max(1, drawnH)) * canvasH,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragMode || !onUpdateTemplate) return;
    const pt = clientToCanvasPoint(e.clientX, e.clientY);
    if (!pt) return;

    const priority: DragTargetId[] = ['brand', 'timer', 'badge', 'question', 'options'];
    let matched: DragTargetId | null = null;
    for (const id of priority) {
      const hb = hitboxesRef.current.find((h) => h.id === id);
      if (!hb) continue;
      const pad = 16;
      if (
        pt.x >= hb.x - pad &&
        pt.x <= hb.x + hb.w + pad &&
        pt.y >= hb.y - pad &&
        pt.y <= hb.y + hb.h + pad
      ) {
        matched = id;
        break;
      }
    }

    if (!matched) {
      setActiveDragTarget(null);
      return;
    }

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPlaying(false);
    hasUserScrubbedRef.current = true;
    setActiveDragTarget(matched);
    dragSessionRef.current = {
      target: matched,
      startCanvasX: pt.x,
      startCanvasY: pt.y,
      startTemplate: { ...templateRef.current },
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const session = dragSessionRef.current;
    if (!dragMode || !session || !onUpdateTemplate) return;
    const pt = clientToCanvasPoint(e.clientX, e.clientY);
    if (!pt) return;

    const gScale = Math.max(0.75, Math.min(1.25, session.startTemplate.globalScale ?? 1));
    const scaleFactor = session.target === 'brand' ? 1 : gScale;
    const dxPct = (((pt.x - session.startCanvasX) / scaleFactor) / canvasW) * 100;
    const dyPct = (((pt.y - session.startCanvasY) / scaleFactor) / canvasH) * 100;
    const clampPct = (v: number, min = 3, max = 97) =>
      Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;

    const base = session.startTemplate;
    let next: TemplateSettings | null = null;

    if (session.target === 'badge') {
      next = {
        ...base,
        badgeX: clampPct((base.badgeX ?? 50) + dxPct, 5, 95),
        badgeY: clampPct((base.badgeY ?? 15) + dyPct, 2, 92),
      };
    } else if (session.target === 'question') {
      next = {
        ...base,
        questionX: clampPct((base.questionX ?? 50) + dxPct, 5, 95),
        questionY: clampPct((base.questionY ?? 28) + dyPct, 5, 95),
      };
    } else if (session.target === 'options') {
      next = {
        ...base,
        optionsX: clampPct((base.optionsX ?? 50) + dxPct, 5, 95),
        optionsStartY: clampPct((base.optionsStartY ?? 48) + dyPct, 8, 92),
      };
    } else if (session.target === 'timer') {
      next = {
        ...base,
        timerPlacement: 'free',
        timerX: clampPct((base.timerX ?? 50) + dxPct, 4, 96),
        timerY: clampPct((base.timerY ?? 41) + dyPct, 4, 96),
      };
    } else if (session.target === 'brand') {
      next = {
        ...base,
        brandLogoPosition: 'custom',
        brandLogoX: clampPct((base.brandLogoX ?? 8) + dxPct, 3, 97),
        brandLogoY: clampPct((base.brandLogoY ?? 6) + dyPct, 3, 97),
      };
    }

    if (next) {
      onUpdateTemplate(next);
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragSessionRef.current) {
      dragSessionRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        soundEngine.stopBgMusic();
        soundEngine.stopAllSfxAndVoice();
      } else if (isPlayingRef.current) {
        void soundEngine.startBgMusic(audioRef.current.bgMusic);
      }
      return next;
    });
  };

  const jumpToPhase = (
    phase: 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end'
  ) => {
    hasUserScrubbedRef.current = true;
    isExternallySelectedSlideRef.current = false;
    soundEngine.stopAllSfxAndVoice();
    setIsPlaying(false);
    const schedules = computeProjectTimeline(slides, timing, audio, template);
    const sched = schedules[activeSlideIndex] ?? schedules[0];
    if (!sched) return;
    const isTF = slides[activeSlideIndex]?.slideType === 'trueFalse';

    let target = sched.startTime + sched.tQuestionStart + 0.36;
    if (phase === 'intro') {
      target = Math.min(0.45, totalDuration);
    } else if (phase === 'opt1') {
      target = sched.startTime + sched.tOptionStarts[0] + 0.36;
    } else if (phase === 'opt4') {
      target = sched.startTime + sched.tOptionStarts[isTF ? 1 : 3] + 0.36;
    } else if (phase === 'timer') {
      target = sched.startTime + sched.tThinkingStart + Math.min(1.1, timing.thinkingDuration * 0.25);
    } else if (phase === 'suspense') {
      target = sched.startTime + sched.tSuspenseStart + Math.min(0.4, (timing.suspenseDuration ?? 1.6) * 0.3);
    } else if (phase === 'reveal') {
      target = sched.startTime + sched.tRevealStart + 0.5;
    } else if (phase === 'end') {
      const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
      target = Math.min(totalDuration, contentEnd + 0.8);
    }

    const clamped = Math.min(totalDuration, target);
    syncTimeUi(clamped, totalDuration, true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (ctx) {
      drawPreviewFrame(ctx, clamped, slides, template, timing, audio);
    }
  };

  const handleCaptureThumbnail = async () => {
    if (isCapturingThumb) return;
    setIsCapturingThumb(true);
    try {
      const blob = await exportThumbnailJpg(
        slides,
        template,
        timing,
        audio,
        timeRef.current
      );
      if (!blob) return;
      const fileName = `quiz-thumbnail-${Date.now()}.jpg`;
      await saveOrDownloadBlob(blob, fileName, 'image/jpeg');
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const activePhaseId: 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end' | null = (() => {
    const introDur = getIntroHookDuration(template, timing);
    if (introDur > 0 && currentTime < introDur) return 'intro';
    const contentEnd = getSlidesContentDuration(slides, timing, audio, template);
    if (template.showEndCard && currentTime >= contentEnd) return 'end';
    const info = getSlideTimeInfo(currentTime, slides, timing, audio, template);
    if (!info) return null;
    const { localTime, schedule } = info;
    if (localTime < schedule.tOptionStarts[0]) return 'question';
    if (localTime < (schedule.tOptionStarts[1] ?? schedule.tThinkingStart)) return 'opt1';
    if (localTime < schedule.tThinkingStart) return 'opt4';
    if (localTime < schedule.tTimerExitStart) return 'timer';
    if (localTime < schedule.tRevealStart) return 'suspense';
    return 'reveal';
  })();

  const currentPhaseLabel = (() => {
    if (activePhaseId === 'intro') return 'المقدمة';
    if (activePhaseId === 'end') return 'النهاية';
    if (activePhaseId === 'question') return 'السؤال';
    if (activePhaseId === 'opt1' || activePhaseId === 'opt4') return 'ظهور الخيارات';
    if (activePhaseId === 'timer') return 'العد التنازلي ⏱️';
    if (activePhaseId === 'suspense') return 'التشويق 🔥';
    if (activePhaseId === 'reveal') return 'كشف الجواب ✓';
    return '';
  })();

  const isActiveTF = slides[activeSlideIndex]?.slideType === 'trueFalse';
  const phases: {
    id: 'intro' | 'question' | 'opt1' | 'opt4' | 'timer' | 'suspense' | 'reveal' | 'end';
    label: string;
  }[] = [
    ...(template.showIntroHook ? [{ id: 'intro' as const, label: 'المقدمة' }] : []),
    { id: 'question', label: 'السؤال' },
    { id: 'opt1', label: 'خيار 1' },
    { id: 'opt4', label: isActiveTF ? 'الخياران' : 'كل الخيارات' },
    { id: 'timer', label: 'المؤقت' },
    ...(timing.suspenseDuration > 0 ? [{ id: 'suspense' as const, label: 'التشويق' }] : []),
    { id: 'reveal', label: 'الناتج' },
    ...(template.showEndCard ? [{ id: 'end' as const, label: 'النهاية' }] : []),
  ];

  const isCollapsedMobile = mobileStageMode === 'collapsed';
  const isCompactMobile = mobileStageMode === 'compact';

  return (
    <div
      className={`flex flex-col items-center justify-between w-full ${
        isCollapsedMobile ? 'lg:h-full' : 'h-full'
      } ${isCompactMobile ? 'gap-1.5 py-1.5 px-2.5 lg:gap-3 lg:py-3 lg:px-4' : 'gap-2.5 py-2.5 px-3 lg:gap-3 lg:py-3 lg:px-4'}`}
    >
      {/* Mobile Collapsed Mini Bar */}
      {isCollapsedMobile && onChangeMobileStageMode && (
        <div className="flex lg:hidden items-center justify-between gap-2 w-full px-2.5 py-1.5 rounded-xl bg-[var(--panel)] border border-[var(--pline)]">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#00B050] text-white text-[11px] font-bold shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{isPlaying ? 'إيقاف' : 'تشغيل'}</span>
            </button>
            <span className="text-[11px] font-bold text-[var(--ptxt)] truncate">
              {currentPhaseLabel || 'معاينة الفيديو'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChangeMobileStageMode('compact')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[11px] font-bold text-[#00B050] dark:text-[#6ee7b7] shrink-0 cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            <span>إظهار الشاشة</span>
          </button>
        </div>
      )}

      {/* Stage Quick Jump Bar */}
      {!hideControlsOverlay && (
        <div
          className={`${
            isCollapsedMobile ? 'hidden lg:flex' : 'flex'
          } items-center lg:flex-wrap lg:justify-center gap-1.5 w-full max-w-2xl overflow-x-auto no-scrollbar`}
        >
          <span className="text-[11px] lg:text-xs text-[var(--pmuted)] ml-1 whitespace-nowrap shrink-0">
            معاينة:
          </span>
          {phases.map((p) => {
            const isActivePhase = activePhaseId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => jumpToPhase(p.id)}
                className={`px-2 py-0.5 lg:px-2.5 lg:py-1 text-[11px] lg:text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActivePhase
                    ? 'bg-[#00B050] text-white border-[#00B050]'
                    : 'bg-[var(--panel)] hover:border-[var(--gold)] text-[var(--ptxt)] border-[var(--pline)]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Stage Frame: Adaptive 9:16 Vertical Shorts OR 16:9 Landscape Long Video */}
      <div
        className={`${
          isCollapsedMobile ? 'hidden lg:flex' : 'flex'
        } relative flex-1 items-center justify-center min-h-0 w-full`}
      >
        <div
          className={`relative rounded-2xl overflow-hidden bg-black border-2 transition-all duration-200 shadow-2xl shadow-black/70 ${
            dragMode ? 'border-[#00B050]' : 'border-[var(--pline)]'
          } ${
            isWide
              ? 'w-full max-w-[780px] max-h-full aspect-video'
              : 'h-full max-h-[650px] aspect-[9/16]'
          }`}
        >
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            onClick={() => {
              if (!dragMode) handleTogglePlay();
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
            className={`w-full h-full object-contain block touch-none ${
              dragMode ? 'cursor-move' : 'cursor-pointer'
            }`}
          />

          {dragMode && !hideControlsOverlay && (
            <div className="pointer-events-none absolute bottom-2.5 inset-x-2 flex justify-center">
              <span className="px-3 py-1 rounded-full bg-[#00B050]/92 text-white text-[11px] font-bold shadow-lg">
                اسحب السؤال أو الخيارات أو المؤقت أو الشارة أو الشعار مباشرة
              </span>
            </div>
          )}

          {/* Floating Channel-Style Top Quick Action Strip */}
          <div
            className={`absolute top-2.5 inset-x-2 flex items-center justify-center gap-1.5 transition-opacity duration-200 ${
              hideControlsOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={() => handleStepSlide(-1)}
              disabled={activeSlideIndex <= 0}
              title="السؤال السابق"
              className="w-8 h-8 rounded-full bg-black/65 hover:bg-black/85 disabled:opacity-35 text-white flex items-center justify-center border border-white/15 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleTogglePlay}
              title={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
              className="w-8 h-8 rounded-full bg-[#00B050] hover:bg-[#00c85b] text-white flex items-center justify-center border border-white/25 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => handleStepSlide(1)}
              disabled={activeSlideIndex >= slides.length - 1}
              title="السؤال التالي"
              className="w-8 h-8 rounded-full bg-black/65 hover:bg-black/85 disabled:opacity-35 text-white flex items-center justify-center border border-white/15 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onCycleChannelTheme}
              title="تبديل ألوان القالب (رملي / كحلي / زمردي / سبورة رياضيات)"
              className="w-8 h-8 rounded-full bg-black/65 hover:bg-black/85 text-[#EDD6A2] flex items-center justify-center border border-white/15 cursor-pointer"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
              className={`w-8 h-8 rounded-full flex items-center justify-center border cursor-pointer ${
                isMuted
                  ? 'bg-rose-600/80 text-white border-rose-400'
                  : 'bg-black/65 hover:bg-black/85 text-white border-white/15'
              }`}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setHideControlsOverlay((v) => !v)}
            title={hideControlsOverlay ? 'إظهار أزرار المعاينة' : 'إخفاء أزرار المعاينة'}
            className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-black/40 hover:bg-black/75 text-white/75 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            {hideControlsOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Bottom Scrubber & Controls */}
      <div
        className={`${
          isCollapsedMobile ? 'hidden lg:flex' : 'flex'
        } w-full max-w-lg bg-[var(--panel)] border border-[var(--pline)] rounded-xl ${
          isCompactMobile ? 'p-2 lg:p-3 gap-1.5 lg:gap-2.5' : 'p-3 gap-2.5'
        } flex-col`}
      >
        <div className="flex items-center gap-2 lg:gap-3">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-[#00B050] text-white shrink-0 cursor-pointer"
            title={isPlaying ? 'إيقاف' : 'تشغيل'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <input
            ref={rangeInputRef}
            type="range"
            min={0}
            max={Math.max(0.1, totalDuration)}
            step={0.05}
            defaultValue={currentTime}
            onChange={(e) => handleScrub(parseFloat(e.target.value))}
            aria-label="الجدول الزمني للفيديو"
            className="w-full h-1.5 rounded-lg bg-[var(--surface)] cursor-pointer"
          />
          <span
            ref={timeLabelRef}
            className="font-mono-nums text-[11px] lg:text-xs text-[var(--ptxt)] whitespace-nowrap shrink-0"
            dir="ltr"
          >
            {formatTimecode(currentTime)} / {formatTimecode(totalDuration)}
          </span>

          {/* Mobile compact bar quick controls */}
          {onChangeMobileStageMode && (
            <div className="flex lg:hidden items-center gap-1 shrink-0">
              {onUpdateTemplate && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setDragMode((v) => !v);
                    setActiveDragTarget(null);
                  }}
                  title="تحريك حر"
                  className={`p-1.5 rounded-lg border cursor-pointer ${
                    dragMode
                      ? 'bg-[#00B050] border-[#00B050] text-white'
                      : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)]'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onChangeMobileStageMode(
                    mobileStageMode === 'expanded' ? 'compact' : 'expanded'
                  )
                }
                title={mobileStageMode === 'expanded' ? 'تصغير والعودة للمحرر' : 'تكبير المعاينة'}
                className="p-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[var(--ptxt)] cursor-pointer"
              >
                {mobileStageMode === 'expanded' ? (
                  <Minimize2 className="w-3.5 h-3.5 text-[#00B050]" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              {mobileStageMode !== 'expanded' && (
                <button
                  type="button"
                  onClick={() => onChangeMobileStageMode('collapsed')}
                  title="طي الشاشة لتوسيع المحرر"
                  className="p-1.5 rounded-lg bg-[var(--surface)] border border-[var(--pline)] text-[var(--pmuted)] cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div
          className={`${
            isCompactMobile ? 'hidden lg:flex' : 'flex'
          } flex-wrap items-center justify-between gap-2`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00B050] hover:bg-[#00c85b] text-white text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isPlaying ? 'إيقاف' : 'تشغيل المعاينة'}</span>
            </button>

            <button
              type="button"
              onClick={handleRestart}
              title="تشغيل الفيديو كامل من الأول"
              className="p-2.5 rounded-lg bg-[var(--surface)] hover:border-[var(--gold)] text-[var(--ptxt)] border border-[var(--pline)] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handlePlayCurrentSlide}
              title="تشغيل السؤال الحالي من بدايته"
              className="px-2.5 py-2 rounded-lg bg-[var(--surface)] hover:border-[#00B050] text-[var(--ptxt)] border border-[var(--pline)] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              السؤال الحالي
            </button>

            {currentPhaseLabel && (
              <span className="hidden sm:inline-block px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--pline)] text-[11px] font-bold text-[#EDD6A2] whitespace-nowrap">
                {currentPhaseLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {onToggleAspectRatio && (
              <button
                type="button"
                onClick={onToggleAspectRatio}
                title="تبديل أبعاد الفيديو بين شورتس 9:16 وفيديو طويل 16:9"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isWide
                    ? 'bg-[#00B050]/18 border-[#00B050] text-[#00B050] dark:text-[#6ee7b7]'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[var(--gold)]'
                }`}
              >
                {isWide ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                <span>{isWide ? '16:9 طويل' : '9:16 شورتس'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onCycleChannelTheme}
              title="تبديل سريع لثيم القناة"
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-[var(--surface)] border border-[var(--pline)] text-[var(--sand)] hover:border-[var(--gold)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>الثيم</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCaptureThumbnail()}
              disabled={isCapturingThumb}
              title="حفظ اللقطة الحالية كصورة غلاف JPG بدقة عالية"
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-[var(--surface)] border border-[var(--pline)] text-[var(--ptxt)] hover:border-[#00B050] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-[#00B050]" />
              <span>{isCapturingThumb ? 'جارٍ الحفظ...' : 'غلاف JPG'}</span>
            </button>

            {onUpdateTemplate && (
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setDragMode((v) => !v);
                  setActiveDragTarget(null);
                }}
                title="سحب وتحريك أي عنصر بالماوس مباشرة على الشاشة"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dragMode
                    ? 'bg-[#00B050] border-[#00B050] text-white'
                    : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--ptxt)] hover:border-[#00B050]'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>تحريك حر</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSafeGuides}
              title="إظهار حدود أزرار يوتيوب"
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                template.showSafeGuides
                  ? 'bg-[#d4a73a]/20 border-[#d4a73a] text-[#EDD6A2]'
                  : 'bg-[var(--surface)] border-[var(--pline)] text-[var(--pmuted)] hover:text-[var(--ptxt)]'
              }`}
            >
              <Scan className="w-3.5 h-3.5" />
              <span>حدود الأمان</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
