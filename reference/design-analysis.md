# softie — image-to-code analysis

Source: `/Users/delroy/Documents/Model PK/softie-webgpu/reference/target.png` (1536 × 1024), inspected before implementation.

## Visual extraction
- One full-viewport, open composition; background warm off-white `#f5f5f3`, near-black `#171817` type, muted gray `#777975`. No cards, navigation chrome, or visible 3D stage enclosure.
- Top-left small hand-authored outline jelly logo and lowercase **softie**, approximately x 52, y 35. Top-right understated **A LITTLE ROOM TO PLAY**, baseline near y 61.
- Hero copy: **软乎乎。** in heavy Chinese sans serif, one line, approximately 108 px. Supporting sentence **捏一捏，把今天放轻松。** is gray, approximately 24 px. Left gutter about 3.4% of the viewport.
- One large rose-pink translucent slime occupies the center-left, approximately x 285–960 and y 308–813. Eyes and mouth are tiny relative to the body, black and glossy. Numerous small irregular bubbles, large soft studio reflections, diffuse rose contact shadow. The 3D implementation owns these forms; the image is a reference, never a substituted canvas background.
- Right unboxed controls start at x 1142 (74.4%). A hairline vertical divider separates them from the playground. Inner padding ~42 px. Heading **随你揉捏** with pale **MAKE IT YOURS** below. Available control width about 290 px.
- Color label, three circular pink/mint/lavender swatches with selected pink outline ring, selected caption **草莓软糖**. Color accent follows selection.
- Two quiet line sliders: **软硬** (35) / **阻尼** (45). Values right aligned, black circular thumb, dark filled line, light remaining line. Captions **糯叽叽 / 有弹性** and **晃悠悠 / 很乖巧**.
- Main CTA is a 52 px high near-black pill, white **戳一下**. Secondary **恢复默认** is an unboxed gray text control.
- Bottom left WebGPU indicator; center **按住揉捏 · 拖动拎起 · 松手回弹**; bottom right **慢一点，也没关系。**. Runtime FPS is added beside WebGPU only when measured; no fixed/fake performance value.

## Implementation geometry
- Desktop ≥ 900 px: 100svh canvas composition, 680 px minimum document height. Stage at x 14%–72%, y 27%–89%; controls at x 74.4%–96.6%, y 25.5%.
- Header and intro share 3.4vw page gutter; hero headline uses a bounded 80–112 px scale, not unrestricted viewport typography.
- Mobile < 900 px: single-column document, header → short hero copy → full-width stage → unboxed settings → footer. Horizontal controls are not squeezed beside the 3D subject. Safe-area insets included.
- Controls expose native keyboard ranges, 48–52 px swatch targets, 52 px primary button, 44 px reset. Visible focus rings and selected swatch text supplement color.

## State inventory
- Pending native WebGPU: lightweight loading text within stage, real pending status, settings disabled until renderer reports ready.
- Ready: all settings enabled, measured FPS updated from renderer, pointer interaction cursor reflects grabbing.
- Error/device loss: explicit native-WebGPU error message, cleared pending state, settings disabled, FPS cleared. No WebGL fallback.
- Reset: color, stiffness, damping labels and values return to actual simulation defaults.
- No pause/win/lose states apply to this open-ended tactile toy.

## Reference ledger
| Loaded | Reference | Failure reason |
| --- | --- | --- |
| Yes | `/Users/delroy/.agents/skills/image-to-code/SKILL.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/SKILL.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/references/ui-patterns.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/references/checklists/game-ui-quality.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/references/checklists/hud-readability.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/references/checklists/responsive-ui-fit.md` | — |
| Yes | `/Users/delroy/.agents/skills/threejs-game-ui-designer/references/checklists/mobile-input.md` | — |
| Yes | `/Users/delroy/.agents/skills/better-icons/SKILL.md` | — |

The logo is a simple original outline wordmark. Better Icons retrieval was attempted for a decorative sparkle, but the CLI network request failed; the purely decorative sparkle is represented by a text glyph rather than introducing an icon dependency.
