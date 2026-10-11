#!/usr/bin/env python3
"""Pack an application directory into a one-file macos-app-package-v3.

    python3 plugin/tools/pack.py plugin/examples/music
    python3 plugin/tools/pack.py plugin/examples/music --bundled   # also refresh default.json

The directory holds app.json (the manifest: id, name, entry, window, ...) plus the
files it refers to. The result is written next to the directory as <dir>.macos-app.json.
"""
import base64, json, pathlib, sys

TEXT = {'.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md'}
MIME = {
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain', '.md': 'text/markdown', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
}


def pack(directory):
    root = pathlib.Path(directory).resolve()
    manifest = json.loads((root / 'app.json').read_text(encoding='utf-8'))
    files = {}
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.name in ('app.json', '.DS_Store'):
            continue
        key = path.relative_to(root).as_posix()
        suffix = path.suffix.lower()
        record = {'mime': MIME.get(suffix, 'application/octet-stream')}
        if suffix in TEXT:
            record['text'] = path.read_text(encoding='utf-8')
        else:
            record['base64'] = base64.b64encode(path.read_bytes()).decode('ascii')
        files[key] = record
    package = {'format': 'macos-app-package-v3', **manifest, 'files': files}
    target = root.with_name(root.name + '.macos-app.json')
    target.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{target.name}: {len(files)} files, {target.stat().st_size} bytes')
    return package


def sync_bundled(directory, package):
    """Refresh the bundled-application record in default.json from the manifest.

    Bundled applications are listed in default.json (metadata only; the package is read
    from plugin/examples at run time). Run with --bundled after changing a bundled app.
    """
    root = pathlib.Path(directory).resolve()
    extension = root.parents[2]
    defaults_path = extension / 'default.json'
    defaults = json.loads(defaults_path.read_text(encoding='utf-8'))
    icon = package.get('icon', '')
    record = package['files'].get(icon)
    if record:
        data = record.get('base64') or base64.b64encode(record['text'].encode('utf-8')).decode('ascii')
        icon = f"data:{record['mime']};base64,{data}"
    keep = ('id', 'name', 'version', 'kind', 'runtime', 'description', 'permissions', 'menus', 'appMenu', 'window', 'settings', 'accentColor', 'widgets', 'urlSchemes')
    entry = {key: package[key] for key in keep if key in package}
    entry.update({'icon': icon, 'bundled': True, 'packageStored': False,
                  'packagePath': (root.with_name(root.name + '.macos-app.json')).relative_to(extension).as_posix()})
    apps = defaults.setdefault('plugins', {}).setdefault('apps', [])
    for index, app in enumerate(apps):
        if app.get('id') == entry['id']:
            apps[index] = entry
            break
    else:
        apps.append(entry)
    defaults_path.write_text(json.dumps(defaults, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"default.json: {entry['id']} {entry['version']}")


if __name__ == '__main__':
    args = [arg for arg in sys.argv[1:] if arg != '--bundled']
    if len(args) != 1:
        sys.exit(__doc__)
    built = pack(args[0])
    if '--bundled' in sys.argv:
        sync_bundled(args[0], built)
