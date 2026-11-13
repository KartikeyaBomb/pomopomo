# Own Cloudflare hosting and deployment

The independent target is `https://pomopomo.pomopomo-karti.workers.dev`, in the user's Cloudflare account. The existing Sites deployment remains the active source until the data transfer is verified and the device gateway is switched.

## Daily workflow after cutover

1. Edit the project in any editor.
2. Run `npm test` and `npm run build:cloudflare`.
3. Commit and push to `main` in `KartikeyaBomb/pomopomo`.
4. GitHub Actions runs checks, applies D1 schema migrations, and deploys the compiled Worker and assets. Deployment status appears under the repository's Actions tab. Firmware/docs-only pushes do not redeploy the web app.

Use `npm run dev:cloudflare` for the independent local build. Production config is `wrangler.cloudflare.jsonc`; the Vite plugin emits the deployment config under `dist/server/wrangler.json`. The original `npm run build`/Sites path remains available during migration. Do not point the standalone build at the old Sites database placeholder.

## One-time deployment credential

Cloudflare MCP currently permits configuring the account's Worker, D1, and Access resources but not creating account API tokens. A human must authorize a deployment token. Do not send its value in chat or commit it.

At https://dash.cloudflare.com/profile/api-tokens create a custom token with:

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- Account → Account Settings → Read
- Account resources: only the account used in `wrangler.cloudflare.jsonc`

Save it directly to GitHub's encrypted repository secrets:

```sh
cd /Users/kartibomb/Coding/pomopomo/pomopomo
python3 scripts/setup-cloudflare-ci.py
```

The prompt hides the token, passes it to `gh secret set` over stdin, and writes no local token file. GitHub Actions requires the `CLOUDFLARE_API_TOKEN` repository secret. Local `wrangler login` is optional for manual deployments and does not supply the CI credential.

## Authentication and data ownership

Cloudflare Access protects the production hostname with an exact-owner-email policy and email one-time PIN sign-in. The app also verifies the Access JWT signature, issuer, audience, expiration, and owner email before mapping it to the original migrated user ID. Browser-supplied Sites identity headers are stripped. Runtime secrets `OWNER_EMAIL` and `OWNER_USER_ID` are set in Cloudflare, not the public Git repository.

The narrower `/api/device/*` Access application bypasses browser sign-in, while those routes still require the existing hashed device-token authorization. The plural `/api/devices` browser-management endpoint remains protected. New tokens, revocations, receipt IDs and history use the same D1 schema/business logic.

Required production variables: `AUTH_MODE=cloudflare`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (tracked config); `OWNER_EMAIL`, `OWNER_USER_ID` (Cloudflare runtime secrets). The Worker fails closed when required owner settings are missing.

The existing gateway address can stay on ESP32 firmware; its upstream will change to the independent Worker after transfer. Matching token hashes and command receipts will be copied so pairing and retries continue to work. Reinstall the phone PWA from the new hostname after cutover, since browser storage and service workers are scoped to an origin.

## Migration controls

A temporary source-only `/api/migration` endpoint requires an expiring, independently generated secret as well as the private Sites access boundary. It will only export a source with one account. It copies the exact user state, history, device rows, and timer command receipts.

The source is frozen with SQLite triggers before the final snapshot, preventing in-flight old clients from creating divergent writes after export. The old URL then redirects to the new hostname. `unfreeze` is a pre-cutover recovery action if import validation fails. Do not unfreeze after the new app has accepted writes without reconciling those writes first.

The independent Worker returns maintenance responses until `deployment_state` has `ready=1`. Do not mark it ready until account secrets, authentication policy and imported row counts are verified. The original database is retained as a backup. The temporary export secret should be removed and source endpoint disabled after successful cutover.

## References

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- https://developers.cloudflare.com/workers/configuration/secrets/
