# All But This Swipe

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that adds a **"Delete All But This Swipe"** option to the message deletion prompt, allowing you to discard every unused swipe on a message in one action while keeping the one currently displayed.

---

There are times where I'll swipe abuse like crazy, sometimes piling up tens of swipes for a given message. Since I don't like to bloat up my chat file sizes any more than they often already become, I would usually have to spend time manually deleting swipes one by one (while ensuring I don't accidentally delete the one single swipe I actually DO want to keep), which gets tedious as heck.

This is my attempt at rectifying my own bad habit.

<img width="500" height="110" alt="2026-03-22_17-39" src="https://github.com/user-attachments/assets/e5b53d83-e631-4463-83c7-f029ec9d11c4" />

---

## Features

- **Popup button** - a "Delete All But This Swipe" button is injected directly into ST's native message deletion prompt, appearing alongside the existing "Delete Message", "Delete Swipe", and "Cancel" options. It is only shown when a message has more than one swipe.
- **`/keepswipe`** - performs the same action from the STscript pipeline, targeting the most recent AI message. Returns the zero-based message ID on success.
- **`/cleanallswipes`** - cleans up all unused swipes in previous messages across entire chat history.

---

## Installation

**Recommended — via SillyTavern's built-in extension installer:**

1. Open SillyTavern and navigate to **Extensions → Manage Extensions → Install Extension**.
2. Paste the URL of this repository and confirm.
3. Reload the page if prompted.

**Manual:**

1. Clone or download this repository into your ST extensions folder:
   ```
   SillyTavern/public/scripts/extensions/third-party/all-but-this-swipe/
   ```
2. Reload the page.
3. Confirm the extension appears and is enabled under **Extensions → Manage Extensions**.

---

## Usage

### GUI button

1. Hover over any AI message and click the **pencil** (edit) icon.
2. Click the **trashcan** (delete) icon in the submenu that appears.
3. In the deletion prompt, click **"Delete All But This Swipe"**.

> The button only appears when a message has **more than one swipe**. Single-swipe messages are unaffected.

### Slash command

```stscript
/keepswipe
```

Deletes all swipes except the currently displayed one on the **last AI message** in the chat, then saves. Can be used standalone or chained into a larger STscript pipeline.

```stscript
/gen | /keepswipe
```

---

## Compatibility

Requires **SillyTavern `staging` or `release` branch**, reasonably recent (mid-2025 or later). No server plugin or Extras API required.

Thoroughly tested on SillyTavern `1.16.0`.

---

## License

[AGPLv3](https://choosealicense.com/licenses/agpl-3.0/)
