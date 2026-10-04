# Group Trip Planner

Trip options with voting, costs per option, per-person split, itinerary, budget, settle-up.
Shared data is stored in Netlify Blobs through the function in netlify/functions/api.mjs.

IMPORTANT: Netlify Drop (drag-and-drop on app.netlify.com/drop) does NOT run the function.
The page opens, but it shows a red "Not shared yet" banner and saves on one device only.
Use option A or B so your friends share the same trip.

## A. Netlify CLI (from a computer)
1. Install Node.js (https://nodejs.org).
2. Unzip. Open a terminal IN the unzipped folder (the one with index.html and netlify.toml).
3. npx netlify-cli login
4. npx netlify-cli link        (choose your existing site, e.g. tripplannerlebron)
5. npx netlify-cli deploy --build --prod

## B. GitHub (works from a phone browser)
1. New GitHub repo > "uploading an existing file" > upload the CONTENTS of the zip
   so index.html and netlify.toml are at the TOP of the repo, not inside a folder.
2. Netlify > your site > Site configuration > Build & deploy > Link repository > pick the repo.
   Leave base directory, build command and publish directory EMPTY (netlify.toml sets them).
3. Deploy.

## Check it worked
Open https://YOUR-SITE.netlify.app/api/state
- You see text like {"trip":null,"options":[]...}  -> working.
- You see "Page not found"                          -> the function did not deploy (see above).

## Private trip (recommended)
Site configuration > Environment variables > add TRIP_CODE = any code. Redeploy. Give friends the code.
