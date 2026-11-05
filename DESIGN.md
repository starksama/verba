---
name: Verba
description: Calm desktop dictation utility for speech-to-text workflows on macOS.
colors:
  brand-blue: "oklch(54% 0.16 255)"
  brand-mint: "oklch(58% 0.13 166)"
  light-bg: "oklch(96% 0.004 240)"
  light-shell: "oklch(92.5% 0.005 240)"
  light-canvas: "oklch(98.6% 0.003 240)"
  light-panel: "oklch(98% 0.003 240 / 0.96)"
  light-text: "oklch(19% 0.01 240)"
  light-muted: "oklch(51% 0.012 240)"
  dark-bg: "oklch(15.5% 0.006 240)"
  dark-shell: "oklch(18% 0.006 240)"
  dark-canvas: "oklch(22% 0.006 240)"
  dark-panel: "oklch(25% 0.006 240 / 0.96)"
  dark-text: "oklch(94% 0.005 240)"
  dark-muted: "oklch(69% 0.009 240)"
  warning: "oklch(55% 0.112 72)"
  danger: "oklch(52% 0.13 35)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "1.34rem"
    fontWeight: 560
    lineHeight: 1.14
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.58
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 520
    lineHeight: 1.2
    letterSpacing: "0"
rounded:
  sm: "3px"
  md: "5px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-blue}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.light-shell}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: "36px"
  status-pill:
    backgroundColor: "{colors.light-shell}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
    height: "28px"
---

# Design System: Verba

## 1. Overview

**Creative North Star: "Quiet Instrument Panel"**

Verba should feel like a precise desktop utility that stays behind the user's writing flow. The interface is compact, neutral, and operational: one primary action, short state labels, dense controls, and no promotional framing.

Texture comes from disciplined material contrast, fine borders, steady state indicators, and the blue-to-mint identity used only where it communicates action or state. The tray icon is monochrome and icon-only; the app window may use brand color, but the macOS menu bar must remain native and quiet.

**Key Characteristics:**
- Compact desktop density with low-radius surfaces.
- Restrained light and graphite themes with tinted neutrals.
- Blue for primary actions and processing, mint for ready/recording/success.
- Status uses small dots and icon changes, not fake switches or text bars.
- Navigation selection uses one fixed 32px icon cell for hover, focus, and active states.
- Recording feedback is visible in two layers: a tiny non-text desktop indicator while active, and a compact in-app toast/status message when capture fails.

## 2. Colors

The palette is restrained: tinted neutral surfaces carry the app, and the blue/mint identity appears only on actions, focus, recording, copied states, and setup success.

### Primary
- **Signal Blue**: Primary buttons, focus borders, processing state, dirty API-key state, and selected settings controls.
- **Live Mint**: Ready, recording, success, copied feedback, and permission-enabled state.

### Neutral
- **Paper Canvas**: Light mode app canvas and content fields.
- **Soft Shell**: Light mode sidebar, chips, quiet buttons, and grouped controls.
- **Graphite Canvas**: Dark mode main canvas and panels.
- **Graphite Shell**: Dark mode sidebar, trays, and quiet controls.
- **Ink Text**: Main text in light mode.
- **Mist Text**: Main text in dark mode.

### Named Rules

**The Ten Percent Accent Rule.** Brand color must stay rare. If blue or mint dominates a screen, the interface is drifting into decorative AI-tool territory.

**The Native Tray Rule.** macOS tray assets are monochrome template icons. Do not use the colored app icon or a status text title in the menu bar.

## 3. Typography

**Display Font:** System sans stack.
**Body Font:** System sans stack.
**Label/Mono Font:** System sans stack. Do not use monospace for displayed shortcuts.

**Character:** Native, compact, and work-focused. The type should feel like a macOS utility, not a landing page or code editor.

### Hierarchy
- **Title** (560, 1.34rem, 1.14): Current workspace title only.
- **Section title** (550, 1.04rem, 1.2): Panel headings and compact feature titles.
- **Body** (400, 0.82rem, 1.58): Short helper text and transcript previews.
- **Label** (520, 0.72rem, 1.2): Field labels, section labels, and status metadata.
- **Key token** (540, 0.68-0.72rem): Shortcut display, always sans-serif.

### Named Rules

