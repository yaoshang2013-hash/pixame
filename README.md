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
Shift, and use the inventory's BLOCKS page and item selector. Their block
placement, crafting and furnace inputs do not consume items; placeable blocks
show an infinity symbol. Ordinary players cannot use the creative BLOCKS page.
The ADMIN panel lists online players,
supports kicking and timed or permanent account bans, and can remove bans.
It can also create rooms or archive empty rooms; restoring an archived room by
its name keeps its seed, world and player saves. At least one room must remain
active.

Flight and inventory are client-controlled and are not anti-cheat protections.
There is currently no health or damage system, so invulnerability has no effect.
These changes must be deployed and the environment variable configured on the
hosting server before they are available there.

## Mobile controls

Touch devices enable MOBILE mode automatically; the button at the top also
switches it manually. Use the left joystick to move and drag the game view to
look around. Hold MINE to break a block, tap PLACE to place or interact, and
use JUMP and SPRINT for movement. Administrators can use DOWN while flying.
In inventory, tap a stack and then a destination to move, swap or stack it.
Tap a filled crafting slot to return its item.

## Camera and keyboard controls

Open SETTINGS to choose first-person, rear third-person or front third-person
view, select the left or right shoulder, and customize the keyboard controls.
In third person, the camera trails above the selected shoulder as the player turns;
the head follows the block under the centered crosshair, which is also used for
mining and placing.
Touch players can switch shoulders with the on-screen button. Press C by default
on a keyboard, or change that binding in SETTINGS.

## Player model

The local and multiplayer avatars use `player.json` and the matching 64×64
`player_texture.png`. Pixame's animation controller blends original poses for
idle, walking, sprinting, jumping, falling, admin flight, mining, underwater
swimming and surface floating, including directional backward and strafe gaits
with counter-swinging limbs for remote players. Landings use a squash, rebound
and recovery sequence, while jumps use a brief anticipation and takeoff extension.
Minecraft-specific
transitions such as standing-to-walking, walking-to-sprinting, falling-to-landing,
and entering or leaving water have dedicated original transition clips.
Minecraft-specific animation expressions in model or resource-pack files are not
evaluated directly. Optional cape and ear parts are not rendered because the skin
does not contain their separate textures.

## Distant terrain

Faraway blocks use the top-left pixel of their side texture as a single color.
Grass retains its biome tint; textures with a transparent corner use their first
visible pixel. Nearby blocks keep their full textures and models.

## Biomes

Chunks are 32×32 blocks. Seeded climate regions cover multiple chunks and have
curved boundaries and mixed transition zones. Regions include birch and dark
forests, mixed woods, cold taiga, alpine meadow, dry scrub and frozen forest,
as well as the existing plains, rainforest, savanna, tundra and desert.
Temperature and humidity tint grass and foliage. Trees have varied shapes and
branches; different species drop and place their own wood and leaves. Existing
`wood` and `leaves` saves remain oak.

Natural underground caves include mossy, icy and glowing mushroom areas.
Frozen regions generate icy caves underneath, and some cave floors contain
small 3–4-block depressions filled with water blocks.
The new world generator changes naturally generated blocks without deleting
player saves or edits.

The biome generator applies to all rooms. Player edits and saves are retained,
but previously generated natural terrain and trees can change under existing
builds when the updated game is deployed. The terrain mixes flat areas,
rounded hills, winding mountain ridges and river valleys.
