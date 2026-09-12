# OsuMediaPlayer

Plays songs from osu!lazer (only)

This project is still in early stages and will have bugs 

## Current Features
- System Media Controls 
- Background art of current song (if map has one)
- Video playback (if map supports it)
- Search (collections, tags, etc)
- Shuffle
- Fullscreen mode

## Planned Features
these are features I want to add in the future

- Audio Visualizer
- Dynamic Theming based on what's currently playing
- Storyboards (might be difficult to do)

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
