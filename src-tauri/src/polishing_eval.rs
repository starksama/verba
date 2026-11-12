//! Opt-in evaluation of the real request builder and output validation using
//! synthetic dictation only. Set VERBA_POLISHING_EVAL_SETTINGS to a settings
//! file, then run `cargo test live_polishing_preferences -- --ignored --nocapture`.
use super::{format_transcript, PolishingOptions, Settings};

#[test]
#[ignore = "uses the configured polishing API; requires explicit opt-in"]
fn live_polishing_preferences() {
    let path = std::env::var("VERBA_POLISHING_EVAL_SETTINGS")
        .expect("set VERBA_POLISHING_EVAL_SETTINGS to a local settings file");
    let mut settings: Settings = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    settings.prompt_template = Settings::default().prompt_template;
    let client = reqwest::Client::new();
    let cases = [
        (
            "Chinese fillers and repeated ideas",
            PolishingOptions::default(),
            "呃... 嗯... ohh... 我們明天下午3點跟Mei開會，就是我們明天下午3點跟Mei開會。然後預算是5000元，不能超過5000元。我想可能需要改期，但還沒確定。",
            vec!["3", "Mei", "5000", "不能", "可能", "確定"],
            vec!["呃", "嗯", "ohh", "我们"],
        ),
        (
            "Heavy English consolidation",
            PolishingOptions::default(),
            "umm hmm ohh umm hmm ohh we need to send the report we need to send the report to Mei by Friday by Friday I think umm hmm ohh umm hmm ohh",
            vec!["Mei", "Friday", "think", "report"],
            vec!["umm", "hmm", "ohh"],
        ),
        (
            "Preserve negation and uncertainty",
            PolishingOptions::default(),
            "umm I think we should not send the report to Mei before Friday I think we should not send the report to Mei before Friday and we may need 3 copies but that is not confirmed",
            vec!["think", "not", "Mei", "Friday", "may", "copies", "confirmed"],
            vec!["umm"],
        ),
        (
            "Resolve self-correction",
            PolishingOptions::default(),
            "um send the deck to Mei on Thursday sorry I meant Friday and cc Florian",
            vec!["deck", "Mei", "Friday", "Florian"],
            vec!["Thursday", "sorry", "meant"],
        ),
        (
            "Drop the like tic but keep the verb",
            PolishingOptions::default(),
            "so I like the new design but we should like ship it like this week",
            vec!["like the new design", "ship", "this week"],
            vec!["should like", "like this week"],
        ),
        (
            "Disable all three options",
            PolishingOptions { remove_fillers: false, consolidate: false, structure: false },
            "umm hmm please send the report please send the report first open settings then save",
            vec!["um", "hmm", "first", "then"],
            vec!["\n- ", "\n1. "],
        ),
        (
            "Keep fillers while consolidating",
            PolishingOptions { remove_fillers: false, ..Default::default() },
            "umm we need to send the report we need to send the report to Mei by Friday hmm",
            vec!["um", "hmm", "Mei", "Friday"],
            vec![],
        ),
        (
            "Remove fillers without consolidation",
            PolishingOptions { consolidate: false, structure: false, ..Default::default() },
            "umm please send the report please send the report hmm",
            vec!["report"],
            vec!["umm", "hmm"],
        ),
        (
            "Disable layout changes",
            PolishingOptions { structure: false, ..Default::default() },
            "umm first open settings then enable polishing finally save the settings hmm",
            vec!["settings", "polishing"],
            vec!["\n", "umm", "hmm"],
        ),
        (
            "Ordered steps",
            PolishingOptions::default(),
            "umm first open settings then enable polishing finally save the settings hmm",
            vec!["1. ", "\n2. ", "\n3. "],
            vec!["umm", "hmm"],
        ),
        (
            "Preserve literal words, code, and URLs",
            PolishingOptions::default(),
            "The label is \"hmm\". Oh no, do not rename it. Run git status --short and open https://example.com/a?q=1",
            vec!["hmm", "Oh no", "not", "git status --short", "https://example.com/a?q=1"],
            vec!["`"],
        ),
        (
            "Only hesitation sounds",
            PolishingOptions::default(),
            "umm, hmm, ohh, 呃…",
            vec![],
            vec![],
        ),
    ];

    let mut failures = Vec::new();
    tauri::async_runtime::block_on(async {
        for (name, options, input, required, forbidden) in cases {
            settings.polishing = options;
            let result = format_transcript(&client, &settings, input, None, None)
                .await
                .expect("polishing request failed");
            println!(
                "{name}: {:?} (fallback={})",
                result.text, result.used_raw_fallback
            );
            let lower = result.text.to_lowercase();
            let preserves_repeats = !name.contains("without consolidation")
                && !name.contains("Disable all")
                || lower.matches("please send the report").count() == 2;
            let merges_repeats =
                !name.contains("Heavy English") || lower.matches("report").count() == 1;
            let preserves_quantity = name != "Preserve negation and uncertainty"
                || lower.contains('3')
                || lower.contains("three");
            if result.used_raw_fallback
                || required
                    .iter()
                    .any(|word| !lower.contains(&word.to_lowercase()))
                || forbidden
                    .iter()
                    .any(|word| lower.contains(&word.to_lowercase()))
                || !preserves_repeats
                || !merges_repeats
                || !preserves_quantity
                || (name == "Only hesitation sounds" && !result.text.is_empty())
            {
                failures.push(name);
            }
        }
        settings.polishing = PolishingOptions::default();
        settings.prompt_template = "Write all Latin letters in UPPERCASE.".into();
        let custom = format_transcript(
            &client,
            &settings,
            "umm please send the report please send the report hmm",
            None,
            None,
        )
        .await
        .expect("custom instructions request failed");
        println!(
            "Custom instructions: {:?} (fallback={})",
            custom.text, custom.used_raw_fallback
        );
        if custom.used_raw_fallback || custom.text != "PLEASE SEND THE REPORT." {
            failures.push("Custom instructions");
        }
    });
    assert!(failures.is_empty(), "Failed cases: {failures:?}");
}
