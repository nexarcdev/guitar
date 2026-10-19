import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './tone';
import s from './Button.module.css';

export type ButtonVariant =
  /** Amber: the main action on a panel. */
  | 'primary'
  /** Black: the secondary action. */
  | 'dark'
  /** Cherry: stop, record, delete. */
  | 'danger'
  /** Cream: small actions on ivory. */
  | 'cream'
  /** Ink outline: actions printed on paper. */
  | 'paper'
  /** Teal outline: the tutor's one action. */
  | 'tutor';

interface Common {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Grow to fill the row. */
  grow?: boolean;
  /** Square, for a single glyph. */
  icon?: boolean;
  className?: string;
  children?: ReactNode;
}

type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** The one push button. With `href` it renders a real link (pass the router's click handler). */
export function Button(props: AsButton | AsLink) {
  const { variant = 'dark', size = 'md', grow, icon, className, children, ...rest } = props;
  const cls = cx(s.btn, s[variant], s[size], grow && s.grow, icon && s.icon, className);
  if (rest.href != null) return <a className={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>;
  return (
    <button type="button" className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
