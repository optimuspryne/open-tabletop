# Built-in sound effects

Drop clips here with these names (or edit the SOUNDS map in `public/audio.js`).
`.ogg`, `.mp3`, or `.wav` all decode; missing files are skipped silently.

`*-drop` clips fire on the real **physics impact** — the moment the piece lands
on the table — not the instant you let go, and everyone at the table hears the
landing. `*-pickup` clips are local (only you hear yourself grab something).

**Multiple clips per sound (variety):** each action can hold several files — one is
picked at random each time it plays. List them in the `SOUNDS` map in
`public/audio.js`, e.g. `'die-roll': ['die-roll-1.ogg', 'die-roll-2.ogg']`. Name the
files however you like; only the array in `audio.js` decides what's used. The table
below is just the default single-file names.

| file              | played when                                                         | who hears it |
|-------------------|---------------------------------------------------------------------|--------------|
| die-roll.ogg      | one die rolls (right-click a die, or Roll with a single die)         | everyone     |
| dice-roll.ogg     | multiple dice roll (Roll button)                                    | everyone     |
| card-flip.ogg     | a card is flipped                                                   | everyone     |
| card-pickup.ogg   | you grab a card, deal-drag one off a deck, or take one to your hand  | you          |
| card-drop.ogg     | a dealt/played card lands, or a card you dropped hits the table      | everyone     |
| shuffle.ogg       | a deck is shuffled                                                  | everyone     |
| die-pickup.ogg    | you grab a die                                                      | you          |
| die-drop.ogg      | a die you dropped hits the table                                    | everyone     |
| deck-pickup.ogg   | you grab a deck                                                     | you          |
| deck-drop.ogg     | a deck you dropped hits the table                                   | everyone     |
| object-pickup.ogg | you grab a prop or board                                            | you          |
| object-drop.ogg   | a prop or board you dropped hits the table                          | everyone     |
| hand-drop.ogg     | you dump your whole hand to the table                               | everyone     |

Source SFX from CC0 libraries (freesound.org CC0 filter, kenney.nl) so they carry
no attribution burden. The Kenney "Casino" pack covers cards + dice nicely.
