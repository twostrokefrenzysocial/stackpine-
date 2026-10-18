# Optimus setup checklist

This walks you through everything Optimus needs that only you can set up: accounts, keys, and your phone. No programming knowledge needed. You'll copy commands into a terminal and click through a few websites.

Plan on about **1.5 to 2 hours** the first time. Do the sections in order and tick each box as you go.

You can use Optimus right away in **Mock Data mode** with the offline demo brain. Everything below makes it real.

---

## 0. What you need

- [ ] A computer (Mac or Windows) for the one-time setup.
- [ ] Your Samsung Galaxy S24 Ultra and its USB-C cable (optional; you can install over the web instead).
- [ ] A credit or debit card for the Anthropic account. You pay per use; the default cap in Optimus is $20/month.
- [ ] About 2 GB of free disk space on the computer.

### 0.1 Install the tools (one time)

1. [ ] Install **Node.js LTS** from <https://nodejs.org>. Choose the big "LTS" button and accept every default.
2. [ ] Install **Git** from <https://git-scm.com/downloads>, again accepting the defaults.
3. [ ] Open a terminal:
   - **Mac:** press ⌘ Space, type `Terminal`, press Enter.
   - **Windows:** press Start, type `PowerShell`, press Enter.
4. [ ] Download the project and install its parts. Copy these lines one at a time:

   ```sh
   git clone https://github.com/twostrokefrenzysocial/stackpine-.git
   cd stackpine-
   git checkout ccr-2690ea4f-9czthr
   cd optimus
   npm install
   ```

   `npm install` takes a few minutes. Warnings are normal; a red `ERR!` is not.

> From here on, "open a terminal in `optimus`" means: open a terminal, then run `cd` followed by the path to the `stackpine-/optimus` folder.

---

## 1. Anthropic API key (the AI)

1. [ ] Go to <https://console.anthropic.com> and create an account.
2. [ ] Open **Settings › Billing** and add a payment method, then buy a small amount of credit (for example $10).
3. [ ] Recommended backstop: open **Settings › Limits** and set a monthly spend limit (for example $25). The app has its own cap too; this protects you if anything is misconfigured.
4. [ ] Open **Settings › API keys**, click **Create Key**, name it `optimus-proxy`, and copy the key. It starts with `sk-ant-`.
   - Don't paste this key into the app, a chat or an email. It goes only into Cloudflare, in the next step.

### 1.1 Optional: OpenAI instead of (or as well as) Anthropic

Skip this unless you want to run Optimus on OpenAI. You can switch back and forth in the app later.

1. [ ] Go to <https://platform.openai.com>, create an account and add a payment method under **Settings › Billing**.
2. [ ] Set a monthly budget under **Settings › Limits** as a backstop.
3. [ ] Open **API keys**, create a key named `optimus-proxy` and copy it (it starts with `sk-`). Like the Anthropic key, it goes only into Cloudflare.
4. [ ] Pick the models you want: one main model and, optionally, a cheaper one for background work. Copy their exact ids from <https://platform.openai.com/docs/models> and their prices per million tokens from <https://platform.openai.com/pricing>. You'll need them in section 2.6 and 9.1.

## 2. Your private proxy on Cloudflare (holds the key, enforces the cap)

Follow **`proxy/README.md`** (about 10 minutes). In short:

1. [ ] Create a free account at <https://dash.cloudflare.com/sign-up>.
2. [ ] In a terminal in `optimus/proxy`, run:
   ```sh
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   Copy the address it prints, like `https://optimus-proxy.yourname.workers.dev`. This is your **proxy URL**.
3. [ ] Store the Anthropic key from step 1 on Cloudflare:
   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
4. [ ] Create your **app token**, a long random password only your phone will know:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the 64-character result somewhere safe (a password manager), then run:
   ```sh
   npx wrangler secret put APP_TOKEN
   ```
   and paste it when asked.
