"""Clamped 6 × 3 m Kirchhoff plate under -5 kPa. Run with Python and NumPy."""

import numpy as np
from numpy.polynomial import Legendre
from numpy.polynomial.legendre import leggauss

LX, LY, H, E, NU, PRESSURE = 6.0, 3.0, 0.12, 30e9, 0.2, -5000.0


def reference(count, degrees):
    # (1 - t²)² enforces both w = 0 and dw/dn = 0 at t = ±1.
    points, weights = leggauss(count + 5)
    bubble = (Legendre([1]) - Legendre([0, 1]) ** 2) ** 2
    basis = [bubble * Legendre.basis(i) for i in range(count)]

    def evaluate(t, span, order):
        return np.array([p.deriv(order)(t) * (2 / span) ** order for p in basis])

    def product(x, y):
        return np.einsum("ip,jq->pqij", x, y).reshape(x.shape[1] * y.shape[1], -1)

    c, s = np.cos(np.deg2rad(degrees)), np.sin(np.deg2rad(degrees))
    strain = np.array([
        [c * c, s * s, c * s],
        [s * s, c * c, -c * s],
        [-2 * c * s, 2 * c * s, c * c - s * s],
    ])
    # Congruence scales the two directional bending rigidities by 4 and 1.
    d = E * H**3 / (12 * (1 - NU**2))
    principal = d * np.array([[4, 2 * NU, 0], [2 * NU, 1, 0], [0, 0, (1 - NU) / 2]])
    flex = strain.T @ principal @ strain

    def fields(t):
        x, dx, dxx = [evaluate(t, LX, k) for k in range(3)]
        y, dy, dyy = [evaluate(t, LY, k) for k in range(3)]
        curvatures = [product(dxx, y), product(x, dyy), 2 * product(dx, dy)]
        return product(x, y), np.stack(curvatures, axis=1)

    disp, curv = fields(points)
    w = np.outer(weights, weights).ravel() * LX * LY / 4
    stiffness = np.einsum("pai,ab,pbj,p->ij", curv, flex, curv, w, optimize=True)
    coeff = np.linalg.solve(stiffness, PRESSURE * (w @ disp))
    center, curvature = fields(np.array([0.0]))
    moments = -flex @ (curvature[0] @ coeff)
    return (center @ coeff).item() * 1000, *(moments / 1000)


if __name__ == "__main__":
    print("terms/axis, degrees, center U3 [mm], geometric Mx, My, Mxy [kN m/m]")
    for count in (6, 8, 10, 12):
        for angle in (0, 45, 90):
            print(count, angle, *(f"{v:.8f}" for v in reference(count, angle)))
