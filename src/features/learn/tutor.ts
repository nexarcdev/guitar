import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../state/store';
import type { TutorLine } from '../shell/Tutor';
import { CHANGE_TIPS, LESSON, setBpm, start, statsOf } from './lesson';
import { useLearn } from './state';

/** The tutor line while Learn is showing: from the lesson's live run, or a plain note for previews. */
export function useLessonTutor(): TutorLine {
  const module = useStore((x) => x.learnModule);
  const { playing, bar, results, bpm } = useLearn(useShallow((x) => ({ playing: x.playing, bar: x.bar, results: x.results, bpm: x.bpm })));
  if (module !== 'lesson') return { line: 'This module is a preview with sample data. It is not listening to your playing yet.' };

  const n = LESSON.chords.length;
  const first = LESSON.chords[0].name;
  const upTo = playing ? Math.max(0, bar) : results.length ? Math.max(...results.map((r) => r.bar)) + 1 : 0;
  const st = statsOf(results, upTo, bpm);
  if (st.lateChange) {
    const [a, b] = st.lateChange.split('>');
    return { line: `Your ${a} to ${b} change lands late. ${CHANGE_TIPS[st.lateChange]}`, action: playing ? undefined : { label: 'Slower', run: () => setBpm(bpm - 8) } };
  }
  if (playing && bar < 0) return { line: `Four clicks, then strum ${first} on the next one.` };
  if (playing) {
    const now = LESSON.chords[bar % n].name;
    const next = LESSON.chords[(bar + 1) % n].name;
    if (st.bars >= 2 && st.correct === 0) return { line: `Nothing heard as ${now} yet. Strum once on each beat and let it ring.` };
    return { line: `Strum ${now} on every click. ${next} comes next.` };
  }
  if (results.length) return { line: `Last run: ${st.onTime} of ${st.changes} changes on time.`, action: { label: 'Again', run: start } };
  return { line: `Press Play along and strum ${first} on the click.`, action: { label: 'Play along', run: start } };
}
