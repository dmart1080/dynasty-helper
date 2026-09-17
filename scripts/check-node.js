// Runs on `npm install`. Node 22.5+ is required for the built-in node:sqlite
// module. Without this check the failure surfaces much later as a cryptic
// "bad option" or "Cannot find module 'node:sqlite'".
const REQUIRED = [22, 5, 0];
const current = process.versions.node.split('.').map(Number);

const tooOld =
  current[0] < REQUIRED[0] ||
  (current[0] === REQUIRED[0] && current[1] < REQUIRED[1]);

if (tooOld) {
  console.error(`
\x1b[31mDynasty Helper needs Node 22.5 or newer — you are on ${process.versions.node}.\x1b[0m

It uses Node's built-in SQLite (node:sqlite), which landed in 22.5. That is what
keeps this project free of native modules and build toolchains.

To upgrade:
  nvm install 22 && nvm use 22          (if you use nvm)
  brew install node                      (macOS + Homebrew)
  https://nodejs.org                     (installer for any platform)

Then re-run: npm install
`);
  process.exit(1);
}
