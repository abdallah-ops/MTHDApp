# MTHD

MTHD is a private research, dose, weight, and findings tracker for personal or family use.

## Current MVP

- Family profiles
- Local profile password gates for family privacy
- Peptide vial and reconstitution records
- Compound presets for GHK-Cu, NAD+, KLOW Stack, Melanotan II, Glutathione, Retatrutide, and Tirzepatide
- Concentration calculator in mg/mL and U-100 units
- Dose timeline with planned, taken, and skipped states
- Half-life based active amount estimate from logged taken doses
- Retatrutide and Tirzepatide weight projection view using trial-average reference models
- Weight tracking with trend charts
- Findings journal for notes, side effects, appetite, sleep, mood, labs, and other observations
- Local browser storage with JSON export and import
- Optional encrypted MongoDB vault backup through Vercel API functions

## Production Build

```bash
npm run build
npm run verify:pwa
```

Vercel is configured to deploy the generated `dist/` folder and the serverless functions in `api/`. Use a local server for previewing the PWA, because root-relative production asset paths are used.

## Data Storage

The app stores data locally in the browser with `localStorage`. That keeps personal data on the device and works offline.

MongoDB backup/sync is scaffolded through `/api/sync`. The browser encrypts the app state with the vault secret before sending it to the API, and MongoDB stores the encrypted payload.

Required Vercel environment variables:

- `MONGODB_URI`
- `MONGODB_DB`

For real multi-user production access, add proper authentication before relying on shared cloud data. The local profile password is a UI privacy screen for family use, not a replacement for server-side authorization.

## Notes

MTHD records values that you enter and shows estimates from those values. It does not recommend dosing or treatment decisions.
