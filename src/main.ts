import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { APP_BRAND } from './app-config';

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

type Settings = {
  api_key: string;
  prompt_template: string;
  hold_hotkeys: string[];
  toggle_hotkeys: string[];
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
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
  source_app?: string | null;
  source: string;
  processing_latency_ms?: number | null;
};

type SavedRecording = {
  id: string;
  created_at_ms: number;
  status: string;
  source_app: string | null;
  error: string | null;
  transcript: string | null;
  raw_transcript?: string | null;
};

type DurableDraft = {
  text: string;
  created_at_ms: number;
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
  source_app?: string | null;
};

type HistoryDayGroup = {
  key: string;
  label: string;
  entries: TranscriptHistoryEntry[];
};

type WorkspaceTab = 'home' | 'dictation' | 'history' | 'settings';
type OnboardingStepId = 'welcome' | 'permissions' | 'api' | 'quick-setup' | 'finish';
type ShortcutSlot = 'hold' | 'toggle';
type HotkeyCaptureTarget =
  | { scope: 'settings'; slot: ShortcutSlot; index: number | null }
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
const micLevelValueEl = document.querySelector<HTMLSpanElement>('#mic-level-value')!;
const micLevelBarEl = document.querySelector<HTMLDivElement>('#mic-level-bar')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const saveSettingsBtn = document.querySelector<HTMLButtonElement>('#save-settings-btn')!;
const toggleBtn = document.querySelector<HTMLButtonElement>('#toggle-btn')!;
const draftRestoreBannerEl = document.querySelector<HTMLDivElement>('#draft-restore-banner')!;
const draftRestorePreviewEl = document.querySelector<HTMLParagraphElement>('#draft-restore-preview')!;
const draftRestoreCopyBtn = document.querySelector<HTMLButtonElement>('#draft-restore-copy-btn')!;
const draftRestoreDismissBtn = document.querySelector<HTMLButtonElement>('#draft-restore-dismiss-btn')!;
const apiKeyControlEl = document.querySelector<HTMLElement>('#api-key-control')!;
const apiKeyEditorEl = document.querySelector<HTMLLabelElement>('#api-key-editor')!;
const apiKeyEditBtn = document.querySelector<HTMLButtonElement>('#api-key-edit-btn')!;
const apiKeySummaryEl = document.querySelector<HTMLSpanElement>('#api-key-summary')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#apiKey')!;
const promptTemplateInput = document.querySelector<HTMLTextAreaElement>('#promptTemplate')!;
const whisperModelInput = document.querySelector<HTMLInputElement>('#whisperModel')!;
const customVocabularyInput = document.querySelector<HTMLTextAreaElement>('#customVocabulary')!;
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
const shortcutDirtyIndicatorEl = document.querySelector<HTMLSpanElement>('#shortcut-dirty-indicator')!;
const homeToggleBtn = document.querySelector<HTMLButtonElement>('#home-toggle-btn')!;
const homeStatDaysEl = document.querySelector<HTMLSpanElement>('#home-stat-days')!;
const homeStatWordsEl = document.querySelector<HTMLSpanElement>('#home-stat-words')!;
const homeStatSavedEl = document.querySelector<HTMLSpanElement>('#home-stat-saved')!;
const homeRecentEmptyEl = document.querySelector<HTMLParagraphElement>('#home-recent-empty')!;
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
const onboardingRecordingModeInput = document.querySelector<HTMLSelectElement>('#onboarding-recording-mode')!;
const onboardingHotkeyInput = document.querySelector<HTMLInputElement>('#onboarding-hotkey')!;
const onboardingHotkeyCaptureBtn = document.querySelector<HTMLButtonElement>('#onboarding-hotkey-capture-btn')!;
const onboardingHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-hotkey-validation')!;
const onboardingLanguageInput = document.querySelector<HTMLSelectElement>('#onboarding-language')!;
const onboardingOpenAccessibilitySettingsBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-open-accessibility-settings-btn'
)!;
const onboardingCheckAccessibilityBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-check-accessibility-btn'
)!;
const onboardingResetAccessibilityPermissionBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-reset-accessibility-permission-btn'
)!;
const onboardingCheckMicrophoneBtn = document.querySelector<HTMLButtonElement>('#onboarding-check-microphone-btn')!;
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

