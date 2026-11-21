# Changelog

## [0.1.0](https://github.com/sinemacula/foundation-web-ts/compare/v0.1.0...v0.1.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* report start-up failures under a reference the app can show ([#150](https://github.com/sinemacula/foundation-web-ts/issues/150))

### Features

* report start-up failures under a reference the app can show ([#150](https://github.com/sinemacula/foundation-web-ts/issues/150)) ([94cf7c8](https://github.com/sinemacula/foundation-web-ts/commit/94cf7c8ce310ae47786bd4c5153b02c9ae9cb163))

## 0.1.0 (2026-11-18)


### ⚠ BREAKING CHANGES

* rename the package to @sinemacula/foundation-web ([#143](https://github.com/sinemacula/foundation-web-ts/issues/143))
* adopt foundation 0.1.0 and its cross-tab session record store ([#142](https://github.com/sinemacula/foundation-web-ts/issues/142))
* adopt foundation's session, http, realtime and query hardening ([#138](https://github.com/sinemacula/foundation-web-ts/issues/138))
* build the kernel on the platform-agnostic foundation ([#107](https://github.com/sinemacula/foundation-web-ts/issues/107))

### Features

* absorb the application composition root and session lifecycle into the kernel ([#5](https://github.com/sinemacula/foundation-web-ts/issues/5)) ([3c8552c](https://github.com/sinemacula/foundation-web-ts/commit/3c8552c16f397d1a59fe5a3d3172587342699fc7))
* adopt foundation 0.1.0 and its cross-tab session record store ([#142](https://github.com/sinemacula/foundation-web-ts/issues/142)) ([af5af84](https://github.com/sinemacula/foundation-web-ts/commit/af5af841df6ccef3591eab895eeb736463b36b91))
* adopt foundation's session, http, realtime and query hardening ([#138](https://github.com/sinemacula/foundation-web-ts/issues/138)) ([ca9144d](https://github.com/sinemacula/foundation-web-ts/commit/ca9144d59496adbdc9da08d2f6bd4b604c58b728))
* build the kernel on the platform-agnostic foundation ([#107](https://github.com/sinemacula/foundation-web-ts/issues/107)) ([37d3c32](https://github.com/sinemacula/foundation-web-ts/commit/37d3c32bd6382e4da6cb4c0b34000d9038a59254))
* **build:** generate static HTTP error pages ([#31](https://github.com/sinemacula/foundation-web-ts/issues/31)) ([1b93e35](https://github.com/sinemacula/foundation-web-ts/commit/1b93e354ee64c4e22f7081b280753d748fcba596))
* enforce the module contract with a shipped eslint preset ([#11](https://github.com/sinemacula/foundation-web-ts/issues/11)) ([4259e7c](https://github.com/sinemacula/foundation-web-ts/commit/4259e7ca469e2a734f2e698bc0b22fa36ac0720d))
* harden the ESLint preset, adopt reusable CI, and conform to coding-standards v1.11.0 ([#12](https://github.com/sinemacula/foundation-web-ts/issues/12)) ([25e53ab](https://github.com/sinemacula/foundation-web-ts/commit/25e53abdf1d8604fb82794f4c2ddeab29ad58e90))
* import the framework kernel, playground harness and quality gates ([#1](https://github.com/sinemacula/foundation-web-ts/issues/1)) ([00d0a99](https://github.com/sinemacula/foundation-web-ts/commit/00d0a99741bba51dcdbdaf21a77d3db6cf0057ed))
* publish the kernel to npm with a release-please pipeline ([#8](https://github.com/sinemacula/foundation-web-ts/issues/8)) ([8bfba8d](https://github.com/sinemacula/foundation-web-ts/commit/8bfba8d73db44a38f272c5b72e8faff1df99b154))
* **theme:** add light/dark/system colour-scheme support ([#28](https://github.com/sinemacula/foundation-web-ts/issues/28)) ([e156482](https://github.com/sinemacula/foundation-web-ts/commit/e156482f6026e1564a10bf7ba7ec7e127e372548))


### Bug Fixes

* **app:** roll back failed boots and harden the app lifecycle ([#118](https://github.com/sinemacula/foundation-web-ts/issues/118)) ([5dd254a](https://github.com/sinemacula/foundation-web-ts/commit/5dd254ab2b7df977f9cc3fc1452a850ae94198ec))
* boot against the current foundation API and prepare the 0.1.0 release ([#125](https://github.com/sinemacula/foundation-web-ts/issues/125)) ([9c0489e](https://github.com/sinemacula/foundation-web-ts/commit/9c0489ec3507778133a572e8ba2c44f7e54b262f))
* **build:** disable source maps and pin the browser target ([#27](https://github.com/sinemacula/foundation-web-ts/issues/27)) ([e90d21c](https://github.com/sinemacula/foundation-web-ts/commit/e90d21cb91d64cb7e35ffb15b7559991e9a2d988))
* **deps:** bump brace-expansion to the patched 5.0.7 ([#29](https://github.com/sinemacula/foundation-web-ts/issues/29)) ([b7e3354](https://github.com/sinemacula/foundation-web-ts/commit/b7e3354a944be9455bdc109f8da18c7127b7172d))
* **deps:** bump fast-uri to the patched 3.1.3 ([#37](https://github.com/sinemacula/foundation-web-ts/issues/37)) ([23aedf4](https://github.com/sinemacula/foundation-web-ts/commit/23aedf46bc38a2616180f88916de4b663f81b60b))
* **eslint:** close false negatives in the module-contract preset ([#123](https://github.com/sinemacula/foundation-web-ts/issues/123)) ([8548365](https://github.com/sinemacula/foundation-web-ts/commit/854836539c9623fec2838c5d0729b9eb4fabe7c4))
* harden locale switching, routing and colour-scheme boot ([#119](https://github.com/sinemacula/foundation-web-ts/issues/119)) ([09e27b5](https://github.com/sinemacula/foundation-web-ts/commit/09e27b561cf656da1bdc510c7686295c8a4e60f0))
* harden runtime services, focus trap and route query state ([#122](https://github.com/sinemacula/foundation-web-ts/issues/122)) ([edcf4b3](https://github.com/sinemacula/foundation-web-ts/commit/edcf4b3bb236ceabaef33e2d8bae0aafbd7efc06))
* **playground:** trap confirm focus, stop users paging overshoot, close test gaps ([#115](https://github.com/sinemacula/foundation-web-ts/issues/115)) ([04212f9](https://github.com/sinemacula/foundation-web-ts/commit/04212f94a8fb5752bd1f86d876f5732912a5960b))
* **qlty:** install dependencies before type-aware ESLint on Cloud ([#41](https://github.com/sinemacula/foundation-web-ts/issues/41)) ([bbc2823](https://github.com/sinemacula/foundation-web-ts/commit/bbc282376c87a3673b08295e60d8b4bbc444ce9b))
* **qlty:** tighten the Cloud eslint install to npm ci ([#43](https://github.com/sinemacula/foundation-web-ts/issues/43)) ([67daa1e](https://github.com/sinemacula/foundation-web-ts/commit/67daa1e2107c163ac6ed6671219ab8f35e44e62c))
* **query:** harden list queries, resources, feature flags and runtime config ([#117](https://github.com/sinemacula/foundation-web-ts/issues/117)) ([0f3d8d0](https://github.com/sinemacula/foundation-web-ts/commit/0f3d8d08fc8be4b49a35f0d76afab74305686212))
* **session:** harden cross-tab identity, proactive refresh and authorize ([#116](https://github.com/sinemacula/foundation-web-ts/issues/116)) ([2b82de0](https://github.com/sinemacula/foundation-web-ts/commit/2b82de0c043dde48d04aff48f1d0f18f7dee229b))
* **session:** keep the session in memory when site storage is blocked ([#124](https://github.com/sinemacula/foundation-web-ts/issues/124)) ([560374e](https://github.com/sinemacula/foundation-web-ts/commit/560374ee165ca8df834ad5eac26582ab431af8a6))
* **session:** make authorize() await the user load, with new e2e coverage ([#18](https://github.com/sinemacula/foundation-web-ts/issues/18)) ([df0d389](https://github.com/sinemacula/foundation-web-ts/commit/df0d389f0a6c07121aad188356fa36c1d2a10dcb))


### Code Refactoring

* rename the package to @sinemacula/foundation-web ([#143](https://github.com/sinemacula/foundation-web-ts/issues/143)) ([7aa24e3](https://github.com/sinemacula/foundation-web-ts/commit/7aa24e37c87b1f827dd4e09ecf09cf1a5112fb21))
