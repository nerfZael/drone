# shape

A full-screen Expo and React Native shader study. It renders a rotatable 3D solid that can morph into a softly moving blob.

The main form periodically buds smaller droplets that travel into bottom lanes, harden into triangular prisms, and continue spinning independently.

## Run it

From the repository root:

```sh
bun install
bun run --filter shape start
```

Then open the project in Expo Go, or press `a` in the Expo terminal to launch Android.

To render the interaction demo video:

```sh
bun run --filter shape video
```

## Interaction

- Tap anywhere to toggle between the current solid and the blob.
- Double-tap to cycle through tetrahedron, cube, octahedron, dodecahedron, icosahedron, triangular prism, hexagonal prism, and torus.
- Drag to rotate the form in 3D.
- A new tap reverses the active transition from its current progress, so rapid taps do not queue or snap.
- The ambient animation follows the device's reduced-motion preference.
