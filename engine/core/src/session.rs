//! A channel's state and decisions: turns client messages into new shared state plus the
//! commands each working half must apply. Pure (the caller supplies the time), so the engine and
//! the browser run exactly the same rules for validation, persistence, per-device noise floors
//! and "newest edit wins".

use crate::chain::PedalSetting;
use crate::pedals::PedalKind;
use crate::protocol::{ControlMsg, FloorSetting, PedalState, SessionState, StatePatch};
use crate::sides::{AudioCmd, ListenCmd, SYNTH_LEAD};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The board a new session starts with (same as the app has always shipped).
pub const DEFAULT_PEDALS: [(&str, f32, bool); 8] = [
    ("Compressor", 55.0, false),
    ("Overdrive", 62.0, true),
    ("Distortion", 70.0, false),
    ("Fuzz", 48.0, false),
    ("Chorus", 40.0, false),
    ("Phaser", 35.0, false),
    ("Delay", 45.0, true),
    ("Reverb", 58.0, false),
];

pub const DEFAULT_GATE_DB: f32 = 12.0;

/// What a message changes. `state` is set when shared state changed (broadcast it);
/// `devices` when the host must (re)open its streams.
#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Effects {
    pub state: Option<SessionState>,
    pub audio: Vec<AudioCmd>,
    pub listen: Vec<ListenCmd>,
    pub devices: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub state: SessionState,
    /// Noise floor settings remembered per input device.
    floors: BTreeMap<String, FloorSetting>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            state: SessionState {
                rev: 0,
                edited_at: 0.0,
                pedals: DEFAULT_PEDALS.iter().map(|&(name, level, on)| PedalState { name: name.into(), on, level }).collect(),
                output: false,
                gate_db: DEFAULT_GATE_DB,
                floor: FloorSetting::default(),
                ml: true,
                input_id: String::new(),
                output_id: String::new(),
                exclusive_input: true,
                exclusive_output: false,
            },
            floors: BTreeMap::new(),
        }
    }
}

/// Exactly the known pedals, each once: board order from `list`, the rest appended unchanged.
fn sanitize_pedals(list: &[PedalState], current: &[PedalState]) -> Vec<PedalState> {
    let mut out: Vec<PedalState> = Vec::with_capacity(8);
    for p in list {
        if PedalKind::from_name(&p.name).is_some() && !out.iter().any(|q| q.name == p.name) {
            out.push(PedalState { name: p.name.clone(), on: p.on, level: if p.level.is_finite() { p.level.clamp(0.0, 100.0) } else { 50.0 } });
        }
    }
    for p in current {
        if !out.iter().any(|q| q.name == p.name) {
            out.push(p.clone());
        }
    }
    out
}

fn settings(pedals: &[PedalState]) -> Vec<PedalSetting> {
    pedals.iter().filter_map(|p| PedalKind::from_name(&p.name).map(|kind| PedalSetting { kind, on: p.on, level: p.level })).collect()
}

impl Session {
    /// Restores a saved session (from `save`), falling back to defaults for anything invalid.
    pub fn load(json: &str) -> Self {
        let mut s: Session = serde_json::from_str(json).unwrap_or_default();
        let d = Session::default();
        s.state.pedals = sanitize_pedals(&s.state.pedals, &d.state.pedals);
        s
    }

