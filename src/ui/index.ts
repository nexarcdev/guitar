// The design system's bases. Views build from these; never restyle a switch, lamp, picker,
// readout or frame by hand (design/project/CLAUDE.md).
export { BeatStrip, type BeatStep } from './BeatStrip';
export { Button, type ButtonVariant } from './Button';
export { Chip } from './Chip';
export { ChordChart } from './ChordChart';
export { Fretboard, type FretMark, type MarkTone } from './Fretboard';
export { Knob } from './Knob';
export { Lamp, type LampTone } from './Lamp';
export { Meter, meterPos, METER_MIN_DB, METER_HOT_DB, type MeterFrame, type MeterHandle } from './Meter';
export { Panel, Screw, Screws } from './Panel';
export { Readout } from './Readout';
export { Segment, type SegmentOption } from './Segment';
export { SkillRing, gradeFor } from './SkillRing';
export { Switch } from './Switch';
export { Note, Well, WellButton } from './Well';
export { Window } from './Window';
export { TONE, TONE_IVORY, cx, type Tone } from './tone';
