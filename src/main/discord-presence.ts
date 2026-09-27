import { Client, type SetActivity } from "@xhayper/discord-rpc";
import type { DiscordPlaybackState, Song } from "../shared/types";

const applicationId = "1553859353101213770";
const retryDelayMs = 15_000;

export function parseDiscordPlaybackState(
  input: unknown,
): DiscordPlaybackState | null {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid Discord playback state.");
  const state = input as Record<string, unknown>;
  if (
    typeof state.songId !== "string" ||
    !state.songId ||
    state.songId.length > 256 ||
    typeof state.position !== "number" ||
    !Number.isFinite(state.position) ||
    state.position < 0 ||
    typeof state.duration !== "number" ||
    !Number.isFinite(state.duration) ||
    state.duration < 0 ||
    state.duration > 86_400
  )
    throw new Error("Invalid Discord playback state.");
  return {
    songId: state.songId,
    position: Math.min(state.position, state.duration),
    duration: state.duration,
  };
}

export function discordActivity(
  song: Song,
  state: DiscordPlaybackState,
  sampledAt: number,
  now = Date.now(),
): SetActivity {
  const title =
    (song.titleUnicode || song.title).slice(0, 128) || "Unknown title";
  const activity: SetActivity = {
    type: 2,
    details: title,
    state:
      (song.artistUnicode || song.artist).slice(0, 128) || "Unknown artist",
  };
  if (state.duration > 0) {
    const elapsed = Math.min(
      state.duration,
      state.position + Math.max(0, now - sampledAt) / 1000,
    );
    activity.startTimestamp = now - Math.round(elapsed * 1000);
    activity.endTimestamp = now + Math.round((state.duration - elapsed) * 1000);
  }
  if (
    song.onlineId &&
    Number.isSafeInteger(song.onlineId) &&
    song.onlineId > 0
  ) {
    const listingUrl = `https://osu.ppy.sh/beatmapsets/${song.onlineId}`;
    activity.largeImageKey = `https://b.ppy.sh/thumb/${song.onlineId}l.jpg`;
    activity.largeImageUrl = listingUrl;
    activity.buttons = [
      {
        label: "View beatmap",
        url: listingUrl,
      },
    ];
  }
  return activity;
}

type DesiredPresence = {
  song: Song;
  state: DiscordPlaybackState;
  sampledAt: number;
};

export class DiscordPresence {
  private client: Client | null = null;
  private desired: DesiredPresence | null = null;
  private version = 0;
  private syncedVersion = -1;
  private inFlight: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  update(song: Song | null, state: DiscordPlaybackState | null): void {
    if (this.disposed) return;
    this.desired =
      song && state ? { song, state, sampledAt: Date.now() } : null;
    this.version++;
    if (!this.desired) this.clearRetry();
    this.flush();
  }

  private flush(): void {
    if (this.disposed || this.inFlight || this.retryTimer) return;
    this.inFlight = this.sync().finally(() => {
      this.inFlight = null;
      if (this.version !== this.syncedVersion && !this.retryTimer) this.flush();
    });
  }

  private async sync(): Promise<void> {
    let appliedVersion = -1;
    while (!this.disposed && appliedVersion !== this.version) {
      const version = this.version;
      const desired = this.desired;
      if (!desired && !this.client) {
        this.syncedVersion = version;
        return;
      }
      if (!this.client) {
        const client = new Client({ clientId: applicationId });
        this.client = client;
        client.on("disconnected", () => {
          if (this.client !== client) return;
          this.client = null;
          if (this.desired && !this.disposed) this.retry();
        });
        try {
          await client.login();
        } catch {
          if (this.client === client) this.client = null;
          await client.destroy().catch(() => {});
          if (this.desired && !this.disposed) this.retry();
          return;
        }
        if (this.disposed) return;
        if (version !== this.version) continue;
      }
      const client = this.client;
      if (!client?.user) {
        if (client) {
          this.client = null;
          await client.destroy().catch(() => {});
        }
        if (this.desired) this.retry();
        else this.syncedVersion = version;
        return;
      }
      try {
        if (desired)
          await client.user.setActivity(
            discordActivity(desired.song, desired.state, desired.sampledAt),
          );
        else await client.user.clearActivity();
      } catch {
        if (this.client === client) this.client = null;
        await client.destroy().catch(() => {});
        if (this.desired && !this.disposed) this.retry();
        return;
      }
      appliedVersion = version;
      this.syncedVersion = version;
    }
  }

  private retry(): void {
    if (this.retryTimer || !this.desired || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flush();
    }, retryDelayMs);
    this.retryTimer.unref();
  }

  private clearRetry(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.desired = null;
    this.clearRetry();
    await this.inFlight;
    const client = this.client;
    this.client = null;
    if (!client) return;
    if (client.user) await client.user.clearActivity().catch(() => {});
    await client.destroy().catch(() => {});
  }
}