    pub fn save(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Commands that bring freshly created working halves in line with the current state.
    pub fn initial(&self) -> Effects {
        let s = &self.state;
        Effects {
            state: None,
            audio: vec![AudioCmd::Pedals { pedals: settings(&s.pedals) }, AudioCmd::Output { on: s.output }],
            listen: vec![ListenCmd::Gate { db: s.gate_db }, ListenCmd::Floor { setting: s.floor }, ListenCmd::Ml { on: s.ml }],
            devices: false,
        }
    }

    pub fn apply(&mut self, msg: &ControlMsg, now_ms: f64) -> Effects {
        let mut fx = Effects::default();
        match msg {
            ControlMsg::Set { state, at } => self.set(state, at.unwrap_or(now_ms), &mut fx),
            ControlMsg::Recalibrate => fx.listen.push(ListenCmd::Recalibrate { explicit: true }),
            ControlMsg::Loop { cmd, slot } => fx.audio.push(AudioCmd::Loop { cmd: *cmd, slot: *slot }),
            ControlMsg::Play { group, notes, lead } => {
                fx.audio.push(AudioCmd::Play { group: *group, notes: notes.clone(), lead: lead.unwrap_or(SYNTH_LEAD).clamp(0.0, 10.0) })
            }
            ControlMsg::Stop { group } => fx.audio.push(AudioCmd::Stop { group: *group }),
            // Per-client, handled by the host.
            ControlMsg::Hello { .. } | ControlMsg::Listen { .. } => {}
        }
        fx
    }

    fn set(&mut self, p: &StatePatch, at: f64, fx: &mut Effects) {
        let before = self.state.clone();
        let s = &mut self.state;
        if let Some(list) = &p.pedals {
            let next = sanitize_pedals(list, &s.pedals);
            if next != s.pedals {
                s.pedals = next;
                fx.audio.push(AudioCmd::Pedals { pedals: settings(&s.pedals) });
            }
        }
        if let Some(on) = p.output {
            if on != s.output {
                s.output = on;
                fx.audio.push(AudioCmd::Output { on });
            }
        }
        if let Some(db) = p.gate_db.filter(|d| d.is_finite()) {
            let db = db.clamp(3.0, 30.0);
            if db != s.gate_db {
                s.gate_db = db;
                fx.listen.push(ListenCmd::Gate { db });
            }
        }
        if let Some(on) = p.ml {
            if on != s.ml {
                s.ml = on;
                fx.listen.push(ListenCmd::Ml { on });
            }
        }
        if let Some(id) = &p.input_id {
            if *id != s.input_id {
                s.input_id = id.clone();
                // Each input keeps its own floor setting.
                s.floor = self.floors.get(id).copied().unwrap_or_default();
                fx.listen.push(ListenCmd::Reset);
                fx.listen.push(ListenCmd::Floor { setting: s.floor });
                fx.audio.push(AudioCmd::Recalibrate);
                fx.devices = true;
            }
        }
        if let Some(f) = p.floor {
            let f = FloorSetting { mode: f.mode, manual_db: if f.manual_db.is_finite() { f.manual_db.clamp(-110.0, -10.0) } else { -70.0 } };
            if f != s.floor {
                s.floor = f;
                fx.listen.push(ListenCmd::Floor { setting: f });
            }
            self.floors.insert(s.input_id.clone(), f);
        }
        if let Some(id) = p.output_id.as_ref().filter(|id| **id != s.output_id) {
            s.output_id = id.clone();
            fx.devices = true;
        }
        if let Some(v) = p.exclusive_input.filter(|v| *v != s.exclusive_input) {
            s.exclusive_input = v;
            fx.devices = true;
        }
        if let Some(v) = p.exclusive_output.filter(|v| *v != s.exclusive_output) {
            s.exclusive_output = v;
            fx.devices = true;
        }
        if self.state != before {
            self.state.rev += 1;
            self.state.edited_at = self.state.edited_at.max(at);
            fx.state = Some(self.state.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::floor::FloorMode;

    fn set(p: StatePatch) -> ControlMsg {
        ControlMsg::Set { state: p, at: None }
    }

    #[test]
    fn changes_produce_state_and_commands_and_no_ops_produce_nothing() {
        let mut s = Session::default();
        let fx = s.apply(&set(StatePatch { output: Some(true), ..Default::default() }), 1000.0);
        assert_eq!(fx.audio, vec![AudioCmd::Output { on: true }]);
        let st = fx.state.unwrap();
        assert_eq!((st.rev, st.edited_at, st.output), (1, 1000.0, true));
        let fx = s.apply(&set(StatePatch { output: Some(true), ..Default::default() }), 2000.0);
        assert_eq!(fx, Effects::default(), "unchanged state is not re-broadcast");
    }

    #[test]
    fn pedals_are_validated_reordered_and_completed() {
        let mut s = Session::default();
        let list = vec![
            PedalState { name: "Delay".into(), on: true, level: 140.0 },
            PedalState { name: "Bogus".into(), on: true, level: 10.0 },
            PedalState { name: "Delay".into(), on: false, level: 10.0 },
        ];
        let fx = s.apply(&set(StatePatch { pedals: Some(list), ..Default::default() }), 0.0);
        let p = &fx.state.unwrap().pedals;
        assert_eq!(p.len(), 8);
        assert_eq!((p[0].name.as_str(), p[0].on, p[0].level), ("Delay", true, 100.0));
        assert_eq!(p[1].name, "Compressor");
    }

    #[test]
    fn floor_settings_are_remembered_per_input_device() {
        let mut s = Session::default();
        let manual = FloorSetting { mode: FloorMode::Manual, manual_db: -55.0 };
        s.apply(&set(StatePatch { input_id: Some("cable".into()), ..Default::default() }), 0.0);
        s.apply(&set(StatePatch { floor: Some(manual), ..Default::default() }), 0.0);
        let fx = s.apply(&set(StatePatch { input_id: Some("mic".into()), ..Default::default() }), 0.0);
        assert_eq!(fx.state.unwrap().floor, FloorSetting::default(), "a new device starts on auto");
        assert!(fx.listen.contains(&ListenCmd::Reset) && fx.devices);
        let fx = s.apply(&set(StatePatch { input_id: Some("cable".into()), ..Default::default() }), 0.0);
        assert_eq!(fx.state.unwrap().floor, manual, "back on the cable, its manual floor returns");
        assert!(fx.listen.contains(&ListenCmd::Floor { setting: manual }));
    }

    #[test]
    fn save_and_load_round_trip() {
        let mut s = Session::default();
        s.apply(&set(StatePatch { gate_db: Some(18.0), input_id: Some("x".into()), ..Default::default() }), 5.0);
        let r = Session::load(&s.save());
        assert_eq!(r, s);
        assert_eq!(Session::load("garbage"), Session::default());
    }

    #[test]
    fn actions_map_to_commands() {
        let mut s = Session::default();
        let fx = s.apply(&ControlMsg::Recalibrate, 0.0);
        assert_eq!(fx.listen, vec![ListenCmd::Recalibrate { explicit: true }]);
        let fx = s.apply(&ControlMsg::Play { group: 2, notes: vec![], lead: None }, 0.0);
        assert_eq!(fx.audio, vec![AudioCmd::Play { group: 2, notes: vec![], lead: SYNTH_LEAD }]);
        assert!(fx.state.is_none());
    }
}
