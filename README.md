# Browndy Predicts

A mobile-friendly starter app for football fixtures, illustrative score estimates, and on-device prediction history.

## Deploy on Netlify
1. Import this repository into Netlify, or replace the contents of the existing repository with these files.
2. In Netlify site settings, add the environment variable `FOOTBALL_DATA_TOKEN` with your football-data.org API token. Mark it as secret.
3. Trigger a new production deploy.
4. Test the function endpoint: `/.netlify/functions/football`
5. Open the app and tap **Load matches**.

Never place the API token in `index.html`, commit it to GitHub, or share it in chat.

## Important limitations
- The included score estimates are an illustrative baseline, not a validated forecasting model and not five connected AI systems.
- The subscription page is informational only. It does not collect or verify MTN Mobile Money payments and does not lock predictions.
- Prediction history is stored in the current browser/device only.
- Do not use estimates as guaranteed betting advice.
