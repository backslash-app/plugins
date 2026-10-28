<p align="center"><img src="https://raw.githubusercontent.com/backslash-app/backslash/main/docs/media/logo.svg" width="96" alt="Backslash logo"/></p>

<h1 align="center">Backslash extensions</h1>

<p align="center">The extensions of <a href="https://github.com/backslash-app/backslash">Backslash</a>, the launcher for Linux,<br/>
and everything you need to write your own: an afternoon is plenty.</p>

<p align="center">
  <a href="#build-your-first-extension"><b>Build an extension</b></a> ·
  <a href="#cheat-sheet">Cheat sheet</a> ·
  <a href="#publish-it">Publish</a> ·
  <a href="#first-party-extensions">All extensions</a> ·
  <a href="https://github.com/backslash-app/backslash/blob/main/docs/EXTENSIONS.md">Full guide</a>
</p>

---

## Use them

Open **Browse Extensions** in Backslash, or from a terminal:

```sh
backslash search            # browse the registry
backslash install github    # install, after showing what it is allowed to do
backslash update            # update everything installed
```

## Build your first extension

An extension is a folder: a `backslash.toml` manifest and one TypeScript file per command. No build step, no
`node_modules`, no bundler. The launcher draws the interface (search, keyboard navigation, preview panel, action panel,
loading and errors), so your code only says **what** to show.

We'll build **Release Radar**: the latest release of the GitHub repositories you follow, with the release notes in the
preview panel. It covers what most extensions need: a web API, a list with details and actions, preferences, a secret,
permissions and tests. The finished code is in [`examples/release-radar`](examples/release-radar).

### 1. Create it

You need [Backslash](https://github.com/backslash-app/backslash#install) and [Deno](https://deno.com)
(`backslash install-runtime` downloads it if you don't have it).

```sh
backslash new release-radar     # a working extension with one command
cd release-radar
backslash dev                   # opens the launcher with it loaded, logs in this terminal, reloads on save
```

```
release-radar/
├── backslash.toml        what it is and what it may do
├── commands/
│   └── hello.ts          one file per command
└── deno.json             editor support only (types for @backslash/api)
```

### 2. Describe it: `backslash.toml`

```toml
[extension]
id = "release-radar"                # [a-z0-9-]+, unique in the registry
title = "Release Radar"
description = "The latest release of the GitHub repositories you follow"
version = "0.1.0"
author = "you"
icon = "bs-tag"                     # a Backslash glyph, a theme icon name or an emoji
license = "MIT"

# Everything not listed is denied, and the sandbox enforces it.
# Users read these lines before the first run.
[permissions]
net = ["api.github.com", "avatars.githubusercontent.com"]

[[commands]]
name = "releases"                   # → commands/releases.ts
title = "Latest Releases"           # what users type to find it
description = "The newest release of each repository you follow"
icon = "bs-tag"
keywords = ["github", "release", "version", "changelog"]

[[preferences]]                     # Settings → Extensions → Configure
name = "repos"
title = "Repositories"
description = "owner/name, separated by commas: denoland/deno, rust-lang/rust"
required = true                     # asked before the first run

[[preferences]]
name = "token"
title = "GitHub token"
description = "Optional: raises the rate limit from 60 to 5,000 requests an hour"
type = "secret"                     # stored in the system keyring, never in a file
```

Rename `commands/hello.ts` to `commands/releases.ts`.

### 3. Keep the logic in `lib.ts`

Put what you can in plain functions, away from the launcher: they are easy to read, review and test.

```ts
// lib.ts
export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  body: string | null;
  author: { login: string; avatar_url: string };
}

/** "denoland/deno, rust-lang/rust" → ["denoland/deno", "rust-lang/rust"], ignoring anything else. */
export function parseRepos(text: string): string[] {
  const repos = text.split(/[\s,]+/).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
  return [...new Set(repos)];
}

/** A short age for the list: "today", "3d", "2mo", "1y". */
export function age(date: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
```

### 4. Write the command

A command default-exports a view. Here, a `list` whose items are loaded once; the launcher filters them as you type.

```ts
// commands/releases.ts
import { copy, Icons, list, meta, open } from "@backslash/api";
import { age, parseRepos, type Release } from "../lib.ts";

export default list({
  placeholder: "Filter releases…",
  empty: { title: "No releases yet", description: "Add repositories in Settings → Extensions", icon: Icons.tag },
  status: (items) => `${items.length} repositories`, // the footer line
  async items({ preferences, signal }) {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (preferences.token) headers.Authorization = `Bearer ${preferences.token}`;

    const found = await Promise.all(
      parseRepos(String(preferences.repos)).map(async (repo) => {
        // `signal` is aborted when the user leaves: slow requests are cancelled for free.
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers, signal });
        return res.ok ? { repo, release: (await res.json()) as Release } : null;
      }),
    );

    return found
      .filter((f) => f !== null)
      .sort((a, b) => b.release.published_at.localeCompare(a.release.published_at))
      .map(({ repo, release }) => ({
        id: repo, // keeps the selection when the list refreshes
        title: repo,
        subtitle: release.name ?? release.tag_name,
        icon: { source: Icons.tag, tint: "purple" },
        tags: [release.tag_name],
        accessories: [{ text: age(release.published_at) }],
        detail: {
          // the preview panel on the right
          markdown: release.body ?? "_No release notes._",
          metadata: [
            meta.text("Version", release.tag_name, { icon: Icons.tag }),
            meta.text("Published", new Date(release.published_at).toLocaleDateString()),
            meta.person("Author", release.author.login, release.author.avatar_url),
          ],
        },
        actions: [
          // first = Enter, second = Ctrl+Enter, all of them in Ctrl+K
          open(release.html_url, "Open Release"),
          copy(release.tag_name, "Copy Version"),
          open(`https://github.com/${repo}`, "Open Repository", { shortcut: "<Ctrl>o" }),
        ],
      }));
  },
});
```

That's the whole command. Throwing an error anywhere shows it in the launcher.

### 5. Try it

```sh
backslash dev                                   # in the launcher, with logs; save a file to reload
backslash run release-radar/releases --json     # or straight from a terminal, to see exactly what you return
```

`console.log` goes to the `backslash dev` output. Set your preferences in **Settings → Extensions → Release Radar** (the
form also opens by itself the first time, because `repos` is required).

### 6. Test it

```ts
// lib_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { age, parseRepos } from "./lib.ts";

Deno.test("repositories: commas, spaces, duplicates and junk", () => {
  assertEquals(parseRepos("denoland/deno, rust-lang/rust\nnot a repo, denoland/deno"), [
    "denoland/deno",
    "rust-lang/rust",
  ]);
});

