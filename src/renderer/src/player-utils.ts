import type {
  LibraryQuery,
  RepeatMode,
  VideoEncodingQuality,
  VideoMaxFps,
} from "../../shared/types";

export interface PlaybackSettings {
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playVideos: boolean;
  videoEncodingQuality: VideoEncodingQuality;
  videoMaxFps: VideoMaxFps;
  videoForceRemux: boolean;
}

export interface ShuffleHistory {
  entries: number[];
  position: number;
}

export function cloneQueueQuery(input: LibraryQuery = {}): LibraryQuery {
  const { offset: _offset, limit: _limit, ...query } = input;
  return {
    ...query,
    ...(query.favoriteIds ? { favoriteIds: [...query.favoriteIds] } : {}),
    ...(query.tags ? { tags: [...query.tags] } : {}),
  };
}

export function nextQueueIndex({
  current,
  total,
  direction,
  shuffle,
  repeat,
  ended = false,
  random = Math.random,
}: {
  current: number;
  total: number;
  direction: number;
  shuffle: boolean;
  repeat: RepeatMode;
  ended?: boolean;
  random?: () => number;
}): number | null {
  if (total <= 0) return null;
  const index = Math.max(0, Math.min(Math.trunc(current), total - 1));
  if (ended && repeat === "one") return index;
  if (shuffle && total > 1) {
    const candidate = Math.min(
      total - 2,
      Math.max(0, Math.floor(random() * (total - 1))),
    );
    return candidate >= index ? candidate + 1 : candidate;
  }
  const next = index + direction;
  return next >= 0 && next < total
    ? next
    : repeat === "all"
      ? (next + total) % total
      : null;
}

export function navigateShuffleHistory({
  history,
  current,
  total,
  direction,
  repeat = "off",
  random = Math.random,
}: {
  history: ShuffleHistory;
  current: number;
  total: number;
  direction: number;
  repeat?: RepeatMode;
  random?: () => number;
}): { index: number | null; history: ShuffleHistory } {
  if (total <= 0)
    return { index: null, history: { entries: [], position: -1 } };
  const entries = history.entries.filter(
    (entry) => Number.isInteger(entry) && entry >= 0 && entry < total,
  );
  let position = Math.max(0, Math.min(history.position, entries.length - 1));
  if (entries[position] !== current) {
    const existing = entries.lastIndexOf(current);
    if (existing >= 0) position = existing;
    else {
      entries.push(current);
      position = entries.length - 1;
    }
  }
  if (direction === -1) {
    if (position === 0) return { index: null, history: { entries, position } };
    const nextPosition = position - 1;
    return {
      index: entries[nextPosition] ?? null,
      history: { entries, position: nextPosition },
    };
  }
  if (position < entries.length - 1) {
    const nextPosition = position + 1;
    return {
      index: entries[nextPosition] ?? null,
      history: { entries, position: nextPosition },
    };
  }
  const index = nextQueueIndex({
    current,
    total,
    direction: 1,
    shuffle: true,
    repeat,
    random,
  });
  return index === null
    ? { index: null, history: { entries, position } }
    : {
        index,
        history: { entries: [...entries, index], position: entries.length },
      };
}

export function randomQueueIndex({
  current,
  total,
  random = Math.random,
}: {
  current: number;
  total: number;
  random?: () => number;
}): number | null {
  if (total <= 0) return null;
  const index = Math.max(0, Math.min(Math.trunc(current), total - 1));
  if (total === 1) return index;
  return nextQueueIndex({
    current: index,
    total,
    direction: 1,
    shuffle: true,
    repeat: "off",
    random,
  });
}

export function navigateRandomHistory({
  history,
  current,
  total,
  direction,
  random = Math.random,
}: {
  history: ShuffleHistory;
  current: number;
  total: number;
  direction: 1 | -1;
  random?: () => number;
}): { index: number | null; history: ShuffleHistory } {
  if (total <= 0)
    return { index: null, history: { entries: [], position: -1 } };
  const entries = history.entries.filter(
    (entry) => Number.isInteger(entry) && entry >= 0 && entry < total,
  );
  let position = Math.max(0, Math.min(history.position, entries.length - 1));
  if (entries[position] !== current) {
    const existing = entries.lastIndexOf(current);
    if (existing >= 0) position = existing;
    else {
      entries.push(current);
      position = entries.length - 1;
    }
  }

  if (direction === -1) {
    if (position === 0) return { index: null, history: { entries, position } };
    const nextPosition = position - 1;
    return {
      index: entries[nextPosition] ?? null,
      history: { entries, position: nextPosition },
    };
  }

  const index = randomQueueIndex({ current, total, random });
  if (index === null) return { index: null, history: { entries, position } };
  const retained = entries.slice(0, position + 1);
  return {
    index,
    history: {
      entries: [...retained, index],
      position: retained.length,
    },
  };
}

export const defaultPlaybackSettings: PlaybackSettings = {
  volume: 0.75,
  muted: false,
  shuffle: false,
  repeat: "off",
  playVideos: true,
  videoEncodingQuality: "medium",
  videoMaxFps: 60,
  videoForceRemux: true,
};

export function parsePlaybackSettings(
  value: string | null | undefined,
): PlaybackSettings {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return defaultPlaybackSettings;
    const record = parsed as Record<string, unknown>;
    return {
      volume:
        typeof record.volume === "number" && Number.isFinite(record.volume)
          ? Math.max(0, Math.min(1, record.volume))
          : defaultPlaybackSettings.volume,
      muted:
        typeof record.muted === "boolean"
          ? record.muted
          : defaultPlaybackSettings.muted,
      shuffle:
        typeof record.shuffle === "boolean"
          ? record.shuffle
          : defaultPlaybackSettings.shuffle,
      repeat:
        record.repeat === "off" ||
        record.repeat === "all" ||
        record.repeat === "one"
          ? record.repeat
          : defaultPlaybackSettings.repeat,
      playVideos:
        typeof record.playVideos === "boolean"
          ? record.playVideos
          : defaultPlaybackSettings.playVideos,
      videoEncodingQuality:
        record.videoEncodingQuality === "very-low" ||
        record.videoEncodingQuality === "low" ||
        record.videoEncodingQuality === "medium" ||
        record.videoEncodingQuality === "high" ||
        record.videoEncodingQuality === "very-high"
          ? record.videoEncodingQuality
          : defaultPlaybackSettings.videoEncodingQuality,
      videoMaxFps:
        record.videoMaxFps === 0 ||
        record.videoMaxFps === 24 ||
        record.videoMaxFps === 30 ||
        record.videoMaxFps === 60
          ? record.videoMaxFps
          : defaultPlaybackSettings.videoMaxFps,
      videoForceRemux:
        typeof record.videoForceRemux === "boolean"
          ? record.videoForceRemux
          : defaultPlaybackSettings.videoForceRemux,
    };
  } catch {
    return defaultPlaybackSettings;
  }
}

export const copyQueueQuery = cloneQueueQuery;
export const getNextQueueIndex = nextQueueIndex;
export const getShuffleNavigation = navigateShuffleHistory;
export const getRandomQueueIndex = randomQueueIndex;
export const getRandomNavigation = navigateRandomHistory;
export const readPlaybackSettings = parsePlaybackSettings;
