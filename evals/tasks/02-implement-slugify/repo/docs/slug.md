# slugify(text, maxLength = 40)

Turns a title into a URL slug.

1. Lowercase the text.
2. Remove accents: "Canción Ñandú" becomes "cancion nandu".
3. Every run of characters that are not a-z or 0-9 becomes one "-".
4. No "-" at the start or at the end.
5. At most `maxLength` characters. If cutting leaves a "-" at the end, remove it.
6. An empty result is the empty string.
