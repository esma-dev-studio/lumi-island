# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story_v29.spec.ts >> はじめから → オープニングが出て、どのキーでも とばせる
- Location: tests\e2e\story_v29.spec.ts:29:1

# Error details

```
Error: page.evaluate: TypeError: Converting circular structure to JSON
    --> starting at object with constructor '_TransformNode'
    |     property '_children' -> object with constructor 'Array'
    |     index 0 -> object with constructor '_Mesh'
    |     property '_cache' -> object with constructor 'Object'
    --- property 'parent' closes the circle
    at JSON.stringify (<anonymous>)
    at eval (eval at evaluate (:311:30), <anonymous>:1:6)
    at eval (<anonymous>)
    at UtilityScript.evaluate (<anonymous>:311:30)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic:
    - generic:
      - generic: ミオは、ちいさな しまへ ひっこして きた。
      - generic: ▶ とばす
```