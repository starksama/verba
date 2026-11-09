//! Spots a user correcting a term inside text Verba just inserted, so the
//! corrected spelling can be offered for the shared vocabulary.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Correction {
    /// What Verba inserted.
    pub original: String,
    /// What the user changed it to.
    pub term: String,
}

const MAX_CHANGED_CHARS: usize = 60;
const MAX_CJK_TERM_CHARS: usize = 12;
const MAX_TERM_WORDS: usize = 4;

/// Char range `[start, end)` of `inserted` inside `field`, preferring the last match.
pub fn find_inserted_region(field: &str, inserted: &str) -> Option<(usize, usize)> {
    let inserted = inserted.trim();
    if inserted.is_empty() {
        return None;
    }
    let byte_start = field.rfind(inserted)?;
    let start = field[..byte_start].chars().count();
    Some((start, start + inserted.chars().count()))
}

/// The term fix the user made between `baseline` (right after insertion) and
/// `current`, if the change sits inside the inserted region and looks like a
/// corrected name or term rather than ordinary editing.
pub fn detect_term_correction(
    baseline: &str,
    current: &str,
    inserted_region: (usize, usize),
    vocabulary: &[String],
) -> Option<Correction> {
    let before: Vec<char> = baseline.chars().collect();
    let after: Vec<char> = current.chars().collect();
    let prefix = before.iter().zip(&after).take_while(|(a, b)| a == b).count();
    let max_suffix = before.len().min(after.len()) - prefix;
    let suffix = before
        .iter()
        .rev()
        .zip(after.iter().rev())
        .take(max_suffix)
        .take_while(|(a, b)| a == b)
        .count();
    let deleted_end = before.len() - suffix;
    let added_end = after.len() - suffix;
    if prefix >= deleted_end || prefix >= added_end {
        return None; // pure insertion or deletion, not a replacement
    }
    if deleted_end - prefix > MAX_CHANGED_CHARS || added_end - prefix > MAX_CHANGED_CHARS {
        return None;
    }
    let (region_start, region_end) = inserted_region;
    if prefix >= region_end || deleted_end <= region_start {
        return None;
    }

    let original = expand_to_word(&before, prefix, deleted_end);
    let term = expand_to_word(&after, prefix, added_end);
    if term.chars().count() < 2
        || !term.chars().any(char::is_alphanumeric)
        || term.split_whitespace().count() > MAX_TERM_WORDS
        || original.is_empty()
        || term == original
        || vocabulary.iter().any(|known| known.trim().eq_ignore_ascii_case(&term))
    {
        return None;
    }

    let looks_like_term_fix = if is_latin(&term) && is_latin(&original) {
        let (a, b) = (original.to_lowercase(), term.to_lowercase());
        a == b || {
            let longest = a.chars().count().max(b.chars().count()) as f64;
            levenshtein(&a, &b) as f64 / longest <= 0.6
        }
    } else {
        let (a, b) = (original.chars().count(), term.chars().count());
        a <= MAX_CJK_TERM_CHARS && b <= MAX_CJK_TERM_CHARS && b * 3 >= a && a * 3 >= b
    };
    looks_like_term_fix.then_some(Correction { original, term })
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

fn is_latin(text: &str) -> bool {
    !text.chars().any(is_cjk)
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() && !is_cjk(ch) || ch == '-' || ch == '_'
}

/// Widens `[start, end)` to whole Latin words (keeping dots between letters, as in
/// "Node.js") and trims surrounding whitespace and punctuation.
fn expand_to_word(chars: &[char], mut start: usize, mut end: usize) -> String {
    let joins = |i: usize| {
        chars[i] == '.'
            && i > 0
            && i + 1 < chars.len()
            && is_word_char(chars[i - 1])
            && is_word_char(chars[i + 1])
    };
    if chars[start..end].iter().any(|ch| !ch.is_whitespace()) {
        while start > 0 && (is_word_char(chars[start - 1]) || joins(start - 1)) && !is_cjk(chars[start]) {
            start -= 1;
        }
        while end < chars.len() && (is_word_char(chars[end]) || joins(end)) && !is_cjk(chars[end - 1]) {
            end += 1;
        }
    }
    chars[start..end]
        .iter()
        .collect::<String>()
        .trim_matches(|ch: char| ch.is_whitespace() || (!ch.is_alphanumeric() && ch != '-' && ch != '_'))
        .to_string()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let current = row[j + 1];
            row[j + 1] = (previous + usize::from(ca != cb)).min(row[j] + 1).min(current + 1);
            previous = current;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn correction(baseline: &str, inserted: &str, current: &str) -> Option<Correction> {
        let region = find_inserted_region(baseline, inserted).expect("inserted text is in the field");
        detect_term_correction(baseline, current, region, &[])
    }

    #[test]
    fn a_misheard_brand_corrected_by_the_user_is_suggested() {
        let inserted = "We deployed the new Versel vaults today.";
        let found = correction(inserted, inserted, "We deployed the new Vercel vaults today.").unwrap();
        assert_eq!(found.term, "Vercel");
        assert_eq!(found.original, "Versel");
    }

    #[test]
    fn a_chinese_transliteration_corrected_to_the_real_name_is_suggested() {
        let inserted = "我們今天用維賽爾的協議";
        let found = correction(inserted, inserted, "我們今天用Vercel的協議").unwrap();
        assert_eq!(found.term, "Vercel");
    }

    #[test]
    fn rewriting_a_sentence_is_not_a_term_fix() {
        let inserted = "We should meet tomorrow at noon.";
        assert_eq!(correction(inserted, inserted, "Let's skip the meeting entirely."), None);
    }

    #[test]
    fn edits_outside_the_inserted_text_are_ignored() {
        let baseline = "Hi Versel team, thanks for the update";
        assert_eq!(correction(baseline, "thanks for the update", "Hi Vercel team, thanks for the update"), None);
    }

    #[test]
    fn terms_already_in_the_vocabulary_are_not_suggested_again() {
        let inserted = "Ship the Versel release";
        let region = find_inserted_region(inserted, inserted).unwrap();
        let vocabulary = vec!["Vercel".to_string()];
        assert_eq!(detect_term_correction(inserted, "Ship the Vercel release", region, &vocabulary), None);
    }

    #[test]
    fn typing_more_text_is_not_a_correction() {
        let inserted = "Send the report";
        assert_eq!(correction(inserted, inserted, "Send the report to Anna today"), None);
    }
}
