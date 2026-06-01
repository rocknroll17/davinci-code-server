# Changelog

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
