# Local demo startup

Double-click `start-signbridge.cmd` from the SignBridge folder. It checks both HTTP endpoints before opening the Sign Workspace, keeps the background server windows hidden, and reuses healthy servers. Node 22.12+ and installed dependencies (`npm ci`) are required. It does not install software automatically.

The local launcher binds web port 5174 and room port 3001 to `127.0.0.1`. It does not enable network access, install a Windows service, create a scheduled task, request administrator rights, or start on login. Existing `npm run rooms` and deployment behavior are unchanged.

Double-click `stop-signbridge.cmd` after the demo. It stops only the Node processes recorded by this launcher when the PID, process creation time and exact helper path still match. It leaves servers started elsewhere alone. The original unsaved room history ends when its server stops.

Startup output and errors are in `logs/local/`. Never paste `.env.local` into a bug report. If startup fails, the launcher displays a log location; if dependencies are missing, run `npm ci` in the project folder before retrying. No research model is downloaded by the launcher.

## Verification limits on 10 October 2026

The earlier demo processes were absent and their temporary logs empty. That establishes that the servers had stopped, but does not establish why. An automated hidden `Start-Process` trial was rejected before execution with the stated reason “blocked by policy.” The launcher uses ordinary supported Windows startup for the user to run directly; it does not try to bypass that rejection. Its lifetime across closing Codex or later user turns has not been verified here.

For development and this session's browser tests, use foreground tool-managed sessions instead:

```powershell
node --env-file-if-exists=.env.local scripts/local-service.mjs rooms
node scripts/local-service.mjs web
```

Keep those sessions running. A green HTTP health check proves the site is reachable at the time of the check, independently of whether the camera recognizes a word.

Microsoft documents normal Windows process startup and its platform/session limits in [Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process). This launcher does not promise persistence beyond Windows sign-out or restart.
