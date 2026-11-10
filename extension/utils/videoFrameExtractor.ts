import type { VideoFrame } from "./types";

const MAX_VIDEO_FRAMES = 3;
const MAX_SOURCE_DIMENSION = 1024;
const FRAME_SCALE = 0.5;
const SEEK_TIMEOUT_MS = 1_500;
const FRAME_TIMESTAMPS = [0.1, 0.5, 0.9] as const;

function captureFrame(video: HTMLVideoElement): string | null {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    return null;
  }

  const scale =
    Math.min(1, MAX_SOURCE_DIMENSION / Math.max(video.videoWidth, video.videoHeight)) *
    FRAME_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function seekTo(video: HTMLVideoElement, timestampSeconds: number): Promise<boolean> {
  if (Math.abs(video.currentTime - timestampSeconds) < 0.05 && !video.seeking) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(success);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const timeout = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });

    try {
      video.currentTime = timestampSeconds;
    } catch {
      finish(false);
    }
  });
}

async function extractPausedVideoFrames(video: HTMLVideoElement): Promise<VideoFrame[]> {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }

  const originalTime = video.currentTime;
  const frames: VideoFrame[] = [];

  try {
    for (const fraction of FRAME_TIMESTAMPS.slice(0, MAX_VIDEO_FRAMES)) {
      const timestampSeconds = Math.max(0, Math.min(duration * fraction, duration - 0.05));
      if (frames.some((frame) => Math.abs(frame.timestampSeconds - timestampSeconds) < 0.25)) {
        continue;
      }

      if (!(await seekTo(video, timestampSeconds))) {
        continue;
      }

      const dataUrl = captureFrame(video);
      if (dataUrl) {
        frames.push({ timestampSeconds, dataUrl });
      }
    }
  } finally {
    if (Math.abs(video.currentTime - originalTime) >= 0.05) {
      await seekTo(video, originalTime);
    }
  }

  return frames;
}

/**
 * Capture a few representative frames without interrupting active playback.
 */
export async function extractVideoFrames(element: HTMLElement): Promise<VideoFrame[]> {
  const video = element.querySelector<HTMLVideoElement>("video");
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return [];
  }

  try {
    if (!video.paused) {
      const dataUrl = captureFrame(video);
      return dataUrl ? [{ timestampSeconds: video.currentTime, dataUrl }] : [];
    }

    return await extractPausedVideoFrames(video);
  } catch (error) {
    console.warn("[Detectium] 동영상 프레임 추출 실패; 사용 가능한 포스터 이미지만 분석합니다.", error);
    return [];
  }
}
