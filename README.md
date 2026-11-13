# Pocket Tanks Party — v0.6

A browser-based, turn-based artillery party game for 2–8 players. Players create a private six-character room code, join an open lobby from the room browser, or enter a code directly. The Node.js server is authoritative for player sessions, turns, movement, projectile simulation, damage, scoring, terrain changes, and match completion.

## What is included

- **Classic turn-based multiplayer:** each living player aims and fires once on their turn. Matches run for up to eight rounds or end early when only one tank remains.
- **Create or join rooms:** create a room, pick an elemental faction, share the six-character code, browse public open lobbies, or enter a code manually. Any player can enter the arena independently by pressing START THE MATCH.
- **Ready-to-play flow:** the first player to press START THE MATCH enters the battlefield and sees an animated waiting-for-crew banner. Other players stay in the room lobby until they also press START THE MATCH. The match begins automatically when two connected players are ready. The room creator can reopen a finished room; all players then ready up again. There is no RETURN TO MATCH button.
- **Tank movement:** move up to three short steps per turn with the on-screen arrows or keyboard ← / → and A / D. Movement is optional and does not consume the shot. Other tanks and battlefield edges block movement.
- **Aiming controls:** finger-friendly cannon-angle and firing-power sliders with large glossy thumbs, live value readouts, keyboard support, and a dotted trajectory preview. Slider changes are committed to the server when adjusted and included with the firing action.
- **Six-step first-play tutorial:** explains the objective, turn order, aiming, movement, weapons, and scoring. It can be reopened from the header.
- **Ten weapons:** Standard Shell, Heavy Bomb, Cluster, Napalm, Dirt Mover, Rocket, plus one signature weapon for each element.
- **Elemental signature weapons:** Water — Tidal Surge (washes/erodes the ground); Earth — Seismic Fissure (cuts a line of linked ruptures); Fire — Solar Flare (scorches the ground and leaves a burn zone); Air — Cyclone (raises terrain and pushes surviving tanks). Signature weapons are element-locked and validated by the server.
- **Changing battlefield:** the server saves the deformed terrain after each impact; the client interpolates between the old and new landscape so craters, ridges, fissures, and washed basins animate into place.
- **Distinct weapon effects:** each weapon has its own projectile trail and impact animation. A final hit completes its impact animation first, then plays a tank break-apart animation before the results screen appears.
- **New-room invitations:** when an open room appears or a finished room is reopened, other connected players see its JOIN button pulse with a NEW indicator for 12 seconds.
- **Waiting animation:** a player who presses START THE MATCH enters the battlefield and waits there for another player. Reopening a completed match returns everyone to a fresh joinable lobby.
- **Available weapons only:** the arsenal hides signature weapons that do not belong to the current player's element. Shared weapons remain available to everyone.
- **Surrender:** players can surrender from the match or room view. A confirmation dialog asks before the tank is retired; the player's current score is retained.
- **Elemental tank hit reactions:** Fire sets damaged tanks aflame for 2.6 seconds; Water surrounds a hit tank with a splash/bubble effect for 2.6 seconds; Earth adds 6 impact damage, applies a temporary stone shell, and leaves persistent armor cracks; Air spins hit tanks 2.6 turns, pushes surviving tanks, and resets their angle, power, and weapon selection.
- **Original elemental crests:** four SVG emblems inspired by the supplied reference's visual language (water medallion, earth shield/mountain, flame, and triple spiral) appear in the element picker, player roster, and on each tank. The icons are original vector artwork.
- **Original elemental art direction:** saturated Water blue, Earth green, Fire coral/red, and Air gold, with original geometric emblems and original tank/battlefield artwork. No show characters, logos, or artwork are included.

## Controls and room flow

- Create a room to enter its lobby immediately. The animated waiting card indicates that the room is open until other players join.
- Other connected browsers see newly opened rooms in the lobby list with an animated NEW · JOIN prompt.
- In the lobby, every player can press START THE MATCH. That player enters the battlefield waiting screen; when a second connected player presses START THE MATCH, the match begins for everyone.
- After a match, use BACK TO ROOM on the results card. The room creator can choose REOPEN ROOM, after which players ready up with START THE MATCH again.
- Surrender from the match top bar; confirm in the popup to retire your tank.

## Element reactions

- **Water / Tidal Surge:** hit tanks are wrapped in a blue water dome and ripples for about 2.6 seconds.
- **Earth / Seismic Fissure:** hit tanks take 6 additional damage, show a rocky armor coat briefly, and retain visible armor cracks.
- **Fire / Solar Flare:** hit tanks burn for about 2.6 seconds; the attack also leaves a short-lived ground fire zone.
- **Air / Cyclone:** hit tanks spin about 2.6 rotations, surviving targets are pushed away, and their aim resets to 42° / 62% / Standard.

## Rules and scoring

- 2–8 players, free-for-all; each tank starts with 100 HP.
- One shot per living player per turn; each turn also allows up to three movement steps.
- Up to eight rounds; the game ends early when one tank remains.
- +1 point per point of opponent damage, +10 for a direct hit, +20 for an elimination, and −1 per point of self-inflicted damage.
- If the match reaches the round limit, highest score wins; opponent damage dealt and remaining HP break ties, in that order.

## Run locally

Requirements: Node.js 18 or newer. No third-party npm packages are required.

```bash
npm start
```

Open `http://localhost:3000` on the host computer. Other devices on the same Wi-Fi can open `http://<host-computer-lan-ip>:3000` and enter the room code. Allow inbound connections on port 3000 in the host computer firewall. On Windows, `start-windows.bat` starts the server.

## Play over the internet

Deploy this folder to a Node.js host that supports long-lived WebSocket connections. Set `PORT` if required and share the hosted HTTPS address. The client automatically uses secure WebSockets (`wss://`) when served over HTTPS.

## Prototype limitations

Room state is held in server memory. A player can resume the same room/player session after a browser refresh or temporary disconnect **while the server process is still running**. Restarting or redeploying the server clears active rooms. Open-room browsing lists waiting lobbies only. Before a public launch, add persistent room storage, room expiry, rate limiting, stronger reconnect/session tokens, and deployment-level security.


## Creator

Created by **Yaroslav Vorozhbyt**. Connect on [LinkedIn](https://www.linkedin.com/in/yaroslav-vorozhbyt-7a52aa85/).
