// Fictional example project: grid convergence of an explicit finite-difference solver for the 1D heat equation
//   u_t = u_xx on [0, pi], u(0,t) = u(pi,t) = 0, u(x,0) = sin(x); exact solution u = exp(-t) sin(x).
// Run: node workspace/projects/example-project/analysis/convergence.mjs
// Writes data/processed/convergence.csv (N, h, dt, r, max_error) and prints the observed order between successive grids.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const T = 0.1, r = 0.4; // r = dt / h^2 must stay <= 0.5 for the explicit scheme
function solve(N, ratio) {
  const h = Math.PI / N, steps = Math.ceil(T / (ratio * h * h)), dt = T / steps;
  const lambda = dt / (h * h);
  let u = Array.from({ length: N + 1 }, (_, i) => Math.sin(i * h));
  for (let s = 0; s < steps; s++) {
    const next = u.slice();
    for (let i = 1; i < N; i++) next[i] = u[i] + lambda * (u[i - 1] - 2 * u[i] + u[i + 1]);
    u = next;
  }
  const error = Math.max(...u.map((v, i) => Math.abs(v - Math.exp(-T) * Math.sin(i * h))));
  return { N, h, dt, lambda, error, max: Math.max(...u.map(Math.abs)) };
}

const rows = [8, 16, 32, 64].map(N => solve(N, r));
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/processed/convergence.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, 'N,h,dt,r,max_error\n' + rows.map(x => [x.N, x.h.toFixed(6), x.dt.toExponential(3), x.lambda.toFixed(3), x.error.toExponential(3)].join(',')).join('\n') + '\n');
rows.slice(1).forEach((x, i) => console.log(`N ${rows[i].N} -> ${x.N}: observed order ${(Math.log(rows[i].error / x.error) / Math.log(2)).toFixed(2)}`));
