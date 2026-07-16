# Patton Legal — Drive-to-Dashboard Pipeline

Pulls new files from a Google Drive folder every 6 hours, extracts case
data with Claude, and serves the merged dataset as JSON for the Legal
Cases Dashboard to fetch.

```
Google Drive folder
      |
      v  (every 6 hours, via cron)
lib/driveClient.js   -> lists + downloads new files
lib/extractText.js   -> PDF/email/text -> plain text
lib/claudeExtract.js -> Claude -> structured JSON
lib/schema.js        -> validates before merging (rejects bad data)
lib/dataStore.js      -> merges into dataset.json on a persistent volume
      |
      v
server.js  ->  GET /api/data  (CORS-enabled JSON endpoint)
      |
      v
dashboard.html  ->  fetch('.../api/data') on load
```

---

## 1. Google Drive setup

The pipeline authenticates as a **service account**, not your personal
Google login — service accounts don't automatically see your Drive, so
you must explicitly share the folder with it.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (or use an existing one).
2. Enable the **Google Drive API**: APIs & Services > Library > search
   "Google Drive API" > Enable.
3. Create a service account: APIs & Services > Credentials > Create
   Credentials > Service Account. Name it something like
   `patton-legal-pipeline`.
4. Open the service account > Keys > Add Key > Create new key > JSON.
   This downloads a `.json` file — **keep it private**, it's a credential.
5. Copy the `client_email` field out of that JSON file (looks like
   `patton-legal-pipeline@your-project.iam.gserviceaccount.com`).
6. In Google Drive, right-click the folder you want monitored > Share >
   paste that service account email > give it **Viewer** access.
7. Get the folder ID from its URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**

You'll use the full JSON file's contents and the folder ID as environment
variables in step 3.

---

## 2. Anthropic API key

Get a key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).
This is billed separately from your Claude.ai subscription — it's pay-as-you-go
API usage, not part of your Team plan seats.

---

## 3. Deploy to Railway

1. Push this folder to a new GitHub repository.
2. In [Railway](https://railway.app), click **New Project > Deploy from GitHub repo**
   and select it.
3. Add a **Volume**: in the service's Settings tab, click "Add Volume,"
   mount it at `/data`. This is what makes the dataset survive redeploys.
4. Under **Variables**, add each of these (see `.env.example` for the
   exact format of each):
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (the whole downloaded JSON file, minified to one line)
   - `DRIVE_FOLDER_ID`
   - `DATA_DIR` = `/data` (must match the volume's mount path from step 3)
   - `PIPELINE_TOKEN` (any random string — used to protect the manual-run endpoint)
5. Deploy. Railway will run `npm install` then `npm start` automatically.
6. Once deployed, Railway gives you a public URL like
   `https://patton-legal-pipeline-production.up.railway.app`. Test it:
   ```
   curl https://your-app.up.railway.app/healthz
   ```
   should return `{"ok":true}`.

The pipeline runs automatically every 6 hours from this point on (cron
schedule: `0 */6 * * *`, i.e. midnight, 6am, noon, 6pm UTC).

### Testing it manually before waiting 6 hours

```bash
curl -X POST https://your-app.up.railway.app/api/run-now \
  -H "x-pipeline-token: <your PIPELINE_TOKEN value>"
```

Then check the data:
```bash
curl https://your-app.up.railway.app/api/data
```

Watch Railway's deploy logs (Service > Deployments > View Logs) while it
runs — every step logs what it's doing (`[pipeline] Processing 'filename.pdf'...`),
so you can see extraction quality on real files before trusting it fully.

---

## 4. Connect the dashboard

The dashboard currently has its data embedded directly in the HTML. To
make it pull from this live endpoint instead, replace the embedded
`<script id="data" type="application/json">...</script>` block and the
line that reads `const DATA = JSON.parse(document.getElementById('data').textContent);`
with a fetch call:

```js
let DATA = { cases: [], notes: [], generatedAt: null };

async function loadData() {
  const res = await fetch('https://your-app.up.railway.app/api/data');
  DATA = await res.json();
  render(); // re-run the existing render function once data arrives
}
loadData();
```

I can make this exact edit to `dashboard.html` once your Railway URL is
live — send it over and I'll wire it in and re-share the artifact.

---

## 5. Keep an eye on `rejections.log`

Any extraction that fails validation (bad date, wrong type, unknown case
key format) gets logged to `/data/rejections.log` on the volume instead of
silently entering the dataset. Since this is running fully unattended,
it's worth checking that file periodically — you can view it via
Railway's shell (Service > Settings > "Open Shell") with:

```bash
cat /data/rejections.log
```

If you start seeing a pattern of rejections (e.g., a particular email
format the parser doesn't handle well), that's a signal to improve
`lib/extractText.js` or the prompt in `lib/claudeExtract.js`.
