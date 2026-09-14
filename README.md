# OsuMediaPlayer

Plays songs from osu!lazer (only)

This project is still in early stages and will have bugs 

## Current Features
- System Media Controls 
- Background art of current song (if map has one)
- Video playback (if map supports it)
- Dynamic Theming 
- Search (collections, tags, etc)
- Shuffle and Repeat
- Fullscreen mode
- Audio Visualzier (WIP, will probably be rewritten by hand)

## Planned Features
these are features I want to add in the future

- Custom Audio Visualizers (API)
- Storyboards (might be difficult to do)

## Library storage

The player reads `client.realm` directly using Realm in read-only mode with schema version 52.
Default osu!lazer directories are `%APPDATA%/osu` on Windows, `~/.local/share/osu` on Linux, and `~/Library/Application Support/osu` on macOS. If `storage.ini` contains `FullPath`, that directory is used for the database and media files. You can also choose a custom directory in the player.

## Development

Install dependencies, then run:

```sh
npm run build
npm run dev
```

## AI Disclosure

This project is mostly written with AI (since I suck at making UIs)

### Other notes about this project
I accidentally nuked git history when trying to remove `tools/ofu` in entire git history (since I didn't want to push binaries to git)

This is human error, should have made a backup

Luckily some stuff was left over (`release`, `dist`, `dist-electron`, basically anything that was in `.gitignore`)

which contained sourcemaps and other data where 90% can easily be recovered
other stuff has to be re-made, but AI can do that easily

So I just let the AI do its thing and try and revert it

Functionally speaking, it about the same as before, I can't really tell the difference in how the UI feels and behaves
