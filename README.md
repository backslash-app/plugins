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

| Extension                               | Commands                                                                                                     | Permissions                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [AI](extensions/ai)                     | Ask AI with saved conversations; fix, improve, summarize, translate, explain copied text                     | Claude, OpenAI, Mistral, Groq, OpenRouter, Ollama |
| [Browser](extensions/browser)           | History and bookmarks of Firefox, Chrome, Brave, Chromium, Edge, Vivaldi; Firefox tabs                       | reads the browsers' profiles                      |
| [Code Projects](extensions/projects)    | Recent projects of VS Code, Cursor, Zed, JetBrains and git folders, with language and git status; open with… | reads editor history, runs editors and terminals  |
| [Containers](extensions/docker)         | Docker/Podman grouped by Compose project: start, stop, logs, remove                                          | `docker`, `podman`                                |
| [Emoji & Symbols](extensions/emoji)     | Search and copy, recently used first                                                                         | none                                              |
| [GitHub](extensions/github)             | Pull requests with checks and reviews, issues, repositories                                                  | `api.github.com`, avatars, `gh` for the token     |
| [Linear](extensions/linear)             | My issues by status with labels, cycle and sub-issues; change status, priority, assignee; search, create     | `api.linear.app`                                  |
| [Media Controls](extensions/media)      | Now playing with cover and progress, play/pause, next, volume, shuffle, repeat of any MPRIS player           | `busctl`, covers                                  |
| [Network & Devices](extensions/network) | Wi-Fi, Bluetooth (with battery), audio outputs, VPN and Tailscale                                            | `nmcli`, `bluetoothctl`, `pactl`, `tailscale`     |
| [Packages](extensions/packages)         | Search apt/dnf/pacman/zypper and Flathub                                                                     | runs the package tools (search only)              |
| [Ports](extensions/ports)               | What listens on each port, with its process and project; stop it                                             | `ss`, `ps`, `readlink`, `kill`                    |
| [Services](extensions/systemd)          | systemd services, running or failed: start, stop, restart, logs                                              | `systemctl`, `journalctl`                         |
| [Timers](extensions/timers)             | Timers and Pomodoro that ring even with Backslash closed                                                     | `systemd-run`, `systemctl`                        |
| [Todoist](extensions/todoist)           | Today, next 7 days, no date; complete, reschedule, prioritize; search, quick add                             | `api.todoist.com`                                 |

Their registry entries are regenerated with `scripts/update-entries.sh` after a change is merged.

Extension icons can be emoji, theme icon names, or Backslash's own glyphs (`bs-repo`, `bs-sparkle`…, see `Icons` in the
SDK), which look the same on every desktop.

## Developing here

```sh
git clone https://github.com/backslash-app/backslash .backslash   # for the SDK types
deno check extensions/*/commands/*.ts
deno test extensions                # parsers of each extension (lib_test.ts)
backslash dev extensions/github     # live reload in the launcher
```
