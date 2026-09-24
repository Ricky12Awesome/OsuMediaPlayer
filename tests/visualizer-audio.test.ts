import assert from "node:assert/strict";
import test from "node:test";
import { PlayerAudioAnalysis } from "../src/renderer/src/visualizer-audio";

test("audio routing waits for activation, creates one source, and survives effect replay", async () => {
  const previousContext = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioContext",
  );
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  let activeContext: FakeContext | undefined;
  class FakeContext {
    state = "suspended";
    destination = {};
    sources = 0;
    closes = 0;
    resumes = 0;
    allowResume: (() => void) | undefined;
    connections: unknown[] = [];
    analyser = { smoothingTimeConstant: 0.8, disconnect() {} };
    constructor() {
      activeContext = this;
    }
    async resume() {
      this.resumes++;
      // A browser can leave the first resume pending until a fresh gesture.
      if (this.resumes === 1)
        await new Promise<void>((resolve) => {
          this.allowResume = resolve;
        });
      else this.allowResume?.();
    }
    async close() {
      this.closes++;
      this.state = "closed";
    }
    createAnalyser() {
      return this.analyser;
    }
    createMediaElementSource() {
      this.sources++;
      return {
        connect: (node: unknown) => this.connections.push(node),
        disconnect() {},
      };
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeContext,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: new EventTarget(),
  });
  try {
    const audio = new EventTarget() as HTMLAudioElement;
    const analysis = new PlayerAudioAnalysis(audio);
    const unmount = analysis.mount();
    assert.equal(analysis.getAnalyser(), null);
    const context = activeContext!;
    assert.equal(analysis.getAnalyser(), null);
    assert.equal(
      context.resumes,
      1,
      "frames do not accumulate pending resumes",
    );
    assert.equal(
      context.sources,
      0,
      "suspended Web Audio must not capture playback",
    );
    context.state = "running";
    assert.equal(analysis.getAnalyser(), context.analyser);
    assert.equal(analysis.getAnalyser(), context.analyser);
    assert.equal(context.sources, 1);
    assert.deepEqual(context.connections, [
      context.destination,
      context.analyser,
    ]);
    assert.equal(context.analyser.smoothingTimeConstant, 0);
    unmount();
    const finish = analysis.mount();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.closes, 0);
    assert.equal(analysis.getAnalyser(), context.analyser);
    assert.equal(context.sources, 1);
    context.state = "suspended";
    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    assert.ok(context.resumes >= 2);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.closes, 1);
    assert.equal(analysis.getAnalyser(), null);
    const resumes = context.resumes;
    document.dispatchEvent(new Event("pointerdown"));
    audio.dispatchEvent(new Event("play"));
    assert.equal(
      context.resumes,
      resumes,
      "unmount removes activation listeners",
    );
  } finally {
    if (previousContext)
      Object.defineProperty(globalThis, "AudioContext", previousContext);
    else Reflect.deleteProperty(globalThis, "AudioContext");
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