**The No Display Voice Rule.** Do not introduce display fonts, oversized headings, or fluid type. Verba is a compact tool.

## 4. Elevation

Verba is flat by default and layered by tone. Borders and subtle inset contrast define surfaces; shadows are reserved for the main native app frame, modals, and toasts.

### Shadow Vocabulary
- **Soft frame** (`0 18px 42px oklch(18% 0.014 262 / 0.11)` in light mode): Main canvas lift only.
- **Strong modal** (`0 28px 74px oklch(18% 0.014 262 / 0.18)` in light mode): Modal and elevated toast use only.
- **State glow** (`0 0 0 3px ... / 0.12`): Focus and small status dots, never a decorative halo.

### Named Rules

**The Flat-At-Rest Rule.** Controls, nav items, transcript rows, and settings panels must not float. Use borders and tonal changes before shadows.

## 5. Components

### Buttons
- **Shape:** Low-radius rectangle (5px), compact height (34px).
- **Primary:** Solid Signal Blue, used only for the current primary command.
- **Secondary / quiet:** Neutral surface or transparent background with border on hover.
- **Focus:** Blue focus ring with no layout shift.

### Status
- **Style:** Small square dot plus short label inside a compact pill.
- **Ready / recording:** Live Mint dot.
- **Processing:** Signal Blue dot.
- **Issue:** danger dot plus exact next action.
- **Tray:** Monochrome template icon, no text title. Recording changes the icon silhouette.
- **Desktop recording indicator:** Compact, dark 104 × 30px capsule with a subtle light edge and white waveform bars driven by mic level. The transparent, nonactivating panel follows the focused window, including across displays and Spaces. A grey × interrupts; a white ✓ finishes and transcribes. Processing replaces the waveform with a white spinner and disables ✓. Esc interrupts only while recording or transcribing. An interrupted session expands to a compact Save / Discard prompt; both choices preserve the audio, with discarded recordings still recoverable in History. Idle hides the panel. This indicator stays dark across app themes so it remains visible over other apps.
- **No-speech feedback:** Keep a compact in-app error visible after recording ends and show a toast with the next action.

### Shortcuts
- **Style:** Sans-serif key tokens inside compact chips or shortcut controls.
- **Rule:** Show both Hold and Hands-free shortcuts inside the window bounds. Tokens may shrink or wrap before they overflow.

### Navigation
- **Sidebar:** Calm rows with a larger brand mark and a fixed 32px icon cell. Hover, focus, and active states must share the same icon-cell geometry; only color, border, and label weight change.
- **Settings rail:** Compact vertical tabs with a small leading state mark and low-radius active surface.

### Inputs / Fields
- **Style:** Dense label + bordered input on panel-deep background.
- **Focus:** Blue border plus subtle focus ring.
- **Secret values:** API keys show saved/missing state by default and reveal editing only on explicit user action.

### Toggle Controls
- **Style:** Small native-feeling track, 30px by 17px, with a 9px knob.
- **Checked:** Blue-tinted track and accent knob.
- **Container:** Quiet row with border only; no 3D button treatment.

### Transcript Rows
- **Style:** Timeline row with time, text, and one direct copy affordance.
- **Feedback:** Row-level copied state plus a subtle toast, no modal and no duplicate banners.

## 6. Do's and Don'ts

### Do:
- **Do** keep the primary workflow visible: speak, process, insert.
- **Do** use compact spacing, low radius, and short state labels.
- **Do** keep status indicators steady. Mic-level animation may move, but the whole status surface must not blink or re-render.
- **Do** make setup copy name the exact next action for macOS permissions.
- **Do** keep tray status icon-only and monochrome.
- **Do** keep shortcut tokens in the system font, never monospace.
- **Do** make microphone failures visible in-app; never collapse a failed dictation back to "Ready" without feedback.

### Don't:
- **Don't** build promotional SaaS dashboards.
- **Don't** use cute rounded controls, 3D button treatments, glass cards, purple gradients, or decorative texture.
- **Don't** use generic glowing microphone widgets.
- **Don't** add verbose setup tutorials or noisy diagnostics panels to default settings.
- **Don't** show vague errors that say something failed without naming the next action.
- **Don't** let header controls overflow outside the app window.
- **Don't** use a tray title such as Idle, Ready, Recording, or Processing.
