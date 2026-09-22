/** Owns the optional analysis branch for one persistent playback element. */
export class PlayerAudioAnalysis {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private resuming = false;
  private unavailable = false;
  private disposeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly audio: HTMLAudioElement) {}

  // React's effect replay must reuse the source: an element cannot be attached
  // to a second MediaElementAudioSourceNode, even after closing its context.
  mount(): () => void {
    clearTimeout(this.disposeTimer);
    const resume = () => this.resume();
    this.audio.addEventListener("play", resume);
    document.addEventListener("pointerdown", resume, true);
    document.addEventListener("keydown", resume, true);
    return () => {
      this.audio.removeEventListener("play", resume);
      document.removeEventListener("pointerdown", resume, true);
      document.removeEventListener("keydown", resume, true);
      this.disposeTimer = setTimeout(() => {
        this.source?.disconnect();
        this.analyser?.disconnect();
        if (this.context && this.context.state !== "closed")
          void this.context.close().catch(() => {});
        this.source = null;
        this.analyser = null;
        this.context = null;
        this.unavailable = true;
      }, 0);
    };
  }

  resume(fromActivation = true): void {
    const context = this.context;
    if (
      !context ||
      context.state === "running" ||
      (this.resuming && !fromActivation)
    )
      return;
    if (context.state === "closed") return;
    this.resuming = true;
    void context
      .resume()
      .catch(() => {})
      .finally(() => {
        this.resuming = false;
      });
  }

  getAnalyser(): AnalyserNode | null {
    if (this.unavailable) return null;
    try {
      if (!this.context) {
        if (typeof AudioContext === "undefined") {
          this.unavailable = true;
          return null;
        }
        this.context = new AudioContext();
      }
      this.resume(false);
      // Routing a playing element into a suspended context would silence it.
      // Keep normal HTML audio playback until Web Audio is actually available.
      if (this.context.state !== "running") return null;
      if (!this.analyser) {
        const analyser = this.context.createAnalyser();
        analyser.smoothingTimeConstant = 0;
        const source = this.context.createMediaElementSource(this.audio);
        source.connect(this.context.destination);
        this.source = source;
        source.connect(analyser);
        this.analyser = analyser;
      }
      return this.analyser;
    } catch {
      // Analysis is optional. If its branch fails, leave any established
      // source-to-destination connection intact so playback continues.
      this.unavailable = true;
      if (!this.source && this.context) {
        void this.context.close().catch(() => {});
        this.context = null;
      }
      return null;
    }
  }
}
