struct Uniforms {
  viewport: vec4f, // CSS size, backing texture size
  geometry: vec4f, // count, width fraction, length, gap
  placement: vec4f, // center, radius, scale
  motion: vec4f, // rotation, center offset, bass scale, line end padding
  appearance: vec4f, // thickness, glow, opacity, highlight
  kind: vec4f, // style, line placement, signal mode, reserved
  color1: vec4f,
  color2: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> samples: array<vec2f>;

const TAU = 6.28318530718;

@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let vertices = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(vertices[index], 0, 1);
}

fn sampleAt(index: i32) -> vec2f {
  let count = i32(u.geometry.x);
  return samples[u32((index % count + count) % count)];
}

fn boxDistance(point: vec2f, halfSize: vec2f) -> f32 {
  let q = abs(point) - halfSize;
  return length(max(q, vec2f(0))) + min(max(q.x, q.y), 0);
}

fn radialBars(point: vec2f, angle: f32, radius: f32) -> f32 {
  let slot = TAU / u.geometry.x;
  let index = i32(round(angle / slot));
  var distance = 1e5;
  // Adjacent bars can cover the current angular cell when shifted inward.
  for (var neighbour = -1; neighbour <= 1; neighbour++) {
    let i = index + neighbour;
    let direction = f32(i) * slot + u.motion.x;
    let radial = vec2f(cos(direction), sin(direction));
    let tangent = vec2f(-radial.y, radial.x);
    let amplitude = sampleAt(i).x * u.geometry.z;
    let height = u.appearance.x + amplitude;
    let center = radius + (0.5 - u.motion.y) * amplitude;
    let width = max(0.5, radius * slot * u.geometry.y - u.geometry.w);
    let local = vec2f(dot(point, tangent), dot(point, radial) - center);
    distance = min(distance, boxDistance(local, vec2f(width, height) * 0.5));
  }
  return distance;
}

