# Backslash extensions

The registry of [Backslash](https://github.com/backslash-app/backslash) extensions, and the first-party extensions
themselves.

```sh
backslash search            # browse the registry (or "Browse Extensions" in the launcher)
backslash install github    # install, after showing what it is allowed to do
backslash update            # update everything installed
```

## How the registry works

`registry/<id>.toml` is a small file per extension. It points to the extension's code **wherever it lives** (your own
repository), pinned to a commit, with a checksum of its files and the list of what it is allowed to do:

```toml
id = "github"
title = "GitHub"
description = "Pull requests with their checks and reviews, your issues, and repository search"
author = "Backslash"
icon = "bs-repo"
version = "1.1.0"
repository = "https://github.com/backslash-app/plugins"
path = "extensions/github"
commit = "a64f60074557298bf4cabf235c6e91e1f4e54082"
checksum = "sha256:37f89a1e…"
permissions = ["Access api.github.com", "Access avatars.githubusercontent.com", "Run gh"]
commands = ["Search GitHub Repositories", "My Pull Requests", "My GitHub Issues"]
```

Backslash installs exactly that commit and refuses anything whose files, version or permissions differ from the entry.
So:

- **You keep your code** in your repository; publishing a version is a one-file pull request.
- **Reviews are small and meaningful**: reviewers read the code at one commit and see the permissions it gets. Nothing
  can change after the review.
- **Users see the permissions before installing**, and are asked again when an update wants more. The sandbox (Deno)
  enforces them.

## Publishing an extension