let activeConfig: Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys' | 'recording_mode' | 'language'> = {
  hold_hotkeys: ['Cmd+Space'],
  toggle_hotkeys: ['Option+Space'],
  recording_mode: 'hold',
  language: 'auto'
};
let savedShortcutConfig: Record<ShortcutSlot, string[]> = {
  hold: ['Cmd+Space'],
  toggle: ['Option+Space']
};
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
  dictation: 'Dictation',
  history: 'History',
  settings: 'Settings'
};
const onboardingStepOrder: OnboardingStepId[] = ['welcome', 'permissions', 'api', 'quick-setup', 'finish'];
let onboardingStepIndex = 0;
let historyEntries: TranscriptHistoryEntry[] = [];
let historySelectedEntryId: number | null = null;
let historyCopiedEntryId: number | null = null;
let shouldScrollHistorySelection = false;
let durableDraft: DurableDraft | null = null;
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
let lastRenderedRuntimeState: Pick<RuntimeStatus, 'is_recording' | 'is_processing' | 'last_message' | 'failure'> | null = null;
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
  return isThemePreference(stored) ? stored : 'light';
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
  if (status.status === 'dev_terminal' || status.is_granted) return '';
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
  onboardingPermissionsCopyEl.textContent =
    'Click Request access for Microphone. Apps cannot be added manually in System Settings.';
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
    normalized.includes('text captured') ||
    normalized.includes('saved text') ||
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
  if (cleaned.toLowerCase().includes('text captured')) {
    return 'Text captured. Saved text available.';
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
  onboardingRecordingModeInput.value = normalizeMode(recordingModeInput.value);
  onboardingHotkeyInput.value = activeConfig.hold_hotkeys[0] || defaultHotkeyForSlot('hold');
  onboardingLanguageInput.value = normalizeLanguage(languageInput.value);
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

  onboardingBackBtn.disabled = onboardingStepIndex === 0;
  const isLast = onboardingStepIndex === onboardingStepOrder.length - 1;
  onboardingNextBtn.classList.toggle('hidden', isLast);
  onboardingFinishBtn.classList.toggle('hidden', !isLast);
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
      target = onboardingCheckMicrophoneBtn;
    }
  } else if (step === 'api') {
    target = onboardingApiKeyInput.value.trim() ? onboardingApiBaseUrlInput : onboardingApiKeyInput;
  } else if (step === 'quick-setup') {
    target = onboardingHotkeyCaptureBtn;
  } else if (step === 'finish') {
    target = onboardingFinishBtn;
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
  if (onboardingStepOrder[onboardingStepIndex] === 'permissions') {
    void refreshPermissionStatuses();
  }
}

function hideOnboarding(): void {
  if (activeHotkeyCaptureTarget?.scope === 'onboarding') {
    stopHotkeyCapture();
  }
  onboardingModalEl.classList.add('hidden');
  if (preOnboardingFocusEl?.isConnected) {
    preOnboardingFocusEl.focus();
  }
  preOnboardingFocusEl = null;
}

function recordingModeLabel(mode: RecordingMode): string {
  return mode === 'toggle' ? 'Toggle start/stop' : 'Hold to record';
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
    const actionLabel = slot === 'hold' ? 'hold to speak' : 'hands-free';
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
  config: Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys' | 'recording_mode' | 'language'>
): void {
  activeConfig = {
    hold_hotkeys: normalizeShortcutList(config.hold_hotkeys, 'hold'),
    toggle_hotkeys: normalizeShortcutList(config.toggle_hotkeys, 'toggle'),
    recording_mode: normalizeMode(config.recording_mode),
    language: normalizeLanguage(config.language)
  };

  const modeLabel = recordingModeLabel(activeConfig.recording_mode);
  const languageText = languageLabel(activeConfig.language);

  renderShortcutSummary(shortcutHoldHintEl, activeConfig.hold_hotkeys);
  renderShortcutSummary(shortcutToggleHintEl, activeConfig.toggle_hotkeys);
  renderShortcutEditor('hold');
  renderShortcutEditor('toggle');
  renderOnboardingHotkeyTrigger(
    onboardingHotkeyInput.value || activeConfig.hold_hotkeys[0],
    activeHotkeyCaptureTarget?.scope === 'onboarding'
  );
  modeStatusTextEl.textContent = `${modeLabel}. ${languageText}.`;
  renderShortcutDirtyState();
}

