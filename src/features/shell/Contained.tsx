import { Component, type ReactNode } from 'react';
import s from './Contained.module.css';

/**
 * Keeps a failure inside one view or Studio tab: the header, the other views and the audio keep
 * running, and the error is shown so it can be reported. Key it on the view, so switching away
 * and back starts fresh.
 */
export class Contained extends Component<{ what: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={s.box} role="alert">
        <div className={s.title}>{this.props.what} hit a problem and stopped</div>
        <p className={s.desc}>The rest of Fretline is still running. Try again, or reload if this keeps happening (a reload also picks up a newer version).</p>
        <div className={s.error}>{error.message}</div>
        <div className={s.row}>
          <button className={s.retry} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className={s.reload} onClick={() => location.reload()}>
            Reload Fretline
          </button>
        </div>
      </div>
    );
  }
}
