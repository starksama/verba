import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { APP_BRAND } from './app-config';
import '@fontsource-variable/inter';

type RecordingMode = 'hold' | 'toggle';
type TranscriptionLanguage =
  | 'auto'
  | 'en'
  | 'zh'
  | 'zh-CN'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'es'
  | 'fr'
  | 'de';

type PolishingOptions = {
  remove_fillers: boolean;
  consolidate: boolean;
  structure: boolean;
};

type RewritePrompt = {
  id: string;
  name: string;
  hotkey: string;
  prompt: string;
};

type Settings = {
  api_key: string;
  prompt_template: string;
  hold_hotkeys: string[];
  toggle_hotkeys: string[];
  rewrite_prompts: RewritePrompt[];
  whisper_model: string;
  custom_vocabulary: string;
  format_model: string;
  format_enabled: boolean;
  polishing: PolishingOptions;
  skip_formatter_in_terminals: boolean;
  include_clipboard_context: boolean;
  play_sound_cues: boolean;
  api_base_url: string;
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
};

type RuntimeStatus = {
  is_recording: boolean;
  is_processing: boolean;
  interrupted: boolean;
  failure?: { recording_id: string; message: string } | null;
  rewriting?: string | null;
  mic_level: number;
  last_message: string;
};

type AccessibilityPermissionStatus = {
  platform: string;
  is_supported: boolean;
  is_granted: boolean;
  status: string;
  guidance: string;
};

type MicrophonePermissionStatus = AccessibilityPermissionStatus;

type TranscriptHistoryEntry = {
  id: number;
  created_at_ms: number;
  final_output: string;
  recording_mode: string;
  language: TranscriptionLanguage;
  source_app?: string | null;
  source: string;
  processing_latency_ms?: number | null;
  original_text?: string | null;
  prompt_name?: string | null;
};

type VocabularySuggestion = {
  id: string;
  term: string;
  original: string;
  source_app?: string | null;
  created_at_ms: number;
};

type HistoryFilter = 'all' | 'dictation' | 'rewrite';

type SavedRecording = {
  id: string;
  created_at_ms: number;
  status: string;
  source_app: string | null;
  error: string | null;
  transcript: string | null;
  raw_transcript?: string | null;
};

type HistoryDayGroup = {
  key: string;
  label: string;
  entries: TranscriptHistoryEntry[];
};

type WorkspaceTab = 'home' | 'history' | 'rewrite' | 'vocabulary' | 'settings';
type OnboardingStepId = 'welcome' | 'permissions' | 'api' | 'try';
type ShortcutSlot = 'hold' | 'toggle';
const SHORTCUT_SLOTS: readonly ShortcutSlot[] = ['hold', 'toggle'];
type ShortcutField = 'hold_hotkeys' | 'toggle_hotkeys';
const SHORTCUT_FIELDS: Record<ShortcutSlot, ShortcutField> = {
  hold: 'hold_hotkeys',
  toggle: 'toggle_hotkeys'
};
const SHORTCUT_ACTION_LABELS: Record<ShortcutSlot, string> = {
  hold: 'hold to speak',
  toggle: 'hands-free'
};
type ShortcutConfig = Pick<Settings, ShortcutField | 'recording_mode' | 'language'>;
type HotkeyCaptureTarget =
  | { scope: 'settings'; slot: ShortcutSlot; index: number | null }
  | { scope: 'rewrite'; index: number }
  | { scope: 'onboarding' };
type SettingsSection = 'general' | 'shortcuts' | 'ai';
type StatusBannerTone = 'ready' | 'recording' | 'processing' | 'issue';
type AppToastTone = 'success' | 'error';
type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const PLATFORM_LABEL_SOURCE =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
  navigator.platform ||
  navigator.userAgent;
const PLATFORM_IS_MAC = /mac|iphone|ipad|ipod/i.test(PLATFORM_LABEL_SOURCE);

document.body.classList.toggle('platform-mac', PLATFORM_IS_MAC);

const TAURI_RUNTIME_MISSING_MESSAGE = 'Open Verba from the desktop app to use this control.';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function invokeCommand<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error(TAURI_RUNTIME_MISSING_MESSAGE));
  }
  return invoke<T>(command, args);
}

function listenEvent<T>(eventName: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    return Promise.resolve(() => undefined);
  }
  return listen<T>(eventName, handler);
}

function userErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error).replace(/^Error:\s*/, '');
}

const LANGUAGE_LABELS: Record<TranscriptionLanguage, string> = {
  auto: 'Auto',
  en: 'English (en)',
  zh: 'Chinese (Simplified)',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  ja: 'Japanese (ja)',
  ko: 'Korean (ko)',
  es: 'Spanish (es)',
  fr: 'French (fr)',
  de: 'German (de)'
};

const MODIFIER_ALIAS_TO_CANONICAL: Record<string, string> = {
  cmd: 'Cmd',
  command: 'Cmd',
  commandorcontrol: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  commandorctrl: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  cmdorctrl: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  cmdorcontrol: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  option: 'Alt',
  opt: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  super: PLATFORM_IS_MAC ? 'Cmd' : 'Super',
  win: 'Super',
  windows: 'Super',
  meta: PLATFORM_IS_MAC ? 'Cmd' : 'Super'
};

const NON_MODIFIER_ALIAS_TO_CANONICAL: Record<string, string> = {
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  del: 'Delete',
  delete: 'Delete',
  down: 'Down',
  arrowdown: 'Down',
  end: 'End',
  enter: 'Enter',
  equal: '=',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'Left',
  arrowleft: 'Left',
  minus: '-',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  period: '.',
  quote: "'",
  right: 'Right',
  arrowright: 'Right',
  semicolon: ';',
  slash: '/',
  space: 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  return: 'Enter',
  tab: 'Tab',
  up: 'Up',
  arrowup: 'Up'
};

const KNOWN_MODIFIERS = new Set(['Cmd', 'Ctrl', 'Alt', 'Shift', 'Super']);
const MODIFIER_EVENT_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'AltGraph']);
const HOME_RECENT_LIMIT = 5;
const ESTIMATED_TYPING_WPM = 40;
const ESTIMATED_DICTATION_WPM = 130;
const NUMBER_FORMATTER = new Intl.NumberFormat();
type WordSegment = { isWordLike?: boolean };
type WordSegmenterLike = { segment(input: string): Iterable<WordSegment> };
const IntlWithSegmenter = Intl as typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: 'word' }
  ) => WordSegmenterLike;
};
const WORD_SEGMENTER: WordSegmenterLike | null = IntlWithSegmenter.Segmenter
  ? new IntlWithSegmenter.Segmenter(undefined, { granularity: 'word' })
  : null;

const appShellEl = document.querySelector<HTMLElement>('#app-shell')!;
const sidebarToggleBtn = document.querySelector<HTMLButtonElement>('#sidebar-toggle-btn')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const modeStatusTextEl = document.querySelector<HTMLParagraphElement>('#mode-status-text')!;
const voiceBarsEl = document.querySelector<HTMLDivElement>('#voice-bars')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const saveSettingsBtn = document.querySelector<HTMLButtonElement>('#save-settings-btn')!;
const apiKeyControlEl = document.querySelector<HTMLElement>('#api-key-control')!;
const apiKeyEditorEl = document.querySelector<HTMLLabelElement>('#api-key-editor')!;
const apiKeyEditBtn = document.querySelector<HTMLButtonElement>('#api-key-edit-btn')!;
const apiKeySummaryEl = document.querySelector<HTMLSpanElement>('#api-key-summary')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#apiKey')!;
const promptTemplateInput = document.querySelector<HTMLTextAreaElement>('#promptTemplate')!;
const whisperModelInput = document.querySelector<HTMLInputElement>('#whisperModel')!;
const formatModelInput = document.querySelector<HTMLInputElement>('#formatModel')!;
const formatEnabledInput = document.querySelector<HTMLInputElement>('#formatEnabled')!;
const polishingOptionsFieldset = document.querySelector<HTMLFieldSetElement>('#polishingOptions')!;
const removeFillersInput = document.querySelector<HTMLInputElement>('#removeFillers')!;
const consolidateInput = document.querySelector<HTMLInputElement>('#consolidateWording')!;
const structureInput = document.querySelector<HTMLInputElement>('#structureText')!;
const skipFormatterInTerminalsInput = document.querySelector<HTMLInputElement>('#skipFormatterInTerminals')!;
const includeClipboardContextInput = document.querySelector<HTMLInputElement>('#includeClipboardContext')!;
const playSoundCuesInput = document.querySelector<HTMLInputElement>('#playSoundCues')!;
const apiBaseUrlInput = document.querySelector<HTMLInputElement>('#apiBaseUrl')!;
const themeModeInput = document.querySelector<HTMLSelectElement>('#themeMode')!;
const recordingModeInput = document.querySelector<HTMLSelectElement>('#recordingMode')!;
const languageInput = document.querySelector<HTMLSelectElement>('#language')!;
const holdHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#hold-hotkey-validation')!;
const toggleHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#toggle-hotkey-validation')!;
const holdShortcutListEl = document.querySelector<HTMLDivElement>('#hold-shortcut-list')!;
const toggleShortcutListEl = document.querySelector<HTMLDivElement>('#toggle-shortcut-list')!;
const holdShortcutAddBtn = document.querySelector<HTMLButtonElement>('#hold-shortcut-add-btn')!;
const toggleShortcutAddBtn = document.querySelector<HTMLButtonElement>('#toggle-shortcut-add-btn')!;
const rewritePromptListEl = document.querySelector<HTMLDivElement>('#rewrite-prompt-list')!;
const rewriteValidationEl = document.querySelector<HTMLParagraphElement>('#rewrite-validation')!;
const rewritePromptAddBtn = document.querySelector<HTMLButtonElement>('#rewrite-prompt-add-btn')!;
const shortcutDirtyIndicatorEl = document.querySelector<HTMLSpanElement>('#shortcut-dirty-indicator')!;
const homeToggleBtn = document.querySelector<HTMLButtonElement>('#home-toggle-btn')!;
const homeHeroEl = document.querySelector<HTMLElement>('#home-hero')!;
const heroTitleEl = document.querySelector<HTMLParagraphElement>('#hero-title')!;
const homeStatRewrittenEl = document.querySelector<HTMLElement>('#home-stat-rewritten')!;
const homeStatStreakEl = document.querySelector<HTMLElement>('#home-stat-streak')!;
const homeStatStreakUnitEl = document.querySelector<HTMLElement>('#home-stat-streak-unit')!;
const ACTIVITY_DAYS = 14;
const homeActivityChartEl = document.querySelector<HTMLDivElement>('#home-activity-chart')!;
const homeActivitySummaryEl = document.querySelector<HTMLSpanElement>('#home-activity-summary')!;
const homeRewriteListEl = document.querySelector<HTMLDivElement>('#home-rewrite-list')!;
const homeVocabularySummaryEl = document.querySelector<HTMLParagraphElement>('#home-vocabulary-summary')!;
const rewriteEmptyEl = document.querySelector<HTMLParagraphElement>('#rewrite-empty')!;
const rewriteSaveStateEl = document.querySelector<HTMLSpanElement>('#rewrite-save-state')!;
const vocabularyAddForm = document.querySelector<HTMLFormElement>('#vocabulary-add-form')!;
const vocabularyAddInput = document.querySelector<HTMLInputElement>('#vocabulary-add-input')!;
const vocabularySuggestionsEl = document.querySelector<HTMLElement>('#vocabulary-suggestions')!;
const vocabularySuggestionListEl = document.querySelector<HTMLDivElement>('#vocabulary-suggestion-list')!;
const vocabularyListEl = document.querySelector<HTMLDivElement>('#vocabulary-list')!;
const vocabularyEmptyEl = document.querySelector<HTMLParagraphElement>('#vocabulary-empty')!;
const vocabularyCountEl = document.querySelector<HTMLSpanElement>('#vocabulary-count')!;
const vocabularyRewriteLink = document.querySelector<HTMLButtonElement>('#vocabulary-rewrite-link')!;

const vocabularyBadgeEl = document.querySelector<HTMLSpanElement>('#vocabulary-badge')!;
const historyFilterButtons = document.querySelectorAll<HTMLButtonElement>('[data-history-filter]');
const headerActionGroups = document.querySelectorAll<HTMLElement>('[data-header-for]');
const homeStatWordsEl = document.querySelector<HTMLSpanElement>('#home-stat-words')!;
const homeStatSavedEl = document.querySelector<HTMLSpanElement>('#home-stat-saved')!;
const homeRecentEmptyEl = document.querySelector<HTMLParagraphElement>('#home-recent-empty')!;
const HISTORY_EMPTY_TEXT = 'Nothing yet. Dictate or rewrite once and it shows up here.';
const homeRecentFeedEl = document.querySelector<HTMLDivElement>('#home-recent-feed')!;
const shortcutHoldHintEl = document.querySelector<HTMLSpanElement>('#shortcut-hold-hint')!;
const shortcutToggleHintEl = document.querySelector<HTMLSpanElement>('#shortcut-toggle-hint')!;
const statusBannerEl = document.querySelector<HTMLElement>('#status-banner')!;
const sidebarBrandIconEl = document.querySelector<HTMLImageElement>('#sidebar-brand-icon')!;
const sidebarBrandNameEl = document.querySelector<HTMLElement>('#sidebar-brand-name')!;
const workspaceViewTitleEl = document.querySelector<HTMLElement>('#workspace-view-title')!;
const appToastEl = document.querySelector<HTMLDivElement>('#app-toast')!;
const appToastIconEl = document.querySelector<HTMLSpanElement>('#app-toast-icon')!;
const appToastTextEl = document.querySelector<HTMLParagraphElement>('#app-toast-text')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');
const settingsSectionButtons = document.querySelectorAll<HTMLButtonElement>('[data-settings-target]');
const settingsSectionPanels = document.querySelectorAll<HTMLElement>('[data-settings-panel]');
const historyFeedEl = document.querySelector<HTMLDivElement>('#history-feed')!;
const historyEmptyEl = document.querySelector<HTMLParagraphElement>('#history-empty')!;
const historyMoreBtn = document.querySelector<HTMLButtonElement>('#history-more-btn')!;
const historyCountEl = document.querySelector<HTMLElement>('#history-count')!;
const historySearchInput = document.querySelector<HTMLInputElement>('#history-search')!;
const reopenOnboardingBtn = document.querySelector<HTMLButtonElement>('#reopen-onboarding-btn')!;
const onboardingModalEl = document.querySelector<HTMLDivElement>('#onboarding-modal')!;
const onboardingStepIndicatorEl = document.querySelector<HTMLParagraphElement>('#onboarding-step-indicator')!;
const onboardingStepsEls = document.querySelectorAll<HTMLElement>('[data-onboarding-step]');
const onboardingSkipBtn = document.querySelector<HTMLButtonElement>('#onboarding-skip-btn')!;
const onboardingBackBtn = document.querySelector<HTMLButtonElement>('#onboarding-back-btn')!;
const onboardingNextBtn = document.querySelector<HTMLButtonElement>('#onboarding-next-btn')!;
const onboardingFinishBtn = document.querySelector<HTMLButtonElement>('#onboarding-finish-btn')!;
const onboardingTitleEl = document.querySelector<HTMLHeadingElement>('#onboarding-title')!;
const onboardingPermissionsCopyEl = document.querySelector<HTMLParagraphElement>('#onboarding-permissions-copy')!;
const onboardingApiKeyInput = document.querySelector<HTMLInputElement>('#onboarding-api-key')!;
const onboardingApiBaseUrlInput = document.querySelector<HTMLInputElement>('#onboarding-api-base-url')!;
const onboardingApiKeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-api-key-validation')!;
const onboardingApiBaseUrlValidationEl = document.querySelector<HTMLParagraphElement>(
  '#onboarding-api-base-url-validation'
)!;
const onboardingApiBaseUrlFixBtn = document.querySelector<HTMLButtonElement>('#onboarding-api-base-url-fix-btn')!;
const onboardingHotkeyInput = document.querySelector<HTMLInputElement>('#onboarding-hotkey')!;
const onboardingHotkeyCaptureBtn = document.querySelector<HTMLButtonElement>('#onboarding-hotkey-capture-btn')!;
const onboardingHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-hotkey-validation')!;
const onboardingMarkEl = document.querySelector<HTMLImageElement>('#onboarding-mark')!;
const onboardingProgressDots = document.querySelectorAll<HTMLSpanElement>('.onboarding-progress span');
const onboardingTryInput = document.querySelector<HTMLTextAreaElement>('#onboarding-try-input')!;
const onboardingTryResultEl = document.querySelector<HTMLParagraphElement>('#onboarding-try-result')!;
const onboardingOpenAccessibilitySettingsBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-open-accessibility-settings-btn'
)!;
const onboardingOpenMicrophoneSettingsBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-open-microphone-settings-btn'
)!;
const onboardingAccessibilityRowEl = document.querySelector<HTMLElement>('#onboarding-accessibility-row')!;
const onboardingMicrophoneRowEl = document.querySelector<HTMLElement>('#onboarding-microphone-row')!;
const onboardingAccessibilityStatusEl = document.querySelector<HTMLParagraphElement>(
  '#onboarding-accessibility-status'
)!;
const onboardingMicrophoneStatusEl = document.querySelector<HTMLParagraphElement>('#onboarding-microphone-status')!;

