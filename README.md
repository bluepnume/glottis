# cugel-boilerplate

The starting point for a TypeScript library built on [cugel-scripts](https://github.com/bluepnume/cugel-scripts). It is deliberately tiny: one exported function, a node test, a browser test, a tree-shaking check, and the workflows that lint, test, build and publish it. Every file here is one every repo needs; nothing is a demo.

It is also cugel-scripts' integration test. Its CI runs the whole battery against the latest release every week, so a tooling change that breaks a consumer breaks this repo first.

## Start a repo from it

1. On GitHub, **Use this template** to create the new repo (fresh history, no fork).
2. Rename in three places: `name`, `description` and the repository URLs in `package.json`; the title line of this README; and the marker string in `src/shout.ts` once you delete the example.
3. `npm install`, then `npm test`.
4. Decide the licence. This template is MIT; that is a per-repo decision, not an inheritance.
5. To publish: on npmjs.com, after the first manual `npm publish`, add this repo and `publish.yml` as a trusted publisher for the package. From then on, `npm version <patch|minor|major>` and `git push --follow-tags` release it with provenance and no token.

## What is in the box

| Path | Purpose |
| --- | --- |
| `src/index.ts` | The barrel. Only `export * from` lines live here. |
| `src/greet.ts`, `src/shout.ts` | The example API: two functions, one depending on the other, so the tree-shaking test has something to prove. |
| `test/greet.test.ts`, `test/shout.test.ts` | Node tests, with vitest globals. |
| `test/greet.browser.test.ts` | Runs in headless Chromium through Playwright; the DOM is real. |
| `test/tree-shaking.test.ts` | Builds the package and bundles a consumer of `greet` alone, asserting nothing from `shout.ts` comes along. |
| `eslint.config.ts`, `tsconfig.json`, `vitest.config.ts` | Three thin root files pointing at cugel-scripts. |
| `.github/workflows/ci.yml` | Static battery, tests with coverage, build, on every push and PR. |
| `.github/workflows/publish.yml` | Tag-triggered npm publish with trusted publishing and provenance. |
| `.github/workflows/drift.yml` | Weekly install from declared ranges instead of the lockfile. |

## Scripts

```
npm run build          cugel-scripts build         per-file ESM + declarations into dist/
npm run fix            cugel-scripts fix --changed import order, then eslint --fix, on changed files
npm run fix:all        cugel-scripts fix           the same over the whole repo
npm run imports:missing                            add imports for unresolved names in changed files
npm run test:static    cugel-scripts static        tsc, eslint, import format, cycles, dead code
npm run test:unit      cugel-scripts test --coverage
npm run test:watch     cugel-scripts test --watch
npm test                                           static, then unit with coverage, then build
```

Coverage is held at 90% on every metric by the vitest preset. The browser project needs Chromium once: `npx playwright install chromium`.

## Conventions the tooling enforces

Formatting is ESLint stylistic rules, not prettier; run `npm run fix` rather than formatting by hand. Functions taking two or more values take one destructured options object with a named type. Enums are `UPPER_CASE` with string values and are switched over with an `assertUnreachable` default. `index.ts` files are pure barrels. Nothing runs at import time, which is what keeps `"sideEffects": false` honest and the tree-shaking test green.

## License

MIT