fn cubic(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
  // Catmull-Rom interpolation gives every ring bump a continuous slope.
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

fn ringSample(index: i32) -> f32 {
  // Blend nearby FFT bands before interpolation so narrow peaks form round,
  // connected shoulders instead of isolated needle-like bumps.
  return (sampleAt(index - 2).x + 2 * sampleAt(index - 1).x +
    3 * sampleAt(index).x + 2 * sampleAt(index + 1).x +
    sampleAt(index + 2).x) / 9;
}

fn ringDistance(point: vec2f, angle: f32, radius: f32) -> f32 {
  let coordinate = angle / TAU * u.geometry.x;
  let index = i32(floor(coordinate));
  let fraction = fract(coordinate);
  let amplitude = clamp(cubic(
    ringSample(index - 1),
    ringSample(index),
    ringSample(index + 1),
    ringSample(index + 2),
    fraction,
  ), 0, 1) * u.geometry.z;
  // Keep the center open and deform both edges of a solid annulus. At 50%
  // offset, each bump grows halfway outward and halfway inward. A small base
  // thickness makes the quiet ring visible; bar length controls wave height.
  let baseThickness = min(max(u.appearance.x * 0.35, u.geometry.z * 0.02), radius * 0.1);
  // Match the radial bars' full audio travel while joining adjacent samples
  // into one rounded contour. The cap prevents the inner edge crossing the
  // center when the response is set to 100% inward.
  let bump = min(amplitude, radius * 0.9);
  let outerRadius = radius + baseThickness * 0.5 + bump * (1 - u.motion.y);
  let innerRadius = max(baseThickness * 0.5, radius - baseThickness * 0.5 - bump * u.motion.y);
  let radialDistance = length(point);
  return max(radialDistance - outerRadius, innerRadius - radialDistance);
}

fn lineDistance(position: vec2f) -> vec3f {
  let placement = i32(u.kind.y);
  let vertical = placement == 2 || placement == 3 || placement == 5;
  let dimension = select(u.viewport.x, u.viewport.y, vertical);
  let crossDimension = select(u.viewport.y, u.viewport.x, vertical);
  let center = select(u.placement.x, u.placement.y, vertical);
  var baseline = select(u.placement.y, u.placement.x, vertical);
  // Edge placements point into the artwork; center offset can move them outward.
  let margin = max(8, crossDimension * 0.06);
  if (placement == 0 || placement == 2) { baseline = margin + baseline - crossDimension * 0.5; }
  if (placement == 1 || placement == 3) { baseline = crossDimension - margin + baseline - crossDimension * 0.5; }
  let direction = select(1.0, -1.0, placement == 1 || placement == 3 || placement == 4);
  let span = dimension * (1 - 2 * u.motion.w) * u.placement.w * u.motion.z;
  let along = select(position.x, position.y, vertical) - center + span * 0.5;
  let across = (select(position.y, position.x, vertical) - baseline) * direction;
  let slot = span / u.geometry.x;
  let coordinate = along / slot;
  let index = i32(floor(coordinate));
  let width = max(0.5, slot * u.geometry.y - u.geometry.w);
  let sampleIndex = clamp(index, 0, i32(u.geometry.x) - 1);
  let amplitude = sampleAt(sampleIndex).x * u.geometry.z * u.motion.z;
  let local = vec2f(along - (f32(index) + 0.5) * slot, across - (0.5 - u.motion.y) * amplitude);
  var distance = boxDistance(local, vec2f(width, u.appearance.x + amplitude) * 0.5);
  if (u.kind.x == 4) {
    let t = clamp(coordinate - 0.5, 0, u.geometry.x - 1);
    let first = i32(floor(t));
    let smoothBand = cubic(
      sampleAt(max(0, first - 1)).x,
      sampleAt(first).x,
      sampleAt(min(i32(u.geometry.x) - 1, first + 1)).x,
      sampleAt(min(i32(u.geometry.x) - 1, first + 2)).x,
      fract(t),
    );
    let ripple = clamp(smoothBand, 0, 1) * u.geometry.z * u.motion.z;
    let low = -ripple * u.motion.y;
    let high = ripple * (1 - u.motion.y);
    distance = max(low - across, across - high) - u.appearance.x * 0.5;
  } else if (u.kind.z == 1 || u.kind.x == 3) {
    let t = clamp(coordinate - 0.5, 0, u.geometry.x - 1);
    let first = i32(floor(t));
    let second = min(first + 1, i32(u.geometry.x) - 1);
    let wave = mix(sampleAt(first).y, sampleAt(second).y, fract(t)) * u.geometry.z * u.motion.z * 0.5;
    distance = abs(across - wave) - u.appearance.x * 0.5;
  }
  let endDistance = max(-along, along - span);
  distance = max(distance, endDistance);
  let aa = max(0.5, u.viewport.x / u.viewport.z);
  let endpointMask = 1 - smoothstep(0, aa, endDistance);
  return vec3f(distance, clamp(along / span, 0, 1), endpointMask);
}

@fragment fn fragmentMain(@builtin(position) fragment: vec4f) -> @location(0) vec4f {
  let position = fragment.xy / u.viewport.zw * u.viewport.xy;
  let point = (position - u.placement.xy) / (u.placement.w * u.motion.z);
  let angle = atan2(point.y, point.x) - u.motion.x;
  var distance: f32;
  var endpointMask = 1.0;
  // A cyclic gradient joins cleanly at the circular seam.
  var gradient = 0.5 - 0.5 * cos(angle);
  if (u.kind.x >= 2) {
    let line = lineDistance(position);
    distance = line.x;
    gradient = line.y;
    endpointMask = line.z;
  } else {
    if (u.kind.x == 0) {
      distance = radialBars(point, angle, u.placement.z);
    } else {
      distance = ringDistance(point, angle, u.placement.z);
    }
    distance *= u.placement.w * u.motion.z;
  }
  let aa = max(0.5, u.viewport.x / u.viewport.z);
  let body = 1 - smoothstep(-aa, aa, distance);
  let haloWidth = 1 + u.appearance.y * 14;
  let halo = exp(-max(0, distance) / haloWidth) * u.appearance.y * 0.35;
  let alpha = clamp(max(body, halo) * u.appearance.z * endpointMask, 0, 1);
  let color = mix(mix(u.color1.rgb, u.color2.rgb, gradient), vec3f(1), u.appearance.w);
  // The canvas is premultiplied. Empty pixels carry zero RGB and zero alpha.
  return vec4f(color * alpha, alpha);
}
