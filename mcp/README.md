# kodecz-mcp

MCP server for [Kodecz](https://github.com/konecz/kodecz), the open-source engine that renders a web page into an
MP4 on an NVIDIA GPU or on any CPU. It gives any MCP client the three commands of the Kodecz loop:

| Tool | What it does |
|---|---|
| `render` | renders a video folder to MP4 (`cpu`, `hevc`, `alpha`, `from`, `frames`); returns the render's JSON line |
| `preview` | draws the given frames as lossless PNGs and returns them as images, so the agent can look |
| `check` | runs the automatic checks on every frame (text over a face, one-line captions, safe area, contrast, zoom timing); returns the JSON result and pictures of the problems |

The server has no dependencies. It runs the `kodecz` command already installed on the machine (set `KODECZ_BIN` to
another path), with an argument list and never through a shell, so Kodecz itself must be installed first
([quick start](https://github.com/konecz/kodecz#quick-start)).

## Use

Claude Code: the Kodecz plugin starts it for you (`/plugin install kodecz --marketplace konecz/kodecz`).

Any other client (Claude Desktop, Cursor, Codex, VS Code...):

```json
{ "mcpServers": { "kodecz": { "command": "npx", "args": ["-y", "kodecz-mcp"] } } }
```

From a clone, without npm: `"command": "node", "args": ["/path/to/kodecz/mcp/kodecz-mcp.mjs"]`.

Paths in tool calls are absolute or relative to the server's working directory. Tests: `node --test mcp/kodecz-mcp.test.mjs`.

Apache-2.0. Created by Konecz.
