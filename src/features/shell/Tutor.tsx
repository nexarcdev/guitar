// The tutor strip: one sentence about what is happening right now, and at most one action.
// Always there, never a modal. Every line comes from the live state of the current view.

import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { linkProps } from '../../state/router';
import type { Route } from '../../state/routes';
import { openStrings } from '../../theory/music';
import { Button, Lamp } from '../../ui';
import { useLessonTutor } from '../learn/tutor';
import s from './Tutor.module.css';

export interface TutorLine {
  line: string;
  action?: { label: string; route: Route } | { label: string; run: () => void };
}

function useTunerTutor(): TutorLine {
  const { listening, tuned, tString, offsets } = useStore(useShallow((x) => ({ listening: x.listening, tuned: x.tuned, tString: x.tString, offsets: x.setup.offsets })));
  if (!listening) return { line: 'Listening is paused. Turn it back on to tune.', action: { label: 'Listen', run: () => actions.setListening(true) } };
  if (tuned.length >= 6) return { line: 'All six strings are in tune. Try some chords.', action: { label: 'Open chords', route: { kind: 'page', page: 'chords' } } };
  const o = openStrings(offsets)[tString];
  return {
    line: `${tuned.length} of 6 in tune. Pluck the ${o.note}${o.oct} string and bring the needle to the centre.`,
    action: { label: 'Play it', run: () => actions.pluckString(tString) },
  };
}

function useChordsTutor(): TutorLine {
  const heard = useStore((x) => x.heard);
  const lesson: TutorLine['action'] = { label: 'Open lesson', route: { kind: 'learn', module: 'lesson' } };
  if (!heard || heard.quiet || heard.name.root == null) return { line: 'Strum any chord and its name lands on the glass.', action: lesson };
  return { line: `That was ${heard.name.name}. Switch to Confirm and the board checks every string as you play it.`, action: lesson };
}

function useTabsTutor(): TutorLine {
  const n = useStore((x) => x.buf.length);
  if (!n) return { line: 'Play a phrase and it lands on the paper as tab.' };
  return { line: `${n} ${n === 1 ? 'note' : 'notes'} in the last 60 s. Save a span to keep it as a riff.` };
}

function usePedalsTutor(): TutorLine {
  const { output, pedals, peak } = useStore(useShallow((x) => ({ output: x.output, pedals: x.pedals, peak: x.levels.peakDb })));
  if (!output) return { line: 'Output is off. Turn it on to hear the board (headphones stop feedback).', action: { label: 'Turn on output', run: () => actions.setOutput(true) } };
  if (peak > -3) return { line: 'Your input is close to clipping. Lower the gain on your interface.', action: { label: 'Open input', route: { kind: 'studio', tab: 'input' } } };
  const on = pedals.filter((p) => p.on).length;
  return { line: `${on} of ${pedals.length} pedals on. Tap a footswitch to bypass one.` };
}

const lost = (): TutorLine => ({ line: 'Nothing lives at that address. The tuner is a good place to start.', action: { label: 'Open tuner', route: { kind: 'page', page: 'tuner' } } });

const sheet = (): TutorLine => ({ line: 'The component reference: every base in src/ui, in every state.' });

const HOOKS = { tuner: useTunerTutor, chords: useChordsTutor, tabs: useTabsTutor, pedals: usePedalsTutor, learn: useLessonTutor, notfound: lost, design: sheet } as const;

/** Key this on the view so each view's hook mounts fresh. */
export function Tutor() {
  const which = useStore((x) => (x.route.kind === 'notfound' || x.route.kind === 'design' ? x.route.kind : x.tab));
  return <TutorStrip {...HOOKS[which]()} />;
}

export function TutorStrip({ line, action }: TutorLine) {
  return (
    <footer className={s.strip} aria-label="Tutor">
      <Lamp tone="ok" size={8} />
      <span className={s.name}>Tutor</span>
      <span className={s.line} role="status" aria-live="polite">
        {line}
      </span>
      {action &&
        ('route' in action ? (
          <Button variant="tutor" className={s.action} {...linkProps(action.route)}>
            {action.label}
          </Button>
        ) : (
          <Button variant="tutor" className={s.action} onClick={action.run}>
            {action.label}
          </Button>
        ))}
    </footer>
  );
}
