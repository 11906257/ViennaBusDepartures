# Vienna Bus Departures

A small, framework-free Progressive Web App showing upcoming departures for bus routes **59A** and **14A** in Margareten, Vienna.

## Features

- Two upcoming departures per direction in a compact 2×2 layout
- Automatic refresh every 20 seconds while the app is visible and online; manual refresh restarts the 20-second timer
- Manual refresh with success and failure feedback
- Automatic light and dark mode
- Installable on iPhone from Safari
- Shared access key required before departure data can be requested
- Access key is stored in the browser only after a successful connection
- Offline app shell; API responses are never cached or stored persistently
- Stale departures are removed after one minute

## Departures

| Route | Stop | Direction | Stop ID |
| --- | --- | --- | --- |
| 59A | Arbeitergasse | Meidling Station | `1687` |
| 59A | Arbeitergasse | Opera, Karlsplatz | `1698` |
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
```

The frontend is fully static. `cloudflare-worker.js` is deployed separately because the Wiener Linien API does not allow direct cross-origin browser requests from GitHub Pages.

## Install on iPhone

1. Open the GitHub Pages URL in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Confirm with **Add**.

The interface can open offline after its first successful load. Current departure information always requires an internet connection.

After the first successful connection, the access key is stored in this browser's local storage and reused on later page loads and app sessions. Clearing the site's browser data removes it. Anyone who can access the device and browser profile may be able to use the stored key. Rotate the Cloudflare secret if the key is disclosed.

## Configuration

Routes, stop IDs, directions, refresh timing, maximum departure count, request timeout, stale-data lifetime, and minimum refresh-animation duration are defined in the `CONFIG` object in `index.html`.
