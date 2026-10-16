# Chrome History Calendar

Chrome extension that overrides `chrome://history` with its own page: calendar view, blocklist, and visit statistics.

Manifest V3. No background scripts or service worker — everything lives in `history.html`.

**`src/` is the extension root.** Load that folder via `chrome://extensions` → "Load unpacked", not `src/manifest.json`.

User settings (the blocklist) live in `localStorage` under the `chrome-extension://<id>` origin and survive extension updates.

## Regression check for the calendar grid and pickers

```bash
node tools/check-calendar-grid.mjs          # from the repository root, no dependencies
node tools/check-calendar-grid.mjs <path>   # same check against another calendar.js copy
```

Loads `src/js/calendar.js` into a `node:vm` context with a minimal DOM stub, drives a real `Calendar`
through a matrix of months, week orientations and mount modes, and asserts the grid invariants on
every render: 8 `<tr>`, 42 day cells of 7 per row, `cw___day` membership against the real length of
the drawn month, spill cells genuinely outside it, and `data-date` values that normalise to real
dates. Each case is inspected twice — as the constructor renders it, and after a day click has been
dispatched through the delegated handler.

A second matrix opens both pickers and drives them through the delegated handler: the month picker
from `.cw___monthChange` and the year picker from `.cw___captionMonth` (also directly, with nothing
opened before it), a month button click, a year button click, all four picker arrows, a selection,
a cleared selection, and four routes to the same captions. It asserts which overlay is open, the
pivot captions and the `pivot−7 … pivot+10` range, that the 18 year buttons are addressed by year
and not by index, that a month button applies its month and a year button applies its year while
closing the overlay, that the arrows step by 1 and 18 respectively, and where `cw___selectedMonth`
and `cw___selectedYear` land. Exits non-zero on any failure.

Run it after touching `src/js/calendar.js`. It is expected to pass (`checks 14432, failed 0`, exit 0:
8448 grid + 5984 picker). In-run canaries inject a defect into a live grid and into a live picker
state and require it to be reported, so a green run is evidence rather than a tautology.

Not covered: layout, CSS, focus and anything asynchronous — the stub models markup and event routing
only. Locale merging, popup positioning and `cw___now` (wall-clock dependent) are not asserted.

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
