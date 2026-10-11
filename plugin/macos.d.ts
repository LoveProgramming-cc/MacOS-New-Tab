// Type definitions for the application runtime (API version 13).
//
// An application's entry script receives two globals: `macos` (this API) and `root` (the
// DOM root of a Web App; Native Apps use `macos.ui`). Copy this file next to your sources
// and reference it for editor completion:
//
//     /// <reference path="./macos.d.ts" />
//
// The file describes what the host accepts and sends. README.md and docs/ explain the behaviour.

declare const macos: Macos.API;
declare const root: HTMLElement;

declare namespace Macos {
  // ---------------------------------------------------------------- basics
  type Permission = 'storage' | 'files' | 'audio' | 'network' | 'notifications' | 'clipboard' | 'clipboardRead'
    | 'openExternal' | 'menu' | 'statusItem' | 'widgets' | 'pointer' | 'windows';
  type Theme = 'light' | 'dark';
  type Appearance = 'system' | 'light' | 'dark';
  type Direction = 'ltr' | 'rtl';
  type AccentName = 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'graphite';
  /** A package asset path, `blob:<file id>`, a `data:image/…` URL, or `https://…` (needs `network`). */
  type ImageSource = string;
  type Unsubscribe = () => void;

  interface Context {
    appId: string; appName: string;
    /** Why it was started: with the new tab (the user's setting) or by the user. */
    launchReason: 'autostart' | 'user'; autostart: boolean;
    language: string; region: string; direction: Direction;
    /** What the window shows now, and what the application chose (`window.setAppearance`). */
    theme: Theme; systemTheme: Theme; appearance: Appearance;
    accentColor: string; accentSetting: 'multicolor' | AccentName;
    strictSecurity: boolean; devicePixelRatio: number;
    reduceTransparency: boolean; transparentGlass: boolean; increaseContrast: boolean; reduceMotion: boolean;
    /** 1 for the first window; further windows only where the user allowed several. */
    instance: number; sharedStorage: boolean;
  }

  // ---------------------------------------------------------------- native UI nodes
  type NodeType = 'stack' | 'group' | 'split' | 'grid' | 'zstack' | 'scroll' | 'card' | 'toolbar'
    | 'text' | 'image' | 'video' | 'canvas' | 'html' | 'separator' | 'spacer'
    | 'button' | 'input' | 'textarea' | 'switch' | 'checkbox' | 'slider' | 'progress' | 'select' | 'segmented'
    | 'list' | 'table';
  type Length = number | 'fill' | 'auto' | `${number}%`;
  type Spacing = number | [number, number] | [number, number, number, number];
  type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  /** A colour token (`accent`, `text`, `secondary`, `tertiary`, `fill`, `separator`, `white`, …), `#rrggbb` or `rgb()/hsl()`. */
  type Color = string;
  type Material = 'glass' | 'bar' | 'sidebar' | 'content' | 'clear';
  type Transition = 'fade' | 'scale' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right';

