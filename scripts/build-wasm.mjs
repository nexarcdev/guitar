// Builds Fretline's core (engine/core, via engine/wasm) to WebAssembly for the web channel.
// The browser runs the very same DSP, detection and session code as the native engine.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
execFileSync('cargo', ['build', '--release', '-p', 'fretline-wasm', '--target', 'wasm32-unknown-unknown', '--manifest-path', new URL('engine/Cargo.toml', root).pathname], {
  stdio: 'inherit',
});
mkdirSync(new URL('src/core/', root), { recursive: true });
copyFileSync(new URL('engine/target/wasm32-unknown-unknown/release/fretline_wasm.wasm', root), new URL('src/core/fretline.wasm', root));
console.log('core built to src/core/fretline.wasm');
