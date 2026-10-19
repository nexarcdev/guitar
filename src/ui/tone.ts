// The three accents and what they mean. Every component that lights up picks from these.
export type Tone = 'live' | 'on' | 'ok';
export type Surface = 'dark' | 'ivory';

export const TONE: Record<Tone, string> = {
  live: '#d4442c',
  on: '#e9a23b',
  ok: '#4db6a4',
};

/** Accents as they print on an ivory face (the bright ones wash out there). */
export const TONE_IVORY: Record<Tone, string> = {
  live: '#c8431f',
  on: '#d9902a',
  ok: '#1f8c7c',
};

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');
