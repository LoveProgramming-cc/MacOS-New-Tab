// How an application is reached from outside itself, and what it can learn about its own
// standing: links between applications (URL schemes), messages between the windows of one
// application, pasting into it, and its use of the host's budgets.

import { state } from './state.js';
import { restoreManagedWindow } from './window-manager.js';
import { appUsage } from './plugin-blobs.js';
import { FILE_LIMIT, NATIVE_NODE_LIMIT } from './plugin-constants.js';
import { appStrict, applicationUnrestricted, canOpenAnotherInstance, frontInstance, instancesOf, jsonSize, notePermission, permissionAllowed, pluginStorageIndex, postToPlugin, postWhenReady, requirePermission, safeExternalUrl } from './plugin-core.js';
import { pluginState } from './plugin-package.js';
import { storeFileForPlugin } from './plugin-files.js';
import { isEditableTarget, openPluginApp } from './plugin-system.js';

// ---- URL schemes ----------------------------------------------------------------------
// An application names the schemes it answers to in its manifest ("urlSchemes": ["notes"]).
// macos.openURL('notes://note/abc') — from another application, or from this one — opens
// it and hands it the URL with the 'openurl' event. The first installed application that
// names a scheme owns it.
const RESERVED_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'data', 'blob', 'javascript', 'about', 'chrome', 'chrome-extension', 'mailto', 'tel', 'ws', 'wss', 'view-source']);
export function normalizeUrlSchemes(value) {
    return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()))]
        .filter((scheme) => /^[a-z][a-z0-9+.-]{1,31}$/.test(scheme) && !RESERVED_SCHEMES.has(scheme)).slice(0, 4);
}
const schemeOf = (url) => (String(url || '').match(/^([a-z][a-z0-9+.-]{1,31}):/i)?.[1] || '').toLowerCase();
export const applicationForScheme = (scheme) => pluginState().apps.find((app) => app.urlSchemes?.includes(scheme)) || null;
/** Opens the application that answers to the URL's scheme and gives it the URL. Resolves false when none does. */
export async function openApplicationUrl(url, from = '') {
    const text = String(url || '').slice(0, 4000);
    const target = applicationForScheme(schemeOf(text));
    if (!target) return false;
    await openPluginApp(target.id, { announce: false });
    const record = frontInstance(target.id);
    if (!record) return false;
    restoreManagedWindow(record.window);
    postWhenReady(record, { type: 'event', name: 'openurl', detail: { url: text, from: String(from || '') } });
    return true;
}
async function openUrlRequest(record, payload) {
    const { plugin } = record;
    requirePermission(plugin, 'openExternal');
    const url = String(payload?.url || '');
    if (await openApplicationUrl(url, plugin.id)) return true;
    const web = safeExternalUrl(url);
    if (!web) throw new Error(`No application opens "${schemeOf(url) || url.slice(0, 20)}:" links`);
    await chrome.tabs.create({ url: web });
    return true;
}

// ---- instances ------------------------------------------------------------------------
// The windows of one application can tell each other what changed.
function instancesRequest(record, method, payload) {
    const others = instancesOf(record.plugin.id);
    if (method === 'instances.list') {
        const front = frontInstance(record.plugin.id);
        return others.map((other) => ({ instance: other.instance, self: other === record, front: other === front, title: other.title?.textContent || record.plugin.name, sharedStorage: other.storageId === record.plugin.id }));
    }
    // A further window of itself — only where the user allowed that for this application
    // (Settings ▸ Applications ▸ Allow Multiple Windows), and within the limit set there.
    if (method === 'instances.canOpen') return canOpenAnotherInstance(record.plugin);
    if (method === 'instances.open') {
        if (!canOpenAnotherInstance(record.plugin)) return false;
        openPluginApp(record.plugin.id, { newInstance: true }).catch(() => {});
        return true;
    }
    if (method === 'instances.broadcast') {
        const message = payload?.message;
        if (jsonSize(message) > 64_000) throw new Error('An instance message may be at most 64 KB');
        let delivered = 0;
        for (const other of others) {
            if (other === record) continue;
            postWhenReady(other, { type: 'event', name: 'instancemessage', detail: { from: record.instance, message: structuredClone(message ?? null) } });
            delivered += 1;
        }
        return delivered;
    }
    throw new Error(`Unknown plugin API method: ${method}`);
}