Deno.test("age of a release", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age("2026-10-25T12:00:00Z", now), "3d");
  assertEquals(age("2024-10-01T12:00:00Z", now), "2y");
});
```

```sh
deno test          # and deno check commands/*.ts, deno fmt, deno lint
```

### 7. Share it

Push the folder to a public git repository. Anyone can install it right away with
`backslash install https://github.com/you/release-radar` (they are told it isn't reviewed), and you can
[list it in the registry](#publish-it) so it shows up in **Browse Extensions**.

## Cheat sheet

Everything below comes from `@backslash/api`. The
[full guide](https://github.com/backslash-app/backslash/blob/main/docs/EXTENSIONS.md) has the details.

| I want to…                             | Use                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Show a list filtered by the launcher   | `list({ items })`: an array, an async function, or an async generator that yields as results arrive                                       |
| Search as the user types (web APIs)    | `list({ search(query, { signal }) })`: debounced, the previous call is aborted                                                            |
| Show tiles (emoji, images, colors)     | `list({ layout: "grid", columns: 8, items })`                                                                                             |
| Offer views of the same data           | `filter: { options: ["Assigned", "Created"] }`, read `ctx.filter`; Tab cycles them                                                        |
| Show a page of text                    | `detail({ markdown, metadata })`; `markdown` can be an async generator to stream an answer                                                |
| Ask for input                          | `form({ fields: [field.text(…), field.dropdown(…)], submit(values) })`                                                                    |
| Run something without a window         | `mode = "no-view"` in the manifest and `run(async (ctx) => "Done")`                                                                       |
| Take an argument (`Add Task buy milk`) | `[[commands.arguments]]` in the manifest, read `ctx.args`                                                                                 |
| Open, copy or paste                    | `open(url)`, `copy(text)`, `paste(text)` actions                                                                                          |
| Run your own code on Enter             | `action("Archive", async () => refresh())`; return a view to navigate, or `close()`, `pop()`, `refresh()`, `replace(view)`                |
| Group actions or nest them             | `{ section: "Copy" }` on an action, `submenu("Move to", [...])`                                                                           |
| Guard a dangerous action               | `{ destructive: true, confirm: "Delete the branch?" }`                                                                                    |
| Settings and API keys                  | `[[preferences]]`, `type = "secret"` for tokens, read `ctx.preferences`                                                                   |
| Sign in with OAuth                     | `oauth.token(provider)`: PKCE, browser, refresh and keyring are handled                                                                   |
| Remember something                     | `storage.get(key)` / `storage.set(key, value)`: private JSON store, no permission needed                                                  |
| Run a program                          | `exec("git", ["status"])`, with the program in `[permissions] run`                                                                        |
| Tell the user                          | `toast("Saved", { style: "success" })`                                                                                                    |
| Show a live count in the root search   | `updateCommandMetadata({ subtitle: "3 in progress" })`                                                                                    |
| Rich rows                              | `subtitle`, `tags`, `accessories` (text, pills, avatars), `section`, `keywords`                                                           |
| Rich previews                          | `detail.stats`, `detail.markdown`, `detail.metadata` with `meta.text/tags/person/link/progress`                                           |
| Crisp icons                            | `Icons.pullRequest`, `Icons.inProgress`…, optionally `{ source, tint: "green" }`                                                          |
| Use a library                          | `import { format } from "npm:date-fns@4"` or `jsr:` imports, or map them in `deno.json`                                                   |
| Write it in another language           | `[runtime] kind = "exec"` and speak the [protocol](https://github.com/backslash-app/backslash/blob/main/docs/PROTOCOL.md) (not sandboxed) |

## What makes a good extension

- **One job, done well.** A title users would type, a description that says what they get, `keywords` for the words they
  might use instead (other languages too).
- **Fast first paint.** Pass `signal` to `fetch`, load in parallel, yield partial results from an async generator when a
  source is slow, and cache in `storage` when the data barely changes.
- **Useful at a glance.** Put the state users came for in the row (status, counts, age) and the rest in the preview
  panel. Prefer `Icons` glyphs to emoji and theme icons: they look the same on every desktop.
- **Good empty and error states.** An `empty` message that says what to do next; errors thrown with a sentence a user
  understands ("GitHub refused the token: check it in Settings").
- **The narrowest permissions.** Specific hosts and programs, never `["*"]` when a list will do. Tokens are
  `type = "secret"` preferences, never in code or `storage`.
- **Keyboard first.** The action users want most is first (Enter), the second one is Ctrl+Enter, and frequent ones get a
  `shortcut`.
- **Tested.** Parsing and formatting live in `lib.ts` with a `lib_test.ts` next to it.

## Publish it

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

To publish:

1. Commit and push your extension to a public git repository (it can be one of several in the same repository).
2. Run `backslash publish path/to/extension`. It prints the registry entry for your last commit.
3. Open a pull request here adding that file as `registry/<id>.toml`.
4. For a new version: bump `version` in `backslash.toml`, commit, push, run `backslash publish` again and open a pull
   request updating the file.

CI checks every entry: it clones your repository at the commit, recomputes the checksum and compares the manifest and
permissions (`deno run -A scripts/validate.ts`). Backslash then installs exactly that commit and refuses anything whose
files, version or permissions differ. So:

- **You keep your code** in your repository; publishing a version is a one-file pull request.
- **Reviews are small and meaningful**: reviewers read the code at one commit and see the permissions it gets. Nothing
  can change after the review.
- **Users see the permissions before installing**, and are asked again when an update wants more. The sandbox (Deno)
  enforces them.

### Review guidelines

- The extension does what its title and description say, nothing else.
- Permissions are as narrow as possible: specific hosts, specific programs.
- No obfuscated or minified code, no downloading and running code at runtime.
- Secrets are `type = "secret"` preferences, never hardcoded.
- Destructive actions are marked `destructive` and ask for confirmation.

## Contributing to this repository

The first-party extensions live in [`extensions/`](extensions); each is a good example to start from. They follow the
same layout as the tutorial: `backslash.toml`, `commands/`, the logic in `lib.ts` (and `api.ts` for a web API) with
`lib_test.ts` next to it.

```sh
git clone https://github.com/backslash-app/plugins && cd plugins
git clone https://github.com/backslash-app/backslash .backslash   # the SDK types for @backslash/api
deno check extensions/*/commands/*.ts
deno test --allow-read --allow-write --allow-env --allow-run extensions examples   # what CI runs
deno fmt && deno lint
backslash dev extensions/github     # live reload in the launcher
```

Their registry entries are regenerated with `scripts/update-entries.sh` after a change is merged. Extension icons can be
emoji, theme icon names, or Backslash's own glyphs (`bs-repo`, `bs-sparkle`…, see `Icons` in the SDK), which look the
same on every desktop.

Ideas for new extensions and bug reports are welcome in the [issues](https://github.com/backslash-app/plugins/issues).

## First-party extensions

Every extension we maintain, plus npm and System that come with the launcher. More are added all the time.

| Extension                                               | What it does                                                                                                                                                              | Permissions                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AI](extensions/ai)                                     | Ask questions, fix, rewrite, summarize, translate and explain text, with Claude, OpenAI, Mistral, Groq, OpenRouter or a local Ollama                                      | `api.anthropic.com`, `api.openai.com`…                                                                                                                |
| [Android Devices](extensions/android)                   | Your Android phones over USB or Wi-Fi with model, version and battery: mirror the screen with scrcpy, take screenshots, install APKs and manage apps                      | runs `adb`, `scrcpy`, `systemd-run`…; reads ~/Downloads, ~/Pictures…                                                                                  |
| [Anki](extensions/anki)                                 | Your Anki decks with today's new, learning and review counts, quick card creation and sync, through AnkiConnect                                                           | `127.0.0.1:8765`; runs `systemd-run`; reads /etc/os-release, /usr/bin/anki…                                                                           |
| [Ansible](extensions/ansible)                           | Your Ansible projects with their playbooks, plays, inventories, groups and hosts; run, check with diff or limit a playbook, SSH and ping hosts in your terminal           | runs `ansible-inventory`, `ansible-playbook`, `find`…; reads /etc/os-release, /etc/ansible…                                                           |
| [AppImages](extensions/appimages)                       | The AppImages in your folders with their version and size; run them, add them to the app menu, move or trash them                                                         | runs `systemd-run`, `chmod`, `mv`…; reads ~, /opt                                                                                                     |
| [Argo CD](extensions/argocd)                            | Argo CD applications with their sync status and health, out of sync and degraded first; sync, hard refresh, roll back and open them                                       | any host                                                                                                                                              |
| [Asana](extensions/asana)                               | Your Asana tasks by due date and your projects; complete, reschedule and create tasks                                                                                     | `app.asana.com`                                                                                                                                       |
| [Audio](extensions/audio)                               | Microphones, the volume of each application playing or recording, and EasyEffects presets on PipeWire or PulseAudio                                                       | runs `pactl`, `wpctl`, `easyeffects`…; reads ~/.config/easyeffects, ~/.local/share/easyeffects…                                                       |
| [Authenticator](extensions/authenticator)               | Two-factor (TOTP) codes for your accounts, with secrets kept in the system keyring                                                                                        | runs `secret-tool`, `zbarimg`…; reads the clipboard                                                                                                   |
| [AWS](extensions/aws)                                   | Switch AWS profiles, start and stop EC2 instances, open SSM sessions, browse S3 buckets and tail CloudWatch logs with the aws CLI                                         | runs `aws`, `kitty`, `alacritty`…; reads ~/.aws/config, ~/.aws/credentials…                                                                           |
| [Azure](extensions/azure)                               | Switch Azure subscriptions, start, stop and SSH into virtual machines, and restart or tail the logs of App Service web apps with the az CLI                               | runs `az`, `kitty`, `alacritty`…; reads /etc/os-release                                                                                               |
| [Backups](extensions/backups)                           | restic, Borg and Déjà Dup backups at a glance: how old the last one is, snapshots with hosts and paths, back up now or browse files                                       | runs `restic`, `borg`, `systemd-run`…; reads ~/.cache/backslash-backups, /proc/mounts                                                                 |
| [Bitbucket](extensions/bitbucket)                       | Bitbucket Cloud pull requests to review or opened by you, with builds and approvals, your issues and repository search                                                    | `api.bitbucket.org`, `bitbucket.org`…                                                                                                                 |
| [Books](extensions/books)                               | Search Open Library for books with covers, authors, editions and subjects, copy ISBNs and citations, and keep a reading list                                              | `openlibrary.org`, `covers.openlibrary.org`                                                                                                           |
| [Browser](extensions/browser)                           | History, bookmarks and open tabs of Firefox, Chrome, Brave, Chromium, Edge and Vivaldi                                                                                    | reads ~/.mozilla/firefox, ~/snap/firefox/common/.mozilla/firefox…                                                                                     |
| [Caffeine](extensions/caffeine)                         | Keep the computer awake for a while, or until you turn it off, even with Backslash closed                                                                                 | runs `systemd-run`, `systemctl`, `systemd-inhibit`                                                                                                    |
| [Calendar](extensions/calendar)                         | Your upcoming events from Google, Outlook, iCloud, Fastmail or Proton calendars, with one-key meeting joins                                                               | `calendar.google.com`, `outlook.office365.com`…                                                                                                       |
| [Can I Use](extensions/can-i-use)                       | Browser support for web platform features from caniuse.com, with versions, partial support and notes                                                                      | `raw.githubusercontent.com`                                                                                                                           |
| [CI Pipelines](extensions/ci-runs)                      | Recent CircleCI, Buildkite, Woodpecker and Jenkins runs in one list, failing and running first, with branch, commit and duration; rerun or cancel them                    | any host                                                                                                                                              |
| [ClickUp](extensions/clickup)                           | Your ClickUp tasks across workspaces with their status, priority and due date; change status and create tasks                                                             | `api.clickup.com`, `attachments.clickup.com`                                                                                                          |
| [Cloud Servers](extensions/vps)                         | Your Hetzner Cloud, DigitalOcean, Linode and Scaleway servers in one list with status, IPs, region and price; SSH, power on, shut down and reboot                         | `api.hetzner.cloud`, `api.digitalocean.com`…; runs `kitty`, `alacritty`, `wezterm`…                                                                   |
| [Cloudflare](extensions/cloudflare)                     | Manage Cloudflare zones and DNS records, purge the cache and follow Pages deployments                                                                                     | `api.cloudflare.com`                                                                                                                                  |
| [Code Projects](extensions/projects)                    | Recent projects of VS Code, VSCodium, Cursor, Zed and JetBrains IDEs, plus your git folders                                                                               | runs `git`, `code`, `code-oss`…; reads ~/.config/Code, ~/.config/Code - OSS…                                                                          |
| [Code Search](extensions/code-search)                   | Search public code on GitHub with grep.app or Sourcegraph: matching lines with context, filters by language, repository and path                                          | `grep.app`, `sourcegraph.com`                                                                                                                         |
| [Codeberg](extensions/codeberg)                         | Your Codeberg pull requests with checks, issues, repositories and notifications                                                                                           | `codeberg.org`                                                                                                                                        |
| [Coding Agent Sessions](extensions/coding-agents)       | Your recent Claude Code, Codex and Aider sessions with their project, prompts and last answer, resumed in a terminal in one keystroke                                     | runs `kitty`, `alacritty`, `wezterm`…; reads ~/.claude/projects, ~/.codex/sessions…                                                                   |
| [Color Picker](extensions/color-picker)                 | Pick a color anywhere on the screen, keep a history, and convert colors between HEX, RGB, HSL and OKLCH                                                                   | runs `systemd-run`, `hyprpicker`, `grim`…; reads ~/.cache/backslash/color-picker, /etc/os-release                                                     |
| [Commit Helper](extensions/commit-helper)               | Write Conventional Commits messages with scopes learned from your history, gitmoji, and commit the staged changes                                                         | runs `git`, `find`                                                                                                                                    |
| [Contacts](extensions/contacts)                         | Your CardDAV or vCard contacts with emails, phones, addresses and upcoming birthdays: write, call, copy                                                                   | `www.googleapis.com`, `*.icloud.com`…; reads ~/Contacts, ~/.contacts…                                                                                 |
| [Container Registries](extensions/container-registries) | Search Docker Hub and Quay.io images and browse tags on Docker Hub, GHCR and Quay with sizes, digests and platforms                                                       | `hub.docker.com`, `ghcr.io`…                                                                                                                          |
| [Containers](extensions/docker)                         | Docker and Podman containers: start, stop, logs                                                                                                                           | runs `docker`, `podman`                                                                                                                               |
| [Containers & VMs](extensions/distrobox)                | Enter distrobox and toolbx containers, and start, stop or open your libvirt virtual machines                                                                              | runs `distrobox`, `toolbox`, `podman`…                                                                                                                |
| [Coolify](extensions/coolify)                           | Applications, services and databases of your Coolify and Dokploy instances with status, domains and last deployment; deploy, restart, stop, logs and deployment history   | any host                                                                                                                                              |
| [Countdowns](extensions/countdowns)                     | Count down to vacations, launches and birthdays, and pin the next one to the root search                                                                                  | none                                                                                                                                                  |
| [Cron Helper](extensions/cron)                          | Explain cron and systemd calendar expressions, see their next runs and convert between them                                                                               | none                                                                                                                                                  |
| [Crypto](extensions/crypto)                             | Cryptocurrency prices, 24 h and 7 day changes, market caps and a watchlist from CoinGecko, and the value of your holdings                                                 | `api.coingecko.com`, `coin-images.coingecko.com`…                                                                                                     |
| [Databases](extensions/databases)                       | Open your PostgreSQL, MySQL, SQLite and Redis connections in a terminal, check that they answer and copy their URLs                                                       | runs `psql`, `pgcli`, `pg_isready`…; reads ~/.pgpass, ~/.pg_service.conf…                                                                             |
| [Datadog](extensions/datadog)                           | Datadog monitors in alert first with mute and unmute, dashboard search and incidents with their severity and state, on every Datadog site                                 | `api.datadoghq.com`, `api.us3.datadoghq.com`…                                                                                                         |
| [DeepL & LanguageTool](extensions/writing)              | Translate text with DeepL and fix grammar and spelling with LanguageTool, from what you type, select or copy                                                              | `api-free.deepl.com`, `api.deepl.com`…; runs `wl-paste`, `xclip`…; reads the clipboard                                                                |
| [Default Apps](extensions/default-apps)                 | See and change your default browser, mail app, file manager, viewers, players, editor and terminal                                                                        | runs `xdg-mime`, `xdg-settings`; reads ~/.local/share/applications, ~/.local/share/flatpak/exports/share/applications…                                |
| [Dependency Updates](extensions/dependency-updates)     | Open Renovate and Dependabot pull requests across your GitHub repositories with package, versions, semver jump and checks; approve, squash-merge or ask for a rebase      | `api.github.com`; runs `gh`                                                                                                                           |
| [Deployments](extensions/deployments)                   | Recent Vercel deployments and Netlify deploys with their status, commit, branch and build time; open, copy, redeploy, cancel, build logs                                  | `api.vercel.com`, `api.netlify.com`…                                                                                                                  |
| [Desktop Settings](extensions/desktop-settings)         | Search every settings panel of GNOME, KDE Plasma, Xfce or Cinnamon in English or French, and flip quick toggles                                                           | runs `gsettings`, `kreadconfig6`, `kreadconfig5`…; reads /usr/bin, /usr/local/bin…                                                                    |
| [Dev Reference](extensions/dev-reference)               | HTTP status codes, MIME types, ports, ASCII, HTML entities, key codes, signals, exit codes and a chmod calculator                                                         | none                                                                                                                                                  |
| [Dev Utils](extensions/dev-utils)                       | Encode, decode, hash, convert and generate developer values right from the search bar                                                                                     | none                                                                                                                                                  |
| [Dictionary](extensions/dictionary)                     | Definitions, examples, pronunciation and synonyms in English and French from Wiktionary, and quick translations                                                           | `en.wiktionary.org`, `fr.wiktionary.org`…                                                                                                             |
| [Disk Usage](extensions/disk-usage)                     | Find what fills your disk: biggest folders and files, caches, trash, logs and containers, with cleanups                                                                   | runs `du`, `find`, `df`…; reads ~, /etc/os-release                                                                                                    |
| [Display](extensions/display)                           | Screen brightness with presets, night light, and your monitors' resolution, refresh rate and scale                                                                        | runs `brightnessctl`, `udevadm`, `busctl`…; reads /etc/os-release                                                                                     |
| [Docs](extensions/docs)                                 | Search developer documentation: DevDocs, tldr pages, the Arch Wiki and your man pages                                                                                     | `devdocs.io`, `documents.devdocs.io`…; runs `man`, `apropos`, `kitty`…                                                                                |
| [Dotfiles](extensions/dotfiles)                         | Your chezmoi, yadm, bare git or GNU Stow dotfiles: what changed, diffs, edit, apply or re-add, commit and push                                                            | runs `chezmoi`, `yadm`, `git`…; reads ~                                                                                                               |
| [Downloads](extensions/downloads)                       | Recent downloads with previews and where they came from; open, copy, move, rename or trash them                                                                           | runs `getfattr`, `gio`, `mv`…; reads ~                                                                                                                |
| [Drives](extensions/drives)                             | Mount, open, unmount and safely eject USB sticks, SD cards and internal drives                                                                                            | runs `lsblk`, `udisksctl`                                                                                                                             |
| [Emoji & Symbols](extensions/emoji)                     | Search emoji and symbols by name and copy them                                                                                                                            | none                                                                                                                                                  |
| [Env Files](extensions/dotenv)                          | The .env files of your projects with their variables masked, the keys missing from .env.example, and copy or export them                                                  | reads ~/Projects, ~/projects…                                                                                                                         |
| [Espanso](extensions/espanso)                           | Search your espanso matches with a preview of each expansion; paste them, fill in forms, add, edit and delete matches, start, toggle and restart espanso                  | runs `espanso`; reads ~/.config/espanso, ~/.local/share/espanso                                                                                       |
| [File Share](extensions/file-share)                     | Share copied files or text as a public 0x0.st link, an end-to-end encrypted PrivateBin paste, or a direct croc transfer, and keep track of what you shared                | `0x0.st`, `privatebin.net`…; runs `wl-paste`, `xclip`, `croc`…; reads ~, /media…; reads the clipboard                                                 |
| [Firewall](extensions/firewall)                         | State, default policies and rules of ufw or firewalld; allow or block a port, delete a rule, turn the firewall on or off                                                  | runs `firewall-cmd`, `pkexec`                                                                                                                         |
| [Flatpak Apps](extensions/flatpak)                      | Browse installed Flatpak apps and runtimes, see their size and permissions, run or uninstall them                                                                         | runs `flatpak`; reads /var/lib/flatpak/exports/share/icons/hicolor, ~/.local/share/flatpak/exports/share/icons/hicolor…                               |
| [Fly.io & Railway](extensions/paas)                     | Fly.io apps and Railway services with their status, latest deploy and URL; open, logs, restart and deploy history                                                         | `backboard.railway.com`; runs `flyctl`, `fly`                                                                                                         |
| [Fonts](extensions/fonts)                               | Browse installed font families with previews, copy their CSS and install new ones                                                                                         | runs `fc-list`, `fc-cache`, `pango-view`…; reads ~/.cache/backslash/fonts, ~/.local/share/fonts                                                       |
| [Games](extensions/games)                               | Launch your installed Steam, Lutris and Heroic (Epic, GOG, Amazon) games, with cover art, play time, size and ProtonDB ratings                                            | `www.protondb.com`, `shared.steamstatic.com`…; runs `lutris`; reads ~/.local/share/Steam, ~/.steam…                                                   |
| [Gists](extensions/gists)                               | Your GitHub gists with their code in the preview: copy, paste, create from the clipboard, delete                                                                          | `api.github.com`, `avatars.githubusercontent.com`…; runs `gh`; reads the clipboard                                                                    |
| [Git Repos](extensions/git-repos)                       | Your local git repositories with branch, changes, ahead/behind and last commit, plus fetch, pull and stash                                                                | runs `git`, `find`, `code`…; reads /etc/os-release                                                                                                    |
| [Gitea & Forgejo](extensions/gitea)                     | Pull requests to review, issues, repositories and notifications of your Gitea or Forgejo server, self-hosted or Codeberg-like                                             | any host, `codeberg.org`…                                                                                                                             |
| [GitHub](extensions/github)                             | Pull requests with their checks and reviews, your issues, and repository search                                                                                           | `api.github.com`, `avatars.githubusercontent.com`; runs `gh`                                                                                          |
| [GitHub Actions](extensions/github-actions)             | Workflow runs of your repositories, failing and running first, with jobs, steps and logs; re-run or cancel them                                                           | `api.github.com`, `avatars.githubusercontent.com`…; runs `gh`                                                                                         |
| [Gitignore Templates](extensions/gitignore)             | Browse github/gitignore templates, preview and combine them, and add them to a project's .gitignore without duplicate lines                                               | `api.github.com`, `raw.githubusercontent.com`; reads ~                                                                                                |
| [GitLab](extensions/gitlab)                             | Merge requests with pipelines and approvals, your issues, projects and pipelines on gitlab.com (self-hosted instances are not supported)                                  | `gitlab.com`, `secure.gravatar.com`                                                                                                                   |
| [GNOME Extensions](extensions/gnome-extensions)         | Enable, disable, configure or uninstall your GNOME Shell extensions, and install new ones from extensions.gnome.org                                                       | `extensions.gnome.org`; runs `gnome-extensions`, `gnome-shell`, `gsettings`…                                                                          |
| [Google Cloud](extensions/google-cloud)                 | Switch gcloud projects, SSH into Compute Engine VMs and follow Cloud Run services, their URLs and logs                                                                    | runs `gcloud`, `kitty`, `alacritty`…; reads /etc/os-release                                                                                           |
| [Google Drive & Tasks](extensions/google-workspace)     | Search Google Drive and manage Google Tasks with your own Google sign-in                                                                                                  | `www.googleapis.com`, `tasks.googleapis.com`…                                                                                                         |
| [Grafana](extensions/grafana)                           | Search Grafana dashboards and follow firing alerts; silence an alert for an hour or a day, expire silences                                                                | `*.grafana.net`, `localhost`…                                                                                                                         |
| [GraphQL Explorer](extensions/graphql)                  | Browse a GraphQL API's queries, mutations and types with their arguments, copy query skeletons and run queries with variables                                             | any host                                                                                                                                              |
| [Hacker News & RSS](extensions/hacker-news)             | Top, new, best, Ask and Show HN stories with their comments, and your RSS and Atom feeds with unread tracking                                                             | any website                                                                                                                                           |
| [Helm](extensions/helm)                                 | Helm releases across namespaces with their chart, status and revision; values, history, rollback and uninstall, in the current kubectl context                            | runs `helm`, `kubectl`                                                                                                                                |
| [Home Assistant](extensions/home-assistant)             | Lights, switches, covers, climate, media players, scenes, scripts and sensors of your Home Assistant: toggle, dim, set the temperature, run scenes                        | `localhost`, `127.0.0.1`…                                                                                                                             |
| [Hosts File](extensions/hosts-file)                     | Browse /etc/hosts, add, edit, enable, disable or remove entries and block domains, keeping its comments and layout                                                        | runs `pkexec`; reads /etc/hosts, /etc/hosts.backslash.bak                                                                                             |
| [HTTP Client](extensions/http-client)                   | Send HTTP requests from the launcher and read the status, timing, headers and formatted body                                                                              | any website                                                                                                                                           |
| [Hugging Face](extensions/hugging-face)                 | Search Hugging Face models, datasets and Spaces with downloads, likes, licenses and model cards                                                                           | `huggingface.co`                                                                                                                                      |
| [Icon Search](extensions/icon-search)                   | Search Lucide, Material Symbols, Tabler, Heroicons, Phosphor and Simple Icons, and copy them as SVG, JSX or data URI                                                      | `cdn.jsdelivr.net`                                                                                                                                    |
| [Image Tools](extensions/image-tools)                   | Resize, convert, compress, rotate and clean the metadata of pictures copied in your file manager                                                                          | runs `magick`, `convert`…; reads the clipboard                                                                                                        |
| [Immich](extensions/immich)                             | Search your Immich photos by what is in them, browse albums and today's memories; download originals and share links                                                      | `localhost`, `127.0.0.1`…; reads ~/.cache/backslash/immich, ~/Pictures                                                                                |
| [Internet Radio](extensions/radio)                      | Search 50,000 internet radio stations by name, genre or country and play them in the background with mpv, ffplay or VLC                                                   | `de1.api.radio-browser.info`, `de2.api.radio-browser.info`…; runs `systemd-run`, `systemctl`, `mpv`…; reads ~/.cache/backslash/radio, /etc/os-release |
| [Jellyfin & Plex](extensions/jellyfin)                  | Continue watching, next up, recently added and search on your Jellyfin and Plex servers, with posters; play in mpv or VLC, mark watched                                   | `localhost`, `127.0.0.1`…; runs `mpv`, `vlc`                                                                                                          |
| [Jira](extensions/jira)                                 | Your Jira Cloud issues by status with priority, sprint and labels; change status, assign, search with text or JQL, create issues                                          | `*.atlassian.net`, `secure.gravatar.com`…                                                                                                             |
| [Joplin](extensions/joplin)                             | Search your Joplin notes by notebook, preview them with their tags, create notes and copy links                                                                           | `127.0.0.1:41184`                                                                                                                                     |
| [JSON Explorer](extensions/json-explorer)               | Validate, browse and query the JSON in your clipboard, then copy values, paths or YAML, TOML and CSV                                                                      | reads the clipboard                                                                                                                                   |
| [KDE Connect](extensions/kde-connect)                   | Your phones through KDE Connect or GSConnect: battery, ring, send the clipboard, a file or an SMS, browse their files                                                     | runs `kdeconnect-cli`, `busctl`; reads the clipboard                                                                                                  |
| [Keyboard Layouts](extensions/keyboard-layouts)         | See the current keyboard layout and switch between layouts and input methods                                                                                              | runs `gsettings`, `gdbus`, `hyprctl`…; reads /usr/share/X11/xkb/rules/evdev.lst, /usr/share/X11/xkb/rules/base.lst…                                   |
| [Keyboard Shortcuts](extensions/keybindings)            | A searchable cheat sheet of your desktop's real keyboard shortcuts on GNOME, KDE Plasma, Hyprland, Sway, niri and i3                                                      | runs `gsettings`, `hyprctl`, `swaymsg`…; reads ~/.config/kglobalshortcutsrc, ~/.config/sway/config…                                                   |
| [Kubernetes](extensions/kubernetes)                     | Browse pods with their status, logs and restarts, and switch kubectl contexts and namespaces                                                                              | runs `kubectl`, `kitty`, `alacritty`…                                                                                                                 |
| [Licenses](extensions/licenses)                         | Open source licenses with their permissions, conditions and limitations; copy the text or add it to a project                                                             | `raw.githubusercontent.com`; runs `git`                                                                                                               |
| [Linear](extensions/linear)                             | Your issues with their status, priority, labels and assignee; search, triage and quick issue creation                                                                     | `api.linear.app`, `public.linear.app`                                                                                                                 |
| [Logseq](extensions/logseq)                             | Search your Logseq pages and blocks, preview them with properties and backlinks, open today's journal and capture blocks                                                  | reads ~                                                                                                                                               |
| [Mail](extensions/mail)                                 | Unread mail of up to three IMAP accounts (Gmail, Fastmail, iCloud, Yahoo, Proton Mail Bridge or any server): preview, mark read, archive, delete                          | any host                                                                                                                                              |
| [Matrix](extensions/matrix)                             | Your Matrix rooms and direct chats with unread counts and the last message; reply, send, mark as read, open in Element                                                    | any host                                                                                                                                              |
| [Media Controls](extensions/media)                      | Control Spotify, browsers, VLC, mpv and any MPRIS player                                                                                                                  | `i.scdn.co`; runs `busctl`; reads /tmp/backslash-media                                                                                                |
| [Message Queues](extensions/message-queues)             | RabbitMQ queues with ready and unacked messages, consumers and rates, NATS JetStream streams and Kafka or Redpanda topics; consumer lag, peek, purge and tail             | `localhost`, `127.0.0.1`…; runs `rpk`, `kitty`, `alacritty`…                                                                                          |
| [Microsoft 365](extensions/microsoft-365)               | Unread Outlook mail, Microsoft To Do tasks, OneDrive files and today's meetings through Microsoft Graph                                                                   | `graph.microsoft.com`, `login.microsoftonline.com`                                                                                                    |
| [Movies & TV](extensions/movies)                        | Search movies and TV shows on TMDB with posters, ratings, cast, trailers and where to stream them, and keep a watchlist                                                   | `api.themoviedb.org`, `image.tmdb.org`                                                                                                                |
| [MPD Music](extensions/mpd)                             | Control the Music Player Daemon: now playing with covers, queue, library search and playlists                                                                             | `localhost:6600`, `127.0.0.1:6600`; runs `systemctl`; reads ~/.cache/backslash/mpd, /etc/os-release                                                   |
| [Nerd Font Icons](extensions/nerd-fonts)                | Search every Nerd Font glyph by name or code point and copy the glyph, its class, code point or HTML entity                                                               | `raw.githubusercontent.com`                                                                                                                           |
| [Network & Devices](extensions/network)                 | Wi-Fi, Bluetooth, audio outputs and VPNs in two keystrokes                                                                                                                | runs `nmcli`, `bluetoothctl`, `pactl`…                                                                                                                |
| [Network Tools](extensions/network-tools)               | Public IP and location, local interfaces, DNS lookup, whois, ping and a speed test                                                                                        | `api.ipify.org`, `api6.ipify.org`…; runs `ip`, `ping`, `whois`…; reads /etc/os-release                                                                |
| [Nextcloud](extensions/nextcloud)                       | Search everything in your Nextcloud, browse files and share them, read and write notes, and follow your Deck cards                                                        | any host; reads ~/Downloads, ~/.cache/backslash/nextcloud                                                                                             |
| [NixOS Search](extensions/nix-search)                   | Search nixpkgs packages and NixOS, Home Manager and nix-darwin options from search.nixos.org                                                                              | `search.nixos.org`                                                                                                                                    |
| [Notifications](extensions/notifications)               | Do Not Disturb and the notification history for mako, Dunst, SwayNotificationCenter, GNOME, Plasma, Xfce and Cinnamon                                                     | runs `gdbus`, `makoctl`, `dunstctl`…                                                                                                                  |
| [Notion](extensions/notion)                             | Search the pages and databases shared with your integration, read them, add text to a page, create pages in a database                                                    | `api.notion.com`                                                                                                                                      |
| [ntfy](extensions/ntfy)                                 | Send push notifications to your phone with ntfy or Gotify, push the clipboard, and read the recent messages of your topics                                                | `ntfy.sh`, `localhost`…; reads the clipboard                                                                                                          |
| [Obsidian](extensions/obsidian)                         | Search your Obsidian notes by title, tag and text, preview them, open today's daily note and capture ideas                                                                | reads ~                                                                                                                                               |
| [Ollama Models](extensions/ollama)                      | See the local Ollama models and the ones loaded in memory, pull new ones with live progress and delete them                                                               | `127.0.0.1:11434`; runs `ollama`, `systemd-run`; reads /etc/os-release                                                                                |
| [OpenAPI](extensions/openapi)                           | Browse the endpoints of the OpenAPI and Swagger specs in your projects or at saved URLs, and copy curl commands and example bodies                                        | any host; reads ~/Projects, ~/projects…                                                                                                               |
| [Package Registries](extensions/package-registries)     | Search crates.io, PyPI, Go modules, RubyGems, Packagist, Maven Central, Hex, pub.dev and NuGet                                                                            | `crates.io`, `pypi.org`…                                                                                                                              |
| [Packages](extensions/packages)                         | Search your distribution's packages and Flathub                                                                                                                           | runs `apt-cache`, `dnf`, `pacman`…                                                                                                                    |
| [PagerDuty](extensions/pagerduty)                       | Open PagerDuty incidents with their urgency, service and assignees; acknowledge, resolve, reassign, add notes, and see who is on call                                     | `api.pagerduty.com`, `api.eu.pagerduty.com`…                                                                                                          |
| [Paperless-ngx](extensions/paperless)                   | Search your Paperless-ngx documents by their text with correspondents, types, tags and thumbnails; download, share, tag, and upload copied files                          | `localhost`, `127.0.0.1`…; runs `wl-paste`, `xclip`; reads ~, /media…; reads the clipboard                                                            |
| [Parcel Tracking](extensions/parcels)                   | Track Colissimo, Chronopost and La Poste letters with La Poste's API, and UPS, DHL, FedEx, Amazon and 2,000 more carriers with 17TRACK, with a timeline and change alerts | `api.laposte.fr`, `api.17track.net`; runs `notify-send`                                                                                               |
| [Passwords](extensions/passwords)                       | Copy passwords, usernames and one-time codes from pass, Bitwarden, 1Password and KeePassXC                                                                                | runs `pass`, `bw`, `op`…; reads ~/.password-store                                                                                                     |
| [PDF Tools](extensions/pdf-tools)                       | Merge, split, compress, rotate and unlock PDFs copied in your file manager, and turn pictures into PDFs                                                                   | runs `qpdf`, `gs`…; reads the clipboard                                                                                                               |
| [Peripherals](extensions/peripherals)                   | Battery level and state of your wireless mice, keyboards, headsets and gamepads, with headset sidetone and lights                                                         | runs `upower`, `solaar`, `headsetcontrol`                                                                                                             |
| [Pi-hole & AdGuard Home](extensions/pihole)             | Queries, blocked share and top blocked domains of your Pi-hole v6 or AdGuard Home; pause blocking, allow or block a domain                                                | `localhost`, `127.0.0.1`…                                                                                                                             |
| [Podcasts](extensions/podcasts)                         | Search Apple Podcasts, subscribe, and play new episodes in the background with mpv: pause, seek, resume where you stopped                                                 | any host; runs `systemctl`, `mpv`                                                                                                                     |
| [Ports](extensions/ports)                               | What listens on :3000? Dev servers and services by port, with their process and project                                                                                   | runs `ss`, `ps`, `readlink`…                                                                                                                          |
| [Power](extensions/power)                               | Switch power profiles and check your battery's charge, health, cycles and time left                                                                                       | runs `powerprofilesctl`, `tuned-adm`, `udevadm`…                                                                                                      |
| [Printers](extensions/printers)                         | See your printers and their queues, cancel jobs, pause printers and print files                                                                                           | runs `lpstat`, `lpq`, `lp`…; reads /etc/os-release                                                                                                    |
| [Privacy](extensions/privacy)                           | See which apps use your camera, microphone, screen and location, and stop them                                                                                            | runs `pw-dump`, `pactl`, `find`…                                                                                                                      |
| [Project Scripts](extensions/project-scripts)           | Scripts, Make targets, just recipes and tasks of your recent projects, run in a terminal                                                                                  | runs `just`, `task`…                                                                                                                                  |
| [Prompt Library](extensions/prompts)                    | Your own library of reusable AI prompts with {{variables}}, filled in a form and pasted into any app                                                                      | reads the clipboard                                                                                                                                   |
| [Proxmox](extensions/proxmox)                           | Nodes, virtual machines and containers of Proxmox VE with CPU, memory and uptime; start, shut down, reboot, consoles and snapshots                                        | `localhost`, `127.0.0.1`…                                                                                                                             |
| [Public Holidays](extensions/holidays)                  | Upcoming public holidays of your country with countdowns, French school holidays by zone, and the bridge days worth taking off                                            | `date.nager.at`, `data.education.gouv.fr`                                                                                                             |
| [Public Transport](extensions/transit)                  | Next departures from your stops with real-time delays and disruptions, and journeys with changes and CO₂, for SNCF trains, Île-de-France and French networks (Navitia)    | `api.navitia.io`                                                                                                                                      |
| [QR Codes](extensions/qr-codes)                         | Turn text, links and Wi-Fi networks into QR codes, and scan the ones on your screen                                                                                       | runs `systemd-run`, `zbarimg`, `grim`…; reads ~/.cache/backslash/qr, ~/Pictures…                                                                      |
| [Quick Notes](extensions/quick-notes)                   | Jot, find, pin and paste notes kept as plain markdown files, ready for Obsidian, your editor or sync                                                                      | reads ~/Documents                                                                                                                                     |
| [Raindrop.io](extensions/raindrop)                      | Search your Raindrop.io bookmarks with their covers, tags and collection; save links, favorite, move and delete                                                           | `api.raindrop.io`, `rdl.ink`                                                                                                                          |
| [Random](extensions/random)                             | Flip a coin, roll dice, draw a number, pick or shuffle from a list, get a color or ask the Magic 8-Ball                                                                   | none                                                                                                                                                  |
| [Read Later](extensions/read-later)                     | Your Wallabag or Readeck reading list with reading times and tags, articles readable in the launcher; save links there or to Instapaper                                   | `app.wallabag.it`, `www.instapaper.com`…; reads the clipboard                                                                                         |
| [Reddit](extensions/reddit)                             | Hot, new and top posts from your subreddits with scores, comments, flairs, pictures and the top comments, without an account                                              | `www.reddit.com`, `i.redd.it`…                                                                                                                        |
| [Regex Tester](extensions/regex)                        | Test JavaScript regular expressions with groups, replacements, explanations and a library of common patterns                                                              | none                                                                                                                                                  |
| [Scheduled Tasks](extensions/scheduled-tasks)           | Your cron jobs and systemd timers in plain words with their next and last runs; run now, see logs, enable or disable                                                      | runs `crontab`, `systemctl`, `journalctl`…; reads /etc/crontab, /etc/cron.d…                                                                          |
| [Screenshot & Recording](extensions/screenshot)         | Capture an area, a window or the whole screen, record the screen, and find your recent captures                                                                           | runs `systemd-run`, `systemctl`, `grim`…; reads ~/Pictures, ~/Images…                                                                                 |
| [Semver](extensions/semver)                             | Check whether a version satisfies an npm, Cargo, RubyGems or Python range, explain ranges in words, compare, sort and bump versions                                       | none                                                                                                                                                  |
| [Sentry](extensions/sentry)                             | Unresolved issues across your projects with events, users and assignee; resolve, ignore, assign; latest event with its stack trace (sentry.io, US and EU regions)         | `sentry.io`, `us.sentry.io`…                                                                                                                          |
| [Services](extensions/systemd)                          | Start, stop and inspect systemd services                                                                                                                                  | runs `systemctl`, `journalctl`                                                                                                                        |
| [Slack](extensions/slack)                               | Set your Slack status from presets, pause notifications, jump to channels and search messages                                                                             | `slack.com`, `avatars.slack-edge.com`…                                                                                                                |
| [Sonarr & Radarr](extensions/arr)                       | Upcoming episodes and movies with posters, the download queue and adding series, movies or artists to Sonarr, Radarr and Lidarr                                           | `localhost`, `127.0.0.1`…; reads ~/.cache/backslash/arr                                                                                               |
| [Sports Scores](extensions/sports)                      | Football scores live and today, standings and your teams' next matches (football-data.org), Formula 1 weekends, results and standings, and NBA scores                     | `api.football-data.org`, `crests.football-data.org`…                                                                                                  |
| [Spotify](extensions/spotify)                           | Search Spotify, play on any of your devices, queue songs, browse your playlists and save what's playing to your library                                                   | `api.spotify.com`, `accounts.spotify.com`…                                                                                                            |
| [SSH & GPG Keys](extensions/keys)                       | Your SSH and GPG keys with their type, fingerprint, agent status and expiry; copy, load in the agent, add to GitHub or GitLab, generate new ones                          | runs `ssh-keygen`, `ssh-add`, `gpg`…; reads ~/.ssh, /etc/hostname                                                                                     |
| [SSH Hosts](extensions/ssh)                             | Connect to the hosts of your SSH config and known_hosts in a terminal or the file manager                                                                                 | runs `kitty`, `alacritty`, `wezterm`…; reads ~/.ssh                                                                                                   |
| [Stack Overflow](extensions/stack-overflow)             | Search Stack Overflow, Super User, Ask Ubuntu, Unix & Linux and Server Fault, and read the accepted answer                                                                | `api.stackexchange.com`                                                                                                                               |
| [Startup Apps](extensions/startup-apps)                 | See and change what starts when you log in: autostart apps, systemd user services and Hyprland                                                                            | runs `systemctl`; reads ~/.config/autostart, /etc/xdg/autostart…                                                                                      |
| [Status Pages](extensions/status-pages)                 | Is GitHub down? Live health of the developer services you depend on, with their components and incident updates                                                           | `www.githubstatus.com`, `www.cloudflarestatus.com`…                                                                                                   |
| [Stocks](extensions/stocks)                             | A stock watchlist with live quotes, day ranges, company profiles and news, from Finnhub's free API                                                                        | `finnhub.io`, `static2.finnhub.io`                                                                                                                    |
| [Stripe](extensions/stripe)                             | Payments, customers, subscriptions and balance of your Stripe account, test or live, with refunds behind a confirmation                                                   | `api.stripe.com`                                                                                                                                      |
| [Supabase](extensions/supabase)                         | Your Supabase projects with their region, status and Postgres version; tables, edge functions, logs and API keys; open Studio, pause and restore                          | `api.supabase.com`                                                                                                                                    |
| [Syncthing](extensions/syncthing)                       | Folders and devices of Syncthing with sync progress, conflicts and last scan; rescan, pause and resume                                                                    | `localhost`, `127.0.0.1`…; runs `find`, `systemctl`                                                                                                   |
| [System Logs](extensions/system-logs)                   | Errors and warnings of this boot from systemd's journal, grouped by service                                                                                               | runs `journalctl`, `kitty`, `alacritty`…                                                                                                              |
| [System Monitor](extensions/system-monitor)             | Live CPU, memory, disk, network, GPU and battery usage, and the processes behind it                                                                                       | runs `grep`, `ps`, `df`…; reads /etc/os-release                                                                                                       |
| [System Snapshots](extensions/snapshots)                | Timeshift and Snapper snapshots with their date, type and changed files; create, compare, delete or restore them                                                          | runs `snapper`, `pkexec`, `timeshift-launcher`…; reads /etc/timeshift, /proc/mounts                                                                   |
| [System Updates](extensions/updates)                    | Available updates from APT, DNF, Pacman, Zypper, Flatpak, Snap and firmware, applied in a terminal                                                                        | runs `apt`, `dnf`, `rpm`…; reads /etc/os-release                                                                                                      |
| [Tailscale](extensions/tailscale)                       | Your tailnet's devices with their IPs and state: copy, SSH, ping, exit nodes, Taildrop, connect and disconnect                                                            | runs `tailscale`                                                                                                                                      |
| [Tailwind CSS](extensions/tailwind)                     | Search Tailwind CSS v4 utility classes with the CSS they generate, browse the color palette and open the docs                                                             | Nothing                                                                                                                                               |
| [Terminal Sessions](extensions/terminal-sessions)       | Attach to, create, rename and kill your tmux and zellij sessions                                                                                                          | runs `tmux`, `zellij`, `kitty`…                                                                                                                       |
| [Terraform](extensions/terraform)                       | Terraform and OpenTofu projects with their workspaces, state resources and outputs; init, plan, apply, fmt and validate in your terminal                                  | runs `terraform`, `tofu`…                                                                                                                             |
| [Text Diff](extensions/text-diff)                       | Compare two texts line by line and word by word: clipboard, selection or clipboard history, with a unified patch to copy                                                  | runs `wl-paste`, `xclip`…; reads the clipboard                                                                                                        |
| [Text from Screen](extensions/ocr)                      | Select any part of the screen and copy the text in it, recognized offline with Tesseract                                                                                  | runs `systemd-run`, `tesseract`, `grim`…; reads ~/.cache/backslash/ocr, /etc/os-release                                                               |
| [Text to Speech](extensions/text-to-speech)             | Read the clipboard, the selection or any text aloud with Piper, eSpeak NG, Speech Dispatcher or Festival                                                                  | runs `systemd-run`, `systemctl`, `piper`…; reads ~/.cache/backslash/tts, ~/.local/share/piper…                                                        |
| [Themes](extensions/themes)                             | Switch GTK, icon and cursor themes, Plasma color schemes and global themes, the accent color and dark mode                                                                | runs `gsettings`, `xfconf-query`, `plasma-apply-colorscheme`…; reads /usr/share/themes, /usr/local/share/themes…                                      |
| [TickTick](extensions/ticktick)                         | Today's and upcoming TickTick tasks by project; complete, reschedule and quick-add tasks in plain language                                                                | `api.ticktick.com`, `ticktick.com`                                                                                                                    |
| [Time Tracking](extensions/time-tracking)               | Start, stop and resume timers of Toggl Track, Clockify, Timewarrior or Kimai, with today's and this week's entries and totals                                             | `api.track.toggl.com`, `api.clockify.me`…; runs `timew`                                                                                               |
| [Timers](extensions/timers)                             | Timers and Pomodoro that ring even when Backslash is closed (systemd timers)                                                                                              | runs `systemd-run`, `systemctl`                                                                                                                       |
| [Todo.txt](extensions/todo-txt)                         | Your todo.txt tasks by due date, with priorities, +projects, @contexts, recurrence and quick add                                                                          | reads ~/todo.txt, ~/done.txt…                                                                                                                         |
| [Todoist](extensions/todoist)                           | Today's tasks, search and quick add in natural language                                                                                                                   | `api.todoist.com`                                                                                                                                     |
| [Toolchains](extensions/toolchains)                     | Language runtimes installed with mise, asdf, rustup, fnm, nvm, pyenv or SDKMAN!: what's in use, what's newer, install and switch in a terminal                            | runs `mise`, `asdf`…                                                                                                                                  |
| [Torrents](extensions/torrents)                         | Torrents of Transmission, qBittorrent or Deluge with progress, speeds, ETA and ratio; pause, resume, remove, add magnet links and toggle the speed limits                 | `localhost`, `127.0.0.1`…; reads the clipboard                                                                                                        |
| [Trash](extensions/trash)                               | See what is in the trash, preview it, restore items or delete them for good                                                                                               | runs `gio`, `du`, `mv`…; reads ~                                                                                                                      |
| [Trello](extensions/trello)                             | Your boards and cards with labels, due dates and members; move, complete, archive and create cards                                                                        | `api.trello.com`, `trello-members.s3.amazonaws.com`…                                                                                                  |
| [Tunnels](extensions/tunnels)                           | Share a local port on a public HTTPS URL with ngrok or a Cloudflare quick tunnel, and keep track of the open ones                                                         | `127.0.0.1:4040`, `127.0.0.1:4041`…; runs `systemctl`, `journalctl`…                                                                                  |
| [Twitch](extensions/twitch)                             | Followed channels that are live with game, viewers and uptime, top categories and channel search; watch in the browser or with streamlink                                 | `api.twitch.tv`, `id.twitch.tv`…; runs `systemctl`, `streamlink`…                                                                                     |
| [Uptime & SSL](extensions/uptime)                       | Watch your websites: HTTP status, response time and how long until their TLS certificate expires                                                                          | any host; runs `openssl`                                                                                                                              |
| [Uptime Kuma](extensions/uptime-kuma)                   | Your Uptime Kuma and Better Stack monitors, down first, with response time, certificate expiry and uptime history                                                         | `uptime.betterstack.com`, `localhost`…                                                                                                                |
| [Vault Secrets](extensions/vault)                       | HashiCorp Vault and OpenBao KV secrets with your own token: browse, copy values kept out of clipboard history, versions, token TTL and policies                           | runs `vault`, `bao`, `kitty`…                                                                                                                         |
| [Vulnerabilities](extensions/vulnerabilities)           | Look up known vulnerabilities of a package version or an advisory id on OSV.dev, and scan your projects' lockfiles                                                        | `api.osv.dev`; reads ~                                                                                                                                |
| [Wake on LAN](extensions/wake-on-lan)                   | Wake the computers of your network with a magic packet and see when they come online                                                                                      | `0.0.0.0`, `255.255.255.255`…; runs `ip`, `ping`, `wakeonlan`…; reads /proc/net/arp                                                                   |
| [Wallpapers](extensions/wallpapers)                     | Browse your wallpapers, find new ones on Wallhaven and Unsplash, and set them on any desktop                                                                              | `wallhaven.cc`, `w.wallhaven.cc`…; runs `gsettings`, `plasma-apply-wallpaperimage`…                                                                   |
| [Weather](extensions/weather)                           | Current conditions, the next 24 hours and the week ahead for any city, from Open-Meteo                                                                                    | `geocoding-api.open-meteo.com`, `api.open-meteo.com`                                                                                                  |
| [Web Analytics](extensions/web-analytics)               | Visitors, pageviews, bounce rate, top pages and sources of your sites from Plausible, Umami and PostHog                                                                   | any host                                                                                                                                              |
| [Web Search](extensions/web-search)                     | Search the web with live suggestions, 50 !bangs and your recent searches, on the engine you prefer                                                                        | `duckduckgo.com`, `suggestqueries.google.com`                                                                                                         |
| [Wikipedia](extensions/wikipedia)                       | Search Wikipedia in your language, read summaries and whole articles, and discover random pages                                                                           | `en.wikipedia.org`, `fr.wikipedia.org`…                                                                                                               |
| [Window Manager](extensions/window-manager)             | Snap, maximize, center, close and move the focused window between workspaces                                                                                              | runs `systemd-run`, `hyprctl`, `swaymsg`…; reads /etc/os-release                                                                                      |
| [World Clock](extensions/world-clock)                   | The time in your cities, offsets, day and night, and time conversions like “3pm NY in Paris”                                                                              | none                                                                                                                                                  |
| [YouTube](extensions/youtube)                           | Search YouTube with thumbnails, views and durations, open videos in the browser or play them in mpv in the background, and browse channels                                | `www.googleapis.com`, `i.ytimg.com`; runs `systemd-run`, `systemctl`, `mpv`…; reads /etc/os-release                                                   |
| [Zotero](extensions/zotero)                             | Search your Zotero library by title, author or tag, copy APA citations and BibTeX, and open PDFs                                                                          | `127.0.0.1:23119`; runs `sqlite3`; reads ~/Zotero, ~/.cache/backslash-zotero…                                                                         |
