# 21st.dev catalog sources

Retrieved with the authenticated official 21st CLI on 2026-11-14. These snapshots contain component source only, never credentials.

- Button: catalog result 3824, author shugar, https://21st.dev/@shugar/components/button-1. Adapted in `src/shared/ui/Button.tsx` for Preact, native form attributes, PaiKan tokens and touch target sizes. Retains variant, shape, size, icon-only, prefix/suffix and loading composition.
- Theme Toggle: catalog result 554, author campsite, https://21st.dev/@campsite/components/theme-toggle. Adapted in `src/shared/ui/ThemeChoice.tsx`: retains Light/Dark/System choices, system preference tracking and selected-state rendering. Uses compact native radio controls in place of Next.js/Radix/Motion and large preview illustrations.

The existing header quick toggle remains available. This is a component-source integration into the Preact app, not a switch to Next.js or an npm UI framework. Original source snapshots are kept for review and attribution.