5. [ ] Open `<your proxy URL>/health` in a browser. You should see `{"ok":true}`.
6. [ ] **Only if you did section 1.1 (OpenAI):**
   ```sh
   npx wrangler secret put OPENAI_API_KEY
   ```
   Then open `optimus/proxy/wrangler.toml` in a text editor and fill in the two OpenAI lines near the bottom, using your model ids and prices. For example:
   ```toml
   OPENAI_MODELS = "your-main-model,your-mini-model"
   OPENAI_PRICES = '{"your-main-model":{"input":2,"output":10,"cacheRead":0.2},"your-mini-model":{"input":0.25,"output":2,"cacheRead":0.025}}'
   ```
   Save, then run `npx wrangler deploy` again.

## 3. Expo account (builds the app)

1. [ ] Create a free account at <https://expo.dev/signup>.
2. [ ] In a terminal in `optimus`:
   ```sh
   npx eas-cli@latest login
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   ```
   - `init` links the project to your account. It replaces `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` with your real project ID. If it asks to create a project, say yes.
   - `update:configure` sets up over-the-air updates, so later fixes reach your phone without reinstalling.
3. [ ] Create the app's signing key (Expo stores it for you):
   ```sh
   npx eas-cli@latest credentials -p android
   ```
   Choose **production** (or **preview**) › **Keystore** › **Set up a new keystore**. When it finishes, it shows the key's **SHA-1 fingerprint** (a string like `AB:CD:12:…`). **Copy the SHA-1**; Gmail setup needs it.

## 4. Gmail (optional, about 20 minutes)

1. [ ] Go to <https://console.cloud.google.com>, sign in with the Google account whose mail you want, and create a project named `Optimus`.
2. [ ] Open **APIs & Services › Library**, search for **Gmail API**, and click **Enable**.
3. [ ] Open **APIs & Services › OAuth consent screen** (it may be called **Google Auth Platform**):
   - User type: **External**. App name: `Optimus`. Use your own email for both email fields.
   - **Scopes:** add `.../auth/gmail.readonly` and `.../auth/gmail.send`.
   - **Test users:** add your own Gmail address. While the app is in *Testing*, only test users can sign in, and that's fine for personal use.
4. [ ] Open **APIs & Services › Credentials › Create credentials › OAuth client ID**:
   - Type **Android**. Package name: `com.optimus.assistant`. SHA-1: paste the fingerprint from section 3.3. Create.
   - Create a second OAuth client ID of type **Web application** (name it `Optimus web`). Copy its **Client ID**, which ends in `.apps.googleusercontent.com`.
5. [ ] In `optimus/app.json`, find `"googleWebClientId": ""` and paste the Web client ID between the quotes.
6. [ ] Note: Google may show "Google hasn't verified this app" when you sign in. Click **Continue**. That's expected for a personal app in testing.

## 5. Outlook (optional, about 15 minutes)

1. [ ] Go to <https://portal.azure.com> and sign in with your Microsoft account. A free account works.
2. [ ] Search for **App registrations** › **New registration**:
   - Name: `Optimus`.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value `optimus://oauth`.
   - Click **Register**.
3. [ ] Open **API permissions** › **Add a permission** › **Microsoft Graph** › **Delegated**, and add `Mail.Read`, `Mail.Send`, `User.Read` and `offline_access`.
4. [ ] Open **Overview**, copy the **Application (client) ID**, and paste it into `optimus/app.json` at `"microsoftClientId": ""`.

## 6. Build the installable APK

1. [ ] In a terminal in `optimus`:
   ```sh
   npm run verify
   npx eas-cli@latest build --profile preview --platform android
   ```
   The build runs on Expo's servers (about 15 to 30 minutes). When it's done you get a link and a QR code for the `.apk`.
   - If the build fails, open the link it prints, scroll to the first red error, and send it to me.

## 7. Install on the S24 Ultra

1. [ ] **Turn off Samsung Auto Blocker** for now: **Settings › Security and privacy › Auto Blocker › Off**. It blocks apps installed from outside the Play Store.
2. [ ] On the phone, open the build link or scan the QR code, and download the `.apk`.
3. [ ] Tap the downloaded file. If Android asks, allow your browser to **install unknown apps**, then tap **Install**.
4. [ ] **Turn Auto Blocker back on.** It doesn't affect apps that are already installed.

## 8. First launch on the phone

Optimus walks you through these, one screen at a time:

