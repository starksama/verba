import { invoke } from '@tauri-apps/api/core';

const openButton = document.querySelector<HTMLButtonElement>('#phone-sync-open')!;
const dialog = document.querySelector<HTMLDialogElement>('#phone-sync-dialog')!;
const code = document.querySelector<HTMLImageElement>('#phone-sync-code')!;
const status = document.querySelector<HTMLElement>('#phone-sync-status')!;

let generation = 0;
let activeID: number | null = null;
let poll: ReturnType<typeof setTimeout> | undefined;

function hideCode(): void {
  code.hidden = true;
  code.removeAttribute('src');
}

async function pollTransfer(id: number): Promise<void> {
  try {
    const result = await invoke<'waiting' | 'sent' | 'expired'>('phone_sync_status', { id });
    if (!dialog.open || activeID !== id) return;
    if (result === 'waiting') {
      poll = setTimeout(() => void pollTransfer(id), 500);
      return;
    }
    hideCode();
    status.textContent = result === 'sent' ? 'Sent to iPhone.' : 'Code expired. Reopen to try again.';
    activeID = null;
  } catch {
    if (dialog.open && activeID === id) {
      hideCode();
      activeID = null;
      void invoke('cancel_phone_sync', { id }).catch(() => {});
      status.textContent = 'Sync interrupted. Reopen to try again.';
    }
  }
}

export function bindPhoneSync(hasUnsavedProfile: () => boolean): void {
  openButton.addEventListener('click', () => void openTransfer(hasUnsavedProfile()));
}

async function openTransfer(unsaved: boolean): Promise<void> {
  const current = ++generation;
  if (unsaved) {
    status.textContent = 'Save your API changes first.';
    dialog.showModal();
    return;
  }
  status.textContent = 'Preparing code…';
  dialog.showModal();
  try {
    const { id, svg } = await invoke<{ id: number; svg: string }>('begin_phone_sync');
    if (!dialog.open || current !== generation) {
      void invoke('cancel_phone_sync', { id }).catch(() => {});
      return;
    }
    activeID = id;
    code.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    code.hidden = false;
    status.textContent = 'On iPhone, open Verba → Settings → Sync from Mac.';
    void pollTransfer(id);
  } catch (error) {
    if (dialog.open && current === generation) {
      status.textContent = typeof error === 'string' ? error : 'Couldn’t prepare the pairing code.';
    }
  }
}

dialog.addEventListener('close', () => {
  generation++;
  clearTimeout(poll);
  hideCode();
  const id = activeID;
  activeID = null;
  if (id !== null) void invoke('cancel_phone_sync', { id }).catch(() => {});
});
