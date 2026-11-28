"""Referência independente do pórtico KS-61. Execute com Python 3 e NumPy."""

import numpy as np


def portal(segments, compression):
    """UX no topo de pórtico 4 m × 3 m, dois engastes e 10 kN por topo."""
    points = [(0, 0), (0, 3), (4, 0), (4, 3)]
    members = [(0, 1, compression), (2, 3, compression), (1, 3, 0)]
    size = 3 * (4 + len(members) * (segments - 1))
    stiffness = np.zeros((size, size))
    elastic_modulus = 200e9
    area = 0.4**2
    inertia = 0.4**4 / 12
    next_node = 4
    axial = [0, 3]
    bending = [1, 2, 4, 5]
    for start, end, load in members:
        dx, dz = np.subtract(points[end], points[start])
        span = np.hypot(dx, dz)
        h = span / segments
        rotation = np.array([[dx / span, dz / span, 0],
                             [-dz / span, dx / span, 0],
                             [0, 0, 1]])
        transform = np.kron(np.eye(2), rotation)
        local = np.zeros((6, 6))
        local[np.ix_(axial, axial)] = elastic_modulus * area / h * np.array(
            [[1, -1], [-1, 1]]
        )
        elastic = elastic_modulus * inertia / h**3 * np.array([
            [12, 6*h, -12, 6*h],
            [6*h, 4*h*h, -6*h, 2*h*h],
            [-12, -6*h, 12, -6*h],
            [6*h, 2*h*h, -6*h, 4*h*h],
        ])
        # Matriz geométrica consistente: integral das derivadas dos polinômios de Hermite.
        geometric = -load / (30*h) * np.array([
            [36, 3*h, -36, 3*h],
            [3*h, 4*h*h, -3*h, -h*h],
            [-36, -3*h, 36, -3*h],
            [3*h, -h*h, -3*h, 4*h*h],
        ])
        local[np.ix_(bending, bending)] = elastic + geometric
        element = transform.T @ local @ transform
        chain = [start, *range(next_node, next_node + segments - 1), end]
        next_node += segments - 1
        for a, b in zip(chain, chain[1:]):
            dofs = [3*node + dof for node in (a, b) for dof in range(3)]
            stiffness[np.ix_(dofs, dofs)] += element
    free = np.r_[3:6, 9:size]
    forces = np.zeros(size)
    forces[[3, 9]] = 10_000
    return np.linalg.solve(stiffness[np.ix_(free, free)], forces[free])[0]


if __name__ == "__main__":
    for segments in (8, 32, 64):
        print(f"{segments:2d} elementos por barra: "
              f"linear = {1000*portal(segments, 0):.9f} mm, "
              f"P–Δ = {1000*portal(segments, 600_000):.9f} mm")
