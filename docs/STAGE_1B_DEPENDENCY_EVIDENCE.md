# Stage 1B dependency evidence

This record covers only the Stage 1B infrastructure dependencies. Every direct
dependency is an exact `package.json` version, and `package-lock.json` lockfile
version 3 is authoritative. Installation and browser testing use no global
package and no runtime CDN.

## Direct dependencies

| Package | Version | Role | Lockfile integrity | License evidence | Browser / Worker / local-asset evidence |
| --- | --- | --- | --- | --- | --- |
| `react` | `19.2.8` | runtime | `sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw==` | MIT; package `LICENSE` | Rendered in local Chrome in dev and preview; no external request |
| `react-dom` | `19.2.8` | runtime | `sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ==` | MIT; package `LICENSE` | Local DOM render in both browser modes; no Worker role |
| `jieba-wasm` | `2.4.0` | runtime | `sha512-ZvQdS+FGifrFXZIXSgOyOgEz+1wdy1P4vSvwe37FVtku9ycSdHTZbHqF5i9tMN1JucoAmeiLBeI6/YaqcGD+KA==` | MIT; package `LICENSE`; fixed source/dictionary chain and full text in `public/THIRD_PARTY_NOTICES.txt` | `jieba-wasm/web` initialized inside the Vite Worker; local WASM emitted in dev and production; `cut(text, false)` synthetic probe passed |
| `echarts` | `5.6.0` | runtime | `sha512-oTbVTsXfKuEhxftHqL5xprgLoc0k7uScAwtryCgWF6hPYFLRwOUHiFmHGCBKP5NPFNkDVopOieyUqYGH8Fa3kA==` | Apache-2.0; package `LICENSE`, `NOTICE`, and `licenses/` | Canvas initialized and exported a local PNG in dev and preview |
| `echarts-wordcloud` | `2.1.0` | runtime | `sha512-Kt1JmbcROgb+3IMI48KZECK2AP5lG6bSsOEs+AsuwaWJxQom31RTNd6NFYI01E/YaI1PFZeueaupjlmzSQasjQ==` | SPDX ISC in the exact npm manifest; tarball has no standalone license file; complete ISC and bundled wordcloud2.js MIT text in `public/THIRD_PARTY_NOTICES.txt` | Peer range is `echarts ^5.0.1`; registration and fixed ordered synthetic word-cloud input passed in managed Chromium with ECharts 5.6.0 |
| `vite` | `8.1.5` | dev/build/runtime server | `sha512-7ULLwsCdYx/nRyrpiEwvqb5TFHrMVZyBt+rg/OAXT7rgj/z+DtTDyKFeLAdDkubDVDKD8jOsndmy7m55XcfUsw==` | MIT; package `LICENSE.md` | Dev and preview explicitly bind `127.0.0.1`; build emitted local Worker/WASM/JS/CSS |
| `@vitejs/plugin-react` | `6.0.4` | build | `sha512-XcCQz0TBpBgljhj0gMuuDj49i6Ytqh5q1osT/Gp5uAVJUCTWxyskk/l1jwYYiu2xcNHHipdMz40EGfM1VdamVg==` | MIT; package `LICENSE` | Vite 8 peer-compatible React transform; build and browser smoke passed |
| `typescript` | `5.9.3` | build/type-check | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==` | Apache-2.0; package `LICENSE.txt` | Strict source type-check passed; no runtime asset |
| `eslint` | `10.8.0` | lint | `sha512-nuKKvN+oIBO0koN7Tm7dlkmnkc21mtt0QJLwAKzjLq14y6lRTdVG36MZHJ8eQHwdJMwZbQNMlPOYedMq/oVJvQ==` | MIT; package `LICENSE` | Static only; no runtime asset |
| `@eslint/js` | `10.0.1` | lint | `sha512-zeR9k5pd4gxjZ0abRoIaxdc7I3nDktoXZk2qOv9gCNWx3mVwEn32VRhyLaRsDiJjTs0xq/T8mfPtyuXu7GWBcA==` | MIT; package `LICENSE` | Static only; no runtime asset |
| `typescript-eslint` | `8.65.0` | lint | `sha512-/ggrHAwyjENDusvyxbuqxAC2dTnZg/Z8F+fgQtYIz+L6n/9HfSlEZcFGV/NsMNa6CkGk0xUjUAFwC0vHOflvIA==` | MIT; package `LICENSE` | Exact TypeScript 5.9.3 lies inside declared `<6.1.0` peer range |
| `globals` | `17.8.0` | lint | `sha512-Zz/LMDZScFmkakeL2cTHzf+PbWKdpU3uclqkZT7TjDG58j5WPt0PpA+n9uPI24fZtlw07q0OtEi84K+umsRzqQ==` | MIT; package `license` | Static browser/Worker global declarations only |
| `vitest` | `4.1.10` | unit test | `sha512-R9jUTe5S4Qb0HCd4TNqpC7oGcrMssMRGXLW80ubjWsW9VH5GF8y1Y0SFLY9AbqSk6nt0PnOx4H4WNJYZ13GUPw==` | MIT; package `LICENSE.md` | Negative Worker/WASM and boundary tests; no production import |
| `@playwright/test` | `1.62.0` | browser test | `sha512-9zOJ6ZQRAena31MpOH9VSzIz8Ou3YJ/wtY/eQm5T2uhfhG7/U3COrMS8xOtUrZrp9OgdmzEnIYODye3nY1VqzA==` | Apache-2.0; package `LICENSE` and `NOTICE` | `npm run test:browser:install` installed managed Chromium revision 1234; no system Chrome channel/profile; all non-loopback HTTP(S)/WebSocket traffic is blocked and asserted absent |
| `@types/node` | `26.1.2` | type-only | `sha512-Vu4a5UFA9rIIFJ7rB/Vaafh9lrCQszopTCx6KjFboXTGQbPNasehVR5TEiithSDGyd1DEiUByggTZsg8jukeIg==` | MIT; package `LICENSE` | Type declarations only |
| `@types/react` | `19.2.17` | type-only | `sha512-MXfmqaVPEVgkBT/aY0aGCkRWWtByiYQXo3xdQ8r5RzuFrPiRn8Gar2tQdXSUQ2GKV3bkXckek89V8wQBY2Q/Aw==` | MIT; package `LICENSE` | Type declarations only |
| `@types/react-dom` | `19.2.3` | type-only | `sha512-jp2L/eY6fn+KgVVQAOqYItbF0VY/YApe5Mz2F0aykSO8gx31bYCZyvSeYxCHKvzHG5eZjc+zyaS5BrBWya2+kQ==` | MIT; package `LICENSE` | Type declarations only |

## Critical transitive dependencies

| Package | Version | Integrity | License file |
| --- | --- | --- | --- |
| `zrender` | `5.6.1` | `sha512-OFXkDJKcrlx5su2XbzJvj/34Q3m6PvyCZkVPHGYpcCJ52ek4U/ymZyfuV1nKE23AyBJ51E/6Yr0mhZ7xGTO4ag==` | BSD-3-Clause; `LICENSE` |
| `scheduler` | `0.27.0` | `sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==` | MIT; `LICENSE` |
| `rolldown` | `1.1.5` | `sha512-t9z29cJjXf/vxQ8dyhCSpt6H6aSwHTk8cT5I3iy6SMXuFpk5mB6PL6XfC8PCwrPTx93udwKUm9HRteAlTGBLiA==` | MIT; `LICENSE` |
| `playwright` | `1.62.0` | `sha512-Z14dG305dgaLu6foB1TXQagFiW8JfSUIUaUuPaKQ6NtBPKF1P/qXcqfh6c6K/icPqdy37JmjbiBXf6JNg6Sylw==` | Apache-2.0; `LICENSE`, `NOTICE` |
| `playwright-core` | `1.62.0` | `sha512-nsNRyq0r2zsG8AcRHWknc9QRA5XCueC7gWMrs+Gx2tlZn9hcl8zudfh00lhJPY1DE7NmZ6bDsT9g2yey8mXljA==` | Apache-2.0; `LICENSE`, `NOTICE` |
| `@typescript-eslint/parser` | `8.65.0` | `sha512-CZ4nMxWwgu1HEEFNkeaCptra9QCtkmKdgf3sWh1rl1trIhmxLilgTV4cwcbQ4wemnT4sWQN8CaKOmdYx+g2gMA==` | MIT; `LICENSE` |
| `@typescript-eslint/eslint-plugin` | `8.65.0` | `sha512-IEgob78X12rHpUmtcwFsXhZdVGJtwTVP8FiCLZkR6GlYVrl2PcuB+KhCE5BlVC/eQpQnu8WXRtkHZuPar+gCRA==` | MIT; `LICENSE` |
| `@typescript-eslint/typescript-estree` | `8.65.0` | `sha512-JboAE2swaYt4tb1fHhHTABE2K+OLy09XfcTbhnk4Pw96f9dd2e9iYsJ28gBggHlo5z5x1rkyWvcPoTuNTd4oGg==` | MIT; `LICENSE` |
| `@vitest/runner` | `4.1.10` | `sha512-IKI6kpIH+LmpROplyLwBBaCfMgOZOMsygVa6BARD6ahA04VRuJSa6OaVG7kRvSEMD870Vd91rSSw0eegtWyLGg==` | MIT; `LICENSE` |
| `@vitest/expect` | `4.1.10` | `sha512-YsCn+qAk1GWjQOWFEsEcL2gNQ0zmVmQu3T03qP6UyjhtmdtwtbuI+DASn/7iQB3HGTXkdBwGddzxPlmiql5vlA==` | MIT; `LICENSE` |
| `@vitest/snapshot` | `4.1.10` | `sha512-xRkfOT1qpTAi/Ti4Y1LtfRc3kEuqxGw59eN2jN9pRWMtS/XDevekhcFSqvQqjUNGksfjMJu3Y+oJ+4Ypn2OaJw==` | MIT; `LICENSE` |

## `jieba-wasm@2.4.0` and embedded dictionary

- npm tarball integrity is the lockfile value above; npm `gitHead` is
  `1708f27c9d785f2cdfa91d57dd70a25964a7c5a9`.
- The package exports explicit browser types and code from
  `pkg/web/jieba_rs_wasm.{d.ts,js}` and contains
  `pkg/web/jieba_rs_wasm_bg.wasm`.
- The installed web WASM is 4,015,140 bytes with SHA-256
  `f285288e12b2fee4966e2f766cb30cc465637d8679af7006269dfa25871adbf5`.
- Vite emits that WASM as a local hashed asset. The package's web loader uses
  `new URL("jieba_rs_wasm_bg.wasm", import.meta.url)` and local `fetch`; browser
  interception observed no non-loopback request and there is no online
  fallback.
- The fixed `jieba-wasm` tree pins its `jieba-rs` submodule to
  `7f3b27375b638bc22a2efe2fd889ea60130d265c`. That source identifies itself as
  `jieba-rs 0.7.0`, MIT. Its actual `LICENSE` preserves
  `Copyright (c) 2018 - 2019 messense` and
  `Copyright (c) 2019 Paul Meng`.
- `jieba-rs` enables `default-dict` by default, compiles
  `src/data/dict.txt` (Git blob
  `8a9837551ef4f0833835565b5ca654bd6d786a42`, SHA-256
  `139519822fe8ab9e10d9d07e68ea0451045380aedaf54ecc51e2a28c6b42a13f`) through
  `flate!(... from "src/data/dict.txt")`, and `Jieba::new()` loads that embedded
  dictionary. `jieba-wasm` constructs its singleton with `Jieba::new()`.
- Dictionary history is closed to the actual asset. `jieba-rs` commit
  `4e54f15f19f57c3715609f980175cfde917b40af` first embedded a byte-identical
  copy of `fxsjy/jieba` snapshot
  `17ef8abba38552e5b0a78de33765095c149b8c4d` file `jieba/dict.txt` (Git blob
  `fc6075f64943e1861c420db4da38063de9d8afc5`, SHA-256
  `7197c3211ddd98962b036cdf40324d1ea2bfaa12bd028e68faa70111a88e12a8`).
  `jieba-rs` renamed the file in
  `54dd55590bca79d8529e27544b93192fa34b49fa` and sorted it in
  `9d4474913d0f8eff5fae74af820f39597f556e3a`; there are no later dictionary
  changes through the pinned submodule revision.
- The actual `fxsjy/jieba` license preserves
  `Copyright (c) 2013 Sun Junyi`; the actual `jieba-wasm` license preserves
  `Copyright (c) 2018 fengkx <liangkx8237@gmail.com>`. Complete MIT texts for
  all three layers and the code/dictionary/WASM relationship are in
  `frontend/public/THIRD_PARTY_NOTICES.txt`.
- Stage 1B neither calls `with_dict` nor downloads or mutates a dictionary.
- The selected application path is exactly `jieba-wasm/web`; initialization is
  `await init()` in the Worker and the only segmentation call is
  `cut(fixedSyntheticProbe, false)`. In both development and production
  managed Chromium,
  fixed input `本地隐私分析测试` produced the pinned smoke result
  `["本地", "隐私", "分析测试"]`.

## ECharts and word-cloud extension decision

`echarts-wordcloud@2.1.0` is the latest non-beta package version and declares
`echarts ^5.0.1`; it was published in 2022 and is not currently fast-moving.
ECharts 6 is therefore intentionally not selected. The extension's fixed npm
`gitHead` is `ada5d364119941548c32a911470be020e24e8093`. Although its tarball omits
a standalone license text, its exact package manifest declares SPDX `ISC`;
this packaging limitation is recorded rather than hidden. The fixed repository
also has no separate project copyright line; repository history and npm
maintainer metadata are recorded transparently in the distributed notice.
`src/layout.js` carries the `wordcloud2.js` header
`Copyright 2011 - 2019 Tim Guan-tin Chien and contributors` and references
revision `c236bee60436e048949f9becc4f0f67bd832dc5c`; the complete upstream MIT
text preserves `Copyright (c) 2011 Timothy Guan-tin Chien`.

`frontend/public/THIRD_PARTY_NOTICES.txt` has SHA-256
`7db17c87dbbd5e0568501c886b69f93aff61e21dfd04de35994f40d1da04ff17`.
Vite copies it unchanged to `frontend/dist/THIRD_PARTY_NOTICES.txt`; build
verification compares bytes and hashes, and browser smoke fetches it from the
same loopback origin.

Compatibility is established by runtime evidence, not the package name:
ECharts 5.6.0 initialized a Canvas renderer, the side-effect extension
registered `series.type = "wordCloud"`, fixed ordered synthetic values rendered
in both Vite development and production preview, and `getDataURL({type:"png"})`
returned `data:image/png;base64,`. No pixel determinism is claimed.

## Lockfile registry portability

The original Stage 1B lock had 181/181 `resolved` URLs at
`registry.npmmirror.com`. The normalized lock has the same 182 package entries,
181 resolved entries, direct dependencies, package-path/version set, and
integrity set, with 181/181 URLs at `registry.npmjs.org`. The before/after
package-path/version digest is
`849583aa28e4c0ebdff795ddfc5907d47c3264fe9455e59017152f5d6ffbc393`;
the integrity digest is
`ba2d3246d4dbdd3ed9db7fa6cc0fd1309f8972b6884e057b9f4e9c1674314151`;
the direct dependency digest is
`a72b98105f218bd68708e1cfa270c7a3013b6678aa04078292138e3c2ef7be26`.
Normalization and clean installation use isolated npm user configuration and
cache values; no global npm registry setting changes. A domestic mirror remains
an optional invocation-level user choice, not a repository requirement.

## Runtime network behavior

The production graph contains no remote font, CSS, script, image, analytics,
telemetry, dictionary, or WASM URL. Real-browser tests route every request,
abort non-loopback HTTP(S), track WebSockets, and require zero blocked or
external requests. All production requests resolve from
`http://127.0.0.1:4173`; dev requests resolve from
`http://127.0.0.1:5173`.

Static production text contains standard W3C XML/SVG namespace identifiers and
React's error-documentation URL string. Neither is a resource request. The main
bundle's only generic `fetch` is Vite's module-preload polyfill, which consumes
the `href` of local document preload links; the Worker bundle's only `fetch`
receives the relative hashed WASM URL constructed from `self.location.href`.
There is no literal remote fetch target or remote fallback, which is also
confirmed by the captured browser request lists.
