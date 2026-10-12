# Local HTTPS access to OpenClaw

The optional [local control adapter](../scripts/local-control-proxy.mjs) keeps a named HTTPS URL in the browser while forwarding HTTP and WebSocket traffic to the same machine's Gateway. It is independent of the Nido plugin package. Current work and delivery state belong to [NIDO-004](next-steps.md).

## Why an adapter is needed

The inspected OpenClaw 2026.9.8 runtime rejects forwarded traffic whose resolved client address is loopback, even with narrowly configured `gateway.trustedProxies`. A direct Portless alias therefore returns `proxy_attribution_required`. This is consistent with the [upstream ingress rules](https://docs.openclaw.ai/gateway/trusted-proxy). A redirect avoids that rejection but changes the browser origin.

For a strictly local browser, the adapter first requires a loopback socket, an entirely loopback forwarded chain, the configured Host and forwarded Host, and an HTTPS forwarded protocol. If Origin is present it must match exactly; WebSocket upgrades require it. Cross-site fetch metadata is rejected. Only then does it remove forwarding and Tailscale identity headers and connect to the fixed loopback Gateway. Host, Origin, credentials, cookies, paths, query parameters, and request bodies are preserved. The Gateway sees local traffic and retains its normal authentication and origin checks. The adapter neither knows nor injects a Gateway token.

**This is not a LAN or public reverse proxy.** Both the TLS frontend and adapter must remain loopback-only. Do not combine it with Portless LAN, Funnel, or other remote tunnels. Local processes retain the same trust boundary as direct access to the local Gateway. For remote users, configure supported attributed ingress instead.

## Setup and recovery

Use the installed Gateway profile, preserve its authentication and existing origin allowlist, and back up the affected configuration and service definition privately before making changes. The following names and ports are examples, not a discovery of an installation:

```sh
node scripts/local-control-proxy.mjs https://control.localhost 18788 18789
portless alias control 18788 --force
```

Keep this adapter running under the existing local service manager, using absolute paths to Node and the script. Configure `gateway.controlUi.allowedOrigins` to include the exact HTTPS origin, retaining any existing entries. Do not enable wildcard origins, Host-header fallback, insecure authentication, or trusted-proxy authentication. No `trustedProxies` addition is needed for this adapter. Portless must already have its local certificate trusted and its HTTPS service enabled; its persistent alias targets the adapter, not the Gateway or a redirect handler.

Verify HTTP 200 without an external redirect, asset loading, a WebSocket challenge, and an authenticated handshake. A fresh browser origin has separate storage: enter the existing Gateway secret through the normal sign-in screen once. Never put the secret in public documentation, diagnostics, or a redirect URL. Page rendering alone is not proof of an authenticated connection.

To roll back, restore the previous private service/configuration copies and alias, then restart only the adapter service. Preserve unrelated routes and Gateway settings. Gateway origin changes hot-apply in the inspected version; neither Gateway nor NOTE4 needs restarting for this change.

## Verification

`pnpm exec vitest run tests/local-control-proxy.test.ts` uses a fictitious upstream to verify credential preservation, unauthenticated rejection, HTTP paths/bodies, rejection of remote chains and foreign origins, and bidirectional WebSocket bytes. It requires permission to bind loopback ports. See [dated verification](verification.md) for the separately authorized installation check.
