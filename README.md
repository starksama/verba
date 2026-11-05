<p align="center">
  <img src="img/app-icon.png" alt="verba icon" width="96" height="96">
</p>

<h1 align="center">verba</h1>

Verba is a macOS desktop dictation app. Press a shortcut, speak, and insert the transcript back into the app you were using.

## Run Locally

Requirements:

- macOS
- Node.js 20+
- Rust 1.83+
- Yarn 1.x

Install dependencies:

```bash
yarn install
```

Start the dev app:

```bash
yarn tauri:dev
```

This runs **Verba Dev** (`com.verba.desktop.dev`). Its settings, transcripts, drafts, and
interface preferences are separate from **Verba** (`com.verba.desktop`).
`yarn tauri dev` uses the same development profile.

## Build

Create the macOS app and DMG:

```bash
yarn tauri:build
```

The DMG is written to:

```text
src-tauri/target.noindex/release/bundle/dmg/
```

Build output lives in `target.noindex` so Spotlight does not show it as another installed app.
Keep the everyday app at `/Applications/Verba.app`. Before the first local macOS build, run
`npm run setup:macos-signing` once. It creates **Verba Local Development** in your login
keychain and keeps the same certificate on subsequent runs. Allow macOS's keychain prompt
for `codesign` when signing the first build. Do not delete or recreate this certificate on updates.
For public distribution, set `APPLE_SIGNING_IDENTITY` to your Apple Developer ID identity;
the local certificate is for your own builds.
`npm run test:signing` verifies that two different builds retain the same identity and that
the installer rejects an ad-hoc signature or an unrelated identity.

To update locally, quit Verba and run:

```bash
yarn install:macos
```

For a standalone development app that opens without a development server:

```bash
yarn tauri:build:dev
yarn install:macos:dev
```

This installs `/Applications/Verba Dev.app`. Each install replaces its own app and keeps
the previous bundle in `target.noindex/installed-backups`. Neither install changes app data.
The two apps need different dictation shortcuts to run together; otherwise quit one before
using the other's shortcuts. Saved shortcuts are never substituted automatically.

Closing the workspace keeps dictation running. Open Verba again from Applications, the Dock,
or the menu bar to restore it. Use Quit to exit completely. Each app allows one running instance.

## Permissions

Verba needs:

- Microphone, to record speech
- Accessibility, to insert text into other apps

In dev mode, macOS grants these permissions to the terminal app running `yarn tauri:dev`, such as Warp or Terminal.
The installed Verba and Verba Dev bundles have separate macOS permission entries.
Local builds use a persistent certificate instead of ad-hoc signing, whose identity changes
with each rebuild. Installing over an older ad-hoc build may need one new authorization;
subsequent builds retain the same identity. The installer checks signing continuity and refuses
temporary signatures or an unexpected signer change. It never resets your permissions.

Permission status is checked again when returning to Verba. Both Accessibility trust and
permission to post keyboard events must be available before it shows Enabled. Development
mode also checks actual access instead of assuming the terminal is authorized.
Operational events (permission transitions, recording start/stop reasons, and shortcut state)
are retained in macOS Console under subsystem `com.verba`, without recording transcript or
clipboard contents. These events do not interrupt recording when text insertion access changes.

### Recording controls and recovery

The small dark indicator follows the focused window without taking keyboard focus. Use ✓ to finish and transcribe, or × / Esc to interrupt. The interrupted indicator asks whether to Save or Discard. Save keeps audio for later transcription; Discard marks it discarded but leaves it recoverable in **History → Saved audio**. Audio opens the WAV in Finder. **Reprocess** transcribes and polishes any saved recording again with current settings, including previously successful recordings. Results go into History without pasting into another app; a failed attempt keeps the previous transcript.

Uploads use lossless FLAC encoded in Rust. The original WAV, sample rate, and channels are preserved. Each upload is checked against a 24 MB budget; longer or poorly compressing recordings are split near quiet sections and transcribed in order. Encoding memory is bounded, temporary upload files are removed after processing, and each transcription request has a three-minute timeout. Failures keep the floating indicator visible with **History** and **Dismiss** actions; History opens the saved audio with **Reprocess**, and technical error details stay collapsed.

Audio is written directly to the app's persistent `failed-recordings` directory (the existing directory name is kept for compatibility). A background writer updates and syncs the WAV after each audio buffer; normal stop and Quit drain queued buffers. Startup repairs incomplete WAV lengths and recovers interrupted recordings. Raw and final transcripts are saved before inserting text, and audio is retained after success or failure. A forced termination or hardware/storage failure can still lose samples that have not yet reached disk; this is crash recovery, not an absolute hardware-level guarantee.

Stable and Dev keep separate recording stores, matching their existing app identities.

### Polishing

**Settings → AI → Polishing** adds punctuation and has three independent options, all on by default:

- **Remove fillers** removes empty hesitation sounds (such as “umm,” “hmm,” “ohh,”「呃」) and verbal padding while retaining meaningful reactions, quotations, and uncertainty.
- **Consolidate wording** combines repeated ideas, cleans up restarts, and tightens rambling sentences while preserving distinct details, constraints, names, numbers, and negations.
- **Paragraphs and lists** separates topics, makes enumerated points into bullets, and makes ordered steps into numbered lists. Short messages stay as prose. Spoken cues such as “new paragraph” or “bullet points” can guide the layout.

**Custom instructions** is inside Polishing. Selected options and meaning preservation take
precedence over conflicting instructions. Punctuation and grammar remain active with Polishing
on, even when its three options are off. Chinese punctuation and the original Chinese script
are preserved; dictated questions are edited, not answered.

Polishing defaults on for new settings. Existing on/off choices are preserved, so enable it
once if it was previously off. **Skip polishing in terminals** still keeps terminal output raw.
Whisper receives punctuation examples; the polishing model handles restructuring in a separate
API call. If that call fails or its output fails validation, Verba keeps the raw transcript.
A filler-only result inserts nothing and leaves History, the clipboard, and any recoverable draft
untouched; its original audio remains available in saved recordings, with the raw transcript
retained in the recording's metadata.
