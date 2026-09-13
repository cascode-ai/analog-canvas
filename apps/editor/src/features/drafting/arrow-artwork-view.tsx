import {
  arrowArtwork,
  arrowPathData,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { DraftingObject, Point } from "@icm/model";

export function ArrowArtworkView({
  object,
  points,
  controls = [],
  profile,
  color,
}: {
  object: Pick<
    Extract<DraftingObject, { kind: "arrow" }>,
    "styleOverride" | "outline"
  >;
  points: readonly Point[];
  controls?: readonly (Point | null)[];
  profile: SchematicStyleProfile;
  color: string;
}) {
  const art = arrowArtwork(object, points, controls, profile);
  const serialize = (values: readonly Point[]) =>
    values.map((p) => `${p.x},${p.y}`).join(" ");
  const dash = object.styleOverride?.lineStyle;
  return (
    <g
      stroke={color}
      strokeWidth={art.strokeWidth}
      strokeLinecap={profile.lineCap}
      strokeLinejoin={profile.lineJoin}
      strokeMiterlimit={profile.miterLimit}
    >
      {art.outline ? (
        <polygon
          points={serialize(art.outline)}
          fill="none"
          strokeDasharray={
            dash === "dashed" ? "6 4" : dash === "dotted" ? "2 3" : undefined
          }
        />
      ) : (
        <>
          <path
            d={arrowPathData(art.shaft, art.controls)}
            fill="none"
            strokeDasharray={
              dash === "dashed" ? "6 4" : dash === "dotted" ? "2 3" : undefined
            }
          />
          {art.heads.map((head, index) => (
            <polygon
              key={index}
              points={serialize(head.points)}
              fill={head.style === "open" ? "none" : color}
              stroke={head.style === "open" ? color : "none"}
            />
          ))}
        </>
      )}
      {art.dots.map(({ center, radius }, index) => (
        <circle
          key={`dot-${index}`}
          cx={center.x}
          cy={center.y}
          r={radius}
          fill={color}
          stroke="none"
        />
      ))}
    </g>
  );
}
