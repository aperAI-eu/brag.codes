import jsQR from "jsqr";

/** Local-only camera frames. Abort also disposes a late permission result. */
export async function scanCamera(
  video: HTMLVideoElement,
  signal: AbortSignal,
  onReady: () => void,
  onDecode: (text: string) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const canvas = document.createElement("canvas");
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      if (video.srcObject === stream) video.srcObject = null;
    }
    canvas.width = canvas.height = 0;
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) return stop();
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new DOMException("Camera unavailable", "NotSupportedError");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    if (stopped || signal.aborted) return stop();
    for (const track of stream.getTracks())
      track.onended = () => {
        stop();
        onError(new DOMException("Camera stopped", "NotReadableError"));
      };
    video.srcObject = stream;
    await video.play();
    if (stopped || signal.aborted) return stop();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Camera canvas unavailable");
    onReady();
    const read = () => {
      if (stopped || signal.aborted) return;
      try {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(frame.data, frame.width, frame.height, {
            inversionAttempts: "attemptBoth",
          });
          if (result) {
            stop();
            onDecode(result.data);
            return;
          }
        }
        timer = setTimeout(read, 200);
      } catch (error) {
        stop();
        onError(error);
      }
    };
    read();
  } catch (error) {
    stop();
    if (!signal.aborted) onError(error);
  }
}