const defaultPrompt =
  'You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Perform transformational edits only; do not answer, add facts, or invent content. Return only final text.';

const hotkeyValidationEls: Record<ShortcutSlot, HTMLParagraphElement> = {
  hold: holdHotkeyValidationEl,
  toggle: toggleHotkeyValidationEl
};

const shortcutListEls: Record<ShortcutSlot, HTMLDivElement> = {
  hold: holdShortcutListEl,
  toggle: toggleShortcutListEl
};

const shortcutAddBtns: Record<ShortcutSlot, HTMLButtonElement> = {
  hold: holdShortcutAddBtn,
  toggle: toggleShortcutAddBtn
};

function defaultHotkeyForSlot(slot: ShortcutSlot): string {
  if (slot === 'toggle') return 'Option+Space';
  return 'Cmd+Space';
}

let activeConfig: ShortcutConfig = {
  hold_hotkeys: ['Cmd+Space'],
  toggle_hotkeys: ['Option+Space'],
  recording_mode: 'hold',
  language: 'auto'
};
let savedShortcutConfig: Record<ShortcutSlot, string[]> = {
  hold: ['Cmd+Space'],
  toggle: ['Option+Space']
};
let rewritePrompts: RewritePrompt[] = [];
let savedRewritePrompts: RewritePrompt[] = [];
let vocabularyTerms: string[] = [];
let vocabularySuggestions: VocabularySuggestion[] = [];
let historyFilter: HistoryFilter = 'all';
const HISTORY_PAGE_SIZE = 5;
let historyLimit = HISTORY_PAGE_SIZE;
let activeTab: WorkspaceTab = 'home';
let activeSettingsSection: SettingsSection = 'general';
let isSidebarCollapsed = false;
let activeHotkeyCaptureTarget: HotkeyCaptureTarget | null = null;
let savedApiKey = '';
let apiKeyEditorOpen = false;
const ONBOARDING_COMPLETED_KEY = `${APP_BRAND.storagePrefix}:onboarding-complete:v1`;
const SIDEBAR_COLLAPSED_KEY = `${APP_BRAND.storagePrefix}:sidebar-collapsed:v1`;
const SETTINGS_SECTION_KEY = `${APP_BRAND.storagePrefix}:settings-section:v1`;
const THEME_MODE_KEY = `${APP_BRAND.storagePrefix}:theme-mode:v1`;
const THEME_SYNC_EVENT = 'theme-preference-changed';
const SETTINGS_SECTION_ORDER: SettingsSection[] = ['general', 'shortcuts', 'ai'];
const WORKSPACE_TITLES: Record<WorkspaceTab, string> = {
  home: 'Home',
  history: 'History',
  rewrite: 'Rewrite',
  vocabulary: 'Vocabulary',
  settings: 'Settings'
};
const onboardingStepOrder: OnboardingStepId[] = ['welcome', 'permissions', 'api', 'try'];
// History entries newer than this came from the Try step.
const ONBOARDING_PERMISSION_POLL_MS = 1000;
let onboardingPermissionPollId: number | null = null;
let onboardingTryStartedAt = 0;
const ONBOARDING_TRY_FILL_DELAY_MS = 1500;
let onboardingStepIndex = 0;
let historyEntries: TranscriptHistoryEntry[] = [];
let historySelectedEntryId: number | null = null;
let historyCopiedEntryId: number | null = null;
let shouldScrollHistorySelection = false;
const TOGGLE_PENDING_TIMEOUT_MS = 3000;
const HISTORY_COPY_FEEDBACK_TIMEOUT_MS = 1600;
const APP_TOAST_TIMEOUT_MS = 1600;
const LIVE_INPUT_QUIET_MS = 1400;
const LIVE_INPUT_THRESHOLD = 2;
let lastRuntimeStatus: RuntimeStatus | null = null;
let lastAccessibilityStatus: AccessibilityPermissionStatus | null = null;
let lastMicrophoneStatus: MicrophonePermissionStatus | null = null;
let togglePendingAction: 'starting' | 'stopping' | null = null;
let togglePendingTimeoutId: number | null = null;
let historyCopyFeedbackTimeoutId: number | null = null;
let appToastTimeoutId: number | null = null;
let lastRenderedRuntimeState: Pick<RuntimeStatus, 'is_recording' | 'is_processing' | 'last_message' | 'failure' | 'rewriting'> | null = null;
let appStatusMessage = 'Ready';
let statusMessageSource: 'runtime' | 'ui' = 'runtime';
let quietInputStartedAt: number | null = null;
let liveInputIssueActive = false;
let preOnboardingFocusEl: HTMLElement | null = null;
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_MODE_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return systemThemeQuery.matches ? 'light' : 'dark';
  }
  return preference;
}

function applyThemePreference(preference: ThemePreference): void {
  const resolvedTheme = resolveTheme(preference);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolvedTheme;
  themeModeInput.value = preference;
  if (isTauriRuntime()) {
    void emit(THEME_SYNC_EVENT, { preference, resolvedTheme });
  }
}

function setupThemePreference(): void {
  applyThemePreference(readThemePreference());
  themeModeInput.addEventListener('change', () => {
    const preference = isThemePreference(themeModeInput.value) ? themeModeInput.value : 'system';
    localStorage.setItem(THEME_MODE_KEY, preference);
    applyThemePreference(preference);
  });
  systemThemeQuery.addEventListener('change', () => {
    if (readThemePreference() === 'system') {
      applyThemePreference('system');
    }
  });
}

type PermissionUiState = 'checking' | 'enabled' | 'needs-access' | 'blocked' | 'unsupported';

function permissionUiState(status: AccessibilityPermissionStatus | MicrophonePermissionStatus | null): PermissionUiState {
  if (!status) return 'checking';
  if (!status.is_supported) return 'unsupported';
  if (status.is_granted) return 'enabled';
  if (status.status === 'denied' || status.status === 'restricted') return 'blocked';
  return 'needs-access';
}

function setPermissionUiState(
  element: HTMLElement,
  status: AccessibilityPermissionStatus | MicrophonePermissionStatus | null
): void {
  element.dataset.permissionState = permissionUiState(status);
}

function microphoneGuidance(status: MicrophonePermissionStatus | null): string {
  const appName = APP_BRAND.displayName;
  if (!status) return '';
  if (!status.is_supported) return 'macOS only.';
  if (status.is_granted) return '';
  if (status.status === 'not_determined') {
    return 'Click Request access.';
  }
  if (status.status === 'denied') {
    return `Turn ${appName} on in Microphone.`;
  }
  if (status.status === 'restricted') return 'Blocked by macOS policy.';
  return 'Click Request access.';
}

function isShortcutRelatedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('shortcut') || normalized.includes('hotkey');
}

function focusShortcutSettings(): void {
  setActiveTab('settings');
  setActiveSettingsSection('shortcuts');
}

function setStatusBannerTone(tone: StatusBannerTone): void {
  statusBannerEl.dataset.statusTone = tone;
}

function applyBranding(): void {
  document.title = APP_BRAND.displayName;
  sidebarBrandIconEl.src = APP_BRAND.iconUrl;
  sidebarBrandNameEl.textContent = APP_BRAND.displayName;
  onboardingTitleEl.textContent = `Welcome to ${APP_BRAND.displayName}`;
  onboardingMarkEl.src = APP_BRAND.markUrl;
  onboardingPermissionsCopyEl.textContent = 'macOS asks once for each.';
}

function renderWorkspaceHeader(tab: WorkspaceTab): void {
  workspaceViewTitleEl.textContent = WORKSPACE_TITLES[tab];
}

function inferStatusBannerTone(message: string): StatusBannerTone {
  const normalized = message.trim().toLowerCase();
  if (lastRuntimeStatus?.is_recording) {
    return 'recording';
  }
  if (lastRuntimeStatus?.is_processing) {
    return 'processing';
  }
  if (normalized.includes('setup needed')) {
    return 'issue';
  }
  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes("aren't available") ||
    normalized.includes('not available') ||
    normalized.includes('missing') ||
    normalized.includes('too short')
  ) {
    return 'issue';
  }
  if (
    normalized.includes('starting') ||
    normalized.includes('stopping') ||
    normalized.includes('testing') ||
    normalized.includes('checking') ||
    normalized.includes('loading') ||
    normalized.includes('transcribing') ||
    normalized.includes('formatting')
  ) {
    return 'processing';
  }
  if (normalized.includes('recording')) {
    return 'recording';
  }
  return 'ready';
}

function syncStatusBannerFromText(): void {
  renderStatusBanner();
}

function runtimeStatusBannerTone(status: RuntimeStatus): StatusBannerTone {
  if (status.is_recording) {
    return 'recording';
  }
  if (status.is_processing) {
    return 'processing';
  }
  return inferStatusBannerTone(status.last_message);
}

function shouldShowIdleStatusMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('no speech') ||
    normalized.includes('could not') ||
    normalized.includes('failed') ||
    normalized.includes('not saved') ||
    normalized.includes('did not finish') ||
    normalized.includes('invalid') ||
    normalized.includes('needs') ||
    normalized.includes('denied') ||
    normalized.includes('missing') ||
    normalized.includes('setup') ||
    normalized.includes('shortcut')
  );
}

function cleanRuntimeFeedbackMessage(message: string): string {
  return message
    .trim()
    .replace(/^dictation failed:\s*/i, '')
    .replace(/\s*audio saved for recovery\.?$/i, '')
    .replace(/\s*\.\s*\./g, '.')
    .trim();
}

function compactRuntimeFeedbackMessage(message: string): string {
  const cleaned = cleanRuntimeFeedbackMessage(message);
  if (!cleaned) return 'Ready';
  if (cleaned.toLowerCase().includes('no speech detected')) {
    return 'No speech detected';
  }
  const firstSentence = cleaned.match(/^[^.]+[.]?/)?.[0]?.trim();
  return firstSentence || cleaned;
}

function toastRuntimeFeedbackMessage(message: string): string {
  const cleaned = cleanRuntimeFeedbackMessage(message);
  if (cleaned.toLowerCase().includes('no speech detected')) {
    return 'No speech detected. Check microphone input, then try again.';
  }
  return compactRuntimeFeedbackMessage(cleaned);
}

function isRuntimeIssueMessage(message: string): boolean {
  return inferStatusBannerTone(message) === 'issue' || shouldShowIdleStatusMessage(message);
}

function renderStatusBanner(): void {
  const runtime = lastRuntimeStatus;
  const missing = missingPermissionLabels();
  const runtimeIsActive = Boolean(runtime?.is_recording || runtime?.is_processing);
  statusBannerEl.removeAttribute('title');

  if (runtimeIsActive && runtime) {
    statusEl.textContent = runtime.is_recording && liveInputIssueActive ? 'No input detected' : runtime.last_message;
    setStatusBannerTone(runtime.is_recording && liveInputIssueActive ? 'issue' : runtimeStatusBannerTone(runtime));
    setStatusBannerActionable(false);
    return;
  }

  if (runtime?.failure) {
    statusEl.textContent = 'Dictation failed · Open History';
    setStatusBannerTone('issue');
    setStatusBannerActionable(false);
    statusBannerEl.classList.add('is-actionable');
    statusBannerEl.dataset.action = 'history';
    statusBannerEl.tabIndex = 0;
    statusBannerEl.setAttribute('role', 'button');
    statusBannerEl.setAttribute('aria-label', `${runtime.failure.message} Audio saved. Open History.`);
    statusBannerEl.title = runtime.failure.message;
    return;
  }

  if (missing.length > 0) {
    statusEl.textContent = `Setup needed: ${missing.join(' and ')}`;
    setStatusBannerTone('issue');
    setStatusBannerActionable(true);
    return;
  }

  const message = shouldShowIdleStatusMessage(appStatusMessage)
    ? compactRuntimeFeedbackMessage(appStatusMessage)
    : 'Ready';
  statusEl.textContent = message;
  setStatusBannerTone(inferStatusBannerTone(message));
  setStatusBannerActionable(false);
}

function setStatusMessage(message: string): void {
  appStatusMessage = message;
  statusMessageSource = 'ui';
  renderStatusBanner();
}

function setRuntimeStatusMessage(message: string): void {
  appStatusMessage = message;
  statusMessageSource = 'runtime';
  renderStatusBanner();
}

function setActiveTab(targetTab: WorkspaceTab, focusTab = false): void {
  activeTab = targetTab;
  renderWorkspaceHeader(targetTab);
  headerActionGroups.forEach((group) => {
    group.hidden = group.dataset.headerFor !== targetTab;
  });
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === targetTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focusTab) {
      button.focus();
    }
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === targetTab;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });
  if (targetTab === 'rewrite') {
    rewritePromptListEl.querySelectorAll<HTMLTextAreaElement>('.prompt-text').forEach(fitPromptText);
  }
}

function setActiveSettingsSection(targetSection: SettingsSection, focusButton = false): void {
  activeSettingsSection = targetSection;

  settingsSectionButtons.forEach((button) => {
    const isActive = button.dataset.settingsTarget === targetSection;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focusButton) {
      button.focus();
    }
  });

  settingsSectionPanels.forEach((panel) => {
    const isActive = panel.dataset.settingsPanel === targetSection;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });

  localStorage.setItem(SETTINGS_SECTION_KEY, targetSection);
}

function setupTabs(): void {
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab((button.dataset.tabTarget as WorkspaceTab) || 'home');
    });

    button.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      const buttons = Array.from(tabButtons);
      const currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
      if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = buttons.length - 1;

      const nextButton = buttons[nextIndex];
      const nextTab = (nextButton.dataset.tabTarget as WorkspaceTab) || 'home';
      setActiveTab(nextTab, true);
    });
  });

  setActiveTab(activeTab);
}

function setupSettingsSections(): void {
  const persisted = localStorage.getItem(SETTINGS_SECTION_KEY);
  if (persisted && SETTINGS_SECTION_ORDER.includes(persisted as SettingsSection)) {
    activeSettingsSection = persisted as SettingsSection;
  }

  settingsSectionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = (button.dataset.settingsTarget as SettingsSection) || 'general';
      setActiveSettingsSection(target);
    });

    button.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      const buttons = Array.from(settingsSectionButtons);
      const currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
      if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = buttons.length - 1;

      const nextButton = buttons[nextIndex];
      const nextSection = (nextButton.dataset.settingsTarget as SettingsSection) || 'general';
      setActiveSettingsSection(nextSection, true);
    });
  });

  setActiveSettingsSection(activeSettingsSection);
}

