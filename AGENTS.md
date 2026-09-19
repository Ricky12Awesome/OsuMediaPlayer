# AGENTS.md

## Project goal

OsuMediaPlayer is an Electron and React app for playing music from osu!lazer. Favor clear behavior and a codebase that can be understood quickly. Start with the fewest moving parts that solve the actual problem. Keep existing complexity only when it is required by something concrete, such as Realm ownership, IPC security, media streaming, cancellation, or large-song-list rendering.

## Project layout

- `src/main/` is the privileged Electron process. It owns filesystem access, Realm/song-list management, IPC handlers, media serving, caching, and video/FFmpeg work.
- `src/main/song-list/` contains Realm import, indexing, querying, and cache logic. The song-list worker keeps Realm work out of Electron's main event loop.
- `src/main/video/` contains probing, encoding, HLS serving, and converted-video cache logic.
- `src/preload/` is the only bridge into the renderer. Expose a narrow, typed API through `contextBridge`.
- `src/renderer/src/` contains React components, hooks, browser APIs, and feature CSS.
- `src/shared/` contains types and models shared across process boundaries.
- `tests/` contains Node unit tests and Electron, streaming, and browser integration tests.

Keep these boundaries intact. Renderer code must not import Electron, Node filesystem APIs, Realm, or FFmpeg code. Keep Realm handles in the process that opened them and transfer detached data across the worker boundary.

## Working principles

- Identify the actual requirement before adding abstractions. A direct implementation is usually better than a framework built for its own sake.
- Search for an existing type, helper, hook, cache, IPC method, or component before creating another one. Extend stable shared code when the behavior belongs there.
- Keep related code together and files focused. Extract a responsibility when a module becomes hard to navigate; avoid both giant catch-all files and one-file-per-function fragmentation.
- Follow the existing TypeScript, React, CSS, and Electron conventions. Similar features should look and behave alike.
- Keep comments for decisions and constraints. Let clear code explain routine mechanics.
- Treat caches as optional accelerators. A cache miss or cleanup failure should not prevent a valid song list load or playback.

## Electron and IPC

- Keep `contextIsolation`, `sandbox`, `nodeIntegration: false`, and web security settings intact.
- Validate IPC arguments in the main process and retain trusted sender and frame checks. Add shared request and response types in `src/shared/types.ts`.
- Centralize media path, hash, MIME, and range handling in the existing media helpers.
- Keep expensive Realm imports, full-song-list work, probing, and encoding off the renderer and Electron main event loop. Reuse the song-list worker and existing child-process helpers.
- Add cancellation and cleanup for long-running imports, encodes, streams, timers, listeners, and temporary files.

## Renderer and performance

- Preserve the existing paged and virtualized song list. Keep result sizes, concurrent requests, page caches, and overscan bounded instead of putting the whole song list in the DOM.
- Avoid duplicate IPC calls and repeated full-song-list work. Reuse query, sort, facet, artwork, and video caches where they already apply, and invalidate them when their source data changes.
- Keep React state out of high-frequency loops. Use refs and one scheduled frame for playback or visualizer work; clean up `requestAnimationFrame`, observers, media listeners, and abort controllers.
- Treat CSS compositing as a limited resource. Prefer short `transform` and `opacity` transitions. Avoid animating layout, large blurred surfaces, persistent `will-change`, heavy shadows, or always-running animations without evidence that they help. Respect reduced-motion behavior.
- Avoid reading whole media files into memory. Use the existing streaming and range-serving paths.
- Profile before changing a performance-sensitive path. Check scrolling, artwork/theme changes, playback, video startup, and visualizer rendering in Electron/Chromium DevTools when relevant.

## Code style and organization

- TypeScript is strict and uses ES modules. Keep the existing two-space indentation, semicolons, double quotes, trailing commas, and casing conventions.
- Use Prettier rather than hand-formatting: `npm run format`.
- Keep feature CSS beside its renderer feature and use the existing styling approach. A small feature should not introduce another styling system.
- Reuse the shared renderer control classes in `controls.css` for buttons, tabs, popovers, and option rows, and the shared settings classes in `settings.css` for settings and visualizer controls. Keep feature CSS focused on positioning or behavior that is genuinely unique so equivalent controls do not drift apart.
- Use scalable CSS units intentionally:
  - Use `rem` for most typography, spacing, radii, control sizes, and fixed layout constraints that should scale with the interface.
  - Keep normal text, controls, and metadata at `1rem` or larger. Use sub-`1rem` text sparingly for clearly secondary microcopy or compact badges, and verify that it remains legible.
  - Use `em` when a value should scale with a specific component's font size, and `ch` for text-line widths.
  - Reserve `px` for thin borders, shadows, icons, precise small details, and runtime coordinates measured in CSS pixels.
  - Use percentages, Flexbox, or Grid fractions for layout widths when the layout can be fluid; use `vw`/`vh` for viewport-relative sizing and prefer `dvw`/`dvh` when browser UI can affect the available viewport.
  - Avoid fixed heights for content containers. Use `min-height`, intrinsic sizing, or bounded overflow unless a fixed dimension is required by a control, media surface, or virtualization calculation.
- Prefer explicit types at process boundaries and for persisted settings. Validate untrusted or persisted data before using it.
- Do not commit generated output or local data such as `dist/`, `dist-electron/`, `release/`, `test-results/`, `node_modules/`, or cache files.

## Tests and verification

Add tests for changed behavior, especially boundary cases and cancellation or cache invalidation paths. Keep pure logic in focused `tests/*.test.ts` files and use Electron/browser tests for process or UI behavior.

Run the checks that match the change:

```sh
npm run typecheck
npm test
```

Also use these when applicable:

- `npm run build` for renderer, Electron, or packaging changes.
- `npm run test:e2e` for Electron lifecycle and end-to-end UI changes.
- `npm run test:streaming` for song-list worker, streaming, media, or cache changes.

Review the diff after formatting and keep each change narrowly scoped. Do not modify `README.md` unless the task explicitly requests it. If a change deserves README documentation, tell the developer exactly what should be added and where.
