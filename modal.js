// ── IN-APP MODALS ─────────────────────────────────────────────────
// Promise-based replacements for window.prompt/confirm/alert, which
// are unstylable, easy to dismiss by accident, and suppressed in some
// mobile webviews. Uses the .modal-overlay / .modal-box styles.

import { esc } from './shared.js';

// showModal({ title, bodyHTML, fields, buttons, dismissable })
//  - bodyHTML is inserted as HTML: callers must esc() anything user-supplied
//  - fields: [{ id, label, value, placeholder, maxlength, type }]
//  - buttons: [{ id, label, style ('primary'|'danger'|'ghost'|'amber'|'neutral'|'success'), color }]
//  - resolves { button, values } — or null if dismissed (dismissable only)
//  - the returned promise also has a .close() method: force-dismiss the
//    modal programmatically (resolves null, as if the user dismissed it)
//    — for the rare case a caller needs to retract a modal it opened
//    earlier because it's no longer relevant (e.g. superseded by a
//    newer prompt), so two overlays never end up stacked
export function showModal({ title, bodyHTML = '', fields = [], buttons, dismissable = false }) {
  buttons = buttons && buttons.length ? buttons : [{ id: 'ok', label: 'OK', style: 'primary' }];

  let closeModal;
  const promise = new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const fieldsHTML = fields.map(f =>
      '<label style="display:block;font-size:12px;font-weight:700;color:#6b7280;margin-bottom:4px;">' +
        esc(f.label || '') + '</label>' +
      '<input data-field="' + esc(f.id) + '" type="' + (f.type || 'text') + '"' +
        (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '') +
        ' value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '" />'
    ).join('');

    const buttonsHTML = buttons.map(b => {
      const cls = b.style ? ' btn-' + b.style : '';
      const bg  = b.color ? ' style="background:' + esc(b.color) + ';"' : '';
      return '<button class="btn' + cls + '" data-button="' + esc(b.id) + '"' + bg + '>' +
        b.label + '</button>';
    }).join('');

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML =
      (title ? '<div class="modal-title">' + title + '</div>' : '') +
      (bodyHTML ? '<div style="font-size:13px;color:#374151;line-height:1.55;margin-bottom:12px;">' + bodyHTML + '</div>' : '') +
      fieldsHTML +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">' + buttonsHTML + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function finish(result) {
      overlay.remove();
      resolve(result);
    }
    closeModal = () => finish(null);

    function collectValues() {
      const values = {};
      box.querySelectorAll('input[data-field]').forEach(input => {
        values[input.dataset.field] = input.value.trim();
      });
      return values;
    }

    box.querySelectorAll('button[data-button]').forEach(btn => {
      btn.addEventListener('click', () => finish({ button: btn.dataset.button, values: collectValues() }));
    });

    if (dismissable) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) finish(null);
      });
    }

    // Enter in a field triggers the first (primary) button
    const inputs = box.querySelectorAll('input[data-field]');
    inputs.forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const first = box.querySelector('button[data-button]');
          if (first) first.click();
        }
      });
    });
    if (inputs.length) setTimeout(() => inputs[0].focus(), 60);
  });
  promise.close = () => closeModal();
  return promise;
}

// Info dialog: one OK button, tap-outside closes. Fire-and-forget safe.
export function showInfo(title, bodyHTML, buttonLabel) {
  return showModal({
    title, bodyHTML,
    buttons: [{ id: 'ok', label: buttonLabel || 'OK', style: 'primary' }],
    dismissable: true,
  });
}

// Confirm dialog → true/false (dismissing counts as "no")
export async function showConfirm(title, bodyHTML, okLabel, cancelLabel, okStyle) {
  const res = await showModal({
    title, bodyHTML,
    buttons: [
      { id: 'ok',     label: okLabel || 'OK',     style: okStyle || 'primary' },
      { id: 'cancel', label: cancelLabel || 'Cancel', style: 'ghost' },
    ],
    dismissable: true,
  });
  return !!(res && res.button === 'ok');
}

// Single-field prompt → trimmed string, or null if cancelled/dismissed
export async function showPrompt(title, bodyHTML, { label, value, placeholder, maxlength, okLabel } = {}) {
  const res = await showModal({
    title, bodyHTML,
    fields: [{ id: 'v', label: label || '', value, placeholder, maxlength }],
    buttons: [
      { id: 'ok',     label: okLabel || 'OK', style: 'primary' },
      { id: 'cancel', label: 'Cancel',        style: 'ghost' },
    ],
    dismissable: true,
  });
  if (!res || res.button !== 'ok') return null;
  return res.values.v;
}
