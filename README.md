# Pixame

## Google sign-in

The server requires Node.js 22 or newer. Set `GOOGLE_CLIENT_ID` to the Google
Web OAuth client ID to override the project's configured ID. The client ID is
public; do not put a client secret or downloaded credentials file in this
project directory.

Add the deployed site's exact origin to the Google client's authorized
JavaScript origins. Add `http://localhost:3000` separately if testing locally
on that address. While the OAuth app is in testing, add each test account under
Google Auth Platform's Audience page.

Google sign-in creates a separate player account; it does not yet link an
existing account or implement the planned main menu or guest play.

## Rooms

Use the room selector to switch between Lobby 1, 2 and 3. Their terrain seeds,
world edits, furnaces, inventory and player position are independent. Return
items from crafting grids before switching. Room saves are stored under
`save-data/rooms/`; the previous world and player saves are retained separately.

## Distant terrain

Faraway blocks use the top-left pixel of their side texture as a single color.
Grass retains its biome tint; textures with a transparent corner use their first
visible pixel. Nearby blocks keep their full textures and models.
