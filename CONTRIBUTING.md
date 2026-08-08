# Contributing

This is an experimental local integration with an undocumented renderer API.
Compatibility, strict validation, privacy, and loopback-only operation take
priority over adding new command surfaces.

Before opening a pull request:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Protocol changes must be coordinated with the Bridge and QMK repositories.
Add tests for every accepted and rejected message shape. Do not weaken Electron
sandboxing, context isolation, IPC sender validation, or response bounds.

Bug reports should include sanitized macOS, Node, Electron, Bridge, and ChatGPT
Desktop versions. Never attach task IDs, prompts, responses, auth data, CDP
dumps, socket files, or private logs.