function setSidebarCollapsedState(collapsed: boolean): void {
  isSidebarCollapsed = collapsed;
  appShellEl.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

function setupSidebar(): void {
  const persisted = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  setSidebarCollapsedState(persisted === 'true');
  sidebarToggleBtn.addEventListener('click', () => {
    const nextCollapsed = !isSidebarCollapsed;
    setSidebarCollapsedState(nextCollapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextCollapsed ? 'true' : 'false');
  });
}

function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
}

function setOnboardingCompleted(value: boolean): void {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, value ? 'true' : 'false');
}

function onboardingStepIndexFor(step: OnboardingStepId): number {
  return Math.max(0, onboardingStepOrder.indexOf(step));
}

function missingPermissionLabels(): string[] {
  const missing = [];
  if (lastAccessibilityStatus?.is_supported && !lastAccessibilityStatus.is_granted) {
    missing.push('Accessibility');
  }
  if (lastMicrophoneStatus?.is_supported && !lastMicrophoneStatus.is_granted) {
    missing.push('Microphone');
  }
  return missing;
}

function setStatusBannerActionable(actionable: boolean): void {
  statusBannerEl.classList.toggle('is-actionable', actionable);
  statusBannerEl.dataset.action = actionable ? 'setup' : '';
  statusBannerEl.tabIndex = actionable ? 0 : -1;
  if (actionable) {
    statusBannerEl.setAttribute('role', 'button');
    statusBannerEl.setAttribute('aria-label', `Open setup guide for ${missingPermissionLabels().join(' and ')}`);
  } else {
    statusBannerEl.setAttribute('role', 'status');
    statusBannerEl.removeAttribute('aria-label');
  }
}

function syncPermissionSetupBanner(): void {
  renderStatusBanner();
}

function showPermissionOnboarding(): void {
  showOnboarding({ resetStep: false, step: 'permissions' });
}

function apiKeySummaryText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Missing';
  if (savedApiKey && trimmed === savedApiKey) return 'Saved';
  return 'Ready to save';
}

function renderApiKeyControl(): void {
  const value = apiKeyInput.value.trim();
  const hasValue = value.length > 0;
  const isDirty = hasValue && value !== savedApiKey;

  apiKeyControlEl.dataset.state = hasValue ? (isDirty ? 'dirty' : 'set') : 'missing';
  apiKeySummaryEl.textContent = apiKeySummaryText(value);
  apiKeyEditBtn.textContent = apiKeyEditorOpen ? 'Hide' : hasValue ? 'Change' : 'Set key';
  apiKeyEditBtn.setAttribute('aria-expanded', String(apiKeyEditorOpen));
  apiKeyEditorEl.hidden = !apiKeyEditorOpen;
}

function setApiKeyEditorOpen(isOpen: boolean, focusInput = false): void {
  apiKeyEditorOpen = isOpen;
  renderApiKeyControl();
  if (isOpen && focusInput) {
    requestAnimationFrame(() => apiKeyInput.focus());
  }
}

function syncOnboardingInputsFromSettings(): void {
  onboardingApiKeyInput.value = apiKeyInput.value.trim();
  onboardingApiBaseUrlInput.value = apiBaseUrlInput.value.trim() || 'https://api.openai.com/v1';
  onboardingHotkeyInput.value = activeConfig.hold_hotkeys[0] || defaultHotkeyForSlot('hold');
  validateOnboardingApiStep();
  validateOnboardingHotkeyInput();
}

function updateOnboardingStep(): void {
  const step = onboardingStepOrder[onboardingStepIndex];
  onboardingStepIndicatorEl.textContent = `Step ${onboardingStepIndex + 1} of ${onboardingStepOrder.length}`;

  onboardingStepsEls.forEach((el) => {
    const isActive = el.dataset.onboardingStep === step;
    el.classList.toggle('hidden', !isActive);
  });

  onboardingProgressDots.forEach((dot, index) => {
    dot.classList.toggle('is-done', index < onboardingStepIndex);
    dot.classList.toggle('is-current', index === onboardingStepIndex);
  });
  onboardingBackBtn.hidden = onboardingStepIndex === 0;
  const isLast = onboardingStepIndex === onboardingStepOrder.length - 1;
  onboardingNextBtn.textContent = onboardingStepIndex === 0 ? 'Get started' : 'Continue';
  onboardingNextBtn.classList.toggle('hidden', isLast);
  onboardingFinishBtn.classList.toggle('hidden', !isLast);
  if (step === 'try') {
    onboardingTryStartedAt = Date.now();
    onboardingTryInput.value = '';
    onboardingTryResultEl.hidden = true;
  }
  syncOnboardingPermissionPolling();
  requestAnimationFrame(focusOnboardingStep);
}

function focusOnboardingStep(): void {
  if (onboardingModalEl.classList.contains('hidden')) return;
  const step = onboardingStepOrder[onboardingStepIndex];
  let target: HTMLElement | null = null;
  if (step === 'permissions') {
    if (!onboardingOpenMicrophoneSettingsBtn.disabled) {
      target = onboardingOpenMicrophoneSettingsBtn;
    } else if (!onboardingOpenAccessibilitySettingsBtn.disabled) {
      target = onboardingOpenAccessibilitySettingsBtn;
    } else {
      target = onboardingNextBtn;
    }
  } else if (step === 'api') {
    target = onboardingApiKeyInput.value.trim() ? onboardingApiBaseUrlInput : onboardingApiKeyInput;
  } else if (step === 'try') {
    // Dictation lands in the focused field, so the practice area must hold focus.
    target = onboardingTryInput;
  } else {
    target = onboardingNextBtn;
  }
  target?.focus();
}

function showOnboarding(options: { resetStep?: boolean; step?: OnboardingStepId } = {}): void {
  if (onboardingModalEl.classList.contains('hidden')) {
    const activeElement = document.activeElement;
    preOnboardingFocusEl = activeElement instanceof HTMLElement ? activeElement : null;
  }
  const resetStep = options.resetStep ?? true;
  if (options.step) {
    onboardingStepIndex = onboardingStepIndexFor(options.step);
  } else if (resetStep) {
    onboardingStepIndex = 0;
  }
  syncOnboardingInputsFromSettings();
  renderOnboardingPermissionStatuses();
  updateOnboardingStep();
  onboardingModalEl.classList.remove('hidden');
  syncOnboardingPermissionPolling();
  if (onboardingStepOrder[onboardingStepIndex] === 'permissions') {
    void refreshPermissionStatuses();
  }
}

function hideOnboarding(): void {
  if (activeHotkeyCaptureTarget?.scope === 'onboarding') {
    stopHotkeyCapture();
  }
  onboardingModalEl.classList.add('hidden');
  syncOnboardingPermissionPolling();
  if (preOnboardingFocusEl?.isConnected) {
    preOnboardingFocusEl.focus();
  }
  preOnboardingFocusEl = null;
}

function languageLabel(language: TranscriptionLanguage): string {
  return LANGUAGE_LABELS[language] || 'Auto';
}

function setOnboardingHotkeyValidation(message: string, isError: boolean): void {
  onboardingHotkeyValidationEl.textContent = message;
  onboardingHotkeyValidationEl.classList.toggle('error', isError);
  onboardingHotkeyValidationEl.classList.toggle('hidden', message.trim().length === 0);
}

function setOnboardingApiKeyValidation(message: string, isError: boolean): void {
  onboardingApiKeyValidationEl.textContent = message;
  onboardingApiKeyValidationEl.classList.toggle('error', isError);
}

function setOnboardingApiBaseUrlValidation(message: string, isError: boolean): void {
  onboardingApiBaseUrlValidationEl.textContent = message;
  onboardingApiBaseUrlValidationEl.classList.toggle('error', isError);
}

function normalizeApiBaseUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.hostname === 'api.openai.com' && (!parsed.pathname || parsed.pathname === '/')) {
      parsed.pathname = '/v1';
    } else {
      const pathWithoutTrailingSlash = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = pathWithoutTrailingSlash || '/';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

function validateOnboardingApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return 'Add your OpenAI API key.';
  }
  if (!trimmed.startsWith('sk-')) {
    return 'Use an OpenAI key that starts with "sk-".';
  }
  return null;
}

function validateOnboardingApiBaseUrl(baseUrl: string): { error: string | null; suggestion: string | null } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return {
      error: 'Add an API base URL.',
      suggestion: 'https://api.openai.com/v1'
    };
  }

  const suggested = normalizeApiBaseUrlInput(trimmed);
  const suggestion = suggested && suggested !== trimmed ? suggested : null;
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return {
      error: 'Use a full URL, for example https://api.openai.com/v1.',
      suggestion
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      error: 'Start the URL with https:// or http://.',
      suggestion
    };
  }

  if (!parsed.hostname) {
    return {
      error: 'Add the API host name.',
      suggestion
    };
  }

  return {
    error: null,
    suggestion
  };
}

function setOnboardingApiBaseUrlFixSuggestion(suggestion: string | null): void {
  if (!suggestion) {
    onboardingApiBaseUrlFixBtn.classList.add('hidden');
    onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl = '';
    return;
  }
  onboardingApiBaseUrlFixBtn.classList.remove('hidden');
  onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl = suggestion;
}

function normalizeBaseUrlForSettingsInput(baseUrl: string): string {
  return normalizeApiBaseUrlInput(baseUrl) || 'https://api.openai.com/v1';
}

function validateOnboardingApiStep(): string | null {
  const keyError = validateOnboardingApiKey(onboardingApiKeyInput.value);
  if (keyError) {
    setOnboardingApiKeyValidation(keyError, true);
  } else {
    setOnboardingApiKeyValidation('API key looks good.', false);
  }

  const baseUrlValidation = validateOnboardingApiBaseUrl(onboardingApiBaseUrlInput.value);
  setOnboardingApiBaseUrlFixSuggestion(baseUrlValidation.suggestion);
  if (baseUrlValidation.error) {
    setOnboardingApiBaseUrlValidation(baseUrlValidation.error, true);
  } else if (baseUrlValidation.suggestion) {
    setOnboardingApiBaseUrlValidation('URL can be normalized before saving.', false);
  } else {
    setOnboardingApiBaseUrlValidation('API base URL ready.', false);
  }

  return keyError || baseUrlValidation.error;
}

function normalizeMode(mode: string): RecordingMode {
  return mode === 'toggle' ? 'toggle' : 'hold';
}

function normalizeLanguage(language: string): TranscriptionLanguage {
  const normalized = language.trim().toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans') {
    return 'zh-CN';
  }
  if (normalized === 'zh-tw' || normalized === 'zh-hant') {
    return 'zh-TW';
  }
  if (language in LANGUAGE_LABELS) {
    return language as TranscriptionLanguage;
  }
  return 'auto';
}

function canonicalizeNonModifierToken(input: string): string | null {
  const compactPart = input.replace(/\s+/g, '');
  const aliasKey = compactPart.toLowerCase();
  const normalizedAlias = NON_MODIFIER_ALIAS_TO_CANONICAL[aliasKey];
  if (normalizedAlias) {
    return normalizedAlias;
  }
  if (/^key[a-z]$/.test(aliasKey)) {
    return aliasKey.slice(3).toUpperCase();
  }
  if (/^[a-z]$/.test(aliasKey)) {
    return aliasKey.toUpperCase();
  }
  if (/^digit[0-9]$/.test(aliasKey)) {
    return aliasKey.slice(5);
  }
  if (/^[0-9]$/.test(aliasKey)) {
    return aliasKey;
  }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(aliasKey)) {
    return aliasKey.toUpperCase();
  }
  if (/^numpad[0-9]$/.test(aliasKey)) {
    return `Num${aliasKey.slice(-1)}`;
  }
  if (/^num[0-9]$/.test(aliasKey)) {
    return `Num${aliasKey.slice(-1)}`;
  }
  switch (aliasKey) {
    case 'numpadadd':
    case 'numadd':
      return 'NumAdd';
    case 'numpaddecimal':
    case 'numdecimal':
      return 'NumDecimal';
    case 'numpaddivide':
    case 'numdivide':
      return 'NumDivide';
    case 'numpadenter':
    case 'numenter':
      return 'NumEnter';
    case 'numpadequal':
    case 'numequal':
      return 'NumEqual';
    case 'numpadmultiply':
    case 'nummultiply':
      return 'NumMultiply';
    case 'numpadsubtract':
    case 'numsubtract':
      return 'NumSubtract';
    default:
      return null;
  }
}

function normalizeHotkeyInput(input: string): string {
  const normalizedParts = input
    .trim()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const compactPart = part.replace(/\s+/g, '');
      const aliasKey = compactPart.toLowerCase();
      const normalizedModifier = MODIFIER_ALIAS_TO_CANONICAL[aliasKey];
      if (normalizedModifier) {
        return normalizedModifier;
      }
      const normalizedNonModifier = canonicalizeNonModifierToken(compactPart);
      if (normalizedNonModifier) {
        return normalizedNonModifier;
      }
      return compactPart;
    });

  const modifierParts = normalizedParts.filter((part) => KNOWN_MODIFIERS.has(part));
  const nonModifierParts = normalizedParts.filter((part) => !KNOWN_MODIFIERS.has(part));
  return [...modifierParts, ...nonModifierParts].join('+');
}

function validateHotkey(hotkey: string): string | null {
  const trimmed = hotkey.trim();
  if (!trimmed) {
    return 'Choose a shortcut.';
  }

  const rawParts = trimmed.split('+').map((part) => part.trim());
  if (rawParts.some((part) => !part)) {
    return 'Hotkey contains an empty key segment. Remove extra + signs.';
  }

  const normalized = normalizeHotkeyInput(trimmed);
  const parts = normalized.split('+').filter(Boolean);
  const modifiers = parts.filter((part) => KNOWN_MODIFIERS.has(part));
  const nonModifiers = parts.filter((part) => !KNOWN_MODIFIERS.has(part));

  const duplicateModifier = modifiers.find((modifier, index) => modifiers.indexOf(modifier) !== index);
  if (duplicateModifier) {
    return `Remove duplicate ${duplicateModifier}. Use each modifier once.`;
  }

  if (parts.some((part) => part === 'Fn' || part.toLowerCase() === 'fn')) {
    return 'Fn shortcuts are not supported. Use a function key or a shortcut with modifiers.';
  }

  if (nonModifiers.length === 0) {
    return 'Add one regular key, or use a single F key.';
  }

  if (nonModifiers.length > 1) {
    return 'Use exactly one non-modifier key.';
  }

  if (!canonicalizeNonModifierToken(nonModifiers[0])) {
    return `Use a supported key instead of "${nonModifiers[0]}": A, 1, Space, or F8.`;
  }

  const primaryKey = nonModifiers[0];
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(primaryKey);
  const totalModifierCount = modifiers.length;
  if (isFunctionKey && totalModifierCount === 0) {
    return null;
  }

  if (totalModifierCount === 0) {
    return 'Add at least one modifier key, or use a single F key.';
  }

  if (modifiers.length > 2) {
    return 'Use at most two modifiers plus one key.';
  }

  return null;
}

function hotkeyHasNonModifier(hotkey: string): boolean {
  const parts = normalizeHotkeyInput(hotkey).split('+').filter(Boolean);
  return parts.some((part) => !KNOWN_MODIFIERS.has(part));
}