function setRecordingActionLabels(
  isRecording: boolean,
  pendingAction: 'starting' | 'stopping' | null = null
): void {
  if (pendingAction === 'starting') {
    toggleBtn.textContent = 'Starting';
    homeToggleBtn.textContent = 'Starting';
    return;
  }

  if (pendingAction === 'stopping') {
    toggleBtn.textContent = 'Stopping';
    homeToggleBtn.textContent = 'Stopping';
    return;
  }

  const label = isRecording ? 'Stop recording' : 'Start recording';
  toggleBtn.textContent = label;
  homeToggleBtn.textContent = label;
}

function runtimeStateChanged(status: RuntimeStatus): boolean {
  return (
    !lastRenderedRuntimeState ||
    lastRenderedRuntimeState.is_recording !== status.is_recording ||
    lastRenderedRuntimeState.is_processing !== status.is_processing ||
    lastRenderedRuntimeState.failure?.recording_id !== status.failure?.recording_id ||
    lastRenderedRuntimeState.last_message !== status.last_message
  );
}

function renderMicLevel(status: RuntimeStatus): void {
  const level = Math.max(0, Math.min(100, Math.round(status.mic_level || 0)));
  micLevelValueEl.textContent = status.is_recording ? `${level}%` : '0%';
  micLevelBarEl.style.width = `${status.is_recording ? level : 0}%`;

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
    last_message: status.last_message
  };

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
  toggleBtn.disabled = disabled;
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
  if (status.is_granted) return 'Enabled';
  return status.guidance;
}

function onboardingMicrophoneLabel(status: MicrophonePermissionStatus | null): string {
  const appName = APP_BRAND.displayName;
  if (!status) return 'Checking';
  if (!status.is_supported) return 'Microphone setup is only available on macOS.';
  if (status.is_granted) return 'Enabled';
  if (status.status === 'check_failed') return status.guidance;
  if (status.status === 'not_determined') {
    return 'Click Request access. macOS will show the permission prompt.';
  }
  if (status.status === 'denied') return `Open Microphone and turn ${appName} on.`;
  if (status.status === 'restricted') return 'Microphone is blocked by macOS policy.';
  return 'Click Request access, then follow the macOS prompt.';
}