// ---- paste ----------------------------------------------------------------------------
// ⌘V in an application's window. Files on the clipboard (a copied image, a screenshot)
// are stored for the application and announced; they are never typed into a field as
// text. Text goes into the focused field as usual; pasted with no field in focus, it is
// handed to the application, because the user aimed the paste at it.
export function bindPaste(record) {
    record.window.addEventListener('paste', async (event) => {
        const data = event.clipboardData;
        // Only for an application that listens (macos.on('paste')); otherwise the browser's own paste applies.
        if (!data || record.runtimeApp?.mode !== 'native' || !record.listening?.has('paste')) return;
        const types = [...data.types].filter((type) => type !== 'Files').slice(0, 12);
        const pasted = [...data.files].slice(0, 20);
        const editable = isEditableTarget(event.target);
        const id = record.nativeUi?.idForElement(event.target) || '';
        if (pasted.length) {
            event.preventDefault();
            const files = [];
            if (permissionAllowed(record.plugin, 'files')) {
                notePermission(record.plugin, 'files', true);
                for (const file of pasted) { try { files.push(await storeFileForPlugin(record, file, file.name || `pasted.${(file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '')}`)); } catch { /* over the quota or unreadable: not announced */ } }
            }
            postToPlugin(record, { type: 'event', name: 'paste', detail: { id, types: [...new Set(pasted.map((file) => file.type).filter(Boolean))], files } });
        } else if (!editable) {
            postToPlugin(record, { type: 'event', name: 'paste', detail: { id: '', types, text: data.getData('text/plain').slice(0, 200_000), files: [] } });
        } else {
            postToPlugin(record, { type: 'event', name: 'paste', detail: { id, types, files: [] } });
        }
    });
}

// ---- self-inspection ------------------------------------------------------------------
// Where the application stands against the host's budgets, so it can ease off before it
// is refused.
async function statsRequest(record) {
    const { plugin } = record;
    const free = applicationUnrestricted(plugin); const strict = appStrict(plugin);
    const budget = record.requestBudget || { count: 0 };
    const [index, files] = await Promise.all([pluginStorageIndex(record.storageId).catch(() => ({ total: 0 })), appUsage(record.storageId).catch(() => ({ count: 0, bytes: 0 }))]);
    return {
        apiCallsThisSecond: budget.count, apiCallsLimit: free ? null : strict ? 240 : 1200, apiCallsAdvised: 90,
        nodeCount: record.nativeUi?.nodeCount() ?? null, nodeLimit: record.nativeUi ? (free ? null : record.nativeUi.nodeLimit()) : null,
        storageBytes: Number(index.total) || 0, storageQuota: free ? null : 32_000_000,
        fileCount: files.count, fileBytes: files.bytes, fileQuota: free ? null : FILE_LIMIT.quota,
        securityLevel: free ? 'unrestricted' : strict ? 'strict' : 'relaxed', nodeLimits: { ...NATIVE_NODE_LIMIT }
    };
}

/** Requests of this module: openURL, instances.*, system.getStats. Returns undefined for anything else. */
export function handleLinkRequest(record, method, payload) {
    if (method === 'openURL') return openUrlRequest(record, payload);
    if (method.startsWith('instances.')) return instancesRequest(record, method, payload);
    if (method === 'system.getStats') return statsRequest(record);
    if (method === 'events.listen') { if (payload?.name === 'paste') (record.listening ||= new Set()).add('paste'); return true; }
    return undefined;
}
