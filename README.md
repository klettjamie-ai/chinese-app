# 汉语 Hànyǔ – Chinese Cards

A pastel, offline-ready flashcard PWA for English speakers learning Mandarin (simplified characters + pinyin).
Ships with **no personal word list**. Everything you add or load is stored only in your browser (localStorage).

- Flash cards, fill-in-the-blank (3 choices), English → Chinese typing (hanzi, pinyin with tone marks, tone numbers or no tones), and 23 built-in grammar points with 4 exercise types
- Words to learn → Practiced → Learned (Leitner-style; practiced words come back more often)
- Streaks, XP/levels, badges, sticker calendar, daily goals up to 150 (or custom)
- Tap-to-hear via the device's Chinese speech voice (`zh-CN`)
- Optional "Load starter HSK 1 words" button (bundled, removable by never pressing it)
- Load your own list (CSV/JSON) — merges without losing progress; export/backup of progress

## Word list format
CSV with a header row (only the first three columns are required):

    hanzi,pinyin,english,example,example_pinyin,example_english
    火锅,huǒguō,hot pot,我们今天晚上吃火锅。,wǒmen jīntiān wǎnshàng chī huǒguō.,We are eating hot pot tonight.

Pinyin may use tone marks or tone numbers (`huo3guo1`). JSON: an array (or `{"words":[...]}`) of
`{"hanzi","pinyin","english","example","example_pinyin","example_english"}`.

Files: `index.html`, `app.js`, `pinyin.js` (pinyin normalisation + answer checking), `data.js` (starter words + grammar), `sw.js`.
