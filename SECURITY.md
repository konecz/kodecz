# Security policy

## Supported versions

Kodecz has no tagged releases yet. Security fixes go to the `main` branch.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability**, at
<https://github.com/konecz/kodecz/security/advisories/new>. Include what you found, how to reproduce it, and the
commit you tested.

You will get an answer within 7 days. When a fix is ready, we publish a GitHub security advisory and credit you,
unless you prefer to stay anonymous.

## Scope

Kodecz renders a web page you provide into a video. The page runs in an embedded Chromium (CEF) with access to the
files of its own folder. Treat a composition like code: render only compositions you trust, or run the renderer in an
isolated user, container or VM.
