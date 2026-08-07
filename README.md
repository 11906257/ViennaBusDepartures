# Vienna Bus Departures

A small, framework-free Progressive Web App showing upcoming departures for bus routes **59A** and **14A** in Margareten, Vienna.

## Features

- Two upcoming departures per direction in a single-column mobile layout
- Automatic refresh every 20 seconds while the app is visible and online; manual refresh restarts the 20-second timer
- No refresh timers or active API requests while the app is in the background
- Manual refresh with success and failure feedback
- Short-running buses show their actual destination in a centered warning tag
- Automatic light and dark mode
- Installable on iPhone from Safari
- Shared access key required before departure data can be requested
- Access key is stored in the browser only after a successful connection
- Offline app shell; API responses are never cached or stored persistently
- Stale departures are removed after one minute

## Departures

| Route | Stop | Direction | Stop ID |
| --- | --- | --- | --- |
| 59A | Arbeitergasse | Bhf. Meidling | `1687` |
| 59A | Arbeitergasse | Oper, Karlsplatz | `1698` |
| 14A | Arbeitergasse | Reumannplatz | `754` |
| 14A | Bacherplatz | Neubaugasse | `770` |

Departure data is provided by the public Wiener Linien real-time API. No Wiener Linien API key is required. The separate shared access key protects this app's Cloudflare Worker.

## Repository structure

```text
index.html
manifest.webmanifest
service-worker.js
icons/
  apple-touch-icon.png
  icon-192.png
  icon-512.png
proxy/
  cloudflare-worker.js
tests/
  frontend.test.mjs
  project.test.mjs
  test_dev_server.py
  worker.test.mjs
  run-tests.sh
```

The frontend is fully static. `proxy/cloudflare-worker.js` is deployed separately because the Wiener Linien API does not allow direct cross-origin browser requests from GitHub Pages.

## Deploy the Cloudflare Worker

1. In **Cloudflare → Workers & Pages**, create a Worker from the **Hello World** template and deploy it once.
2. Open **Edit code**, replace the template with `proxy/cloudflare-worker.js`, and set `ALLOWED_ORIGIN` to the future GitHub Pages origin without a repository path:

   ```js
   const ALLOWED_ORIGIN = 'https://YOUR-GITHUB-USERNAME.github.io';
   ```

   Use the custom-domain origin instead if GitHub Pages is served from a custom domain.

3. Deploy the Worker code.
4. Open the Worker's **Settings → Variables and Secrets**, select **Add**, choose **Secret**, and create:

   ```text
   Name:  ACCESS_KEY
   Value: your own long random printable ASCII key without spaces (maximum 256 characters)
   ```

   Deploy the secret change. Never put this value in the repository or directly into the Worker source.

5. Copy the deployed `workers.dev` URL and set `PRODUCTION_API_BASE_URL` in `index.html`:

   ```js
   const PRODUCTION_API_BASE_URL = 'https://vienna-bus-departures.woiki.workers.dev/monitor';
   ```

The Worker requires the `ACCESS_KEY` secret, accepts the configured browser origin, exposes only `/monitor`, and permits only the stop IDs used by this app. API responses are marked `no-store`.

## Publish with GitHub Pages

1. Upload all repository files to GitHub. Do not upload `.DS_Store`, `.env`, or `.dev.vars` files.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select the branch containing the app (normally `main`) and the repository root (`/`).
5. Save and open the generated GitHub Pages URL after deployment completes.
6. Enter the same value stored in Cloudflare as `ACCESS_KEY` when the app asks for access.

This release uses version `v25`. Before a future upload, increment `APP_VERSION` in `index.html`, `dev-server.py`, and `proxy/cloudflare-worker.js`, increment `CACHE_VERSION` in `service-worker.js`, and update the matching asset query strings in `index.html`, `service-worker.js`, and `manifest.webmanifest`.

## Optional local test

Run the development server with the same key supplied as an environment variable:

```sh
BUS_DEPARTURES_ACCESS_KEY='your-key' python3 dev-server.py
```

Then open `http://127.0.0.1:8080` and enter that key in the app.

## Verify changes

The test suite uses only Node.js and Python standard-library tools:

```sh
sh tests/run-tests.sh
```

It checks frontend data normalization and rendering, refresh scheduling, release-version consistency, manifest/app-shell integrity, Cloudflare Worker authorization and request validation, and local proxy input validation.

## Install on iPhone

1. Open the GitHub Pages URL in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Confirm with **Add**.

The interface can open offline after its first successful load. Current departure information always requires an internet connection.

After the first successful connection, the access key is stored in this browser's local storage and reused on later page loads and app sessions. Clearing the site's browser data removes it. Anyone who can access the device and browser profile may be able to use the stored key. Rotate the Cloudflare secret if the key is disclosed.

## Configuration

Routes, stop IDs, directions, refresh timing, maximum departure count, request timeout, stale-data lifetime, and minimum refresh-animation duration are defined in the `CONFIG` object in `index.html`.
