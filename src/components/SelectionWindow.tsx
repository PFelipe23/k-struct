import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { WorkPlane } from "../domain/geometry";

type Pixel = { x: number; y: number };
type Drag = { id: number; start: Pixel; moved: boolean };

export default function SelectionWindow({
  target,
  enabled,
  plane,
  projectId,
  onApply,
}: {
  target: RefObject<SVGSVGElement | null>;
  enabled: boolean;
  plane: WorkPlane;
  projectId: string;
  onApply: (a: Pixel, b: Pixel, additive: boolean) => void;
}) {
  const [box, setBox] = useState<{ start: Pixel; end: Pixel } | null>(null);
  const blockClick = useRef(false);
  const apply = useEffectEvent(onApply);
  useEffect(() => {
    const svg = target.current!;
    let drag: Drag | null = null;
    const pixel = (e: PointerEvent) => {
      const bounds = svg.getBoundingClientRect();
      return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    };
    function down(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary) return;
      blockClick.current = false;
      if (enabled) drag = { id: e.pointerId, start: pixel(e), moved: false };
    }
    function move(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id) return;
      const end = pixel(e);
      if (!drag.moved) {
        if (Math.hypot(end.x - drag.start.x, end.y - drag.start.y) < 4) return;
        drag.moved = true;
        svg.setPointerCapture(e.pointerId);
      }
      setBox({ start: drag.start, end });
    }
    function clear() {
      if (!drag) return;
      const { id } = drag;
      drag = null;
      if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
      setBox(null);
    }
    function up(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id || e.button !== 0) return;
      if (drag.moved) {
        blockClick.current = true;
        apply(drag.start, pixel(e), e.ctrlKey || e.metaKey || e.shiftKey);
      }
      clear();
    }
    function cancel() {
      if (!drag) return;
      blockClick.current = true;
      clear();
    }
    function lost(e: PointerEvent) {
      if (drag?.id === e.pointerId && e.target === svg) cancel();
    }
    function escape(e: KeyboardEvent) {
      if (drag && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    }
    function click(e: MouseEvent) {
      if (blockClick.current && e.detail > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    svg.addEventListener("pointerdown", down, true);
    svg.addEventListener("click", click, true);
    svg.addEventListener("lostpointercapture", lost);
    svg.addEventListener("focusout", cancel);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", pointerCancel, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    function pointerCancel(e: PointerEvent) {
      if (drag?.id === e.pointerId) cancel();
    }
    return () => {
      svg.removeEventListener("pointerdown", down, true);
      svg.removeEventListener("click", click, true);
      svg.removeEventListener("lostpointercapture", lost);
      svg.removeEventListener("focusout", cancel);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [target, enabled, plane.kind, plane.offset, projectId]);
  if (!box) return null;
  const crossing = box.start.x > box.end.x;
  const x = Math.min(box.start.x, box.end.x),
    y = Math.min(box.start.y, box.end.y);
  return (
    <g
      className="selection-window"
      data-mode={crossing ? "crossing" : "window"}
      pointerEvents="none"
      aria-label={crossing ? "Cruzamento" : "Janela de contenção"}
    >
      <rect
        x={x}
        y={y}
        width={Math.abs(box.end.x - box.start.x)}
        height={Math.abs(box.end.y - box.start.y)}
      />
      <text x={Math.max(2, x + 5)} y={Math.max(14, y + 15)}>
        {crossing ? "Cruzamento" : "Janela de contenção"}
      </text>
    </g>
  );
}