function renderOnboardingPermissionStatuses(): void {
  setPermissionUiState(onboardingAccessibilityRowEl, lastAccessibilityStatus);
  setPermissionUiState(onboardingMicrophoneRowEl, lastMicrophoneStatus);
  onboardingAccessibilityStatusEl.textContent = onboardingAccessibilityLabel(lastAccessibilityStatus);
  onboardingMicrophoneStatusEl.textContent = onboardingMicrophoneLabel(lastMicrophoneStatus);
  onboardingResetAccessibilityPermissionBtn.hidden =
    !lastAccessibilityStatus || !lastAccessibilityStatus.is_supported || lastAccessibilityStatus.is_granted;
  onboardingOpenAccessibilitySettingsBtn.disabled =
    Boolean(lastAccessibilityStatus && (!lastAccessibilityStatus.is_supported || lastAccessibilityStatus.is_granted));
  const microphoneActionLabel =
    lastMicrophoneStatus?.status === 'denied' || lastMicrophoneStatus?.status === 'restricted'
      ? 'Open Microphone'
      : 'Request access';
  onboardingOpenMicrophoneSettingsBtn.textContent = lastMicrophoneStatus?.is_granted ? 'Allowed' : microphoneActionLabel;
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
    if (permissionStatus.status === 'dev_terminal') {
      setStatusMessage(permissionStatus.guidance);
      return;
    }
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

async function resetAccessibilityPermissionFromUi(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const resetMessage = await invokeCommand<string>('reset_accessibility_permission');
    setStatusMessage(resetMessage);
    await openAccessibilitySettingsFromUi(button);
  } catch (error) {
    setStatusMessage(`Reset did not finish: ${userErrorMessage(error)}`);
  } finally {
    button.disabled = false;
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
      ? `Open Accessibility, turn ${APP_BRAND.displayName} on, then click Check again.`
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
  config: Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys'>,
  slot: ShortcutSlot
): string[] {
  if (slot === 'hold') return config.hold_hotkeys;
  return config.toggle_hotkeys;
}

function withShortcutValues(
  config: Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys' | 'recording_mode' | 'language'>,
  slot: ShortcutSlot,
  shortcuts: string[]
): Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys' | 'recording_mode' | 'language'> {
  const normalized = normalizeShortcutList(shortcuts, slot);
  if (slot === 'hold') {
    return { ...config, hold_hotkeys: normalized };
  }
  return { ...config, toggle_hotkeys: normalized };
}

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
    whisper_model: whisperModelInput.value.trim() || 'whisper-1',
    custom_vocabulary: customVocabularyInput.value.trim(),
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

function currentSettingsConfig(): Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys' | 'recording_mode' | 'language'> {
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

function updateSavedShortcutConfig(config: Pick<Settings, 'hold_hotkeys' | 'toggle_hotkeys'>): void {
  savedShortcutConfig = {
    hold: normalizeShortcutList(config.hold_hotkeys, 'hold'),
    toggle: normalizeShortcutList(config.toggle_hotkeys, 'toggle')
  };
}

function renderShortcutDirtyState(): void {
  const shortcutsEqual = (left: string[], right: string[]) =>
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
  const holdDirty = !shortcutsEqual(currentShortcutValues('hold'), savedShortcutValues('hold'));
  const toggleDirty = !shortcutsEqual(currentShortcutValues('toggle'), savedShortcutValues('toggle'));
  const anyDirty = holdDirty || toggleDirty;

  shortcutListEls.hold.classList.toggle('is-dirty', holdDirty);
  shortcutListEls.toggle.classList.toggle('is-dirty', toggleDirty);
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
  const seen = new Map<string, ShortcutSlot>();
  for (const slot of ['hold', 'toggle'] as const) {
    for (const shortcut of shortcutValuesForSlot(activeConfig, slot)) {
      const normalized = normalizeHotkeyInput(shortcut);
      const existing = seen.get(normalized);
      if (existing) {
        return 'Each shortcut must be unique across hold and hands-free actions.';
      }
      seen.set(normalized, slot);
    }
  }
  return null;
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
    setSettingsHotkeyValidation('hold', distinctError, true);
    setSettingsHotkeyValidation('toggle', distinctError, true);
    renderShortcutDirtyState();
    return distinctError;
  }

  setSettingsHotkeyValidation('hold', '', false);
  setSettingsHotkeyValidation('toggle', '', false);
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
  if (left.scope === 'settings' && right.scope === 'settings') {
    return left.slot === right.slot && left.index === right.index;
  }
  return false;
}

function setActiveHotkeyCaptureValidation(target: HotkeyCaptureTarget, message: string, isError = false): void {
  if (target.scope === 'settings') {
    setSettingsHotkeyValidation(target.slot, message, isError);
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
    validateSettingsHotkeyInput('hold');
    validateSettingsHotkeyInput('toggle');
  } else {
    onboardingHotkeyInput.value = candidate;
    validateOnboardingHotkeyInput();
  }
  stopHotkeyCapture('Hotkey captured.', false);
}

