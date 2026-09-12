# osu! music

An osu!lazer music player for desktop Linux, with Electron and a React
renderer.

## Development

Install dependencies, then run:

    npm run build
    npm run dev

The player reads the osu!lazer library through OsuFilesUtility and serves
allowlisted media files through the private osu-media: protocol.

## Recovery note

This working tree was reconstructed after an accidental
git filter-repo --path tools/ofu --force. The original Electron TypeScript
sources were recovered exactly from embedded source maps in dist-electron.
The original renderer source maps were not shipped, so the production renderer
bundle and compiled CSS are retained as src/recovered-renderer.js and
src/styles.css. The small tests in tests/ validate recovered behavior and
are newly reconstructed, not the original test files.
