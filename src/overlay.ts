import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { APP_BRAND } from './app-config';
import '@fontsource-variable/inter';

type RuntimeStatus = {
  is_recording: boolean;
  is_processing: boolean;
  interrupted: boolean;
  failure?: { recording_id: string; message: string } | null;
  notice?: string | null;
  rewriting?: string | null;
  suggestion?: { id: string; term: string; original: string } | null;
  mic_level: number;
  last_message: string;
};
type OverlayTone = 'idle' | 'recording' | 'processing' | 'interrupted' | 'failed' | 'notice' | 'suggestion';
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
const pill = document.querySelector<HTMLDivElement>('#overlay-pill')!;
const prompt = document.querySelector<HTMLDivElement>('#save-prompt')!;
const note = document.querySelector<HTMLParagraphElement>('#prompt-note')!;
const promptTitle = document.querySelector<HTMLParagraphElement>('#save-title')!;
const interrupt = document.querySelector<HTMLButtonElement>('#interrupt')!;
const finish = document.querySelector<HTMLButtonElement>('#finish')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const discard = document.querySelector<HTMLButtonElement>('#discard')!;
const buttons = [interrupt, finish, save, discard];
const rewriteName = document.querySelector<HTMLSpanElement>('#rewrite-name')!;
const bars = Array.from(document.querySelectorAll<HTMLSpanElement>('.overlay-bar'));
const shape = [.22, .46, .7, .38, .84, .58, 1, .66, .88, .44, .72, .4, .24];
let tone: OverlayTone = 'idle';
let visualLevel = 0;
let busy = false;
let failureId: string | null = null;
let suggestionId: string | null = null;
document.title = `${APP_BRAND.displayName} Overlay`;

function renderButtons(): void {
  buttons.forEach(button => { button.disabled = busy; });
  finish.disabled = busy || tone !== 'recording';
}
function renderOverlay(status: RuntimeStatus): void {
  const next = status.interrupted ? 'interrupted' : status.is_recording ? 'recording' : status.is_processing ? 'processing' : status.failure ? 'failed' : status.notice ? 'notice' : status.suggestion ? 'suggestion' : 'idle';
  failureId = status.failure?.recording_id ?? null;
  suggestionId = status.suggestion?.id ?? null;
  const rewriting = Boolean(status.rewriting) && status.is_processing;
  rewriteName.textContent = rewriting ? status.rewriting! : '';
  if (overlay.classList.contains('is-rewriting') !== rewriting) {
    overlay.classList.toggle('is-rewriting', rewriting);
    interrupt.setAttribute('aria-label', rewriting ? 'Cancel rewrite (Esc)' : tone === 'processing' ? 'Interrupt transcription (Esc)' : 'Interrupt recording (Esc)');
  }
  if (tone !== next) {
    tone = next;
    visualLevel = 0;
    overlay.dataset.tone = tone;
    overlay.classList.toggle('is-visible', tone !== 'idle');
    overlay.setAttribute('aria-hidden', String(tone === 'idle'));
    pill.hidden = tone === 'interrupted' || tone === 'failed' || tone === 'notice' || tone === 'suggestion';
    save.hidden = tone === 'notice';
    note.hidden = tone === 'notice';
    prompt.hidden = !pill.hidden;
    interrupt.setAttribute('aria-label', rewriting ? 'Cancel rewrite (Esc)' : tone === 'processing' ? 'Interrupt transcription (Esc)' : 'Interrupt recording (Esc)');
    renderButtons();
  }
  if (tone === 'suggestion') {
    const suggestion = status.suggestion!;
    promptTitle.textContent = `Add \u201c${suggestion.term}\u201d to Vocabulary?`;
    note.textContent = `You changed \u201c${suggestion.original}\u201d.`;
    note.title = note.textContent;
    save.textContent = 'Add';
    discard.textContent = 'Dismiss';
    prompt.setAttribute('role', 'group');
  } else if (tone === 'notice') {
    promptTitle.textContent = status.notice!;
    discard.textContent = 'Dismiss';
    prompt.setAttribute('role', 'status');
  } else if (tone === 'failed') {
    promptTitle.textContent = 'Dictation failed · Audio saved';
    note.textContent = status.failure!.message;
    note.title = status.failure!.message;
    save.textContent = 'History';
    discard.textContent = 'Dismiss';
    prompt.setAttribute('role', 'alert');
  } else if (tone === 'interrupted') {
    promptTitle.textContent = 'Save recording?';
    note.textContent = 'Discarded audio stays in History.';
    note.removeAttribute('title');
    save.textContent = 'Save';
    discard.textContent = 'Discard';
    prompt.setAttribute('role', 'group');
  }
  const normalized = tone === 'recording' ? Math.sqrt(Math.max(0, Math.min(100, status.mic_level || 0)) / 100) : 0;
  visualLevel += (normalized - visualLevel) * .52;
  if (visualLevel < .025 && normalized < .025) visualLevel = 0;
  bars.forEach((bar, index) => { bar.style.transform = `scaleY(${(.14 + visualLevel * shape[index] * .86).toFixed(3)})`; });
}
async function act(command: string, args?: Record<string, unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  renderButtons();
  try {
    await invoke(command, args);
  } catch (error) {
    // Confirmation stays open on failure; audio remains in its durable location.
    note.textContent = String(error);
    note.title = String(error);
    interrupt.title = String(error);
  } finally {
    busy = false;
    renderButtons();
  }
}
interrupt.addEventListener('click', () => void act('interrupt_recording'));
finish.addEventListener('click', () => void act('finish_recording'));
save.addEventListener('click', () => void (tone === 'suggestion'
  ? act('accept_vocabulary_suggestion', { id: suggestionId })
  : tone === 'failed'
  ? act('open_recording_history', { id: failureId })
  : act('resolve_interrupted_recording', { keep: true })));
discard.addEventListener('click', () => void (tone === 'suggestion'
  ? act('hide_suggestion_prompt')
  : tone === 'notice'
  ? act('dismiss_notice')
  : tone === 'failed'
  ? act('dismiss_recording_failure', { id: failureId })
  : act('resolve_interrupted_recording', { keep: false })));
async function boot(): Promise<void> {
  let receivedStatus = false;
  await listen<RuntimeStatus>('runtime-status', event => {
    receivedStatus = true;
    renderOverlay(event.payload);
  });
  const status = await invoke<RuntimeStatus>('get_runtime_status');
  if (!receivedStatus) renderOverlay(status);
  renderButtons();
}
void boot();