function stopHotkeyCapture(message?: string, isError = false): void {
  if (!activeHotkeyCaptureTarget) return;
  syncHotkeyCaptureRegistration(false, activeHotkeyCaptureTarget);
  if (activeHotkeyCaptureTarget.scope === 'settings') {
    shortcutAddBtns.hold.disabled = false;
    shortcutAddBtns.toggle.disabled = false;
    setSettingsHotkeyValidation(activeHotkeyCaptureTarget.slot, isError ? message || '' : '', isError);
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation(isError ? message || '' : '', isError);
  }
  activeHotkeyCaptureTarget = null;
  applyConfigUi({
    ...currentSettingsConfig()
  });
}

function startHotkeyCapture(target: HotkeyCaptureTarget): void {
  if (activeHotkeyCaptureTarget) {
    stopHotkeyCapture();
  }
  activeHotkeyCaptureTarget = target;
  if (target.scope === 'settings') {
    setSettingsHotkeyValidation(target.slot, '', false);
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation('', false);
  }
  syncHotkeyCaptureRegistration(true, target);
  applyConfigUi({
    ...currentSettingsConfig()
  });
}

function setupHotkeyCapture(): void {
  holdShortcutAddBtn.addEventListener('click', () => {
    startHotkeyCapture({ scope: 'settings', slot: 'hold', index: null });
  });
  toggleShortcutAddBtn.addEventListener('click', () => {
    startHotkeyCapture({ scope: 'settings', slot: 'toggle', index: null });
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
    applyConfigUi({
      hold_hotkeys: savedSettings.hold_hotkeys,
      toggle_hotkeys: savedSettings.toggle_hotkeys,
      recording_mode: savedSettings.recording_mode,
      language: savedSettings.language
    });
    updateSavedShortcutConfig({
      hold_hotkeys: savedSettings.hold_hotkeys,
      toggle_hotkeys: savedSettings.toggle_hotkeys
    });
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
    if (isShortcutRelatedMessage(errorText)) {
      focusShortcutSettings();
      if (normalizedError.includes('hold')) {
        setSettingsHotkeyValidation('hold', errorText, true);
        setSettingsHotkeyValidation('toggle', '', false);
      } else if (normalizedError.includes('toggle') || normalizedError.includes('hands-free')) {
        setSettingsHotkeyValidation('toggle', errorText, true);
        setSettingsHotkeyValidation('hold', '', false);
      } else {
        setSettingsHotkeyValidation('hold', errorText, true);
        setSettingsHotkeyValidation('toggle', errorText, true);
      }
      setStatusMessage(errorText);
      return false;
    }
    setStatusMessage(`Settings were not saved: ${errorText}`);
    return false;
  }
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
  recordingModeInput.value = normalizeMode(onboardingRecordingModeInput.value);
  languageInput.value = normalizeLanguage(onboardingLanguageInput.value);
  activeConfig = withShortcutValues(currentSettingsConfig(), 'hold', [onboardingHotkey]);
  validateSettingsHotkeyInput('hold');
  validateSettingsHotkeyInput('toggle');
  applyConfigUi({
    ...currentSettingsConfig()
  });
  return null;
}

function formatHistoryTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
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

function computeHistoryStats(entries: TranscriptHistoryEntry[]): {
  activeDays: number;
  totalWords: number;
  estimatedMinutesSaved: number;
} {
  const activeDays = new Set(entries.map((entry) => historyDayKey(entry.created_at_ms))).size;
  const totalWords = entries.reduce((sum, entry) => sum + countTranscriptWords(entry.final_output), 0);
  const typingMinutes = totalWords / ESTIMATED_TYPING_WPM;
  const dictationMinutes = totalWords / ESTIMATED_DICTATION_WPM;
  return {
    activeDays,
    totalWords,
    estimatedMinutesSaved: Math.max(0, typingMinutes - dictationMinutes)
  };
}

async function copyTextWithStatus(text: string, successMessage: string): Promise<void> {
  await invokeCommand('copy_text_to_clipboard', { text });
  setStatusMessage(successMessage);
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
    showAppToast('Copied transcript');
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
    staticMain?: boolean;
    onMainClick?: (() => void) | null;
    isCopied?: boolean;
  } = {}
): HTMLDivElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'history-row';
  if (options.active) {
    rowEl.classList.add('is-active');
  }

  const onMainClick = options.onMainClick ?? null;
  const mainEl = onMainClick ? document.createElement('button') : document.createElement('div');
  if (mainEl instanceof HTMLButtonElement && onMainClick) {
    mainEl.type = 'button';
    mainEl.addEventListener('click', onMainClick);
    mainEl.setAttribute(
      'aria-label',
      `Transcript from ${formatHistoryDayLabel(entry.created_at_ms)} at ${formatHistoryTime(entry.created_at_ms)}`
    );
  }
  mainEl.className = 'history-row-main';
  if (options.staticMain || !options.onMainClick) {
    mainEl.classList.add('is-static');
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'history-row-time';
  timeEl.textContent = formatHistoryTime(entry.created_at_ms);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'history-row-body';

  const textEl = document.createElement('p');
  textEl.className = 'history-row-text';
  textEl.textContent = entry.final_output.trim() || 'Empty transcript';

  bodyEl.append(textEl);
  mainEl.append(timeEl, bodyEl);

  if (onMainClick) {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'history-row-actions';
    const indicatorEl = document.createElement('span');
    indicatorEl.className = 'history-row-indicator';

    const iconEl = document.createElement('span');
    iconEl.className = 'history-row-indicator-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.innerHTML = options.isCopied
      ? `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5 9.5 17 19 7.5"></path>
          </svg>
        `
      : `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="10" height="10" rx="2"></rect>
            <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
          </svg>
        `;

    indicatorEl.classList.add(options.isCopied ? 'is-copied' : 'is-idle');
    indicatorEl.append(iconEl);
    actionsEl.append(indicatorEl);
    rowEl.append(mainEl, actionsEl);
    return rowEl;
  }

  rowEl.append(mainEl);
  return rowEl;
}

