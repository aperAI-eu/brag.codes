import { useEffect, useRef, useState } from "react";
import type { CaptureStage } from "../../app/src/ui/share-capture";

// Only the timer is simulated. The optional cue uses local browser audio/haptics;
// no microphone, provider, upload or persistent media is involved.
export function useRecordingPreview(
  stage: CaptureStage,
  setStage: (stage: CaptureStage) => void,
  present: boolean,
  canRecord: boolean,
  finish: (reason?: "finished" | "limit") => void,
) {
  const [seconds, setSeconds] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const elapsed = useRef(0);
  const started = useRef<number | null>(null);
  const warned = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const closeAudio = () => {
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  const prepareSound = (enabled = soundEnabled) => {
    if (!enabled) return;
    try {
      audio.current ??= new AudioContext();
      if (audio.current.state === "suspended") void audio.current.resume().catch(() => {});
    } catch {
      // Unsupported or denied audio must never stop the pitch.
    }
  };
  const readElapsed = () =>
    elapsed.current + (started.current === null ? 0 : performance.now() - started.current);
  const pause = () => {
    if (stage !== "recording") return;
    setSeconds(Math.min(30, Math.floor(readElapsed() / 1000)));
    setStage("paused");
  };
  const reset = () => {
    elapsed.current = 0;
    started.current = null;
    warned.current = false;
    setSeconds(0);
    closeAudio();
  };
  useEffect(() => {
    if (stage !== "recording" || !present) return;
    started.current = performance.now();
    const timer = setInterval(
      () => setSeconds(Math.min(30, Math.floor(readElapsed() / 1000))),
      100,
    );
    return () => {
      elapsed.current = readElapsed();
      started.current = null;
      clearInterval(timer);
    };
  }, [stage, present]);
  useEffect(() => {
    if (stage === "recording" && !present) pause();
    if (stage !== "recording") return;
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [stage, present]);
  useEffect(() => {
    if (stage !== "recording" || !present) return;
    if (seconds >= 30) {
      finish("limit");
      return;
    }
    if (seconds < 25 || warned.current) return;
    warned.current = true;
    try {
      navigator.vibrate?.([100, 60, 100]);
    } catch {
      /* Best effort. */
    }
    const context = audio.current;
    if (!soundEnabled || !context || context.state !== "running") return;
    try {
      const tone = context.createOscillator(),
        gain = context.createGain();
      tone.frequency.value = 740;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.015);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.18);
      tone.connect(gain).connect(context.destination);
      tone.onended = () => {
        tone.disconnect();
        gain.disconnect();
      };
      tone.start();
      tone.stop(context.currentTime + 0.2);
    } catch {
      /* The visible warning remains available. */
    }
  }, [stage, seconds, present, soundEnabled]);
  useEffect(() => {
    if (!["voice", "recording", "paused"].includes(stage)) closeAudio();
  }, [stage]);
  useEffect(() => closeAudio, []);
  return {
    seconds,
    soundEnabled,
    onSoundChange: (enabled: boolean) => {
      setSoundEnabled(enabled);
      if (enabled) prepareSound(true);
      else closeAudio();
    },
    onRecord: () => {
      if (!present || !canRecord || stage !== "voice") return;
      reset();
      prepareSound();
      setStage("recording");
    },
    onPause: pause,
    onResume: () => {
      if (!present || !canRecord || stage !== "paused") return;
      prepareSound();
      setStage("recording");
    },
    onFinish: () => finish("finished"),
    simulateWarning: () => {
      elapsed.current = 25000;
      started.current = performance.now();
      setSeconds(25);
    },
    simulateLimit: () => {
      setSeconds(30);
      finish("limit");
    },
    reset,
  };
}
