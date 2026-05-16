//! Codex CLI JSONL parser.
//!
//! Rollout files at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` interleave
//! event/response/meta lines. Token usage shows up on:
//!
//! ```text
//! {"type":"event_msg","timestamp":"...","payload":{"type":"token_count","info":{
//!   "last_token_usage":{
//!     "input_tokens":13377,
//!     "cached_input_tokens":11136,
//!     "output_tokens":9,
//!     "reasoning_output_tokens":0,
//!     "total_tokens":13386},
//!   ...
//! }}}
//! ```
//!
//! Some `token_count` lines have `info: null` (initial heartbeat). Those are
//! skipped. We use the file's byte offset (tracked in `watch_state`) for
//! dedup since Codex events have no stable per-message id.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::db::TokenEvent;

pub const PROVIDER: &str = "codex_cli";

#[derive(Debug, Deserialize)]
struct Envelope<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    timestamp: Option<&'a str>,
    payload: Option<PayloadRaw>,
}

#[derive(Debug, Deserialize)]
struct PayloadRaw {
    #[serde(rename = "type")]
    kind: Option<String>,
    info: Option<InfoRaw>,
}

#[derive(Debug, Deserialize)]
struct InfoRaw {
    last_token_usage: Option<UsageRaw>,
}

#[derive(Debug, Deserialize)]
struct UsageRaw {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    reasoning_output_tokens: u64,
}

pub fn parse_line(line: &str, source_file: &str) -> Option<TokenEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let envelope: Envelope = serde_json::from_str(trimmed).ok()?;
    if envelope.kind != Some("event_msg") {
        return None;
    }
    let payload = envelope.payload?;
    if payload.kind.as_deref() != Some("token_count") {
        return None;
    }
    let info = payload.info?;
    let usage = info.last_token_usage?;

    let total = usage.input_tokens
        + usage.output_tokens
        + usage.cached_input_tokens
        + usage.reasoning_output_tokens;
    if total == 0 {
        return None;
    }

    let timestamp = envelope
        .timestamp
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Some(TokenEvent {
        id: None,
        provider: PROVIDER.to_string(),
        model: None,
        message_id: None,
        input_tokens: usage.input_tokens,
        // Reasoning tokens count as output for our display purposes.
        output_tokens: usage.output_tokens + usage.reasoning_output_tokens,
        cache_read: usage.cached_input_tokens,
        cache_write: 0,
        timestamp,
        session_id: None,
        source_file: Some(source_file.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_non_token_count_lines() {
        assert!(parse_line(r#"{"type":"session_meta"}"#, "x.jsonl").is_none());
        assert!(parse_line(r#"{"type":"response_item"}"#, "x.jsonl").is_none());
        assert!(parse_line("", "x.jsonl").is_none());
    }

    #[test]
    fn ignores_token_count_with_null_info() {
        let line = r#"{"type":"event_msg","timestamp":"2026-05-16T18:43:36.005Z","payload":{"type":"token_count","info":null}}"#;
        assert!(parse_line(line, "x.jsonl").is_none());
    }

    #[test]
    fn parses_full_token_count() {
        let line = r#"{
            "type":"event_msg",
            "timestamp":"2026-05-16T18:43:37.682Z",
            "payload":{
                "type":"token_count",
                "info":{
                    "last_token_usage":{
                        "input_tokens":13377,
                        "cached_input_tokens":11136,
                        "output_tokens":9,
                        "reasoning_output_tokens":2,
                        "total_tokens":13388
                    }
                }
            }
        }"#;
        let ev = parse_line(line, "rollout.jsonl").expect("should parse");
        assert_eq!(ev.provider, PROVIDER);
        assert_eq!(ev.input_tokens, 13377);
        assert_eq!(ev.output_tokens, 11); // 9 + 2 reasoning
        assert_eq!(ev.cache_read, 11136);
        assert_eq!(ev.cache_write, 0);
        assert!(ev.message_id.is_none());
        assert_eq!(ev.source_file.as_deref(), Some("rollout.jsonl"));
    }

    #[test]
    fn skips_all_zero_usage() {
        let line = r#"{
            "type":"event_msg",
            "payload":{
                "type":"token_count",
                "info":{
                    "last_token_usage":{"input_tokens":0,"output_tokens":0}
                }
            }
        }"#;
        assert!(parse_line(line, "x.jsonl").is_none());
    }
}
