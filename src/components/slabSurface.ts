import {
  ExtrudeGeometry,
  Mesh,
  Path,
  Shape,
  Vector2,
  type Material,
} from "three";
import type { Slab } from "../domain/model";
import { slabRings } from "../domain/slabPolygon";

export function slabSurface(slab: Slab, z: number, material: Material) {
  const contours = slabRings(slab);
  const anchor = contours[0][0];
  const paths = contours.map((ring) =>
    ring.map((p) => new Vector2(p.x - anchor.x, p.y - anchor.y)),
  );
  const shape = new Shape(paths[0]);
  shape.holes = paths.slice(1).map((path) => new Path(path));
  const geometry = new ExtrudeGeometry(shape, {
    depth: slab.thickness,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -slab.thickness / 2).rotateX(-Math.PI / 2);
  const surface = new Mesh(geometry, material);
  surface.position.set(anchor.x, z, -anchor.y);
  surface.userData.selection = { kind: "slab", id: slab.id };
  return surface;
}
