# Bloo — Forest of Embers

A Mario-style HTML5 side-scroller starring the Blue Spirit Core, in a dark night-forest setting.

Open `index.html` in a browser to play locally, or deploy as a static site (Vercel, Netlify, GitHub Pages, etc.).

## Controls
- Arrow keys / WASD — move
- Space / Up — jump
- Shift — run
- R — restart

## What's in it
- Painted character with idle / run / jump / hurt animation cycles
- Stone-tile platforms with mossy grass tops and hanging vines
- `?` blocks that pop coins out Mario-style (with arc-and-fall physics)
- Breakable bricks that shake when bumped, drop their coins on top
- Spiky pink walkers and floating purple devil enemies
- Pink crystal power-up that makes you bigger
- Magenta swirl portal as the goal
- Parallax night-forest background, ambient sparkles

## Project layout
```
index.html        — the game (also available as game.html)
player.png        — fallback character sprite
sprites/          — painted sprite assets
  character/      — idle, run, jump, attack, hurt frames
  collectibles/   — coins, gem, orb
  effects/        — dust, sparkles, fireball, portal swirl
  props/          — sign, plant, stone arch
  tiles/          — grass blocks, vines, bush
```