function keyTokenFromCode(code: string): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `Num${code.slice(-1)}`;
  }
  switch (code) {
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'ArrowUp':
      return 'Up';
    case 'Backquote':
      return '`';
    case 'Backslash':
      return '\\';
    case 'Backspace':
      return 'Backspace';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Comma':
      return ',';
    case 'Delete':
      return 'Delete';
    case 'End':
      return 'End';
    case 'Enter':
      return 'Enter';
    case 'Equal':
      return '=';
    case 'Escape':
      return 'Escape';
    case 'Home':
      return 'Home';
    case 'Insert':
      return 'Insert';
    case 'Minus':
      return '-';
    case 'NumpadAdd':
      return 'NumAdd';
    case 'NumpadDecimal':
      return 'NumDecimal';
    case 'NumpadDivide':
      return 'NumDivide';
    case 'NumpadEnter':
      return 'NumEnter';
    case 'NumpadEqual':
      return 'NumEqual';
    case 'NumpadMultiply':
      return 'NumMultiply';
    case 'NumpadSubtract':
      return 'NumSubtract';
    case 'PageDown':
      return 'PageDown';
    case 'PageUp':
      return 'PageUp';
    case 'Period':
      return '.';
    case 'Quote':
      return "'";
    case 'Semicolon':
      return ';';
    case 'Slash':
      return '/';
    case 'Space':
      return 'Space';
    case 'Tab':
      return 'Tab';
    default:
      return null;
  }
}

function hotkeyFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const normalizedKey =
    keyTokenFromCode(event.code) ||
    (event.key && !MODIFIER_EVENT_KEYS.has(event.key) ? canonicalizeNonModifierToken(event.key) : null);
  if (normalizedKey) {
    parts.push(normalizedKey);
  }

  return normalizeHotkeyInput(parts.join('+'));
}

function createHotkeyToken(label: string): HTMLSpanElement {
  const token = document.createElement('span');
  token.className = 'hotkey-token';
  token.textContent = label;
  return token;
}

function hotkeyTokenDisplayLabel(token: string): string {
  switch (token) {
    case 'Cmd':
      return PLATFORM_IS_MAC ? 'Command' : 'Cmd';
    case 'Ctrl':
      return PLATFORM_IS_MAC ? 'Control' : 'Ctrl';
    case 'Super':
      return PLATFORM_IS_MAC ? 'Command' : 'Windows';
    case 'Alt':
      return PLATFORM_IS_MAC ? 'Option' : 'Alt';
    case 'Escape':
      return 'Esc';
    case 'Fn':
      return 'fn';
    case 'PageDown':
      return 'PgDn';
    case 'PageUp':
      return 'PgUp';
    case 'NumAdd':
      return 'Num +';
    case 'NumDecimal':
      return 'Num .';
    case 'NumDivide':
      return 'Num /';
    case 'NumEnter':
      return 'Num Enter';
    case 'NumEqual':
      return 'Num =';
    case 'NumMultiply':
      return 'Num *';
    case 'NumSubtract':
      return 'Num -';
    default:
      return token;
  }
}

function renderHotkeyValue(target: HTMLElement, hotkey: string, emptyLabel = 'Not set'): void {
  const normalized = normalizeHotkeyInput(hotkey);
  const parts = normalized.split('+').filter(Boolean);
  target.replaceChildren();

  const wrapper = document.createElement('span');
  wrapper.className = 'hotkey-value';
  if (parts.length === 0) {
    wrapper.append(createHotkeyToken(emptyLabel));
  } else {
    parts.forEach((part) => {
      wrapper.append(createHotkeyToken(hotkeyTokenDisplayLabel(part)));
    });
  }
  target.append(wrapper);
}

function renderHotkeyTrigger(button: HTMLButtonElement, hotkey: string, isCapturing = false): void {
  button.classList.toggle('is-capturing', isCapturing);
  button.setAttribute('aria-pressed', String(isCapturing));
  if (isCapturing) {
    const label = document.createElement('span');
    label.className = 'hotkey-capture-label';
    label.textContent = 'Press shortcut';
    button.replaceChildren(label);
    return;
  }
  renderHotkeyValue(button, hotkey);
}

function isSettingsCaptureTarget(slot: ShortcutSlot, index: number | null): boolean {
  return (
    activeHotkeyCaptureTarget?.scope === 'settings' &&
    activeHotkeyCaptureTarget.slot === slot &&
    activeHotkeyCaptureTarget.index === index
  );
}

function renderShortcutEditor(slot: ShortcutSlot): void {
  const listEl = shortcutListEls[slot];
  const shortcuts = shortcutValuesForSlot(activeConfig, slot);
  listEl.replaceChildren();

  shortcuts.forEach((hotkey, index) => {
    const entryEl = document.createElement('div');
    entryEl.className = 'shortcut-entry';

    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.className = 'shortcut-trigger';
    triggerBtn.setAttribute('aria-describedby', `${slot}-hotkey-validation`);
    triggerBtn.addEventListener('click', () => {
      startHotkeyCapture({ scope: 'settings', slot, index });
    });
    renderHotkeyTrigger(triggerBtn, hotkey, isSettingsCaptureTarget(slot, index));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ui-button ui-button-quiet shortcut-remove-btn icon-only';
    const actionLabel = SHORTCUT_ACTION_LABELS[slot];
    removeBtn.setAttribute('aria-label', `Remove ${actionLabel} shortcut ${index + 1}`);
    removeBtn.title = 'Remove shortcut';
    removeBtn.innerHTML =
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"></path></svg>';
    removeBtn.disabled = shortcuts.length <= 1;
    removeBtn.addEventListener('click', () => {
      const nextConfig = withShortcutValues(
        currentSettingsConfig(),
        slot,
        shortcuts.filter((_, shortcutIndex) => shortcutIndex !== index)
      );
      applyConfigUi(nextConfig);
      validateSettingsHotkeyInput(slot);
    });

    entryEl.append(triggerBtn, removeBtn);
    listEl.append(entryEl);
  });

  shortcutAddBtns[slot].disabled = activeHotkeyCaptureTarget?.scope === 'settings';
}

function renderOnboardingHotkeyTrigger(hotkey: string, isCapturing = false): void {
  renderHotkeyTrigger(onboardingHotkeyCaptureBtn, hotkey, isCapturing);
}

function renderShortcutSummary(target: HTMLElement, shortcuts: string[]): void {
  target.replaceChildren();
  const normalizedShortcuts = shortcuts
    .map((shortcut) => normalizeHotkeyInput(shortcut).split('+').filter(Boolean))
    .filter((parts) => parts.length > 0);

  if (normalizedShortcuts.length === 0) {
    target.append(createHotkeyToken('Not set'));
    return;
  }

  normalizedShortcuts.forEach((parts, shortcutIndex) => {
    if (shortcutIndex > 0) {
      const separatorEl = document.createElement('span');
      separatorEl.className = 'shortcut-keyset-separator';
      separatorEl.textContent = '/';
      target.append(separatorEl);
    }
    parts.forEach((part) => {
      target.append(createHotkeyToken(hotkeyTokenDisplayLabel(part)));
    });
  });
}

function applyConfigUi(
  config: ShortcutConfig
): void {
  activeConfig = {
    hold_hotkeys: normalizeShortcutList(config.hold_hotkeys, 'hold'),
    toggle_hotkeys: normalizeShortcutList(config.toggle_hotkeys, 'toggle'),
    recording_mode: normalizeMode(config.recording_mode),
    language: normalizeLanguage(config.language)
  };

  // Shortcuts already say how to record; only a pinned language is worth repeating.
  const languageText = activeConfig.language === 'auto' ? '' : languageLabel(activeConfig.language);

  renderShortcutSummary(shortcutHoldHintEl, activeConfig.hold_hotkeys);
  renderShortcutSummary(shortcutToggleHintEl, activeConfig.toggle_hotkeys);
  SHORTCUT_SLOTS.forEach(renderShortcutEditor);
  renderOnboardingHotkeyTrigger(
    onboardingHotkeyInput.value || activeConfig.hold_hotkeys[0],
    activeHotkeyCaptureTarget?.scope === 'onboarding'
  );
  modeStatusTextEl.textContent = languageText;
  renderShortcutDirtyState();
}

function setRecordingActionLabels(
  isRecording: boolean,
  pendingAction: 'starting' | 'stopping' | null = null
): void {
  const label =
    pendingAction === 'starting'
      ? 'Starting recording'
      : pendingAction === 'stopping'
        ? 'Stopping recording'
        : isRecording
          ? 'Stop recording'
          : 'Start recording';
  homeToggleBtn.setAttribute('aria-label', label);
  homeToggleBtn.title = label;
  homeToggleBtn.classList.toggle('is-recording', isRecording && pendingAction !== 'stopping');
}

function renderHero(status: RuntimeStatus): void {
  const state = status.is_recording ? 'recording' : status.is_processing ? 'processing' : 'idle';
  homeHeroEl.dataset.state = state;
  heroTitleEl.textContent =
    state === 'recording'
      ? 'Listening\u2026'
      : state === 'processing'
        ? status.rewriting
          ? `Rewriting \u00b7 ${status.rewriting}`
          : 'Transcribing\u2026'
        : 'Ready';
}

function runtimeStateChanged(status: RuntimeStatus): boolean {
  return (
    !lastRenderedRuntimeState ||
    lastRenderedRuntimeState.is_recording !== status.is_recording ||
    lastRenderedRuntimeState.is_processing !== status.is_processing ||
    lastRenderedRuntimeState.failure?.recording_id !== status.failure?.recording_id ||
    lastRenderedRuntimeState.last_message !== status.last_message ||
    lastRenderedRuntimeState.rewriting !== status.rewriting
  );
}

function renderMicLevel(status: RuntimeStatus): void {
  const level = Math.max(0, Math.min(100, Math.round(status.mic_level || 0)));
  voiceBarsEl.style.setProperty('--level', String(status.is_recording ? level / 100 : 0));

  const previousLiveIssue = liveInputIssueActive;
  if (!status.is_recording || level > LIVE_INPUT_THRESHOLD) {
    quietInputStartedAt = null;
    liveInputIssueActive = false;
  } else {
    quietInputStartedAt ??= performance.now();
    liveInputIssueActive = performance.now() - quietInputStartedAt > LIVE_INPUT_QUIET_MS;
  }
  if (previousLiveIssue !== liveInputIssueActive) {
    renderStatusBanner();
  }
}

function renderStatus(status: RuntimeStatus): void {
  const previousStatus = lastRuntimeStatus;
  lastRuntimeStatus = status;
  renderMicLevel(status);

  if (!runtimeStateChanged(status)) {
    return;
  }

  lastRenderedRuntimeState = {
    is_recording: status.is_recording,
    is_processing: status.is_processing,
    failure: status.failure,
    last_message: status.last_message,
    rewriting: status.rewriting
  };

  renderHero(status);
  document.body.classList.toggle('is-recording', status.is_recording);
  document.body.classList.toggle('is-processing', status.is_processing);
  clearTogglePendingState(status.is_recording);
  updateSavedRecordingButtons();
  setRecordingActionLabels(status.is_recording);
  const runtimeFinished =
    Boolean(previousStatus?.is_recording || previousStatus?.is_processing) &&
    !status.is_recording &&
    !status.is_processing;
  if (runtimeFinished && !status.failure && isRuntimeIssueMessage(status.last_message)) {
    showAppToast(toastRuntimeFeedbackMessage(status.last_message), 'error');
  }
  const runtimeBecameActive =
    status.is_recording ||
    status.is_processing ||
    previousStatus?.is_recording ||
    previousStatus?.is_processing ||
    !previousStatus;
  if (runtimeBecameActive || statusMessageSource === 'runtime') {
    setRuntimeStatusMessage(status.last_message);
  } else {
    renderStatusBanner();
  }
}

function setToggleButtonsDisabled(disabled: boolean): void {
  homeToggleBtn.disabled = disabled;
}

function clearTogglePendingState(nextIsRecording = Boolean(lastRuntimeStatus?.is_recording)): void {
  if (togglePendingTimeoutId !== null) {
    window.clearTimeout(togglePendingTimeoutId);
    togglePendingTimeoutId = null;
  }
  togglePendingAction = null;
  setToggleButtonsDisabled(Boolean(lastRuntimeStatus?.is_processing || lastRuntimeStatus?.interrupted));
  setRecordingActionLabels(nextIsRecording);
}

function beginOptimisticToggleState(): boolean {
  if (togglePendingAction || lastRuntimeStatus?.is_processing || lastRuntimeStatus?.interrupted) return false;
  const nextAction: 'starting' | 'stopping' = lastRuntimeStatus?.is_recording ? 'stopping' : 'starting';
  togglePendingAction = nextAction;
  setToggleButtonsDisabled(true);
  setRecordingActionLabels(nextAction === 'starting', nextAction);
  setStatusMessage(nextAction === 'starting' ? 'Starting recording' : 'Stopping recording');
  togglePendingTimeoutId = window.setTimeout(() => {
    clearTogglePendingState();
  }, TOGGLE_PENDING_TIMEOUT_MS);
  return true;
}

async function requestToggleRecording(): Promise<void> {
  if (!beginOptimisticToggleState()) return;
  const optimisticNextState = togglePendingAction === 'starting';
  try {
    await invokeCommand<void>('toggle_recording');
    clearTogglePendingState(optimisticNextState);
  } catch (error) {
    clearTogglePendingState(Boolean(lastRuntimeStatus?.is_recording));
    if (lastRuntimeStatus) {
      renderStatus(lastRuntimeStatus);
    }
    setStatusMessage(`Recording could not start or stop: ${userErrorMessage(error)}`);
  }
}

function renderAccessibilityStatus(status: AccessibilityPermissionStatus): void {
  lastAccessibilityStatus = status;
  renderOnboardingPermissionStatuses();
  syncPermissionSetupBanner();
}

function renderMicrophoneStatus(status: MicrophonePermissionStatus): void {
  lastMicrophoneStatus = status;
  renderOnboardingPermissionStatuses();
  syncPermissionSetupBanner();
}

function onboardingAccessibilityLabel(status: AccessibilityPermissionStatus | null): string {
  if (!status) return 'Checking';
  if (!status.is_supported) return 'macOS only';
  if (status.is_granted) return 'Allowed';
  if (status.status === 'restart_required' || status.status === 'check_failed') return status.guidance;
  return `So ${APP_BRAND.displayName} can type for you`;
}

function onboardingMicrophoneLabel(status: MicrophonePermissionStatus | null): string {
  if (!status) return 'Checking';
  if (!status.is_supported) return 'macOS only';
  if (status.is_granted) return 'Allowed';
  if (status.status === 'check_failed') return status.guidance;
  if (status.status === 'denied') return `Turned off. Open Settings and turn ${APP_BRAND.displayName} on.`;
  if (status.status === 'restricted') return 'Blocked by macOS policy';
  return `So ${APP_BRAND.displayName} can hear you`;
}

function renderOnboardingPermissionStatuses(): void {
  setPermissionUiState(onboardingAccessibilityRowEl, lastAccessibilityStatus);
  setPermissionUiState(onboardingMicrophoneRowEl, lastMicrophoneStatus);
  onboardingAccessibilityStatusEl.textContent = onboardingAccessibilityLabel(lastAccessibilityStatus);
  onboardingMicrophoneStatusEl.textContent = onboardingMicrophoneLabel(lastMicrophoneStatus);
  const accessibilityNeedsRestart = lastAccessibilityStatus?.status === 'restart_required';
  onboardingOpenAccessibilitySettingsBtn.textContent = accessibilityNeedsRestart ? 'Restart' : 'Open Settings';
  onboardingOpenAccessibilitySettingsBtn.disabled =
    Boolean(lastAccessibilityStatus && (!lastAccessibilityStatus.is_supported || lastAccessibilityStatus.is_granted));
  onboardingOpenMicrophoneSettingsBtn.textContent =
    lastMicrophoneStatus?.status === 'denied' || lastMicrophoneStatus?.status === 'restricted' ? 'Open Settings' : 'Allow';
  onboardingOpenMicrophoneSettingsBtn.disabled =
    Boolean(lastMicrophoneStatus && (!lastMicrophoneStatus.is_supported || lastMicrophoneStatus.is_granted));
}

const permissionCheckSequence = { accessibility: 0, microphone: 0 };

