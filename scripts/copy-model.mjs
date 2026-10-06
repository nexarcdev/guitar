// Copies the basic-pitch model out of node_modules so Vite serves it at /model/.
import { cpSync, mkdirSync } from 'node:fs';
const src = new URL('../node_modules/@spotify/basic-pitch/model/', import.meta.url);
const dst = new URL('../public/model/', import.meta.url);
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('basic-pitch model copied to public/model');
