# Local stop-word asset

`frontend/src/worker-analysis/assets/stopwords-zh-en-v1.txt` is the versioned
MVP stop-word asset used inside the analysis Worker.

- Version: `chat-history-analysis.stopwords.zh-en.v1`
- Provenance: project-authored minimal Chinese and English grammatical
  function-word list; it is not copied from a private dataset or user content.
- License status: project-authored; no third-party word-list license is
  introduced. The repository currently declares no separate open-source
  project license.
- Encoding: UTF-8 without BOM, one entry per LF-terminated line.
- Matching: NFKC normalization, English lowercase, surrounding whitespace
  removal, then exact token equality.
- Dictionary behavior: entries are applied after `jieba-wasm@2.4.0`
  `cut(text, false)` and never mutate the embedded Jieba dictionary.

The SHA-256 below is verified by the frontend test suite:

```text
a967184c888afe1fe52a430ba7bf838b39390c1902e6c5b35951a6633068e54b
```