function renderHomeOverview(): void {
  const stats = computeHistoryStats(historyEntries);
  homeStatDaysEl.textContent = NUMBER_FORMATTER.format(stats.activeDays);
  homeStatWordsEl.textContent = NUMBER_FORMATTER.format(stats.totalWords);
  homeStatSavedEl.textContent = formatSavedTime(stats.estimatedMinutesSaved);

  const recentEntries = historyEntries.slice(0, HOME_RECENT_LIMIT);
  homeRecentFeedEl.replaceChildren();
  homeRecentEmptyEl.hidden = recentEntries.length > 0;
  if (recentEntries.length === 0) {
    return;
  }

  for (const entry of recentEntries) {
    homeRecentFeedEl.append(
      createTranscriptRow(entry, {
        active: entry.id === historySelectedEntryId,
        isCopied: entry.id === historyCopiedEntryId,
        onMainClick: () => {
          void handleHistoryEntryCopy(entry);
        }
      })
    );
  }
}

function renderDurableDraft(draft: DurableDraft | null): void {
  durableDraft = draft;
  const hasDraft = Boolean(draft && draft.text.trim());
  draftRestoreBannerEl.classList.toggle('hidden', !hasDraft);
  if (!hasDraft || !draft) {
    draftRestorePreviewEl.textContent = 'No saved draft.';
    return;
  }

  const preview = draft.text.trim();
  const previewText = preview.length > 220 ? `${preview.slice(0, 220).trimEnd()}...` : preview;
  const sourceApp = draft.source_app?.trim() || 'Unknown app';
  draftRestorePreviewEl.textContent = `${formatHistoryTimestamp(
    draft.created_at_ms
  )} | ${languageLabel(draft.language)} | ${sourceApp}\n${previewText}`;
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
  if (!query) return historyEntries;
  return historyEntries.filter((entry) => {
    const haystack = `${entry.final_output} ${entry.source_app || ''}`.toLowerCase();
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
  const hasQuery = historySearchInput.value.trim().length > 0;
  historyCountEl.textContent = hasQuery
    ? `${formatTranscriptCount(visibleEntries.length, 'match')} of ${formatTranscriptCount(historyEntries.length)}`
    : formatTranscriptCount(historyEntries.length);
  if (historySelectedEntryId && !visibleEntries.some((entry) => entry.id === historySelectedEntryId)) {
    historySelectedEntryId = null;
  }

  historyFeedEl.innerHTML = '';
  historyEmptyEl.hidden = visibleEntries.length > 0;
  if (visibleEntries.length === 0) {
    historyEmptyEl.textContent =
      historyEntries.length === 0 ? 'No transcripts yet. Record once from Home or with your shortcut.' : 'No matches.';
    return;
  }
  historyEmptyEl.textContent = 'No transcripts yet. Record once from Home or with your shortcut.';

  const groupedEntries = groupHistoryEntries(visibleEntries);
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
let recordingActionPending = false;
let previousFailedRecordings = '';

async function showSavedRecording(id: string): Promise<void> {
  renderSavedRecordings(await invokeCommand<SavedRecording[]>('get_saved_recordings'));
  setActiveTab('history');
  savedRecordingsEl.open = true;
  const row = Array.from(savedRecordingsList.children).find(row => (row as HTMLElement).dataset.recordingId === id) as HTMLElement | undefined;
  row?.scrollIntoView({ block: 'nearest' });
  row?.focus({ preventScroll: true });
}

function renderSavedRecordings(entries: SavedRecording[]): void {
  savedRecordingsEl.hidden = entries.length === 0;
  const failed = entries.filter(entry => entry.status === 'failed').map(entry => entry.id).join(',');
  if (failed && failed !== previousFailedRecordings) savedRecordingsEl.open = true;
  previousFailedRecordings = failed;
  const unfinished = entries.filter(entry => !['completed', 'recording', 'processing', 'discarded'].includes(entry.status)).length;
  savedRecordingsSummary.textContent = `Saved audio · ${entries.length}${unfinished ? ` · ${unfinished} unfinished` : ''}`;
  savedRecordingsList.replaceChildren();
  for (const entry of entries) {
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
    const action = (text: string, command: string, args: Record<string, unknown>) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ui-button ui-button-secondary'; button.textContent = text;
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
    action('Audio', 'reveal_recording', { id: entry.id });
    const transcript = entry.transcript || entry.raw_transcript;
    if (transcript) action('Copy text', 'copy_text_to_clipboard', { text: transcript });
    const retry = action('Reprocess', 'retry_recording', { id: entry.id });
    retry.title = 'Transcribe and polish again with current settings';
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
  updateSavedShortcutConfig({
    hold_hotkeys: settings.hold_hotkeys,
    toggle_hotkeys: settings.toggle_hotkeys
  });
  whisperModelInput.value = settings.whisper_model;
  customVocabularyInput.value = settings.custom_vocabulary || '';
  formatModelInput.value = settings.format_model;
  applyPolishingSettings(settings);
  skipFormatterInTerminalsInput.checked = settings.skip_formatter_in_terminals;
  includeClipboardContextInput.checked = settings.include_clipboard_context;
  playSoundCuesInput.checked = settings.play_sound_cues;
  apiBaseUrlInput.value = settings.api_base_url;
  recordingModeInput.value = normalizeMode(settings.recording_mode);
  languageInput.value = normalizeLanguage(settings.language);
  activeConfig = {
    hold_hotkeys: normalizeShortcutList(settings.hold_hotkeys, 'hold'),
    toggle_hotkeys: normalizeShortcutList(settings.toggle_hotkeys, 'toggle'),
    recording_mode: normalizeMode(settings.recording_mode),
    language: normalizeLanguage(settings.language)
  };
  syncOnboardingInputsFromSettings();
  applyConfigUi({
    hold_hotkeys: activeConfig.hold_hotkeys,
    toggle_hotkeys: activeConfig.toggle_hotkeys,
    recording_mode: normalizeMode(settings.recording_mode),
    language: normalizeLanguage(settings.language)
  });
  validateSettingsHotkeyInput('hold');
  validateSettingsHotkeyInput('toggle');

  const status = await invokeCommand<RuntimeStatus>('get_runtime_status');
  renderStatus(status);
  if (isShortcutRelatedMessage(status.last_message)) {
    focusShortcutSettings();
  }
  await loadHistory();
  renderSavedRecordings(await invokeCommand<SavedRecording[]>('get_saved_recordings'));
  const draft = await invokeCommand<DurableDraft | null>('get_durable_draft');
  renderDurableDraft(draft);

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
  const holdHotkeyError = validateSettingsHotkeyInput('hold');
  const toggleHotkeyError = validateSettingsHotkeyInput('toggle');
  const hotkeyError = holdHotkeyError || toggleHotkeyError || validateDistinctHotkeys();
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

toggleBtn.addEventListener('click', () => {
  void requestToggleRecording();
});

homeToggleBtn.addEventListener('click', () => {
  void requestToggleRecording();
});

draftRestoreCopyBtn.addEventListener('click', async () => {
  if (!durableDraft?.text?.trim()) return;
  draftRestoreCopyBtn.disabled = true;
  try {
    await copyTextWithStatus(durableDraft.text, 'Saved text copied.');
  } catch (error) {
    setStatusMessage(`Copy failed: ${userErrorMessage(error)}`);
  } finally {
    draftRestoreCopyBtn.disabled = false;
  }
});

draftRestoreDismissBtn.addEventListener('click', async () => {
  draftRestoreDismissBtn.disabled = true;
  try {
    await invokeCommand('clear_durable_draft');
    setStatusMessage('Saved text dismissed.');
  } catch (error) {
    setStatusMessage(`Saved text was not dismissed: ${userErrorMessage(error)}`);
  } finally {
    draftRestoreDismissBtn.disabled = false;
  }
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
    apiKeyInput.value = onboardingApiKeyInput.value.trim();
    renderApiKeyControl();
    apiBaseUrlInput.value = normalizeBaseUrlForSettingsInput(onboardingApiBaseUrlInput.value);
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

  const error = applyOnboardingSelectionsToSettingsForm();
  if (error) return;

  const payload = readSettingsFromForm();
  const saved = await saveSettingsPayload(payload, 'Onboarding complete. Settings saved and ready.');
  if (!saved) return;

  setOnboardingCompleted(true);
  hideOnboarding();
  setActiveTab('home');
});

onboardingOpenAccessibilitySettingsBtn.addEventListener('click', async () => {
  await openAccessibilitySettingsFromUi(onboardingOpenAccessibilitySettingsBtn);
});

onboardingCheckAccessibilityBtn.addEventListener('click', async () => {
  onboardingCheckAccessibilityBtn.disabled = true;
  try {
    await checkAndRenderAccessibilityStatus();
  } catch (error) {
    setStatusMessage(`Could not read Accessibility. Open Accessibility, turn ${APP_BRAND.displayName} on, then click Check again.`);
  } finally {
    onboardingCheckAccessibilityBtn.disabled = false;
  }
});

onboardingResetAccessibilityPermissionBtn.addEventListener('click', async () => {
  await resetAccessibilityPermissionFromUi(onboardingResetAccessibilityPermissionBtn);
});

onboardingCheckMicrophoneBtn.addEventListener('click', async () => {
  onboardingCheckMicrophoneBtn.disabled = true;
  try {
    await checkAndRenderMicrophoneStatus();
  } catch (error) {
    setStatusMessage(
      `Could not read Microphone access. Click Request access, then check System Settings after ${APP_BRAND.displayName} appears.`
    );
  } finally {
    onboardingCheckMicrophoneBtn.disabled = false;
  }
});

onboardingOpenMicrophoneSettingsBtn.addEventListener('click', async () => {
  await openMicrophoneSettingsFromUi(onboardingOpenMicrophoneSettingsBtn);
});

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
}).catch((error) => {
  setStatusMessage(`History listener failed: ${userErrorMessage(error)}`);
});

historySearchInput.addEventListener('input', () => {
  renderHistory(historyEntries);
});

listenEvent<DurableDraft | null>('durable-draft-updated', (event) => {
  renderDurableDraft(event.payload);
}).catch((error) => {
  setStatusMessage(`Draft listener failed: ${userErrorMessage(error)}`);
});

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