1. [ ] **Battery:** set Optimus to **Unrestricted** (Settings › Apps › Optimus › Battery › Unrestricted). If Optimus appears under **Battery › Background usage limits › Sleeping apps**, remove it from that list.
2. [ ] **Permissions:** contacts, calendar, texts, call log, photos, microphone, alerts and (optional) location. Each one is asked for separately; you can say no to any of them.
3. [ ] **Allow restricted settings:** Android blocks notification access for sideloaded apps until you allow it. Go to **Settings › Apps › Optimus**, tap **⋮** (top right), then **Allow restricted settings**, and confirm.
4. [ ] **Notification access:** turn on Optimus in the list that opens.
5. [ ] **App lock:** you'll be asked for your fingerprint or face. It locks again after 5 minutes in the background.

## 9. Connect Optimus to its brain and your data

1. [ ] **Settings › Connection:** choose **Anthropic** or **OpenAI**. For OpenAI, type the main model id (and optionally the background model id) exactly as in your `OPENAI_MODELS` list. Paste your **proxy URL** (section 2.2) and **app token** (section 2.4), then tap **Save and test**. You should see "Connected to your proxy." The status line changes from *Offline demo* to the model name.
2. [ ] **Settings › Usage this month:** check the cap (default $20) and change it if you like.
3. [ ] **Settings › Email:** tap **Connect** for Gmail and/or Outlook and sign in.
4. [ ] **Settings › Notifications:** exclude apps you don't want logged (banking, health). Passcodes are hidden automatically either way.
5. [ ] **Settings › Daily brief:** pick your time.
6. [ ] **Switch to real data:** **Settings › Data › Real data**. To go back to the demo phone any time, choose **Mock data**.
7. [ ] Make a backup once you've used it for a while: **Settings › Memory backup**. Choose a passphrase, tap **Export**, and save the file to Google Drive or Samsung Cloud.

## 10. Getting updates

- **JavaScript-only changes** (most fixes): in `optimus`, run
  ```sh
  npx eas-cli@latest update --channel preview --message "what changed"
  ```
  and restart the app twice. No reinstall needed.
- **Native changes** (new permissions or native code): build a new APK (section 6) and install it over the old one. Your data is kept.

---

## Test these first on the phone

None of these could be checked without your real device:

1. **Encrypted database opens** on first launch. You should get past the splash to setup. If you see "I couldn't open secure storage", send me the details.
2. **Notification listener:** after granting access, get a text or email, then ask "What did I miss?". Also check that a one-time-code notification appears with **[code hidden]**.
3. **SMS:** "Show my latest texts" (real SMS and MMS), and "Text Jen saying hi". Approve the card, then check that it was really sent.
4. **RCS chats** (Samsung Messages): they appear from notifications, not the SMS database. Check that incoming RCS messages show up.
5. **Calls:** "Who called me today?" and "Call Mom". The card should start the call after approval.
6. **Calendar:** "Add lunch with Mike tomorrow at noon". Approve it and check Samsung Calendar.
7. **Gmail and Outlook sign-in**, then "Summarize my inbox" and "Reply to …". Approve the card and check your Sent folder.
8. **Photos:** "Find the photo of …" with real photos. It should send only a few resized photos.
9. **Voice:** tap the mic and speak, and listen for the spoken reply. Try the home-screen **widget** and the long-press **shortcuts** (Ask Optimus, Today's brief, Voice).
10. **Morning brief:** the notification arrives at your chosen time (it may be late if Samsung delays it). Opening the app always builds today's brief.
11. **App lock:** fingerprint or face on open, and locking again after 5 minutes in the background.
12. **Brain performance:** smooth on the Home screen (60–120 fps). With Power saving on it should use fewer points.
13. **Backup:** export, then restore on the same phone (it replaces local data, so do this after a fresh export).
14. **OpenAI (if you use it):** switch to OpenAI, ask "What's on my calendar today?" and "Text Jen saying hi". Check that you get the same confirmation card, and that **Settings › Usage** goes up.
15. **New look:** the white theme and the brain's orbit rings, ripple and red activity band while thinking should stay smooth on the phone.
