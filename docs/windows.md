# Windows setup

1. Install the current **Node.js 24 LTS** Windows x64 installer and Git for Windows. Open a new PowerShell or Windows Terminal session and check `node --version` and `npm --version`.
2. Clone the repository, change into its root and run:

```powershell
npm ci
npm run setup
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of changing machine-wide execution policy. Do not pipe setup into another command: the hidden owner-password prompt requires an interactive terminal. Keep the project on a local disk rather than a network share or actively synchronized cloud-storage folder.

Open your browser on local port 3000 using the hostname in `APP_URL` (initially localhost). The web server listens on loopback. Stop both processes using Ctrl+C. To run them separately, use `npm run dev:web` and `npm run jobs` in two terminals.

`npm ci` installs platform-native SQLite/Argon2/Next.js dependencies. If a prebuilt dependency is unavailable for your Windows architecture, install Visual Studio Build Tools with Desktop development with C++ and Python, then rerun `npm ci`. Do not disable TLS or package verification to bypass installation errors.

## Configuration

Setup writes `.env` only when it does not exist. Preserve `CREDENTIAL_ENCRYPTION_KEY`: losing it makes saved mailbox credentials undecryptable. Settings can be re-entered after a deliberate key replacement, but old backups need their original key. Windows does not enforce POSIX file modes; restrict NTFS access to the user running the application and use disk encryption where appropriate.

Use the Settings form for Hostinger credentials. Never put passwords in PowerShell command arguments, screenshots, issue reports or source control. If using environment overrides, edit the ignored `.env` in a local editor. Restart both processes after environment changes.

The two-minute Inbox poll catches up after the computer wakes or the application restarts. Reminders do not require a process to remain running to be due: their timestamps persist in SQLite. Processing, sends and synchronization resume when the runner starts.

## Update a copy downloaded as a ZIP

Stop the application with Ctrl+C and run `npm.cmd run backup` in its existing
folder. Download the latest ZIP from the repository's main branch and extract it
to a separate temporary folder. Copy the new project contents into your existing
project folder, merging folders and replacing source files. Preserve your
existing `.env`, `data` and `backups`; the source archive does not contain these
private files. Keep a copy of the matching encryption key with your private
backup. Opening a completely separate new folder starts with a new database
instead of your existing records.

In PowerShell in the existing project folder, run these one at a time:

```powershell
npm.cmd ci
npm.cmd run setup -- --non-interactive
npm.cmd run dev
```

The setup command applies migrations and keeps your existing owner account. Use
your existing sign-in details. Read [open-signal tracking](outreach-tracking.md)
to connect Cloudflare and verify a controlled tracked message.

## Tests and backups

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run backup
```

Browser tests use a temporary database and fixture account. They never send to real recipients. The initial GitHub Actions run passed the complete workflow on both Linux and Windows; see the linked evidence in [validation](validation.md). Subsequent changes run the same CI matrix on push.

For restoration, stop both processes, preserve the current database, put the backup at the configured `DATABASE_URL` location, restore the matching encryption key securely, then run setup and restart. SQLite WAL/SHM files belong to the old running database; use the consistent backup rather than copying a live database file alone.
