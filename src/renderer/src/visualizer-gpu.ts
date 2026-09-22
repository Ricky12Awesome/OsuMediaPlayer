import shader from "./visualizer.wgsl?raw";
import type { VisualizerFrame } from "./visualizer-analysis";
import type { VisualizerSettings } from "./visualizer-settings";

export type VisualizerColors = [
  [number, number, number],
  [number, number, number],
];

export interface VisualizerRenderer {
  resize(width: number, height: number, resolution: number): void;
  render(
    settings: VisualizerSettings,
    frame: VisualizerFrame,
    angle: number,
    colors: VisualizerColors,
    reducedMotion: boolean,
  ): void;
  dispose(): void;
}

export class WebGPUUnavailableError extends Error {}

export async function createVisualizerRenderer(
  canvas: HTMLCanvasElement,
  onFailure: (message: string) => void,
  signal?: AbortSignal,
): Promise<VisualizerRenderer> {
  if (!navigator.gpu) throw new WebGPUUnavailableError();
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "low-power",
  });
  signal?.throwIfAborted();
  if (!adapter) throw new WebGPUUnavailableError();
  const device = await adapter.requestDevice();
  if (signal?.aborted) {
    device.destroy();
    signal.throwIfAborted();
  }
  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    throw new WebGPUUnavailableError();
  }
  let disposed = false;
  let configured = false;
  let uniforms: GPUBuffer | undefined;
  let samples: GPUBuffer | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    device.removeEventListener("uncapturederror", uncapturedError);
    if (configured) context.unconfigure();
    uniforms?.destroy();
    samples?.destroy();
    device.destroy();
  };
  const uncapturedError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault();
    if (!disposed)
      onFailure(
        "The visualizer stopped after a graphics error. Toggle it off and on to retry.",
      );
  };
  device.addEventListener("uncapturederror", uncapturedError);
  void device.lost.then(() => {
    if (!disposed)
      onFailure(
        "The graphics device was lost. Toggle the visualizer off and on to retry.",
      );
  });
  try {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({
      label: "Audio visualizer WGSL",
      code: shader,
    });
    const pipeline = await device.createRenderPipelineAsync({
      label: "Transparent audio visualizer",
      layout: "auto",
      vertex: { module, entryPoint: "vertexMain" },
      fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    signal?.throwIfAborted();
    context.configure({ device, format, alphaMode: "premultiplied" });
    configured = true;
    uniforms = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    samples = device.createBuffer({
      size: 256 * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: samples } },
      ],
    });
    const data = new Float32Array(32);
    const sampleData = new Float32Array(512);
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight, resolution) {
        if (disposed) return;
        width = Math.max(1, nextWidth);
        height = Math.max(1, nextHeight);
        // Bound pixel work even on very large / high-DPI fullscreen displays.
        const ratio =
          (Math.min(window.devicePixelRatio || 1, 2) * resolution) / 100;
        const cap = Math.min(
          1,
          2560 / (width * ratio),
          1440 / (height * ratio),
          device.limits.maxTextureDimension2D /
            (Math.max(width, height) * ratio),
        );
        const pixelWidth = Math.max(1, Math.round(width * ratio * cap));
        const pixelHeight = Math.max(1, Math.round(height * ratio * cap));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      },
      render(settings, frame, angle, colors, reducedMotion) {
        if (disposed) return;
        const size = Math.min(width, height);
        const pulse = reducedMotion
          ? 0
          : Math.min(
              1,
              (frame.bass * settings.bassImpact) / 100 +
                (frame.beat * settings.beatImpact) / 100,
            );
        const scale = 1 + ((pulse * settings.boom) / 100) * 0.45;
        data.set([width, height, canvas.width, canvas.height], 0);
        data.set(
          [
            frame.count,
            settings.barWidth / 100,
            (size * settings.barLength) / 100,
            settings.gap,
          ],
          4,
        );
        data.set(
          [
            (width * settings.positionX) / 100,
            (height * settings.positionY) / 100,
            (size * settings.radius) / 100,
            settings.scale / 100,
          ],
          8,
        );
        data.set(
          [
            angle + (settings.rotation * Math.PI) / 180,
            settings.centerOffset / 100,
            scale,
            0,
          ],
          12,
        );
        data.set(
          [
            settings.lineThickness,
            settings.glow / 100,
            settings.opacity / 100,
            pulse * 0.65,
          ],
          16,
        );
        data.set(
          [
            ["circle", "ring", "line"].indexOf(settings.style),
            [
              "top",
              "bottom",
              "left",
              "right",
              "middle-horizontal",
              "middle-vertical",
            ].indexOf(settings.linePosition),
            settings.mode === "waveform" ? 1 : 0,
            0,
          ],
          20,
        );
        data.set(colors[0], 24);
        data.set(colors[1], 28);
        for (let i = 0; i < frame.count; i++) {
          sampleData[i * 2] = frame.values[i];
          sampleData[i * 2 + 1] = frame.waveform[i];
        }
        device.queue.writeBuffer(uniforms!, 0, data);
        device.queue.writeBuffer(samples!, 0, sampleData);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
