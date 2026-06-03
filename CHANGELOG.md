# Changelog

## [0.4.1](https://github.com/rocknroll17/davinci-code-server/compare/v0.4.1...v0.4.1) (2026-06-03)


### Features

* add shared slot positional embedding to encoder ([15cbe57](https://github.com/rocknroll17/davinci-code-server/commit/15cbe5764f60b2b2c1a3c44a1ce5e3d2dc7d0afd))
* AI reasoning play mode + updated model architecture, Dockerfile ([2a5402b](https://github.com/rocknroll17/davinci-code-server/commit/2a5402b4be35b09d97b2754105072c34a91d647c))
* gate AI reasoning visualization behind ENABLE_REASONING flag ([b0907c3](https://github.com/rocknroll17/davinci-code-server/commit/b0907c3a42a3b3ab802292a3f09fec97bbdba103))
* gate AI reasoning visualization behind ENABLE_REASONING flag ([a9c3586](https://github.com/rocknroll17/davinci-code-server/commit/a9c3586a9dcb196c5a020acbd8ab91135bff3a39))
* in-browser ONNX play demo (GitHub Pages) ([736351e](https://github.com/rocknroll17/davinci-code-server/commit/736351ebd41dc6d3bb0b55ebe2daeaadd485d22b))
* model as GHCR OCI artifact, baked into image at build (canonical) ([#12](https://github.com/rocknroll17/davinci-code-server/issues/12)) ([ccd795a](https://github.com/rocknroll17/davinci-code-server/commit/ccd795ac899ea89397e56332efb8233716725aed))
* public vs-AI page — drop password gate, PvP/join, reasoning panel ([d74c03a](https://github.com/rocknroll17/davinci-code-server/commit/d74c03afd549ae3a859da3ddbdfc92406329e149))
* refresh served model to davinci-model:0.3.1 ([eae2009](https://github.com/rocknroll17/davinci-code-server/commit/eae20091b7fea8497ed2eb32777b841e4c9fbfe1))
* single-player client-side port of the vs-AI web client (no backend) ([33bca18](https://github.com/rocknroll17/davinci-code-server/commit/33bca18366cf250f38116cf958ac6c4e3eb6a66d))


### Bug Fixes

* call initTitleCards() after DV is defined (TDZ ReferenceError) ([07d1261](https://github.com/rocknroll17/davinci-code-server/commit/07d1261c46705ad07f6fcf3bec0f0324b7955f68))
* error handling + reasoning token layout + value-mask reset ([ea42085](https://github.com/rocknroll17/davinci-code-server/commit/ea42085d5c979fb2843fad0e8ebd3601f3b9461a))
* pin numpy to 3.10-compatible (&gt;=2.2.0); numpy 2.4 requires Python 3.11 ([1fc876a](https://github.com/rocknroll17/davinci-code-server/commit/1fc876aa16fe416dc9be31d982dd1d5e9973ac35))


### Documentation

* refresh README — TOC, architecture diagram, accurate model/flag/API ([741e64b](https://github.com/rocknroll17/davinci-code-server/commit/741e64bf7cc5c0ac803abc3dc9dd3319e167a494))
* surface the live demo link in a Try it section (QR-Bloom style) ([f0b4f5b](https://github.com/rocknroll17/davinci-code-server/commit/f0b4f5bfdb0d63aa877e5e6401faf41907bbace3))
* Updated README.md ([862417b](https://github.com/rocknroll17/davinci-code-server/commit/862417b99a15c2b62ee8b71133f56265f922ca21))


### Chores

* pin release to 0.4.1 (model refresh = patch, not minor) ([1b07c52](https://github.com/rocknroll17/davinci-code-server/commit/1b07c52731ad258211b2170692d9fa76d58eb2df))

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
