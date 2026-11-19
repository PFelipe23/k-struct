"""Independent reference for the planar portal. Run with Python + NumPy.

Direct stiffness, one exact Euler–Bernoulli member per bar, global X/Z
translations and counterclockwise rotation in the XZ drawing. KStruct's
positive MY is opposite to that counterclockwise rotation.
"""
from pathlib import Path
import json

import numpy as np


data = json.loads(Path(__file__).with_name("portal-planar.json").read_text())
nodes = np.array(data["nodes"])
elasticity = data["e"]
stiffness = np.zeros((nodes.size * 3 // 2,) * 2)
forces = np.zeros(stiffness.shape[0])
member_loads = {member: np.array([qx, qz]) for member, qx, qz in data["uniform"]}
elements = []
for index, (a, b, section_index) in enumerate(data["members"]):
    length = np.linalg.norm(nodes[b] - nodes[a])
    c, s = (nodes[b] - nodes[a]) / length
    transform = np.kron(np.eye(2), [[c, s, 0], [-s, c, 0], [0, 0, 1]])
    width, height = data["sections"][section_index]
    area = width * height
    inertia = width * height**3 / 12
    local = np.zeros((6, 6))
    axial = [0, 3]
    bending = [1, 2, 4, 5]
    local[np.ix_(axial, axial)] = elasticity * area / length * np.array([[1, -1], [-1, 1]])
    local[np.ix_(bending, bending)] = elasticity * inertia / length**3 * np.array([
        [12, 6*length, -12, 6*length],
        [6*length, 4*length**2, -6*length, 2*length**2],
        [-12, -6*length, 12, -6*length],
        [6*length, 2*length**2, -6*length, 4*length**2],
    ])
    qu, qw = transform[:2, :2] @ member_loads.get(index, [0, 0])
    equivalent = length / 2 * np.array([qu, qw, qw*length/6, qu, qw, -qw*length/6])
    indices = [3*a, 3*a+1, 3*a+2, 3*b, 3*b+1, 3*b+2]
    stiffness[np.ix_(indices, indices)] += transform.T @ local @ transform
    forces[indices] += transform.T @ equivalent
    elements.append((indices, local, transform, equivalent))

for node, fx, fz, my in data["nodal"]:
    forces[3*node:3*node+3] += [fx, fz, -my]
fixed = [3*node+dof for node in data["fixed"] for dof in range(3)]
free = np.setdiff1d(np.arange(len(forces)), fixed)
displacements = np.zeros_like(forces)
displacements[free] = np.linalg.solve(stiffness[np.ix_(free, free)], forces[free])
reactions = stiffness @ displacements - forces
local_axes = np.array([1, 1, -1])
ends, local, transform, equivalent = elements[-1]
end_forces = local @ transform @ displacements[ends] - equivalent
reference = {
    "reactions": [(values * local_axes).tolist() for values in reactions.reshape(-1, 3)[data["fixed"]]],
    "roofDisplacements": [(values * local_axes).tolist() for values in displacements.reshape(-1, 3)[-2:]],
    "roofBeamEndMoments": [-float(end_forces[2]), float(end_forces[5])],
}
print(json.dumps(reference, indent=2))
