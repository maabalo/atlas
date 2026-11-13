# Changelog

Updates to this project, newest first. Older entries come from the Git history (commit hash in brackets).

## 2026-11-13
### Changed
- **The globe is painted on one canvas** instead of ~3,000 SVG dots: turning stays at a steady 60 frames a second on the Project map, and it still draws only when something moves (no spin, nothing running while it sits still). (not pushed yet)
- **Dust coloured by language:** folders grey, files and their code in their language's colour (Python blue, JavaScript yellow, HTML red, CSS purple…), with a key at the top left listing each language and its number of files (folded on phones). Far-side dust is dimmer. (not pushed yet)
- **The burst (from your reference site):** a hot nucleus glows at the centre (white → gold → orange) and a fine curved strand runs from it to every file and folder on the globe, warm amber near the nucleus cooling to pastel blue at the tip; files Claude edited glow brightest and thickest. Strands near the cursor bend aside and ease back, and they grow out from the nucleus once when the map opens (instant with reduce motion). Built in Atlas's own code and colours. (not pushed yet)
- **Plasma removed (your request):** the filaments, free tendrils, bright heart and glass glow are gone; Claude's rays are plain still lavender lines again (brighter = more edits), and the spin repaints 20 times a second again. The core and its glow stay. (not pushed yet)
- **More plasma:** 12 extra free filaments wander slowly round the inside (fainter: they don't mean a file), a bright pink-white heart glows at the centre, filaments shift from pink-violet near the core to blue-violet at the tips and taper toward the glass, each brightens and dims smoothly, and the globe's edge glows faintly violet like a plasma ball's glass. (not pushed yet)
- **Plasma-ball filaments:** the rays are now living filaments like in a plasma ball: three fine strands braided from the core to each file Claude edited, writhing smoothly (slow drifting waves, no flicker), with small curling wisps, a violet haze, a white-hot middle and a breathing glow where each touches its file. They move while the spin is on and freeze when it's off. Replaces the travelling lightning streaks. (not pushed yet)
- **A bigger, brighter core:** Claude's core now fills more than half of the globe's inside (0.55 of its radius, was 0.38), its dust is brighter and a little bigger, and a soft lavender glow surrounds it, so the inside looks lit by it. (not pushed yet)
- **Fine, smooth lightning on the rays:** each flowing pulse is now a thin lightning streak that zigzags around its ray, with a bright tip, a fading tail and sometimes a small fork. The zigzag comes from slowly drifting waves (no random jumps), so the bolts snake and ripple smoothly instead of flickering. (not pushed yet)
- **Light flows along the rays:** fine pulses (two per ray, a bright head with a fading tail, a gentle shimmer) travel from Claude's core out to each file in about 6 seconds, with a soft glimmer as they arrive. Runs with the spin; to keep it smooth the map now repaints 30 times a second while spinning (was 20), and still not at all with the spin off (S). (not pushed yet)
- **The moon is now Claude's core, with rays (your idea):** Claude's folder sits at the centre of the globe as a smaller, dimmer dust ball, seen through the globe and turning the other way (no orbit any more, so the globe gets the whole window again). Lavender rays run from it to every file Claude has edited or created, brighter with more edits, read from Claude Code's session logs at build time (`--claude-log`; only tool names and file paths are read; 13 globe files right now). Hover cards say "Claude: edited 60×"; the colour key adds "Claude edited"; in the web view the rays start at the `.claude` dot. New tests for reading the logs. (not pushed yet)
- **One panel, on the right:** search and the folders moved from the left pane into the right panel (search, folders, numbers, health, in that order); the left pane and its button are gone. The panel button (top right, now a panel icon) or `/` opens it. Help text updated (folders were still called grey). (not pushed yet)
- **Quality pass (rating 7.3 → aim 8.5+):** (not pushed yet)
  - Fixed: a stray `}` in style.css that could make browsers skip the reduced-motion rule; lint now clean (html-validate, stylelint, eslint, prettier).
  - Changed: the viewer's pure parts moved to `viewer/core.js`, with 11 Node tests (`node --test tests/core.test.js`); `app.js` uses them.
  - Security: every map now has a Content-Security-Policy that only allows its own inline scripts and styles (by hash) and Google Fonts; tested.
  - Changed: the `.claude` moon leaves out saved conversations, file history, caches, session files and backups (`--satellite-skip`); memory notes and skills stay. Tested.
  - Accessibility: picking from search, the folder list or health shows the speck's card once it's in view and speaks its facts; the skip link now goes to the map (the search it pointed to is hidden at first).
  - Fixed: phones: the top bar fits (brand and project name hidden under 480px, smaller buttons under 360px); the moon's orbit stays on screen when the phone is upright.
  - Changed: clearer spin icon and labels; leftovers removed (unused link weights; the web physics reuses its arrays).
- **Web labels removed:** the web no longer names specks by itself; names still appear after you click or pick something, and pointing at a speck shows its card. (not pushed yet)
- **The web is dust now:** fine specks instead of round dots (capped on screen, so they stay dust when you zoom in), each a slightly different brightness; faint threads instead of lines; fewer names; and every code part floats as dust in a small cloud round its own file. (not pushed yet)
- **Web view (graphify-style):** a **globe | web** switch in the top bar (or **V**) shows the folders and files as a flat web: lines from each folder to what's inside it and between files that load, import, call or use each other, dots coloured by language and bigger with more links. A small physics simulation settles it (about 7 s on the Project map), then it stops drawing; drag empty space to move, drag a dot to pull it. Clicking, hover, search, picks and both panels work in it; code parts stay on the globe. The chosen view is remembered. Built in Atlas, no libraries or graphify code. (not pushed yet)
- **Lightning removed** (your request): no more bolts from the moon; the spin and the moon's orbit stay. (not pushed yet)
- **More lightning, all the time:** there are now always 4 to 8 bolts striking at once (a new one every 0.06–0.25 s), and each stays bright longer before it fades; still 20 repaints a second, and the spin button (or S) still stops it. (not pushed yet)
- **Lightning from the moon:** every 2½–6 seconds a jagged, glowing pastel-lavender bolt (with a fork or two) strikes from the moon's edge to a speck on the side of the globe facing it, with a flash where it lands; it flickers and fades in about half a second. Behind the globe it's half hidden. It runs with the spin, so the spin button (or S) stops it too; no extra repaints. Decorative only: the speck it hits is random. (not pushed yet)
- **Pastel dust:** every language now has its own soft pastel (pastel blue Python, butter-yellow JavaScript, peach HTML, lavender CSS, mint Markdown, gold JSON, off-white folders…), replacing the all-mint look. (not pushed yet)
- **Moon label removed:** the `.claude` name under the moon is gone (pointing at its dust still names each item). (not pushed yet)
- **The moon looked off — fixed:** it now circles the globe's equator (slightly tilted) and starts on its right, instead of swinging mostly toward and away from you; when it's behind the globe it's drawn first, dimmer and partly hidden by the globe; the view has gentler perspective (camera further back), so the moon stays round near the edges; the orbit is a bit closer (1.6× the globe's radius) and its name sits under it on screen. (not pushed yet)
- **Slow spin is back (your request):** the globe turns on its own axis at 0.01 radians a second (about once in 10½ minutes) and the moon circles at 0.05 (about once in 2 minutes). A spin button in the top bar (or **S**) stops and starts both, remembered; off at first with "reduce motion". It repaints 20 times a second and pauses while you drag. (not pushed yet)
- **Link lines removed again:** no arcs or moving lights; links still light up what's connected when you click or pick something. The lights button became the spin button. (not pushed yet)
- **Mint dust:** every language now has a mint shade (pale mint folders, bright mint Python, teal TypeScript, pale lime JavaScript…). (not pushed yet)
- **A moon for Claude's folder:** the Mac app adds `~/.claude` to the Project map as a small globe circling the main one (`atlas.py build … --satellite FOLDER`). It has its own grid, dust and links, circles once every 4 minutes while the moving lights are on (still when they're off), and is labelled `.claude`. Only file names and code from Python/JavaScript/HTML/CSS files go into the map; maps stay in `~/Library/Application Support/Atlas/maps/`. New test for it. (not pushed yet)
- **Numbers are clickable too:** click folders, files, functions, classes, html ids or css classes in the right panel to light up those items, whatever declares or uses them, and their links; the globe turns toward them. (not pushed yet)
- **Picked items appear by name** on the globe (languages: their files; kinds: each item), nearest first and only where names don't overlap (up to 80 at once); turn or zoom to see more. (not pushed yet)
- **Click a language in the colour key** to see where it's used: its files, their links (white) and the files at the other end stay bright, everything else fades, and the globe turns toward them. Click it again or press Esc to clear. (not pushed yet)
- **Links are back, with moving lights** (your choice): mint arcs between files that load, import, call or use each other, each carrying a slow light that ends in a spreading ring. Selecting something turns its own links white and fades the rest. A new top-bar button (or **L**) turns the lights off, remembered; off at first with "reduce motion". The lights repaint 20 times a second (dragging stays at 60), and nothing repaints when they're off. (not pushed yet)
- **Finer, smoother globe:** full Retina sharpness, grid circles drawn with about twice as many pieces (round even when zoomed in), finer grid lines, and the north–south lines stop just short of the poles, so 100 of them no longer knot into a dense patch there. Turning stays at 60 frames a second. (not pushed yet)
- **Health moved to the right panel**, under the numbers (the left panel now holds folders and search only). The buttons are now called "Folders and search" and "Numbers and health". (not pushed yet)
- **Pointing at a speck** rings it and shows a small card: name, language, and how many files, code parts or links it has (plus "possibly unused" when a health check flagged it). (not pushed yet)
### Fixed
- Phones: with both panels closed, the globe now fills the screen (there was an empty band under it), and the hint at the bottom no longer runs under the zoom buttons. (not pushed yet)
### Removed
- The unused 2D drawing code. (not pushed yet)

