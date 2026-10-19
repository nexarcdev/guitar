// The component reference sheet (development builds only, at /design). Every base in src/ui
// appears here with its props and states, built from the real components, so the sheet can't
// drift from the app.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BeatStrip, Button, Chip, ChordChart, Fretboard, Knob, Lamp, Meter, Note, Panel, Readout, Screw, Screws, Segment, SkillRing, Switch, Well, WellButton, Window,
  type BeatStep, type FretMark, type LampTone,
} from '../../ui';
import { TutorStrip } from '../shell/Tutor';
import s from './Design.module.css';

const SECTIONS = [
  ['color', 'Color'],
  ['type', 'Type'],
  ['controls', 'Controls'],
  ['base', 'Base'],
  ['learn', 'Learn'],
  ['meters', 'Meters'],
  ['paper', 'Paper'],
  ['tutor', 'Tutor'],
] as const;
type SectionId = (typeof SECTIONS)[number][0];

export function Design() {
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const jump = (id: SectionId) => {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const reg = (id: SectionId) => (el: HTMLElement | null) => {
    refs.current[id] = el;
  };
  return (
    <div className={s.page}>
      <div className={s.top}>
        <div className={s.brand}>Fretline</div>
        <div className={s.kicker}>Component reference</div>
        <nav className={s.jump} aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => jump(id)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className={s.rule}>
        <span>Ivory where you touch.</span> <span>Dark glass where you read.</span> <span>Paper where you learn.</span>
        <small>Changing information always sits on glass, a dark well or paper; never directly on an ivory face.</small>
      </div>

      <Section id="color" title="Color" intro="Three accents share one job each. Never one accent alone on a screen." reg={reg}>
        <ColorSection />
      </Section>
      <Section id="type" title="Type" intro="Badge script for the name only. Engraved caps for labels. Barlow for anything you read." reg={reg}>
        <TypeSection />
      </Section>
      <Section id="controls" title="Controls" intro="Square corners, physical travel. Pressed states sink; lit states glow." reg={reg}>
        <ControlsSection />
      </Section>
      <Section id="base" title="Base" intro="One base per behavior. Segments pick, readouts report, panels and windows frame. Nothing is restyled by hand." reg={reg}>
        <BaseSection />
      </Section>
      <Section id="learn" title="Learn" intro="Instruments the tutor reads from. Glass by default, with a paper variant for worksheets." reg={reg}>
        <LearnSection />
      </Section>
      <Section id="meters" title="Meters and scores" intro="Teal below the playing threshold, amber above, cherry in the top 6 dB. Lit segments glow." reg={reg}>
        <MetersSection />
      </Section>
      <Section id="paper" title="Paper" intro="Chord charts and tab live on aged manila. Ink is brown-black. Edges darken. Never glows." reg={reg}>
        <PaperSection />
      </Section>
      <Section id="tutor" title="Tutor strip" intro="One sentence at a time, at most one action. Never a modal." reg={reg}>
        <div className={s.tutorFrame}>
          <TutorStrip line="Your G to C change lands a half beat late. Keep finger 3 on the high e as a pivot." action={{ label: 'Show me', run: () => {} }} />
        </div>
        <Caption>TutorStrip: line, action (route or run). The Shell picks the line from the live state of the current view.</Caption>
      </Section>
    </div>
  );
}

function Section({ id, title, intro, reg, children }: { id: SectionId; title: string; intro: string; reg: (id: SectionId) => (el: HTMLElement | null) => void; children: ReactNode }) {
  return (
    <section ref={reg(id)} className={s.section} aria-labelledby={`design-${id}`}>
      <div className={s.sectionHead}>
        <h2 id={`design-${id}`}>{title}</h2>
        <span>{intro}</span>
      </div>
      {children}
    </section>
  );
}

/** A props note under an example. */
function Caption({ children, ivory }: { children: ReactNode; ivory?: boolean }) {
  return <p className={ivory ? s.captionIvory : s.caption}>{children}</p>;
}

/** One labelled example. */
function Ex({ label, children, ivory }: { label: string; children: ReactNode; ivory?: boolean }) {
  return (
    <div className={s.ex}>
      <div className={s.exBody}>{children}</div>
      <code className={ivory ? s.exLabelIvory : s.exLabel}>{label}</code>
    </div>
  );
}

// ---------------------------------------------------------------- color

const TOKEN_GROUPS: Array<[string, string[]]> = [
  ['Accents', ['--cherry', '--amber', '--amber-hi', '--teal', '--amber-ivory', '--teal-ivory', '--playhead']],
  ['Chassis and ink', ['--chassis', '--chassis-light', '--strip', '--ink', '--ink-2', '--ink-3', '--ink-4']],
  ['Dark panel and glass', ['--panel', '--screw-steel', '--glass', '--readout', '--track']],
  ['Ivory and wells', ['--ivory', '--ivory-title', '--ivory-ink', '--ivory-ink-2', '--ivory-ink-3', '--screw-bone', '--well-bg', '--well-grain', '--well-edge', '--ivory-note']],
  ['Paper', ['--paper', '--paper-flat', '--paper-grain', '--paper-ink', '--paper-ink-2', '--paper-ink-3']],
  ['Aluminum and cream', ['--alu', '--alu-ink', '--alu-ink-2', '--alu-off', '--cream']],
];
const SHADOW_TOKENS = ['--panel-shadow', '--glass-shadow', '--ivory-shadow', '--well-shadow', '--ivory-note-shadow', '--paper-shadow'];
const OTHER_TOKENS = ['--font-display', '--font-body', '--font-script', '--gap', '--header-h', '--tutor-h'];

const ACCENTS: Array<[string, string, string]> = [
  ['Cherry', '--cherry', 'Live, recording, danger'],
  ['Amber', '--amber', 'Selected, on, primary action'],
  ['Teal', '--teal', 'Confirmed, tutor, in tune'],
];

/** Reads token values from the stylesheet, so the swatches show what's really there. */
function useTokens(names: string[]) {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setVals(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])));
  }, [names.join()]);
  return vals;
}

