# Contributing to OpenClippy

First off, **thank you** for considering contributing to OpenClippy! 🎉  
This project aims to revive the spirit of Clippy as a powerful, secure, open-source AI agent for Microsoft 365 automation. Every contribution—big or small—helps make work suck less for everyone using Microsoft Graph API + natural language AI.

Whether you're fixing a typo, adding a new tool/plugin, improving docs, reporting a bug, or suggesting a feature, your help is welcome. This document explains how to get involved effectively.

## Code of Conduct

We follow the [Contributor Covenant Code of Conduct v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.md). Please be kind, respectful, and inclusive. If you see behavior that violates this, report it to the maintainer (@revsmoke).

## How Can I Contribute?

### 1. Reporting Bugs 🐛

Found something broken? Great—help us fix it!

- Search existing [issues](https://github.com/revsmoke/openclippy/issues) to see if it's already reported.
- If not, open a new issue using the **Bug Report** template.
- Include:
  - Steps to reproduce
  - Expected vs. actual behavior
  - Environment (Node version, OS, Claude model if relevant)
  - Screenshots or logs if helpful
  - Any relevant code snippets

### 2. Suggesting Features or Enhancements ✨

Have an idea for a new tool, M365 service integration (e.g., OneNote, SharePoint), plugin example, or improvement?

- Check existing [issues](https://github.com/revsmoke/openclippy/issues) and [discussions](https://github.com/revsmoke/openclippy/discussions).
- Open a new issue with the **Feature Request** template.
- Describe the use case, why it's valuable, and any rough implementation thoughts.

For larger changes, it's best to discuss in an issue first before coding.

### 3. Contributing Code or Docs 📝

We love pull requests! Here's the workflow:

1. **Fork & Clone** the repo  
   ```bash
   git clone https://github.com/YOUR-USERNAME/openclippy.git
   cd openclippy
   ```

2. **Install dependencies** (we use pnpm)  
   ```bash
   pnpm install
   ```

3. **Set up environment**  
   - Copy `.env.example` to `.env`
   - Follow the README to authenticate with Microsoft Graph (via device code flow or similar—no secrets stored long-term)
   - Optionally set up your Claude API key if testing locally

4. **Create a branch** (use a descriptive name)  
   ```bash
   git checkout -b fix/bug-description   # or feat/new-tool, docs/improve-readme, etc.
   ```

5. **Make your changes**  
   - Follow existing code style (run `pnpm lint` or `pnpm format` if scripts exist)
   - Add/update tests if applicable (especially for new tools)
   - Update documentation (README, tool descriptions, etc.)
   - Keep commits atomic and descriptive

6. **Test locally**  
   ```bash
   pnpm start    # or whatever dev command runs the agent
   ```
   Try your changes with sample commands like "Triage my unread emails" or "Schedule a meeting next Tuesday".

7. **Commit & Push**  
   Use conventional commit messages if possible (e.g., `fix: handle invalid date in calendar tool`, `feat: add OneDrive search tool`, `docs: update contributing guide`).

8. **Open a Pull Request**  
   - Target the `main` branch
   - Fill out the PR template (it will auto-load if configured)
   - Link to any related issues (`Closes #123`)
   - Describe what you changed and how to test it

We review PRs as soon as possible—thanks for your patience!

### Good First Issues

Looking for a place to start? Check these labels:
- [good first issue](https://github.com/revsmoke/openclippy/labels/good%20first%20issue) — beginner-friendly tasks (typos, small docs, simple bug fixes)
- [help wanted](https://github.com/revsmoke/openclippy/labels/help%20wanted) — contributions especially needed here

Feel free to comment on an issue saying "I'd like to work on this" so others know it's claimed.

## Development Setup & Guidelines

- **Tech Stack**: Node.js (v18+ recommended), TypeScript, pnpm, Microsoft Graph API, Anthropic Claude (or compatible LLM)
- **Code Style**: We aim for clean, readable TypeScript. Use ESLint/Prettier if configured (add scripts to package.json if missing).
- **Testing**: Add unit/integration tests for new tools (using Jest/Vitest if set up). At minimum, manually verify natural language commands work end-to-end.
- **Security**: Never commit secrets or tokens. All auth uses short-lived tokens via device flow.
- **Plugins/Tools**: New tools should follow the existing pattern (e.g., define schema, implement handler, add to tool registry).
- **Commit Signing**: Optional but appreciated (use `git commit -S` if you have GPG set up).

## Non-Code Contributions

We value these just as much:
- Improving documentation
- Creating example plugins or use-case demos
- Writing blog posts/tutorials about using OpenClippy
- Helping triage issues
- Spreading the word (stars, shares, feedback)

## Questions?

- Open a [discussion](https://github.com/revsmoke/openclippy/discussions) for questions/ideas.
- Ping @revsmoke on X (@revsmoke) or in issues.

Thanks again for helping build the future of AI-powered productivity! 🚀  
Let's make Microsoft 365 feel alive again.

Happy contributing!

### Quick Tips After Adding This
- Create a few **good first issue** labels and open 2-3 simple issues yourself (e.g., "Add badge for Node version to README", "Document how to add a new tool").
- If you add issue/PR templates later (via `.github/ISSUE_TEMPLATE/`), link them here.
- Update this file as the project evolves (e.g., add specific lint/test commands once set up).

Let me know if you want tweaks—like making it shorter, adding more AI-specific sections, or including sections for security reporting!