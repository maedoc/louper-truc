# louper-truc

A browser-based SPA for musicians transcribing music.

## Features

- Drag & drop any audio file (use your browser's decoder; works with OGG, MP3, WAV, FLAC — whatever the browser supports)
- Canvas waveform visualization with zoom and pan
- **Set a cue point**: click anywhere on the waveform to set a restart point
- **Loop a region**: click/drag on the waveform to select a start→end region; playback loops within it
- **Zoom**: mouse scroll wheel over the waveform (or use the zoom slider)
- **Pan**: drag with middle mouse or Alt+drag (or just when zoomed in)
- **Playback speed**: slow it down without changing pitch using the speed slider
- **Keyboard shortcuts**: `Space` = play/pause, `L` = toggle loop, `←/→` = seek 1s (`Shift` for 5s)

## Demo

By default the app ships with a public-domain 1923 jazz recording: **King Oliver's Creole Jazz Band — "Krooked Blues"** (feat. Louis Armstrong). Click "Load demo" on first open.

## GitHub Pages

The app is automatically built and deployed to GitHub Pages on every push to `main`.

## License

MIT for the code. The demo audio is public domain in the United States (pre-1925 sound recording).
