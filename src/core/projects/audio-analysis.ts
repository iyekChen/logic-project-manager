export type AudioAnalysis = {
  duration: number; // 秒
  rms: number; // 0..1，整体响度
  peak: number; // 0..1，峰值绝对值，用于算波峰因数
  centroid: number; // 0..1，频谱亮度；-1 表示无有效帧
  flux: number; // 0..1，spectral flux（活动量）；-1 表示 n/a
};

// 分析超时：与原来 execFile 的 30 秒一致，卡住的文件不拖住整个列表。
const ANALYZE_TIMEOUT_MS = 30_000;

/**
 * 调用 Swift 的 analyzeAudio，返回音频的时长、RMS 与峰值。
 * 返回字段与 swift/audio-player/Sources/AudioPlayer.swift 的 AudioAnalysis 配对，修改字段要两边同步。
 */
export async function analyzeAudio(audioPath: string): Promise<AudioAnalysis> {
  const { analyzeAudio: analyzeAudioInSwift } = await import("swift:../../../swift/audio-player");

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(new Error("Audio analysis timed out.")), ANALYZE_TIMEOUT_MS);
  });

  try {
    const parsed = (await Promise.race([analyzeAudioInSwift(audioPath), timeout])) as Partial<AudioAnalysis> | null;
    if (
      !parsed ||
      typeof parsed.duration !== "number" ||
      typeof parsed.rms !== "number" ||
      typeof parsed.peak !== "number" ||
      typeof parsed.centroid !== "number" ||
      typeof parsed.flux !== "number"
    ) {
      throw new Error(`Unexpected analyze output: ${JSON.stringify(parsed)}`);
    }
    return {
      duration: parsed.duration,
      rms: parsed.rms,
      peak: parsed.peak,
      centroid: parsed.centroid,
      flux: parsed.flux,
    };
  } finally {
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
    }
  }
}
