# Releasing Feedshell

1. Update the version in `package.json` and validate with `npm run check && npm test`.
2. Create an annotated `vX.Y.Z` tag and publish its GitHub release.
3. Update the SHA-256 in `toropanov/homebrew-tap`'s `Formula/feedshell.rb` to the tag archive checksum.
4. Run `brew audit --strict --online toropanov/tap/feedshell` and install from source before pushing the tap change.

Feedshell keeps user data outside the installation prefix: `$XDG_CONFIG_HOME/feedshell` or `~/.config/feedshell`.
