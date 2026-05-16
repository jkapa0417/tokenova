//! Codex view helpers.
//!
//! The mutation side (recording discoveries) lives in `Db::codex_record_discovery`
//! and is invoked from `planets::discover_for_session`. This module is the
//! read-side: build a frontend-friendly payload grouping every catalog entry
//! by rarity, with discovery counts and "undiscovered" placeholders.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::db::Db;
use crate::engine::catalog::{self, PlanetSpec};
use crate::engine::types::{CodexEntry, Rarity};

#[derive(Debug, Clone, Serialize)]
pub struct CodexCard {
    pub key: &'static str,
    pub display_name: &'static str,
    pub rarity: Rarity,
    pub discovered: bool,
    pub discovery_count: u32,
    pub first_discovered_at: Option<DateTime<Utc>>,
    pub last_discovered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexGroup {
    pub rarity: Rarity,
    pub total: usize,
    pub discovered: usize,
    pub cards: Vec<CodexCard>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexPayload {
    pub groups: Vec<CodexGroup>,
    pub total_count: usize,
    pub discovered_count: usize,
}

pub fn build_payload(db: &Arc<Db>) -> Result<CodexPayload> {
    let entries: HashMap<String, CodexEntry> = db
        .list_codex_entries()?
        .into_iter()
        .map(|e| (e.planet_type.clone(), e))
        .collect();

    let mut groups: Vec<CodexGroup> = [
        Rarity::Common,
        Rarity::Rare,
        Rarity::Epic,
        Rarity::Legendary,
        Rarity::Mythic,
    ]
    .into_iter()
    .map(|r| build_group(r, &entries))
    .collect();

    let total_count = groups.iter().map(|g| g.total).sum();
    let discovered_count = groups.iter().map(|g| g.discovered).sum();

    // Sort discovered cards within a group so newly found planets surface first.
    for g in &mut groups {
        g.cards.sort_by(|a, b| match (a.discovered, b.discovered) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.last_discovered_at.cmp(&a.last_discovered_at),
        });
    }

    Ok(CodexPayload {
        groups,
        total_count,
        discovered_count,
    })
}

fn build_group(rarity: Rarity, entries: &HashMap<String, CodexEntry>) -> CodexGroup {
    let specs: &[PlanetSpec] = catalog::planets_of(rarity);
    let mut discovered = 0;
    let cards = specs
        .iter()
        .map(|spec| {
            let card = match entries.get(spec.key) {
                Some(e) if e.discovery_count > 0 => {
                    discovered += 1;
                    CodexCard {
                        key: spec.key,
                        display_name: spec.display_name,
                        rarity,
                        discovered: true,
                        discovery_count: e.discovery_count,
                        first_discovered_at: e.first_discovered_at,
                        last_discovered_at: e.last_discovered_at,
                    }
                }
                _ => CodexCard {
                    key: spec.key,
                    display_name: spec.display_name,
                    rarity,
                    discovered: false,
                    discovery_count: 0,
                    first_discovered_at: None,
                    last_discovered_at: None,
                },
            };
            card
        })
        .collect();

    CodexGroup {
        rarity,
        total: specs.len(),
        discovered,
        cards,
    }
}
