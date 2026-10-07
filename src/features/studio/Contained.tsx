import { Component, type ReactNode } from 'react';
import s from './Studio.module.css';

/**
 * Keeps a failing tab inside its own panel: the rest of the Studio and the app stay usable, and
 * the error is shown so it can be reported. Keyed on the tab, so switching tabs starts fresh.
 */
export class Contained extends Component<{ children: ReactNode }, { error: Error | null }> {
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
      <div className={s.warn} role="alert">
        <div>This section hit a problem and stopped. The rest of Fretline is fine.</div>
        <div className={s.mono}>{error.message}</div>
        <div className={s.row}>
          <button className={s.testBtn} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
