// Loads Fretline's core (Rust, compiled to WebAssembly by scripts/build-wasm.mjs) and wraps its
// small ABI. Usable in every realm: the main thread, workers and the AudioWorklet (which has no
// fetch, so it receives the compiled module or the bytes).

export interface CoreExports {
  memory: WebAssembly.Memory;
  in_buf(len: number): number;
  out_ptr(): number;
  // session (main thread)
  session_load(len: number): void;
  session_apply(len: number, nowMs: number): number;
  session_initial(): number;
  session_state(): number;
  session_save(): number;
  // audio side + capture (AudioWorklet)
  audio_init(sampleRate: number): void;
  audio_cmd(len: number): void;
  audio_buf(): number;
  audio_process(n: number): number;
  chunk_ptr(i: number): number;
  chunk_t0(i: number): number;
  capture_listening(on: number): void;
  capture_continue(at: number): void;
  capture_clock(): number;
  audio_meters(): number;
  // tracker side (pitch worker)
  tracker_init(sampleRate: number): void;
  tracker_cmd(len: number): void;
  tracker_buf(): number;
  tracker_push(t0: number, n: number): number;
  tracker_floor_db(): number;
  tracker_open_db(): number;
  // ML side (ML worker)
  ml_init(sampleRate: number): void;
  ml_cmd(len: number): void;
  ml_set_floor(floorDb: number, openDb: number): void;
  ml_buf(): number;
  ml_push(t0: number, n: number): void;
  ml_next_window(): number;
  ml_window_len(): number;
  ml_frames(): number;
  ml_onsets(): number;
  ml_decode(): number;
  ml_note_inference(seconds: number): number;
}

/** Samples per analysis chunk (core::sides::CHUNK). */
export const CHUNK = 1024;

// AudioWorkletGlobalScope may lack TextEncoder/TextDecoder; fall back to a small UTF-8 codec.
const enc: { encode(s: string): Uint8Array } =
  typeof TextEncoder !== 'undefined'
    ? new TextEncoder()
    : {
        encode(s: string) {
          const out: number[] = [];
          for (const ch of s) {
            const c = ch.codePointAt(0)!;
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          }
          return Uint8Array.from(out);
        },
      };
const dec: { decode(b: Uint8Array): string } =
  typeof TextDecoder !== 'undefined'
    ? new TextDecoder()
    : {
        decode(b: Uint8Array) {
          let s = '';
          for (let i = 0; i < b.length; ) {
            const x = b[i++];
            const c =
              x < 0x80 ? x
              : x < 0xe0 ? ((x & 31) << 6) | (b[i++] & 63)
              : x < 0xf0 ? ((x & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)
              : ((x & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
            s += String.fromCodePoint(c);
          }
          return s;
        },
      };

export class Core {
  readonly x: CoreExports;

  constructor(module: WebAssembly.Module | BufferSource) {
    if (!(module instanceof WebAssembly.Module)) module = new WebAssembly.Module(module);
    this.x = new WebAssembly.Instance(module, {}).exports as unknown as CoreExports;
  }

  /** Writes text for the next call; returns its byte length. */
  text(s: string): number {
    const b = enc.encode(s);
    // Take the pointer first: allocating can grow (and detach) the memory buffer.
    const ptr = this.x.in_buf(b.length);
    new Uint8Array(this.x.memory.buffer, ptr, b.length).set(b);
    return b.length;
  }

  /** Reads the text a call just produced. */
  read(len: number): string {
    if (!len) return '';
    const ptr = this.x.out_ptr();
    return dec.decode(new Uint8Array(this.x.memory.buffer, ptr, len));
  }

  /** A view of `n` floats at `ptr`. Re-take views after calls: memory can grow. */
  f32(ptr: number, n: number): Float32Array {
    return new Float32Array(this.x.memory.buffer, ptr, n);
  }
}

let compiled: Promise<WebAssembly.Module> | null = null;

/** Compiles the core once per realm from its URL. */
export function compileCore(url: string): Promise<WebAssembly.Module> {
  return (compiled ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('core ' + r.status);
      return r.arrayBuffer();
    })
    .then((b) => WebAssembly.compile(b)));
}