const ALL_TOKENS = [...TOKEN_GROUPS.flatMap(([, t]) => t), ...SHADOW_TOKENS, ...OTHER_TOKENS];

function ColorSection() {
  const v = useTokens(ALL_TOKENS);
  return (
    <>
      <div className={s.accents}>
        {ACCENTS.map(([name, tok, role]) => (
          <div key={name} className={s.accent}>
            <div className={s.accentChip} style={{ background: `var(${tok})`, boxShadow: `0 0 22px color-mix(in srgb, var(${tok}) 40%, transparent), inset 0 1px 0 rgba(255,255,255,0.3)` }} />
            <div className={s.accentName}>{name}</div>
            <div className={s.accentRole}>{role}</div>
            <code className={s.mono}>{tok}</code>
          </div>
        ))}
      </div>
      {TOKEN_GROUPS.map(([group, toks]) => (
        <Panel key={group} title={group} meta={`${toks.length} tokens`}>
          <div className={s.swatches}>
            {toks.map((t) => (
              <div key={t} className={s.swatch}>
                <div className={s.swatchFill} style={t.endsWith('grain') ? { background: `var(${t}), var(--well-bg)` } : { background: `var(${t})` }} />
                <code className={s.swatchName}>{t}</code>
                <code className={s.swatchVal} title={v[t]}>
                  {v[t]}
                </code>
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <Panel title="Depth" meta="Shadows that make a surface">
        <div className={s.swatches}>
          {SHADOW_TOKENS.map((t) => (
            <div key={t} className={s.swatch}>
              <div className={s.shadowFill} style={{ boxShadow: `var(${t})`, background: t.startsWith('--ivory') ? 'var(--ivory)' : t.startsWith('--paper') ? 'var(--paper)' : t.startsWith('--glass') ? 'var(--glass)' : 'var(--panel)' }} />
              <code className={s.swatchName}>{t}</code>
              <code className={s.swatchVal} title={v[t]}>
                {v[t]}
              </code>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Type and layout tokens">
        <div className={s.tokenList}>
          {OTHER_TOKENS.map((t) => (
            <div key={t}>
              <code className={s.swatchName}>{t}</code>
              <code className={s.swatchVal}>{v[t]}</code>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- type

function TypeSection() {
  return (
    <div className={s.grid2}>
      <Panel title="Wordmark" meta="Yellowtail">
        <div className={s.typeScript}>Fretline</div>
        <Caption>
          <code>--font-script</code>. The wordmark only, nowhere else.
        </Caption>
      </Panel>
      <Panel title="Labels and numbers" meta="Big Shoulders Display 700, 800">
        <div className={s.typeDisplay}>
          Chord
          <br />
          identifier
        </div>
        <div className={s.typeLabel}>Panel label · 14 / 0.18em</div>
        <Caption>
          <code>--font-display</code>. Titles, labels and numbers, always in caps.
        </Caption>
      </Panel>
      <Panel title="Copy" meta="Barlow 400, 500" flex="1 1 100%">
        <p className={s.typeBody}>Strum once and let it ring. Fretline names the chord and shows the shape you played.</p>
        <p className={s.typeBodySmall}>Body 14 to 16 px. Readouts use tabular numerals: 82.41 Hz · −12 dB · 96 BPM.</p>
        <Caption>
          <code>--font-body</code>. Copy, hints and meta.
        </Caption>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- controls

const LAMP_TONES: LampTone[] = ['off', 'live', 'on', 'ok'];

function ControlsSection() {
  const [sw, setSw] = useState({ a: true, b: false, c: true, d: true, e: false, f: true, g: true });
  const flip = (k: keyof typeof sw) => (v: boolean) => setSw((x) => ({ ...x, [k]: v }));
  const [knob, setKnob] = useState(62);
  const [knob2, setKnob2] = useState(40);
  const [pressed, setPressed] = useState(0);
  return (
    <>
      <Panel title="Buttons" meta="Button">
        <div className={s.row}>
          <Ex label="primary lg">
            <Button variant="primary" size="lg" onClick={() => setPressed((n) => n + 1)}>
              Play reference
            </Button>
          </Ex>
          <Ex label="dark lg">
            <Button variant="dark" size="lg">
              Start over
            </Button>
          </Ex>
          <Ex label="danger md">
            <Button variant="danger">Record</Button>
          </Ex>
          <Ex label="primary md disabled">
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </Ex>
          <Ex label="dark sm icon">
            <Button variant="dark" size="sm" icon aria-label="Play">
              ▶
            </Button>
          </Ex>
          <Ex label="tutor">
            <Button variant="tutor">Show me</Button>
          </Ex>
          <Ex label="href (a real link)">
            <Button variant="dark" size="sm" href="/" onClick={(e) => e.preventDefault()}>
              Link form
            </Button>
          </Ex>
        </div>
        <Caption>
          Button: variant primary / dark / danger / cream / paper / tutor, size sm / md / lg, grow, icon, href (renders an anchor; pass the router's linkProps). Primary pressed {pressed} times.
        </Caption>
      </Panel>
      <div className={s.grid2}>
        <Panel surface="ivory" title="Buttons on ivory">
          <div className={s.row}>
            <Ex label="cream sm" ivory>
              <Button variant="cream" size="sm">
                Import
              </Button>
            </Ex>
            <Ex label="cream sm icon" ivory>
              <Button variant="cream" size="sm" icon aria-label="Stop">
                ■
              </Button>
            </Ex>
            <Ex label="primary md grow" ivory>
              <Button variant="primary" grow>
                Strum
              </Button>
            </Ex>
          </div>
        </Panel>
        <Panel title="Buttons on paper">
          <Window surface="paper" pad="16px 18px">
            <div className={s.row}>
              <Button variant="paper" size="sm">
                Clear
              </Button>
              <Button variant="paper" size="sm">
                Print
              </Button>
            </div>
          </Window>
        </Panel>
      </div>

      <Panel title="Switches" meta="Switch">
        <div className={s.switchBoard}>
          <div className={s.aluPlate}>
            <Ex label="vertical alu tone=live pulse">
              <Switch vertical surface="alu" tone="live" pulse={sw.a} on={sw.a} label="Listen" onToggle={flip('a')} />
            </Ex>
            <Ex label="vertical alu tone=on">
              <Switch vertical surface="alu" on={sw.b} label="Output" onToggle={flip('b')} />
            </Ex>
          </div>
          <div className={s.darkPlate}>
            <Ex label="dark labelSide=left">
              <Switch on={sw.c} label="Auto" labelSide="left" onToggle={flip('c')} />
            </Ex>
            <Ex label="dark tone=ok labelSide=right">
              <Switch tone="ok" on={sw.d} label="Metronome" labelSide="right" onToggle={flip('d')} />
            </Ex>
            <Ex label="dark labelSide=below">
              <Switch tone="live" on={sw.e} label="Arm" onToggle={flip('e')} />
            </Ex>
            <Ex label="vertical dark">
              <Switch vertical on={sw.g} label="Gate" onToggle={flip('g')} />
            </Ex>
            <Ex label="disabled">
              <Switch on label="Locked" disabled onToggle={() => {}} />
            </Ex>
          </div>
          <div className={s.ivoryPlate}>
            <Ex label="ivory labelSide=left" ivory>
              <Switch surface="ivory" on={sw.f} label="Count-in" labelSide="left" onToggle={flip('f')} />
            </Ex>
            <Ex label="ivory labelSide=none" ivory>
              <Switch surface="ivory" on={sw.f} label="Count-in" labelSide="none" onToggle={flip('f')} />
            </Ex>
          </div>
        </div>
        <Caption>
          Switch: on, onToggle(on), label, ariaLabel, vertical, surface dark / ivory / alu, tone live / on / ok (the lamp), labelSide below / left / right / none, pulse, disabled. The only way to flip anything in Fretline. Off, the lamp hides where the cap was.
        </Caption>
      </Panel>

      <div className={s.grid2}>
        <Panel title="Lamps" meta="Lamp">
          <div className={s.row}>
            {LAMP_TONES.map((t) => (
              <Ex key={t} label={`tone=${t}`}>
                <Lamp tone={t} size={12} />
              </Ex>
            ))}
            <Ex label="pulse">
              <Lamp tone="live" size={12} pulse />
            </Ex>
            <Ex label="glow=false">
              <Lamp tone="on" size={12} glow={false} />
            </Ex>
            <Ex label="bar on">
              <Lamp shape="bar" tone="on" />
            </Ex>
            <Ex label="color override">
              <Lamp tone="on" color="#f0c46b" size={12} />
            </Ex>
          </div>
          <div className={s.row}>
            {(['dark', 'well', 'alu', 'ivory'] as const).map((sf) => (
              <Ex key={sf} label={`off surface=${sf}`}>
                <span className={s.lampOn} data-surface={sf}>
                  <Lamp tone="off" surface={sf} size={12} />
                  <Lamp tone="off" surface={sf} shape="bar" length={24} />
                </span>
              </Ex>
            ))}
          </div>
          <Caption>Lamp: tone off / live / on / ok, shape dot / bar, size, length, pulse, surface (unlit colour), color, glow, label.</Caption>
        </Panel>
        <Panel title="Chips" meta="Chip">
          <div className={s.row}>
            <Chip label="Live" tone="live" pulse />
            <Chip label="In tune" tone="ok" />
            <Chip label="Output on" tone="on" />
            <Chip label="Paused" tone="muted" />
          </div>
          <div className={s.row}>
            <Ex label="size=sm">
              <Chip label="Level 3 of 6" tone="on" size="sm" />
            </Ex>
            <Ex label="size=md">
              <Chip label="Waiting for G" tone="live" />
            </Ex>
            <Ex label="size=lg">
              <Chip label="In tune" tone="ok" size="lg" />
            </Ex>
            <Ex label="color override">
              <Chip label="Root" tone="on" color="#f0c46b" />
            </Ex>
          </div>
          <Caption>Chip: label, tone live / on / ok / muted, size sm / md / lg, pulse, color, live (announces changes). A fixed one-line status.</Caption>
        </Panel>
      </div>

      <div className={s.grid2}>
        <Panel title="Knobs on dark" meta="Knob">
          <div className={s.rowAround}>
            <Knob value={knob} onChange={setKnob} label={`Drive · ${knob}`} ariaLabel="Drive" />
            <Knob value={70} cap="chrome" color="#d4442c" label="Chrome" size={72} />
            <Knob value={35} on={false} label="Off" size={72} />
          </div>
          <Caption>Knob: value, min, max, step, onChange (drag up / down, arrow keys, Shift for 10), label, size, color, cap black / cream / chrome, on, labelColor, valueText. Drag the first one.</Caption>
        </Panel>
        <Panel surface="ivory" title="Knobs on ivory">
          <div className={s.rowAround}>
            <Knob value={knob2} onChange={setKnob2} cap="cream" color="#d9902a" labelColor="#6b5636" label={`Tempo · ${Math.round(40 + knob2 * 1.6)}`} ariaLabel="Tempo" size={78} />
            <Knob value={60} cap="cream" color="#1f8c7c" labelColor="#6b5636" label="Click · 60%" size={78} />
          </div>
          <Caption ivory>On ivory: cream caps and the darker arcs (<code>--amber-ivory</code>, <code>--teal-ivory</code>).</Caption>
        </Panel>
      </div>

      <Panel title="Screws" meta="Screw, Screws">
        <div className={s.row}>
          <Ex label="Screw surface=dark">
            <span className={s.screwBox}>
              <Screw style={{ position: 'relative' }} size={14} />
            </span>
          </Ex>
          <Ex label="Screw surface=ivory">
            <span className={s.screwBoxIvory}>
              <Screw surface="ivory" style={{ position: 'relative' }} size={14} />
            </span>
          </Ex>
          <Ex label="Screws inset=6 size=8">
            <span className={s.screwPlate}>
              <Screws inset={6} size={8} />
            </span>
          </Ex>
        </div>
        <Caption>Steel on dark plates, bone on ivory. Panel draws its own four; Screws and Screw are for other enclosures (pedals).</Caption>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- base

function BaseSection() {
  const [seg, setSeg] = useState<'identify' | 'confirm'>('identify');
  const [sub, setSub] = useState<'1/4' | '1/8' | '1/16'>('1/8');
  const [riff, setRiff] = useState<'saved' | 'deleted'>('saved');
  const [view, setView] = useState<'charts' | 'tab'>('charts');
  const [str, setStr] = useState(1);
  return (
    <>
      <div className={s.grid2}>
        <Panel title="Segments" meta="Segment">
          <div className={s.col}>
            <Ex label="dark sm">
              <Segment label="Mode" options={[{ id: 'identify', label: 'Identify' }, { id: 'confirm', label: 'Confirm' }]} value={seg} onChange={setSeg} />
            </Ex>
            <Ex label="dark md">
              <Segment label="Subdivision" size="md" options={['1/4', '1/8', '1/16'] as const} value={sub} onChange={setSub} />
            </Ex>
            <Ex label="dark lg, disabled option">
              <Segment label="Size" size="lg" options={[{ id: 'a', label: 'Open' }, { id: 'b', label: 'Barre' }, { id: 'c', label: 'Jazz', disabled: true }]} value="a" onChange={() => {}} />
            </Ex>
          </div>
          <Caption>Segment: options (strings or id, label, n, disabled), value, onChange(id), label (group name), surface dark / ivory, size sm / md / lg. Selected is always amber; it scrolls instead of wrapping.</Caption>
        </Panel>
        <Panel surface="ivory" title="Segments on ivory">
          <div className={s.col}>
            <Ex label="ivory sm with counts" ivory>
              <Segment label="Riffs" surface="ivory" options={[{ id: 'saved', label: 'Saved', n: 3 }, { id: 'deleted', label: 'Deleted', n: 0 }]} value={riff} onChange={setRiff} />
            </Ex>
            <Ex label="ivory md" ivory>
              <Segment label="View" surface="ivory" size="md" options={[{ id: 'charts', label: 'Charts' }, { id: 'tab', label: 'Tab' }]} value={view} onChange={setView} />
            </Ex>
          </div>
        </Panel>
      </div>

      <div className={s.grid2}>
        <Panel title="Readouts" meta="Readout">
          <div className={s.readouts}>
            <Readout label="Tempo" value="72" unit="BPM" />
            <Readout label="Pitch" value="82.41" unit="Hz" tone="on" sub="E2 · −3 cents" />
            <Readout label="Streak" value="12" unit="days" tone="ok" size="sm" />
            <Readout label="Clip" value="−0.4" unit="dB" tone="live" size="sm" />
            <Readout label="Last" value="Yesterday" tone="muted" size="sm" />
            <Readout label="Score" value="88" size="lg" align="center" tone="on" />
          </div>
          <Caption>Readout: label, value, unit, sub, tone ink / on / ok / live / muted, size sm / md / lg, surface dark / ivory / alu (the rim), align, color, valueRef (for per-frame values).</Caption>
        </Panel>
        <Panel surface="ivory" title="Readouts on ivory">
          <div className={s.readouts}>
            <Readout surface="ivory" label="This week" value="2:10" unit="h" />
            <Readout surface="ivory" label="Streak" value="12" unit="days" tone="on" />
          </div>
          <div className={s.aluStrip}>
            <Readout surface="alu" label="Tuning" value="Standard" sub="A 440 Hz" tone="on" size="sm" />
          </div>
          <Caption ivory>Changing numbers never sit on bare ivory; this is the well they sit in.</Caption>
        </Panel>
      </div>

      <div className={s.grid2}>
        <Panel title="Dark panel" lamp="live" pulse meta="Meta text on the right" minHeight={260}>
          <Window surface="glass" kicker="Glass window" title="G" titleSize={64} meta="Everything inside glows">
            <div>
              <Chip label="In tune" tone="ok" />
            </div>
          </Window>
        </Panel>
        <Panel surface="ivory" title="Ivory panel" lamp="on" meta={<Switch surface="ivory" on label="Controls" labelSide="left" onToggle={() => {}} />} minHeight={260}>
          <Note>
            <strong>meta</strong> takes text (styled as a note) or controls (laid out as a row). The title lamp takes any lamp tone.
          </Note>
          <Window surface="paper" kicker="Paper window" title="G · Em · C · D" meta="72 BPM">
            <span style={{ position: 'relative' }}>Children render inside. Grain and vignette come with the surface.</span>
          </Window>
        </Panel>
      </div>
      <Caption>
        Panel: surface dark / ivory, title, meta (text or controls), lamp, pulse, minHeight, flex; screws and title row included. Window: surface glass / paper, kicker, title, titleSize, meta, pad, gap, minHeight, flex. A paper window always sits inside a dark panel.
      </Caption>

      <Panel surface="ivory" title="Wells and notes" meta="Well, WellButton, Note">
        <div className={s.wells}>
          {['E', 'A', 'D'].map((n, i) => (
            <WellButton key={n} active={str === i} onClick={() => setStr(i)} className={s.wellBtn} aria-pressed={str === i}>
              <Lamp tone={i === 0 ? 'ok' : str === i ? 'on' : 'off'} size={14} surface="well" />
              <span className={s.wellNote}>{n}</span>
              <span className={s.wellSub}>{i === 0 ? 'In tune' : str === i ? 'Listening' : 'Next'}</span>
            </WellButton>
          ))}
          <Well edge="#1f8c7c" className={s.wellStatic}>
            Well edge=teal
          </Well>
        </div>
        <Note>
          <strong>Note</strong> holds static help pressed into ivory. Status never goes here: that belongs in a Chip.
        </Note>
        <Caption ivory>Well / WellButton: active (amber edge), edge (colour override). Note: static text only.</Caption>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- learn

const CHROM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OPEN = [4, 9, 2, 7, 11, 4];
const IVN = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
function marksFor(root: number, ivs: number[], frets: number, chordIvs: number[]): FretMark[] {
  const out: FretMark[] = [];
  for (let st = 0; st < 6; st++)
    for (let f = 0; f <= frets; f++) {
      const iv = (OPEN[st] + f - root + 24) % 12;
      if (ivs.includes(iv)) out.push({ s: st, f, tone: iv === 0 ? 'root' : chordIvs.includes(iv) ? 'chord' : 'scale', note: CHROM[(OPEN[st] + f) % 12], iv: IVN[iv] });
    }
  return out;
}
const A_MINOR_PENT = marksFor(9, [0, 3, 5, 7, 10], 12, [0, 3, 7]);
const C_MAJOR_CHORD = marksFor(0, [0, 4, 7], 5, [4, 7]);
const BEAT: BeatStep[] = 'D-DU-UDUD-DU-UDU'.split('').map((stroke, i) => ({ stroke: stroke as BeatStep['stroke'], hit: stroke === '-' || i >= 9 ? null : [4, 0, -12, 18, 0, 31, -6, 58, 2][i] }));

function LearnSection() {
  const [mode, setMode] = useState<'notes' | 'intervals' | 'dots'>('notes');
  const [tap, setTap] = useState<FretMark | null>(null);
  const [beat, setBeat] = useState(9);
  const marks: FretMark[] = [...A_MINOR_PENT.filter((m) => !(tap && m.s === tap.s && m.f === tap.f)), ...(tap ? [tap] : [])];
  return (
    <>
      <Panel title="Fretboard on glass" meta={<Segment label="Show" options={['notes', 'intervals', 'dots'] as const} value={mode} onChange={setMode} />}>
        <Window surface="glass" pad="14px 16px">
          <Fretboard marks={marks} mode={mode} onTap={(st, f) => setTap({ s: st, f, tone: 'target', note: CHROM[(OPEN[st] + f) % 12], iv: '?' })} />
        </Window>
        <Caption>
          Fretboard: frets, from, marks (s, f, tone root / chord / scale / target / heard / dim, note, iv), mode notes / intervals / dots, surface glass / well / paper, rowH, tuning, muted, onTap(string, fret), numbers. Tap a cell: {tap ? `string ${tap.s}, fret ${tap.f} (target)` : 'nothing yet'}.
        </Caption>
      </Panel>
      <div className={s.grid2}>
        <Panel surface="ivory" title="In a well, muted strings">
          <Well className={s.boardWell}>
            <Fretboard surface="well" frets={5} rowH={34} muted={[0]} marks={[{ s: 1, f: 3, tone: 'heard' }, { s: 2, f: 2, tone: 'heard' }, { s: 4, f: 1, tone: 'heard' }, { s: 3, f: 0, tone: 'dim' }, { s: 5, f: 0, tone: 'dim' }]} mode="dots" numbers={false} onTap={() => {}} />
          </Well>
          <Caption ivory>surface=well, muted=[0], mode=dots, numbers=false.</Caption>
        </Panel>
        <Panel title="On paper">
          <Window surface="paper" pad="16px 18px">
            <Fretboard surface="paper" frets={5} rowH={28} marks={[...C_MAJOR_CHORD, { s: 3, f: 2, tone: 'target', note: 'A' }, { s: 2, f: 4, tone: 'dim', note: 'F#' }]} mode="notes" />
          </Window>
          <Caption>Paper tones are ink, never lit; the target uses the playhead colour.</Caption>
        </Panel>
      </div>
      <Panel title="Beat strip" meta={<Button variant="dark" size="sm" onClick={() => setBeat((b) => (b + 1) % 17)}>Step playhead</Button>}>
        <Window surface="glass" pad="14px 16px">
          <BeatStrip steps={BEAT} current={beat} sub={4} />
        </Window>
        <Window surface="glass" pad="14px 16px">
          <BeatStrip steps={BEAT.slice(0, 6)} current={-1} sub={2} arrowSize={18} legend="sub=2, no playhead" />
        </Window>
        <Caption>BeatStrip: steps (stroke D / U / - / x, hit ms), sub 1 / 2 / 3 / 4, current, legend, arrowSize. Teal within 20 ms, amber within 50, cherry beyond; missed strokes fade cherry.</Caption>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- meters

function MetersSection() {
  const [v, setV] = useState(-24);
  return (
    <div className={s.grid2}>
      <Panel title="Meter" meta={`value ${v} dB`}>
        <Window surface="glass" pad="14px 16px" gap={16}>
          <Meter label="Guitar in" value={v} peak={Math.min(0, v + 8)} threshold={-48} />
          <Meter label="Quiet, below threshold" value={-60} peak={-55} threshold={-48} />
          <Meter label="Hot" value={-3} peak={-1} threshold={-48} />
          <Meter label="Speakers out (no threshold)" value={-30} peak={-20} height={12} />
          <Meter label="Off" value={-30} live={false} />
          <Meter label="Floor and scale" value={-40} threshold={-55} floor={-70} showFloor scale={[-96, -72, -48, -24, -12, 0]} />
          <Meter label="Header size" value={-22} height={6} />
          <input type="range" min={-96} max={0} value={v} onChange={(e) => setV(+e.target.value)} aria-label="Meter value" className={s.range} />
        </Window>
        <Caption>Meter: label, value, peak, threshold, floor, live, open, height, quiet / color / hot, showFloor, scale, handle (live meters draw every frame through it), trackProps, children.</Caption>
      </Panel>
      <Panel surface="ivory" title="Skill ring" meta="SkillRing">
        <div className={s.rowAround}>
          <SkillRing score={92} label="Timing" color="#1f8c7c" labelColor="#6b5636" size={88} />
          <SkillRing score={58} label="Changes" color="#d9902a" labelColor="#6b5636" size={88} />
          <SkillRing score={22} label="Fretboard" color="#c8431f" labelColor="#6b5636" size={88} />
        </div>
        <div className={s.ringGlass}>
          <SkillRing score={72} label="Open chords" />
          <SkillRing score={45} label="Override" grade="Custom grade" color="#e9a23b" size={72} />
        </div>
        <Caption ivory>SkillRing: score 0 to 100, label, grade (derived: New, Getting there, Steady, Solid), size, color, labelColor. Colour is the skill's state: teal steady, amber building, cherry new.</Caption>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- paper

const TAB_NOTES: Array<[number, number, number]> = [[6, 0, 5], [14, 1, 5], [22, 2, 6], [30, 1, 5], [40, 3, 7], [48, 2, 6], [56, 1, 5], [64, 0, 5], [74, 1, 7], [82, 2, 6], [90, 1, 5]];

function PaperSection() {
  return (
    <>
      <Panel title="Chord chart" meta="ChordChart">
        <div className={s.charts}>
          <Ex label="G width=150">
            <ChordChart chord="G" sub="major" frets={[3, 2, 0, 0, 0, 3]} fingers={[2, 1, 0, 0, 0, 3]} />
          </Ex>
          <Ex label="Em">
            <ChordChart chord="Em" sub="minor" frets={[0, 2, 2, 0, 0, 0]} fingers={[0, 2, 3, 0, 0, 0]} width={130} />
          </Ex>
          <Ex label="F barre">
            <ChordChart chord="F" sub="barre" frets={[1, 3, 3, 2, 1, 1]} fingers={[1, 3, 4, 2, 1, 1]} barre width={130} />
          </Ex>
          <Ex label="Bm7 muted, accent">
            <ChordChart chord="Bm7" frets={[-1, 2, 4, 2, 3, 2]} width={130} accent="#1f8c7c" />
          </Ex>
          <Ex label="baseFret=5 barre">
            <ChordChart chord="A" sub="5th fret" frets={[5, 7, 7, 6, 5, 5]} baseFret={5} barre width={130} />
          </Ex>
          <Ex label="width=84 (preset)">
            <ChordChart chord="D" frets={[-1, -1, 0, 2, 3, 2]} width={84} />
          </Ex>
        </div>
        <Caption>ChordChart: chord, sub, frets (6, low E first: −1 muted, 0 open), fingers, baseFret, barre, width, flat, accent (the × colour).</Caption>
      </Panel>
      <Panel title="On a sheet" meta="flat">
        <Window surface="paper" kicker="Open chords · part 2 of 3" title="G · Em · C · D" meta="Key of G · 4/4 · 72 BPM">
          <div className={s.charts} style={{ position: 'relative' }}>
            <ChordChart chord="G" sub="major" frets={[3, 2, 0, 0, 0, 3]} width={112} flat />
            <ChordChart chord="Em" sub="minor" frets={[0, 2, 2, 0, 0, 0]} width={112} flat />
            <ChordChart chord="C" sub="major" frets={[-1, 3, 2, 0, 1, 0]} width={112} flat />
            <ChordChart chord="D" sub="major" frets={[-1, -1, 0, 2, 3, 2]} width={112} flat />
          </div>
        </Window>
        <Caption>flat: a chart lying on paper has a hairline edge and a soft lift, no dark halo.</Caption>
      </Panel>
      <Panel title="Tab sheet">
        <Window surface="paper" title="Blues turnaround" titleSize={26} meta="A · 4/4 · 96 BPM">
          <div className={s.tab}>
            <div className={s.tabStrings}>
              {['e', 'B', 'G', 'D', 'A', 'E'].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div className={s.tabLines} />
            <div className={s.tabNotes}>
              {TAB_NOTES.map(([left, st, f], i) => (
                <span key={i} style={{ left: `${left}%`, top: 10 + (5 - st) * 22, color: i === 5 ? 'var(--playhead)' : 'var(--paper-ink)' }}>
                  {f}
                </span>
              ))}
              <div className={s.tabHead} />
            </div>
          </div>
          <div className={s.tabFoot}>The playhead is the only accent colour allowed on paper.</div>
        </Window>
      </Panel>
    </>
  );
}
