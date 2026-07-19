# progress/

Drop a saved progress snapshot here named exactly `progress.json` and PrepFlow
will auto-load it into localStorage the next time `index.html` is opened.

## How to use it

1. In the app, click **Export Logs Database (JSON)** (Calendar & Progress tab →
   Data Backup & Sync).
2. Rename that downloaded file to `progress.json`.
3. Place it in this `progress/` folder (replacing any previous one).
4. Reload the app,it will automatically pull your logs, whiteboard mastery,
   and revision mastery from this file into localStorage.

## Notes

- If `progress.json` doesn't exist, is empty, or isn't valid JSON, the app
  just skips this step silently and uses whatever's already in localStorage
  (or starts fresh).
- The manual **Import Logs Database** button works if progress have to be downloaded
- This auto-load runs on every page load, update it whenever you want to push a
  snapshot forward.