async function checkAndRenderPermissionStatus(
  kind: keyof typeof permissionCheckSequence, request: boolean
): Promise<AccessibilityPermissionStatus> {
  const sequence = ++permissionCheckSequence[kind];
  const render = kind === 'accessibility' ? renderAccessibilityStatus : renderMicrophoneStatus;
  if (kind === 'accessibility') lastAccessibilityStatus = null;
  else lastMicrophoneStatus = null;
  renderOnboardingPermissionStatuses();
  try {
    const status = await invokeCommand<AccessibilityPermissionStatus>(
      `${request ? 'request' : 'check'}_${kind}_permission`
    );
    // Focus refreshes and manual checks can overlap. An older result must not
    // overwrite a newer revocation with a stale green status.
    if (sequence === permissionCheckSequence[kind]) render(status);
    return status;
  } catch (error) {
    if (sequence === permissionCheckSequence[kind]) {
      render({ platform: 'macOS', is_supported: true, is_granted: false,
        status: 'check_failed', guidance: 'Could not check access. Try again.' });
    }
    throw error;
  }
}

function checkAndRenderAccessibilityStatus(request = false): Promise<AccessibilityPermissionStatus> {
  return checkAndRenderPermissionStatus('accessibility', request);
}

function checkAndRenderMicrophoneStatus(request = false): Promise<MicrophonePermissionStatus> {
  return checkAndRenderPermissionStatus('microphone', request);
}

async function refreshPermissionStatuses(options: { requestAccessibility?: boolean; requestMicrophone?: boolean } = {}): Promise<{
  accessibility: AccessibilityPermissionStatus;
  microphone: MicrophonePermissionStatus;
}> {
  const [accessibility, microphone] = await Promise.all([
    checkAndRenderAccessibilityStatus(options.requestAccessibility),
    checkAndRenderMicrophoneStatus(options.requestMicrophone)
  ]);

  return { accessibility, microphone };
}

let permissionRefreshTimerId: number | null = null;

function schedulePermissionRefresh(): void {
  if (!isTauriRuntime()) return;
  ++permissionCheckSequence.accessibility;
  ++permissionCheckSequence.microphone;
  lastAccessibilityStatus = null;
  lastMicrophoneStatus = null;
  renderOnboardingPermissionStatuses();
  if (permissionRefreshTimerId !== null) {
    window.clearTimeout(permissionRefreshTimerId);
  }
  permissionRefreshTimerId = window.setTimeout(() => {
    permissionRefreshTimerId = null;
    void refreshPermissionStatuses().catch(() => { /* Each permission renders its own error. */ });
  }, 160);
}

async function openAccessibilitySettingsFromUi(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const permissionStatus = await checkAndRenderAccessibilityStatus(true);
    if (permissionStatus.is_granted) {
      setStatusMessage('Accessibility enabled.');
      return;
    }

    const message = await invokeCommand<string>('open_accessibility_settings');
    setStatusMessage(message);
    syncPermissionSetupBanner();
  } catch (error) {
    setStatusMessage('Could not open Accessibility. Open System Settings > Privacy & Security > Accessibility.');
  } finally {
    button.disabled = Boolean(
      lastAccessibilityStatus && (!lastAccessibilityStatus.is_supported || lastAccessibilityStatus.is_granted)
    );
    renderOnboardingPermissionStatuses();
  }
}

async function openMicrophoneSettingsFromUi(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const permissionStatus = await checkAndRenderMicrophoneStatus(true);
    if (permissionStatus.is_granted) {
      setStatusMessage('Microphone enabled.');
      return;
    }

    if (permissionStatus.status === 'not_determined') {
      setStatusMessage(
        `No microphone prompt appeared. Quit and reopen ${APP_BRAND.displayName}, then click Request access again.`
      );
      syncPermissionSetupBanner();
      return;
    }

    const message = await invokeCommand<string>('open_microphone_settings');
    setStatusMessage(message);
    syncPermissionSetupBanner();
  } catch (error) {
    setStatusMessage(
      `Could not open Microphone. Click Request access first, then use System Settings after ${APP_BRAND.displayName} appears.`
    );
  } finally {
    button.disabled = Boolean(lastMicrophoneStatus && (!lastMicrophoneStatus.is_supported || lastMicrophoneStatus.is_granted));
    renderOnboardingPermissionStatuses();
  }
}

async function ensureOnboardingPermissionsReady(): Promise<boolean> {
  let accessibility = await checkAndRenderAccessibilityStatus();
  let microphone = await checkAndRenderMicrophoneStatus();

  if (microphone.is_supported && !microphone.is_granted && microphone.status === 'not_determined') {
    microphone = await checkAndRenderMicrophoneStatus(true);
  }

  if (accessibility.is_supported && !accessibility.is_granted) {
    accessibility = await checkAndRenderAccessibilityStatus(true);
  }

  const missing = [];
  if (accessibility.is_supported && !accessibility.is_granted) missing.push('Accessibility');
  if (microphone.is_supported && !microphone.is_granted) missing.push('Microphone');
  if (missing.length === 0) return true;

  setStatusMessage(
    missing[0] === 'Accessibility'
      ? `Turn ${APP_BRAND.displayName} on in Accessibility.`
      : microphoneGuidance(microphone)
  );
  syncPermissionSetupBanner();
  if (accessibility.is_supported && !accessibility.is_granted) {
    await invokeCommand<string>('open_accessibility_settings').catch(() => null);
  } else if (microphone.is_supported && !microphone.is_granted && microphone.status !== 'not_determined') {
    await invokeCommand<string>('open_microphone_settings').catch(() => null);
  }
  return false;
}

function normalizeShortcutList(shortcuts: string[], slot: ShortcutSlot): string[] {
  const normalized = shortcuts
    .map((shortcut) => normalizeHotkeyInput(shortcut))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [defaultHotkeyForSlot(slot)];
}

function shortcutValuesForSlot(
  config: Pick<Settings, ShortcutField>,
  slot: ShortcutSlot
): string[] {
  return config[SHORTCUT_FIELDS[slot]];
}

function withShortcutValues(
  config: ShortcutConfig,
  slot: ShortcutSlot,
  shortcuts: string[]
): ShortcutConfig {
  return { ...config, [SHORTCUT_FIELDS[slot]]: normalizeShortcutList(shortcuts, slot) };
}

const ICON_PATHS = {
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20.5"/>',
  pencil: '<path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="m13.5 6.5 3 3"/>',
  copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  folder: '<path d="M4 7.5a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  retry: '<path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4"/>'
} as const;

function iconSvg(name: keyof typeof ICON_PATHS): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function clonePrompts(prompts: RewritePrompt[]): RewritePrompt[] {
  return prompts.map((prompt) => ({ ...prompt }));
}

function isCompletePrompt(prompt: RewritePrompt): boolean {
  return prompt.name.trim().length > 0 && prompt.prompt.trim().length > 0;
}

/// Prompts that are ready to save; half-filled new cards stay local drafts.
function completeRewritePrompts(): RewritePrompt[] {
  return rewritePrompts
    .filter(isCompletePrompt)
    .map((prompt) => ({ ...prompt, name: prompt.name.trim(), prompt: prompt.prompt.trim() }));
}

function setRewritePrompts(prompts: RewritePrompt[]): void {
  rewritePrompts = clonePrompts(prompts);
  savedRewritePrompts = clonePrompts(prompts);
  setRewriteValidation('');
  renderRewritePrompts();
}

function rewritePromptsDirty(): boolean {
  return JSON.stringify(completeRewritePrompts()) !== JSON.stringify(savedRewritePrompts);
}

function setRewriteValidation(message: string): void {
  rewriteValidationEl.textContent = message;
  rewriteValidationEl.classList.toggle('hidden', message.trim().length === 0);
}

function setRewriteSaveState(message: string): void {
  rewriteSaveStateEl.textContent = message;
}

function validateRewritePrompts(): string | null {
  for (const prompt of completeRewritePrompts()) {
    const hotkeyError = validateHotkey(prompt.hotkey);
    if (hotkeyError) return `“${prompt.name}”: ${hotkeyError}`;
  }
  const shortcuts = [
    ...SHORTCUT_SLOTS.flatMap((slot) => shortcutValuesForSlot(activeConfig, slot)),
    ...completeRewritePrompts().map((prompt) => prompt.hotkey)
  ].map(normalizeHotkeyInput);
  if (new Set(shortcuts).size !== shortcuts.length) return 'Each shortcut must be unique across actions.';
  return null;
}

let rewriteSaveTimer: number | null = null;
let rewriteSaveSequence = 0;

function scheduleRewriteSave(delayMs = 700): void {
  if (rewriteSaveTimer !== null) window.clearTimeout(rewriteSaveTimer);
  rewriteSaveTimer = window.setTimeout(() => {
    rewriteSaveTimer = null;
    void saveRewritePromptsNow();
  }, delayMs);
}

async function saveRewritePromptsNow(): Promise<void> {
  const error = validateRewritePrompts();
  if (error) {
    setRewriteValidation(error);
    setRewriteSaveState('');
    return;
  }
  setRewriteValidation('');
  if (!rewritePromptsDirty()) return;
  const sequence = ++rewriteSaveSequence;
  setRewriteSaveState('Saving…');
  try {
    const saved = await invokeCommand<RewritePrompt[]>('save_rewrite_prompts', { prompts: completeRewritePrompts() });
    if (sequence !== rewriteSaveSequence) return;
    savedRewritePrompts = clonePrompts(saved);
    setRewriteSaveState('Saved');
    renderHomeSide();
  } catch (saveError) {
    if (sequence !== rewriteSaveSequence) return;
    setRewriteValidation(userErrorMessage(saveError));
    setRewriteSaveState('');
  }
}

function unusedRewriteHotkey(): string {
  const taken = new Set(
    [
      ...SHORTCUT_SLOTS.flatMap((slot) => shortcutValuesForSlot(activeConfig, slot)),
      ...rewritePrompts.map((prompt) => prompt.hotkey)
    ].map(normalizeHotkeyInput)
  );
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'R']) {
    const candidate = normalizeHotkeyInput(`Ctrl+Option+${key}`);
    if (!taken.has(candidate)) return candidate;
  }
  return '';
}

function promptUsageCount(name: string): number {
  return historyEntries.filter((entry) => isRewriteEntry(entry) && entry.prompt_name === name).length;
}

function promptUsageLabel(prompt: RewritePrompt): string {
  if (!isCompletePrompt(prompt)) return 'Draft · add a name and prompt';
  const count = promptUsageCount(prompt.name.trim());
  return count === 0 ? 'Not used yet' : `Used ${NUMBER_FORMATTER.format(count)} time${count === 1 ? '' : 's'}`;
}

function updatePromptUsageLabels(): void {
  rewritePromptListEl.querySelectorAll<HTMLElement>('[data-prompt-usage]').forEach((el) => {
    const prompt = rewritePrompts.find((each) => each.id === el.dataset.promptUsage);
    if (prompt) el.textContent = promptUsageLabel(prompt);
  });
}

function renderRewritePrompts(): void {
  const capturing = activeHotkeyCaptureTarget;
  rewriteEmptyEl.hidden = rewritePrompts.length > 0;
  rewritePromptListEl.replaceChildren(
    ...rewritePrompts.map((prompt, index) => {
      const cardEl = document.createElement('article');
      cardEl.className = 'prompt-card';
      cardEl.classList.toggle('is-draft', !isCompletePrompt(prompt));

      const headEl = document.createElement('div');
      headEl.className = 'prompt-card-head';

      const iconEl = document.createElement('span');
      iconEl.className = 'prompt-icon';
      iconEl.innerHTML = iconSvg('pencil');

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'prompt-name';
      nameInput.placeholder = 'Prompt name';
      nameInput.setAttribute('aria-label', 'Prompt name');
      nameInput.value = prompt.name;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-button';
      removeBtn.setAttribute('aria-label', `Delete ${prompt.name || 'prompt'}`);
      removeBtn.title = 'Delete prompt';
      removeBtn.innerHTML = iconSvg('trash');
      removeBtn.addEventListener('click', () => {
        if (activeHotkeyCaptureTarget) stopHotkeyCapture();
        rewritePrompts.splice(index, 1);
        renderRewritePrompts();
        scheduleRewriteSave(0);
      });

      const promptInput = document.createElement('textarea');
      promptInput.className = 'prompt-text';
      promptInput.rows = 4;
      promptInput.placeholder = 'How should the selected text be rewritten?';
      promptInput.setAttribute('aria-label', `${prompt.name || 'Prompt'} instructions`);
      promptInput.value = prompt.prompt;

      const footEl = document.createElement('div');
      footEl.className = 'prompt-card-foot';

      const triggerBtn = document.createElement('button');
      triggerBtn.type = 'button';
      triggerBtn.className = 'shortcut-trigger';
      triggerBtn.setAttribute('aria-label', `Shortcut for ${prompt.name || 'prompt'}`);
      triggerBtn.addEventListener('click', () => {
        startHotkeyCapture({ scope: 'rewrite', index });
      });
      renderHotkeyTrigger(triggerBtn, prompt.hotkey, capturing?.scope === 'rewrite' && capturing.index === index);

      const usageEl = document.createElement('span');
      usageEl.className = 'prompt-usage';
      usageEl.dataset.promptUsage = prompt.id;
      usageEl.textContent = promptUsageLabel(prompt);

      const onEdit = () => {
        cardEl.classList.toggle('is-draft', !isCompletePrompt(prompt));
        usageEl.textContent = promptUsageLabel(prompt);
        removeBtn.setAttribute('aria-label', `Delete ${prompt.name || 'prompt'}`);
        scheduleRewriteSave();
      };
      nameInput.addEventListener('input', () => {
        prompt.name = nameInput.value;
        onEdit();
      });
      promptInput.addEventListener('input', () => {
        prompt.prompt = promptInput.value;
        fitPromptText(promptInput);
        onEdit();
      });

      headEl.append(iconEl, nameInput, removeBtn);
      footEl.append(triggerBtn, usageEl);
      cardEl.append(headEl, promptInput, footEl);
      return cardEl;
    })
  );
  rewritePromptAddBtn.disabled = Boolean(capturing);
  rewritePromptListEl.querySelectorAll<HTMLTextAreaElement>('.prompt-text').forEach(fitPromptText);
}

const PROMPT_TEXT_MAX_HEIGHT = 360;

// Grow the prompt box to its text so short and long prompts read without an inner scrollbar.
function fitPromptText(el: HTMLTextAreaElement): void {
  if (!el.isConnected || el.offsetParent === null) return; // hidden tab: refit when Rewrite opens
  el.style.height = 'auto';
  const height = Math.min(el.scrollHeight + 2, PROMPT_TEXT_MAX_HEIGHT);
  el.style.height = `${height}px`;
  el.style.overflowY = el.scrollHeight + 2 > PROMPT_TEXT_MAX_HEIGHT ? 'auto' : 'hidden';
}

rewritePromptAddBtn.addEventListener('click', () => {
  rewritePrompts.push({ id: crypto.randomUUID(), name: '', hotkey: unusedRewriteHotkey(), prompt: '' });
  setRewriteValidation('');
  renderRewritePrompts();
  rewritePromptListEl.querySelector<HTMLInputElement>('.prompt-card:last-child .prompt-name')?.focus();
});

// ---------- vocabulary ----------

