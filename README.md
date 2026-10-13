# Functional Graph Explorer

Visualizes the directed graph of an integer map `(a, b, …) → (A, B, …)` on a finite space: every state has one successor, so each component is a cycle with trees feeding into it.

Enter formulas using `a b c d`, `+ - * ^ mod ( )`, choose the dimension (ℤ to ℤ⁴), the number of digits, and whether negatives are allowed, then press **Submit**. Results wrap to the chosen digit count.

- Hue = length of the cycle a basin drains into; brightness fades with distance from the cycle.
- Layout is planar: cycles on circles, trees on rings around them.
- Spaces over 10,000 states show a 10,000-state sample grown breadth-first from a random cycle; spaces too large to enumerate (over ~16.7M states) show forward orbits only.

## Run

```bash
npm install
npm run dev
```

`npm test` runs the engine tests. Built with React, Vite and Tailwind.
