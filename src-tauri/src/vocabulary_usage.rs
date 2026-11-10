//! How often each vocabulary term actually shows up in the user's text, so the
//! short transcription prompt carries the terms they really say. Polishing and
//! rewrites still get the full list; this only decides who fits in the prompt.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TermUsage {
    pub count: u64,
    pub last_used_ms: u64,
}

/// Keyed by the term exactly as it is written in the vocabulary.
pub type Usage = HashMap<String, TermUsage>;

fn has_cjk(text: &str) -> bool {
    text.chars().any(|ch| matches!(ch as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF))
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() && !has_cjk(ch.encode_utf8(&mut [0; 4]))
}

/// Case-insensitive mentions of `term` in `text`. Latin terms must stand as whole
/// words ("Go" is not counted inside "Google"); CJK terms match anywhere, since
/// CJK text has no spaces between words.
pub fn count_mentions(text: &str, term: &str) -> u64 {
    let term = term.trim().to_lowercase();
    if term.is_empty() {
        return 0;
    }
    let text = text.to_lowercase();
    let whole_word = !has_cjk(&term);
    let mut count = 0;
    let mut from = 0;
    while let Some(offset) = text[from..].find(&term) {
        let start = from + offset;
        let end = start + term.len();
        let bounded = !whole_word
            || (text[..start].chars().next_back().map_or(true, |ch| !is_word_char(ch))
                && text[end..].chars().next().map_or(true, |ch| !is_word_char(ch)));
        if bounded {
            count += 1;
        }
        from = end;
    }
    count
}

/// Adds the mentions in `text` and forgets terms no longer in the vocabulary.
/// Returns whether anything changed, so callers only persist real updates.
pub fn record(usage: &mut Usage, terms: &[String], text: &str, now_ms: u64) -> bool {
    let before = usage.len();
    usage.retain(|term, _| terms.contains(term));
    let mut changed = usage.len() != before;
    for term in terms {
        let mentions = count_mentions(text, term);
        if mentions > 0 {
            let entry = usage.entry(term.clone()).or_default();
            entry.count += mentions;
            entry.last_used_ms = now_ms;
            changed = true;
        }
    }
    changed
}

/// Most used first, then most recently used. Terms never seen yet keep their
/// place newest-first, so a word the user just added gets the next free slot.
pub fn rank(terms: &[String], usage: &Usage) -> Vec<String> {
    let mut ranked: Vec<(usize, &String)> = terms.iter().enumerate().collect();
    ranked.sort_by(|(a_index, a), (b_index, b)| {
        let a_usage = usage.get(*a).copied().unwrap_or_default();
        let b_usage = usage.get(*b).copied().unwrap_or_default();
        b_usage.count.cmp(&a_usage.count)
            .then(b_usage.last_used_ms.cmp(&a_usage.last_used_ms))
            .then(b_index.cmp(a_index))
    });
    ranked.into_iter().map(|(_, term)| term.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|term| term.to_string()).collect()
    }

    #[test]
    fn mentions_count_whole_words_regardless_of_case() {
        assert_eq!(count_mentions("Ship Kubernetes today, kubernetes rocks", "Kubernetes"), 2);
        assert_eq!(count_mentions("I use Google daily", "Go"), 0);
    }

    #[test]
    fn chinese_terms_count_without_spaces() {
        assert_eq!(count_mentions("我們用台積電的晶片，台積電很強", "台積電"), 2);
    }

    #[test]
    fn the_terms_said_most_lead_the_ranking() {
        let vocabulary = terms(&["Vercel", "Figma", "Linear"]);
        let mut usage = Usage::new();
        record(&mut usage, &vocabulary, "Linear and Linear again", 1);
        record(&mut usage, &vocabulary, "Open Figma", 2);
        assert_eq!(rank(&vocabulary, &usage), terms(&["Linear", "Figma", "Vercel"]));
    }

    #[test]
    fn unused_terms_put_the_newest_first() {
        let vocabulary = terms(&["Older", "Newer"]);
        assert_eq!(rank(&vocabulary, &Usage::new()), terms(&["Newer", "Older"]));
    }

    #[test]
    fn removed_terms_are_forgotten() {
        let mut usage = Usage::new();
        record(&mut usage, &terms(&["Vercel"]), "Vercel", 1);
        record(&mut usage, &terms(&["Figma"]), "nothing here", 2);
        assert!(!usage.contains_key("Vercel"));
    }
}