function parseVocabulary(raw: string): string[] {
  const terms: string[] = [];
  for (const term of raw.split(/[\n,，、]/).map((each) => each.trim())) {
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

function setVocabulary(terms: string[]): void {
  vocabularyTerms = [...terms];
  renderVocabulary();
  renderHomeSide();
}

async function saveVocabulary(terms: string[]): Promise<boolean> {
  try {
    setVocabulary(await invokeCommand<string[]>('save_vocabulary', { terms }));
    return true;
  } catch (error) {
    showAppToast(userErrorMessage(error), 'error');
    return false;
  }
}

function renderVocabulary(): void {
  vocabularyCountEl.textContent = NUMBER_FORMATTER.format(vocabularyTerms.length);
  vocabularyEmptyEl.hidden = vocabularyTerms.length > 0;
  vocabularyListEl.replaceChildren(
    ...vocabularyTerms.map((term) => {
      const chipEl = document.createElement('span');
      chipEl.className = 'term-chip';
      const labelEl = document.createElement('span');
      labelEl.textContent = term;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'term-chip-remove';
      removeBtn.setAttribute('aria-label', `Remove ${term}`);
      removeBtn.innerHTML = iconSvg('x');
      removeBtn.addEventListener('click', () => {
        void saveVocabulary(vocabularyTerms.filter((each) => each !== term));
      });
      chipEl.append(labelEl, removeBtn);
      return chipEl;
    })
  );
}

vocabularyRewriteLink.addEventListener('click', () => setActiveTab('rewrite'));

function renderVocabularySuggestions(): void {
  const count = vocabularySuggestions.length;
  vocabularyBadgeEl.hidden = count === 0;
  vocabularyBadgeEl.textContent = String(count);
  vocabularySuggestionsEl.hidden = count === 0;
  vocabularySuggestionListEl.replaceChildren(
    ...vocabularySuggestions.map((suggestion) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'suggestion-row';
      const copyEl = document.createElement('div');
      copyEl.className = 'suggestion-copy';
      const termEl = document.createElement('p');
      termEl.className = 'suggestion-term';
      termEl.textContent = suggestion.term;
      const metaEl = document.createElement('p');
      metaEl.className = 'suggestion-meta';
      metaEl.textContent = [`You changed “${suggestion.original}”`, suggestion.source_app]
        .filter(Boolean)
        .join(' · ');
      copyEl.append(termEl, metaEl);

      const actionsEl = document.createElement('div');
      actionsEl.className = 'buttons';
      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'ui-button ui-button-quiet';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', () => {
        void invokeCommand('dismiss_vocabulary_suggestion', { id: suggestion.id }).catch((error) =>
          showAppToast(userErrorMessage(error), 'error')
        );
      });
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ui-button';
      addBtn.textContent = 'Add';
      addBtn.addEventListener('click', () => {
        void invokeCommand('accept_vocabulary_suggestion', { id: suggestion.id }).catch((error) =>
          showAppToast(userErrorMessage(error), 'error')
        );
      });
      actionsEl.append(dismissBtn, addBtn);
      rowEl.append(copyEl, actionsEl);
      return rowEl;
    })
  );
  renderHomeSide();
}

vocabularyAddForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const additions = parseVocabulary(vocabularyAddInput.value).filter((term) => !vocabularyTerms.includes(term));
  if (additions.length === 0) {
    vocabularyAddInput.value = '';
    return;
  }
  if (await saveVocabulary([...vocabularyTerms, ...additions])) {
    vocabularyAddInput.value = '';
  }
});

function syncPolishingEnabled(): void {
  polishingOptionsFieldset.disabled = !formatEnabledInput.checked;
}

function applyPolishingSettings(settings: Settings): void {
  formatEnabledInput.checked = settings.format_enabled;
  removeFillersInput.checked = settings.polishing.remove_fillers;
  consolidateInput.checked = settings.polishing.consolidate;
  structureInput.checked = settings.polishing.structure;
  syncPolishingEnabled();
}

formatEnabledInput.addEventListener('change', syncPolishingEnabled);

function readSettingsFromForm(): Settings {
  return {
    api_key: apiKeyInput.value.trim(),
    prompt_template: promptTemplateInput.value.trim() || defaultPrompt,
    hold_hotkeys: [...activeConfig.hold_hotkeys],
    toggle_hotkeys: [...activeConfig.toggle_hotkeys],
    rewrite_prompts: clonePrompts(savedRewritePrompts),
    whisper_model: whisperModelInput.value.trim() || 'whisper-1',
    custom_vocabulary: vocabularyTerms.join('\n'),
    format_model: formatModelInput.value.trim() || 'gpt-4o-mini',
    format_enabled: formatEnabledInput.checked,
    polishing: {
      remove_fillers: removeFillersInput.checked,
      consolidate: consolidateInput.checked,
      structure: structureInput.checked
    },
    skip_formatter_in_terminals: skipFormatterInTerminalsInput.checked,
    include_clipboard_context: includeClipboardContextInput.checked,
    play_sound_cues: playSoundCuesInput.checked,
    api_base_url: normalizeBaseUrlForSettingsInput(apiBaseUrlInput.value),
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  };
}

function currentSettingsConfig(): ShortcutConfig {
  return {
    hold_hotkeys: [...activeConfig.hold_hotkeys],
    toggle_hotkeys: [...activeConfig.toggle_hotkeys],
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  };
}

function currentShortcutValues(slot: ShortcutSlot): string[] {
  return [...shortcutValuesForSlot(activeConfig, slot)];
}

function savedShortcutValues(slot: ShortcutSlot): string[] {
  return [...savedShortcutConfig[slot]];
}

function updateSavedShortcutConfig(config: Pick<Settings, ShortcutField>): void {
  savedShortcutConfig = {
    hold: normalizeShortcutList(config.hold_hotkeys, 'hold'),
    toggle: normalizeShortcutList(config.toggle_hotkeys, 'toggle')
  };
}

function renderShortcutDirtyState(): void {
  const shortcutsEqual = (left: string[], right: string[]) =>
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
  let anyDirty = false;
  for (const slot of SHORTCUT_SLOTS) {
    const dirty = !shortcutsEqual(currentShortcutValues(slot), savedShortcutValues(slot));
    shortcutListEls[slot].classList.toggle('is-dirty', dirty);
    anyDirty ||= dirty;
  }
  shortcutDirtyIndicatorEl.classList.toggle('hidden', !anyDirty);
  saveSettingsBtn.classList.toggle('is-dirty', anyDirty);
  saveSettingsBtn.textContent = anyDirty ? 'Save changes' : 'Save';
}

function setSettingsHotkeyValidation(slot: ShortcutSlot, message: string, isError = false): void {
  const el = hotkeyValidationEls[slot];
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.toggle('hidden', message.trim().length === 0);
}

function validateDistinctHotkeys(): string | null {
  const shortcuts = [
    ...SHORTCUT_SLOTS.flatMap((slot) => shortcutValuesForSlot(activeConfig, slot)),
    ...rewritePrompts.map((prompt) => prompt.hotkey)
  ].map(normalizeHotkeyInput);
  return new Set(shortcuts).size === shortcuts.length
    ? null
    : 'Each shortcut must be unique across actions.';
}

function validateSettingsHotkeyInput(slot: ShortcutSlot): string | null {
  const shortcuts = shortcutValuesForSlot(activeConfig, slot);
  if (shortcuts.length === 0) {
    const emptyMessage = 'Add at least one shortcut.';
    setSettingsHotkeyValidation(slot, emptyMessage, true);
    renderShortcutDirtyState();
    return emptyMessage;
  }

  for (const shortcut of shortcuts) {
    const validationMessage = validateHotkey(shortcut);
    if (validationMessage) {
      setSettingsHotkeyValidation(slot, validationMessage, true);
      renderShortcutDirtyState();
      return validationMessage;
    }
  }

  const distinctError = validateDistinctHotkeys();
  if (distinctError) {
    SHORTCUT_SLOTS.forEach((each) => setSettingsHotkeyValidation(each, distinctError, true));
    renderShortcutDirtyState();
    return distinctError;
  }

  SHORTCUT_SLOTS.forEach((each) => setSettingsHotkeyValidation(each, '', false));
  renderShortcutDirtyState();
  return null;
}

function validateOnboardingHotkeyInput(): string | null {
  const validationMessage = validateHotkey(onboardingHotkeyInput.value);
  if (validationMessage) {
    setOnboardingHotkeyValidation(validationMessage, true);
    return validationMessage;
  }

  onboardingHotkeyInput.value = normalizeHotkeyInput(onboardingHotkeyInput.value);
  renderOnboardingHotkeyTrigger(onboardingHotkeyInput.value, activeHotkeyCaptureTarget?.scope === 'onboarding');
  setOnboardingHotkeyValidation('', false);
  return null;
}

function sameCaptureTarget(left: HotkeyCaptureTarget | null, right: HotkeyCaptureTarget): boolean {
  if (!left) return false;
  if (left.scope !== right.scope) return false;
  if (left.scope === 'onboarding' && right.scope === 'onboarding') return true;
  if (left.scope === 'rewrite' && right.scope === 'rewrite') return left.index === right.index;
  if (left.scope === 'settings' && right.scope === 'settings') {
    return left.slot === right.slot && left.index === right.index;
  }
  return false;
}

function setActiveHotkeyCaptureValidation(target: HotkeyCaptureTarget, message: string, isError = false): void {
  if (target.scope === 'settings') {
    setSettingsHotkeyValidation(target.slot, message, isError);
  } else if (target.scope === 'rewrite') {
    setRewriteValidation(isError ? message : '');
  } else {
    setOnboardingHotkeyValidation(message, isError);
  }
}

function syncHotkeyCaptureRegistration(active: boolean, target: HotkeyCaptureTarget): void {
  void invokeCommand<void>('set_hotkey_capture_mode', { active }).catch((error) => {
    if (!active || !sameCaptureTarget(activeHotkeyCaptureTarget, target)) return;
    setActiveHotkeyCaptureValidation(target, userErrorMessage(error), false);
  });
}

function commitCapturedHotkey(candidate: string): void {
  const target = activeHotkeyCaptureTarget;
  if (!target) return;

  if (!hotkeyHasNonModifier(candidate)) {
    return;
  }
  const validationMessage = validateHotkey(candidate);
  if (validationMessage) {
    setActiveHotkeyCaptureValidation(target, validationMessage, true);
    return;
  }

  if (target.scope === 'settings') {
    const slot = target.slot;
    const shortcuts = shortcutValuesForSlot(activeConfig, slot);
    const nextShortcuts =
      target.index === null
        ? [...shortcuts, candidate]
        : shortcuts.map((shortcut, index) => (index === target.index ? candidate : shortcut));
    applyConfigUi(withShortcutValues(currentSettingsConfig(), slot, nextShortcuts));
    SHORTCUT_SLOTS.forEach(validateSettingsHotkeyInput);
  } else if (target.scope === 'rewrite') {
    const prompt = rewritePrompts[target.index];
    if (prompt) prompt.hotkey = candidate;
    scheduleRewriteSave(0);
  } else {
    onboardingHotkeyInput.value = candidate;
    if (!validateOnboardingHotkeyInput()) void saveOnboardingSelections();
  }
  stopHotkeyCapture('Hotkey captured.', false);
}

function stopHotkeyCapture(message?: string, isError = false): void {
  if (!activeHotkeyCaptureTarget) return;
  syncHotkeyCaptureRegistration(false, activeHotkeyCaptureTarget);
  if (activeHotkeyCaptureTarget.scope === 'settings') {
    SHORTCUT_SLOTS.forEach((slot) => {
      shortcutAddBtns[slot].disabled = false;
    });
    setSettingsHotkeyValidation(activeHotkeyCaptureTarget.slot, isError ? message || '' : '', isError);
  } else if (activeHotkeyCaptureTarget.scope === 'rewrite') {
    setRewriteValidation(isError ? message || '' : '');
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation(isError ? message || '' : '', isError);
  }
  activeHotkeyCaptureTarget = null;
  applyConfigUi({
    ...currentSettingsConfig()
  });
  renderRewritePrompts();
}

function startHotkeyCapture(target: HotkeyCaptureTarget): void {
  if (activeHotkeyCaptureTarget) {
    stopHotkeyCapture();
  }
  activeHotkeyCaptureTarget = target;
  if (target.scope === 'settings') {
    setSettingsHotkeyValidation(target.slot, '', false);
  } else if (target.scope === 'rewrite') {
    setRewriteValidation('');
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation('', false);
  }
  syncHotkeyCaptureRegistration(true, target);
  applyConfigUi({
    ...currentSettingsConfig()
  });
  renderRewritePrompts();
}

function setupHotkeyCapture(): void {
  SHORTCUT_SLOTS.forEach((slot) => {
    shortcutAddBtns[slot].addEventListener('click', () => {
      startHotkeyCapture({ scope: 'settings', slot, index: null });
    });
  });
  onboardingHotkeyCaptureBtn.addEventListener('click', () => {
    startHotkeyCapture({ scope: 'onboarding' });
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (!activeHotkeyCaptureTarget) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        stopHotkeyCapture('Hotkey capture canceled.', false);
        return;
      }

      commitCapturedHotkey(hotkeyFromKeyboardEvent(event));
    },
    true
  );
}

async function saveSettingsPayload(payload: Settings, successMessage = 'Saved settings.'): Promise<boolean> {
  try {
    setStatusMessage('Saving settings');
    await invokeCommand('save_settings', { settings: payload });
    const [savedSettings, runtimeStatus] = await Promise.all([
      invokeCommand<Settings>('get_settings'),
      invokeCommand<RuntimeStatus>('get_runtime_status')
    ]);
    applyConfigUi(savedSettings);
    updateSavedShortcutConfig(savedSettings);
    apiKeyInput.value = savedSettings.api_key;
    savedApiKey = savedSettings.api_key;
    setApiKeyEditorOpen(false);
    applyPolishingSettings(savedSettings);
    renderStatus(runtimeStatus);
    setStatusMessage(successMessage);
    renderShortcutDirtyState();
    return true;
  } catch (error) {
    const errorText = userErrorMessage(error);
    const normalizedError = errorText.toLowerCase();
    if (errorText.includes('\u201c') || normalizedError.includes('rewrite prompt')) {
      setActiveTab('rewrite');
      setRewriteValidation(errorText);
      setStatusMessage(errorText);
      return false;
    }
    if (isShortcutRelatedMessage(errorText)) {
      focusShortcutSettings();
      const errorSlot = SHORTCUT_SLOTS.find((slot) =>
        normalizedError.includes(SHORTCUT_ACTION_LABELS[slot])
      );
      SHORTCUT_SLOTS.forEach((slot) => {
        const showsError = !errorSlot || slot === errorSlot;
        setSettingsHotkeyValidation(slot, showsError ? errorText : '', showsError);
      });
      setStatusMessage(errorText);
      return false;
    }
    setStatusMessage(`Settings were not saved: ${errorText}`);
    return false;
  }
}

async function saveOnboardingSelections(): Promise<boolean> {
  if (applyOnboardingSelectionsToSettingsForm()) return false;
  return saveSettingsPayload(readSettingsFromForm(), 'Settings saved.');
}

/// The first dictation during the Try step is the proof that setup worked.
function checkOnboardingTry(entries: TranscriptHistoryEntry[]): void {
  if (onboardingModalEl.classList.contains('hidden') || onboardingStepOrder[onboardingStepIndex] !== 'try') return;
  const attempt = entries.find((entry) => entry.created_at_ms >= onboardingTryStartedAt && !isRewriteEntry(entry));
  if (!attempt) return;
  onboardingTryResultEl.hidden = false;
  // History is written before the text is inserted. Give insertion time to land in the focused
  // practice area, and fill it only if it never arrived, so the text never shows up twice.
  const text = attempt.final_output.trim();
  window.setTimeout(() => {
    if (!onboardingTryInput.value.includes(text)) onboardingTryInput.value = text;
  }, ONBOARDING_TRY_FILL_DELAY_MS);
}

