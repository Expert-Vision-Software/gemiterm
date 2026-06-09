# GemiTerm — This Python package is deprecated

**GemiTerm v1.5.0 is the final PyPI release.** The current GemiTerm (v2.x+) is a
native Bun binary distributed through GitHub Releases, installable via bun or npm globally, also accessible via bunx/npx. 
Your existing profiles and cookies (`~/.config/gemiterm/` or `%APPDATA%\gemiterm\`) are preserved by the new installer.

To continue using this version, do not update to this or newer versions.

## Install the current version

**Windows (PowerShell):**

```powershell
irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
```

**Linux / WSL:**

```bash
curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash
```

## What changed?

- The Python source was removed upstream. v1.5.0 is a metadata-only release
  whose only purpose is to surface this deprecation notice on the PyPI project
  page.
- The installed v1.4.1 package continues to work unchanged — no deprecation
  warnings, no interactive prompts, no network calls.
- For new features and bug fixes, switch to the Bun binary using the install
  commands above.

## Links

- [Current release](https://github.com/expert-vision-software/GemiTerm/releases/latest)
- [Source repository](https://github.com/expert-vision-software/GemiTerm)
