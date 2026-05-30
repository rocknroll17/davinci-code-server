# Contributing

## Commit messages — Conventional Commits

This repo uses [release-please](https://github.com/googleapis/release-please),
which reads commit messages to compute the next version and changelog. Use the
[Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <summary>
```

| Type       | Bumps    | Shows in changelog under |
|------------|----------|--------------------------|
| `feat`     | minor    | Features                 |
| `fix`      | patch    | Bug Fixes                |
| `perf`     | patch    | Performance              |
| `ui`       | patch    | UI                       |
| `refactor` | patch    | Refactor                 |
| `docs`     | patch    | Documentation            |
| `chore` / `ci` / `test` / `style` | none | hidden |

Breaking changes: add `!` (`feat!:`) or a `BREAKING CHANGE:` footer → major bump.

## Release flow

1. Merge conventional commits into `main`.
2. release-please opens a "release X.Y.Z" PR with the changelog.
3. Merge that PR → it tags `vX.Y.Z` and creates the GitHub Release.
4. `release.yml` builds and pushes the Docker image to GHCR.
5. Upload the model once per release (it is not in the repo):
   `gh release upload <tag> checkpoints/model.pt --repo rocknroll17/davinci-code-server`

## Local checks

```bash
python -m compileall -q app run.py
python scripts/ci_smoke.py     # imports the FastAPI app (no checkpoint needed)
```