function applyOnboardingSelectionsToSettingsForm(): string | null {
  const onboardingApiError = validateOnboardingApiStep();
  if (onboardingApiError) {
    setStatusMessage(onboardingApiError);
    onboardingStepIndex = onboardingStepOrder.indexOf('api');
    updateOnboardingStep();
    if (validateOnboardingApiKey(onboardingApiKeyInput.value)) {
      onboardingApiKeyInput.focus();
    } else {
      onboardingApiBaseUrlInput.focus();
    }
    return onboardingApiError;
  }

  const onboardingHotkey = normalizeHotkeyInput(onboardingHotkeyInput.value);
  const onboardingHotkeyError = validateHotkey(onboardingHotkey);
  if (onboardingHotkeyError) {
    setStatusMessage(onboardingHotkeyError);
    onboardingHotkeyInput.focus();
    return onboardingHotkeyError;
  }

  apiKeyInput.value = onboardingApiKeyInput.value.trim();
  renderApiKeyControl();
  apiBaseUrlInput.value = normalizeBaseUrlForSettingsInput(onboardingApiBaseUrlInput.value);
  activeConfig = withShortcutValues(currentSettingsConfig(), 'hold', [onboardingHotkey]);
  SHORTCUT_SLOTS.forEach(validateSettingsHotkeyInput);
  applyConfigUi({
    ...currentSettingsConfig()
  });
  return null;
}

function countTranscriptWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (WORD_SEGMENTER) {
    let count = 0;
    for (const segment of WORD_SEGMENTER.segment(trimmed)) {
      if (segment.isWordLike) {
        count += 1;
      }
    }
    return count;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function formatSavedTime(minutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(minutes));
  if (roundedMinutes < 60) return `${roundedMinutes}m`;
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function isRewriteEntry(entry: TranscriptHistoryEntry): boolean {
  return entry.source === 'rewrite';
}

function computeHistoryStats(entries: TranscriptHistoryEntry[]): {
  dictatedWords: number;
  rewrittenWords: number;
  estimatedMinutesSaved: number;
  streakDays: number;
} {
  let dictatedWords = 0;
  let rewrittenWords = 0;
  for (const entry of entries) {
    const words = countTranscriptWords(entry.final_output);
    if (isRewriteEntry(entry)) rewrittenWords += words;
    else dictatedWords += words;
  }
  // Dictation saves the gap between typing and speaking; a rewrite saves retyping its output.
  const dictationSaved = dictatedWords / ESTIMATED_TYPING_WPM - dictatedWords / ESTIMATED_DICTATION_WPM;
  const rewriteSaved = rewrittenWords / ESTIMATED_TYPING_WPM;

  const activeDays = new Set(entries.map((entry) => historyDayKey(entry.created_at_ms)));
  const cursor = new Date();
  if (!activeDays.has(historyDayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streakDays = 0;
  while (activeDays.has(historyDayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    dictatedWords,
    rewrittenWords,
    estimatedMinutesSaved: Math.max(0, dictationSaved + rewriteSaved),
    streakDays
  };
}

function appToastIconSvg(tone: AppToastTone): string {
  if (tone === 'error') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 6.5 17.5 17.5"></path>
        <path d="M17.5 6.5 6.5 17.5"></path>
      </svg>
    `;
  }
  return `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.5 9.5 17 19 7.5"></path>
    </svg>
  `;
}

function showAppToast(message: string, tone: AppToastTone = 'success'): void {
  if (appToastTimeoutId !== null) {
    window.clearTimeout(appToastTimeoutId);
    appToastTimeoutId = null;
  }
  appToastEl.dataset.tone = tone;
  appToastIconEl.innerHTML = appToastIconSvg(tone);
  appToastTextEl.textContent = message;
  appToastEl.classList.add('is-visible');
  appToastEl.setAttribute('aria-hidden', 'false');
  appToastTimeoutId = window.setTimeout(() => {
    appToastEl.classList.remove('is-visible');
    appToastEl.setAttribute('aria-hidden', 'true');
    appToastTimeoutId = null;
  }, APP_TOAST_TIMEOUT_MS);
}

function markHistoryEntryCopied(entryId: number): void {
  historyCopiedEntryId = entryId;
  if (historyCopyFeedbackTimeoutId !== null) {
    window.clearTimeout(historyCopyFeedbackTimeoutId);
    historyCopyFeedbackTimeoutId = null;
  }
  historyCopyFeedbackTimeoutId = window.setTimeout(() => {
    historyCopiedEntryId = null;
    historyCopyFeedbackTimeoutId = null;
    renderHistory(historyEntries);
  }, HISTORY_COPY_FEEDBACK_TIMEOUT_MS);
}

async function handleHistoryEntryCopy(entry: TranscriptHistoryEntry): Promise<void> {
  historySelectedEntryId = entry.id;
  renderHistory(historyEntries);
  try {
    await invokeCommand('copy_text_to_clipboard', { text: entry.final_output });
    markHistoryEntryCopied(entry.id);
    showAppToast('Copied');
  } catch (error) {
    showAppToast('Copy failed', 'error');
    setStatusMessage(`Copy failed: ${userErrorMessage(error)}`);
  } finally {
    renderHistory(historyEntries);
  }
}

function createTranscriptRow(
  entry: TranscriptHistoryEntry,
  options: {
    active?: boolean;
    onMainClick?: (() => void) | null;
    isCopied?: boolean;
    showDate?: boolean;
  } = {}
): HTMLDivElement {
  const rewrite = isRewriteEntry(entry);
  const rowEl = document.createElement('div');
  rowEl.className = 'history-row';
  rowEl.classList.toggle('is-active', Boolean(options.active));

  const mainEl = document.createElement('button');
  mainEl.type = 'button';
  mainEl.className = 'history-row-main';
  mainEl.setAttribute('aria-label', `Copy ${rewrite ? 'rewrite' : 'transcript'} from ${formatHistoryTime(entry.created_at_ms)}`);
  if (options.onMainClick) mainEl.addEventListener('click', options.onMainClick);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'history-row-body';
  const textEl = document.createElement('p');
  textEl.className = 'history-row-text';
  textEl.textContent = entry.final_output.trim() || 'Empty';
  bodyEl.append(textEl);
  if (rewrite && entry.original_text?.trim()) {
    const originalEl = document.createElement('p');
    originalEl.className = 'history-row-original';
    originalEl.textContent = entry.original_text.trim();
    bodyEl.append(originalEl);
  }
  const metaEl = document.createElement('p');
  metaEl.className = 'history-row-meta';
  const when = options.showDate
    ? `${formatHistoryDayLabel(entry.created_at_ms)}, ${formatHistoryTime(entry.created_at_ms)}`
    : formatHistoryTime(entry.created_at_ms);
  metaEl.classList.toggle('is-rewrite', rewrite);
  metaEl.innerHTML = iconSvg(rewrite ? 'pencil' : 'mic');
  metaEl.append(
    [when, entry.source_app?.trim(), rewrite ? entry.prompt_name : null].filter(Boolean).join(' · ')
  );
  bodyEl.append(metaEl);

  const indicatorEl = document.createElement('span');
  indicatorEl.className = `history-row-indicator${options.isCopied ? ' is-copied' : ''}`;
  indicatorEl.innerHTML = iconSvg(options.isCopied ? 'check' : 'copy');
  indicatorEl.title = options.isCopied ? 'Copied' : 'Copy';

  mainEl.append(bodyEl, indicatorEl);
  rowEl.append(mainEl);
  return rowEl;
}

function renderActivityChart(): void {
  const days: { key: string; date: Date; dictation: number; rewrite: number }[] = [];
  for (let offset = ACTIVITY_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    days.push({ key: historyDayKey(date.getTime()), date, dictation: 0, rewrite: 0 });
  }
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const entry of historyEntries) {
    const day = byKey.get(historyDayKey(entry.created_at_ms));
    if (!day) continue;
    const words = countTranscriptWords(entry.final_output);
    if (isRewriteEntry(entry)) day.rewrite += words;
    else day.dictation += words;
  }
  const max = Math.max(1, ...days.map((day) => day.dictation + day.rewrite));
  const rangeFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  homeActivitySummaryEl.textContent = `${days[0].date.toLocaleDateString([], rangeFormat)} – ${days[days.length - 1].date.toLocaleDateString([], rangeFormat)}`;
  homeActivityChartEl.replaceChildren(
    ...days.map((day, index) => {
      const columnEl = document.createElement('div');
      columnEl.className = 'chart-col';
      columnEl.classList.toggle('is-today', index === days.length - 1);
      const dayTotal = day.dictation + day.rewrite;
      const dayLabel = day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      columnEl.title = dayTotal
        ? `${dayLabel}\nDictated ${NUMBER_FORMATTER.format(day.dictation)} · Rewritten ${NUMBER_FORMATTER.format(day.rewrite)} words`
        : `${dayLabel}\nNo activity`;
      const barEl = document.createElement('div');
      barEl.className = 'chart-bar';
      barEl.classList.toggle('is-empty', dayTotal === 0);
      // Rewrites stack on top of dictation; empty segments are left out so the gap and rounding stay right.
      for (const [kind, value] of [['rewrite', day.rewrite], ['dictation', day.dictation]] as const) {
        if (value <= 0) continue;
        const segEl = document.createElement('span');
        segEl.className = `chart-seg is-${kind}`;
        segEl.style.height = `${(value / max) * 100}%`;
        barEl.append(segEl);
      }
      const labelEl = document.createElement('span');
      labelEl.className = 'chart-label';
      labelEl.textContent = day.date.toLocaleDateString([], { weekday: 'narrow' });
      columnEl.append(barEl, labelEl);
      return columnEl;
    })
  );
}

function renderHomeSide(): void {
  homeRewriteListEl.replaceChildren();
  if (savedRewritePrompts.length === 0) {
    const emptyEl = document.createElement('p');
    emptyEl.className = 'card-body-text';
    emptyEl.textContent = 'No prompts yet';
    homeRewriteListEl.append(emptyEl);
  }
  for (const prompt of savedRewritePrompts) {
    const rowEl = document.createElement('div');
    rowEl.className = 'mini-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'mini-row-label';
    nameEl.textContent = prompt.name;
    const keysEl = document.createElement('span');
    keysEl.className = 'shortcut-keyset';
    renderShortcutSummary(keysEl, [prompt.hotkey]);
    rowEl.append(nameEl, keysEl);
    homeRewriteListEl.append(rowEl);
  }
  const termCount = vocabularyTerms.length;
  const suggestionCount = vocabularySuggestions.length;
  homeVocabularySummaryEl.textContent = [
    termCount === 0 ? 'No terms yet' : `${NUMBER_FORMATTER.format(termCount)} term${termCount === 1 ? '' : 's'}`,
    suggestionCount > 0 ? `${suggestionCount} suggested` : null
  ]
    .filter(Boolean)
    .join(' · ');
}

function renderHomeOverview(): void {
  // The totals are the chart's legend, so they cover the same 14 days.
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (ACTIVITY_DAYS - 1));
  const stats = computeHistoryStats(historyEntries.filter((entry) => entry.created_at_ms >= windowStart.getTime()));
  const streakDays = computeHistoryStats(historyEntries).streakDays;
  homeStatWordsEl.textContent = NUMBER_FORMATTER.format(stats.dictatedWords);
  homeStatRewrittenEl.textContent = NUMBER_FORMATTER.format(stats.rewrittenWords);
  homeStatSavedEl.textContent = formatSavedTime(stats.estimatedMinutesSaved);
  homeStatStreakEl.textContent = NUMBER_FORMATTER.format(streakDays);
  homeStatStreakUnitEl.textContent = streakDays === 1 ? 'day' : 'days';
  renderActivityChart();
  renderHomeSide();

  const recentEntries = historyEntries.slice(0, HOME_RECENT_LIMIT);
  homeRecentEmptyEl.hidden = recentEntries.length > 0;
  homeRecentFeedEl.replaceChildren(
    ...recentEntries.map((entry) =>
      createTranscriptRow(entry, {
        showDate: true,
        isCopied: entry.id === historyCopiedEntryId,
        onMainClick: () => {
          void handleHistoryEntryCopy(entry);
        }
      })
    )
  );
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatHistoryTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function historyDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatHistoryDayLabel(timestampMs: number): string {
  const entryDate = new Date(timestampMs);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(entryDate, today)) return 'Today';
  if (isSameCalendarDay(entryDate, yesterday)) return 'Yesterday';
  return entryDate.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: entryDate.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  });
}

function groupHistoryEntries(entries: TranscriptHistoryEntry[]): HistoryDayGroup[] {
  const groups: HistoryDayGroup[] = [];
  for (const entry of entries) {
    const key = historyDayKey(entry.created_at_ms);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.key !== key) {
      groups.push({
        key,
        label: formatHistoryDayLabel(entry.created_at_ms),
        entries: [entry]
      });
      continue;
    }
    lastGroup.entries.push(entry);
  }
  return groups;
}

function getVisibleHistoryEntries(): TranscriptHistoryEntry[] {
  const query = historySearchInput.value.trim().toLowerCase();
  return historyEntries.filter((entry) => {
    if (historyFilter === 'rewrite' && !isRewriteEntry(entry)) return false;
    if (historyFilter === 'dictation' && isRewriteEntry(entry)) return false;
    if (!query) return true;
    const haystack = `${entry.final_output} ${entry.original_text || ''} ${entry.source_app || ''} ${entry.prompt_name || ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function formatTranscriptCount(count: number, label = 'transcript'): string {
  return `${NUMBER_FORMATTER.format(count)} ${label}${count === 1 ? '' : 's'}`;
}

function renderHistory(entries: TranscriptHistoryEntry[]): void {
  historyEntries = [...entries].sort((a, b) => b.created_at_ms - a.created_at_ms);
  renderHomeOverview();
  const visibleEntries = getVisibleHistoryEntries();
  historyCountEl.textContent = formatTranscriptCount(visibleEntries.length, 'item');
  updatePromptUsageLabels();
  if (historySelectedEntryId && !visibleEntries.some((entry) => entry.id === historySelectedEntryId)) {
    historySelectedEntryId = null;
  }

  historyFeedEl.innerHTML = '';
  historyEmptyEl.hidden = visibleEntries.length > 0;
  const remaining = visibleEntries.length - historyLimit;
  historyMoreBtn.hidden = remaining <= 0;
  if (visibleEntries.length === 0) {
    historyEmptyEl.textContent = historyEntries.length === 0 ? HISTORY_EMPTY_TEXT : 'No matches.';
    return;
  }
  historyEmptyEl.textContent = HISTORY_EMPTY_TEXT;

  const groupedEntries = groupHistoryEntries(visibleEntries.slice(0, historyLimit));
  let selectedRow: HTMLDivElement | null = null;

  for (const group of groupedEntries) {
    const groupEl = document.createElement('section');
    groupEl.className = 'history-day-group';

    const dayLabelEl = document.createElement('p');
    dayLabelEl.className = 'history-day-label';
    dayLabelEl.textContent = group.label;

    const dayCardEl = document.createElement('div');
    dayCardEl.className = 'history-day-card';

    for (const entry of group.entries) {
      const rowEl = createTranscriptRow(entry, {
        active: entry.id === historySelectedEntryId,
        isCopied: entry.id === historyCopiedEntryId,
        onMainClick: () => {
          void handleHistoryEntryCopy(entry);
        }
      });
      if (entry.id === historySelectedEntryId) {
        historySelectedEntryId = entry.id;
        selectedRow = rowEl;
      }
      dayCardEl.append(rowEl);
    }

    groupEl.append(dayLabelEl, dayCardEl);
    historyFeedEl.append(groupEl);
  }

  if (selectedRow && shouldScrollHistorySelection) {
    requestAnimationFrame(() => {
      selectedRow?.scrollIntoView({ block: 'center' });
    });
  }
  shouldScrollHistorySelection = false;
}

const savedRecordingsEl = document.querySelector<HTMLDetailsElement>('#saved-recordings')!;
const savedRecordingsSummary = document.querySelector<HTMLElement>('#saved-recordings-summary')!;
const savedRecordingsList = document.querySelector<HTMLDivElement>('#saved-recordings-list')!;
const savedRecordingsMoreBtn = document.querySelector<HTMLButtonElement>('#saved-recordings-more-btn')!;
const SAVED_RECORDINGS_PAGE_SIZE = 5;
let savedRecordingsLimit = SAVED_RECORDINGS_PAGE_SIZE;
let savedRecordingEntries: SavedRecording[] = [];
let recordingActionPending = false;
let previousFailedRecordings = '';

async function showSavedRecording(id: string): Promise<void> {
  renderSavedRecordings(await invokeCommand<SavedRecording[]>('get_saved_recordings'));
  const index = savedRecordingEntries.findIndex(entry => entry.id === id);
  if (index >= savedRecordingsLimit) {
    savedRecordingsLimit = index + 1;
    renderSavedRecordings(savedRecordingEntries);
  }
  setActiveTab('history');
  savedRecordingsEl.open = true;
  const row = Array.from(savedRecordingsList.children).find(row => (row as HTMLElement).dataset.recordingId === id) as HTMLElement | undefined;
  row?.scrollIntoView({ block: 'nearest' });
  row?.focus({ preventScroll: true });
}

function renderSavedRecordings(input: SavedRecording[]): void {
  const entries = [...input].sort((a, b) => b.created_at_ms - a.created_at_ms);
  savedRecordingEntries = entries;
  savedRecordingsEl.hidden = entries.length === 0;
  const failed = entries.filter(entry => entry.status === 'failed').map(entry => entry.id).join(',');
  if (failed && failed !== previousFailedRecordings) savedRecordingsEl.open = true;
  previousFailedRecordings = failed;
  const unfinished = entries.filter(entry => !['completed', 'recording', 'processing', 'discarded'].includes(entry.status)).length;
  savedRecordingsSummary.textContent = `Saved audio · ${entries.length}${unfinished ? ` · ${unfinished} unfinished` : ''}`;
  savedRecordingsList.replaceChildren();
  savedRecordingsMoreBtn.hidden = entries.length <= savedRecordingsLimit;
  for (const entry of entries.slice(0, savedRecordingsLimit)) {
    const row = document.createElement('div');
    row.className = 'saved-recording-row';
    row.dataset.recordingId = entry.id;
    row.tabIndex = -1;
    const info = document.createElement('div');
    info.className = 'saved-recording-info';
    const title = document.createElement('span');
    title.textContent = new Date(entry.created_at_ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const label = document.createElement('span');
    label.className = 'hint';
    const labels: Record<string, string> = { saved: 'Saved', discarded: 'Discarded', completed: 'Transcribed', processing: 'Transcribing…', recording: 'Recording…', interrupted: 'Interrupted', failed: 'Failed', recovered: 'Recovered', transcribed: 'Transcript saved' };
    label.textContent = [entry.source_app, labels[entry.status] || 'Saved'].filter(Boolean).join(' · ');
    info.append(title, label);
    if (entry.error) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Error details';
      const error = document.createElement('span');
      error.className = 'hint saved-recording-error';
      error.textContent = entry.error;
      details.append(summary, error);
      info.append(details);
    }
    const actions = document.createElement('div');
    actions.className = 'saved-recording-actions';
    const action = (label: string, icon: keyof typeof ICON_PATHS, command: string, args: Record<string, unknown>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = iconSvg(icon);
      button.addEventListener('click', async () => {
        if (recordingActionPending) return;
        recordingActionPending = true;
        updateSavedRecordingButtons();
        try {
          await invokeCommand(command, args);
          if (command === 'copy_text_to_clipboard') showAppToast('Copied', 'success');
        } catch (error) { showAppToast(userErrorMessage(error), 'error'); }
        finally { recordingActionPending = false; updateSavedRecordingButtons(); }
      });
      actions.append(button);
      return button;
    };
    const transcript = entry.transcript || entry.raw_transcript;
    if (transcript) action('Copy text', 'copy', 'copy_text_to_clipboard', { text: transcript });
    action('Show audio file', 'folder', 'reveal_recording', { id: entry.id });
    const retry = action('Transcribe again', 'retry', 'retry_recording', { id: entry.id });
    retry.dataset.retryRecording = 'true';
    row.append(info, actions);
    savedRecordingsList.append(row);
  }
  updateSavedRecordingButtons();
}
function updateSavedRecordingButtons(): void {
  savedRecordingsList.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.disabled = recordingActionPending || Boolean(button.dataset.retryRecording && (lastRuntimeStatus?.is_recording || lastRuntimeStatus?.is_processing || lastRuntimeStatus?.interrupted));
  });
}

async function loadHistory(): Promise<void> {
  const entries = await invokeCommand<TranscriptHistoryEntry[]>('get_transcript_history');
  renderHistory(entries);
}

async function loadInitial(): Promise<void> {
  const settings = await invokeCommand<Settings>('get_settings');
  apiKeyInput.value = settings.api_key;
  savedApiKey = settings.api_key;
  renderApiKeyControl();
  promptTemplateInput.value = settings.prompt_template || defaultPrompt;
  setRewritePrompts(settings.rewrite_prompts);
  updateSavedShortcutConfig(settings);
  whisperModelInput.value = settings.whisper_model;
  setVocabulary(parseVocabulary(settings.custom_vocabulary || ''));
  formatModelInput.value = settings.format_model;
  applyPolishingSettings(settings);
  skipFormatterInTerminalsInput.checked = settings.skip_formatter_in_terminals;
  includeClipboardContextInput.checked = settings.include_clipboard_context;
  playSoundCuesInput.checked = settings.play_sound_cues;
  apiBaseUrlInput.value = settings.api_base_url;
  recordingModeInput.value = normalizeMode(settings.recording_mode);
  languageInput.value = normalizeLanguage(settings.language);
  activeConfig = settings;
  syncOnboardingInputsFromSettings();
  applyConfigUi(settings);
  SHORTCUT_SLOTS.forEach(validateSettingsHotkeyInput);

  const status = await invokeCommand<RuntimeStatus>('get_runtime_status');
  renderStatus(status);
  if (isShortcutRelatedMessage(status.last_message)) {
    focusShortcutSettings();
  }
  await loadHistory();
  vocabularySuggestions = await invokeCommand<VocabularySuggestion[]>('get_vocabulary_suggestions').catch(() => []);
  renderVocabularySuggestions();
  renderSavedRecordings(await invokeCommand<SavedRecording[]>('get_saved_recordings'));

  try {
    await refreshPermissionStatuses();
  } catch { /* Each permission renders its own error. */ }

  const missingPermissions = missingPermissionLabels();
  if (!isOnboardingCompleted() || missingPermissions.length > 0) {
    showOnboarding({
      step: missingPermissions.length > 0 ? 'permissions' : 'welcome'
    });
  }
}

onboardingApiKeyInput.addEventListener('input', () => {
  validateOnboardingApiStep();
});

onboardingApiBaseUrlInput.addEventListener('input', () => {
  validateOnboardingApiStep();
});

onboardingApiBaseUrlFixBtn.addEventListener('click', () => {
  const normalized = onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl;
  if (!normalized) return;
  onboardingApiBaseUrlInput.value = normalized;
  validateOnboardingApiStep();
});

recordingModeInput.addEventListener('change', () => {
  applyConfigUi({
    ...currentSettingsConfig()
  });
});

languageInput.addEventListener('change', () => {
  applyConfigUi({
    ...currentSettingsConfig()
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const hotkeyError =
    SHORTCUT_SLOTS.map(validateSettingsHotkeyInput).find(Boolean) || validateDistinctHotkeys();
  if (hotkeyError) {
    focusShortcutSettings();
    setStatusMessage(hotkeyError);
    return;
  }

  const payload = readSettingsFromForm();
  await saveSettingsPayload(payload);
});

apiKeyEditBtn.addEventListener('click', () => {
  setApiKeyEditorOpen(!apiKeyEditorOpen, !apiKeyEditorOpen);
});

apiKeyInput.addEventListener('input', () => {
  renderApiKeyControl();
});

homeToggleBtn.addEventListener('click', () => {
  void requestToggleRecording();
});

reopenOnboardingBtn.addEventListener('click', () => {
  showOnboarding({
    step: missingPermissionLabels().length > 0 ? 'permissions' : 'welcome'
  });
});

onboardingSkipBtn.addEventListener('click', () => {
  hideOnboarding();
  setStatusMessage('Setup paused. Reopen the setup guide from Settings.');
});

onboardingModalEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || activeHotkeyCaptureTarget) return;
  event.preventDefault();
  hideOnboarding();
  setStatusMessage('Setup paused. Reopen the setup guide from Settings.');
});

onboardingBackBtn.addEventListener('click', () => {
  onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
  updateOnboardingStep();
});

onboardingNextBtn.addEventListener('click', async () => {
  if (onboardingStepOrder[onboardingStepIndex] === 'permissions') {
    const ready = await ensureOnboardingPermissionsReady();
    if (!ready) return;
  }

  if (onboardingStepOrder[onboardingStepIndex] === 'api') {
    const apiError = validateOnboardingApiStep();
    if (apiError) {
      setStatusMessage(apiError);
      if (validateOnboardingApiKey(onboardingApiKeyInput.value)) {
        onboardingApiKeyInput.focus();
      } else {
        onboardingApiBaseUrlInput.focus();
      }
      return;
    }
    // Save now: the Try step dictates for real, so the key and shortcut must be live.
    if (!(await saveOnboardingSelections())) return;
  }
  onboardingStepIndex = Math.min(onboardingStepOrder.length - 1, onboardingStepIndex + 1);
  updateOnboardingStep();
});

onboardingFinishBtn.addEventListener('click', async () => {
  const ready = await ensureOnboardingPermissionsReady();
  if (!ready) {
    onboardingStepIndex = onboardingStepIndexFor('permissions');
    updateOnboardingStep();
    return;
  }

  if (!(await saveOnboardingSelections())) return;

  setOnboardingCompleted(true);
  hideOnboarding();
  setActiveTab('home');
});

onboardingOpenAccessibilitySettingsBtn.addEventListener('click', async () => {
  const button = onboardingOpenAccessibilitySettingsBtn;
  if (lastAccessibilityStatus?.status === 'restart_required') {
    button.disabled = true;
    await invokeCommand('restart_app').catch(() => {
      button.disabled = false;
      setStatusMessage(`Quit and reopen ${APP_BRAND.displayName} to finish enabling Accessibility.`);
    });
    return;
  }
  // Not granted, so there is nothing to lose: clearing Verba's entry first removes
  // a stale switch left by an older build's signature, which would otherwise look
  // on in System Settings but never work. The request then re-adds Verba to the list.
  await invokeCommand<string>('reset_accessibility_permission').catch(() => null);
  await openAccessibilitySettingsFromUi(button);
});

onboardingOpenMicrophoneSettingsBtn.addEventListener('click', async () => {
  await openMicrophoneSettingsFromUi(onboardingOpenMicrophoneSettingsBtn);
});

// While the Access step is open, poll quietly so rows flip to "Allowed" as soon as
// the user turns a switch on in System Settings, without a "Check again" button.

async function pollOnboardingPermissions(): Promise<void> {
  const sequences = { ...permissionCheckSequence };
  const [accessibility, microphone] = await Promise.all([
    invokeCommand<AccessibilityPermissionStatus>('check_accessibility_permission').catch(() => null),
    invokeCommand<MicrophonePermissionStatus>('check_microphone_permission').catch(() => null)
  ]);
  // A click-driven check started meanwhile owns the row; do not overwrite it.
  if (accessibility && sequences.accessibility === permissionCheckSequence.accessibility) {
    renderAccessibilityStatus(accessibility);
  }
  if (microphone && sequences.microphone === permissionCheckSequence.microphone) {
    renderMicrophoneStatus(microphone);
  }
  if (onboardingStepOrder[onboardingStepIndex] === 'permissions' && document.activeElement === document.body) {
    focusOnboardingStep();
  }
}

function syncOnboardingPermissionPolling(): void {
  const active = isTauriRuntime()
    && !onboardingModalEl.classList.contains('hidden')
    && onboardingStepOrder[onboardingStepIndex] === 'permissions';
  if (active && onboardingPermissionPollId === null) {
    onboardingPermissionPollId = window.setInterval(() => { void pollOnboardingPermissions(); }, ONBOARDING_PERMISSION_POLL_MS);
  } else if (!active && onboardingPermissionPollId !== null) {
    window.clearInterval(onboardingPermissionPollId);
    onboardingPermissionPollId = null;
  }
}

window.addEventListener('focus', schedulePermissionRefresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    schedulePermissionRefresh();
  }
});

statusBannerEl.addEventListener('click', () => {
  if (statusBannerEl.dataset.action === 'setup') {
    showPermissionOnboarding();
  } else if (statusBannerEl.dataset.action === 'history' && lastRuntimeStatus?.failure) {
    const id = lastRuntimeStatus.failure.recording_id;
    void showSavedRecording(id).then(() => invokeCommand('dismiss_recording_failure', { id }))
      .catch(error => showAppToast(userErrorMessage(error), 'error'));
  }
});

statusBannerEl.addEventListener('keydown', (event) => {
  if (!statusBannerEl.dataset.action) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  statusBannerEl.click();
});

listenEvent<TranscriptHistoryEntry[]>('transcript-history-updated', (event) => {
  renderHistory(event.payload);
  checkOnboardingTry(event.payload);
}).catch((error) => {
  setStatusMessage(`History listener failed: ${userErrorMessage(error)}`);
});

historySearchInput.addEventListener('input', () => {
  historyLimit = HISTORY_PAGE_SIZE;
  renderHistory(historyEntries);
});

savedRecordingsMoreBtn.addEventListener('click', () => {
  savedRecordingsLimit += SAVED_RECORDINGS_PAGE_SIZE;
  renderSavedRecordings(savedRecordingEntries);
});

historyMoreBtn.addEventListener('click', () => {
  historyLimit += HISTORY_PAGE_SIZE;
  renderHistory(historyEntries);
});

historyFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    historyFilter = (button.dataset.historyFilter as HistoryFilter) || 'all';
    historyLimit = HISTORY_PAGE_SIZE;
    historyFilterButtons.forEach((each) => {
      const active = each === button;
      each.classList.toggle('is-active', active);
      each.setAttribute('aria-checked', String(active));
    });
    renderHistory(historyEntries);
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-go-tab]').forEach((button) => {
  button.addEventListener('click', () => setActiveTab(button.dataset.goTab as WorkspaceTab));
});

