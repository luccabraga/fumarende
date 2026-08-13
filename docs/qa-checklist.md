# fumarende — QA checklist

## Foundation

- [ ] `curl http://localhost:4173/api/health` returns `{"ok":true}` after
      `./scripts/install-launchd.sh`.
- [ ] From another device on the same Wi-Fi, `http://<mac-hostname>.local:4173`
      loads the login/setup screen in a browser.
- [ ] First visit shows the password **setup** form, not login.
- [ ] After setup, reloading the page stays logged in (session cookie
      persists).
- [ ] Logging out and reloading shows the login form (not setup).
- [ ] Entering the wrong password shows an error and does not log in.
- [ ] Adding a Receitas entry appears in the list immediately without a
      manual refresh.
- [ ] Killing the server process (`kill -9 <PID>` from
      `launchctl list | grep com.lucca.fumarende`) results in it being
      relaunched automatically within a few seconds (`KeepAlive`).
- [ ] Rebooting the machine brings the server back up without any manual
      step (`RunAtLoad`).
