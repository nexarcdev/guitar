import { linkProps } from '../../state/router';
import { Button, Panel, Window } from '../../ui';

/** Any path the app doesn't know: say so plainly and offer the way back. */
export function NotFound({ path }: { path: string }) {
  return (
    <Panel title="Not found" lamp="live" minHeight={360}>
      <Window surface="glass" kicker="No page here" title={`/${path}`} titleSize={34} gap={18}>
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.5, maxWidth: 520 }}>This address isn’t part of Fretline. It may be an old link, or a Learn module that isn’t switched on in this build.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" {...linkProps({ kind: 'page', page: 'tuner' })}>
            Open the tuner
          </Button>
          <Button variant="dark" size="lg" {...linkProps({ kind: 'learn', module: 'lesson' })}>
            Open the lesson
          </Button>
        </div>
      </Window>
    </Panel>
  );
}
