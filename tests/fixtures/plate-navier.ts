import { plateBenchmark } from "./plate-benchmark";

export function navierPlateCenter(oddTerms = 256) {
  const { lengthX, lengthY, thickness, modulus, poisson, pressureZ } =
    plateBenchmark;
  const rigidity = (modulus * thickness ** 3) / (12 * (1 - poisson ** 2));
  let uz = 0;
  let mx = 0;
  let my = 0;

  for (let m = 1; m < 2 * oddTerms; m += 2) {
    const alpha2 = ((m * Math.PI) / lengthX) ** 2;
    for (let n = 1; n < 2 * oddTerms; n += 2) {
      const beta2 = ((n * Math.PI) / lengthY) ** 2;
      const pressure = (16 * pressureZ) / (Math.PI ** 2 * m * n);
      // Produto sin(mπ/2) sin(nπ/2) no centro da placa.
      const centerSign = (m + n) % 4 === 2 ? 1 : -1;
      const deflection =
        (centerSign * pressure) / (rigidity * (alpha2 + beta2) ** 2);
      uz += deflection;
      mx -= rigidity * (alpha2 + poisson * beta2) * deflection;
      my -= rigidity * (beta2 + poisson * alpha2) * deflection;
    }
  }
  return { uz, mx, my };
}