listenEvent<Settings>('settings-changed', (event) => {
  setVocabulary(parseVocabulary(event.payload.custom_vocabulary || ''));
  const incoming = event.payload.rewrite_prompts;
  if (JSON.stringify(incoming) !== JSON.stringify(savedRewritePrompts)) {
    const editing = rewritePromptListEl.contains(document.activeElement) || rewriteSaveTimer !== null;
    savedRewritePrompts = clonePrompts(incoming);
    if (!editing) setRewritePrompts(incoming);
    renderHomeSide();
  }
}).catch(() => undefined);

listenEvent<VocabularySuggestion[]>('vocabulary-suggestions-changed', (event) => {
  vocabularySuggestions = event.payload;
  renderVocabularySuggestions();
}).catch(() => undefined);


listenEvent<SavedRecording[]>('recordings-updated', event => renderSavedRecordings(event.payload));
listenEvent<string>('open-recording-history', event => {
  void showSavedRecording(event.payload).catch(error => showAppToast(userErrorMessage(error), 'error'));
});

listenEvent<RuntimeStatus>('runtime-status', (event) => {
  renderStatus(event.payload);
}).catch((error) => {
  setStatusMessage(`Status listener failed: ${userErrorMessage(error)}`);
});

setupTabs();
setupSettingsSections();
setupSidebar();
setupThemePreference();
setupHotkeyCapture();
applyBranding();
syncStatusBannerFromText();

loadInitial().catch((error) => {
  if (!isTauriRuntime()) {
    setStatusMessage(TAURI_RUNTIME_MISSING_MESSAGE);
    return;
  }
  setStatusMessage(`Initialization failed: ${userErrorMessage(error)}`);
});
