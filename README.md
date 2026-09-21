# Auto Tagger (Jev)

An Obsidian plugin that suggests or applies a tag to the currently open note
using [TypeSafe](https://typesafe.ai)'s Jev model and the tags that already
exist in your vault.

Install it from the [Obsidian community store](https://community.obsidian.md/plugins/auto-tagger-jev).

## How it works

1. Run **Auto-tag current note** from the command palette, or click the tag
   ribbon icon.
2. The plugin reads the note title and the start of its body, and collects your
   most-used vault tags.
3. It asks Jev a single Choice question: which tag best matches this note. The
   candidate list includes a literal **None of these fit well** option.
4. The chosen tag is applied (unless "None of these fit well" won), and a
   notification shows the tag and the model's confidence so you can build an
   intuition for your own vault before trusting any threshold.

## Applying tags

- If the note already has frontmatter, the tag is added to its `tags` list.
- Otherwise an inline `#tag` is appended to the end of the note.
- Tags the note already has are never duplicated.

## Settings

- **TypeSafe API key** — required. Stored locally in your vault, never logged.
- **Tags to consider** — how many of your most-used tags to send (1 to 25,
  default 15). Sending fewer, higher-signal options improves the model's
  discrimination.
- **Note body characters** — how much of the note to send, taken from the start
  (default 2000).
- **Dry run** — show the suggested tag without changing the note.
- **Developer mode** — log the raw Jev response (tag, confidence, and full
  probability distribution) to the developer console.

## Privacy

- When you run **Auto-tag current note**, the plugin sends the note title, the
  first **Note body characters** of the note, and the candidate tag names to
  TypeSafe (`https://api.typesafe.ai/v1/systemone`) using the Jev model. No
  other vault content is read or transmitted.
- This happens only when you explicitly trigger the command or ribbon icon.
  The plugin makes no automatic or background network calls.
- Your TypeSafe API key is stored locally in the vault's plugin data file and
  is used only as the bearer credential for that request. It is never logged.
- The plugin collects no telemetry and sends no data to any service other than
  TypeSafe.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check and production build
npm run lint    # eslint
```

Copy `main.js` and `manifest.json` into
`<Vault>/.obsidian/plugins/auto-tagger-jev/` and enable the plugin in
**Settings → Community plugins**.