1. Write it (see the [extension guide](https://github.com/backslash-app/backslash/blob/main/docs/EXTENSIONS.md)), commit
   and push it to a public git repository.
2. Run `backslash publish path/to/extension`. It prints the registry entry for your last commit.
3. Open a pull request adding that file as `registry/<id>.toml`.
4. To release a new version: bump `version` in `backslash.toml`, commit, push, run `backslash publish` again, and open a
   pull request updating the file.

CI checks every entry: it clones your repository at the commit, recomputes the checksum and compares the manifest and
permissions (`deno run -A scripts/validate.ts`).

Anyone can also install straight from a repository, without the registry:
`backslash install https://github.com/you/your-extension` (users are told it is not reviewed).

### Review guidelines

- The extension does what its title and description say, nothing else.
- Permissions are as narrow as possible: specific hosts, specific programs.
- No obfuscated or minified code, no downloading and running code at runtime.
- Secrets are `type = "secret"` preferences, never hardcoded.
- Destructive actions are marked `destructive` and ask for confirmation.

## First-party extensions

48 extensions, plus npm and System bundled with the launcher.

| Extension                                         | What it does                                                                                                                                                      | Permissions                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [AI](extensions/ai)                               | Ask questions, fix, rewrite, summarize, translate and explain text, with Claude, OpenAI, Mistral, Groq, OpenRouter or a local Ollama                              | `api.anthropic.com`, `api.openai.com`…                                                              |
| [Browser](extensions/browser)                     | History, bookmarks and open tabs of Firefox, Chrome, Brave, Chromium, Edge and Vivaldi                                                                            | reads ~/.mozilla/firefox, ~/snap/firefox/common/.mozilla/firefox…                                   |
| [Caffeine](extensions/caffeine)                   | Keep the computer awake for a while, or until you turn it off, even with Backslash closed                                                                         | runs `systemd-run`, `systemctl`, `systemd-inhibit`                                                  |
| [Calendar](extensions/calendar)                   | Your upcoming events from Google, Outlook, iCloud, Fastmail or Proton calendars, with one-key meeting joins                                                       | `calendar.google.com`, `outlook.office365.com`…                                                     |
| [Code Projects](extensions/projects)              | Recent projects of VS Code, VSCodium, Cursor, Zed and JetBrains IDEs, plus your git folders                                                                       | runs `git`, `code`, `code-oss`…; reads ~/.config/Code, ~/.config/Code - OSS…                        |
| [Color Picker](extensions/color-picker)           | Pick a color anywhere on the screen, keep a history, and convert colors between HEX, RGB, HSL and OKLCH                                                           | runs `systemd-run`, `hyprpicker`, `grim`…; reads ~/.cache/backslash/color-picker, /etc/os-release   |
| [Containers & VMs](extensions/distrobox)          | Enter distrobox and toolbx containers, and start, stop or open your libvirt virtual machines                                                                      | runs `distrobox`, `toolbox`, `podman`…                                                              |
| [Containers](extensions/docker)                   | Docker and Podman containers: start, stop, logs                                                                                                                   | runs `docker`, `podman`                                                                             |
| [Deployments](extensions/deployments)             | Recent Vercel deployments and Netlify deploys with their status, commit, branch and build time; open, copy, redeploy, cancel, build logs                          | `api.vercel.com`, `api.netlify.com`…                                                                |
| [Desktop Settings](extensions/desktop-settings)   | Search every settings panel of GNOME, KDE Plasma, Xfce or Cinnamon in English or French, and flip quick toggles                                                   | runs `gsettings`, `kreadconfig6`, `kreadconfig5`…; reads /usr/bin, /usr/local/bin…                  |
| [Dev Utils](extensions/dev-utils)                 | Encode, decode, hash, convert and generate developer values right from the search bar                                                                             | none                                                                                                |
| [Dictionary](extensions/dictionary)               | Definitions, examples, pronunciation and synonyms in English and French from Wiktionary, and quick translations                                                   | `en.wiktionary.org`, `fr.wiktionary.org`…                                                           |
| [Display](extensions/display)                     | Screen brightness with presets, night light, and your monitors' resolution, refresh rate and scale                                                                | runs `brightnessctl`, `udevadm`, `busctl`…; reads /etc/os-release                                   |
| [Docs](extensions/docs)                           | Search developer documentation: DevDocs, tldr pages, the Arch Wiki and your man pages                                                                             | `devdocs.io`, `documents.devdocs.io`…; runs `man`, `apropos`, `kitty`…                              |
| [Drives](extensions/drives)                       | Mount, open, unmount and safely eject USB sticks, SD cards and internal drives                                                                                    | runs `lsblk`, `udisksctl`                                                                           |
| [Emoji & Symbols](extensions/emoji)               | Search emoji and symbols by name and copy them                                                                                                                    | none                                                                                                |
| [Games](extensions/games)                         | Launch your installed Steam, Lutris and Heroic (Epic, GOG, Amazon) games, with cover art, play time, size and ProtonDB ratings                                    | `www.protondb.com`, `shared.steamstatic.com`…; runs `lutris`; reads ~/.local/share/Steam, ~/.steam… |
| [GitHub](extensions/github)                       | Pull requests with their checks and reviews, your issues, and repository search                                                                                   | `api.github.com`, `avatars.githubusercontent.com`; runs `gh`                                        |
| [GitLab](extensions/gitlab)                       | Merge requests with pipelines and approvals, your issues, projects and pipelines on gitlab.com (self-hosted instances are not supported)                          | `gitlab.com`, `secure.gravatar.com`                                                                 |
| [Hacker News & RSS](extensions/hacker-news)       | Top, new, best, Ask and Show HN stories with their comments, and your RSS and Atom feeds with unread tracking                                                     | any website                                                                                         |
| [Home Assistant](extensions/home-assistant)       | Lights, switches, covers, climate, media players, scenes, scripts and sensors of your Home Assistant: toggle, dim, set the temperature, run scenes                | `localhost`, `127.0.0.1`…                                                                           |
| [Jira](extensions/jira)                           | Your Jira Cloud issues by status with priority, sprint and labels; change status, assign, search with text or JQL, create issues                                  | `*.atlassian.net`, `secure.gravatar.com`…                                                           |
| [Kubernetes](extensions/kubernetes)               | Browse pods with their status, logs and restarts, and switch kubectl contexts and namespaces                                                                      | runs `kubectl`, `kitty`, `alacritty`…                                                               |
| [Linear](extensions/linear)                       | Your issues with their status, priority, labels and assignee; search, triage and quick issue creation                                                             | `api.linear.app`, `public.linear.app`                                                               |
| [Media Controls](extensions/media)                | Control Spotify, browsers, VLC, mpv and any MPRIS player                                                                                                          | `i.scdn.co`; runs `busctl`; reads /tmp/backslash-media                                              |
| [Network & Devices](extensions/network)           | Wi-Fi, Bluetooth, audio outputs and VPNs in two keystrokes                                                                                                        | runs `nmcli`, `bluetoothctl`, `pactl`…                                                              |
| [Notifications](extensions/notifications)         | Do Not Disturb and the notification history for mako, Dunst, SwayNotificationCenter, GNOME, Plasma, Xfce and Cinnamon                                             | runs `gdbus`, `makoctl`, `dunstctl`…                                                                |
| [Notion](extensions/notion)                       | Search the pages and databases shared with your integration, read them, add text to a page, create pages in a database                                            | `api.notion.com`                                                                                    |
| [Obsidian](extensions/obsidian)                   | Search your Obsidian notes by title, tag and text, preview them, open today's daily note and capture ideas                                                        | reads ~                                                                                             |
| [Packages](extensions/packages)                   | Search your distribution's packages and Flathub                                                                                                                   | runs `apt-cache`, `dnf`, `pacman`…                                                                  |
| [Passwords](extensions/passwords)                 | Copy passwords, usernames and one-time codes from pass, Bitwarden, 1Password and KeePassXC                                                                        | runs `pass`, `bw`, `op`…; reads ~/.password-store                                                   |
| [Ports](extensions/ports)                         | What listens on :3000? Dev servers and services by port, with their process and project                                                                           | runs `ss`, `ps`, `readlink`…                                                                        |
| [Power](extensions/power)                         | Switch power profiles and check your battery's charge, health, cycles and time left                                                                               | runs `powerprofilesctl`, `tuned-adm`, `udevadm`…                                                    |
| [Quick Notes](extensions/quick-notes)             | Jot, find, pin and paste notes kept as plain markdown files, ready for Obsidian, your editor or sync                                                              | reads ~/Documents                                                                                   |
| [Screenshot & Recording](extensions/screenshot)   | Capture an area, a window or the whole screen, record the screen, and find your recent captures                                                                   | runs `systemd-run`, `systemctl`, `grim`…; reads ~/Pictures, ~/Images…                               |
| [Sentry](extensions/sentry)                       | Unresolved issues across your projects with events, users and assignee; resolve, ignore, assign; latest event with its stack trace (sentry.io, US and EU regions) | `sentry.io`, `us.sentry.io`…                                                                        |
| [Services](extensions/systemd)                    | Start, stop and inspect systemd services                                                                                                                          | runs `systemctl`, `journalctl`                                                                      |
| [Spotify](extensions/spotify)                     | Search Spotify, play on any of your devices, queue songs, browse your playlists and save what's playing to your library                                           | `api.spotify.com`, `accounts.spotify.com`…                                                          |
| [SSH Hosts](extensions/ssh)                       | Connect to the hosts of your SSH config and known_hosts in a terminal or the file manager                                                                         | runs `kitty`, `alacritty`, `wezterm`…; reads ~/.ssh                                                 |
| [System Monitor](extensions/system-monitor)       | Live CPU, memory, disk, network, GPU and battery usage, and the processes behind it                                                                               | runs `grep`, `ps`, `df`…; reads /etc/os-release                                                     |
| [System Updates](extensions/updates)              | Available updates from APT, DNF, Pacman, Zypper, Flatpak, Snap and firmware, applied in a terminal                                                                | runs `apt`, `dnf`, `rpm`…; reads /etc/os-release                                                    |
| [Terminal Sessions](extensions/terminal-sessions) | Attach to, create, rename and kill your tmux and zellij sessions                                                                                                  | runs `tmux`, `zellij`, `kitty`…                                                                     |
| [Text from Screen](extensions/ocr)                | Select any part of the screen and copy the text in it, recognized offline with Tesseract                                                                          | runs `systemd-run`, `tesseract`, `grim`…; reads ~/.cache/backslash/ocr, /etc/os-release             |
| [Timers](extensions/timers)                       | Timers and Pomodoro that ring even when Backslash is closed (systemd timers)                                                                                      | runs `systemd-run`, `systemctl`                                                                     |
| [Todoist](extensions/todoist)                     | Today's tasks, search and quick add in natural language                                                                                                           | `api.todoist.com`                                                                                   |
| [Weather](extensions/weather)                     | Current conditions, the next 24 hours and the week ahead for any city, from Open-Meteo                                                                            | `geocoding-api.open-meteo.com`, `api.open-meteo.com`                                                |
| [Web Search](extensions/web-search)               | Search the web with live suggestions, 50 !bangs and your recent searches, on the engine you prefer                                                                | `duckduckgo.com`, `suggestqueries.google.com`                                                       |
| [World Clock](extensions/world-clock)             | The time in your cities, offsets, day and night, and time conversions like “3pm NY in Paris”                                                                      | none                                                                                                |

Their registry entries are regenerated with `scripts/update-entries.sh` after a change is merged.

Extension icons can be emoji, theme icon names, or Backslash's own glyphs (`bs-repo`, `bs-sparkle`…, see `Icons` in the
SDK), which look the same on every desktop.

## Developing here

```sh
git clone https://github.com/backslash-app/backslash .backslash   # for the SDK types
deno check extensions/*/commands/*.ts
deno test --allow-read --allow-write --allow-env --allow-run extensions   # what CI runs
backslash dev extensions/github     # live reload in the launcher
```
