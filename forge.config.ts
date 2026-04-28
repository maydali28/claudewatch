import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { PublisherGithub } from '@electron-forge/publisher-github'

const config: ForgeConfig = {
  // Forge outputs packaged artifacts to dist/ so it doesn't conflict with
  // electron-vite's build output in out/ (forge auto-ignores its own outDir).
  outDir: 'dist',
  packagerConfig: {
    name: 'ClaudeWatch',
    executableName: 'claudewatch',
    appBundleId: 'com.maydali.claudewatch',
    appCategoryType: 'public.app-category.developer-tools',
    icon: 'resources/icons/icon',
    asar: {
      unpack: '{node_modules/chokidar/**/*,node_modules/fsevents/**/*}',
    },
    // Forge hardcodes ignore:[/^\/out\//g] but our electron-vite builds into out/.
    // Since we set outDir:'dist', forge no longer needs to exclude out/.
    //
    // Each entry below is one of: source we don't ship (src, scripts), build
    // outputs already represented elsewhere (dist), repo plumbing the user
    // doesn't need (.github, .husky, dotfiles), local docs/notes (TODO, *.md
    // at repo root), the lockfile (re-installs offline only need installed
    // node_modules), and packaging caches.
    //
    // Anything matched by a regex below is excluded from the .asar payload.
    // Audit `dist/Mac/ClaudeWatch.app/Contents/Resources/app.asar` after a
    // `pnpm package` to confirm — `npx asar list <path>` shows the contents.
    ignore: [
      /^\/src\//,
      /^\/dist\//,
      /^\/scripts\//,
      /^\/bundle\//,
      /^\/coverage\//,
      /^\/homebrew\//,
      /^\/\.github\//,
      /^\/\.husky\//,
      /^\/\.vscode\//,
      /^\/node_modules\/\.cache\//,
      /^\/\./,
      /^\/electron\.vite/,
      /^\/forge\.config/,
      /^\/tsconfig.*\.json$/,
      /^\/eslint\.config/,
      /^\/vitest\.config/,
      /^\/changelog\.config/,
      /^\/audit-ci\.json$/,
      /^\/dependency-graph\.svg$/,
      /^\/pnpm-lock\.yaml$/,
      /^\/CHANGELOG\.md$/,
      /^\/README\.md$/,
      /^\/CONTRIBUTING\.md$/,
      /^\/TODO\.md$/i,
      /^\/production\.md$/i,
      /^\/THIRD_PARTY_LICENSES\.md$/,
    ],
  },
  makers: [
    // macOS: DMG installer (no auto-update — handled via Homebrew)
    new MakerDMG({
      format: 'ULFO',
    }),

    // Windows: Squirrel installer — produces Setup.exe + nupkg files consumed
    // by electron-updater's generic provider via latest.yml on the release server.
    new MakerSquirrel({
      name: 'claudewatch',
      setupExe: 'ClaudeWatch-Setup.exe',
      // Code-signing: set CSC_LINK + CSC_KEY_PASSWORD env vars in CI to sign.
      ...(process.env['CSC_LINK']
        ? {
            certificateFile: process.env['CSC_LINK'],
            certificatePassword: process.env['CSC_KEY_PASSWORD'],
          }
        : {}),
    }),

    // Linux: DEB and RPM packages consumed by electron-updater generic provider.
    new MakerDeb({
      options: {
        maintainer: 'may.mohamedali28@gmail.com',
        homepage: 'https://github.com/maydali28/claudewatch',
      },
    }),
    new MakerRpm({ options: {} }),

    // Portable ZIP for macOS (manual distribution) and Windows (fallback).
    new MakerZIP({}, ['darwin', 'win32']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'maydali28', name: 'claudewatch' },
      prerelease: false,
      draft: true,
    }),
  ],
}

export default config
