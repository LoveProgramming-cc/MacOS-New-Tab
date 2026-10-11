import { t } from './i18n.js';
import { createElement } from './utils.js';

let activeDialog = null;

function closeActive(result = false) {
    if (!activeDialog) return;
    const { host, resolve, release } = activeDialog;
    activeDialog = null;
    release?.();
    host.classList.add('closing');
    setTimeout(() => host.remove(), 130);
    resolve(result);
}

export function showMacDialog({ title = '', message = '', detail = '', confirmLabel, cancelLabel, showCancel = false, danger = false, icon = '', prompt = null } = {}) {
    if (activeDialog) closeActive(activeDialog.prompt ? null : false);
    return new Promise((resolve) => {
        const host = createElement('div', { className: 'mac-dialog-overlay' });
        const card = createElement('div', { className: 'mac-dialog-card mac-acrylic window-shadow', attrs: { role: 'dialog', 'aria-modal': 'true' } });
        if (icon) {
            const img = createElement('img', { className: 'mac-dialog-icon', attrs: { src: icon, alt: '' } });
            card.appendChild(img);
        }
        const body = createElement('div', { className: 'mac-dialog-body' });
        if (title) body.appendChild(createElement('div', { className: 'mac-dialog-title', text: title }));
        if (message) body.appendChild(createElement('div', { className: 'mac-dialog-message', text: message }));
        if (detail) body.appendChild(createElement('div', { className: 'mac-dialog-detail', text: detail }));
        // prompt: { value, placeholder } turns the dialog into a one-line text request that
        // resolves to the entered string (or null when cancelled).
        let field = null;
        if (prompt) {
            field = createElement('input', { className: 'mac-input mac-dialog-input', attrs: { type: 'text', placeholder: String(prompt.placeholder || ''), maxlength: '400' } });
            field.value = String(prompt.value ?? '');
            body.appendChild(field);
        }
        const actions = createElement('div', { className: 'mac-dialog-actions' });
        if (showCancel) {
            const cancel = createElement('button', { className: 'mac-btn mac-dialog-cancel', text: cancelLabel || t('cancel', '取消'), attrs: { type: 'button' } });
            cancel.addEventListener('click', () => closeActive(field ? null : false));
            actions.appendChild(cancel);
        }
        const ok = createElement('button', { className: `mac-btn blue mac-dialog-confirm${danger ? ' danger' : ''}`, text: confirmLabel || t('confirm', '确定'), attrs: { type: 'button' } });
        ok.addEventListener('click', () => closeActive(field ? field.value : true));
        actions.appendChild(ok);
        body.appendChild(actions);
        card.appendChild(body);
        host.appendChild(card);
        document.body.appendChild(host);
        activeDialog = { host, resolve, prompt: Boolean(prompt), release: () => document.removeEventListener('keydown', keyHandler, true) };
        host.addEventListener('mousedown', (event) => { if (event.target === host && showCancel) closeActive(field ? null : false); });
        const keyHandler = (event) => {
            // The handler belongs to this dialog only. A dialog closed with the mouse used to
            // leave its handler behind, and the next dialog's Enter then answered with the
            // previous dialog's text.
            if (activeDialog?.host !== host) return document.removeEventListener('keydown', keyHandler, true);
            if (event.isComposing || event.keyCode === 229) return;
            event.stopPropagation();
            if (event.key === 'Escape' && showCancel) { event.preventDefault(); closeActive(field ? null : false); }
            if (event.key === 'Enter') { event.preventDefault(); closeActive(field ? field.value : true); }
        };
        document.addEventListener('keydown', keyHandler, true);
        requestAnimationFrame(() => { if (field) { field.focus({ preventScroll: true }); field.select(); } else ok.focus({ preventScroll: true }); });
    });
}

export function showMacAlert(message, options = {}) {
    return showMacDialog({ ...options, message, showCancel: false, confirmLabel: options.confirmLabel || t('confirm', '确定') });
}

export function showMacConfirm(message, options = {}) {
    return showMacDialog({ ...options, message, showCancel: true });
}

export function showMacPrompt(message, options = {}) {
    return showMacDialog({ ...options, message, showCancel: true, prompt: { value: options.value, placeholder: options.placeholder } });
}