## 2026-11-12
### Changed
- New look: a **globe** with a faint 100 × 100 grid replaces the galaxy. Every folder, file (images, docs and data too) and piece of code is a speck of dust on the grid, in folder order; plain lines join a folder to what's inside it and a file to the files it loads or imports. (not pushed yet)
- Selecting something names at most 12 of its neighbours (arc neighbours first), so names no longer pile up; the rest are still highlighted. (not pushed yet)
- **Both side panels hidden at first:** the globe fills the window; the button at the top left shows the folders, search and health panel, and **#** shows the numbers panel. Pressing / opens the left panel for searching. A button stays highlighted while its panel is open. (not pushed yet)
- **Smooth turning:** picking a folder, file or search result (or pressing Fit) now glides the globe round to it instead of snapping; the selection fade is instant, which keeps the glide smooth. Instant when "reduce motion" is on. (not pushed yet)
- **Folder list instead of filters:** the sidebar's islands and "show" panels are gone; it now lists every folder, **closed until you click it** to show the files inside, and clicking one turns the globe to it. Every type is always shown; the labels, community colours and inferred-links switches are gone. (not pushed yet)
- **Smooth zoom:** scrolling and the + / − buttons ease into the new zoom instead of jumping, keeping the point under the pointer still (instant when the Mac's "reduce motion" is on). (not pushed yet)
- Dust is **smaller and scattered** (not on the grid lines). Each folder is still **surrounded by its own files**: subfolders get their own space just outside, so their files ring them too. A click picks the nearest speck within a few pixels. (not pushed yet)
- **No link lines** on the globe any more, and the "links" legend is gone from the sidebar (user's request): the rings around each folder show what's inside it, and selecting a speck still highlights everything it's linked to. (not pushed yet)
- **Folders are surrounded by their files** (and subfolders), in rings on the grid, and each file by its code; each project starts from its own spot. (not pushed yet)
- The globe **always turns around its own centre**: selecting something turns it to face you, and Shift-drag slides it across the screen. (not pushed yet)
- The right panel now shows **numbers only** (folders, files, code, lines, links) and is **hidden at first**: the new **#** button in the top bar shows or hides it. The selected item's link lists, hubs and communities lists are gone from it. (not pushed yet)
- Maps now include **folders** and **every file**, linked by "contains"; code paths, hubs and communities ignore those folder links. The 2D/3D button is gone (the globe is always 3D). (not pushed yet)
- The map now opens with everything shown: html ids and css classes are on by default. Labels stay off until ticked. (not pushed yet)
- Faster spinning with everything shown: each star's glow is a soft circle instead of a blur filter, and the faint links from html ids and css classes appear only when you select one (they still shape the layout). (not pushed yet)
### Removed
- The galaxy no longer turns by itself; it moves only when you drag it, so the computer stays cool. (not pushed yet)
### Notes
- Added CLAUDE.md: notes for Claude on how this project works, its rules and open items. (not pushed yet)
- Started this changelog; from now on every update adds an entry here. (not pushed yet)

## 2026-11-08
### Changed
- Viewer: slow idle spin and web design audit fixes (19569ca)
- Mac app, Islands panel, and a free-spinning spiral galaxy view (66b7ec6)
- Combined maps, 3D galaxy view, communities and an MCP server (a806f45)

## 2026-11-05
### Changed
- Library classes: also match names without dashes (84d8df4)
- Skip classes that belong to external libraries (0458805)
### Fixed
- Fix false "missing id" reports (8c7db6d)

## 2026-11-04
### Added
- Add MIT license (5a24152)
### Changed
- Atlas: a map of your code (80e96e2)
