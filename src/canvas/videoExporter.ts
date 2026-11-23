import { soundEngine } from '../audio/soundEngine';
import {
  AudioSettings,
  QuestionSlide,
  TemplateSettings,
  TimingSettings,
  computeProjectTimeline,
  getCanvasDimensions,
  getIntroHookDuration,
  getTotalDuration,
} from '../types/quiz';
import {
  TimelineSoundEvent,
  clearRendererCaches,
  ensureQuizFontsLoaded,
  preloadTemplateBackground,
  preloadTimerVideo,
  renderQuizFrame,
} from './quizRenderer';

export interface ExportProgress {
  progress: number;
  currentTime: number;
  totalDuration: number;
  statusText: string;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

interface ScheduledTimelineAudio {
  time: number;
  maxDuration?: number;
  event: TimelineSoundEvent;
}

function getPreferredMimeTypes(): { mimeType: string; extension: 'mp4' | 'webm' }[] {
  const candidates: { mimeType: string; extension: 'mp4' | 'webm' }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  const supported =
    typeof MediaRecorder !== 'undefined'
      ? candidates.filter((c) => MediaRecorder.isTypeSupported(c.mimeType))
      : [];

  return supported.length > 0 ? supported : [{ mimeType: '', extension: 'webm' }];
}

function buildScheduledAudioPlan(
  slides: QuestionSlide[],
  timing: TimingSettings,
  audio: AudioSettings,
  template: TemplateSettings,
  totalDuration: number
): {
  events: ScheduledTimelineAudio[];
  speechIntervals: Array<{ start: number; end: number }>;
} {
  const events: ScheduledTimelineAudio[] = [];
  const speechIntervals: Array<{ start: number; end: number }> = [];

  const schedules = computeProjectTimeline(slides, timing, audio, template);
  const introDur = getIntroHookDuration(template, timing);
  if (introDur > 0 && slides.length > 0) {
    const firstSlideStart = schedules[0]?.startTime ?? introDur;
    const introBound = Math.max(0.15, firstSlideStart - 0.02);
    events.push({
      time: 0,
      maxDuration: introBound,
      event: { type: 'introHook', slideIndex: 0 },
    });
    if (template.introHookAudio?.dataUrl && (template.introHookAudio.duration ?? 0) > 0.2) {
      speechIntervals.push({
        start: 0,
        end: Math.min(introBound, template.introHookAudio.duration),
      });
    }
  }

  const urgentThreshold = Math.max(1, Math.min(10, template?.timerUrgentThreshold ?? 3));

  for (let idx = 0; idx < schedules.length; idx++) {
    const sched = schedules[idx];
    const sIdx = sched.slideIndex;
    const slide = slides[sIdx];
    const base = sched.startTime;
    const nextSlideStart =
      idx < schedules.length - 1 ? schedules[idx + 1].startTime : totalDuration;

    const tQ = base + sched.tQuestionStart;
    const opt0Time = base + sched.tOptionStarts[0];
    const tThink = base + sched.tThinkingStart;
    const tSus = base + sched.tSuspenseStart;
    const tReveal = base + sched.tRevealStart;
    const optCount = slide?.slideType === 'trueFalse' ? 2 : 4;
    const hasAnyOptVoice = Array.from({ length: optCount }).some((_, oi) =>
      Boolean(slide?.voiceover?.options?.[oi]?.dataUrl)
    );

    const qBound = hasAnyOptVoice
      ? Math.max(0.15, opt0Time - tQ - 0.02)
      : Math.max(0.15, tThink - tQ - 0.03);
    events.push({
      time: tQ,
      maxDuration: slide?.voiceover?.question?.dataUrl
        ? Math.min(nextSlideStart - tQ - 0.02, qBound)
        : Math.max(0.15, opt0Time - tQ - 0.02),
      event: { type: 'questionEnter', slideIndex: sIdx },
    });
    if (slide?.voiceover?.question?.dataUrl && slide.voiceover.question.duration > 0.2) {
      speechIntervals.push({
        start: tQ,
        end: tQ + Math.min(slide.voiceover.question.duration, qBound),
      });
    }

    let optVoiceCursor = opt0Time;
    for (let oIdx = 0; oIdx < optCount; oIdx++) {
      const tOpt = base + sched.tOptionStarts[oIdx];
      let groupEndBoundary = tThink;
      for (let k = oIdx + 1; k < optCount; k++) {
        const cand = base + sched.tOptionStarts[k];
        if (cand > tOpt + 0.01) {
          groupEndBoundary = cand;
          break;
        }
      }
      const sameAsPrev =
        oIdx > 0 && Math.abs(sched.tOptionStarts[oIdx] - sched.tOptionStarts[oIdx - 1]) < 0.01;
      const isGroupedSameStart =
        oIdx < optCount - 1 && Math.abs(sched.tOptionStarts[oIdx + 1] - tOpt) < 0.01;
      const oClip = slide?.voiceover?.options?.[oIdx];

      if (oClip?.dataUrl) {
        const scheduledStart =
          isGroupedSameStart || sameAsPrev ? Math.max(tOpt, optVoiceCursor) : tOpt;
        const maxBound = Math.max(scheduledStart + 0.15, groupEndBoundary - 0.02);
        if (scheduledStart < maxBound - 0.04) {
          const maxDur = Math.max(0.15, maxBound - scheduledStart);
          events.push({
            time: scheduledStart,
            maxDuration: maxDur,
            event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
          });
          const clipDur = oClip.duration > 0.05 ? oClip.duration : 1.0;
          if (clipDur > 0.2) {
            speechIntervals.push({
              start: scheduledStart,
              end: scheduledStart + Math.min(clipDur, maxDur),
            });
          }
          optVoiceCursor = Math.min(maxBound, scheduledStart + clipDur + 0.04);
        }
      } else if (!sameAsPrev) {
        events.push({
          time: tOpt,
          maxDuration: Math.max(0.15, groupEndBoundary - tOpt - 0.02),
          event: { type: 'optionEnter', slideIndex: sIdx, optionIndex: oIdx },
        });
      }
    }

    const totalTicks = Math.floor(timing.thinkingDuration);
    for (let sec = 0; sec < totalTicks; sec++) {
      const tickSecond = totalTicks - sec;
      const tTick = tThink + sec;
      events.push({
        time: tTick,
        maxDuration: Math.max(0.08, Math.min(0.88, tSus - tTick - 0.02)),
        event: {
          type: 'countdownTick',
          slideIndex: sIdx,
          tickSecond,
          urgent: tickSecond <= urgentThreshold,
        },
      });
    }

    const susDur = Math.max(0, timing.suspenseDuration ?? 0);
    if (susDur > 0) {
      events.push({
        time: tSus,
        maxDuration: Math.max(0.15, tReveal - tSus - 0.02),
        event: { type: 'suspense', slideIndex: sIdx },
      });
    }

    events.push({
      time: tReveal,
      maxDuration: Math.max(0.25, nextSlideStart - tReveal - 0.03),
      event: { type: 'correctReveal', slideIndex: sIdx },
    });
    if (slide?.voiceover?.answer?.dataUrl && slide.voiceover.answer.duration > 0.2) {
      speechIntervals.push({
        start: tReveal,
        end: Math.min(nextSlideStart - 0.02, tReveal + slide.voiceover.answer.duration),
      });
    }
  }

  events.sort((a, b) => a.time - b.time);
  return { events, speechIntervals };
}

export async function exportQuizVideo(
  slides: QuestionSlide[],
  template: TemplateSettings,
  timing: TimingSettings,
  audio: AudioSettings,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal
): Promise<ExportResult> {
  if (slides.length === 0) {
    throw new Error('لا توجد أسئلة صالحة للتصدير.');
  }

  const checkAborted = () => {
    if (signal.aborted) {
      throw new Error('تم إلغاء التصدير.');
    }
  };

  checkAborted();
  const { width, height } = getCanvasDimensions(template);

  onProgress({
    progress: 0,
    currentTime: 0,
    totalDuration: getTotalDuration(slides, timing, audio, template) || 1,
    statusText: 'جارٍ تجهيز الخطوط والقالب وفحص أطوال الأصوات...',
  });

  await Promise.all([
    ensureQuizFontsLoaded(template.fontFamily),
    preloadTemplateBackground(template, slides),
    preloadTimerVideo(),
  ]);
  clearRendererCaches();
  checkAborted();

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const exportAudioCtx = new AudioCtx();
  const closeExportAudio = () => {
    if (exportAudioCtx.state !== 'closed') {
      void exportAudioCtx.close().catch(() => undefined);
    }
  };

  try {
    if (exportAudioCtx.state === 'suspended') {
      await exportAudioCtx.resume();
    }
    checkAborted();

    const synced = await soundEngine.syncProjectAudioDurations(
      slides,
      audio,
      template,
      exportAudioCtx
    );
    checkAborted();

    const sSlides = synced.slides;
    const sAudio = synced.audio;
    const sTemplate = synced.template;

    const totalDuration = getTotalDuration(sSlides, timing, sAudio, sTemplate);
    if (totalDuration <= 0) {
      throw new Error('لا توجد أسئلة صالحة للتصدير.');
    }

    onProgress({
      progress: 0.03,
      currentTime: 0,
      totalDuration,
      statusText: 'جارٍ معالجة ودمج المسار الصوتي بدقة منعاً لأي تداخل...',
    });

    // Pre-render the ENTIRE soundtrack offline so audio clips can NEVER collide or drift
    let masterAudioBuffer: AudioBuffer | null = null;
    try {
      const rendered = await soundEngine.renderOfflineExportMix(
        sSlides,
        sTemplate,
        timing,
        sAudio,
        exportAudioCtx.sampleRate || 48000
      );
      masterAudioBuffer = rendered?.buffer ?? null;
    } catch {
      masterAudioBuffer = null;
    }
    checkAborted();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // Keep canvas inside active viewport behind the export modal (z-50) so Chromium/Android GPU compositor never culls frames
    canvas.style.position = 'fixed';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    canvas.style.width = `${Math.max(140, Math.round(width / 6))}px`;
    canvas.style.height = `${Math.max(140, Math.round(height / 6))}px`;
    canvas.style.opacity = '0.02';
    canvas.style.zIndex = '1';
    canvas.style.pointerEvents = 'none';
    canvas.style.visibility = 'visible';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      canvas.remove();
      throw new Error('تعذر تهيئة محرك الرسم على هذا المتصفح.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const audioDest = exportAudioCtx.createMediaStreamDestination();

    // Subtle silent oscillator keeps MediaStream audio track active across silent gaps
    const keepAliveOsc = exportAudioCtx.createOscillator();
    const keepAliveGain = exportAudioCtx.createGain();
    keepAliveGain.gain.setValueAtTime(0.00001, exportAudioCtx.currentTime);
    keepAliveOsc.connect(keepAliveGain);
    keepAliveGain.connect(audioDest);
    keepAliveOsc.start();

    let canvasStream = canvas.captureStream(0);
    let videoTrack = canvasStream.getVideoTracks()[0] as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | undefined;
    if (!videoTrack || typeof videoTrack.requestFrame !== 'function') {
      canvasStream.getTracks().forEach((t) => t.stop());
      canvasStream = canvas.captureStream(30);
      videoTrack = canvasStream.getVideoTracks()[0] as
        | (MediaStreamTrack & { requestFrame?: () => void })
        | undefined;
    }

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    const mimeCandidates = getPreferredMimeTypes();
    let chosenMime = mimeCandidates[0];
    let recorder: MediaRecorder | null = null;
    for (const candidate of mimeCandidates) {
      try {
        const opts: MediaRecorderOptions = {
          videoBitsPerSecond: 6_000_000,
          audioBitsPerSecond: 192_000,
        };
        if (candidate.mimeType) opts.mimeType = candidate.mimeType;
        recorder = new MediaRecorder(combinedStream, opts);
        chosenMime = candidate;
        break;
      } catch {
        recorder = null;
      }
    }
    if (!recorder) {
      recorder = new MediaRecorder(combinedStream);
    }
    const activeRecorder = recorder;
    const chunks: BlobPart[] = [];

    activeRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    let bgSource: AudioBufferSourceNode | null = null;
    let masterSource: AudioBufferSourceNode | null = null;

    // Keep screen awake during export on mobile/Android
    let wakeLock: { release: () => Promise<void> } | null = null;
    try {
      const wl = (navigator as unknown as {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      }).wakeLock;
      if (wl) wakeLock = await wl.request('screen');
    } catch {
      // ignore
    }

    if (signal.aborted) {
      combinedStream.getTracks().forEach((t) => t.stop());
      try {
        keepAliveOsc.stop();
        keepAliveOsc.disconnect();
        keepAliveGain.disconnect();
      } catch {
        // ignore
      }
      if (wakeLock) {
        void wakeLock.release().catch(() => undefined);
      }
      canvas.remove();
      throw new Error('تم إلغاء التصدير.');
    }

    const fallbackPlan = !masterAudioBuffer
      ? buildScheduledAudioPlan(sSlides, timing, sAudio, sTemplate, totalDuration)
      : { events: [], speechIntervals: [] };

    return await new Promise<ExportResult>((resolve, reject) => {
      let timerId = 0;
      let rafId = 0;
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.clearTimeout(timerId);
        cancelAnimationFrame(rafId);
        try {
          keepAliveOsc.stop();
          keepAliveOsc.disconnect();
          keepAliveGain.disconnect();
        } catch {
          // ignore
        }
        if (masterSource) {
          try {
            masterSource.stop();
            masterSource.disconnect();
          } catch {
            // ignore
          }
          masterSource = null;
        }
        if (bgSource) {
          try {
            bgSource.stop();
            bgSource.disconnect();
          } catch {
            // ignore
          }
          bgSource = null;
        }
        combinedStream.getTracks().forEach((t) => t.stop());
        if (wakeLock) {
          void wakeLock.release().catch(() => undefined);
          wakeLock = null;
        }
        closeExportAudio();
        canvas.remove();
      };

      const onAbort = () => {
        try {
          if (activeRecorder.state !== 'inactive') {
            activeRecorder.stop();
          }
        } catch {
          // ignore
        }
        cleanup();
        reject(new Error('تم إلغاء التصدير.'));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      activeRecorder.onerror = () => {
        signal.removeEventListener('abort', onAbort);
        cleanup();
        reject(new Error('حدث خطأ أثناء تسجيل الفيديو.'));
      };

      activeRecorder.onstop = () => {
        signal.removeEventListener('abort', onAbort);
        cleanup();
        if (signal.aborted) return;
        const finalType = activeRecorder.mimeType || chosenMime.mimeType || 'video/webm';
        const blob = new Blob(chunks, { type: finalType });
        resolve({
          blob,
          mimeType: finalType,
          extension: finalType.includes('mp4') ? 'mp4' : chosenMime.extension,
        });
      };

      let nextAudioIdx = 0;
      let audioStartTime = exportAudioCtx.currentTime;
      const scheduleFallbackAudioLookahead = (horizonTime: number) => {
        if (masterAudioBuffer) return;
        while (
          nextAudioIdx < fallbackPlan.events.length &&
          fallbackPlan.events[nextAudioIdx].time <= horizonTime
        ) {
          const item = fallbackPlan.events[nextAudioIdx];
          nextAudioIdx += 1;
          const when = Math.max(exportAudioCtx.currentTime, audioStartTime + item.time);
          const ev = item.event;
          const slide = sSlides[ev.slideIndex];
          const maxDur = item.maxDuration;

          if (ev.type === 'introHook') {
            const hookSfx = sTemplate.introHookSfx ?? 'whoosh';
            const hasHookVoice = Boolean(sTemplate.introHookAudio?.dataUrl);
            if (hookSfx && hookSfx !== 'none') {
              soundEngine.playBuiltInSfx(
                hookSfx,
                hasHookVoice ? 0.42 : 0.72,
                exportAudioCtx,
                audioDest,
                when,
                false,
                1.6,
                hasHookVoice ? Math.min(0.28, maxDur ?? 0.28) : maxDur
              );
            }
            if (sTemplate.introHookAudio?.dataUrl) {
              void soundEngine.playClip(
                sTemplate.introHookAudio,
                1,
                audioDest,
                exportAudioCtx,
                when,
                'voice',
                maxDur
              );
            }
          } else if (ev.type === 'questionEnter') {
            if (slide?.voiceover?.question?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.question,
                1,
                audioDest,
                exportAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(
                sAudio.questionEnter,
                audioDest,
                exportAudioCtx,
                when,
                false,
                maxDur
              );
            }
          } else if (ev.type === 'optionEnter') {
            const optIdx = ev.optionIndex ?? 0;
            const optClip = slide?.voiceover?.options?.[optIdx];
            if (optClip?.dataUrl) {
              void soundEngine.playClip(optClip, 1, audioDest, exportAudioCtx, when, 'voice', maxDur);
            } else {
              void soundEngine.playSlot(sAudio.optionEnter, audioDest, exportAudioCtx, when, false, maxDur);
            }
          } else if (ev.type === 'countdownTick') {
            void soundEngine.playSlot(
              sAudio.countdownTick,
              audioDest,
              exportAudioCtx,
              when,
              !!ev.urgent,
              maxDur
            );
          } else if (ev.type === 'suspense') {
            void soundEngine.playSlot(
              sAudio.suspense,
              audioDest,
              exportAudioCtx,
              when,
              false,
              maxDur,
              timing.suspenseDuration
            );
          } else if (ev.type === 'correctReveal') {
            if (slide?.voiceover?.answer?.dataUrl) {
              void soundEngine.playClip(
                slide.voiceover.answer,
                1,
                audioDest,
                exportAudioCtx,
                when,
                'voice',
                maxDur
              );
            } else {
              void soundEngine.playSlot(sAudio.correctReveal, audioDest, exportAudioCtx, when, false, maxDur);
            }
          }
        }
      };

      // Pre-render Frame 0 synchronously before starting MediaRecorder
      renderQuizFrame(ctx, 0, sSlides, sTemplate, timing, sAudio, false);
      videoTrack?.requestFrame?.();

      let loopStarted = false;
      let lastProgressEmitPerf = 0;

      const beginSyncLoop = () => {
        if (loopStarted || signal.aborted || cleanedUp) return;
        loopStarted = true;

        audioStartTime = exportAudioCtx.currentTime + 0.025;

        if (masterAudioBuffer) {
          const src = exportAudioCtx.createBufferSource();
          src.buffer = masterAudioBuffer;
          src.connect(audioDest);
          src.start(audioStartTime);
          masterSource = src;
        } else {
          void soundEngine.startBgMusic(sAudio.bgMusic, audioDest, exportAudioCtx).then((src) => {
            if (cleanedUp && src) {
              try {
                src.stop();
              } catch {
                // ignore
              }
              return;
            }
            bgSource = src;
            if (timing.autoDuckMusic !== false && fallbackPlan.speechIntervals.length > 0) {
              soundEngine.scheduleBgDuckIntervals(
                exportAudioCtx,
                fallbackPlan.speechIntervals,
                audioStartTime,
                timing.bgMusicDuckRatio ?? 0.22
              );
            }
          });
          scheduleFallbackAudioLookahead(0.8);
        }

        // Flush Frame 0 right when recording starts so audio & video start aligned
        renderQuizFrame(ctx, 0, sSlides, sTemplate, timing, sAudio, false);
        videoTrack?.requestFrame?.();

        let nextSlotTime = 1 / 30;
        let finishing = false;

        const stepFrame = () => {
          if (signal.aborted || cleanedUp || finishing) return;
          window.clearTimeout(timerId);
          cancelAnimationFrame(rafId);

          const audioElapsed = exportAudioCtx.currentTime - audioStartTime;
          const elapsed = Math.min(totalDuration, Math.max(0, audioElapsed));

          if (!masterAudioBuffer) {
            scheduleFallbackAudioLookahead(elapsed + 0.8);
          }

          if (elapsed >= nextSlotTime - 0.004 || elapsed >= totalDuration) {
            renderQuizFrame(ctx, elapsed, sSlides, sTemplate, timing, sAudio, false);
            videoTrack?.requestFrame?.();

            const nowPerf = performance.now();
            if (elapsed >= totalDuration || nowPerf - lastProgressEmitPerf >= 150) {
              lastProgressEmitPerf = nowPerf;
              onProgress({
                progress: 0.04 + 0.96 * (elapsed / totalDuration),
                currentTime: elapsed,
                totalDuration,
                statusText: `جارٍ تسجيل الفيديو (${Math.round((elapsed / totalDuration) * 100)}%)`,
              });
            }

            while (nextSlotTime <= elapsed + 0.004) {
              nextSlotTime += 1 / 30;
            }
          }

          if (elapsed >= totalDuration) {
            finishing = true;
            timerId = window.setTimeout(() => {
              if (activeRecorder.state !== 'inactive') {
                activeRecorder.stop();
              }
            }, 220);
            return;
          }

          const msToNext = Math.max(8, Math.min(36, (nextSlotTime - elapsed) * 1000));
          rafId = requestAnimationFrame(stepFrame);
          timerId = window.setTimeout(stepFrame, msToNext);
        };

        rafId = requestAnimationFrame(stepFrame);
        timerId = window.setTimeout(stepFrame, 33);
      };

      activeRecorder.onstart = () => {
        window.clearTimeout(timerId);
        cancelAnimationFrame(rafId);
        beginSyncLoop();
      };

      activeRecorder.start(250);
      // Fallback if browser starts synchronously or delays onstart event
      timerId = window.setTimeout(() => {
        beginSyncLoop();
      }, 65);
    });
  } catch (err) {
    closeExportAudio();
    throw err;
  }
}
