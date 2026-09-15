# playwright-cli subprocess as the browser driver

All browser work (headed login, headless rotation, state save/load) goes through the `playwright-cli` subprocess (direct binary, falling back to `bunx @playwright/cli`), not an in-process Playwright dependency. The subprocess shape is the validated path and matches the repo's existing architecture; the direct playwright package was the considered alternative (fewer moving parts, new dependency shape) and was rejected.

## Considered Options — and ruled out for good

- **WebDriver-stealth tools** (`undetected-chromedriver`, `selenium-stealth`, `playwright-stealth`): Google's signal fusion wins; repeatedly broken across Chrome bumps. Not for Google flows.
- **Reading Chrome's cookie DB directly**: Chrome 127+ App-Bound Encryption makes it admin-or-bust. If browser-cookie import is ever added, Firefox is the only viable path.

## Consequences

- Under WSL, a Windows-interop `playwright-cli` resolved under `/mnt/*` is rejected (issue #27): its `state-save` re-resolves POSIX paths onto the Windows drive. WSL users need a distro-native install.