  /** An entry with `submenu` opens a further menu beside it (two levels at most) and needs no `id`. */
  interface MenuItem { id?: string; label?: string; labelKey?: string; separator?: boolean; disabled?: boolean; danger?: boolean; checked?: boolean; submenu?: MenuItem[]; }
  interface Option { value: string; label?: string; labelKey?: string; }
  interface ListItem {
    id: string; title?: string; titleKey?: string; subtitle?: string; detail?: string; badge?: string; icon?: ImageSource;
    tint?: boolean; disabled?: boolean; emphasis?: boolean; indent?: number; disclosure?: 'open' | 'closed'; header?: boolean;
    menu?: MenuItem[]; drag?: boolean; drop?: boolean;
    /** Rows nested under this one (an outline, up to 8 levels). The host draws the chevron and keeps what is open in the list's `expanded`. */
    children?: ListItem[];
    /** A chevron for a row whose children are supplied once it is opened (`expand` event). */
    expandable?: boolean;
  }
  /** A titled group of rows in a list (`sections`). */
  interface ListSection { id: string; title?: string; titleKey?: string; detail?: string; collapsible?: boolean; items: ListItem[]; }
  interface TableColumn { id: string; title?: string; titleKey?: string; width?: number | `${number}fr` | 'auto'; align?: 'start' | 'center' | 'end'; sortable?: boolean; muted?: boolean; }
  interface TableRow { id: string; cells: Record<string, string>; icon?: ImageSource; emphasis?: boolean; disabled?: boolean; }
  interface TextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; color?: Color; link?: string; }
  /** A canvas display list: `['fillRect', x, y, w, h]`, `['fillStyle', 'accent']`, … (docs/native-ui.md ▸ Canvas). */
  type CanvasCommand = [string, ...unknown[]];

  /** Every node. Type-specific properties are listed below; unknown properties are dropped by the host. */
  interface Node {
    type: NodeType;
    id?: string; hidden?: boolean; disabled?: boolean; tooltip?: string; style?: string | string[];
    // size and placement
    width?: Length; height?: Length; minWidth?: Length; minHeight?: Length; maxWidth?: Length; maxHeight?: Length;
    grow?: number; alignSelf?: Align; justifySelf?: 'start' | 'center' | 'end' | 'stretch'; span?: number; rowSpan?: number;
    padding?: Spacing; margin?: Spacing;
    // appearance
    background?: Color; gradient?: Color[]; color?: Color; border?: true | Color; radius?: number | 'full'; opacity?: number;
    fontSize?: number; fontWeight?: number | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';
    textAlign?: 'start' | 'center' | 'end'; font?: 'system' | 'mono' | 'rounded';
    material?: Material; transition?: Transition;
    /** Keeps its order in a right-to-left layout (playback controls, keypads, timelines). */
    ltr?: boolean;
    hover?: boolean; showOnHover?: boolean; dismissable?: boolean;
    contextMenu?: MenuItem[];
    // containers
    children?: Node[];
    direction?: 'vertical' | 'horizontal' | 'both'; gap?: number; align?: Align; justify?: Justify; wrap?: boolean;
    columns?: number | Array<number | string> | TableColumn[]; rowHeight?: number | 'auto';
    scrollEvents?: boolean;
    // text
    text?: string; textKey?: string; variant?: string; lines?: number; selectable?: boolean; runs?: TextRun[];
    // controls
    label?: string; labelKey?: string; shape?: 'circle' | 'pill'; icon?: ImageSource; iconSize?: number; iconTint?: boolean;
    value?: string | number; placeholder?: string; placeholderKey?: string;
    inputType?: 'text' | 'number' | 'password' | 'search' | 'email' | 'url'; maxLength?: number; readOnly?: boolean; rows?: number | TableRow[];
    /** input / textarea: send a `selection` event whenever the caret or selection moves. */
    selectionEvents?: boolean;
    checked?: boolean; min?: number; max?: number; step?: number; options?: Array<string | Option>;
    // collections
    items?: ListItem[]; values?: string[]; multiple?: boolean; reorderable?: boolean; draggable?: boolean; dropTarget?: boolean;
    itemMenu?: MenuItem[]; plain?: boolean; striped?: boolean; header?: boolean; sort?: { column: string; direction: 'asc' | 'desc' };
    /** list: titled groups in place of `items`; the current group's title stays pinned at the top (`stickyHeaders: false` to turn that off). */
    sections?: ListSection[]; stickyHeaders?: boolean;
    /** list: ids of the open rows of an outline / of the folded sections. Kept by the host across renders unless given. */
    expanded?: string[]; collapsed?: string[];
    /** dropTarget lists: rows are dropped 'on' a row (default), 'between' rows, or 'both'. */
    dropPosition?: 'on' | 'between' | 'both';
    /** Room above the first / below the last row, for a bar floating over the list. */
    insetTop?: number; insetBottom?: number;
    // media
    src?: ImageSource; alt?: string; fit?: 'contain' | 'cover';
    commands?: CanvasCommand[]; pointer?: boolean;
    html?: string; css?: string; vertical?: boolean;
  }
  type NodeProps = Partial<Omit<Node, 'type'>>;

  /** What `ui.get()` returns and what every `ui` event carries about its control. */
  interface ControlState {
    value?: string; values?: string[]; checked?: boolean; disabled?: boolean; text?: string;
    /** input / textarea: the selection within `value`. */
    selectionStart?: number; selectionEnd?: number; selectionDirection?: 'forward' | 'backward' | 'none'; selectionText?: string;
  }
  type UIEventName = 'click' | 'input' | 'change' | 'submit' | 'focus' | 'blur' | 'selection' | 'select' | 'activate' | 'reorder' | 'rowdrop'
    | 'disclose' | 'expand' | 'section' | 'sort' | 'menu' | 'link' | 'reachend' | 'scroll' | 'hoverstart' | 'hoverend' | 'dismiss' | 'drop'
    | 'pointerdown' | 'pointermove' | 'pointerup';
  interface UIEvent extends ControlState {
    id: string; event: UIEventName;
    itemId?: string; menuId?: string; index?: number; order?: string[]; sourceId?: string; items?: string[];
    column?: string; direction?: 'asc' | 'desc'; href?: string; targetId?: string;
    /** rowdrop: where the rows were let go relative to `itemId`; `index` is the place among the visible rows, `parentId` / `sectionId` the outline row / section it falls in. */
    position?: 'on' | 'before' | 'after'; parentId?: string; sectionId?: string;
    /** expand: an outline row was opened or closed. section: a collapsible section was folded or unfolded. */
    expanded?: boolean; expandedIds?: string[]; collapsed?: boolean; collapsedIds?: string[];
    scrollTop?: number; scrollHeight?: number; clientHeight?: number; atEnd?: boolean; x?: number; y?: number;
  }

  // ---------------------------------------------------------------- files, audio
  interface FileInfo {
    id: string; name: string; type: string; size: number; created: number;
    duration?: number; width?: number; height?: number;
    tags?: { title?: string; artist?: string; album?: string; albumArtist?: string; track?: string; year?: string };
    artworkId?: string; subtitles?: Array<{ language: string; label: string }>;
  }
  interface AudioState {
    type: 'state' | 'play' | 'pause' | 'ended' | 'timeupdate' | 'loadedmetadata' | 'seeked' | 'volumechange' | 'error' | 'subtitles' | 'action';
    fileId: string; paused: boolean; ended: boolean; currentTime: number; duration: number; volume: number; hasVideo: boolean;
    subtitles: Array<{ label: string; language: string }>; subtitle: number;
    /** With `type: 'action'`: a media key or the system's media controls. */
    action?: 'play' | 'pause' | 'previoustrack' | 'nexttrack';
  }
  interface ArchiveEntry { path: string; fileId?: string; text?: string; base64?: string; }
  interface ExtractedEntry { path: string; text?: string; file?: FileInfo; }

  // ---------------------------------------------------------------- events
  interface KeyDetail { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean; editing: boolean; targetId: string; }
  interface EventMap {
    ui: UIEvent;
    /** Return `true` from an Escape `keydown` listener that used the key; otherwise the window closes. */
    keydown: KeyDetail; keyup: KeyDetail;
    menucommand: { command: string };
    settings: Record<string, never>;
    resize: { width: number; height: number };
    focus: Record<string, never>; blur: Record<string, never>;
    visibilitychange: { visible: boolean };
    themechange: { theme: Theme; systemTheme: Theme; appearance?: Appearance };
    accentchange: { accentColor: string; accentSetting: string };
    languagechange: { language: string; direction?: Direction };
    audio: AudioState;
    /** Over a `dropTarget` list, `position` / `index` / `parentId` / `sectionId` say where among its rows, as for `rowdrop`. */
    drop: { files: FileInfo[]; rejected: number; targetId: string; itemId: string; x: number; y: number;
      position?: 'on' | 'before' | 'after'; index?: number; parentId?: string; sectionId?: string };
    /** ⌘V in the window. Files (a copied image) are stored first; `text` only when no field had the focus. */
    paste: { id: string; types: string[]; files: FileInfo[]; text?: string };
    fileprogress: { source: 'drop' | 'picker' | 'export'; done: number; total: number; name?: string };
    /** Opened from Spotlight with one of the items listed with `search.setItems`. */
    search: { id: string; query: string };
    /** Opened from a widget; `action` is the id of the button clicked, '' for the widget itself. */
    widget: { id: string; size: 'small' | 'medium' | 'large'; action: string };
    /** Opened with `macos.openURL` for one of the manifest's `urlSchemes`; `from` is the calling application's id ('' for the system). */
    openurl: { url: string; from: string };
    /** Sent by another window of this application (`instances.broadcast`). */
    instancemessage: { from: number; message: unknown };
    /** A menu entry was chosen (`id`), or a control of the panel was used (`event`: 'click', 'input', 'change', … with `value`); `id` '' with `event` 'open' / 'close' when the panel opens and closes. */
    statusitem: { id: string; event?: string; value?: unknown };
    /** `desktop.watch()` (permission `windows`): the Dock or a window moved, changed size, order, or came or went. */
    desktopchange: DesktopLayout;
    /** The window this one was attached to (`window.attach`) closed or was hidden. */
    detached: { reason: 'closed' | 'hidden'; frame: Frame };
    /** Sent by an application named under "peers" that names this one too (`apps.send`). */
    message: { from: string; message: unknown };
    /** A peer started or quit. */
    peerchange: { id: string; running: boolean };
    /** The user opened the application again (Dock, Launchpad, Spotlight) while it was running. */
    reopen: Record<string, never>;
    /** The browser window changed size. `moved`: the host moved this (frameless) window back on screen. */
    screenchange: { screen: Screen; frame: Frame; moved: boolean };
    /** `window.trackPointer(true)` (permission `pointer`): the pointer over the desktop, relative to this window. */
    pointerposition: { x: number; y: number; screenX: number; screenY: number };
    /** `action` is the id of the button pressed, '' when the notification itself was opened. */
    notificationclick: { tag?: string; id?: string; action: string };
  }

  /** The desktop around a window: the menu bar ends at `top`, the Dock starts at `bottom`. */
  interface Screen { width: number; height: number; top: number; bottom: number; dock: { x: number; y: number; width: number; height: number; radius: number } | null; }
  interface Frame { x: number; y: number; width: number; height: number; screen: Screen; }
  /** A window on the desktop, as other applications may see it: where it is, never what is in it. */
  interface DesktopWindow {
    /** Pass it to `window.attach`. */
    id: string;
    /** The application's id; '' for a window of the system (Settings, Finder, …). */
    app: string; system: boolean;
    x: number; y: number; width: number; height: number; radius: number;
    level: 'desktop' | 'normal' | 'floating'; frameless: boolean;
    /** Stacking order: a larger number is in front. */
    z: number;
    /** This application's own window. */
    own: boolean;
  }
  /** `windows` are the shown ones, front to back. `dock` is null while the Dock is hidden. */
  interface DesktopLayout { screen: Screen; dock: Screen['dock']; windows: DesktopWindow[];
    /** The widgets on the desktop: they lie under every window. */
    widgets: Array<{ id: string; x: number; y: number; width: number; height: number; radius: number }>; }

  // ---------------------------------------------------------------- API
  interface API {
    readonly version: number;
    readonly context: Readonly<Context>;
    on<K extends keyof EventMap>(name: K, listener: (detail: EventMap[K]) => unknown): Unsubscribe;
    on(name: string, listener: (detail: any) => unknown): Unsubscribe;
    log(...values: unknown[]): void;

    /** Native Apps: the interface. `patch` calls of one tick travel as one batch. */
    ui: {
      render(tree: Node): Promise<boolean>;
      patch(id: string, props: NodeProps): Promise<boolean>;
      batch(patches: Array<{ id: string; props: NodeProps }>): Promise<boolean>;
      replace(id: string, node: Node): Promise<boolean>;
      append(parentId: string, node: Node, index?: number | null): Promise<boolean>;
      setChildren(parentId: string, children: Node[]): Promise<boolean>;
      remove(id: string): Promise<boolean>;
      get(id: string): Promise<ControlState>;
      focus(id: string): Promise<boolean>;
      scrollTo(id: string, options: { top?: number; itemId?: string }): Promise<boolean>;
      /** input / textarea: select `start`…`end` (and scroll it into view unless `reveal: false`). */
      setSelection(id: string, selection: { start: number; end?: number; direction?: 'forward' | 'backward' | 'none'; reveal?: boolean }): Promise<ControlState>;
      /** input / textarea: type `text` over the selection; the user can undo it. `select`: where the selection ends up. */
      replaceSelection(id: string, text: string, options?: { select?: 'end' | 'start' | 'all' }): Promise<ControlState>;
      /** At the pointer, or at `x`, `y` in window coordinates. Resolves the chosen item's id, or null. */
      showMenu(items: MenuItem[], position?: { x?: number; y?: number }): Promise<string | null>;
      defineStyles(styles: Record<string, NodeProps>): Promise<boolean>;
    };

    window: {
      setTitle(title: string): Promise<boolean>;
      resize(width: number, height: number): Promise<boolean>;
      center(): Promise<boolean>; focus(): Promise<boolean>; minimize(): Promise<boolean>; close(): Promise<boolean>;
      getBounds(): Promise<{ left: number; top: number; width: number; height: number; maximized: boolean }>;
      setAccentColor(color?: AccentName | `#${string}` | null): Promise<{ accentColor: string; accentSetting: string }>;
      setAppearance(appearance?: Appearance | null): Promise<{ appearance: Appearance; theme: Theme }>;
      getFrame(): Promise<Frame>;
      /** Moves the window (kept on the desktop); with `duration` (ms, up to 20 000) it glides there. */
      moveTo(x: number, y: number, options?: { duration?: number; easing?: 'linear' | 'ease' }): Promise<Frame & { clamped: boolean; cancelled: boolean }>;
      /** From a `pointerdown`: the user carries the window by what was pressed. Resolves when it is put down. */
      /** velocity: how fast the pointer was going when it let go, px/s — for something that is thrown. */
      beginDrag(event: PointerEvent): Promise<Frame & { clamped: boolean; velocity: { x: number; y: number } }>;
      /** Permission `pointer`: `pointerposition` events while on. */
      trackPointer(on?: boolean): Promise<boolean>;
      /** Frameless windows: the [x, y, width, height] rectangles it covers (up to 400); clicks elsewhere fall through. null: the whole window. */
      setShape(rects: Array<[number, number, number, number]> | null): Promise<number | boolean>;
      /** Frameless Web Apps: where the window takes the pointer (up to 64 rectangles); it is drawn in full and clicks elsewhere fall through. [] none, null everywhere. */
      setHitRegion(rects: Array<[number, number, number, number]> | null): Promise<number | boolean>;
      /** 'desktop': behind every window. 'floating': over every window. */
      setLevel(level?: 'desktop' | 'normal' | 'floating'): Promise<'desktop' | 'normal' | 'floating'>;
      /** Permission `windows`: travel with another window (`DesktopWindow.id`) or the Dock ('dock'), keeping this place relative to its top or bottom edge. `attach(null)` lets go. */
      attach(id: string | null, options?: { edge?: 'top' | 'bottom' }): Promise<boolean>;
    };

    /** Permission `windows`: where the Dock and the windows are. `watch()` also sends `desktopchange`. */
    desktop: { getLayout(): Promise<DesktopLayout>; watch(on?: boolean): Promise<DesktopLayout> };
    /** Applications that name each other under "peers" in their manifests. `send` resolves false when the other one is not running. */
    apps: { send(to: string, message: unknown): Promise<boolean>; peers(): Promise<Array<{ id: string; running: boolean }>> };

    dialog: {
      alert(message: string, options?: { title?: string; detail?: string }): Promise<boolean>;
      confirm(message: string, options?: { title?: string; detail?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean>;
      prompt(message: string, options?: { title?: string; value?: string; placeholder?: string }): Promise<string | null>;
      /** `store: true` puts the chosen files into `macos.files` and resolves their FileInfo (an array with `multiple`, null / [] when cancelled); otherwise their contents are read `as` text, dataUrl or base64. */
      openFile(options?: { accept?: string; multiple?: boolean; store?: boolean; as?: 'text' | 'dataUrl' | 'base64'; maxBytes?: number }): Promise<any>;
      saveFile(options: { name: string; text?: string; base64?: string; mime?: string }): Promise<boolean>;
    };

    /** Permission `storage`: a JSON key/value store (4 MB a value, 32 MB in all under strict security). */
    storage: {
      get(key?: string | null): Promise<any>;
      set(key: string, value: unknown): Promise<boolean>;
      remove(key: string): Promise<boolean>;
      clear(): Promise<boolean>;
    };

    /** Permission `files`: binary files kept on the host side; the application holds ids. */
    files: {
      put(options: { name: string; text?: string; base64?: string; dataUrl?: string; type?: string }): Promise<FileInfo>;
      list(): Promise<FileInfo[]>;
      info(id: string): Promise<FileInfo | null>;
      /** Text by default. Only files up to 8 MB (strict security) can be read into the application. */
      read(id: string, options?: { as?: 'text' | 'base64' | 'dataUrl' }): Promise<string>;
      remove(id: string): Promise<boolean>;
      export(id: string, name?: string): Promise<boolean>;
      usage(): Promise<{ count: number; bytes: number }>;
      clear(): Promise<boolean>;
    };
    /** Permission `files`. */
    archive: {
      create(options: { name?: string; entries: ArchiveEntry[]; store?: boolean }): Promise<boolean | FileInfo>;
      extract(fileId: string, options?: { inlineText?: boolean }): Promise<ExtractedEntry[]>;
    };

    /** Permission `audio`: one host-side player per application. */
    audio: {
      load(fileId: string, options?: { autoplay?: boolean; startAt?: number; crossfade?: number; subtitles?: Array<{ fileId: string; label?: string; language?: string }>; subtitle?: number }): Promise<AudioState>;
      play(options?: { fade?: number }): Promise<AudioState>;
      pause(options?: { fade?: number }): Promise<AudioState>;
      stop(): Promise<AudioState>;
      seek(time: number): Promise<AudioState>;
      setVolume(volume: number): Promise<AudioState>;
      setMetadata(metadata: { title?: string; artist?: string; album?: string; artwork?: ImageSource }): Promise<boolean>;
      setSubtitle(index: number): Promise<AudioState>;
      addSubtitle(options: { fileId: string; label?: string; language?: string }): Promise<AudioState>;
      state(): Promise<AudioState>;
    };

    /** Permission `network`. */
    fetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; responseType?: string }): Promise<any>;
    /** Permission `openExternal`: a web page in a new tab. */
    openExternal(url: string): Promise<boolean>;
    /** Permission `openExternal`: a link to another application (its manifest's `urlSchemes`), or a web page. */
    openURL(url: string): Promise<boolean>;
    clipboard: { writeText(text: string): Promise<boolean>; readText(): Promise<string> };

    /** Permission `notifications`. */
    notifications: { show(options: { title: string; body?: string; tag?: string; duration?: number;
      /** Up to three buttons. Each opens the application, like the notification itself, and arrives as `notificationclick.action`. */
      actions?: Array<{ id: string; title: string; destructive?: boolean }> }): Promise<string>;
      /** Shown by the system at `at`, whether or not a new tab is open then. A second call with the same `id` replaces the first. Up to 64 per application. */
      schedule(options: { id?: string; at: number | Date; title: string; body?: string; tag?: string; actions?: Array<{ id: string; title: string; destructive?: boolean }> }): Promise<string>;
      /** Cancels one scheduled notification, or all of them. Resolves with how many. */
      cancel(id?: string | null): Promise<number>;
      scheduled(): Promise<Array<{ id: string; at: number; title: string; body: string; tag: string }>>;
    };
    /** What Spotlight may find in this application. */
    search: { setItems(items: Array<{ id: string; title: string; subtitle?: string; keywords?: string }>): Promise<number>; clear(): Promise<boolean> };
    /** Permission `statusItem`: one item on the right of the menu bar. */
    statusItem: {
      /** `panel`: a small UI tree shown in a popover under the item (leave it out to keep the one there is, null to remove it). */
      set(options: { icon?: ImageSource; template?: boolean; title?: string; tooltip?: string; items?: MenuItem[]; panel?: object | null }): Promise<boolean>;
      /** Changes properties of nodes in the panel. */
      patch(id: string, props: object): Promise<boolean>;
      patch(patches: Array<{ id: string; props: object }>): Promise<boolean>;
      remove(): Promise<boolean>;
    };
    /** Permission `widgets`: what the widgets declared in the manifest show. */
    widgets: {
      set(id: string, content: Node | Partial<Record<'small' | 'medium' | 'large', Node>>): Promise<boolean>;
      clear(id?: string | null): Promise<boolean>;
      list(): Promise<Array<{ id: string; sizes: string[]; placed: Array<{ size: string; location: 'desktop' | 'center' }> }>>;
    };
    /** Declared permissions the user switched off. `request` shows the system's dialog; it resolves true only when all are granted. */
    permissions: { status(): Promise<Partial<Record<Permission, 'granted' | 'denied'>>>; request(names: Permission | Permission[]): Promise<boolean> };
    /** The windows of this application (several only where the user allowed that). */
    instances: {
      list(): Promise<Array<{ instance: number; self: boolean; front: boolean; title: string; sharedStorage: boolean }>>;
      /** Sends `instancemessage` to every other window; resolves how many received it. */
      broadcast(message: unknown): Promise<number>;
      /** Whether a further window of this application may be opened now: the user allowed several, and the limit is not reached. */
      canOpen(): Promise<boolean>;
      /** Opens a further window of this application; false when `canOpen()` is. */
      open(): Promise<boolean>;
    };
    /** Permission `menu`: host menu commands. */
    menu: { list(): Promise<Array<{ id: string; label: string }>>; invoke(command: string): Promise<boolean> };

    system: {
      getInfo(): Promise<Context & { appVersion: string }>;
      /** Where the application stands against the host's budgets (null: no limit). */
      getStats(): Promise<{
        apiCallsThisSecond: number; apiCallsLimit: number | null; apiCallsAdvised: number;
        nodeCount: number | null; nodeLimit: number | null;
        storageBytes: number; storageQuota: number | null;
        fileCount: number; fileBytes: number; fileQuota: number | null;
        securityLevel: 'strict' | 'relaxed' | 'unrestricted';
      }>;
    };
    i18n: { t(key: string, fallback?: string): string; language(): string; direction(): Direction };
    assets: { url(path: string): Promise<string>; list(): readonly string[] };
  }
}
