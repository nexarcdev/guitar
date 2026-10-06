// tfjs 3 checks `!window` (not `typeof window`) on some paths, which throws inside a worker.
// Must be imported before @tensorflow/tfjs so it runs first.
const g = self as unknown as { window?: unknown };
if (typeof g.window === 'undefined') g.window = self;
export {};
