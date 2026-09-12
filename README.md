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
The original renderer source maps were not shipped, so the exact original JSX
text cannot be recovered. The production bundle is retained separately as
`recovery/original-renderer.bundle.js` for reference; it is not imported by the
application. Its generated package name was `dist/assets/index-CGtVxkz-.js`,
not `recovered-renderer.js`.

The maintainable renderer has been reconstructed into the source layout
supported by the surviving build artifacts: `src/main.tsx` is the likely
renderer entry, with `App.tsx`, `VirtualTrackList.tsx`, `FacetPicker.tsx`,
`usePlayer.ts`, and the CSS files alongside it. The original entry filename
cannot be proven because no renderer source map or Git object survived. The
small tests in tests/ validate recovered behavior and are newly reconstructed,
not the original test files.
