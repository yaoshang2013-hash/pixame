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

Use the room selector to switch between available rooms. Their terrain seeds,
world edits, furnaces, inventory and player position are independent. Return
items from crafting grids before switching. Room saves are stored under
`save-data/rooms/`; the previous world and player saves are retained separately.

## Administrator

Set `PIXAME_ADMIN_GOOGLE_EMAIL` in the server's environment to the Google
account's email address. Only a Google-verified matching account receives
administrator access; an empty setting disables it. Sign in with Google after
changing this setting. Never put credentials or a client secret in the project
directory.

Administrators can toggle flight with F, ascend with Space and descend with
Shift, and use the inventory's item selector. Their block placement, crafting
and furnace inputs do not consume items. The ADMIN panel lists online players,
supports kicking and timed or permanent account bans, and can remove bans.
It can also create rooms or archive empty rooms; restoring an archived room by
its name keeps its seed, world and player saves. At least one room must remain
active.

Flight and inventory are client-controlled and are not anti-cheat protections.
There is currently no health or damage system, so invulnerability has no effect.
These changes must be deployed and the environment variable configured on the
hosting server before they are available there.

## Distant terrain

Faraway blocks use the top-left pixel of their side texture as a single color.
Grass retains its biome tint; textures with a transparent corner use their first
visible pixel. Nearby blocks keep their full textures and models.

## Biomes

Chunks are 32×32 blocks. Each seeded climate region covers 4×4 chunks, with
local rivers and mountains. Regions include plains, meadow, forest, taiga,
rainforest, savanna, tundra, cherry grove, snow and desert. Temperature and
humidity tint grass and foliage, and tree shapes and textures vary by region.
Naturally generated tree blocks currently drop the existing generic wood and
leaves items.

The biome generator applies to all rooms. Player edits and saves are retained,
but previously generated natural terrain and trees can change under existing
builds when the updated game is deployed.
