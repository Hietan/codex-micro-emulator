# Security

## Reporting

Use GitHub private vulnerability reporting for security issues. Do not include
prompts, responses, task identifiers, authentication material, CDP dumps, or
unsanitized logs. Only the latest tagged release is supported.

## Security boundary

The app is a local client for `codex-micro-bridge`. It does not expose an HTTP server and does not connect directly to the internet.

- Electron renderer `nodeIntegration` is disabled.
- `contextIsolation` and renderer sandboxing are enabled.
- The preload bridge exposes only three narrow IPC calls.
- Main-process IPC validates the sender, Unix socket path, protocol version, event type, key ID, action, and joystick range.
- Bridge responses are validated before crossing IPC. Agent snapshots must contain exactly six bounded status-only records and cannot carry task IDs, titles, prompts, or responses.
- No arbitrary JavaScript or arbitrary Codex command ID can pass through the IPC boundary.
- Only the local socket path and Mic display preference are stored in renderer `localStorage`.
- The connected `codex-micro-bridge` ultimately uses a privileged CDP endpoint. Keep that endpoint bound to `127.0.0.1` and review the bridge security documentation.

This application uses undocumented ChatGPT Desktop renderer events and should be treated as an experimental local development tool.
