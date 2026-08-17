# Connecting the Impulse-Commerce Engine to Claude

This server runs locally over stdio. Any MCP-capable Claude surface that can launch a local process can use it: **Claude Code** (CLI, desktop app, or IDE extension) and **Claude Desktop**. It cannot be used from claude.ai in the browser, because the browser cannot start a local process.

## 1. Build once

```bash
git clone https://github.com/Drikus1985/impulse-buy-engine.git
cd impulse-buy-engine
npm ci
npm run build
```

The server entry point is now `dist/index.js`. Note the absolute path to it — you will need it below:

```bash
node -e "console.log(require('path').resolve('dist/index.js'))"
```

## 2. Decide where the ledger lives

All research is persisted to a JSON ledger. By default it lives in `~/.impulse-commerce-mcp/database.json`; exported reports and launch cards land next to it in `reports/`.

To keep the ledger somewhere else (a synced folder, a per-project directory), set the `ICE_DATA_DIR` environment variable in the config below. Use one ledger per research effort — the whole point is that the database accumulates across sessions.

> **One server at a time.** The ledger has no file locking; don't point two running servers at the same `ICE_DATA_DIR`.

## 3a. Claude Code

The quickest way is the CLI:

```bash
claude mcp add impulse-commerce \
  --env ICE_DATA_DIR=/absolute/path/to/your/ledger-dir \
  -- node /absolute/path/to/impulse-buy-engine/dist/index.js
```

Add `--scope project` to share the config with everyone who clones the repo (it writes `.mcp.json` at the project root), or leave the default `local` scope to keep it personal.

Equivalent `.mcp.json` if you prefer to write it by hand:

```json
{
  "mcpServers": {
    "impulse-commerce": {
      "command": "node",
      "args": ["/absolute/path/to/impulse-buy-engine/dist/index.js"],
      "env": {
        "ICE_DATA_DIR": "/absolute/path/to/your/ledger-dir"
      }
    }
  }
}
```

Verify with `/mcp` inside a Claude Code session — you should see `impulse-commerce` listed with 24 tools.

## 3b. Claude Desktop

Edit the desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the same block under `mcpServers`:

```json
{
  "mcpServers": {
    "impulse-commerce": {
      "command": "node",
      "args": ["/absolute/path/to/impulse-buy-engine/dist/index.js"],
      "env": {
        "ICE_DATA_DIR": "/absolute/path/to/your/ledger-dir"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the 🔌 connector icon.

## 4. First session

Paste something like this as your opening prompt:

> Using the impulse-commerce tools: call `ice_get_rubrics` and `ice_ledger_stats` first. Then research impulse-buy product opportunities for [your market], record markets, categories, products, evidence and suppliers in the ledger as you go, and finish with `ice_launch_readiness`, `ice_select_portfolio` and `ice_export_report`.

Working rules the server enforces (so you don't fight them):

- **Claude does the research; the server does the arithmetic.** The server never fetches anything — pair it with web search or your own data sources.
- **Evidence gates are per-domain.** Three links to the same site count as one signal. Categories need ≥ 3 independent domains, products ≥ 2 (≥ 1 not supplier-controlled).
- **"Verified" must be earned.** Marking a supplier `verified` is rejected unless verification evidence is recorded first.
- **Products below 70/100 are watch-list ideas**, not launch recommendations, and launch cards are refused while any gate fails.

## 5. Where the outputs land

| Output | Location |
| --- | --- |
| Ledger (all recorded research) | `$ICE_DATA_DIR/database.json` |
| Full report (`ice_export_report`) | `$ICE_DATA_DIR/reports/` |
| Launch cards (`ice_export_launch_card`) | `$ICE_DATA_DIR/reports/` |

Everything is plain JSON/Markdown on disk — versionable, diffable, and readable without the server.

## Troubleshooting

- **Server not listed / no tools**: the path in `args` must be absolute and point at the *built* `dist/index.js` (run `npm run build` after every `git pull`).
- **`command not found: node`**: GUI apps don't always inherit your shell's PATH. Use the absolute path to `node` (find it with `which node`) as the `command`.
- **Ledger seems empty**: check which `ICE_DATA_DIR` the server actually used — it prints the resolved ledger path to stderr on startup, and `ice_ledger_stats` reports it too.
