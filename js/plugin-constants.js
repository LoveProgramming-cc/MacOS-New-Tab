// Limits, storage key prefixes and channel names of the application runtime. No imports:
// every other plugin-*.js module can rely on these while it is being evaluated.

export const MAX_HTML_STRICT = 100_000;
export const MAX_CSS_STRICT = 120_000;
export const MAX_SCRIPT_STRICT = 180_000;
export const MAX_PACKAGE_STRICT = 2_500_000;
export const MAX_PACKAGE_RELAXED = 12_000_000;
export const APP_STORAGE_PREFIX = 'macOS_plugin_app_storage_v055_';
export const APP_PACKAGE_PREFIX = 'macOS_plugin_app_package_v055_';
export const APP_COMPILED_PREFIX = 'macOS_plugin_app_compiled_v055_';
export const APP_ASSET_PREFIX = 'macOS_plugin_app_asset_v055_';
export const APP_ASSET_INDEX_PREFIX = 'macOS_plugin_app_asset_index_v055_';
export const CHANNEL_HOST = 'macos-plugin-host-v055';
export const CHANNEL_APP = 'macos-plugin-app-v055';
export const APP_SEARCH_PREFIX = 'macOS_plugin_app_search_v055_';
export const PERMISSION_LOG_KEY = 'macOS_plugin_permission_log_v1';
export const APP_WIDGET_PREFIX = 'macOS_plugin_app_widgets_v1_';
export const MAX_INSTANCES = 8;
export const APP_PERMISSIONS = new Set(['storage', 'network', 'openExternal', 'clipboard', 'clipboardRead', 'menu', 'files', 'notifications', 'audio', 'statusItem', 'widgets', 'pointer', 'windows']);
export const SEARCH_ITEM_LIMIT = { strict: 2000, relaxed: 10000 };
export const NATIVE_NODE_LIMIT = { strict: 2000, relaxed: 8000 };
export const FILE_LIMIT = { strict: 2_000_000_000, relaxed: 4_000_000_000, quota: 64_000_000_000 };
