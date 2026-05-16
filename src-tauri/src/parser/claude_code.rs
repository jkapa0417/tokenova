//! Claude Code JSONL parser.
//!
//! Each JSONL file under `~/.claude/projects/<encoded-path>/<uuid>.jsonl`
//! is one conversation. Lines come in many shapes; only `type == "assistant"`
//! lines carry a `message.usage` block with token counts that we record.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::db::TokenEvent;

pub const PROVIDER: &str = "claude_code";

#[derive(Debug, Deserialize)]
struct Envelope<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    timestamp: Option<&'a str>,
    message: Option<MessageRaw<'a>>,
}

#[derive(Debug, Deserialize)]
struct MessageRaw<'a> {
    id: Option<&'a str>,
    model: Option<&'a str>,
    role: Option<&'a str>,
    usage: Option<UsageRaw>,
}

#[derive(Debug, Deserialize)]
struct UsageRaw {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

/// Parse a single JSONL line. Returns `Some(event)` only for assistant lines
/// that carry usage data. Non-token-bearing lines (user, system, tool_use,
/// permission-mode, file-history-snapshot, …) yield `None`.
pub fn parse_line(line: &str, source_file: &str) -> Option<TokenEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let envelope: Envelope = serde_json::from_str(trimmed).ok()?;

    if envelope.kind != Some("assistant") {
        return None;
    }

    let message = envelope.message?;
    if message.role.is_some() && message.role != Some("assistant") {
        return None;
    }
    let usage = message.usage?;

    // Skip empty rows even if they parse — usage with all zeros is meaningless.
    let total = usage.input_tokens
        + usage.output_tokens
        + usage.cache_creation_input_tokens
        + usage.cache_read_input_tokens;
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
        model: message.model.map(|s| s.to_string()),
        message_id: message.id.map(|s| s.to_string()),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens,
        cache_write: usage.cache_creation_input_tokens,
        timestamp,
        session_id: None,
        source_file: Some(source_file.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_non_assistant_lines() {
        assert!(parse_line(r#"{"type": "user"}"#, "x.jsonl").is_none());
        assert!(parse_line(r#"{"type": "permission-mode"}"#, "x.jsonl").is_none());
        assert!(parse_line("", "x.jsonl").is_none());
        assert!(parse_line("   ", "x.jsonl").is_none());
    }

    #[test]
    fn ignores_malformed_json() {
        assert!(parse_line("not json", "x.jsonl").is_none());
        assert!(parse_line("{broken", "x.jsonl").is_none());
    }

    #[test]
    fn ignores_assistant_without_usage() {
        let line = r#"{"type":"assistant","message":{"id":"msg_x","model":"claude-opus","role":"assistant","content":[]}}"#;
        assert!(parse_line(line, "x.jsonl").is_none());
    }

    #[test]
    fn parses_full_usage_block() {
        let line = r#"{
            "type":"assistant",
            "timestamp":"2026-04-27T13:37:40.972Z",
            "message":{
                "id":"msg_019aLFWVD3SmfxV4PEXhqwma",
                "model":"claude-opus-4-7",
                "role":"assistant",
                "usage":{
                    "input_tokens":6,
                    "output_tokens":288,
                    "cache_creation_input_tokens":61063,
                    "cache_read_input_tokens":15607
                }
            }
        }"#;
        let ev = parse_line(line, "conv.jsonl").expect("should parse");
        assert_eq!(ev.provider, PROVIDER);
        assert_eq!(
            ev.message_id.as_deref(),
            Some("msg_019aLFWVD3SmfxV4PEXhqwma")
        );
        assert_eq!(ev.model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(ev.input_tokens, 6);
        assert_eq!(ev.output_tokens, 288);
        assert_eq!(ev.cache_write, 61063);
        assert_eq!(ev.cache_read, 15607);
        assert_eq!(ev.total(), 6 + 288 + 61063 + 15607);
        assert_eq!(ev.source_file.as_deref(), Some("conv.jsonl"));
    }

    #[test]
    fn handles_missing_optional_fields() {
        // Old/partial entry: no model, no message id, fewer cache fields.
        let line = r#"{
            "type":"assistant",
            "message":{
                "usage":{"output_tokens":42}
            }
        }"#;
        let ev = parse_line(line, "x.jsonl").expect("should parse with just output_tokens");
        assert_eq!(ev.output_tokens, 42);
        assert_eq!(ev.input_tokens, 0);
        assert!(ev.message_id.is_none());
        assert!(ev.model.is_none());
    }
}
