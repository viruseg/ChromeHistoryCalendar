# Chrome History Calendar

Chrome extension that overrides `chrome://history` with its own page: calendar view, blocklist, and visit statistics.

Manifest V3. No background scripts or service worker — everything lives in `history.html`.

**`src/` is the extension root.** Load that folder via `chrome://extensions` → "Load unpacked", not `src/manifest.json`.

User settings (the blocklist) live in `localStorage` under the `chrome-extension://<id>` origin and survive extension updates.

## Debugging via MCP

The `chrome-devtools` server is already configured globally in `~/.config/opencode/opencode.jsonc`:

```jsonc
"chrome-devtools": {
  "type": "local",
  "command": ["npx", "-y", "chrome-devtools-mcp@latest", "--categoryExtensions", "--no-usage-statistics"],
  "enabled": true
}
```

No separate setup needed. Call any `chrome-devtools_*` tool — the server starts Chrome on demand.

Order of operations:

1. `install_extension` with the absolute path `...\Chrome History Calendar\src` → returns an ID like `igokoiicompkbgdopnnejmikbpaffoio`.
2. `new_page` on `chrome-extension://<id>/history.html`.
3. From there treat it as a normal page: `list_console_messages`, `take_screenshot`, `evaluate_script`.
4. After editing anything under `src/js/`, `reload_extension` with the same ID, then reload the page.

### Gotchas

- **`chrome://history` cannot be opened through MCP** — the tool rejects the `chrome://` scheme. Load `chrome-extension://<id>/history.html` instead; it is the same page. The override itself can only be verified manually, in a regular browser window.
- **A separate Chrome is launched**, with its profile at `~/.cache/chrome-devtools-mcp/chrome-profile`. Your personal browser is untouched, but its history is empty, so lists will read "Пусто". The browser window pops up — headless is off by default.
- **`--categoryExtensions` is required**, otherwise `install_extension` / `reload_extension` / `list_extensions` are not exposed.
- **`--categoryExtensions` is incompatible** with `--browserUrl`, `--autoConnect` and `--wsEndpoint` — pipe connection only, so connecting to an already-running browser is not possible.
- **Windows:** `npx` resolves through Bun on its own. If the server fails to start, replace `"npx"` with `"C:\\Program Files\\nodejs\\npx.cmd"`.
