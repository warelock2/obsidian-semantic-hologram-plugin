# Contributing to Semantic Hologram

First off, thank you for taking the time to contribute! 🎉

This document explains how to report problems, propose features, and submit code or
documentation changes. It follows the common open-source fork-and-pull-request
model; for more examples and general guidance, see
[contributing.md](https://contributing.md/).

By participating in this project you agree to be respectful and constructive in all
interactions.

---

## Table of Contents

- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Fork, clone, and branch](#fork-clone-and-branch)
- [Set up your development environment](#set-up-your-development-environment)
- [Making your changes](#making-your-changes)
- [Commit messages](#commit-messages)
- [Submitting a pull request](#submitting-a-pull-request)
- [Review process](#review-process)
- [License](#license)

---

## Ways to contribute

- **Report a bug** — open an issue with clear reproduction steps.
- **Request a feature** — open an issue describing the problem it solves.
- **Improve documentation** — fixes to the README, `docs/`, or in-app help.
- **Write code** — bug fixes, features, tests, or refactors.

For anything larger than a small fix, please **open an issue first** so the approach
can be discussed before you invest time.

## Before you start

- Search existing issues and pull requests to avoid duplicates.
- Check [`AGENTS.md`](AGENTS.md) for project-specific rules and conventions; it
  documents architecture decisions and the verification discipline this project uses.
- Semantic Hologram is an [Obsidian](https://obsidian.md) plugin. You will need
  Obsidian installed to test changes in a real vault.
- Node.js 18 or newer is required.

## Fork, clone, and branch

1. **Fork** this repository on GitHub (the **Fork** button, top right).
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/obsidian-semantic-hologram-plugin.git
   cd obsidian-semantic-hologram-plugin
   ```

3. Add the upstream project as a remote so you can stay in sync:

   ```bash
   git remote add upstream <url-of-this-project>
   ```

4. **Create a development branch** off `master`, with a descriptive name:

   ```bash
   git checkout -b fix/lasso-selection-offscreen
   # or
   git checkout -b feat/custom-edge-colours
   ```

Always branch from the latest `master`, and keep each branch focused on one change.

## Set up your development environment

1. Install dependencies:

   ```bash
   npm install
   ```

2. Put the project where Obsidian can load it. The simplest way is to place (or
   symlink) the repository at:

   ```
   <your-vault>/.obsidian/plugins/semantic-hologram
   ```

3. Build the plugin:

   ```bash
   npm run dev     # watch mode, rebuilds main.js on save
   npm run build   # type-check + production bundle
   npm run lint    # eslint
   ```

4. Enable the plugin in Obsidian (**Settings → Community plugins**) and reload the
   app to pick up changes.

> **Vault notes are not source.** The plugin folder is often a symlink into a vault,
> so user note content can appear in the working tree. Do not commit vault notes,
> `data.json`, or debug snapshots such as `graph-state.json`. See `.gitignore` and
> [`AGENTS.md`](AGENTS.md).

## Making your changes

- Keep changes small and focused; one logical change per pull request.
- Match the existing code style (tabs for indentation, TypeScript, the conventions
  already present in neighbouring files). There is an [`.editorconfig`](.editorconfig).
- Do not add license headers or unrelated formatting churn.
- **Verify your work.** Before opening a pull request, run:

  ```bash
  npm run build
  npm run lint
  ```

  `npm run build` must pass (it runs `tsc --noEmit` plus the esbuild bundle). Lint
  debt may pre-exist; do not add new lint errors.

- If your change affects camera, physics, or interaction behaviour, describe in the
  pull request **how you verified it in the live app**, not just that it compiles.

- Update documentation when behaviour, settings, hotkeys, or the note format change.

## Commit messages

- Write clear, imperative subject lines (e.g. `Fix azimuth fold past the poles`).
- Keep the subject under ~72 characters; add a body for the *why* when useful.
- Reference related issues (e.g. `Fixes #42`).
- Do not commit generated artifacts (`main.js`, `graph-state.json`, vault content).

## Submitting a pull request

1. Make sure your branch is up to date and your change is committed:

   ```bash
   git fetch upstream
   git rebase upstream/master
   ```

2. **Push your development branch to your fork:**

   ```bash
   git push -u origin fix/lasso-selection-offscreen
   ```

3. Open a **pull request from your fork's branch back to this project's `master`**
   branch (GitHub shows a "Compare & pull request" button after you push).

4. In the pull request description, include:

   - **What** changed and **why**.
   - **How** you tested it (commands run, and — for UI/camera changes — what you
     observed in the live app).
   - Screenshots or a short GIF for visible changes.
   - Any issue it closes (`Fixes #…`).

5. Keep the pull request scoped to one change, and respond to review comments by
   pushing additional commits to the same branch (do not force-push over review
   history unless asked).

## Review process

- A maintainer will review your pull request, possibly requesting changes.
- CI runs `npm run build` and `npm run lint` on every push; both must pass.
- Once approved and green, the maintainer merges it.
- Please be patient — this is a volunteer project.

## License

By contributing, you agree that your contributions are licensed under the
**GNU General Public License, version 3 (GPL-3.0)**, the same license that covers
this project. See [`LICENSE.md`](LICENSE.md).
