# Release signing

Three independent layers, each switched on by repository secrets. Without the secrets the
release workflow still works and publishes unsigned builds, as before.

| Layer                            | Protects against                                                                           | Secrets                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| minisign signature of SHA256SUMS | a tampered or swapped file in the GitHub release (checked by `install.sh` / `install.ps1`) | `MINISIGN_SECRET_KEY`, `MINISIGN_PASSWORD`                                                         |
| macOS signing + notarization     | Gatekeeper warnings; lets the installer keep macOS's quarantine check                      | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows Authenticode             | SmartScreen / Smart App Control warnings                                                   | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` **or** the `AZURE_*` set below                              |

Secrets go in GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

## 1. minisign key for SHA256SUMS (do this first)

The release workflow (`.github/workflows/release.yml`, job `publish`) signs `SHA256SUMS` and
uploads `SHA256SUMS.minisig`. The website installers verify that signature with a public key
embedded in them before they trust any checksum, and refuse to install if it is missing or
wrong (fail-closed; `--insecure` / `ZINARIX_INSECURE=1` overrides).

1. Install minisign (<https://jedisct1.github.io/minisign/>): `brew install minisign`,
   `sudo apt install minisign`, `sudo pacman -S minisign`, `scoop install minisign`…
2. Generate the key pair **on a trusted machine**, outside the repository:

   ```sh
   minisign -G -p zinarix.pub -s zinarix.key
   ```

   Choose a strong password (or add `-W` for a key without password; then the secret store is
   the only protection). Keep `zinarix.key` and its password in a password manager and an
   offline backup: losing it means every installer has to be updated with a new key.

3. Add the repository secrets:
   - `MINISIGN_SECRET_KEY`: the **whole content** of `zinarix.key` (both lines).
   - `MINISIGN_PASSWORD`: its password (leave it unset for a `-W` key).
4. Paste the public key (the second line of `zinarix.pub`, it starts with `RW`) in place of
   the placeholder `REPLACE_WITH_MINISIGN_PUBLIC_KEY` in **both** installers:
   - `website/install.sh`: `MINISIGN_PUBKEY="RW..."`
   - `website/install.ps1`: `$MinisignPubKey = 'RW...'`
5. Commit, deploy the website, then push a new tag. From then on:
   - the release job fails if `install.sh` has a real key but the secret is missing, and it
     checks the new signature against that key before publishing;
   - releases made **before** signing was enabled have no `SHA256SUMS.minisig`, so the new
     installers refuse them unless `--insecure` is used. Install those versions from the
     release page, or re-sign them by hand (below).

Order matters: set the secrets (step 3) and publish one signed release **before** deploying
the website with the embedded key, otherwise `install.sh` / `install.ps1` reject the current
latest release, which is still unsigned. Re-signing that release by hand also works:

```sh
gh release download vX.Y.Z -p SHA256SUMS
minisign -S -l -s zinarix.key -m SHA256SUMS -t "zinarix-studio vX.Y.Z SHA256SUMS"
gh release upload vX.Y.Z SHA256SUMS.minisig
```

Details the installers rely on (keep them if you change the workflow):

- `-l` (legacy, non-prehashed signature): `install.ps1` checks plain Ed25519 in PowerShell with
  no extra tool; it does not implement BLAKE2b prehashing. `install.sh` handles both.
- The trusted comment must contain the tag (`zinarix-studio vX.Y.Z SHA256SUMS`): the
  installers reject a SHA256SUMS signed for a different release (replay of an older build).
- `install.sh` verifies with `minisign` when installed, otherwise with OpenSSL 3. macOS's
  LibreSSL cannot verify Ed25519, so macOS users need `brew install minisign` (the installer
  says so and stops instead of skipping the check).

Users can check by hand: `minisign -Vm SHA256SUMS -P RW...` and then `sha256sum -c SHA256SUMS
--ignore-missing`.

**Rotating the key:** generate a new pair, replace both secrets and the key in both
installers in the same change, deploy the website, and re-sign the latest release with the new
key (command above).

## 2. macOS: Developer ID signing and notarization

Needs an Apple Developer Program membership.

1. Create a **Developer ID Application** certificate (Xcode → Settings → Accounts → Manage
   Certificates, or developer.apple.com), export it with its private key as `.p12`.
2. Secrets:
   - `MAC_CSC_LINK`: `base64 -i cert.p12` output (electron-builder's `CSC_LINK`).
   - `MAC_CSC_KEY_PASSWORD`: the `.p12` export password.
   - `APPLE_ID`: the Apple ID e-mail; `APPLE_APP_SPECIFIC_PASSWORD`: an app-specific password
     from appleid.apple.com; `APPLE_TEAM_ID`: the 10-character team id.

`apps/desktop/scripts/build-editions.mjs` (`withSigning`) then removes `mac.identity: null`,
turns on the hardened runtime (electron-builder's default entitlements) and notarizes. With
only the certificate secrets the app is signed but not notarized (a warning is printed).

Once releases are notarized, `install.sh` sees `spctl --assess` succeed and leaves macOS's
quarantine flag in place (Gatekeeper checks the app on first launch). Before that, it only
removes the flag when the checksum came from the minisign-signed SHA256SUMS; with a plain
checksum it keeps the flag and tells the user how to open the app.

## 3. Windows: Authenticode

Pick one:

- **Certificate file (signtool):** `WIN_CSC_LINK` = base64 of the `.pfx`,
  `WIN_CSC_KEY_PASSWORD` = its password. electron-builder signs with signtool on its own.
  (EV certificates on hardware tokens cannot be used this way; use Azure.)
- **Azure Trusted Signing:** create a Trusted Signing account and certificate profile and an
  Entra app registration (service principal) with the _Trusted Signing Certificate Profile
  Signer_ role, then set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`),
  `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` and `AZURE_SIGNING_PUBLISHER` (the
  certificate's subject CN). `build-editions.mjs` passes them as `win.azureSignOptions`.

`install.ps1` reports the Authenticode status of the downloaded installer. Builds made with
`ZINARIX_KEEP_ELECTRON_EXE=1` keep Electron's exe untouched and are not signed.

The "Especial" portable build (`.github/workflows/especial.yml`) is not signed by these steps.
