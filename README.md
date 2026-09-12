# OsuMediaPlayer



## Development

Install dependencies, then run:

```sh
npm run build
npm run dev
```

## Project structure

The project follows the electron-vite process layout:

```text
src/
  main/       Electron main process and native services
  preload/    Context-isolated renderer bridge
  renderer/   Vite/React renderer application
    index.html
    src/      React components and renderer utilities
  shared/     Types shared across process boundaries
scripts/      Build and packaging helpers
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
