# Changelog

## [0.5.0](https://github.com/rocknroll17/davinci-code-server/compare/v0.4.1...v0.5.0) (2026-11-16)


### Features

* 55-token model (my-hand constraints as their own tokens) + refreshed model.onnx ([784a171](https://github.com/rocknroll17/davinci-code-server/commit/784a171ad3eacc3efcce7670485cb9559b776a6c))
* 55-token model + refreshed browser-demo model.onnx (~246M steps) ([70dc358](https://github.com/rocknroll17/davinci-code-server/commit/70dc358d9783e9cfca6db9cfe2cd86335f8fb500))
* **i18n:** Korean/English support for the browser demo ([#32](https://github.com/rocknroll17/davinci-code-server/issues/32)) ([0f17248](https://github.com/rocknroll17/davinci-code-server/commit/0f1724855bc3e81f7bd16403c5f30597e27918a1))
* my_hand_constraint input (opponent's ruled-out values on the AI's cards) ([7e1c2d8](https://github.com/rocknroll17/davinci-code-server/commit/7e1c2d805b2a89c84a05ce6a652c56c75edf32cb))
* my_hand_constraint input + refreshed browser-demo model (~229M steps) ([bfc45c1](https://github.com/rocknroll17/davinci-code-server/commit/bfc45c13dba0eb010637dc0243962a30c1cc5c54))
* **seo:** add meta tags, sitemap.xml, robots.txt for search indexing ([c38e752](https://github.com/rocknroll17/davinci-code-server/commit/c38e75298e3c58a37e6950a26a22926026b90917))


### Bug Fixes

* **ci:** smoke test route check via OpenAPI schema (Starlette 1.6 no longer flattens included routers) ([04c4319](https://github.com/rocknroll17/davinci-code-server/commit/04c4319c7f3493a3d946d1c0cc2ad476300d30e3))
* **server:** build the policy with the shape recorded in the checkpoint ([d07b169](https://github.com/rocknroll17/davinci-code-server/commit/d07b1692492243e30fd2e8d9e66be25c58ee2ec7))
* **server:** build the policy with the shape recorded in the checkpoint ([4b417e1](https://github.com/rocknroll17/davinci-code-server/commit/4b417e17bd018033cd93e06ba6a74bb2d65eb339))
* **site:** bump script and model URL versions so the new engine and model load together ([35082f8](https://github.com/rocknroll17/davinci-code-server/commit/35082f8a7e3d559ba176af76a192f2d6aaff2ff0))


### Performance

* **model:** 2-layer narrow model (fusion 128, FFN 256), int8 ([3a3cfa1](https://github.com/rocknroll17/davinci-code-server/commit/3a3cfa134b12ad3f698c609b651caa126dcc2e1a))
* single-run graph + 2-layer narrow int8 model (6.52MB -&gt; 0.68MB) ([6e3097f](https://github.com/rocknroll17/davinci-code-server/commit/6e3097fe5f3bf2a9cd76548beaa0e4b9fca628f8))
* single-run ONNX graph (value logits for every position) ([94f8f17](https://github.com/rocknroll17/davinci-code-server/commit/94f8f173097ae93b589a4ed37da23a0b75a300ae))

## [0.4.1](https://github.com/rocknroll17/davinci-code-server/compare/v0.4.0...v0.4.1) (2026-06-01)


### Features

* refresh served model to davinci-model:0.3.1 ([8fb370e](https://github.com/rocknroll17/davinci-code-server/commit/8fb370ee328c624ed2a974872ec0dfdd57191102))


### Chores

* pin release to 0.4.1 (model refresh = patch, not minor) ([8d79405](https://github.com/rocknroll17/davinci-code-server/commit/8d79405687f539b7b221742dadb873af92e2f93d))

## [0.4.0](https://github.com/rocknroll17/davinci-code-server/compare/v0.3.1...v0.4.0) (2026-06-01)


### Features

* add shared slot positional embedding to encoder ([10b71e5](https://github.com/rocknroll17/davinci-code-server/commit/10b71e59561990134cbb5d3eab0f74e93aa225b5))


### Documentation

* refresh README — TOC, architecture diagram, accurate model/flag/API ([a7e63c4](https://github.com/rocknroll17/davinci-code-server/commit/a7e63c46fba751956840a4a6ceea2a062f65aeb5))
* surface the live demo link in a Try it section (QR-Bloom style) ([90336aa](https://github.com/rocknroll17/davinci-code-server/commit/90336aa6f90e337c9bc8cd89b98171129d3f9544))
* Updated README.md ([ff9c1eb](https://github.com/rocknroll17/davinci-code-server/commit/ff9c1eb4caeaf11774797a41268d7423e4e818a5))

## [0.3.1](https://github.com/rocknroll17/davinci-code-server/compare/v0.3.0...v0.3.1) (2026-05-30)


### Bug Fixes

* pin numpy to 3.10-compatible (&gt;=2.2.0); numpy 2.4 requires Python 3.11 ([bd3791e](https://github.com/rocknroll17/davinci-code-server/commit/bd3791e33ca2135dfc2d5d496b63b6297f6da02e))

## [0.3.0](https://github.com/rocknroll17/davinci-code-server/compare/v0.2.0...v0.3.0) (2026-05-30)


### Features

* gate AI reasoning visualization behind ENABLE_REASONING flag ([e6251d9](https://github.com/rocknroll17/davinci-code-server/commit/e6251d95377a991f4c32bed1f4bfc6c744fcc67e))
* gate AI reasoning visualization behind ENABLE_REASONING flag ([2b882ea](https://github.com/rocknroll17/davinci-code-server/commit/2b882ea0b4382d62515ad733001232219985fab1))
* in-browser ONNX play demo (GitHub Pages) ([93a96a9](https://github.com/rocknroll17/davinci-code-server/commit/93a96a9a03cb5f2f9bf2e925063c017587e8eda2))
* model as GHCR OCI artifact, baked into image at build (canonical) ([#12](https://github.com/rocknroll17/davinci-code-server/issues/12)) ([6b3b51b](https://github.com/rocknroll17/davinci-code-server/commit/6b3b51ba71eefa8f2c5ab8187b7e3b4b8cd0ed70))
* public vs-AI page — drop password gate, PvP/join, reasoning panel ([fe5ba22](https://github.com/rocknroll17/davinci-code-server/commit/fe5ba22f64b60d70699e3e577623a633d7c8c7e3))
* single-player client-side port of the vs-AI web client (no backend) ([92dd1ab](https://github.com/rocknroll17/davinci-code-server/commit/92dd1ab444bf0585f18e93a90f56c1a36819a371))


### Bug Fixes

* call initTitleCards() after DV is defined (TDZ ReferenceError) ([02aac05](https://github.com/rocknroll17/davinci-code-server/commit/02aac054055bc7f471fb40281f552f261f1caa89))

## [0.2.0](https://github.com/rocknroll17/davinci-code-server/compare/v0.1.0...v0.2.0) (2026-05-30)


### Features

* AI reasoning play mode + updated model architecture, Dockerfile ([4a6053c](https://github.com/rocknroll17/davinci-code-server/commit/4a6053cefa092150d4640ca769d3445e7cbd2887))


### Bug Fixes

* error handling + reasoning token layout + value-mask reset ([e7b84df](https://github.com/rocknroll17/davinci-code-server/commit/e7b84dfe027d0e5edce4b12c7d0b99062b09e968))
